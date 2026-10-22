import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { ensureUploadRoot } from '../src/modules/receipts/receipts.service.js';

/**
 * Integration tests run against a *real* Postgres (the `db-test` service in
 * docker-compose.yml), not a mock or an in-memory shim.
 *
 * That is deliberate. Most of the interesting logic in this app IS the SQL —
 * aggregate FILTER clauses, the generated `friend_key` column, the CHECK
 * constraint that keeps `status` and `repaid_at` in step, the conditional
 * UPDATE that makes repayment idempotent. A fake database would happily pass
 * tests for behaviour Postgres does not actually have.
 */

let app: Express | null = null;

export async function getApp(): Promise<Express> {
  if (!app) {
    await runMigrations();
    await ensureUploadRoot();
    app = createApp();
  }
  return app;
}

/** Wipe between tests. `users` cascades to loans, receipts and refresh tokens. */
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

/**
 * Walk the real login flow — request a code, read it back out of the response
 * (`OTP_ECHO_IN_RESPONSE` is on in tests), verify it. No seeding a user row
 * directly, so the tests exercise the same path a real device takes.
 */
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

/** `+5` -> five days from today, as YYYY-MM-DD. Keeps fixtures time-relative. */
export function daysFromToday(offset: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0); // Midday, so a DST shift cannot move the day.
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** A minimal but genuinely valid 1x1 PNG, for receipt-upload tests. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
