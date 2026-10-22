import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, daysFromToday, getApp, resetDatabase, signIn, TINY_PNG, type TestSession } from '../helpers.js';

describe('loans', () => {
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

  it('creates an entry and returns integer minor units alongside a decimal string', async () => {
    const res = await create({
      friendName: 'Ravi',
      amount: '1250.50',
      dueDate: daysFromToday(10),
      note: 'Concert tickets',
    }).expect(201);

    expect(res.body.data).toMatchObject({
      friendName: 'Ravi',
      amountMinor: 125_050,
      amount: '1250.50',
      currency: 'INR',
      status: 'outstanding',
      isOverdue: false,
      note: 'Concert tickets',
    });
    expect(res.body.data.id).toBeTruthy();
    expect(res.headers.location).toBe(`/api/loans/${res.body.data.id}`);
  });

  it('accepts amounts with grouping separators and a currency symbol', async () => {
    const res = await create({
      friendName: 'Dev',
      amount: '₹1,00,000',
      dueDate: daysFromToday(5),
    }).expect(201);
    expect(res.body.data.amountMinor).toBe(10_000_000);
  });

  it.each([
    [{ friendName: '', amount: '100', dueDate: daysFromToday(1) }, 'friendName'],
    [{ friendName: 'Ravi', amount: '0', dueDate: daysFromToday(1) }, 'amount'],
    [{ friendName: 'Ravi', amount: '-50', dueDate: daysFromToday(1) }, 'amount'],
    [{ friendName: 'Ravi', amount: 'abc', dueDate: daysFromToday(1) }, 'amount'],
    [{ friendName: 'Ravi', amount: '100', dueDate: '2026-02-30' }, 'dueDate'],
    [{ friendName: 'Ravi', amount: '100', dueDate: 'not-a-date' }, 'dueDate'],
    [{ friendName: 'Ravi', amount: '100' }, 'dueDate'],
  ] as const)('rejects invalid payload %j', async (body, field) => {
    const res = await create(body).expect(422);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('rejects an unknown field (no silent pass-through of e.g. userId)', async () => {
    await create({
      friendName: 'Ravi',
      amount: '100',
      dueDate: daysFromToday(1),
      userId: 'something-else',
    }).expect(422);
  });

  it('requires authentication', async () => {
    await request(app)
      .post('/api/loans')
      .send({ friendName: 'Ravi', amount: '100', dueDate: daysFromToday(1) })
      .expect(401);
  });

  describe('overdue derivation', () => {
    it('flags a past due date on an outstanding loan as overdue, with negative daysUntilDue', async () => {
      const res = await create({
        friendName: 'Ravi',
        amount: '500',
        dueDate: daysFromToday(-3),
      }).expect(201);

      expect(res.body.data.isOverdue).toBe(true);
      expect(res.body.data.daysUntilDue).toBe(-3);
    });

    it('does not flag a repaid loan as overdue even with a past due date', async () => {
      const created = await create({
        friendName: 'Ravi',
        amount: '500',
        dueDate: daysFromToday(-3),
      }).expect(201);

      const repaid = await session
        .auth(request(app).post(`/api/loans/${created.body.data.id}/repayment`))
        .expect(200);

      expect(repaid.body.data.status).toBe('repaid');
      expect(repaid.body.data.isOverdue).toBe(false);
      expect(repaid.body.data.repaidAt).toBeTruthy();
    });

    it('respects an explicit asOf date from the client', async () => {
      const created = await create({
        friendName: 'Ravi',
        amount: '500',
        dueDate: daysFromToday(5),
      }).expect(201);

      // Not overdue today, but would be from ten days in the future.
      const future = await session
        .auth(request(app).get(`/api/loans/${created.body.data.id}`).query({ asOf: daysFromToday(10) }))
        .expect(200);

      expect(future.body.data.isOverdue).toBe(true);
      expect(future.body.data.daysUntilDue).toBe(-5);
    });
  });

  describe('repayment', () => {
    it('is idempotent: a second mark-repaid returns 409, not a silent double-apply', async () => {
      const created = await create({ friendName: 'Ravi', amount: '500', dueDate: daysFromToday(1) }).expect(
        201,
      );
      const loanId = created.body.data.id;

      await session.auth(request(app).post(`/api/loans/${loanId}/repayment`)).expect(200);
      const second = await session
        .auth(request(app).post(`/api/loans/${loanId}/repayment`))
        .expect(409);
      expect(second.body.error.details.code).toBe('already_repaid');
    });

    /**
     * The whole point of the conditional UPDATE in loans.repository.ts:
     * fire the same "mark repaid" request many times concurrently and
     * exactly one should succeed. A SELECT-then-UPDATE implementation would
     * let several through.
     */
    it('under concurrent requests, exactly one mark-repaid succeeds', async () => {
      const created = await create({ friendName: 'Ravi', amount: '500', dueDate: daysFromToday(1) }).expect(
        201,
      );
      const loanId = created.body.data.id;

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          session.auth(request(app).post(`/api/loans/${loanId}/repayment`)),
        ),
      );

      const succeeded = results.filter((r) => r.status === 200);
      const conflicted = results.filter((r) => r.status === 409);
      expect(succeeded).toHaveLength(1);
      expect(conflicted).toHaveLength(7);
    });

    it('can be undone', async () => {
      const created = await create({ friendName: 'Ravi', amount: '500', dueDate: daysFromToday(1) }).expect(
        201,
      );
      const loanId = created.body.data.id;

      await session.auth(request(app).post(`/api/loans/${loanId}/repayment`)).expect(200);
      const undone = await session.auth(request(app).delete(`/api/loans/${loanId}/repayment`)).expect(200);
      expect(undone.body.data.status).toBe('outstanding');
      expect(undone.body.data.repaidAt).toBeNull();
    });
  });

  describe('listing, filtering and pagination', () => {
    beforeEach(async () => {
      await create({ friendName: 'Ravi', amount: '100', dueDate: daysFromToday(-5) }).expect(201); // overdue
      await create({ friendName: 'Dev', amount: '200', dueDate: daysFromToday(2) }).expect(201); // due soon
      await create({ friendName: 'Nisha', amount: '300', dueDate: daysFromToday(30) }).expect(201); // later
      const repaidOne = await create({ friendName: 'Ravi', amount: '150', dueDate: daysFromToday(-10) }).expect(
        201,
      );
      await session.auth(request(app).post(`/api/loans/${repaidOne.body.data.id}/repayment`)).expect(200);
    });

    it('defaults to outstanding-only', async () => {
      const res = await session.auth(request(app).get('/api/loans')).expect(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data.every((l: { status: string }) => l.status === 'outstanding')).toBe(true);
    });

    it('filters by overdue', async () => {
      const res = await session.auth(request(app).get('/api/loans').query({ status: 'overdue' })).expect(
        200,
      );
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].friendName).toBe('Ravi');
    });

    it('filters by due_soon within the 7-day window', async () => {
      const res = await session.auth(request(app).get('/api/loans').query({ status: 'due_soon' })).expect(
        200,
      );
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].friendName).toBe('Dev');
    });

    it('filters by repaid', async () => {
      const res = await session.auth(request(app).get('/api/loans').query({ status: 'repaid' })).expect(
        200,
      );
      expect(res.body.data).toHaveLength(1);
    });

    it('returns everything with status=all', async () => {
      const res = await session.auth(request(app).get('/api/loans').query({ status: 'all' })).expect(200);
      expect(res.body.data).toHaveLength(4);
    });

    it('is case-insensitive when grouping by friend', async () => {
      await create({ friendName: 'ravi', amount: '50', dueDate: daysFromToday(1) }).expect(201);
      const res = await session
        .auth(request(app).get('/api/loans').query({ status: 'all', friend: 'RAVI' }))
        .expect(200);
      expect(res.body.data).toHaveLength(3); // the two original Ravi entries + this one
    });

    it('searches by note text', async () => {
      await create({ friendName: 'Karthik', amount: '75', dueDate: daysFromToday(1), note: 'birthday gift' }).expect(
        201,
      );
      const res = await session
        .auth(request(app).get('/api/loans').query({ status: 'all', search: 'birthday' }))
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].friendName).toBe('Karthik');
    });

    it('treats search input literally, not as a LIKE pattern', async () => {
      // A search for a literal percent sign must not match every row.
      const res = await session
        .auth(request(app).get('/api/loans').query({ status: 'all', search: '50%' }))
        .expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('paginates via keyset cursor with no gaps or dupes across pages', async () => {
      const page1 = await session
        .auth(request(app).get('/api/loans').query({ status: 'all', limit: 2, order: 'asc' }))
        .expect(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.meta.nextCursor).toBeTruthy();

      const page2 = await session
        .auth(
          request(app)
            .get('/api/loans')
            .query({ status: 'all', limit: 2, order: 'asc', cursor: page1.body.meta.nextCursor }),
        )
        .expect(200);

      const allIds = [...page1.body.data, ...page2.body.data].map((l: { id: string }) => l.id);
      expect(new Set(allIds).size).toBe(allIds.length);
      expect(allIds).toHaveLength(4);
    });

    it('rejects a malformed cursor with 400, not 500', async () => {
      await session
        .auth(request(app).get('/api/loans').query({ status: 'all', cursor: 'not-a-real-cursor' }))
        .expect(400);
    });
  });

  describe('ownership isolation', () => {
    it('cannot see, edit, or repay another user\'s loan', async () => {
      const other = await signIn(app, '+917111111111');
      const mine = await create({ friendName: 'Ravi', amount: '500', dueDate: daysFromToday(1) }).expect(
        201,
      );

      await other.auth(request(app).get(`/api/loans/${mine.body.data.id}`)).expect(404);
      await other
        .auth(request(app).patch(`/api/loans/${mine.body.data.id}`))
        .send({ amount: '1' })
        .expect(404);
      await other.auth(request(app).post(`/api/loans/${mine.body.data.id}/repayment`)).expect(404);
      await other.auth(request(app).delete(`/api/loans/${mine.body.data.id}`)).expect(404);

      const otherList = await other.auth(request(app).get('/api/loans').query({ status: 'all' })).expect(
        200,
      );
      expect(otherList.body.data).toHaveLength(0);
    });
  });

  describe('editing and deleting', () => {
    it('updates provided fields only', async () => {
      const created = await create({
        friendName: 'Ravi',
        amount: '500',
        dueDate: daysFromToday(1),
        note: 'original',
      }).expect(201);

      const updated = await session
        .auth(request(app).patch(`/api/loans/${created.body.data.id}`))
        .send({ amount: '750.25' })
        .expect(200);

      expect(updated.body.data.amount).toBe('750.25');
      expect(updated.body.data.friendName).toBe('Ravi');
      expect(updated.body.data.note).toBe('original');
    });

    it('rejects an empty patch', async () => {
      const created = await create({ friendName: 'Ravi', amount: '500', dueDate: daysFromToday(1) }).expect(
        201,
      );
      await session.auth(request(app).patch(`/api/loans/${created.body.data.id}`)).send({}).expect(422);
    });

    it('deletes an entry', async () => {
      const created = await create({ friendName: 'Ravi', amount: '500', dueDate: daysFromToday(1) }).expect(
        201,
      );
      await session.auth(request(app).delete(`/api/loans/${created.body.data.id}`)).expect(204);
      await session.auth(request(app).get(`/api/loans/${created.body.data.id}`)).expect(404);
    });

    it('404s deleting something that does not exist', async () => {
      await session
        .auth(request(app).delete('/api/loans/00000000-0000-0000-0000-000000000000'))
        .expect(404);
    });
  });

  describe('receipts', () => {
    it('attaches, downloads, and removes a receipt photo', async () => {
      const created = await create({ friendName: 'Ravi', amount: '500', dueDate: daysFromToday(1) }).expect(
        201,
      );
      const loanId = created.body.data.id;

      const attached = await session
        .auth(request(app).put(`/api/loans/${loanId}/receipt`))
        .attach('receipt', TINY_PNG, 'receipt.png')
        .expect(201);
      expect(attached.body.data.mimeType).toBe('image/png');

      const loan = await session.auth(request(app).get(`/api/loans/${loanId}`)).expect(200);
      expect(loan.body.data.receipt).toMatchObject({ mimeType: 'image/png' });

      const download = await session.auth(request(app).get(`/api/loans/${loanId}/receipt`)).expect(200);
      expect(download.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(download.body, TINY_PNG)).toBe(0);

      await session.auth(request(app).delete(`/api/loans/${loanId}/receipt`)).expect(204);
      await session.auth(request(app).get(`/api/loans/${loanId}/receipt`)).expect(404);
    });

    it('rejects a file whose bytes are not actually an image', async () => {
      const created = await create({ friendName: 'Ravi', amount: '500', dueDate: daysFromToday(1) }).expect(
        201,
      );

      const fakeImage = Buffer.from('<script>alert(1)</script>');
      const res = await session
        .auth(request(app).put(`/api/loans/${created.body.data.id}/receipt`))
        .attach('receipt', fakeImage, 'not-really.png')
        .expect(400);
      expect(res.body.error.code).toBe('bad_request');
    });

    it('replaces an existing receipt rather than stacking two', async () => {
      const created = await create({ friendName: 'Ravi', amount: '500', dueDate: daysFromToday(1) }).expect(
        201,
      );
      const loanId = created.body.data.id;

      const first = await session
        .auth(request(app).put(`/api/loans/${loanId}/receipt`))
        .attach('receipt', TINY_PNG, 'one.png')
        .expect(201);

      // "Replace" is an upsert keyed on loan_id (one receipt per loan), so the
      // row — and its id — is reused rather than a second row being created.
      const second = await session
        .auth(request(app).put(`/api/loans/${loanId}/receipt`))
        .attach('receipt', TINY_PNG, 'two.png')
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);

      const loan = await session.auth(request(app).get(`/api/loans/${loanId}`)).expect(200);
      expect(loan.body.data.receipt.id).toBe(first.body.data.id);

      // And the old file on disk was cleaned up, not orphaned — downloading
      // still works and returns the second upload's bytes.
      const download = await session.auth(request(app).get(`/api/loans/${loanId}/receipt`)).expect(200);
      expect(Buffer.compare(download.body, TINY_PNG)).toBe(0);
    });

    it('cannot be fetched by another user', async () => {
      const created = await create({ friendName: 'Ravi', amount: '500', dueDate: daysFromToday(1) }).expect(
        201,
      );
      await session
        .auth(request(app).put(`/api/loans/${created.body.data.id}/receipt`))
        .attach('receipt', TINY_PNG, 'receipt.png')
        .expect(201);

      const other = await signIn(app, '+917222222222');
      await other.auth(request(app).get(`/api/loans/${created.body.data.id}/receipt`)).expect(404);
    });
  });
});
