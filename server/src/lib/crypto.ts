import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * OTPs and refresh tokens are stored as SHA-256 digests, never in plaintext.
 * If someone walks off with a database dump they get hashes, not live
 * credentials.
 *
 * SHA-256 (rather than bcrypt/argon2) is the right call *here* specifically
 * because both secrets are high-entropy and short-lived — a 6-digit OTP that
 * dies in 5 minutes after 5 attempts, and a 256-bit random refresh token.
 * There is no dictionary to attack. A user-chosen password would need a slow
 * KDF; these do not.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * A numeric OTP from a CSPRNG. `Math.random()` is predictable from a handful
 * of outputs, which for a login code is the whole ballgame.
 */
export function generateNumericOtp(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += randomInt(0, 10).toString();
  return code;
}

/** 256 bits of entropy, URL-safe. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Compare two hex digests without an early return, so an attacker cannot
 * learn how many leading characters they got right from response timing.
 */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
