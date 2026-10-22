import { closePool, pool, withTransaction } from './pool.js';
import { runMigrations } from './migrate.js';
import { logger } from '../lib/logger.js';
import { parseAmountToMinor } from '../lib/money.js';
import { resolveToday } from '../modules/loans/loans.service.js';

/**
 * Seeds a demo account so the app has something to show on first run — and so
 * the summary card has overdue, due-soon and repaid entries to render rather
 * than five zeros.
 *
 * Due dates are relative to today, so the seed data stays meaningful no matter
 * when it is run.
 */
const DEMO_PHONE = '+919876543210';

interface SeedLoan {
  friendName: string;
  amount: string;
  /** Days from today. Negative = already overdue. */
  dueInDays: number;
  note?: string;
  repaid?: boolean;
}

const SEED_LOANS: SeedLoan[] = [
  { friendName: 'Ravi Menon', amount: '4500', dueInDays: -18, note: 'Concert tickets — split three ways' },
  { friendName: 'Ananya Rao', amount: '1250.50', dueInDays: -5, note: 'Cab to the airport' },
  { friendName: 'Ravi Menon', amount: '800', dueInDays: -2, note: 'Lunch at Koshy’s' },
  { friendName: 'Dev Patel', amount: '12000', dueInDays: 3, note: 'Deposit for the Goa trip' },
  { friendName: 'Ananya Rao', amount: '600', dueInDays: 6 },
  { friendName: 'Nisha Verma', amount: '3200', dueInDays: 21, note: 'Monitor — paying back monthly' },
  { friendName: 'Dev Patel', amount: '2500', dueInDays: 45, note: 'Birthday gift pool' },
  { friendName: 'Karthik Iyer', amount: '950', dueInDays: -30, note: 'Movie night', repaid: true },
  { friendName: 'Nisha Verma', amount: '7000', dueInDays: -12, note: 'Flight booking', repaid: true },
  { friendName: 'Ravi Menon', amount: '1500', dueInDays: -60, note: 'Groceries', repaid: true },
];

function dateFromToday(offsetDays: number): string {
  const today = new Date(`${resolveToday()}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() + offsetDays);
  return today.toISOString().slice(0, 10);
}

async function seed(): Promise<void> {
  await runMigrations();

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (phone, display_name)
       VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [DEMO_PHONE, 'Demo User'],
    );
    const userId = rows[0]!.id;

    // Re-running the seed should give the same result, not duplicates.
    const { rowCount } = await client.query('DELETE FROM loans WHERE user_id = $1', [userId]);
    if (rowCount) logger.info(`Cleared ${rowCount} existing demo loan(s)`);

    for (const loan of SEED_LOANS) {
      await client.query(
        `INSERT INTO loans (user_id, friend_name, amount_minor, due_date, note, status, repaid_at)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7)`,
        [
          userId,
          loan.friendName,
          parseAmountToMinor(loan.amount),
          dateFromToday(loan.dueInDays),
          loan.note ?? null,
          loan.repaid ? 'repaid' : 'outstanding',
          loan.repaid ? new Date() : null,
        ],
      );
    }

    logger.info(`Seeded ${SEED_LOANS.length} loans for ${DEMO_PHONE}`);
  });

  const { rows } = await pool.query<{ total: string; overdue: string }>(
    `SELECT
       COALESCE(SUM(amount_minor) FILTER (WHERE status = 'outstanding'), 0)::text AS total,
       COALESCE(SUM(amount_minor) FILTER (WHERE status = 'outstanding' AND due_date < CURRENT_DATE), 0)::text AS overdue
     FROM loans l
     JOIN users u ON u.id = l.user_id
     WHERE u.phone = $1`,
    [DEMO_PHONE],
  );

  logger.info(
    `Demo account ready — sign in as ${DEMO_PHONE} (outstanding ₹${
      Number(rows[0]?.total ?? 0) / 100
    }, overdue ₹${Number(rows[0]?.overdue ?? 0) / 100}). The OTP prints in this log when you request it.`,
  );
}

seed()
  .then(() => closePool())
  .catch(async (error) => {
    logger.error({ err: error }, 'Seed failed');
    await closePool();
    process.exit(1);
  });
