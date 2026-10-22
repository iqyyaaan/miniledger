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

/** How many codes one phone may request per window, independent of IP. */
const OTP_SENDS_PER_PHONE = 5;
const OTP_SEND_WINDOW_SECONDS = 15 * 60;

/**
 * Step 1 of login: generate a code, store only its hash, and "send" it.
 *
 * Returns the code itself only when `OTP_ECHO_IN_RESPONSE` is on (development),
 * which lets the app prefill the field for a smooth demo. The authoritative
 * delivery is always the server log, as the brief asks.
 */
export async function requestOtp(phone: string): Promise<{ expiresInSeconds: number; devCode?: string }> {
  const recentSends = await repo.countRecentOtps(phone, OTP_SEND_WINDOW_SECONDS);
  if (recentSends >= OTP_SENDS_PER_PHONE) {
    throw tooManyRequests(
      'Too many codes requested for this number. Please wait a few minutes.',
      OTP_SEND_WINDOW_SECONDS,
    );
  }

  // Invalidate earlier codes first: if a user taps "resend", only the newest
  // code should work. Otherwise every resend widens the guessable surface.
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

/**
 * Step 2: verify the code and mint a session.
 *
 * The whole check runs in one transaction with the OTP row locked
 * `FOR UPDATE`, so concurrent guesses are serialised and each one really does
 * cost an attempt. Creating the user, consuming the code and issuing the
 * refresh token are all in that same transaction — there is no state where a
 * code is spent but no session exists.
 */
export async function verifyOtp(phone: string, code: string): Promise<AuthenticatedSession> {
  /**
   * Same shape of bug as `refreshSession`: `withTransaction` rolls back on
   * any throw from its callback. Throwing "incorrect code" *inside* the
   * transaction would roll back the `incrementOtpAttempts` write we just
   * made, so a wrong guess would never actually cost an attempt and the
   * lockout could never trigger.
   *
   * So the callback only ever returns — recording the attempt and deciding
   * the outcome tag in the same commit — and the throw happens after, where
   * it can no longer undo anything.
   */
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

    // Correct. Burn the code so it cannot be replayed.
    await repo.markOtpConsumed(client, otp.id);

    const existingUser = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM users WHERE phone = $1) AS exists',
      [phone],
    );
    const isNewUser = !existingUser.rows[0]?.exists;

    const user = await repo.upsertUserByPhone(client, phone);
    // `refreshTokenId` is the internal DB row id used for rotation
    // bookkeeping — it must never leave this process.
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
    // Deliberately identical message for "no code", "expired" and "wrong
    // code": a caller must not be able to probe which phone numbers have a
    // pending login, or learn that a code exists but is wrong.
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

/**
 * Exchange a refresh token for a new pair, rotating as we go.
 *
 * Rotation means each refresh token is single-use. If a token that has
 * *already been rotated* shows up again, the only explanations are a stolen
 * token or a cloned device — so we revoke every live token for that user and
 * force a fresh login. This is the standard refresh-token-reuse detection from
 * OAuth 2.0 BCP.
 */
export async function refreshSession(refreshToken: string): Promise<SessionTokens> {
  /**
   * `withTransaction` rolls back on *any* throw from the callback — including
   * one we raise deliberately to report "reuse detected" to the caller. That
   * would undo the very revocation this function just performed, leaving the
   * reused token's whole family still live.
   *
   * So the callback never throws for an outcome that should still be
   * committed: it returns a tagged result, the transaction always commits,
   * and only then do we throw based on that tag.
   */
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

/** Idempotent by design: signing out twice is not an error worth surfacing. */
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
