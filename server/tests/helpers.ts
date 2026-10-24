import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { ensureUploadRoot } from '../src/modules/receipts/receipts.service.js';

// integration tests hit a REAL Postgres (the db-test service in
// docker-compose.yml), not a mock or some in-memory shim, on purpose. most
// of the interesting logic in this app basically IS the SQL — the aggregate
// FILTER clauses, the generated friend_key column, the CHECK constraint
// that keeps status/repaid_at in sync, the conditional UPDATE that makes
// repayment idempotent. a fake database would happily pass tests for
// behavior Postgres doesn't actually have.

let app: Express | null = null;

export async function getApp(): Promise<Express> {
  if (!app) {
    await runMigrations();
    await ensureUploadRoot();
    app = createApp();
  }
  return app;
}

// wipes between tests — users cascades down to loans, receipts, refresh tokens
export async function resetDatabase(): Promise<void> {
  await pool.query('TRUNCATE users, otp_codes RESTART IDENTITY CASCADE');
  resetRateLimits();
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export interface TestSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  phone: string;
  auth: (req: request.Test) => request.Test;
}

// walks the real login flow — request a code, grab it back out of the
// response (OTP_ECHO_IN_RESPONSE is on for tests), verify it. no shortcut
// of seeding a user row straight into the DB, so this exercises the exact
// path a real device would take.
export async function signIn(
  server: Express,
  phone = '+919876543210',
): Promise<TestSession> {
  const otpResponse = await request(server).post('/api/auth/request-otp').send({ phone }).expect(200);
  const code = otpResponse.body.devCode as string;
  if (!code) throw new Error('OTP_ECHO_IN_RESPONSE must be true for tests');

  const verified = await request(server)
    .post('/api/auth/verify-otp')
    .send({ phone, code })
    .expect(200);

  const accessToken = verified.body.accessToken as string;

  return {
    accessToken,
    refreshToken: verified.body.refreshToken as string,
    userId: verified.body.user.id as string,
    phone: verified.body.user.phone as string,
    auth: (req) => req.set('Authorization', `Bearer ${accessToken}`),
  };
}

// +5 -> five days from today, as YYYY-MM-DD. keeps test fixtures relative
// to "now" instead of hardcoded dates that go stale.
export function daysFromToday(offset: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0); // midday so a DST shift can't accidentally move the day
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

// a real, valid 1x1 PNG (not just some random bytes) for receipt-upload tests
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
