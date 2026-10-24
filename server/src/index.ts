import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool, pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './lib/logger.js';
import { ensureUploadRoot } from './modules/receipts/receipts.service.js';

// boot order matters here: check the DB is actually reachable, bring the
// schema up to date, make sure the upload dir exists, THEN start accepting
// traffic. listening first would mean serving 500s during the window
// before migrations have finished.
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

  // Node won't exit while a keep-alive socket is still sitting open —
  // these caps make sure idle clients eventually get reaped
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  // graceful shutdown: stop taking new connections, let in-flight requests
  // finish, then close the pool. without this a deploy could kill a
  // request mid-transaction. the 10s timer is just the backstop in case
  // something refuses to drain.
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

  // an unhandled rejection means we genuinely don't know what state we're
  // in anymore — log it loudly and let the process restart instead of
  // trying to limp along
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
