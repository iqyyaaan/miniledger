import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, daysFromToday, getApp, resetDatabase, signIn, type TestSession } from '../helpers.js';

describe('summary', () => {
  let app: Express;
  let session: TestSession;

  beforeAll(async () => {
    app = await getApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    session = await signIn(app);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  const create = (body: Record<string, unknown>) =>
    session.auth(request(app).post('/api/loans')).send(body);

  it('returns all zeros with no loans, and a null (not NaN) repaidPercent', async () => {
    const res = await session.auth(request(app).get('/api/summary')).expect(200);
    expect(res.body.data.totals).toMatchObject({
      lentMinor: 0,
      repaidMinor: 0,
      outstandingMinor: 0,
      overdueMinor: 0,
      dueSoonMinor: 0,
    });
    expect(res.body.data.repaidPercent).toBeNull();
    expect(res.body.data.topDebtors).toEqual([]);
  });

  it('computes total lent, repaid, outstanding and overdue correctly', async () => {
    // overdue and still outstanding
    await create({ friendName: 'Ravi', amount: '1000', dueDate: daysFromToday(-5) }).expect(201);
    // due soon, still outstanding
    await create({ friendName: 'Dev', amount: '500', dueDate: daysFromToday(3) }).expect(201);
    // outstanding but way out — not due-soon, not overdue either
    await create({ friendName: 'Nisha', amount: '2000', dueDate: daysFromToday(60) }).expect(201);
    // repaid — due date's in the past but this should NOT count as overdue
    const repaid = await create({ friendName: 'Karthik', amount: '300', dueDate: daysFromToday(-30) }).expect(
      201,
    );
    await session.auth(request(app).post(`/api/loans/${repaid.body.data.id}/repayment`)).expect(200);

    const res = await session.auth(request(app).get('/api/summary')).expect(200);
    const { totals, counts } = res.body.data;

    expect(totals.lentMinor).toBe(100_000 + 50_000 + 200_000 + 30_000);
    expect(totals.repaidMinor).toBe(30_000);
    expect(totals.outstandingMinor).toBe(100_000 + 50_000 + 200_000);
    expect(totals.overdueMinor).toBe(100_000); // only Ravi's — Karthik's is repaid, doesn't count
    expect(totals.dueSoonMinor).toBe(50_000); // only Dev's falls inside the 7-day window

    expect(counts.total).toBe(4);
    expect(counts.repaid).toBe(1);
    expect(counts.outstanding).toBe(3);
    expect(counts.overdue).toBe(1);
    expect(counts.dueSoon).toBe(1);
    expect(counts.friends).toBe(4);

    // lent total: 1000 + 500 + 2000 + 300 = 3800 major units = 380,000 minor
    expect(res.body.data.repaidPercent).toBeCloseTo((30_000 / 380_000) * 100, 1);
  });

  it('is unaffected by floating point when many small amounts are summed', async () => {
    // 30 entries of ₹0.10 — classic float-drift trap. should come out exact
    // since this is integer paise the whole way through.
    for (let i = 0; i < 30; i += 1) {
      await create({ friendName: 'Ravi', amount: '0.10', dueDate: daysFromToday(10) }).expect(201);
    }
    const res = await session.auth(request(app).get('/api/summary')).expect(200);
    expect(res.body.data.totals.outstandingMinor).toBe(300); // exactly ₹3.00, not ₹2.9999999999999996
  });

  it('ranks top debtors by outstanding amount, grouping by friend regardless of case', async () => {
    await create({ friendName: 'Ravi', amount: '1000', dueDate: daysFromToday(5) }).expect(201);
    await create({ friendName: 'ravi', amount: '500', dueDate: daysFromToday(5) }).expect(201);
    await create({ friendName: 'Dev', amount: '200', dueDate: daysFromToday(5) }).expect(201);

    const res = await session.auth(request(app).get('/api/summary')).expect(200);
    expect(res.body.data.topDebtors[0]).toMatchObject({ outstandingMinor: 150_000, loanCount: 2 });
    expect(res.body.data.topDebtors[1]).toMatchObject({ friendName: 'Dev', outstandingMinor: 20_000 });
  });

  it('respects an explicit asOf for what counts as overdue', async () => {
    await create({ friendName: 'Ravi', amount: '1000', dueDate: daysFromToday(5) }).expect(201);

    const today = await session.auth(request(app).get('/api/summary')).expect(200);
    expect(today.body.data.totals.overdueMinor).toBe(0);

    const future = await session
      .auth(request(app).get('/api/summary').query({ asOf: daysFromToday(10) }))
      .expect(200);
    expect(future.body.data.totals.overdueMinor).toBe(100_000);
  });

  it('is scoped per-user', async () => {
    await create({ friendName: 'Ravi', amount: '1000', dueDate: daysFromToday(5) }).expect(201);
    const other = await signIn(app, '+917333333333');
    const res = await other.auth(request(app).get('/api/summary')).expect(200);
    expect(res.body.data.totals.lentMinor).toBe(0);
  });

  it('requires authentication', async () => {
    await request(app).get('/api/summary').expect(401);
  });
});
