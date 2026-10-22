import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { query, type SqlParam } from '../../db/pool.js';
import { encodeCursor } from '../../lib/cursor.js';

/** Either a `PoolClient` (inside a transaction) or the module-level `query` helper. */
interface Executor {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface LoanRow {
  id: string;
  friend_name: string;
  amount_minor: number;
  currency: string;
  due_date: string; // YYYY-MM-DD — see the DATE type parser in db/pool.ts.
  note: string | null;
  status: 'outstanding' | 'repaid';
  repaid_at: Date | null;
  created_at: Date;
  updated_at: Date;
  is_overdue: boolean;
  days_until_due: number;
  receipt_id: string | null;
  receipt_mime_type: string | null;
  receipt_size_bytes: number | null;
}

export type LoanStatusFilter = 'all' | 'outstanding' | 'repaid' | 'overdue' | 'due_soon';

export interface ListLoansParams {
  userId: string;
  status: LoanStatusFilter;
  search?: string;
  friend?: string;
  asOf: string | null;
  timezone: string;
  /** Soonest-due first by default — the order a lender actually chases people in. */
  order: 'asc' | 'desc';
  limit: number;
  cursor?: { dueDate: string; id: string };
  dueSoonDays: number;
}

/**
 * Every projection of a loan goes through this fragment, so `isOverdue` and
 * `daysUntilDue` are computed by exactly one piece of SQL. The alternative —
 * computing them in JS — would use the *server process* timezone and quietly
 * disagree with the summary endpoint.
 *
 * `$1` is the user id and `$2`/`$3` are the as-of date and timezone in every
 * query below, so the fragment can assume those positions.
 */
const LOAN_SELECT = `
  SELECT
    l.id,
    l.friend_name,
    l.amount_minor,
    l.currency,
    l.due_date,
    l.note,
    l.status,
    l.repaid_at,
    l.created_at,
    l.updated_at,
    (l.status = 'outstanding' AND l.due_date < as_of.day)      AS is_overdue,
    (l.due_date - as_of.day)                                   AS days_until_due,
    r.id            AS receipt_id,
    r.mime_type     AS receipt_mime_type,
    r.size_bytes    AS receipt_size_bytes
  FROM loans l
  LEFT JOIN receipts r ON r.loan_id = l.id
  CROSS JOIN LATERAL (
    SELECT COALESCE($2::date, (now() AT TIME ZONE $3)::date) AS day
  ) AS as_of
`;

export async function listLoans(
  params: ListLoansParams,
): Promise<{ rows: LoanRow[]; nextCursor: string | null }> {
  const values: SqlParam[] = [params.userId, params.asOf, params.timezone];
  const where: string[] = ['l.user_id = $1'];

  const push = (value: SqlParam): string => {
    values.push(value);
    return `$${values.length}`;
  };

  switch (params.status) {
    case 'outstanding':
      where.push(`l.status = 'outstanding'`);
      break;
    case 'repaid':
      where.push(`l.status = 'repaid'`);
      break;
    case 'overdue':
      where.push(`l.status = 'outstanding' AND l.due_date < as_of.day`);
      break;
    case 'due_soon':
      where.push(
        `l.status = 'outstanding' AND l.due_date >= as_of.day AND l.due_date <= as_of.day + ${push(
          params.dueSoonDays,
        )}::int`,
      );
      break;
    case 'all':
    default:
      break;
  }

  if (params.friend) {
    where.push(`l.friend_key = lower(btrim(${push(params.friend)}))`);
  }

  if (params.search) {
    // Matches a friend's name or the note. Parameterised, so the `%` wrapping
    // happens in the value and never in the SQL string.
    const needle = push(`%${escapeLike(params.search)}%`);
    where.push(`(l.friend_name ILIKE ${needle} ESCAPE '\\' OR l.note ILIKE ${needle} ESCAPE '\\')`);
  }

  /**
   * Keyset ("seek") pagination rather than OFFSET. OFFSET makes the database
   * walk and discard every skipped row, so page 50 is slower than page 1, and
   * a row inserted mid-scroll shifts everything down by one and makes the app
   * show a duplicate. Comparing the sort tuple against the last row seen has
   * neither problem and uses the (user_id, due_date) index directly.
   */
  const comparison = params.order === 'asc' ? '>' : '<';
  if (params.cursor) {
    const dueDateParam = push(params.cursor.dueDate);
    const idParam = push(params.cursor.id);
    where.push(`(l.due_date, l.id) ${comparison} (${dueDateParam}::date, ${idParam}::uuid)`);
  }

  const direction = params.order === 'asc' ? 'ASC' : 'DESC';
  const limitParam = push(params.limit + 1); // Fetch one extra to detect "has more".

  const sql = `
    ${LOAN_SELECT}
    WHERE ${where.join(' AND ')}
    ORDER BY l.due_date ${direction}, l.id ${direction}
    LIMIT ${limitParam}
  `;

  const { rows } = await query<LoanRow>(sql, values);

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const last = page[page.length - 1];

  return {
    rows: page,
    nextCursor: hasMore && last ? encodeCursor(last.due_date, last.id) : null,
  };
}

/**
 * `client` is optional and, when passed, the read runs on that same checked-
 * out connection instead of grabbing a fresh one from the pool.
 *
 * That matters inside a transaction: Postgres's MVCC means an uncommitted
 * UPDATE is invisible to any *other* connection, pool-borrowed ones included.
 * `markRepaid`/`markOutstanding` mutate and then re-read within one
 * transaction — without passing `client` through, the re-read would silently
 * see the pre-mutation row.
 */
export async function findLoanById(
  userId: string,
  loanId: string,
  asOf: string | null,
  timezone: string,
  client?: PoolClient,
): Promise<LoanRow | null> {
  const executor: Executor = client ?? { query };
  const { rows } = await executor.query<LoanRow>(
    `${LOAN_SELECT} WHERE l.user_id = $1 AND l.id = $4::uuid`,
    [userId, asOf, timezone, loanId],
  );
  return rows[0] ?? null;
}

export async function insertLoan(
  userId: string,
  input: {
    friendName: string;
    amountMinor: number;
    currency: string;
    dueDate: string;
    note: string | null;
  },
  asOf: string | null,
  timezone: string,
): Promise<LoanRow> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO loans (user_id, friend_name, amount_minor, currency, due_date, note)
     VALUES ($1, $2, $3, $4, $5::date, $6)
     RETURNING id`,
    [userId, input.friendName, input.amountMinor, input.currency, input.dueDate, input.note],
  );

  // Re-read through LOAN_SELECT so a created loan is byte-identical in shape
  // to a listed one, including the derived overdue fields.
  return (await findLoanById(userId, rows[0]!.id, asOf, timezone))!;
}

export async function updateLoan(
  userId: string,
  loanId: string,
  patch: {
    friendName?: string;
    amountMinor?: number;
    dueDate?: string;
    note?: string | null;
  },
  asOf: string | null,
  timezone: string,
): Promise<LoanRow | null> {
  const sets: string[] = [];
  const values: SqlParam[] = [userId, loanId];

  const push = (value: SqlParam): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (patch.friendName !== undefined) sets.push(`friend_name = ${push(patch.friendName)}`);
  if (patch.amountMinor !== undefined) sets.push(`amount_minor = ${push(patch.amountMinor)}`);
  if (patch.dueDate !== undefined) sets.push(`due_date = ${push(patch.dueDate)}::date`);
  if (patch.note !== undefined) sets.push(`note = ${push(patch.note)}`);

  if (sets.length === 0) return findLoanById(userId, loanId, asOf, timezone);

  const { rowCount } = await query(
    `UPDATE loans SET ${sets.join(', ')} WHERE user_id = $1 AND id = $2::uuid`,
    values,
  );
  if (rowCount === 0) return null;

  return findLoanById(userId, loanId, asOf, timezone);
}

/**
 * Flip a loan to repaid.
 *
 * The `AND status = 'outstanding'` in the WHERE clause is the whole
 * concurrency story: two taps on "Mark repaid" race, both run this UPDATE,
 * and Postgres guarantees exactly one matches a row. The loser gets
 * `rowCount = 0` and the service turns that into a 409 rather than silently
 * overwriting `repaid_at`. No SELECT-then-UPDATE, so no lost update.
 */
export async function markRepaid(
  client: PoolClient,
  userId: string,
  loanId: string,
  repaidAt: Date,
): Promise<{ updated: boolean }> {
  const { rowCount } = await client.query(
    `UPDATE loans
        SET status = 'repaid', repaid_at = $3
      WHERE user_id = $1 AND id = $2::uuid AND status = 'outstanding'`,
    [userId, loanId, repaidAt],
  );
  return { updated: (rowCount ?? 0) > 0 };
}

/** The symmetric undo, so a mis-tap is recoverable. */
export async function markOutstanding(
  client: PoolClient,
  userId: string,
  loanId: string,
): Promise<{ updated: boolean }> {
  const { rowCount } = await client.query(
    `UPDATE loans
        SET status = 'outstanding', repaid_at = NULL
      WHERE user_id = $1 AND id = $2::uuid AND status = 'repaid'`,
    [userId, loanId],
  );
  return { updated: (rowCount ?? 0) > 0 };
}

export async function loanExists(userId: string, loanId: string): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM loans WHERE user_id = $1 AND id = $2::uuid) AS exists',
    [userId, loanId],
  );
  return rows[0]?.exists ?? false;
}

export async function deleteLoan(userId: string, loanId: string): Promise<boolean> {
  const { rowCount } = await query('DELETE FROM loans WHERE user_id = $1 AND id = $2::uuid', [
    userId,
    loanId,
  ]);
  return (rowCount ?? 0) > 0;
}

/** Distinct friends this user has lent to, newest activity first — autocomplete. */
export async function listFriendNames(userId: string, limit: number): Promise<
  Array<{ name: string; loanCount: number; outstandingMinor: number }>
> {
  const { rows } = await query<{
    name: string;
    loan_count: number;
    outstanding_minor: number;
  }>(
    `SELECT
        (array_agg(friend_name ORDER BY created_at DESC))[1] AS name,
        count(*)::int                                        AS loan_count,
        COALESCE(sum(amount_minor) FILTER (WHERE status = 'outstanding'), 0) AS outstanding_minor
       FROM loans
      WHERE user_id = $1
      GROUP BY friend_key
      ORDER BY max(created_at) DESC
      LIMIT $2`,
    [userId, limit],
  );

  return rows.map((row) => ({
    name: row.name,
    loanCount: row.loan_count,
    outstandingMinor: row.outstanding_minor,
  }));
}

/** `%` and `_` are wildcards in LIKE; a user searching for "50%" means literally that. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
