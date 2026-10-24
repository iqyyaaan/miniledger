// Everything here works in integer minor units (paise for INR), never floats.
// 0.1 + 0.2 !== 0.3 in JS, and a ledger that's off by a paisa after enough
// operations is a real bug, not a rounding footnote. Amounts live as BIGINT
// in Postgres; the only spot a decimal exists is at the API boundary, which
// is why the conversion is centralized here instead of scattered around.

/** 1 trillion major units — comfortably under Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT_MINOR = 100_000_000_000_000;

const MINOR_UNIT_EXPONENT: Record<string, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0, // yen has no subunit
  KWD: 3,
};

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[currency.toUpperCase()] ?? 2;
}

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyParseError';
  }
}

/**
 * Turns whatever a user typed — "1250", "1,250.50", "₹1,250.50" — into
 * integer minor units. Rejects negatives, zero, and too many decimal places.
 *
 * Does the math on the digit string instead of `Math.round(x * 100)`.
 * That trick looks fine until you hit something like 1.005, where
 * `1.005 * 100` is actually 100.49999999999999 under the hood and rounds
 * down to 100 instead of 101. Not worth the risk on a ledger.
 */
export function parseAmountToMinor(input: unknown, currency = 'INR'): number {
  const exponent = minorUnitExponent(currency);

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyParseError('Amount must be a finite number.');
    // toFixed then re-parse as a string so there's one code path for the
    // actual decimal handling, not two slightly-different ones.
    return parseAmountToMinor(input.toFixed(exponent), currency);
  }

  if (typeof input !== 'string') {
    throw new MoneyParseError('Amount must be a number or a numeric string.');
  }

  // strip thousands separators, whitespace, currency symbol prefix
  const cleaned = input.trim().replace(/[\s,]/g, '').replace(/^[^\d.-]+/, '');

  if (cleaned === '') throw new MoneyParseError('Amount is required.');

  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) throw new MoneyParseError(`"${input}" is not a valid amount.`);

  const [, sign, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') {
    throw new MoneyParseError(`"${input}" is not a valid amount.`);
  }
  if (sign === '-') throw new MoneyParseError('Amount must be greater than zero.');
  if (fraction.length > exponent) {
    throw new MoneyParseError(
      exponent === 0
        ? `${currency} amounts cannot have decimal places.`
        : `Amount cannot have more than ${exponent} decimal places.`,
    );
  }

  const paddedFraction = fraction.padEnd(exponent, '0');
  const digits = `${whole || '0'}${paddedFraction}`;

  // someone could type 50 zeroes and overflow Number() silently, so bail
  // before that rather than trust isSafeInteger to catch everything
  if (digits.replace(/^0+/, '').length > 15) {
    throw new MoneyParseError('Amount is too large.');
  }

  const minor = Number(digits);
  if (!Number.isSafeInteger(minor)) throw new MoneyParseError('Amount is too large.');
  if (minor <= 0) throw new MoneyParseError('Amount must be greater than zero.');
  if (minor > MAX_AMOUNT_MINOR) throw new MoneyParseError('Amount is too large.');

  return minor;
}

// 125050 -> "1250.50"
export function formatMinorAsDecimal(minor: number, currency = 'INR'): string {
  const exponent = minorUnitExponent(currency);
  if (exponent === 0) return String(minor);

  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, -exponent);
  const fraction = digits.slice(-exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

// 125050 -> "₹1,250.50" — mainly for logs and test assertions, the app does
// its own formatting client-side.
export function formatMinorAsCurrency(minor: number, currency = 'INR', locale = 'en-IN'): string {
  const exponent = minorUnitExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / 10 ** exponent);
}
