import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

const ISSUER = 'miniledger';
const AUDIENCE = 'miniledger-app';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  phone: string;
  /** Token type, so a refresh token can never be replayed as an access token. */
  typ: 'access';
}

export function signAccessToken(userId: string, phone: string): { token: string; expiresIn: number } {
  const expiresIn = env.ACCESS_TOKEN_TTL_MIN * 60;
  const token = jwt.sign({ phone, typ: 'access' } satisfies Omit<AccessTokenClaims, 'sub'>, env.JWT_SECRET, {
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn,
    algorithm: 'HS256',
  });
  return { token, expiresIn };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
      // Pinning the algorithm closes the "alg: none" / HS-vs-RS confusion class
      // of attacks, where the attacker picks how their token gets verified.
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;

    if (payload.typ !== 'access' || typeof payload.sub !== 'string') {
      throw unauthorized('Invalid access token.');
    }
    return { sub: payload.sub, phone: String(payload.phone ?? ''), typ: 'access' };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw unauthorized('Your session has expired. Please sign in again.');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw unauthorized('Invalid access token.');
    }
    throw error;
  }
}
