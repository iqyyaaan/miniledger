import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { query, type SqlParam } from '../../db/pool.js';
import { encodeCursor } from '../../lib/cursor.js';

// either a PoolClient (when we're inside a transaction) or the plain query()
// helper — same .query() shape either way
interface Executor {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface LoanRow {
  id: string;
  friend_name: string;
  amount_minor: number;
  currency: string;
  due_date: string; // "YYYY-MM-DD" — DATE type parser lives in db/pool.ts
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
  order: 'asc' | 'desc'; // soonest-due first by default, i.e. the order you'd actually chase people in
  limit: number;
  cursor?: { dueDate: string; id: string };
  dueSoonDays: number;
}

// every query below reuses this fragment so is_overdue / days_until_due are
// computed in exactly one place. tried doing this in JS at first and it
// used the server process's timezone, which quietly disagreed with whatever
// the summary endpoint computed — moved it into SQL and that went away.
// assumes $1 = user id, $2/$3 = as-of date + timezone, same slots everywhere.
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
    // matches friend name or note. the % wrapping happens on the bound
    // value, not in the SQL text, so this stays parameterized
    const needle = push(`%${escapeLike(params.search)}%`);
    where.push(`(l.friend_name ILIKE ${needle} ESCAPE '\\' OR l.note ILIKE ${needle} ESCAPE '\\')`);
  }

  // keyset pagination, not OFFSET. OFFSET makes Postgres walk and throw away
  // every skipped row (page 50 is slower than page 1), and if a row gets
  // inserted mid-scroll everything shifts and the app shows a dupe.
  // comparing against the last-seen sort tuple avoids both and hits the
  // (user_id, due_date) index directly.
  const comparison = params.order === 'asc' ? '>' : '<';
  if (params.cursor) {
    const dueDateParam = push(params.cursor.dueDate);
    const idParam = push(params.cursor.id);
    where.push(`(l.due_date, l.id) ${comparison} (${dueDateParam}::date, ${idParam}::uuid)`);
  }

  const direction = params.order === 'asc' ? 'ASC' : 'DESC';
  const limitParam = push(params.limit + 1); // grab one extra row just to know if there's a next page

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

// client is optional — pass it when you're inside a transaction so the read
// hits the same connection instead of a fresh one from the pool. matters
// because Postgres won't show an uncommitted UPDATE to any other
// connection. markRepaid/markOutstanding write then re-read in one
// transaction, and without threading client through here the re-read
// silently came back with the pre-update row — found that the hard way.
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

  // re-read through LOAN_SELECT so what we return matches a listed row
  // exactly, derived fields and all, instead of hand-building a shape here
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

// the "AND status = 'outstanding'" is doing all the concurrency work here.
// two taps on "mark repaid" race each other, both fire this UPDATE, and
// Postgres guarantees only one actually matches a row — the other gets
// rowCount 0 and the service turns that into a 409 instead of quietly
// stomping on repaid_at a second time. no SELECT-then-UPDATE anywhere, so
// there's no lost-update window to begin with.
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

// the undo button, basically — for when you mis-tap "mark repaid"
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

// distinct friends this user has lent to, newest activity first — feeds the
// autocomplete on the add-entry form
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

// % and _ are LIKE wildcards — someone searching for a literal "50%" in a
// note shouldn't match everything
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
