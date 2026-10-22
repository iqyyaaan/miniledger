import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, pool } from './pool.js';
import { logger } from '../lib/logger.js';

/**
 * A deliberately small forward-only migration runner.
 *
 * Why hand-rolled rather than a library: the whole contract is "run each .sql
 * file in `migrations/` exactly once, in order, inside a transaction, and
 * record that you did". That is ~60 lines, and it keeps the schema as plain
 * SQL that anyone can read without learning a DSL.
 *
 * Two safety properties beyond "has it run":
 *   - A checksum is stored, so editing an already-applied migration is caught
 *     instead of silently diverging between machines.
 *   - A session-level advisory lock serialises concurrent runners, so two API
 *     instances booting at once cannot apply the same file twice.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const ADVISORY_LOCK_KEY = 4_171_983; // Arbitrary but fixed for this app.

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();

  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(): Promise<{ applied: string[] }> {
  await ensureMigrationsTable();

  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const alreadyApplied = new Map(rows.map((row) => [row.name, row.checksum]));
    const migrations = await loadMigrations();

    for (const migration of migrations) {
      const previousChecksum = alreadyApplied.get(migration.name);

      if (previousChecksum) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(
            `Migration "${migration.name}" has changed since it was applied. ` +
              'Migrations are immutable — add a new file instead of editing this one.',
          );
        }
        continue;
      }

      logger.info({ migration: migration.name }, 'Applying migration');
      // Each migration is all-or-nothing. Postgres supports transactional DDL,
      // so a failure halfway through leaves no partial schema behind.
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
        applied.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration "${migration.name}" failed: ${(error as Error).message}`,
          { cause: error },
        );
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    client.release();
  }

  return { applied };
}

async function status(): Promise<void> {
  await ensureMigrationsTable();
  const { rows } = await pool.query<{ name: string; applied_at: Date }>(
    'SELECT name, applied_at FROM schema_migrations ORDER BY name',
  );
  const appliedNames = new Set(rows.map((r) => r.name));
  const migrations = await loadMigrations();

  logger.info('Migration status:');
  for (const migration of migrations) {
    const mark = appliedNames.has(migration.name) ? '✔ applied' : '✖ pending';
    logger.info(`  ${mark}  ${migration.name}`);
  }
}

// CLI entrypoint: `npm run migrate` / `npm run migrate:status`.
const isDirectRun = process.argv[1]?.includes('migrate');
if (isDirectRun) {
  const command = process.argv[2] ?? 'up';
  try {
    if (command === 'status') {
      await status();
    } else {
      const { applied } = await runMigrations();
      logger.info(
        applied.length > 0
          ? `Applied ${applied.length} migration(s): ${applied.join(', ')}`
          : 'Database is already up to date.',
      );
    }
    await closePool();
  } catch (error) {
    logger.error({ err: error }, 'Migration failed');
    await closePool();
    process.exit(1);
  }
}
