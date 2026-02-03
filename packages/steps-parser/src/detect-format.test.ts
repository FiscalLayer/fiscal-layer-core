/* eslint-disable @typescript-eslint/ban-ts-comment -- Suppress ts-nocheck warning */
// @ts-nocheck - TODO: Fix TypeScript strict mode errors in legacy tests
/**
 * Tests for format detection
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { detectInvoiceFormatFromXml } from './detect-format.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

describe('detectInvoiceFormatFromXml', () => {
  describe('XRechnung detection', () => {
    it('should detect XRechnung format from UBL invoice with XRechnung customization ID', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.format).toBe('xrechnung');
      expect(result.documentType).toBe('Invoice');
      expect(result.customizationId).toContain('xrechnung');
      expect(result.warnings).toHaveLength(0);
    });

    it('should extract XRechnung version from customization ID', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.schemaVersion).toBe('3.0');
    });
  });

  describe('ZUGFeRD detection', () => {
    it('should detect ZUGFeRD format from CII invoice with Factur-X profile', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.format).toBe('zugferd');
      expect(result.documentType).toBe('Invoice');
      expect(result.profile).toBeDefined();
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect ZUGFeRD profile level', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const result = detectInvoiceFormatFromXml(xml);

      // EN16931 profile
      expect(result.profile).toBe('EN16931');
    });
  });

  describe('Generic UBL detection', () => {
    it('should detect generic UBL format when no specific profile is present', () => {
      const xml = readFileSync(join(fixturesDir, 'ubl-generic.xml'), 'utf-8');
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.format).toBe('ubl');
      expect(result.documentType).toBe('Invoice');
    });
  });

  describe('Unknown format handling', () => {
    it('should return unknown for empty content', () => {
      const result = detectInvoiceFormatFromXml('');

      expect(result.format).toBe('unknown');
      expect(result.documentType).toBe('Unknown');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.code).toBe('PARSE-001');
    });

    it('should return unknown for non-XML content', () => {
      const result = detectInvoiceFormatFromXml('This is not XML');

      expect(result.format).toBe('unknown');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.code).toBe('PARSE-002');
    });

    it('should return unknown for malformed XML', () => {
      const result = detectInvoiceFormatFromXml('<?xml version="1.0"?><unclosed>');

      // Should detect as unknown since root element doesn't match known formats
      expect(result.format).toBe('unknown');
    });
  });

  describe('Document type detection', () => {
    it('should detect Invoice document type', () => {
      const xml = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"></Invoice>`;
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.documentType).toBe('Invoice');
    });

    it('should detect CreditNote document type', () => {
      const xml = `<?xml version="1.0"?><CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"></CreditNote>`;
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.documentType).toBe('CreditNote');
    });

    it('should detect CrossIndustryInvoice as Invoice', () => {
      const xml = `<?xml version="1.0"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"></rsm:CrossIndustryInvoice>`;
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.documentType).toBe('Invoice');
    });
  });

  describe('Namespace detection', () => {
    it('should detect UBL namespace', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.namespace).toContain('oasis:names:specification:ubl');
    });

    it('should detect CII namespace', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.namespace).toContain('uncefact:data:standard:CrossIndustryInvoice');
    });
  });

  describe('Edge cases', () => {
    it('should handle XML with BOM', () => {
      const bom = '\uFEFF';
      const xml = bom + '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:CustomizationID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID></Invoice>';
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.format).toBe('xrechnung');
    });

    it('should handle XML with DOCTYPE', () => {
      const xml = `<?xml version="1.0"?>
<!DOCTYPE Invoice SYSTEM "invoice.dtd">
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"></Invoice>`;
      const result = detectInvoiceFormatFromXml(xml);

      expect(result.documentType).toBe('Invoice');
    });
  });
});
