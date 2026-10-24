import type { AuthenticatedUser } from '../middleware/auth.js';

// augments Express's Request with the user that requireAuth attaches, so
// handlers get a real type instead of casting everywhere.
//
// req.id is deliberately left out of here — pino-http already augments
// IncomingMessage with it as ReqId (string | number | object), and
// redeclaring it as a plain string conflicts. requestId() in
// error-handler.ts normalizes it at the one spot that actually needs a string.
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
