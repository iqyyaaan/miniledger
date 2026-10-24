// Phone number is basically the primary key of an account, so two
// spellings of the same number can't be allowed to create two accounts.
// everything gets normalized to E.164 (+countrycode + national number)
// before it ever touches the DB.
//
// a real production app would reach for libphonenumber-js for proper
// per-country rules. this is the cut-down version — handles the formats
// someone actually types in, nothing fancier.

export class PhoneParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneParseError';
  }
}

export function normalizePhone(input: unknown, defaultCountryCode = '+91'): string {
  if (typeof input !== 'string') throw new PhoneParseError('Phone number is required.');

  // just keep the digits (and whether there was a leading +) — spaces,
  // dashes, parens all go
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 0) throw new PhoneParseError('Phone number is required.');

  let e164: string;

  if (hasPlus) {
    e164 = `+${digits}`;
  } else if (digits.startsWith('00')) {
    // international access prefix, like "0091 98765 43210"
    e164 = `+${digits.slice(2)}`;
  } else {
    const cc = defaultCountryCode.replace(/\D/g, '');
    // national numbers sometimes carry a trunk "0" (e.g. "098765...") that
    // E.164 doesn't want
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

// +919876543210 -> +9198•••••210, for logs and "code sent to" messages
export function maskPhone(e164: string): string {
  if (e164.length <= 6) return e164;
  const head = e164.slice(0, 5);
  const tail = e164.slice(-3);
  return `${head}${'•'.repeat(Math.max(0, e164.length - 8))}${tail}`;
}
