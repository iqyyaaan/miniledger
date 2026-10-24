import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getApp, resetDatabase, signIn } from '../helpers.js';

describe('auth', () => {
  let app: Express;

  beforeAll(async () => {
    app = await getApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('normalizes phone spellings so request-otp and verify-otp agree', async () => {
    const otp = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone: '98765 43210' })
      .expect(200);

    expect(otp.body.phone).toBe('+919876543210');
    const code = otp.body.devCode as string;
    expect(code).toMatch(/^\d{6}$/);

    // Verify with a differently-formatted spelling of the same number.
    const verified = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '+91-98765-43210', code })
      .expect(200);

    expect(verified.body.user.phone).toBe('+919876543210');
    expect(verified.body.accessToken).toBeTruthy();
    expect(verified.body.refreshToken).toBeTruthy();
    // that's just internal bookkeeping, shouldn't leak into the API response
    expect(verified.body.refreshTokenId).toBeUndefined();
  });

  it('rejects a wrong code without revealing whether one exists', async () => {
    const wrongPhone = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '+919999999999', code: '000000' })
      .expect(401);

    const otp = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone: '+918888888888' })
      .expect(200);

    const rightPhoneWrongCode = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '+918888888888', code: '000000' })
      .expect(401);

    // same message either way, no way to tell from outside whether a given
    // number even has a pending login
    expect(wrongPhone.body.error.message).toBe(rightPhoneWrongCode.body.error.message);
    void otp;
  });

  it('locks out after too many wrong attempts', async () => {
    const phone = '+917000000001';
    await request(app).post('/api/auth/request-otp').send({ phone }).expect(200);

    // OTP_MAX_ATTEMPTS defaults to 5: the first four wrong guesses are each
    // "incorrect", and the fifth is the one that crosses the limit and
    // consumes the code.
    for (let i = 0; i < 4; i += 1) {
      await request(app).post('/api/auth/verify-otp').send({ phone, code: '111111' }).expect(401);
    }

    const locked = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone, code: '111111' })
      .expect(429);
    expect(locked.body.error.code).toBe('too_many_requests');

    // The code is now consumed, so there is no active challenge left to
    // compare against — further attempts report "incorrect or expired".
    await request(app).post('/api/auth/verify-otp').send({ phone, code: '111111' }).expect(401);
  });

  it('consumes a code so it cannot be replayed', async () => {
    const phone = '+917000000002';
    const otp = await request(app).post('/api/auth/request-otp').send({ phone }).expect(200);
    const code = otp.body.devCode as string;

    await request(app).post('/api/auth/verify-otp').send({ phone, code }).expect(200);
    await request(app).post('/api/auth/verify-otp').send({ phone, code }).expect(401);
  });

  it('invalidates an earlier code when a new one is requested', async () => {
    const phone = '+917000000003';
    const first = await request(app).post('/api/auth/request-otp').send({ phone }).expect(200);
    await request(app).post('/api/auth/request-otp').send({ phone }).expect(200);

    await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone, code: first.body.devCode })
      .expect(401);
  });

  it('issues a working access token and rejects requests without one', async () => {
    const session = await signIn(app);

    await request(app).get('/api/auth/me').expect(401);

    const me = await session.auth(request(app).get('/api/auth/me')).expect(200);
    expect(me.body.user.id).toBe(session.userId);
  });

  it('rotates refresh tokens and detects reuse of a retired one', async () => {
    const session = await signIn(app);

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    expect(refreshed.body.refreshToken).not.toBe(session.refreshToken);

    // replaying the now-retired token is reuse, not just "expired" — this
    // should nuke the whole session family, not just reject the one call
    const reuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(409);
    expect(reuse.body.error.code).toBe('conflict');

    // the replacement token is collateral damage of the reuse detection — also dead now
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });

  it('logs out by revoking the refresh token', async () => {
    const session = await signIn(app);
    await request(app).post('/api/auth/logout').send({ refreshToken: session.refreshToken }).expect(204);
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });

  it('upserts one user row no matter how many times the same phone logs in', async () => {
    const first = await signIn(app, '+917000000099');
    const second = await signIn(app, '+917000000099');
    expect(first.userId).toBe(second.userId);
  });

  it('rejects malformed input with field-level details', async () => {
    const res = await request(app).post('/api/auth/request-otp').send({ phone: 'abc' }).expect(422);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details[0]).toMatchObject({ field: 'phone' });
  });

  it('rejects unknown fields on request-otp', async () => {
    await request(app)
      .post('/api/auth/request-otp')
      .send({ phone: '+919876543210', extra: 'nope' })
      .expect(422);
  });
});
