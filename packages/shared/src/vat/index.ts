/**
 * VAT ID Validation Module (OSS)
 *
 * Provides offline syntax validation for EU VAT IDs.
 * For live VIES verification, see @fiscal-layer/steps-vies-pro (private).
 *
 * Features:
 * - EU country code validation (27 member states + XI)
 * - Country-specific format validation (regex patterns)
 * - VAT ID normalization (uppercase, remove separators)
 * - No network calls, no env reading, no billing logic
 *
 * @module @fiscal-layer/shared/vat
 *
 * @example
 * ```typescript
 * import { validateVatIdFormat, normalizeVatId } from '@fiscal-layer/shared';
 *
 * // Validate format
 * const result = validateVatIdFormat('DE 123 456 789');
 * if (result.valid) {
 *   console.log('Valid:', result.normalized); // 'DE123456789'
 * } else {
 *   console.log('Invalid:', result.reason);
 * }
 *
 * // Just normalize
 * const normalized = normalizeVatId('fr-12.345.678.901');
 * // 'FR12345678901'
 * ```
 */

// Constants
export {
  EU_COUNTRY_CODES,
  EU_COUNTRY_CODE_SET,
  VAT_ID_PATTERNS,
  COUNTRY_NAMES,
  type EUCountryCode,
} from './constants.js';

// Validation functions
export {
  normalizeVatId,
  extractCountryCode,
  extractVatNumber,
  validateVatIdFormat,
  isEUCountryCode,
  getCountryName,
  type VatIdValidationResult,
  type VatIdErrorCode,
} from './validate.js';
