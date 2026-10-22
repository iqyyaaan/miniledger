/**
 * Client-side mirror of the server's `lib/money.ts`.
 *
 * The server is the source of truth for every stored amount, but the app
 * still needs to: (a) validate what a user typed *before* firing a network
 * request, so a bad amount fails instantly instead of round-tripping to the
 * API, and (b) format `amountMinor` for display without ever routing it
 * through a float. Keeping the same integer-minor-units approach on both
 * sides means a number never has two different "correct" values depending on
 * which side computed it.
 */

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyParseError';
  }
}

const EXPONENT_BY_CURRENCY: Record<string, number> = { INR: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 };

function exponentFor(currency: string): number {
  return EXPONENT_BY_CURRENCY[currency.toUpperCase()] ?? 2;
}

/** Same digit-string arithmetic as the server — never `parseFloat(x) * 100`. */
export function parseAmountToMinor(input: string, currency = 'INR'): number {
  const exponent = exponentFor(currency);
  const cleaned = input.trim().replace(/[\s,]/g, '').replace(/^[^\d.-]+/, '');

  if (cleaned === '') throw new MoneyParseError('Enter an amount.');

  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) throw new MoneyParseError('Enter a valid amount.');

  const [, sign, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') throw new MoneyParseError('Enter a valid amount.');
  if (sign === '-') throw new MoneyParseError('Amount must be greater than zero.');
  if (fraction.length > exponent) {
    throw new MoneyParseError(
      exponent === 0
        ? `${currency} amounts cannot have decimal places.`
        : `Amount cannot have more than ${exponent} decimal places.`,
    );
  }

  const digits = `${whole || '0'}${fraction.padEnd(exponent, '0')}`;
  const minor = Number(digits);
  if (!Number.isSafeInteger(minor)) throw new MoneyParseError('Amount is too large.');
  if (minor <= 0) throw new MoneyParseError('Amount must be greater than zero.');

  return minor;
}

/** Non-throwing version for inline form validation. */
export function tryParseAmountToMinor(input: string, currency = 'INR'): number | null {
  try {
    return parseAmountToMinor(input, currency);
  } catch {
    return null;
  }
}

export function formatMinorAsDecimal(minor: number, currency = 'INR'): string {
  const exponent = exponentFor(currency);
  if (exponent === 0) return String(minor);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, -exponent);
  const fraction = digits.slice(-exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

/** `125050 -> "₹1,250.50"`. Formatters are expensive to construct, so reuse them. */
export function formatMinorAsCurrency(minor: number, currency = 'INR', locale = 'en-IN'): string {
  const key = `${locale}:${currency}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exponentFor(currency),
      maximumFractionDigits: exponentFor(currency),
    });
    formatterCache.set(key, formatter);
  }
  return formatter.format(minor / 10 ** exponentFor(currency));
}
