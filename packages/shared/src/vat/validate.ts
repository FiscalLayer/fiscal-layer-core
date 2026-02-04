/**
 * VAT ID Validation Functions
 *
 * Offline syntax validation for EU VAT IDs.
 * This is OSS code - no network calls, no env reading, no billing logic.
 *
 * @module @fiscal-layer/shared/vat
 */

import {
  EU_COUNTRY_CODE_SET,
  VAT_ID_PATTERNS,
  COUNTRY_NAMES,
  type EUCountryCode,
} from './constants.js';

/**
 * Result of VAT ID format validation
 */
export interface VatIdValidationResult {
  /** Whether the VAT ID format is valid */
  readonly valid: boolean;

  /** Normalized VAT ID (uppercase, no spaces/separators) */
  readonly normalized: string;

  /** Extracted country code (if valid) */
  readonly countryCode: string | undefined;

  /** Extracted VAT number without country prefix */
  readonly vatNumber: string | undefined;

  /** Error reason (if invalid) */
  readonly reason: string | undefined;

  /** Error code for programmatic handling */
  readonly errorCode: VatIdErrorCode | undefined;
}

/**
 * Error codes for VAT ID validation failures
 */
export type VatIdErrorCode = 'EMPTY_INPUT' | 'TOO_SHORT' | 'UNKNOWN_COUNTRY' | 'INVALID_FORMAT';

/**
 * Normalize a VAT ID for validation and comparison.
 *
 * - Converts to uppercase
 * - Removes whitespace
 * - Removes common separators (dots, dashes)
 *
 * @param vatId - Raw VAT ID input
 * @returns Normalized VAT ID
 *
 * @example
 * ```typescript
 * normalizeVatId('de 123 456 789') // 'DE123456789'
 * normalizeVatId('FR-12.345.678.901') // 'FR12345678901'
 * ```
 */
export function normalizeVatId(vatId: string): string {
  if (!vatId || typeof vatId !== 'string') {
    return '';
  }
  return vatId.toUpperCase().replace(/[\s.\-_]/g, '');
}

/**
 * Extract country code from a VAT ID.
 *
 * @param vatId - Full VAT ID (normalized or raw)
 * @returns Country code if valid EU member, undefined otherwise
 *
 * @example
 * ```typescript
 * extractCountryCode('DE123456789') // 'DE'
 * extractCountryCode('US12345') // undefined
 * ```
 */
export function extractCountryCode(vatId: string): EUCountryCode | undefined {
  const normalized = normalizeVatId(vatId);
  if (normalized.length < 2) {
    return undefined;
  }

  const countryCode = normalized.slice(0, 2);
  if (EU_COUNTRY_CODE_SET.has(countryCode)) {
    return countryCode as EUCountryCode;
  }

  return undefined;
}

/**
 * Extract VAT number without country prefix.
 *
 * @param vatId - Full VAT ID
 * @returns VAT number portion (everything after country code)
 *
 * @example
 * ```typescript
 * extractVatNumber('DE123456789') // '123456789'
 * ```
 */
export function extractVatNumber(vatId: string): string {
  const normalized = normalizeVatId(vatId);
  return normalized.slice(2);
}

/**
 * Validate a VAT ID format (offline syntax check).
 *
 * This function performs:
 * 1. Normalization (uppercase, remove separators)
 * 2. Country code validation (must be EU member)
 * 3. Format validation (country-specific regex)
 *
 * NOTE: This only validates the FORMAT, not whether the VAT ID
 * actually exists in VIES. For live verification, use the
 * VIES Pro filter (private/commercial).
 *
 * @param vatId - VAT ID to validate
 * @returns Validation result with normalized value and any errors
 *
 * @example
 * ```typescript
 * // Valid German VAT ID
 * validateVatIdFormat('DE123456789')
 * // { valid: true, normalized: 'DE123456789', countryCode: 'DE', vatNumber: '123456789' }
 *
 * // Invalid format
 * validateVatIdFormat('DE12345')
 * // { valid: false, reason: 'Invalid Germany VAT ID format', errorCode: 'INVALID_FORMAT' }
 *
 * // Unknown country
 * validateVatIdFormat('US123456789')
 * // { valid: false, reason: 'Unknown EU country code: US', errorCode: 'UNKNOWN_COUNTRY' }
 * ```
 */
export function validateVatIdFormat(vatId: string): VatIdValidationResult {
  // Handle empty/invalid input
  if (!vatId || typeof vatId !== 'string') {
    return {
      valid: false,
      normalized: '',
      countryCode: undefined,
      vatNumber: undefined,
      reason: 'VAT ID must be a non-empty string',
      errorCode: 'EMPTY_INPUT',
    };
  }

  const normalized = normalizeVatId(vatId);

  // Check minimum length
  if (normalized.length < 4) {
    return {
      valid: false,
      normalized,
      countryCode: undefined,
      vatNumber: undefined,
      reason: 'VAT ID too short (minimum 4 characters)',
      errorCode: 'TOO_SHORT',
    };
  }

  // Extract and validate country code
  const countryCode = normalized.slice(0, 2);
  if (!EU_COUNTRY_CODE_SET.has(countryCode)) {
    return {
      valid: false,
      normalized,
      countryCode: undefined,
      vatNumber: undefined,
      reason: `Unknown EU country code: ${countryCode}`,
      errorCode: 'UNKNOWN_COUNTRY',
    };
  }

  const typedCountryCode = countryCode as EUCountryCode;
  const vatNumber = normalized.slice(2);

  // Validate format against country-specific pattern
  const pattern = VAT_ID_PATTERNS[typedCountryCode];
  if (!pattern.test(normalized)) {
    const countryName = COUNTRY_NAMES[typedCountryCode];
    return {
      valid: false,
      normalized,
      countryCode: typedCountryCode,
      vatNumber,
      reason: `Invalid ${countryName} VAT ID format`,
      errorCode: 'INVALID_FORMAT',
    };
  }

  // Valid!
  return {
    valid: true,
    normalized,
    countryCode: typedCountryCode,
    vatNumber,
    reason: undefined,
    errorCode: undefined,
  };
}

/**
 * Check if a country code is a valid EU member state.
 *
 * @param countryCode - Two-letter country code
 * @returns true if valid EU member state
 */
export function isEUCountryCode(countryCode: string): countryCode is EUCountryCode {
  return EU_COUNTRY_CODE_SET.has(countryCode.toUpperCase());
}

/**
 * Get human-readable country name for an EU country code.
 *
 * @param countryCode - EU country code
 * @returns Country name or undefined if not found
 */
export function getCountryName(countryCode: string): string | undefined {
  const upper = countryCode.toUpperCase();
  if (isEUCountryCode(upper)) {
    return COUNTRY_NAMES[upper];
  }
  return undefined;
}
