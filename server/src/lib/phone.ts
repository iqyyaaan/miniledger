/**
 * Phone numbers are the primary key of a user account, so two spellings of
 * the same number must not create two accounts. Everything is normalised to
 * E.164 (`+` followed by country code and national number) before it touches
 * the database.
 *
 * A production app would use libphonenumber-js for per-country length and
 * prefix rules. This is a deliberately small subset: enough to be correct for
 * the formats a user actually types, and small enough to reason about.
 */

export class PhoneParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneParseError';
  }
}

export function normalizePhone(input: unknown, defaultCountryCode = '+91'): string {
  if (typeof input !== 'string') throw new PhoneParseError('Phone number is required.');

  // Keep digits and a single leading '+'; drop spaces, dashes, parentheses.
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 0) throw new PhoneParseError('Phone number is required.');

  let e164: string;

  if (hasPlus) {
    e164 = `+${digits}`;
  } else if (digits.startsWith('00')) {
    // International access prefix, e.g. 0091 98765 43210.
    e164 = `+${digits.slice(2)}`;
  } else {
    const cc = defaultCountryCode.replace(/\D/g, '');
    // A national number may carry a trunk prefix ("0"), which E.164 drops.
    const national = digits.startsWith('0') ? digits.slice(1) : digits;
    e164 = national.startsWith(cc) && national.length > cc.length
      ? `+${national}`
      : `+${cc}${national}`;
  }

  const national = e164.slice(1);
  if (national.length < 8 || national.length > 15) {
    throw new PhoneParseError('Enter a valid phone number.');
  }
  if (national.startsWith('0')) {
    throw new PhoneParseError('Enter a valid phone number.');
  }

  return e164;
}

/** `+919876543210` -> `+91 98••• ••210`, for logs and "code sent to" copy. */
export function maskPhone(e164: string): string {
  if (e164.length <= 6) return e164;
  const head = e164.slice(0, 5);
  const tail = e164.slice(-3);
  return `${head}${'•'.repeat(Math.max(0, e164.length - 8))}${tail}`;
}
