import type { AuthenticatedUser } from '../middleware/auth.js';

/**
 * Augments Express's `Request` with the authenticated user that `requireAuth`
 * attaches, so handlers get a real type instead of a cast.
 *
 * `req.id` is deliberately *not* declared here — `pino-http` already augments
 * `IncomingMessage` with it (as `ReqId`, which may be a number), and
 * redeclaring it as a string conflicts. `requestId()` in error-handler.ts
 * normalises it at the one place we need a string.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
