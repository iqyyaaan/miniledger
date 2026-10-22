import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhone, PhoneParseError } from '../../src/lib/phone.js';

describe('normalizePhone', () => {
  /**
   * The point of normalising: every one of these is the same human, and must
   * resolve to one account rather than six.
   */
  it('maps every spelling of one number to the same E.164 string', () => {
    const variants = [
      '9876543210',
      '98765 43210',
      '98765-43210',
      '+91 98765 43210',
      '+919876543210',
      '09876543210',
      '0091 9876543210',
      '(98765) 43210',
    ];

    const normalized = new Set(variants.map((v) => normalizePhone(v, '+91')));
    expect(normalized).toEqual(new Set(['+919876543210']));
  });

  it('keeps an explicit country code that is not the default', () => {
    expect(normalizePhone('+1 415 555 0132', '+91')).toBe('+14155550132');
    expect(normalizePhone('+44 20 7946 0958', '+91')).toBe('+442079460958');
  });

  it('applies the default country code to a bare national number', () => {
    expect(normalizePhone('5551234567', '+1')).toBe('+15551234567');
  });

  it.each(['', '   ', 'not a phone', '123', '+0123456789', '1'.repeat(20)])(
    'rejects %j',
    (input) => {
      expect(() => normalizePhone(input, '+91')).toThrow(PhoneParseError);
    },
  );

  it('rejects non-string input', () => {
    expect(() => normalizePhone(null)).toThrow(PhoneParseError);
    expect(() => normalizePhone(9876543210 as unknown)).toThrow(PhoneParseError);
  });
});

describe('maskPhone', () => {
  it('leaves only the country code and last three digits', () => {
    const masked = maskPhone('+919876543210');
    expect(masked.startsWith('+9198')).toBe(true);
    expect(masked.endsWith('210')).toBe(true);
    expect(masked).not.toContain('76543');
  });
});
