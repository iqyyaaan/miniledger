import { env } from '../../config/env.js';
import { withTransaction } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { decodeCursor } from '../../lib/cursor.js';
import { logger } from '../../lib/logger.js';
import * as repo from './loans.repository.js';
import { toLoanDto, type LoanDto } from './loans.serializer.js';

export const DUE_SOON_DAYS = 7;

export interface ListOptions {
  status: repo.LoanStatusFilter;
  search?: string;
  friend?: string;
  order: 'asc' | 'desc';
  limit: number;
  cursor?: string;
  asOf: string | null;
}

export async function listLoans(
  userId: string,
  options: ListOptions,
): Promise<{ data: LoanDto[]; nextCursor: string | null; asOf: string }> {
  let cursor: { dueDate: string; id: string } | undefined;

  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    if (!decoded) throw badRequest('That pagination cursor is not valid.');
    cursor = decoded;
  }

  const { rows, nextCursor } = await repo.listLoans({
    userId,
    status: options.status,
    search: options.search,
    friend: options.friend,
    asOf: options.asOf,
    timezone: env.APP_TIMEZONE,
    order: options.order,
    limit: options.limit,
    cursor,
    dueSoonDays: DUE_SOON_DAYS,
  });

  return {
    data: rows.map(toLoanDto),
    nextCursor,
    asOf: options.asOf ?? resolveToday(),
  };
}

export async function getLoan(userId: string, loanId: string, asOf: string | null): Promise<LoanDto> {
  const row = await repo.findLoanById(userId, loanId, asOf, env.APP_TIMEZONE);
  // a loan belonging to someone else comes back as "not found", not
  // "forbidden" — a 403 would confirm the id exists, just not to you
  if (!row) throw notFound('Loan');
  return toLoanDto(row);
}

export interface CreateLoanInput {
  friendName: string;
  amountMinor: number;
  dueDate: string;
  note: string | null;
  currency?: string;
}

export async function createLoan(
  userId: string,
  input: CreateLoanInput,
  asOf: string | null,
): Promise<LoanDto> {
  const row = await repo.insertLoan(
    userId,
    {
      friendName: input.friendName,
      amountMinor: input.amountMinor,
      currency: (input.currency ?? env.DEFAULT_CURRENCY).toUpperCase(),
      dueDate: input.dueDate,
      note: input.note,
    },
    asOf,
    env.APP_TIMEZONE,
  );

  logger.info({ userId, loanId: row.id, amountMinor: row.amount_minor }, 'Loan created');
  return toLoanDto(row);
}

export async function updateLoan(
  userId: string,
  loanId: string,
  patch: { friendName?: string; amountMinor?: number; dueDate?: string; note?: string | null },
  asOf: string | null,
): Promise<LoanDto> {
  const row = await repo.updateLoan(userId, loanId, patch, asOf, env.APP_TIMEZONE);
  if (!row) throw notFound('Loan');
  return toLoanDto(row);
}

// marking something repaid is where idempotency matters most in this app —
// a flaky connection on mobile means the client might genuinely send this
// twice. the conditional UPDATE in the repo guarantees only the first one
// actually takes effect; the second gets a 409 the app can read as "already
// done" instead of a hard failure.
export async function markRepaid(
  userId: string,
  loanId: string,
  asOf: string | null,
): Promise<LoanDto> {
  return withTransaction(async (client) => {
    const { updated } = await repo.markRepaid(client, userId, loanId, new Date());

    if (!updated) {
      // "doesn't exist" and "already repaid" need different responses, so
      // figure out which one actually happened
      const exists = await repo.loanExists(userId, loanId);
      if (!exists) throw notFound('Loan');
      throw conflict('This entry is already marked as repaid.', { code: 'already_repaid' });
    }

    // has to go through `client`, not a fresh connection — the UPDATE above
    // hasn't committed yet (see the comment on findLoanById for why)
    const row = await repo.findLoanById(userId, loanId, asOf, env.APP_TIMEZONE, client);
    if (!row) throw notFound('Loan');

    logger.info({ userId, loanId }, 'Loan marked repaid');
    return toLoanDto(row);
  });
}

export async function markOutstanding(
  userId: string,
  loanId: string,
  asOf: string | null,
): Promise<LoanDto> {
  return withTransaction(async (client) => {
    const { updated } = await repo.markOutstanding(client, userId, loanId);

    if (!updated) {
      const exists = await repo.loanExists(userId, loanId);
      if (!exists) throw notFound('Loan');
      throw conflict('This entry is already outstanding.', { code: 'already_outstanding' });
    }

    const row = await repo.findLoanById(userId, loanId, asOf, env.APP_TIMEZONE, client);
    if (!row) throw notFound('Loan');
    return toLoanDto(row);
  });
}

export async function deleteLoan(userId: string, loanId: string): Promise<void> {
  const deleted = await repo.deleteLoan(userId, loanId);
  if (!deleted) throw notFound('Loan');
  logger.info({ userId, loanId }, 'Loan deleted');
}

export async function listFriends(userId: string, limit = 50) {
  return repo.listFriendNames(userId, limit);
}

// "today" in the app's configured timezone, as YYYY-MM-DD
export function resolveToday(timezone = env.APP_TIMEZONE): string {
  // en-CA happens to format dates as YYYY-MM-DD, saves hand-assembling it
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
