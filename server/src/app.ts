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

  // in dev the API gets hit over the LAN from a phone, so the client IP can
  // arrive via a proxy header depending on setup. trusting exactly one hop
  // is the safe default here — trusting all of them would let a client
  // just spoof X-Forwarded-For and dodge the per-IP rate limits
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // this API only serves JSON and images, no HTML embedding third-party
      // script — except the docs page, which handles its own CSP
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

  // one id per request, echoed back in the response header and in every
  // error body — lets someone quote it and we can go straight to the log line
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // otherwise health checks drown out anything actually worth seeing
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
    // a health check that doesn't touch the DB isn't telling you much — the
    // process being alive and the service actually working aren't the same thing
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
  // fallbacks — order matters here: 404 first, error handler last
  // -------------------------------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
