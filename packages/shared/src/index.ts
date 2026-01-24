/**
 * @fiscal-layer/shared
 *
 * Shared utilities for FiscalLayer.
 *
 * @packageDocumentation
 */

export { createLogger, type Logger, type LogLevel } from './logging/logger.js';
export { createSafeLogger, assertSafeLogging, type SafeLoggerOptions } from './logging/safe-logger.js';
export { FiscalLayerError, ValidationError, ConfigurationError } from './errors/errors.js';
export { generateId, generateCorrelationId } from './utils/ids.js';
export {
  canonicalStringify,
  computeConfigHash,
  verifyConfigHash,
  parseHash,
  shortHash,
} from './crypto/canonical-hash.js';

// Decimal arithmetic
export {
  // Operations
  add,
  subtract,
  multiply,
  divide,
  sum,
  percentage,
  round,
  abs,
  negate,
  // Comparisons
  compare,
  equals,
  isZero,
  isNegative,
  isPositive,
  // Conversions
  fromNumber,
  toNumber,
  formatForDisplay,
  isValidDecimalAmount,
  // Types & Constants
  type RoundingMode,
  type DecimalConfig,
  DEFAULT_ROUNDING_MODE,
  DEFAULT_DECIMAL_PLACES,
  MAX_DECIMAL_PLACES,
} from './decimal/decimal-utils.js';
