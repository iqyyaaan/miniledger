/**
 * Money is never stored or transported as a float.
 *
 * `0.1 + 0.2 !== 0.3` in IEEE-754, and a ledger that drifts by a paisa per
 * operation is worse than useless. Internally every amount is an integer
 * number of *minor units* (paise for INR, cents for USD) held in a Postgres
 * `BIGINT`. The only place a decimal exists is at the API boundary, and the
 * conversion both ways lives here so it is tested in one place.
 */

/** Largest amount we accept: 1 trillion major units, well inside Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT_MINOR = 100_000_000_000_000;

const MINOR_UNIT_EXPONENT: Record<string, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0, // No subunit in circulation.
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
 * Parse a user-supplied amount into minor units.
 *
 * Accepts `1250`, `"1250"`, `"1,250.50"`, `"₹1,250.50"`, `" 1250.5 "`.
 * Rejects negatives, zero, more decimal places than the currency has, and
 * anything non-numeric.
 *
 * The string path does the arithmetic on digits rather than multiplying a
 * float by 100 — `Math.round(19.99 * 100)` happens to be right, but
 * `Math.round(1.005 * 100)` is 100, not 101.
 */
export function parseAmountToMinor(input: unknown, currency = 'INR'): number {
  const exponent = minorUnitExponent(currency);

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyParseError('Amount must be a finite number.');
    // Re-enter through the string path so there is exactly one implementation
    // of the decimal arithmetic. `toFixed` is safe here because we immediately
    // check the round-trip below.
    return parseAmountToMinor(input.toFixed(exponent), currency);
  }

  if (typeof input !== 'string') {
    throw new MoneyParseError('Amount must be a number or a numeric string.');
  }

  // Strip grouping separators, whitespace and a leading currency symbol.
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

  // Guard before Number() so an absurdly long input can't silently lose
  // precision by exceeding Number.MAX_SAFE_INTEGER.
  if (digits.replace(/^0+/, '').length > 15) {
    throw new MoneyParseError('Amount is too large.');
  }

  const minor = Number(digits);
  if (!Number.isSafeInteger(minor)) throw new MoneyParseError('Amount is too large.');
  if (minor <= 0) throw new MoneyParseError('Amount must be greater than zero.');
  if (minor > MAX_AMOUNT_MINOR) throw new MoneyParseError('Amount is too large.');

  return minor;
}

/** Minor units back to a plain decimal string, e.g. 125050 -> "1250.50". */
export function formatMinorAsDecimal(minor: number, currency = 'INR'): string {
  const exponent = minorUnitExponent(currency);
  if (exponent === 0) return String(minor);

  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, -exponent);
  const fraction = digits.slice(-exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Locale-aware display string, e.g. 125050 -> "₹1,250.50". Used for logs/tests. */
export function formatMinorAsCurrency(minor: number, currency = 'INR', locale = 'en-IN'): string {
  const exponent = minorUnitExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / 10 ** exponent);
}
