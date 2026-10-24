import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

const ISSUER = 'miniledger';
const AUDIENCE = 'miniledger-app';

export interface AccessTokenClaims {
  sub: string; // user id
  phone: string;
  typ: 'access'; // so a refresh token can't be replayed here as an access token
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
      // pin the algorithm explicitly — otherwise you're open to the classic
      // "alg: none" / HS-vs-RS confusion attack where the token itself gets
      // to pick how it's verified
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
