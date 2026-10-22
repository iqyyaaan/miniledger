import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const { Pool, types } = pg;

/**
 * node-postgres hands back `BIGINT` (oid 20) as a *string* by default, because
 * a 64-bit integer does not always fit in a JS number. Our amounts are capped
 * well below Number.MAX_SAFE_INTEGER (see lib/money.ts), so parsing to a
 * number here keeps the rest of the codebase free of string-vs-number checks.
 */
types.setTypeParser(types.builtins.INT8, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`BIGINT ${value} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return parsed;
});

/**
 * `DATE` (oid 1082) is a calendar day with no time and no zone. The default
 * parser turns it into a JS Date at local midnight, which then shifts by a day
 * the moment it is serialised to UTC. Keeping it as the raw `YYYY-MM-DD`
 * string is both correct and exactly what the API returns.
 */
types.setTypeParser(types.builtins.DATE, (value) => value);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  // An idle client blew up (network drop, server restart). The pool evicts it;
  // we just need to not crash the process.
  logger.error({ err: error }, 'Unexpected error on idle Postgres client');
});

export type SqlParam = string | number | boolean | Date | null | undefined | string[];

/** Thin wrapper so every query goes through one place that can log timings. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: SqlParam[] = [],
): Promise<pg.QueryResult<T>> {
  const startedAt = performance.now();
  try {
    return await pool.query<T>(text, params as unknown[]);
  } finally {
    const durationMs = performance.now() - startedAt;
    if (durationMs > 200) {
      logger.warn({ durationMs: Math.round(durationMs), sql: text.trim().slice(0, 120) }, 'Slow query');
    }
  }
}

/**
 * Run a set of statements in a transaction on a single checked-out client.
 * Rolls back on any throw, and always returns the client to the pool.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
