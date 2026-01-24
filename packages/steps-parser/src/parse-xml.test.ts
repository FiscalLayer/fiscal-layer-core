/**
 * Tests for XML to CanonicalInvoice parsing
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseXmlToCanonicalInvoice } from './parse-xml.js';
import { detectInvoiceFormatFromXml } from './detect-format.js';
import type { ParserResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

describe('parseXmlToCanonicalInvoice', () => {
  describe('XRechnung (UBL) parsing', () => {
    it('should parse invoice number from XRechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.invoiceNumber).toBe('INV-2024-001');
    });

    it('should parse issue date from XRechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.issueDate).toBe('2024-01-15');
    });

    it('should parse due date from XRechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.dueDate).toBe('2024-02-15');
    });

    it('should parse currency from XRechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.currencyCode).toBe('EUR');
    });

    it('should parse seller from XRechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.seller.name).toBe('Lieferant GmbH');
      expect(invoice.seller.vatId).toBe('DE123456789');
      expect(invoice.seller.postalAddress?.countryCode).toBe('DE');
      expect(invoice.seller.postalAddress?.cityName).toBe('Berlin');
    });

    it('should parse buyer from XRechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.buyer.name).toBe('Kunde AG');
      expect(invoice.buyer.vatId).toBe('DE987654321');
      expect(invoice.buyer.postalAddress?.countryCode).toBe('DE');
      expect(invoice.buyer.postalAddress?.cityName).toBe('München');
    });

    it('should parse line items from XRechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.lineItems).toHaveLength(1);
      const line = invoice.lineItems[0];
      expect(line?.id).toBe('1');
      expect(line?.description).toBe('Beratungsleistung');
      expect(line?.quantity).toBe('10');
      expect(line?.unitCode).toBe('HUR');
      // fast-xml-parser with parseTagValue: true converts '100.00' to 100 (number)
      // String(100) = '100', so trailing zeros are lost
      expect(line?.unitPrice).toBe('100');
      expect(line?.lineNetAmount).toBe('1000');
    });

    it('should parse totals from XRechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      // fast-xml-parser converts numeric strings to numbers, losing trailing zeros
      expect(invoice.totals.lineExtensionAmount).toBe('1000');
      expect(invoice.totals.taxExclusiveAmount).toBe('1000');
      expect(invoice.totals.taxAmount).toBe('190');
      expect(invoice.totals.taxInclusiveAmount).toBe('1190');
      expect(invoice.totals.payableAmount).toBe('1190');
    });

    it('should parse tax breakdown from XRechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.totals.taxBreakdown).toHaveLength(1);
      const tax = invoice.totals.taxBreakdown[0];
      expect(tax?.code).toBe('S');
      expect(tax?.rate).toBe('19');
      expect(tax?.taxableAmount).toBe('1000');
      expect(tax?.taxAmount).toBe('190');
    });

    it('should parse buyer reference from XRechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.buyerReference).toBe('BUYER-REF-123');
    });

    it('should set original format to xrechnung', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.originalFormat).toBe('xrechnung');
    });

    it('should include parser metadata', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice._meta).toBeDefined();
      expect(invoice._meta?.parserVersion).toBe('0.0.1');
      expect(invoice._meta?.parsedAt).toBeDefined();
    });
  });

  describe('ZUGFeRD (CII) parsing', () => {
    it('should parse invoice number from ZUGFeRD', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.invoiceNumber).toBe('ZF-2024-001');
    });

    it('should parse issue date from ZUGFeRD (YYYYMMDD format)', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.issueDate).toBe('2024-01-15');
    });

    it('should parse due date from ZUGFeRD', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.dueDate).toBe('2024-02-15');
    });

    it('should parse currency from ZUGFeRD', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.currencyCode).toBe('EUR');
    });

    it('should parse seller from ZUGFeRD', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.seller.name).toBe('Verkäufer GmbH');
      expect(invoice.seller.vatId).toBe('DE111222333');
      expect(invoice.seller.postalAddress?.countryCode).toBe('DE');
    });

    it('should parse buyer from ZUGFeRD', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.buyer.name).toBe('Käufer AG');
      expect(invoice.buyer.vatId).toBe('DE444555666');
    });

    it('should parse line items from ZUGFeRD', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.lineItems).toHaveLength(1);
      const line = invoice.lineItems[0];
      expect(line?.id).toBe('1');
      expect(line?.description).toBe('Softwarelizenz');
      expect(line?.quantity).toBe('1');
      // fast-xml-parser converts numeric strings to numbers, losing trailing zeros
      expect(line?.unitPrice).toBe('500');
      expect(line?.lineNetAmount).toBe('500');
    });

    it('should parse totals from ZUGFeRD', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      // fast-xml-parser converts numeric strings to numbers, losing trailing zeros
      expect(invoice.totals.lineExtensionAmount).toBe('500');
      expect(invoice.totals.taxAmount).toBe('95');
      expect(invoice.totals.taxInclusiveAmount).toBe('595');
      expect(invoice.totals.payableAmount).toBe('595');
    });

    it('should parse notes from ZUGFeRD', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.notes).toBeDefined();
      expect(invoice.notes).toContain('ZUGFeRD/Factur-X Test Invoice');
    });

    it('should set original format to zugferd', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.originalFormat).toBe('zugferd');
    });
  });

  describe('Generic UBL parsing', () => {
    it('should parse basic invoice from generic UBL', () => {
      const xml = readFileSync(join(fixturesDir, 'ubl-generic.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      expect(invoice.invoiceNumber).toBe('UBL-2024-001');
      expect(invoice.issueDate).toBe('2024-01-20');
      expect(invoice.currencyCode).toBe('EUR');
      expect(invoice.seller.name).toBe('Generic Supplier Ltd');
      expect(invoice.buyer.name).toBe('Generic Buyer Inc');
    });
  });

  describe('Error handling', () => {
    it('should throw error for non-XML content', () => {
      const formatResult: ParserResult = {
        format: 'unknown',
        documentType: 'Unknown',
        warnings: [],
      };

      expect(() => parseXmlToCanonicalInvoice('not xml', formatResult))
        .toThrow();
    });

    it('should throw error for unsupported root element', () => {
      const xml = '<?xml version="1.0"?><UnsupportedDocument></UnsupportedDocument>';
      const formatResult: ParserResult = {
        format: 'unknown',
        documentType: 'Unknown',
        warnings: [],
      };

      expect(() => parseXmlToCanonicalInvoice(xml, formatResult))
        .toThrow(/Unsupported root element/);
    });
  });

  describe('Decimal handling', () => {
    it('should preserve decimal precision as strings', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      // All monetary values should be strings, not floats
      expect(typeof invoice.totals.payableAmount).toBe('string');
      expect(typeof invoice.lineItems[0]?.unitPrice).toBe('string');
      expect(typeof invoice.lineItems[0]?.quantity).toBe('string');
    });
  });

  /**
   * CRITICAL: Amount Type Enforcement Tests
   *
   * All DecimalAmount fields in CanonicalInvoice MUST be strings.
   * This prevents floating-point precision errors in financial calculations.
   *
   * @see https://docs.fiscallayer.com/architecture/decimal-handling
   */
  describe('Amount Type Enforcement (DecimalAmount = string)', () => {
    it('all totals amounts must be string type (XRechnung)', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      // MonetaryTotals - all required fields
      expect(typeof invoice.totals.lineExtensionAmount).toBe('string');
      expect(typeof invoice.totals.taxExclusiveAmount).toBe('string');
      expect(typeof invoice.totals.taxAmount).toBe('string');
      expect(typeof invoice.totals.taxInclusiveAmount).toBe('string');
      expect(typeof invoice.totals.payableAmount).toBe('string');

      // Optional totals fields should be string if present
      if (invoice.totals.allowanceTotalAmount !== undefined) {
        expect(typeof invoice.totals.allowanceTotalAmount).toBe('string');
      }
      if (invoice.totals.chargeTotalAmount !== undefined) {
        expect(typeof invoice.totals.chargeTotalAmount).toBe('string');
      }
      if (invoice.totals.prepaidAmount !== undefined) {
        expect(typeof invoice.totals.prepaidAmount).toBe('string');
      }
      if (invoice.totals.roundingAmount !== undefined) {
        expect(typeof invoice.totals.roundingAmount).toBe('string');
      }
    });

    it('all line item amounts must be string type (XRechnung)', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      for (const line of invoice.lineItems) {
        // Required line item amounts
        expect(typeof line.quantity, `Line ${line.id} quantity must be string`).toBe('string');
        expect(typeof line.unitPrice, `Line ${line.id} unitPrice must be string`).toBe('string');
        expect(typeof line.lineNetAmount, `Line ${line.id} lineNetAmount must be string`).toBe('string');

        // Optional amounts
        if (line.baseQuantity !== undefined) {
          expect(typeof line.baseQuantity, `Line ${line.id} baseQuantity must be string`).toBe('string');
        }

        // Tax category amounts
        expect(typeof line.taxCategory.rate, `Line ${line.id} taxCategory.rate must be string`).toBe('string');
        expect(typeof line.taxCategory.taxableAmount, `Line ${line.id} taxCategory.taxableAmount must be string`).toBe('string');
        expect(typeof line.taxCategory.taxAmount, `Line ${line.id} taxCategory.taxAmount must be string`).toBe('string');
      }
    });

    it('all tax breakdown amounts must be string type (XRechnung)', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      for (const tax of invoice.totals.taxBreakdown) {
        expect(typeof tax.rate, `Tax ${tax.code} rate must be string`).toBe('string');
        expect(typeof tax.taxableAmount, `Tax ${tax.code} taxableAmount must be string`).toBe('string');
        expect(typeof tax.taxAmount, `Tax ${tax.code} taxAmount must be string`).toBe('string');
      }
    });

    it('all totals amounts must be string type (ZUGFeRD)', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      // MonetaryTotals
      expect(typeof invoice.totals.lineExtensionAmount).toBe('string');
      expect(typeof invoice.totals.taxExclusiveAmount).toBe('string');
      expect(typeof invoice.totals.taxAmount).toBe('string');
      expect(typeof invoice.totals.taxInclusiveAmount).toBe('string');
      expect(typeof invoice.totals.payableAmount).toBe('string');
    });

    it('all line item amounts must be string type (ZUGFeRD)', () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      for (const line of invoice.lineItems) {
        expect(typeof line.quantity, `Line ${line.id} quantity must be string`).toBe('string');
        expect(typeof line.unitPrice, `Line ${line.id} unitPrice must be string`).toBe('string');
        expect(typeof line.lineNetAmount, `Line ${line.id} lineNetAmount must be string`).toBe('string');

        expect(typeof line.taxCategory.rate, `Line ${line.id} taxCategory.rate must be string`).toBe('string');
        expect(typeof line.taxCategory.taxableAmount, `Line ${line.id} taxCategory.taxableAmount must be string`).toBe('string');
        expect(typeof line.taxCategory.taxAmount, `Line ${line.id} taxCategory.taxAmount must be string`).toBe('string');
      }
    });

    it('amounts should never be NaN', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      // Totals should parse to valid numbers
      expect(isNaN(parseFloat(invoice.totals.payableAmount))).toBe(false);
      expect(isNaN(parseFloat(invoice.totals.taxAmount))).toBe(false);
      expect(isNaN(parseFloat(invoice.totals.lineExtensionAmount))).toBe(false);

      // Line items should parse to valid numbers
      for (const line of invoice.lineItems) {
        expect(isNaN(parseFloat(line.quantity))).toBe(false);
        expect(isNaN(parseFloat(line.unitPrice))).toBe(false);
        expect(isNaN(parseFloat(line.lineNetAmount))).toBe(false);
      }
    });

    it('amounts should not contain currency symbols or invalid characters', () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const formatResult = detectInvoiceFormatFromXml(xml);
      const invoice = parseXmlToCanonicalInvoice(xml, formatResult);

      const validDecimalPattern = /^-?\d*\.?\d+$/;

      expect(invoice.totals.payableAmount).toMatch(validDecimalPattern);
      expect(invoice.totals.taxAmount).toMatch(validDecimalPattern);
      expect(invoice.totals.lineExtensionAmount).toMatch(validDecimalPattern);

      for (const line of invoice.lineItems) {
        expect(line.quantity).toMatch(validDecimalPattern);
        expect(line.unitPrice).toMatch(validDecimalPattern);
        expect(line.lineNetAmount).toMatch(validDecimalPattern);
      }
    });
  });
});
