import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataMasker } from '../masking/masker.js';
import { createDefaultMaskingPolicy, createStrictMaskingPolicy } from '../masking/policies.js';

/**
 * RED LINE TESTS
 *
 * These tests verify that sensitive data NEVER appears in reports.
 * If any of these tests fail, it indicates a privacy breach.
 */
describe('Red Line Tests - Privacy Boundaries', () => {
  /**
   * Patterns that should NEVER appear in masked output
   */
  const FORBIDDEN_PATTERNS = {
    // Full IBAN patterns (various countries)
    IBAN_FULL: /[A-Z]{2}\d{2}[A-Z0-9]{4,30}/i,

    // Full address patterns (street + number)
    ADDRESS_FULL: /\b\d+\s+[A-Za-z]+\s+(Str|Street|Road|Ave|Avenue|Blvd|Way|Lane|Dr|Drive)\b/i,

    // Full email addresses
    EMAIL_FULL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,

    // Full phone numbers (various formats)
    PHONE_FULL: /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,

    // German tax numbers
    TAX_NUMBER_FULL: /\d{2,3}\/\d{3}\/\d{5}/,
  };

  describe('Report masking', () => {
    const masker = new DataMasker(createDefaultMaskingPolicy());
    const strictMasker = new DataMasker(createStrictMaskingPolicy());

    it('should NEVER contain full IBAN in masked report', () => {
      const reportWithIBAN = {
        invoiceSummary: {
          seller: {
            iban: 'DE89370400440532013000',
            name: 'Test Company',
          },
          buyer: {
            iban: 'FR7630006000011234567890189',
            name: 'Buyer Company',
          },
        },
        paymentDetails: {
          bankAccount: 'GB82WEST12345698765432',
          reference: 'INV-001',
        },
      };

      const result = masker.mask(reportWithIBAN);
      const jsonOutput = JSON.stringify(result.data);

      expect(jsonOutput).not.toMatch(FORBIDDEN_PATTERNS.IBAN_FULL);
      expect(result.maskedFields).toContain('invoiceSummary.seller.iban');
      expect(result.maskedFields).toContain('invoiceSummary.buyer.iban');
    });

    it('should NEVER contain full address in masked report', () => {
      const reportWithAddress = {
        invoiceSummary: {
          seller: {
            address: {
              street: '123 Main Street',
              city: 'Berlin',
              postalCode: '10115',
              country: 'DE',
            },
          },
          buyer: {
            address: {
              street: '456 Oak Avenue',
              city: 'Munich',
              postalCode: '80331',
              country: 'DE',
            },
          },
        },
      };

      const result = strictMasker.mask(reportWithAddress);
      const jsonOutput = JSON.stringify(result.data);

      // Full street addresses should not appear
      expect(jsonOutput).not.toContain('123 Main Street');
      expect(jsonOutput).not.toContain('456 Oak Avenue');
    });

    it('should NEVER contain full email in masked report', () => {
      const reportWithEmail = {
        seller: {
          email: 'seller@example.com',
          contactEmail: 'contact@company.de',
        },
        buyer: {
          email: 'buyer@customer.org',
        },
        notifications: {
          recipientEmail: 'notify@example.net',
        },
      };

      const result = masker.mask(reportWithEmail);
      const jsonOutput = JSON.stringify(result.data);

      expect(jsonOutput).not.toMatch(FORBIDDEN_PATTERNS.EMAIL_FULL);
      expect(result.maskedFields).toContain('seller.email');
      expect(result.maskedFields).toContain('buyer.email');
    });

    it('should NEVER contain full phone number in masked report', () => {
      const reportWithPhone = {
        seller: {
          phone: '+49 30 12345678',
          mobile: '0170-1234567',
        },
        buyer: {
          phone: '+1 (555) 123-4567',
        },
      };

      const result = masker.mask(reportWithPhone);
      const jsonOutput = JSON.stringify(result.data);

      expect(jsonOutput).not.toMatch(FORBIDDEN_PATTERNS.PHONE_FULL);
      expect(result.maskedFields).toContain('seller.phone');
      expect(result.maskedFields).toContain('buyer.phone');
    });

    it('should only show partial VAT ID (first 2 and last 2 characters)', () => {
      const reportWithVAT = {
        seller: {
          vatId: 'DE123456789',
        },
        buyer: {
          vatId: 'FR12345678901',
        },
      };

      const result = masker.mask(reportWithVAT);

      // VAT IDs should be partially masked
      const data = result.data as Record<string, Record<string, string>> | undefined;
      const sellerVat = data?.['seller']?.['vatId'] ?? '';
      const buyerVat = data?.['buyer']?.['vatId'] ?? '';

      // Should start with country code and end with last digits
      expect(sellerVat).toMatch(/^DE\*+89$/);
      expect(buyerVat).toMatch(/^FR\*+01$/);

      // Should NOT contain full VAT ID
      expect(sellerVat).not.toBe('DE123456789');
      expect(buyerVat).not.toBe('FR12345678901');
    });
  });

  describe('Comprehensive PII scan', () => {
    const masker = new DataMasker(createStrictMaskingPolicy());

    it('should detect and mask PII in deeply nested structures', () => {
      const deeplyNested = {
        level1: {
          level2: {
            level3: {
              level4: {
                sensitiveEmail: 'deep@nested.com',
                sensitivePhone: '+49 123 456789',
                safeData: 'This is fine',
              },
            },
          },
        },
      };

      const result = masker.mask(deeplyNested);
      const jsonOutput = JSON.stringify(result.data);

      expect(jsonOutput).not.toMatch(FORBIDDEN_PATTERNS.EMAIL_FULL);
      expect(jsonOutput).not.toMatch(FORBIDDEN_PATTERNS.PHONE_FULL);
      expect(jsonOutput).toContain('This is fine');
    });

    it('should mask PII in arrays', () => {
      const withArrays = {
        contacts: [
          { email: 'first@test.com', phone: '+49 111 111111' },
          { email: 'second@test.com', phone: '+49 222 222222' },
          { email: 'third@test.com', phone: '+49 333 333333' },
        ],
      };

      const result = masker.mask(withArrays);
      const jsonOutput = JSON.stringify(result.data);

      expect(jsonOutput).not.toMatch(FORBIDDEN_PATTERNS.EMAIL_FULL);
      expect(jsonOutput).not.toMatch(FORBIDDEN_PATTERNS.PHONE_FULL);
    });
  });

  describe('Validation report boundary', () => {
    it('should produce a safe report structure', () => {
      // Simulate what a validation report might look like before masking
      const unsafeReport = {
        runId: 'run-123',
        status: 'APPROVED',
        score: 95,
        invoiceSummary: {
          format: 'xrechnung',
          invoiceNumber: 'INV-2024-001',
          seller: {
            name: 'Acme GmbH',
            vatId: 'DE123456789',
            email: 'billing@acme.de',
            phone: '+49 30 1234567',
            iban: 'DE89370400440532013000',
            address: {
              street: 'Hauptstraße 123',
              city: 'Berlin',
              postalCode: '10115',
              country: 'DE',
            },
          },
          buyer: {
            name: 'Customer AG',
            vatId: 'DE987654321',
            email: 'accounting@customer.de',
            iban: 'DE75512108001245126199',
          },
        },
        diagnostics: [
          { code: 'BR-DE-01', message: 'Test diagnostic' },
        ],
      };

      const masker = new DataMasker(createStrictMaskingPolicy());
      const result = masker.mask(unsafeReport);
      const safeJson = JSON.stringify(result.data);

      // Verify no PII leaked
      expect(safeJson).not.toMatch(FORBIDDEN_PATTERNS.IBAN_FULL);
      expect(safeJson).not.toMatch(FORBIDDEN_PATTERNS.EMAIL_FULL);
      expect(safeJson).not.toMatch(FORBIDDEN_PATTERNS.PHONE_FULL);

      // Verify safe data is preserved
      expect(safeJson).toContain('run-123');
      expect(safeJson).toContain('APPROVED');
      expect(safeJson).toContain('INV-2024-001');
      expect(safeJson).toContain('BR-DE-01');
    });
  });
});

describe('Red Line Tests - Temporal Boundaries', () => {
  /**
   * Note: These tests use the MemoryTempStore.
   * Import and test the actual implementation.
   */

  it('should have test for TTL expiration (placeholder)', async () => {
    // This test verifies that data expires after TTL
    // In a real test, we would:
    // 1. Store data with short TTL
    // 2. Wait for TTL to expire
    // 3. Verify data is no longer accessible

    // For now, this is a placeholder
    // Real implementation in storage package tests
    expect(true).toBe(true);
  });
});
