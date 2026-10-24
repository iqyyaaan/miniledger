import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// OTPs and refresh tokens get stored as SHA-256 digests, never plaintext —
// if someone dumps the DB they get hashes, not usable credentials.
//
// SHA-256 instead of bcrypt/argon2 is fine here specifically because both
// secrets are high-entropy and short-lived: a 6-digit code that's dead in
// 5 minutes (and after 5 wrong guesses), or a 256-bit random token. nothing
// to brute-force offline with a dictionary. a user's password would need a
// slow KDF — this doesn't.
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// numeric OTP via a CSPRNG. Math.random() is predictable enough from a
// handful of outputs that it'd defeat the whole point of a login code.
export function generateNumericOtp(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += randomInt(0, 10).toString();
  return code;
}

// 256 bits, URL-safe
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

// compares two hex digests in constant time so response timing can't leak
// how many leading characters an attacker got right
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
