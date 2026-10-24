import type { PoolClient } from 'pg';
import { query } from '../../db/pool.js';

export interface UserRow {
  id: string;
  phone: string;
  display_name: string | null;
  created_at: Date;
}

export interface OtpRow {
  id: string;
  phone: string;
  code_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  attempts: number;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
}

// all the auth SQL lives in this file. keeping queries out of the service
// means auth.service.ts reads like policy ("has this expired, any attempts
// left") and this one reads like plain storage

export async function insertOtp(
  phone: string,
  codeHash: string,
  expiresAt: Date,
): Promise<OtpRow> {
  const { rows } = await query<OtpRow>(
    `INSERT INTO otp_codes (phone, code_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, phone, code_hash, expires_at, consumed_at, attempts`,
    [phone, codeHash, expiresAt],
  );
  return rows[0]!;
}

// issuing a new code kills any earlier one — only the latest ever works
export async function consumeOutstandingOtps(phone: string): Promise<void> {
  await query(
    `UPDATE otp_codes
        SET consumed_at = now()
      WHERE phone = $1 AND consumed_at IS NULL`,
    [phone],
  );
}

export async function countRecentOtps(phone: string, withinSeconds: number): Promise<number> {
  const { rows } = await query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM otp_codes
      WHERE phone = $1
        AND created_at > now() - make_interval(secs => $2)`,
    [phone, withinSeconds],
  );
  return rows[0]?.count ?? 0;
}

// grabs the newest live challenge for a phone and locks it FOR UPDATE, so
// two concurrent verify requests can't both read "attempts = 4" and both
// decide they've still got a guess left
export async function findLatestActiveOtpForUpdate(
  client: PoolClient,
  phone: string,
): Promise<OtpRow | null> {
  const { rows } = await client.query<OtpRow>(
    `SELECT id, phone, code_hash, expires_at, consumed_at, attempts
       FROM otp_codes
      WHERE phone = $1 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
        FOR UPDATE`,
    [phone],
  );
  return rows[0] ?? null;
}

export async function incrementOtpAttempts(client: PoolClient, otpId: string): Promise<number> {
  const { rows } = await client.query<{ attempts: number }>(
    `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
    [otpId],
  );
  return rows[0]?.attempts ?? 0;
}

export async function markOtpConsumed(client: PoolClient, otpId: string): Promise<void> {
  await client.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otpId]);
}

// find-or-create in a single statement. ON CONFLICT DO UPDATE (instead of
// DO NOTHING) guarantees something always comes back from RETURNING, and
// the unique index on phone makes this race-safe — two people's very first
// login hitting at the same instant still end up as exactly one user row.
export async function upsertUserByPhone(client: PoolClient, phone: string): Promise<UserRow> {
  const { rows } = await client.query<UserRow>(
    `INSERT INTO users (phone)
     VALUES ($1)
     ON CONFLICT (phone) DO UPDATE SET updated_at = now()
     RETURNING id, phone, display_name, created_at`,
    [phone],
  );
  return rows[0]!;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    'SELECT id, phone, display_name, created_at FROM users WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function updateDisplayName(id: string, displayName: string | null): Promise<UserRow> {
  const { rows } = await query<UserRow>(
    `UPDATE users SET display_name = $2 WHERE id = $1
     RETURNING id, phone, display_name, created_at`,
    [id, displayName],
  );
  return rows[0]!;
}

export async function insertRefreshToken(
  client: PoolClient,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<RefreshTokenRow> {
  const { rows } = await client.query<RefreshTokenRow>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, token_hash, expires_at, revoked_at, replaced_by`,
    [userId, tokenHash, expiresAt],
  );
  return rows[0]!;
}

export async function findRefreshTokenForUpdate(
  client: PoolClient,
  tokenHash: string,
): Promise<RefreshTokenRow | null> {
  const { rows } = await client.query<RefreshTokenRow>(
    `SELECT id, user_id, token_hash, expires_at, revoked_at, replaced_by
       FROM refresh_tokens
      WHERE token_hash = $1
        FOR UPDATE`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function rotateRefreshToken(
  client: PoolClient,
  oldId: string,
  newId: string,
): Promise<void> {
  await client.query(
    'UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1',
    [oldId, newId],
  );
}

export async function revokeRefreshToken(tokenHash: string): Promise<boolean> {
  const { rowCount } = await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [tokenHash],
  );
  return (rowCount ?? 0) > 0;
}

// called once a reused (already-rotated) token is detected — kill the whole session family
export async function revokeAllRefreshTokensForUser(
  client: PoolClient,
  userId: string,
): Promise<number> {
  const { rowCount } = await client.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rowCount ?? 0;
}
