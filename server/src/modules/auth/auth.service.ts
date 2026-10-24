import { env } from '../../config/env.js';
import { withTransaction } from '../../db/pool.js';
import { generateNumericOtp, generateOpaqueToken, safeEqualHex, sha256 } from '../../lib/crypto.js';
import { conflict, tooManyRequests, unauthorized } from '../../lib/errors.js';
import { signAccessToken } from '../../lib/jwt.js';
import { deliverOtp, logger } from '../../lib/logger.js';
import { maskPhone } from '../../lib/phone.js';
import * as repo from './auth.repository.js';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthenticatedSession extends SessionTokens {
  user: { id: string; phone: string; displayName: string | null; createdAt: string };
  isNewUser: boolean;
}

// per-phone cap, separate from the per-IP rate limiter on the route itself
const OTP_SENDS_PER_PHONE = 5;
const OTP_SEND_WINDOW_SECONDS = 15 * 60;

// Step 1 of login. Generates a code, stores only the hash, "sends" it.
// devCode only comes back when OTP_ECHO_IN_RESPONSE is on — lets the app
// autofill during local dev/demo. Real delivery is always the server log.
export async function requestOtp(phone: string): Promise<{ expiresInSeconds: number; devCode?: string }> {
  const recentSends = await repo.countRecentOtps(phone, OTP_SEND_WINDOW_SECONDS);
  if (recentSends >= OTP_SENDS_PER_PHONE) {
    throw tooManyRequests(
      'Too many codes requested for this number. Please wait a few minutes.',
      OTP_SEND_WINDOW_SECONDS,
    );
  }

  // kill any earlier code before issuing a new one — otherwise "resend" just
  // adds another valid guess to the pile instead of replacing the old one
  await repo.consumeOutstandingOtps(phone);

  const code = generateNumericOtp(env.OTP_LENGTH);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

  await repo.insertOtp(phone, sha256(code), expiresAt);
  deliverOtp(phone, code, env.OTP_TTL_SECONDS);

  return {
    expiresInSeconds: env.OTP_TTL_SECONDS,
    ...(env.OTP_ECHO_IN_RESPONSE ? { devCode: code } : {}),
  };
}

// Step 2: check the code, mint a session.
//
// Runs as one transaction with the OTP row locked FOR UPDATE, so two
// concurrent guesses can't both read "4 attempts left" and both proceed —
// they get serialized and each actually costs an attempt. User creation,
// burning the code, and issuing the refresh token all happen in the same
// transaction too, so there's no window where the code is spent but login
// didn't actually go through.
export async function verifyOtp(phone: string, code: string): Promise<AuthenticatedSession> {
  // careful: withTransaction rolls back on ANY throw from the callback.
  // I originally threw "incorrect code" straight from inside here and it
  // silently undid the incrementOtpAttempts() write along with it — meaning
  // a wrong guess never actually cost an attempt and the lockout never
  // fired. fix is to only ever return a result tag from the callback and
  // throw afterward, once the transaction has already committed.
  type Outcome =
    | { kind: 'ok'; session: AuthenticatedSession }
    | { kind: 'invalid' }
    | { kind: 'locked_out' };

  const outcome = await withTransaction<Outcome>(async (client) => {
    const otp = await repo.findLatestActiveOtpForUpdate(client, phone);

    if (!otp) return { kind: 'invalid' };

    if (otp.expires_at.getTime() <= Date.now()) {
      await repo.markOtpConsumed(client, otp.id);
      return { kind: 'invalid' };
    }

    if (otp.attempts >= env.OTP_MAX_ATTEMPTS) {
      await repo.markOtpConsumed(client, otp.id);
      return { kind: 'locked_out' };
    }

    if (!safeEqualHex(otp.code_hash, sha256(code))) {
      const attempts = await repo.incrementOtpAttempts(client, otp.id);
      const remaining = Math.max(0, env.OTP_MAX_ATTEMPTS - attempts);
      if (remaining === 0) {
        await repo.markOtpConsumed(client, otp.id);
        return { kind: 'locked_out' };
      }
      return { kind: 'invalid' };
    }

    // right code — burn it so it can't be replayed
    await repo.markOtpConsumed(client, otp.id);

    const existingUser = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM users WHERE phone = $1) AS exists',
      [phone],
    );
    const isNewUser = !existingUser.rows[0]?.exists;

    const user = await repo.upsertUserByPhone(client, phone);
    // refreshTokenId is just our internal row id for rotation bookkeeping,
    // doesn't belong in the API response
    const { refreshTokenId: _ignored, ...tokens } = await issueTokens(client, user.id, user.phone);

    return {
      kind: 'ok',
      session: {
        ...tokens,
        isNewUser,
        user: {
          id: user.id,
          phone: user.phone,
          displayName: user.display_name,
          createdAt: user.created_at.toISOString(),
        },
      },
    };
  });

  if (outcome.kind === 'locked_out') {
    throw tooManyRequests('Too many incorrect attempts. Request a new code.');
  }
  if (outcome.kind === 'invalid') {
    // same message for "no code", "expired", and "wrong code" on purpose —
    // don't want to give callers a way to tell which phone numbers have a
    // login in progress
    throw unauthorized('That code is incorrect or has expired.');
  }

  logger.info(
    { phone: maskPhone(phone), userId: outcome.session.user.id, isNewUser: outcome.session.isNewUser },
    'Login succeeded',
  );
  return outcome.session;
}

async function issueTokens(
  client: Parameters<Parameters<typeof withTransaction>[0]>[0],
  userId: string,
  phone: string,
): Promise<SessionTokens & { refreshTokenId: string }> {
  const { token: accessToken, expiresIn } = signAccessToken(userId, phone);
  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const row = await repo.insertRefreshToken(client, userId, sha256(refreshToken), expiresAt);

  return { accessToken, refreshToken, expiresIn, tokenType: 'Bearer', refreshTokenId: row.id };
}

// Exchange a refresh token for a new pair, rotating as we go — each refresh
// token is single-use. If a token that's already been rotated shows up
// again, that's not a normal race, it means someone replayed a stolen (or
// duplicated) token. So we nuke every live session for that user and make
// them log in again. Standard refresh-token-reuse detection, same idea as
// OAuth 2.0's BCP recommendation.
export async function refreshSession(refreshToken: string): Promise<SessionTokens> {
  // same gotcha as verifyOtp above — don't throw from inside the
  // transaction callback for an outcome you still want committed, or the
  // revocation gets rolled back along with the "error". return a tag,
  // commit, throw after.
  type Outcome =
    | { kind: 'ok'; tokens: SessionTokens }
    | { kind: 'reuse_detected' }
    | { kind: 'invalid' }
    | { kind: 'signed_out' }
    | { kind: 'expired' }
    | { kind: 'account_missing' };

  const outcome = await withTransaction<Outcome>(async (client) => {
    const tokenHash = sha256(refreshToken);
    const row = await repo.findRefreshTokenForUpdate(client, tokenHash);

    if (!row) return { kind: 'invalid' };

    if (row.revoked_at) {
      if (row.replaced_by) {
        const revoked = await repo.revokeAllRefreshTokensForUser(client, row.user_id);
        logger.warn(
          { userId: row.user_id, revoked },
          'Refresh token reuse detected — revoked all sessions for user',
        );
        return { kind: 'reuse_detected' };
      }
      return { kind: 'signed_out' };
    }

    if (row.expires_at.getTime() <= Date.now()) return { kind: 'expired' };

    const user = await client.query<{ phone: string }>('SELECT phone FROM users WHERE id = $1', [
      row.user_id,
    ]);
    const phone = user.rows[0]?.phone;
    if (!phone) return { kind: 'account_missing' };

    const next = await issueTokens(client, row.user_id, phone);
    await repo.rotateRefreshToken(client, row.id, next.refreshTokenId);

    const { refreshTokenId: _ignored, ...tokens } = next;
    return { kind: 'ok', tokens };
  });

  switch (outcome.kind) {
    case 'ok':
      return outcome.tokens;
    case 'reuse_detected':
      throw conflict('This session was reused and has been revoked. Please sign in again.');
    case 'signed_out':
      throw unauthorized('This session has been signed out.');
    case 'expired':
      throw unauthorized('Your session has expired. Please sign in again.');
    case 'invalid':
      throw unauthorized('Invalid refresh token.');
    case 'account_missing':
      throw unauthorized('Account no longer exists.');
  }
}

// signing out twice isn't an error, just make it idempotent
export async function logout(refreshToken: string): Promise<void> {
  await repo.revokeRefreshToken(sha256(refreshToken));
}

export async function getProfile(userId: string) {
  const user = await repo.findUserById(userId);
  if (!user) throw unauthorized('Account no longer exists.');
  return {
    id: user.id,
    phone: user.phone,
    displayName: user.display_name,
    createdAt: user.created_at.toISOString(),
  };
}

export async function setDisplayName(userId: string, displayName: string | null) {
  const user = await repo.updateDisplayName(userId, displayName);
  return {
    id: user.id,
    phone: user.phone,
    displayName: user.display_name,
    createdAt: user.created_at.toISOString(),
  };
}
