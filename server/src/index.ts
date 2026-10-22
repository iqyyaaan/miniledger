import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool, pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './lib/logger.js';
import { ensureUploadRoot } from './modules/receipts/receipts.service.js';

/**
 * Boot order is deliberate: prove the database is reachable, bring the schema
 * up to date, make sure the upload directory exists — and only then start
 * accepting traffic. Listening first would mean serving 500s during the
 * window before migrations finish.
 */
async function main(): Promise<void> {
  await pool.query('SELECT 1');
  logger.info('Connected to Postgres');

  const { applied } = await runMigrations();
  if (applied.length > 0) logger.info(`Applied ${applied.length} migration(s)`);

  await ensureUploadRoot();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      `MiniLedger API listening on http://localhost:${env.PORT}  ` +
        `(env=${env.NODE_ENV}, tz=${env.APP_TIMEZONE}, docs=/api/docs)`,
    );
  });

  // Node will not exit with a socket held open by a keep-alive connection;
  // these caps make sure idle clients are reaped.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  /**
   * Graceful shutdown: stop taking new connections, let in-flight requests
   * finish, then close the pool. Without this, a deploy can kill a request
   * mid-transaction. The 10s timer is the backstop for a connection that
   * refuses to drain.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async (error) => {
      if (error) logger.error({ err: error }, 'Error while closing HTTP server');
      await closePool().catch((err) => logger.error({ err }, 'Error closing database pool'));
      logger.info('Shutdown complete');
      process.exit(error ? 1 : 0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // A rejection nobody handled means state is unknown — log loudly and let
  // the supervisor restart us rather than limping on.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    void shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start MiniLedger API');
  process.exit(1);
});
