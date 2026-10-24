import { describe, expect, it } from 'vitest';
import { generateNumericOtp, generateOpaqueToken, safeEqualHex, sha256 } from '../../src/lib/crypto.js';
import { detectImageMime } from '../../src/lib/image-type.js';
import { decodeCursor, encodeCursor } from '../../src/lib/cursor.js';

describe('OTP generation', () => {
  it('produces exactly the requested number of digits', () => {
    for (const length of [4, 6, 8]) {
      const code = generateNumericOtp(length);
      expect(code).toMatch(new RegExp(`^\\d{${length}}$`));
    }
  });

  // a generator that never produces a leading zero is quietly throwing away
  // 10% of the keyspace (900k codes instead of 1M). over 20k samples, never
  // seeing one would be a pretty strong signal something's wrong.
  it('can emit a leading zero', () => {
    const codes = Array.from({ length: 20_000 }, () => generateNumericOtp(6));
    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
  });

  it('does not repeat in any realistic sample', () => {
    const codes = new Set(Array.from({ length: 5_000 }, () => generateNumericOtp(6)));
    // some birthday-paradox collisions are expected over 1M possibilities —
    // what this actually catches is a generator stuck returning one value
    expect(codes.size).toBeGreaterThan(4_000);
  });
});

describe('refresh tokens', () => {
  it('are long, URL-safe and unique', () => {
    const tokens = Array.from({ length: 1_000 }, () => generateOpaqueToken());
    expect(new Set(tokens).size).toBe(1_000);
    for (const token of tokens.slice(0, 20)) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(42); // 32 bytes, base64url-encoded
    }
  });
});

describe('safeEqualHex', () => {
  it('matches identical digests and rejects everything else', () => {
    const digest = sha256('123456');
    expect(safeEqualHex(digest, sha256('123456'))).toBe(true);
    expect(safeEqualHex(digest, sha256('123457'))).toBe(false);
  });

  it('returns false rather than throwing on malformed input', () => {
    // timingSafeEqual throws on a length mismatch — can't let a client
    // sending garbage take the whole process down
    expect(safeEqualHex(sha256('a'), 'abc')).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
    expect(safeEqualHex('zz', 'zz')).toBe(false);
  });
});

describe('detectImageMime', () => {
  const withHeader = (bytes: number[]): Buffer =>
    Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)]);

  it('identifies supported formats from their magic numbers', () => {
    expect(detectImageMime(withHeader([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageMime(withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(
      detectImageMime(
        Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]),
      ),
    ).toBe('image/webp');
    expect(
      detectImageMime(
        Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(16)]),
      ),
    ).toBe('image/heic');
  });

  // the attack this blocks: upload an SVG (or HTML) labeled image/png, then
  // get a victim's browser to load it from our origin and run the embedded
  // script. sniffing the actual bytes shuts that down at the door.
  it('rejects files that merely claim to be images', () => {
    expect(detectImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(detectImageMime(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(detectImageMime(Buffer.from('GIF89a' + '\0'.repeat(20)))).toBeNull(); // real image, just not one we support
    expect(detectImageMime(Buffer.from('%PDF-1.7' + '\0'.repeat(20)))).toBeNull();
    expect(detectImageMime(Buffer.alloc(4))).toBeNull(); // too short to tell anything
  });
});

describe('pagination cursors', () => {
  it('round-trip', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const decoded = decodeCursor(encodeCursor('2026-11-15', id));
    expect(decoded).toEqual({ dueDate: '2026-11-15', id });
  });

  // a cursor is attacker-controlled input that ends up in a SQL comparison.
  // it's parameterized regardless, but refusing to decode anything that
  // isn't exactly date|uuid means a malformed one turns into a clean 400
  // instead of a Postgres cast error surfacing as a 500.
  it('refuses anything that is not a date and a uuid', () => {
    expect(decodeCursor('not-base64!!')).toBeNull();
    expect(decodeCursor(Buffer.from('2026-11-15', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from("2026-11-15|' OR 1=1--", 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('15-11-2026|3f2504e0-4f89-11d3-9a0c-0305e82c3301').toString('base64url'))).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });
});
