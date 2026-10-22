import { env } from '../../config/env.js';
import { query } from '../../db/pool.js';
import { formatMinorAsDecimal } from '../../lib/money.js';
import { DUE_SOON_DAYS, resolveToday } from '../loans/loans.service.js';

interface SummaryRow {
  as_of: string;
  total_lent_minor: number;
  total_repaid_minor: number;
  outstanding_minor: number;
  overdue_minor: number;
  due_soon_minor: number;
  total_count: number;
  repaid_count: number;
  outstanding_count: number;
  overdue_count: number;
  due_soon_count: number;
  friend_count: number;
  next_due_date: string | null;
  oldest_overdue_date: string | null;
}

interface FriendBreakdownRow {
  friend_name: string;
  outstanding_minor: number;
  overdue_minor: number;
  loan_count: number;
}

export interface Summary {
  asOf: string;
  currency: string;
  totals: {
    lentMinor: number;
    repaidMinor: number;
    outstandingMinor: number;
    overdueMinor: number;
    dueSoonMinor: number;
    lent: string;
    repaid: string;
    outstanding: string;
    overdue: string;
    dueSoon: string;
  };
  counts: {
    total: number;
    repaid: number;
    outstanding: number;
    overdue: number;
    dueSoon: number;
    friends: number;
  };
  /** 0–100. `null` when nothing has been lent, since 0/0 is not 0%. */
  repaidPercent: number | null;
  nextDueDate: string | null;
  oldestOverdueDate: string | null;
  dueSoonWindowDays: number;
  topDebtors: Array<{
    friendName: string;
    outstandingMinor: number;
    outstanding: string;
    overdueMinor: number;
    loanCount: number;
  }>;
}

/**
 * The whole summary is **one** query.
 *
 * The naive version fetches every loan and reduces in JavaScript, which means
 * transferring the entire table to compute five numbers and getting slower
 * with every entry added. Aggregate `FILTER` clauses let Postgres make a
 * single pass over the user's rows and return exactly eleven scalars —
 * constant payload, and the work happens where the data already is.
 *
 * `FILTER (WHERE ...)` is also why this is one pass rather than five
 * correlated subqueries, and it reads far closer to the business question
 * than `SUM(CASE WHEN ... THEN ... ELSE 0 END)` does.
 */
export async function getSummary(userId: string, asOf: string | null): Promise<Summary> {
  const params = [userId, asOf, env.APP_TIMEZONE, DUE_SOON_DAYS];

  const { rows } = await query<SummaryRow>(
    `
    WITH as_of AS (
      SELECT COALESCE($2::date, (now() AT TIME ZONE $3)::date) AS day
    )
    SELECT
      (SELECT day FROM as_of)::text AS as_of,

      COALESCE(SUM(l.amount_minor), 0)::bigint                              AS total_lent_minor,
      COALESCE(SUM(l.amount_minor) FILTER (WHERE l.status = 'repaid'), 0)::bigint
                                                                            AS total_repaid_minor,
      COALESCE(SUM(l.amount_minor) FILTER (WHERE l.status = 'outstanding'), 0)::bigint
                                                                            AS outstanding_minor,
      COALESCE(SUM(l.amount_minor) FILTER (
        WHERE l.status = 'outstanding' AND l.due_date < (SELECT day FROM as_of)
      ), 0)::bigint                                                         AS overdue_minor,
      COALESCE(SUM(l.amount_minor) FILTER (
        WHERE l.status = 'outstanding'
          AND l.due_date >= (SELECT day FROM as_of)
          AND l.due_date <= (SELECT day FROM as_of) + $4::int
      ), 0)::bigint                                                         AS due_soon_minor,

      COUNT(*)::int                                                         AS total_count,
      COUNT(*) FILTER (WHERE l.status = 'repaid')::int                      AS repaid_count,
      COUNT(*) FILTER (WHERE l.status = 'outstanding')::int                 AS outstanding_count,
      COUNT(*) FILTER (
        WHERE l.status = 'outstanding' AND l.due_date < (SELECT day FROM as_of)
      )::int                                                                AS overdue_count,
      COUNT(*) FILTER (
        WHERE l.status = 'outstanding'
          AND l.due_date >= (SELECT day FROM as_of)
          AND l.due_date <= (SELECT day FROM as_of) + $4::int
      )::int                                                                AS due_soon_count,
      COUNT(DISTINCT l.friend_key)::int                                     AS friend_count,

      MIN(l.due_date) FILTER (WHERE l.status = 'outstanding')::text         AS next_due_date,
      MIN(l.due_date) FILTER (
        WHERE l.status = 'outstanding' AND l.due_date < (SELECT day FROM as_of)
      )::text                                                               AS oldest_overdue_date
    FROM loans l
    WHERE l.user_id = $1
    `,
    params,
  );

  // An aggregate over zero rows still returns one row, so `rows[0]` is always
  // present — but the COALESCEs above are what make it all zeros rather than
  // a row full of NULLs.
  const row = rows[0] ?? {
    as_of: asOf ?? resolveToday(),
    total_lent_minor: 0,
    total_repaid_minor: 0,
    outstanding_minor: 0,
    overdue_minor: 0,
    due_soon_minor: 0,
    total_count: 0,
    repaid_count: 0,
    outstanding_count: 0,
    overdue_count: 0,
    due_soon_count: 0,
    friend_count: 0,
    next_due_date: null,
    oldest_overdue_date: null,
  };

  const topDebtors = await getTopDebtors(userId, asOf);
  const currency = env.DEFAULT_CURRENCY;

  return {
    asOf: row.as_of,
    currency,
    totals: {
      lentMinor: row.total_lent_minor,
      repaidMinor: row.total_repaid_minor,
      outstandingMinor: row.outstanding_minor,
      overdueMinor: row.overdue_minor,
      dueSoonMinor: row.due_soon_minor,
      lent: formatMinorAsDecimal(row.total_lent_minor, currency),
      repaid: formatMinorAsDecimal(row.total_repaid_minor, currency),
      outstanding: formatMinorAsDecimal(row.outstanding_minor, currency),
      overdue: formatMinorAsDecimal(row.overdue_minor, currency),
      dueSoon: formatMinorAsDecimal(row.due_soon_minor, currency),
    },
    counts: {
      total: row.total_count,
      repaid: row.repaid_count,
      outstanding: row.outstanding_count,
      overdue: row.overdue_count,
      dueSoon: row.due_soon_count,
      friends: row.friend_count,
    },
    repaidPercent:
      row.total_lent_minor > 0
        ? Math.round((row.total_repaid_minor / row.total_lent_minor) * 1000) / 10
        : null,
    nextDueDate: row.next_due_date,
    oldestOverdueDate: row.oldest_overdue_date,
    dueSoonWindowDays: DUE_SOON_DAYS,
    topDebtors,
  };
}

/** "Who owes you the most" — grouped on the generated `friend_key`, so
 *  "Ravi", "ravi" and "Ravi " are one person. */
async function getTopDebtors(userId: string, asOf: string | null) {
  const { rows } = await query<FriendBreakdownRow>(
    `
    SELECT
      (array_agg(l.friend_name ORDER BY l.created_at DESC))[1]              AS friend_name,
      SUM(l.amount_minor)::bigint                                          AS outstanding_minor,
      COALESCE(SUM(l.amount_minor) FILTER (
        WHERE l.due_date < COALESCE($2::date, (now() AT TIME ZONE $3)::date)
      ), 0)::bigint                                                        AS overdue_minor,
      COUNT(*)::int                                                        AS loan_count
    FROM loans l
    WHERE l.user_id = $1 AND l.status = 'outstanding'
    GROUP BY l.friend_key
    ORDER BY outstanding_minor DESC
    LIMIT 5
    `,
    [userId, asOf, env.APP_TIMEZONE],
  );

  return rows.map((row) => ({
    friendName: row.friend_name,
    outstandingMinor: row.outstanding_minor,
    outstanding: formatMinorAsDecimal(row.outstanding_minor, env.DEFAULT_CURRENCY),
    overdueMinor: row.overdue_minor,
    loanCount: row.loan_count,
  }));
}
