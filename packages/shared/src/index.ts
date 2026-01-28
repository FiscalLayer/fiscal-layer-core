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
export {
  generateId,
  generateCorrelationId,
  generateRunId,
  generateFingerprintId,
  defaultIdGenerator,
  type IdGenerator,
  type GenerateIdOptions,
} from './utils/ids.js';
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

// VAT ID validation (OSS - offline syntax check only)
export {
  // Constants
  EU_COUNTRY_CODES,
  EU_COUNTRY_CODE_SET,
  VAT_ID_PATTERNS,
  COUNTRY_NAMES,
  type EUCountryCode,
  // Functions
  normalizeVatId,
  extractCountryCode,
  extractVatNumber,
  validateVatIdFormat,
  isEUCountryCode,
  getCountryName,
  type VatIdValidationResult,
  type VatIdErrorCode,
} from './vat/index.js';

// Diagnostics summary
export {
  buildDiagnosticsSummary,
  type DiagnosticsSummaryOptions,
  type DiagnosticsSummary,
  type TopRuleEntry,
} from './diagnostics/index.js';
