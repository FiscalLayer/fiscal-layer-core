import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryTempStore } from './memory-temp-store.js';

describe('MemoryTempStore', () => {
  let store: MemoryTempStore;

  beforeEach(() => {
    store = new MemoryTempStore({ cleanupIntervalMs: 100 });
  });

  afterEach(async () => {
    await store.close();
  });

  describe('Basic operations', () => {
    it('should store and retrieve data', async () => {
      await store.set('key1', { data: 'test' });
      const result = await store.get('key1');
      expect(result).toEqual({ data: 'test' });
    });

    it('should return undefined for non-existent keys', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeUndefined();
    });

    it('should check key existence', async () => {
      await store.set('exists', 'value');
      expect(await store.has('exists')).toBe(true);
      expect(await store.has('not-exists')).toBe(false);
    });

    it('should delete entries', async () => {
      await store.set('to-delete', 'value');
      expect(await store.has('to-delete')).toBe(true);

      const deleted = await store.delete('to-delete');
      expect(deleted).toBe(true);
      expect(await store.has('to-delete')).toBe(false);
    });
  });

  describe('TTL functionality', () => {
    it('should expire entries after TTL', async () => {
      await store.set('short-lived', 'data', { ttlMs: 50 });

      // Immediately available
      expect(await store.get('short-lived')).toBe('data');

      // Wait for TTL
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should be expired
      expect(await store.get('short-lived')).toBeUndefined();
    });

    it('should report correct TTL', async () => {
      await store.set('check-ttl', 'data', { ttlMs: 1000 });

      const ttl = await store.ttl('check-ttl');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(1000);
    });

    it('should extend TTL', async () => {
      await store.set('extend-me', 'data', { ttlMs: 100 });

      const originalTtl = await store.ttl('extend-me');
      await store.extendTtl('extend-me', 500);
      const newTtl = await store.ttl('extend-me');

      expect(newTtl).toBeGreaterThan(originalTtl);
    });

    it('should return -1 TTL for expired keys', async () => {
      await store.set('will-expire', 'data', { ttlMs: 10 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const ttl = await store.ttl('will-expire');
      expect(ttl).toBe(-1);
    });
  });

  describe('Secure deletion', () => {
    it('should securely delete string data', async () => {
      const sensitiveData = 'DE89370400440532013000'; // IBAN
      await store.set('iban', sensitiveData);

      const deleted = await store.secureDelete('iban');
      expect(deleted).toBe(true);
      expect(await store.get('iban')).toBeUndefined();
    });

    it('should securely delete object data', async () => {
      const sensitiveObject = {
        email: 'test@example.com',
        phone: '+49 123 456789',
        iban: 'DE89370400440532013000',
      };
      await store.set('pii', sensitiveObject);

      const deleted = await store.secureDelete('pii');
      expect(deleted).toBe(true);
      expect(await store.get('pii')).toBeUndefined();
    });
  });

  describe('Category tracking', () => {
    it('should track entries by category', async () => {
      await store.set('raw1', 'xml1', { category: 'raw-invoice' });
      await store.set('raw2', 'xml2', { category: 'raw-invoice' });
      await store.set('parsed1', {}, { category: 'parsed-invoice' });

      const stats = await store.stats();
      expect(stats.byCategory['raw-invoice']).toBe(2);
      expect(stats.byCategory['parsed-invoice']).toBe(1);
    });
  });

  describe('Cleanup', () => {
    it('should clean up expired entries', async () => {
      await store.set('expire1', 'a', { ttlMs: 10 });
      await store.set('expire2', 'b', { ttlMs: 10 });
      await store.set('keep', 'c', { ttlMs: 10000 });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const cleaned = await store.cleanup();
      expect(cleaned).toBe(2);

      expect(await store.has('expire1')).toBe(false);
      expect(await store.has('expire2')).toBe(false);
      expect(await store.has('keep')).toBe(true);
    });

    it('should auto-cleanup sensitive categories on close', async () => {
      await store.set('raw', 'sensitive', { category: 'raw-invoice', ttlMs: 60000 });
      await store.set('parsed', {}, { category: 'parsed-invoice', ttlMs: 60000 });

      await store.close();

      // Store is closed, entries should be cleared
      expect(store.size).toBe(0);
    });
  });
});

describe('Red Line Tests - Temporal Boundaries', () => {
  /**
   * These tests verify that raw invoice data is NEVER accessible after TTL expiration.
   * This is a critical privacy requirement.
   */

  it('RAW INVOICE MUST NOT be accessible after TTL', async () => {
    const store = new MemoryTempStore({ cleanupIntervalMs: 50 });

    try {
      const rawInvoice = `
        <Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
          <cbc:ID>INV-001</cbc:ID>
          <cac:AccountingSupplierParty>
            <cbc:Name>Sensitive Company GmbH</cbc:Name>
            <cbc:CompanyID>DE123456789</cbc:CompanyID>
            <cbc:IBAN>DE89370400440532013000</cbc:IBAN>
          </cac:AccountingSupplierParty>
        </Invoice>
      `;

      // Store with 60 second TTL (production default)
      await store.set('invoice:test', rawInvoice, {
        category: 'raw-invoice',
        ttlMs: 50, // Short TTL for test
      });

      // Initially accessible
      const before = await store.get('invoice:test');
      expect(before).toContain('DE89370400440532013000');

      // Wait for TTL + cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      // MUST NOT be accessible after TTL
      const after = await store.get('invoice:test');
      expect(after).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it('PARSED INVOICE MUST NOT be accessible after TTL', async () => {
    const store = new MemoryTempStore({ cleanupIntervalMs: 50 });

    try {
      const parsedInvoice = {
        invoiceNumber: 'INV-001',
        seller: {
          name: 'Sensitive Company GmbH',
          vatId: 'DE123456789',
          iban: 'DE89370400440532013000',
          email: 'billing@sensitive.de',
        },
        buyer: {
          name: 'Customer AG',
          email: 'accounting@customer.de',
        },
      };

      await store.set('parsed:test', parsedInvoice, {
        category: 'parsed-invoice',
        ttlMs: 50,
      });

      // Wait for TTL + cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      // MUST NOT be accessible
      const after = await store.get('parsed:test');
      expect(after).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it('should securely delete raw invoice on manual delete', async () => {
    const store = new MemoryTempStore();

    try {
      const sensitiveXml = '<Invoice><IBAN>DE89370400440532013000</IBAN></Invoice>';

      await store.set('to-delete', sensitiveXml, { category: 'raw-invoice' });

      // Secure delete
      await store.secureDelete('to-delete');

      // Verify inaccessible
      expect(await store.get('to-delete')).toBeUndefined();
      expect(await store.has('to-delete')).toBe(false);
    } finally {
      await store.close();
    }
  });
});
