import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { loansRouter } from './modules/loans/loans.routes.js';
import { summaryRouter } from './modules/summary/summary.routes.js';
import { docsRouter } from './docs/docs.routes.js';

export function createApp(): Express {
  const app = express();

  /**
   * In development the API is reached over the LAN from a phone, so the
   * client IP arrives via a proxy header in some setups. Trusting exactly one
   * hop is the safe default: trusting all hops would let a client spoof
   * `X-Forwarded-For` and sidestep the per-IP rate limits.
   */
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON and images, never HTML that embeds third-party
      // script — except the docs page, which sets its own policy.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: false,
      maxAge: 86_400,
    }),
  );

  // One id per request, echoed in the response header and every error body, so
  // a user can quote it and we can find the exact log line.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Health checks would otherwise drown out anything interesting.
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/api/health' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  app.get('/api/health', async (_req, res) => {
    // A health check that does not touch the database is close to useless —
    // the process being alive is not the same as the service working.
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ok', database: 'up', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  app.use('/api/docs', docsRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/loans', loansRouter);
  app.use('/api/summary', summaryRouter);

  // -------------------------------------------------------------------------
  // Fallbacks — order matters: 404 first, then the error handler last.
  // -------------------------------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
