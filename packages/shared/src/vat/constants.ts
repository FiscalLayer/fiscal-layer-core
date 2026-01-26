/**
 * VAT ID Constants
 *
 * EU country codes and VAT ID format patterns for offline syntax validation.
 * This is OSS code - no network calls, no env reading, no billing logic.
 *
 * @module @fiscal-layer/shared/vat
 */

/**
 * EU member state codes that use VAT IDs in VIES system.
 *
 * Note: Greece uses 'EL' (not 'GR') in VAT context.
 * Note: XI is Northern Ireland (post-Brexit special status).
 */
export const EU_COUNTRY_CODES = [
  'AT', // Austria
  'BE', // Belgium
  'BG', // Bulgaria
  'CY', // Cyprus
  'CZ', // Czech Republic (Czechia)
  'DE', // Germany
  'DK', // Denmark
  'EE', // Estonia
  'EL', // Greece (EL, not GR in VAT context)
  'ES', // Spain
  'FI', // Finland
  'FR', // France
  'HR', // Croatia
  'HU', // Hungary
  'IE', // Ireland
  'IT', // Italy
  'LT', // Lithuania
  'LU', // Luxembourg
  'LV', // Latvia
  'MT', // Malta
  'NL', // Netherlands
  'PL', // Poland
  'PT', // Portugal
  'RO', // Romania
  'SE', // Sweden
  'SI', // Slovenia
  'SK', // Slovakia
  'XI', // Northern Ireland (post-Brexit)
] as const;

/**
 * EU country code type
 */
export type EUCountryCode = (typeof EU_COUNTRY_CODES)[number];

/**
 * Set for O(1) lookup
 */
export const EU_COUNTRY_CODE_SET: ReadonlySet<string> = new Set(EU_COUNTRY_CODES);

/**
 * VAT ID format patterns by country code.
 *
 * These patterns validate the complete VAT ID including country prefix.
 * Based on official EU VAT format specifications.
 *
 * @see https://ec.europa.eu/taxation_customs/vies/faq.html
 */
export const VAT_ID_PATTERNS: Readonly<Record<EUCountryCode, RegExp>> = {
  // Austria: ATU + 8 digits
  AT: /^ATU\d{8}$/,

  // Belgium: BE0 or BE1 + 9 digits
  BE: /^BE[01]\d{9}$/,

  // Bulgaria: BG + 9 or 10 digits
  BG: /^BG\d{9,10}$/,

  // Cyprus: CY + 8 digits + 1 letter
  CY: /^CY\d{8}[A-Z]$/,

  // Czech Republic: CZ + 8, 9, or 10 digits
  CZ: /^CZ\d{8,10}$/,

  // Germany: DE + 9 digits
  DE: /^DE\d{9}$/,

  // Denmark: DK + 8 digits
  DK: /^DK\d{8}$/,

  // Estonia: EE + 9 digits
  EE: /^EE\d{9}$/,

  // Greece: EL + 9 digits
  EL: /^EL\d{9}$/,

  // Spain: ES + 1 alphanumeric + 7 digits + 1 alphanumeric
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,

  // Finland: FI + 8 digits
  FI: /^FI\d{8}$/,

  // France: FR + 2 alphanumerics + 9 digits
  FR: /^FR[A-Z0-9]{2}\d{9}$/,

  // Croatia: HR + 11 digits
  HR: /^HR\d{11}$/,

  // Hungary: HU + 8 digits
  HU: /^HU\d{8}$/,

  // Ireland: IE + various formats
  // - 7 digits + 1-2 letters
  // - 1 digit + 1 letter/+/* + 5 digits + 1 letter
  IE: /^IE(\d{7}[A-Z]{1,2}|\d[A-Z+*]\d{5}[A-Z])$/,

  // Italy: IT + 11 digits
  IT: /^IT\d{11}$/,

  // Lithuania: LT + 9 or 12 digits
  LT: /^LT(\d{9}|\d{12})$/,

  // Luxembourg: LU + 8 digits
  LU: /^LU\d{8}$/,

  // Latvia: LV + 11 digits
  LV: /^LV\d{11}$/,

  // Malta: MT + 8 digits
  MT: /^MT\d{8}$/,

  // Netherlands: NL + 9 digits + B + 2 digits
  NL: /^NL\d{9}B\d{2}$/,

  // Poland: PL + 10 digits
  PL: /^PL\d{10}$/,

  // Portugal: PT + 9 digits
  PT: /^PT\d{9}$/,

  // Romania: RO + 2 to 10 digits
  RO: /^RO\d{2,10}$/,

  // Sweden: SE + 12 digits
  SE: /^SE\d{12}$/,

  // Slovenia: SI + 8 digits
  SI: /^SI\d{8}$/,

  // Slovakia: SK + 10 digits
  SK: /^SK\d{10}$/,

  // Northern Ireland: XI + 9 or 12 digits, or XIGD/XIHA + 3 digits
  XI: /^XI(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};

/**
 * Human-readable country names for error messages
 */
export const COUNTRY_NAMES: Readonly<Record<EUCountryCode, string>> = {
  AT: 'Austria',
  BE: 'Belgium',
  BG: 'Bulgaria',
  CY: 'Cyprus',
  CZ: 'Czech Republic',
  DE: 'Germany',
  DK: 'Denmark',
  EE: 'Estonia',
  EL: 'Greece',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  HR: 'Croatia',
  HU: 'Hungary',
  IE: 'Ireland',
  IT: 'Italy',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  LV: 'Latvia',
  MT: 'Malta',
  NL: 'Netherlands',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SE: 'Sweden',
  SI: 'Slovenia',
  SK: 'Slovakia',
  XI: 'Northern Ireland',
};
