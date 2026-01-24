import { describe, it, expect } from 'vitest';
import { DataMasker } from './masker.js';
import { createDefaultMaskingPolicy } from './policies.js';

describe('DataMasker', () => {
  const masker = new DataMasker(createDefaultMaskingPolicy());

  it('should redact email fields', () => {
    const data = {
      buyer: {
        email: 'test@example.com',
        name: 'Test Company',
      },
    };

    const result = masker.mask(data);

    expect(result.data.buyer.email).toBe('[REDACTED]');
    expect(result.data.buyer.name).toBe('Test Company');
    expect(result.maskedFields).toContain('buyer.email');
  });

  it('should partially mask VAT IDs', () => {
    const data = {
      seller: {
        vatId: 'DE123456789',
      },
    };

    const result = masker.mask(data);

    expect(result.data.seller.vatId).toMatch(/^DE\*+89$/);
    expect(result.maskedFields).toContain('seller.vatId');
  });

  it('should handle nested objects', () => {
    const data = {
      invoice: {
        seller: {
          email: 'seller@example.com',
          phone: '+49 123 456789',
        },
        buyer: {
          email: 'buyer@example.com',
        },
      },
    };

    const result = masker.mask(data);

    expect(result.data.invoice.seller.email).toBe('[REDACTED]');
    expect(result.data.invoice.seller.phone).toBe('[REDACTED]');
    expect(result.data.invoice.buyer.email).toBe('[REDACTED]');
  });

  it('should track masking statistics', () => {
    const data = {
      email: 'test@example.com',
      phone: '123456789',
    };

    const result = masker.mask(data);

    expect(result.stats.maskedCount).toBe(2);
    expect(result.stats.byStrategy['redact']).toBe(2);
  });

  it('should not modify non-matching fields', () => {
    const data = {
      invoiceNumber: 'INV-001',
      totalAmount: 1000,
      currency: 'EUR',
    };

    const result = masker.mask(data);

    expect(result.data.invoiceNumber).toBe('INV-001');
    expect(result.data.totalAmount).toBe(1000);
    expect(result.data.currency).toBe('EUR');
    expect(result.maskedFields).toHaveLength(0);
  });
});
