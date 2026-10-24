import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';

export interface AuthenticatedUser {
  id: string;
  phone: string;
}

// requires a valid "Authorization: Bearer <token>" header. no DB lookup
// here — the token's signed and short-lived (15 min), so checking the
// signature is enough to know who's calling. revocation happens at the
// refresh step instead, which just means a revoked session can keep
// working for at most one access-token lifetime, not forever.
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get('authorization');

  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('Missing bearer token.'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    next(unauthorized('Missing bearer token.'));
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    req.user = { id: claims.sub, phone: claims.phone };
    next();
  } catch (error) {
    next(error);
  }
}

// just a narrowing helper so route handlers don't have to write req.user! everywhere
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
