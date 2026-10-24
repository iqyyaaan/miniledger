import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const { Pool, types } = pg;

// node-postgres returns BIGINT (oid 20) as a string by default since a
// 64-bit int doesn't always fit in a JS number. our amounts are capped well
// under Number.MAX_SAFE_INTEGER anyway (see lib/money.ts), so just parse it
// to a number here instead of having string-vs-number checks everywhere
types.setTypeParser(types.builtins.INT8, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`BIGINT ${value} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return parsed;
});

// DATE (oid 1082) is a calendar day, no time, no timezone. the default
// parser turns it into a JS Date at local midnight, which then shifts by a
// day the second it gets serialized to UTC — annoying bug to chase down.
// keeping it as the raw "YYYY-MM-DD" string sidesteps all of that and
// happens to be exactly what the API wants to return anyway.
types.setTypeParser(types.builtins.DATE, (value) => value);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  // an idle client died on us (network blip, server restart, whatever) —
  // the pool evicts it on its own, we just need to not let this crash the process
  logger.error({ err: error }, 'Unexpected error on idle Postgres client');
});

export type SqlParam = string | number | boolean | Date | null | undefined | string[];

// thin wrapper so every query goes through one spot that can log slow ones
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

// runs a set of statements as a transaction on one checked-out client.
// rolls back on any throw, always releases the client back to the pool.
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
