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
  // A loan belonging to someone else is reported as "not found", not
  // "forbidden" — otherwise the 403 confirms that the id exists.
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

/**
 * Mark a loan repaid.
 *
 * Idempotency matters here more than anywhere else in the app: a flaky
 * connection means the app may well send this twice. The conditional UPDATE
 * guarantees only the first one takes effect; the second gets a 409 that the
 * app can treat as "already done" rather than a hard failure.
 */
export async function markRepaid(
  userId: string,
  loanId: string,
  asOf: string | null,
): Promise<LoanDto> {
  return withTransaction(async (client) => {
    const { updated } = await repo.markRepaid(client, userId, loanId, new Date());

    if (!updated) {
      // Distinguish "does not exist" from "already repaid" — different fixes.
      const exists = await repo.loanExists(userId, loanId);
      if (!exists) throw notFound('Loan');
      throw conflict('This entry is already marked as repaid.', { code: 'already_repaid' });
    }

    // Read via the same client: the UPDATE above has not committed yet, so a
    // fresh pool connection would not see it (see findLoanById's docstring).
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

/** Today, in the app's configured timezone, as `YYYY-MM-DD`. */
export function resolveToday(timezone = env.APP_TIMEZONE): string {
  // `en-CA` formats as YYYY-MM-DD, which saves hand-assembling the parts.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
