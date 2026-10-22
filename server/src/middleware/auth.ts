import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';

export interface AuthenticatedUser {
  id: string;
  phone: string;
}

/**
 * Requires a valid `Authorization: Bearer <access token>` header.
 *
 * No database round-trip: the token is signed and short-lived (15 min), so
 * verifying the signature is enough to establish identity. Revocation is
 * handled at the refresh step, which bounds how long a revoked session can
 * keep working to one access-token lifetime.
 */
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

/** Narrowing helper so handlers don't need `req.user!` everywhere. */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
