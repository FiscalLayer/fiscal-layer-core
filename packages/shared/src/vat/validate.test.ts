/**
 * VAT ID Validation Tests
 *
 * Tests for offline syntax validation of EU VAT IDs.
 * Covers all 27 EU member states plus Northern Ireland (XI).
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeVatId,
  extractCountryCode,
  extractVatNumber,
  validateVatIdFormat,
  isEUCountryCode,
  getCountryName,
} from './validate.js';
import { EU_COUNTRY_CODES } from './constants.js';

describe('normalizeVatId', () => {
  it('should convert to uppercase', () => {
    expect(normalizeVatId('de123456789')).toBe('DE123456789');
    expect(normalizeVatId('Fr12345678901')).toBe('FR12345678901');
  });

  it('should remove whitespace', () => {
    expect(normalizeVatId('DE 123 456 789')).toBe('DE123456789');
    expect(normalizeVatId('  DE123456789  ')).toBe('DE123456789');
    expect(normalizeVatId('DE\t123\n456\r789')).toBe('DE123456789');
  });

  it('should remove common separators', () => {
    expect(normalizeVatId('DE-123-456-789')).toBe('DE123456789');
    expect(normalizeVatId('DE.123.456.789')).toBe('DE123456789');
    expect(normalizeVatId('DE_123_456_789')).toBe('DE123456789');
    expect(normalizeVatId('FR-12.345_678 901')).toBe('FR12345678901');
  });

  it('should handle empty/invalid input', () => {
    expect(normalizeVatId('')).toBe('');
    expect(normalizeVatId(null as unknown as string)).toBe('');
    expect(normalizeVatId(undefined as unknown as string)).toBe('');
  });
});

describe('extractCountryCode', () => {
  it('should extract valid EU country codes', () => {
    expect(extractCountryCode('DE123456789')).toBe('DE');
    expect(extractCountryCode('FR12345678901')).toBe('FR');
    expect(extractCountryCode('EL123456789')).toBe('EL'); // Greece uses EL
    expect(extractCountryCode('XI123456789')).toBe('XI'); // Northern Ireland
  });

  it('should return undefined for non-EU codes', () => {
    expect(extractCountryCode('US123456789')).toBeUndefined();
    expect(extractCountryCode('CH123456789')).toBeUndefined();
    expect(extractCountryCode('GB123456789')).toBeUndefined(); // UK left EU
  });

  it('should handle short input', () => {
    expect(extractCountryCode('')).toBeUndefined();
    expect(extractCountryCode('D')).toBeUndefined();
  });

  it('should normalize before extraction', () => {
    expect(extractCountryCode('de 123 456 789')).toBe('DE');
  });
});

describe('extractVatNumber', () => {
  it('should extract number portion', () => {
    expect(extractVatNumber('DE123456789')).toBe('123456789');
    expect(extractVatNumber('ATU12345678')).toBe('U12345678');
    expect(extractVatNumber('NL123456789B01')).toBe('123456789B01');
  });

  it('should normalize before extraction', () => {
    expect(extractVatNumber('de 123 456 789')).toBe('123456789');
  });
});

describe('validateVatIdFormat', () => {
  describe('input validation', () => {
    it('should reject empty input', () => {
      const result = validateVatIdFormat('');
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('EMPTY_INPUT');
    });

    it('should reject null/undefined', () => {
      expect(validateVatIdFormat(null as unknown as string).valid).toBe(false);
      expect(validateVatIdFormat(undefined as unknown as string).valid).toBe(false);
    });

    it('should reject too short input', () => {
      const result = validateVatIdFormat('DE1');
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('TOO_SHORT');
    });

    it('should reject unknown country codes', () => {
      const result = validateVatIdFormat('US123456789');
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('UNKNOWN_COUNTRY');
      expect(result.reason).toContain('US');
    });
  });

  describe('Germany (DE)', () => {
    it('should accept valid DE VAT ID', () => {
      const result = validateVatIdFormat('DE123456789');
      expect(result.valid).toBe(true);
      expect(result.countryCode).toBe('DE');
      expect(result.vatNumber).toBe('123456789');
      expect(result.normalized).toBe('DE123456789');
    });

    it('should accept with spaces/separators', () => {
      expect(validateVatIdFormat('DE 123 456 789').valid).toBe(true);
      expect(validateVatIdFormat('de-123-456-789').valid).toBe(true);
    });

    it('should reject invalid format', () => {
      expect(validateVatIdFormat('DE12345678').valid).toBe(false); // 8 digits
      expect(validateVatIdFormat('DE1234567890').valid).toBe(false); // 10 digits
      expect(validateVatIdFormat('DEU23456789').valid).toBe(false); // letter in number
    });
  });

  describe('France (FR)', () => {
    it('should accept valid FR VAT ID', () => {
      expect(validateVatIdFormat('FR12345678901').valid).toBe(true);
      expect(validateVatIdFormat('FRAB123456789').valid).toBe(true);
      expect(validateVatIdFormat('FR1A123456789').valid).toBe(true);
    });

    it('should reject invalid format', () => {
      expect(validateVatIdFormat('FR1234567890').valid).toBe(false); // 10 digits after prefix
      expect(validateVatIdFormat('FR123456789012').valid).toBe(false); // too long
    });
  });

  describe('Italy (IT)', () => {
    it('should accept valid IT VAT ID', () => {
      expect(validateVatIdFormat('IT12345678901').valid).toBe(true);
    });

    it('should reject invalid format', () => {
      expect(validateVatIdFormat('IT1234567890').valid).toBe(false); // 10 digits
      expect(validateVatIdFormat('IT123456789012').valid).toBe(false); // 12 digits
    });
  });

  describe('Spain (ES)', () => {
    it('should accept valid ES VAT ID', () => {
      expect(validateVatIdFormat('ESA12345678').valid).toBe(true);
      expect(validateVatIdFormat('ES12345678A').valid).toBe(true);
      expect(validateVatIdFormat('ESX1234567Y').valid).toBe(true);
    });

    it('should reject invalid format', () => {
      expect(validateVatIdFormat('ES1234567').valid).toBe(false); // too short
    });
  });

  describe('Netherlands (NL)', () => {
    it('should accept valid NL VAT ID', () => {
      expect(validateVatIdFormat('NL123456789B01').valid).toBe(true);
      expect(validateVatIdFormat('NL123456789B99').valid).toBe(true);
    });

    it('should reject invalid format', () => {
      expect(validateVatIdFormat('NL123456789').valid).toBe(false); // missing B##
      expect(validateVatIdFormat('NL123456789A01').valid).toBe(false); // A instead of B
    });
  });

  describe('Poland (PL)', () => {
    it('should accept valid PL VAT ID', () => {
      expect(validateVatIdFormat('PL1234567890').valid).toBe(true);
    });

    it('should reject invalid format', () => {
      expect(validateVatIdFormat('PL123456789').valid).toBe(false); // 9 digits
      expect(validateVatIdFormat('PL12345678901').valid).toBe(false); // 11 digits
    });
  });

  describe('Austria (AT)', () => {
    it('should accept valid AT VAT ID', () => {
      expect(validateVatIdFormat('ATU12345678').valid).toBe(true);
    });

    it('should reject invalid format', () => {
      expect(validateVatIdFormat('AT12345678').valid).toBe(false); // missing U
      expect(validateVatIdFormat('ATU1234567').valid).toBe(false); // 7 digits
    });
  });

  describe('Belgium (BE)', () => {
    it('should accept valid BE VAT ID', () => {
      expect(validateVatIdFormat('BE0123456789').valid).toBe(true);
      expect(validateVatIdFormat('BE1123456789').valid).toBe(true);
    });

    it('should reject invalid format', () => {
      expect(validateVatIdFormat('BE2123456789').valid).toBe(false); // starts with 2
      expect(validateVatIdFormat('BE012345678').valid).toBe(false); // 9 digits after 0
    });
  });

  describe('Greece (EL)', () => {
    it('should accept valid EL VAT ID', () => {
      expect(validateVatIdFormat('EL123456789').valid).toBe(true);
    });

    it('should reject GR prefix', () => {
      // Greece uses EL, not GR in VAT context
      expect(validateVatIdFormat('GR123456789').valid).toBe(false);
      expect(validateVatIdFormat('GR123456789').errorCode).toBe('UNKNOWN_COUNTRY');
    });
  });

  describe('Ireland (IE)', () => {
    it('should accept valid IE VAT ID formats', () => {
      expect(validateVatIdFormat('IE1234567A').valid).toBe(true);
      expect(validateVatIdFormat('IE1234567AB').valid).toBe(true);
      expect(validateVatIdFormat('IE1A12345B').valid).toBe(true);
      expect(validateVatIdFormat('IE1+12345A').valid).toBe(true);
      expect(validateVatIdFormat('IE1*12345A').valid).toBe(true);
    });
  });

  describe('Northern Ireland (XI)', () => {
    it('should accept valid XI VAT ID', () => {
      expect(validateVatIdFormat('XI123456789').valid).toBe(true);
      expect(validateVatIdFormat('XI123456789012').valid).toBe(true);
      expect(validateVatIdFormat('XIGD123').valid).toBe(true);
      expect(validateVatIdFormat('XIHA456').valid).toBe(true);
    });
  });

  describe('all EU countries basic validation', () => {
    // Minimal valid examples for each country
    const validExamples: Record<string, string> = {
      AT: 'ATU12345678',
      BE: 'BE0123456789',
      BG: 'BG123456789',
      CY: 'CY12345678A',
      CZ: 'CZ12345678',
      DE: 'DE123456789',
      DK: 'DK12345678',
      EE: 'EE123456789',
      EL: 'EL123456789',
      ES: 'ESA1234567B',
      FI: 'FI12345678',
      FR: 'FR12345678901',
      HR: 'HR12345678901',
      HU: 'HU12345678',
      IE: 'IE1234567A',
      IT: 'IT12345678901',
      LT: 'LT123456789',
      LU: 'LU12345678',
      LV: 'LV12345678901',
      MT: 'MT12345678',
      NL: 'NL123456789B01',
      PL: 'PL1234567890',
      PT: 'PT123456789',
      RO: 'RO12345678',
      SE: 'SE123456789012',
      SI: 'SI12345678',
      SK: 'SK1234567890',
      XI: 'XI123456789',
    };

    it.each(EU_COUNTRY_CODES)('should validate %s format', (countryCode) => {
      const example = validExamples[countryCode];
      if (!example) {
        throw new Error(`Missing test example for ${countryCode}`);
      }
      const result = validateVatIdFormat(example);
      expect(result.valid).toBe(true);
      expect(result.countryCode).toBe(countryCode);
    });
  });

  describe('normalization in validation', () => {
    it('should normalize before validation', () => {
      const result = validateVatIdFormat('de 123 456 789');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('DE123456789');
    });
  });
});

describe('isEUCountryCode', () => {
  it('should return true for valid EU codes', () => {
    expect(isEUCountryCode('DE')).toBe(true);
    expect(isEUCountryCode('FR')).toBe(true);
    expect(isEUCountryCode('EL')).toBe(true);
  });

  it('should return false for non-EU codes', () => {
    expect(isEUCountryCode('US')).toBe(false);
    expect(isEUCountryCode('GB')).toBe(false);
    expect(isEUCountryCode('CH')).toBe(false);
  });

  it('should handle lowercase', () => {
    expect(isEUCountryCode('de')).toBe(true);
  });
});

describe('getCountryName', () => {
  it('should return country name for valid codes', () => {
    expect(getCountryName('DE')).toBe('Germany');
    expect(getCountryName('FR')).toBe('France');
    expect(getCountryName('EL')).toBe('Greece');
  });

  it('should return undefined for invalid codes', () => {
    expect(getCountryName('US')).toBeUndefined();
    expect(getCountryName('XX')).toBeUndefined();
  });

  it('should handle lowercase', () => {
    expect(getCountryName('de')).toBe('Germany');
  });
});
