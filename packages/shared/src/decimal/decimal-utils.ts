/**
 * Decimal arithmetic utilities for monetary calculations.
 *
 * All monetary amounts in FiscalLayer are stored as strings (DecimalAmount)
 * to avoid floating-point precision issues. This module provides utilities
 * for performing arithmetic operations with explicit rounding modes.
 *
 * In production, use decimal.js or similar library. This implementation
 * uses bigint for precision.
 */

import type { DecimalAmount } from '@fiscal-layer/contracts';

/**
 * Rounding modes for decimal operations.
 *
 * - ROUND_HALF_EVEN (Banker's rounding): Round to nearest even number. Best for financial calculations.
 * - ROUND_HALF_UP (Commercial rounding): Round 0.5 up. Common in retail.
 * - ROUND_DOWN (Truncate): Always round towards zero.
 * - ROUND_UP: Always round away from zero.
 * - ROUND_CEILING: Always round towards positive infinity.
 * - ROUND_FLOOR: Always round towards negative infinity.
 */
export type RoundingMode =
  | 'ROUND_HALF_EVEN' // Banker's rounding (default for financial)
  | 'ROUND_HALF_UP' // Commercial rounding
  | 'ROUND_DOWN' // Truncate
  | 'ROUND_UP' // Round away from zero
  | 'ROUND_CEILING' // Positive infinity
  | 'ROUND_FLOOR'; // Negative infinity

/**
 * Default rounding mode for FiscalLayer.
 *
 * Banker's rounding is used to minimize cumulative rounding errors
 * in financial calculations.
 */
export const DEFAULT_ROUNDING_MODE: RoundingMode = 'ROUND_HALF_EVEN';

/**
 * Default decimal places for monetary amounts.
 */
export const DEFAULT_DECIMAL_PLACES = 2;

/**
 * Maximum supported decimal places.
 */
export const MAX_DECIMAL_PLACES = 8;

/**
 * Internal representation of a decimal value.
 */
interface DecimalValue {
  /** Integer representation (value * 10^scale) */
  value: bigint;
  /** Number of decimal places */
  scale: number;
  /** Whether the value is negative */
  negative: boolean;
}

/**
 * Parse a decimal string into internal representation.
 */
function parseDecimal(str: string): DecimalValue {
  const trimmed = str.trim();

  // Check for negative
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;

  // Split by decimal point
  const parts = unsigned.split('.');
  if (parts.length > 2) {
    throw new Error(`Invalid decimal format: ${str}`);
  }

  const intPart = parts[0] ?? '0';
  const fracPart = parts[1] ?? '';
  const scale = fracPart.length;

  // Combine into a single integer
  const valueStr = intPart + fracPart;
  const value = BigInt(valueStr);

  return { value, scale, negative };
}

/**
 * Format a decimal value back to string.
 */
function formatDecimal(decimal: DecimalValue, places?: number): string {
  const targetScale = places ?? decimal.scale;
  let { value, scale } = decimal;

  // Adjust scale if needed
  if (scale < targetScale) {
    value = value * BigInt(10 ** (targetScale - scale));
    scale = targetScale;
  } else if (scale > targetScale) {
    // Need to round
    const factor = BigInt(10 ** (scale - targetScale));
    value = value / factor;
    scale = targetScale;
  }

  // Convert to string
  let str = value.toString();

  // Pad with leading zeros if needed
  while (str.length <= scale) {
    str = '0' + str;
  }

  // Insert decimal point
  const insertPoint = str.length - scale;
  let result =
    scale > 0
      ? str.slice(0, insertPoint) + '.' + str.slice(insertPoint)
      : str;

  // Add negative sign
  if (decimal.negative && value !== 0n) {
    result = '-' + result;
  }

  return result;
}

/**
 * Normalize two decimals to the same scale.
 */
function normalize(a: DecimalValue, b: DecimalValue): [bigint, bigint, number] {
  const targetScale = Math.max(a.scale, b.scale);

  let aValue = a.value;
  let bValue = b.value;

  if (a.scale < targetScale) {
    aValue = aValue * BigInt(10 ** (targetScale - a.scale));
  }
  if (b.scale < targetScale) {
    bValue = bValue * BigInt(10 ** (targetScale - b.scale));
  }

  // Apply signs
  if (a.negative) aValue = -aValue;
  if (b.negative) bValue = -bValue;

  return [aValue, bValue, targetScale];
}

/**
 * Apply rounding mode to a division result.
 */
function applyRounding(
  quotient: bigint,
  remainder: bigint,
  divisor: bigint,
  mode: RoundingMode,
): bigint {
  if (remainder === 0n) {
    return quotient;
  }

  const isNegative = quotient < 0n || (quotient === 0n && remainder < 0n);
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const absDivisor = divisor < 0n ? -divisor : divisor;
  const _halfDivisor = absDivisor / 2n;
  const isHalf = absRemainder * 2n === absDivisor;
  const isMoreThanHalf = absRemainder * 2n > absDivisor;

  switch (mode) {
    case 'ROUND_DOWN':
      return quotient;

    case 'ROUND_UP':
      return isNegative ? quotient - 1n : quotient + 1n;

    case 'ROUND_CEILING':
      return isNegative ? quotient : quotient + 1n;

    case 'ROUND_FLOOR':
      return isNegative ? quotient - 1n : quotient;

    case 'ROUND_HALF_UP':
      if (isHalf || isMoreThanHalf) {
        return isNegative ? quotient - 1n : quotient + 1n;
      }
      return quotient;

    case 'ROUND_HALF_EVEN':
      if (isMoreThanHalf) {
        return isNegative ? quotient - 1n : quotient + 1n;
      }
      if (isHalf) {
        // Round to nearest even
        const isOdd = (quotient < 0n ? -quotient : quotient) % 2n === 1n;
        if (isOdd) {
          return isNegative ? quotient - 1n : quotient + 1n;
        }
      }
      return quotient;

    default:
      return quotient;
  }
}

/**
 * Configuration for decimal operations.
 */
export interface DecimalConfig {
  /**
   * Rounding mode to use
   * @default 'ROUND_HALF_EVEN'
   */
  roundingMode?: RoundingMode;

  /**
   * Number of decimal places for results
   * @default 2
   */
  decimalPlaces?: number;
}

/**
 * Add two decimal amounts.
 */
export function add(
  a: DecimalAmount,
  b: DecimalAmount,
  config: DecimalConfig = {},
): DecimalAmount {
  const decA = parseDecimal(a);
  const decB = parseDecimal(b);
  const [valA, valB, scale] = normalize(decA, decB);

  const result = valA + valB;
  const negative = result < 0n;

  return formatDecimal(
    { value: negative ? -result : result, scale, negative },
    config.decimalPlaces,
  );
}

/**
 * Subtract two decimal amounts.
 */
export function subtract(
  a: DecimalAmount,
  b: DecimalAmount,
  config: DecimalConfig = {},
): DecimalAmount {
  const decA = parseDecimal(a);
  const decB = parseDecimal(b);
  const [valA, valB, scale] = normalize(decA, decB);

  const result = valA - valB;
  const negative = result < 0n;

  return formatDecimal(
    { value: negative ? -result : result, scale, negative },
    config.decimalPlaces,
  );
}

/**
 * Multiply two decimal amounts.
 */
export function multiply(
  a: DecimalAmount,
  b: DecimalAmount,
  config: DecimalConfig = {},
): DecimalAmount {
  const decA = parseDecimal(a);
  const decB = parseDecimal(b);

  const value = decA.value * decB.value;
  const scale = decA.scale + decB.scale;
  const negative = decA.negative !== decB.negative;

  const places = config.decimalPlaces ?? DEFAULT_DECIMAL_PLACES;
  const mode = config.roundingMode ?? DEFAULT_ROUNDING_MODE;

  // Round to target decimal places
  if (scale > places) {
    const factor = BigInt(10 ** (scale - places));
    const quotient = value / factor;
    const remainder = value % factor;
    const rounded = applyRounding(quotient, remainder, factor, mode);
    return formatDecimal({ value: rounded, scale: places, negative }, places);
  }

  return formatDecimal({ value, scale, negative }, places);
}

/**
 * Divide two decimal amounts.
 */
export function divide(
  a: DecimalAmount,
  b: DecimalAmount,
  config: DecimalConfig = {},
): DecimalAmount {
  const decA = parseDecimal(a);
  const decB = parseDecimal(b);

  if (decB.value === 0n) {
    throw new Error('Division by zero');
  }

  const places = config.decimalPlaces ?? DEFAULT_DECIMAL_PLACES;
  const mode = config.roundingMode ?? DEFAULT_ROUNDING_MODE;

  // Scale up dividend for precision
  const targetScale = places + MAX_DECIMAL_PLACES;
  const scaledA = decA.value * BigInt(10 ** (targetScale - decA.scale + decB.scale));

  const quotient = scaledA / decB.value;
  const _remainder = scaledA % decB.value;
  const negative = decA.negative !== decB.negative;

  // Round to target precision
  const factor = BigInt(10 ** (targetScale - places));
  const finalQuotient = quotient / factor;
  const finalRemainder = quotient % factor;
  const rounded = applyRounding(finalQuotient, finalRemainder, factor, mode);

  return formatDecimal({ value: rounded < 0n ? -rounded : rounded, scale: places, negative }, places);
}

/**
 * Compare two decimal amounts.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compare(a: DecimalAmount, b: DecimalAmount): -1 | 0 | 1 {
  const decA = parseDecimal(a);
  const decB = parseDecimal(b);
  const [valA, valB] = normalize(decA, decB);

  if (valA < valB) return -1;
  if (valA > valB) return 1;
  return 0;
}

/**
 * Check if two decimal amounts are equal.
 */
export function equals(a: DecimalAmount, b: DecimalAmount): boolean {
  return compare(a, b) === 0;
}

/**
 * Check if amount is zero.
 */
export function isZero(a: DecimalAmount): boolean {
  const dec = parseDecimal(a);
  return dec.value === 0n;
}

/**
 * Check if amount is negative.
 */
export function isNegative(a: DecimalAmount): boolean {
  const dec = parseDecimal(a);
  return dec.negative && dec.value !== 0n;
}

/**
 * Check if amount is positive.
 */
export function isPositive(a: DecimalAmount): boolean {
  const dec = parseDecimal(a);
  return !dec.negative && dec.value !== 0n;
}

/**
 * Get absolute value.
 */
export function abs(a: DecimalAmount): DecimalAmount {
  const dec = parseDecimal(a);
  return formatDecimal({ ...dec, negative: false });
}

/**
 * Negate a decimal amount.
 */
export function negate(a: DecimalAmount): DecimalAmount {
  const dec = parseDecimal(a);
  return formatDecimal({ ...dec, negative: !dec.negative && dec.value !== 0n });
}

/**
 * Round a decimal amount to specified places.
 */
export function round(
  a: DecimalAmount,
  places: number = DEFAULT_DECIMAL_PLACES,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE,
): DecimalAmount {
  const dec = parseDecimal(a);

  if (dec.scale <= places) {
    return formatDecimal(dec, places);
  }

  const factor = BigInt(10 ** (dec.scale - places));
  const quotient = dec.value / factor;
  const remainder = dec.value % factor;
  const rounded = applyRounding(quotient, remainder, factor, mode);

  return formatDecimal({ value: rounded, scale: places, negative: dec.negative }, places);
}

/**
 * Sum an array of decimal amounts.
 */
export function sum(amounts: DecimalAmount[], config: DecimalConfig = {}): DecimalAmount {
  if (amounts.length === 0) {
    return formatDecimal({ value: 0n, scale: config.decimalPlaces ?? DEFAULT_DECIMAL_PLACES, negative: false });
  }

  return amounts.reduce((acc, amount) => add(acc, amount, config), '0');
}

/**
 * Calculate percentage of an amount.
 */
export function percentage(
  amount: DecimalAmount,
  percent: DecimalAmount,
  config: DecimalConfig = {},
): DecimalAmount {
  const factor = divide(percent, '100', { ...config, decimalPlaces: MAX_DECIMAL_PLACES });
  return multiply(amount, factor, config);
}

/**
 * Format amount for display (with thousands separator).
 */
export function formatForDisplay(
  amount: DecimalAmount,
  options: {
    locale?: string;
    currency?: string;
    decimalPlaces?: number;
  } = {},
): string {
  const places = options.decimalPlaces ?? DEFAULT_DECIMAL_PLACES;
  const rounded = round(amount, places);
  const num = parseFloat(rounded);

  if (options.currency) {
    return new Intl.NumberFormat(options.locale ?? 'en-US', {
      style: 'currency',
      currency: options.currency,
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).format(num);
  }

  return new Intl.NumberFormat(options.locale ?? 'en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(num);
}

/**
 * Validate that a string is a valid decimal amount.
 */
export function isValidDecimalAmount(value: string): boolean {
  try {
    parseDecimal(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a decimal amount from a number.
 * WARNING: This may lose precision for very large or very precise numbers.
 */
export function fromNumber(
  value: number,
  decimalPlaces: number = DEFAULT_DECIMAL_PLACES,
): DecimalAmount {
  return value.toFixed(decimalPlaces);
}

/**
 * Convert a decimal amount to a number.
 * WARNING: This may lose precision for very large or very precise numbers.
 */
export function toNumber(amount: DecimalAmount): number {
  return parseFloat(amount);
}
