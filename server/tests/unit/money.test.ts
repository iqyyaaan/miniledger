import { describe, expect, it } from 'vitest';
import {
  formatMinorAsCurrency,
  formatMinorAsDecimal,
  MoneyParseError,
  parseAmountToMinor,
} from '../../src/lib/money.js';

describe('parseAmountToMinor', () => {
  it('converts whole rupees to paise', () => {
    expect(parseAmountToMinor('1500')).toBe(150_000);
    expect(parseAmountToMinor(1500)).toBe(150_000);
  });

  it('keeps both decimal places', () => {
    expect(parseAmountToMinor('1250.50')).toBe(125_050);
    expect(parseAmountToMinor('0.01')).toBe(1);
    expect(parseAmountToMinor('.5')).toBe(50);
  });

  it('pads a single decimal place', () => {
    expect(parseAmountToMinor('99.5')).toBe(9950);
  });

  it('strips grouping separators, whitespace and currency symbols', () => {
    expect(parseAmountToMinor(' 1,250.50 ')).toBe(125_050);
    expect(parseAmountToMinor('₹1,00,000')).toBe(10_000_000);
    expect(parseAmountToMinor('$42.00', 'USD')).toBe(4200);
  });

  /**
   * The reason this module exists. `Math.round(1.005 * 100)` is 100 in IEEE-754
   * because 1.005 is really 1.00499999999999989, so the float path loses a
   * paisa. Working on the digit string cannot.
   */
  it('does not lose a paisa to floating point', () => {
    expect(parseAmountToMinor('1.005', 'KWD')).toBe(1005);
    expect(Math.round(1.005 * 100)).toBe(100); // What the naive version does.
    expect(parseAmountToMinor('0.07')).toBe(7);
    expect(parseAmountToMinor('8.87')).toBe(887);

    // 1000 entries of ₹0.07. Summing the floats drifts off 70 exactly;
    // summing the integers cannot.
    let minorTotal = 0;
    let floatTotal = 0;
    for (let i = 0; i < 1000; i += 1) {
      minorTotal += parseAmountToMinor('0.07');
      floatTotal += 0.07;
    }
    expect(minorTotal).toBe(7_000); // 7000 paise = exactly ₹70.00
    expect(floatTotal).not.toBe(70); // 70.00000000000207
  });

  it('honours the currency exponent', () => {
    expect(parseAmountToMinor('500', 'JPY')).toBe(500); // Zero-decimal currency.
    expect(parseAmountToMinor('1.234', 'KWD')).toBe(1234); // Three decimals.
  });

  it.each([
    ['-5', 'negative'],
    ['0', 'zero'],
    ['0.00', 'zero with decimals'],
    ['abc', 'non-numeric'],
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['12.345', 'too many decimals for INR'],
    ['1.5', 'decimals on a zero-decimal currency'],
  ] as const)('rejects %s (%s)', (input) => {
    expect(() => parseAmountToMinor(input, input === '1.5' ? 'JPY' : 'INR')).toThrow(MoneyParseError);
  });

  it('rejects values that would exceed safe integer precision', () => {
    expect(() => parseAmountToMinor('99999999999999999999')).toThrow(MoneyParseError);
    expect(() => parseAmountToMinor(Number.POSITIVE_INFINITY)).toThrow(MoneyParseError);
    expect(() => parseAmountToMinor(Number.NaN)).toThrow(MoneyParseError);
  });

  it('rejects non-string, non-number input', () => {
    expect(() => parseAmountToMinor(null)).toThrow(MoneyParseError);
    expect(() => parseAmountToMinor({ amount: 5 })).toThrow(MoneyParseError);
    expect(() => parseAmountToMinor([100])).toThrow(MoneyParseError);
  });
});

describe('formatMinorAsDecimal', () => {
  it('round-trips with the parser', () => {
    for (const value of ['1250.50', '0.01', '99999.99', '1.00']) {
      expect(formatMinorAsDecimal(parseAmountToMinor(value))).toBe(
        Number(value).toFixed(2),
      );
    }
  });

  it('pads amounts below one major unit', () => {
    expect(formatMinorAsDecimal(1)).toBe('0.01');
    expect(formatMinorAsDecimal(50)).toBe('0.50');
  });

  it('omits the separator for zero-decimal currencies', () => {
    expect(formatMinorAsDecimal(500, 'JPY')).toBe('500');
  });
});

describe('formatMinorAsCurrency', () => {
  it('renders Indian digit grouping', () => {
    // Lakh grouping: 1,00,000 rather than 100,000.
    expect(formatMinorAsCurrency(10_000_000, 'INR')).toContain('1,00,000');
  });
});
