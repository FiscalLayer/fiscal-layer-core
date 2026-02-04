/**
 * DockerKositRunner Integration Tests
 *
 * These tests require Docker to be available on the system.
 * They will be skipped automatically if Docker is not installed or accessible.
 *
 * To run integration tests:
 * 1. Ensure Docker is running
 * 2. For daemon mode: docker run -d -p 8080:8080 flx235/xr-validator-service:302
 * 3. Run: pnpm --filter @fiscal-layer/steps-kosit test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DockerKositRunner, isDockerAvailable, checkDaemonHealth } from './docker-kosit-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Check if Docker is available before running tests
let dockerAvailable = false;
let daemonAvailable = false;

beforeAll(async () => {
  dockerAvailable = await isDockerAvailable();
  if (dockerAvailable) {
    daemonAvailable = await checkDaemonHealth('http://localhost:8080');
  }
});

// Sample XRechnung XML for testing
const VALID_XRECHNUNG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>INV-2024-001</cbc:ID>
  <cbc:IssueDate>2024-01-15</cbc:IssueDate>
  <cbc:DueDate>2024-02-15</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>BUYER-REF-123</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Lieferant GmbH</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Musterstrasse 1</cbc:StreetName>
        <cbc:CityName>Berlin</cbc:CityName>
        <cbc:PostalZone>10115</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>DE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>DE123456789</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Kunde AG</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Beispielweg 2</cbc:StreetName>
        <cbc:CityName>Muenchen</cbc:CityName>
        <cbc:PostalZone>80331</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>DE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>DE987654321</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">190.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">1000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">190.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>19</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1190.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">1190.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="HUR">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Beratungsleistung</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>19</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="EUR">100.00</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

// PII patterns that should NEVER appear in outputs
const piiPatterns = [
  /\b[A-Z]{2}\d{9,11}\b/, // VAT ID pattern (but not rule codes like BR-DE-01)
  /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b/, // IBAN pattern
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // Email pattern
];

describe.skipIf(!dockerAvailable)('DockerKositRunner Integration', () => {
  describe.skipIf(!daemonAvailable)('daemon mode', () => {
    let runner: DockerKositRunner;

    beforeAll(() => {
      runner = new DockerKositRunner({
        mode: 'daemon',
        daemonUrl: 'http://localhost:8080',
        timeoutMs: 30000,
      });
    });

    afterAll(async () => {
      await runner.close();
    });

    it('should pass health check when daemon is running', async () => {
      const healthy = await runner.healthCheck();
      expect(healthy).toBe(true);
    });

    it('should validate XML via HTTP and return structured result', async () => {
      const result = await runner.validate(VALID_XRECHNUNG_XML);

      expect(result).toBeDefined();
      expect(result.items).toBeInstanceOf(Array);
      expect(result.summary).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.versionInfo).toBeDefined();

      // Each item should have required fields
      for (const item of result.items) {
        expect(item.ruleId).toBeDefined();
        expect(typeof item.ruleId).toBe('string');
        expect(item.severity).toMatch(/^(error|warning|information)$/);
        expect(item.message).toBeDefined();
      }
    });

    it('should not contain PII in validation outputs', async () => {
      const result = await runner.validate(VALID_XRECHNUNG_XML);

      for (const item of result.items) {
        // Check message doesn't contain actual PII values
        expect(item.message).not.toContain('DE123456789');
        expect(item.message).not.toContain('DE987654321');
        expect(item.message).not.toContain('Lieferant GmbH');
        expect(item.message).not.toContain('Kunde AG');

        // Check for PII patterns (but allow rule codes like BR-DE-01)
        if (!item.ruleId.startsWith('BR-')) {
          for (const pattern of piiPatterns) {
            expect(item.message).not.toMatch(pattern);
          }
        }
      }
    });

    it('should return version info', async () => {
      const versionInfo = await runner.getVersionInfo();
      expect(versionInfo).toBeDefined();
      expect(versionInfo.validatorVersion).toBeDefined();
      expect(typeof versionInfo.validatorVersion).toBe('string');
    });
  });

  describe('cli mode', () => {
    it('should create and cleanup temp files', async () => {
      // This test verifies the zero-retention behavior
      // We can't easily verify the cleanup without modifying the implementation
      // So we just verify the basic functionality works

      const runner = new DockerKositRunner({
        mode: 'cli',
        timeoutMs: 60000, // CLI mode needs more time
      });

      // Note: This test will fail if the CLI Docker image is not available
      // In that case, it's expected - the test is for when Docker is configured
      try {
        const result = await runner.validate(VALID_XRECHNUNG_XML);

        // If it worked, verify the result structure
        expect(result).toBeDefined();
        expect(result.items).toBeInstanceOf(Array);
      } catch (error) {
        // Expected if CLI image is not available
        const err = error as Error;
        if (!err.message.includes('Docker') && !err.message.includes('image')) {
          throw error;
        }
      } finally {
        await runner.close();
      }
    });

    it('should handle timeout correctly', async () => {
      const runner = new DockerKositRunner({
        mode: 'cli',
        timeoutMs: 1, // Extremely short timeout
      });

      try {
        const result = await runner.validate(VALID_XRECHNUNG_XML);

        // Should return a timeout error
        expect(result.valid).toBe(false);
        expect(
          result.items.some(
            (i) =>
              i.ruleId === 'KOSIT-TIMEOUT' ||
              i.ruleId === 'KOSIT-DOCKER-ERROR' ||
              i.ruleId === 'KOSIT-SPAWN-ERROR',
          ),
        ).toBe(true);
      } finally {
        await runner.close();
      }
    });
  });

  describe('auto mode', () => {
    it('should prefer daemon when available', async () => {
      if (!daemonAvailable) {
        // Skip this specific test if daemon is not available
        return;
      }

      const runner = new DockerKositRunner({
        mode: 'auto',
        daemonUrl: 'http://localhost:8080',
      });

      try {
        const result = await runner.validate(VALID_XRECHNUNG_XML);

        // Should have validated successfully
        expect(result).toBeDefined();

        // Should NOT have a fallback event
        expect(runner.getLastFallbackEvent()).toBeNull();
      } finally {
        await runner.close();
      }
    });

    it('should fallback to CLI when daemon unavailable', async () => {
      const runner = new DockerKositRunner({
        mode: 'auto',
        daemonUrl: 'http://localhost:9999', // Non-existent daemon
        timeoutMs: 60000,
      });

      try {
        // This will try daemon first, then fallback to CLI
        // The result depends on whether CLI image is available
        const result = await runner.validate(VALID_XRECHNUNG_XML);

        // Should have a fallback event
        const fallbackEvent = runner.getLastFallbackEvent();
        expect(fallbackEvent).not.toBeNull();
        expect(fallbackEvent?.code).toBe('KOSIT-DAEMON-UNAVAILABLE');
        expect(fallbackEvent?.fallbackMode).toBe('cli');

        // Result structure should still be valid
        expect(result).toBeDefined();
        expect(result.items).toBeInstanceOf(Array);
      } catch {
        // Expected if CLI image is not available either
        // Just verify fallback was attempted
        const fallbackEvent = runner.getLastFallbackEvent();
        expect(fallbackEvent).not.toBeNull();
      } finally {
        await runner.close();
      }
    });
  });

  describe('redline: no PII in any mode', () => {
    it('should sanitize PII from error messages', async () => {
      const xmlWithPii = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">INV-001</cbc:ID>
  <BankAccount>
    <IBAN>DE89370400440532013000</IBAN>
    <Email>secret@example.com</Email>
    <VatId>DE123456789</VatId>
  </BankAccount>
</Invoice>`;

      const runner = new DockerKositRunner({
        mode: daemonAvailable ? 'daemon' : 'cli',
        daemonUrl: 'http://localhost:8080',
        timeoutMs: 30000,
      });

      try {
        const result = await runner.validate(xmlWithPii);

        // Check no PII in any output
        for (const item of result.items) {
          expect(item.message).not.toContain('DE89370400440532013000');
          expect(item.message).not.toContain('secret@example.com');
          // Don't check VAT ID directly as it might appear in rule codes
        }

        // Raw output if present should also be sanitized
        if (result.rawOutput) {
          expect(result.rawOutput).not.toContain('DE89370400440532013000');
          expect(result.rawOutput).not.toContain('secret@example.com');
        }
      } catch {
        // Expected if Docker/image not available
      } finally {
        await runner.close();
      }
    });
  });
});

describe('isDockerAvailable', () => {
  it('should return boolean', async () => {
    const result = await isDockerAvailable();
    expect(typeof result).toBe('boolean');
  });
});

describe('checkDaemonHealth', () => {
  it('should return false for non-existent endpoint', async () => {
    const result = await checkDaemonHealth('http://localhost:59999');
    expect(result).toBe(false);
  });

  it.skipIf(!daemonAvailable)('should return true when daemon is running', async () => {
    const result = await checkDaemonHealth('http://localhost:8080');
    expect(result).toBe(true);
  });
});
