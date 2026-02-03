/* eslint-disable @typescript-eslint/ban-ts-comment -- Suppress ts-nocheck warning */
/* eslint-disable @typescript-eslint/no-unused-vars -- Some imports used for type documentation */
/* eslint-disable @typescript-eslint/array-type -- Legacy test code */
// @ts-nocheck - TODO: Fix TypeScript strict mode errors in legacy tests
/**
 * Tests for ParserFilter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parserFilter, createParserFilter } from './parser-filter.js';
import type { FilterContext, RawInvoice, ValidationOptions, StepResult, ExecutionPlan } from '@fiscal-layer/contracts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

// Mock FilterContext factory
function createMockContext(xml: string, options?: Partial<FilterContext>): FilterContext {
  const rawInvoice: RawInvoice = {
    content: xml,
  };

  const validationOptions: ValidationOptions = {};

  const executionPlan: ExecutionPlan = {
    id: 'test-plan',
    name: 'Test Plan',
    version: '1.0.0',
    steps: [],
    createdAt: new Date().toISOString(),
  };

  return {
    runId: 'run-123',
    correlationId: 'cor-123',
    startedAt: new Date().toISOString(),
    rawInvoice,
    parsedInvoice: undefined,
    executionPlan,
    options: validationOptions,
    completedSteps: [],
    diagnostics: [],
    aborted: false,
    abortReason: undefined,
    config: {},
    getStepResult: () => undefined,
    hasExecuted: () => false,
    getFilterConfig: () => undefined,
    ...options,
  };
}

describe('ParserFilter', () => {
  describe('basic execution', () => {
    it('should have correct metadata', () => {
      expect(parserFilter.id).toBe('steps-parser');
      expect(parserFilter.name).toBe('Invoice Parser');
      expect(parserFilter.version).toBe('0.0.1');
      expect(parserFilter.tags).toContain('core');
      expect(parserFilter.tags).toContain('parser');
      expect(parserFilter.tags).toContain('oss');
    });

    it('should return passed status for valid XRechnung', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);

      expect(result.status).toBe('passed');
      expect(result.filterId).toBe('steps-parser');
      expect(result.diagnostics).toHaveLength(0);
    });

    it('should return passed status for valid ZUGFeRD', async () => {
      const xml = readFileSync(join(fixturesDir, 'zugferd-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);

      expect(result.status).toBe('passed');
      expect(result.filterId).toBe('steps-parser');
    });

    it('should include parsed invoice in metadata', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.parsedInvoice).toBeDefined();
      expect(result.metadata?.canonicalInvoice).toBeDefined();
    });

    it('should include detected format in metadata', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);

      expect(result.metadata?.detectedFormat).toBe('xrechnung');
      expect(result.metadata?.documentType).toBe('Invoice');
    });

    it('should include profile and customization ID in metadata', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);

      expect(result.metadata?.customizationId).toContain('xrechnung');
    });
  });

  describe('timing', () => {
    it('should include duration in result', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should return failed status for empty content', async () => {
      const context = createMockContext('');

      const result = await parserFilter.execute(context);

      expect(result.status).toBe('failed');
      // Empty content produces multiple diagnostics: PARSE-001 (empty), PARSE-FORMAT-WARN, PARSE-XML
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(result.diagnostics.some(d => d.code === 'PARSE-001')).toBe(true);
    });

    it('should return failed status for non-XML content', async () => {
      const context = createMockContext('This is not XML content');

      const result = await parserFilter.execute(context);

      expect(result.status).toBe('failed');
      expect(result.diagnostics.some(d => d.code === 'PARSE-002' || d.code === 'PARSE-XML')).toBe(true);
    });

    it('should return failed status for oversized content', async () => {
      // Create content larger than 10MB
      const largeContent = '<?xml version="1.0"?><Invoice>' + 'x'.repeat(11 * 1024 * 1024) + '</Invoice>';
      const context = createMockContext(largeContent);

      const result = await parserFilter.execute(context);

      expect(result.status).toBe('failed');
      expect(result.diagnostics[0]?.code).toBe('PARSE-SIZE');
    });

    it('should sanitize error messages (no file paths)', async () => {
      const context = createMockContext('<?xml version="1.0"?><Invalid><Unclosed>');

      const result = await parserFilter.execute(context);

      // Error message should not contain file paths
      const errorMessages = result.diagnostics.map(d => d.message).join(' ');
      expect(errorMessages).not.toMatch(/\/Users\//);
      expect(errorMessages).not.toMatch(/\/home\//);
      expect(errorMessages).not.toMatch(/C:\\/);
    });
  });

  describe('configuration', () => {
    it('should fail on unknown format when configured', async () => {
      const filter = createParserFilter({ failOnUnknownFormat: true });
      const xml = '<?xml version="1.0"?><UnknownDocument></UnknownDocument>';
      const context = createMockContext(xml);

      const result = await filter.execute(context);

      expect(result.status).toBe('failed');
      expect(result.diagnostics[0]?.code).toBe('PARSE-FORMAT');
    });

    it('should return warning for unknown format with default config', async () => {
      const xml = '<?xml version="1.0"?><UnknownDocument></UnknownDocument>';
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);

      // Should either fail on parse error or warn on format
      expect(['failed', 'warning']).toContain(result.status);
    });

    it('should respect custom max size', async () => {
      const filter = createParserFilter({ maxXmlSize: 100 }); // 100 bytes
      const xml = '<?xml version="1.0"?><Invoice>' + 'x'.repeat(200) + '</Invoice>';
      const context = createMockContext(xml);

      const result = await filter.execute(context);

      expect(result.status).toBe('failed');
      expect(result.diagnostics[0]?.code).toBe('PARSE-SIZE');
    });
  });

  describe('parsed invoice structure', () => {
    it('should convert to ParsedInvoice format', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);
      const parsed = result.metadata?.parsedInvoice as Record<string, unknown>;

      expect(parsed.format).toBe('xrechnung');
      expect(parsed.invoiceNumber).toBe('INV-2024-001');
      expect(parsed.currency).toBe('EUR');
      expect(parsed.totalAmount).toBe(1190);
      expect(parsed.taxAmount).toBe(190);
    });

    it('should include seller info in ParsedInvoice', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);
      const parsed = result.metadata?.parsedInvoice as Record<string, unknown>;
      const seller = parsed.seller as Record<string, unknown>;

      expect(seller.name).toBe('Lieferant GmbH');
      expect(seller.vatId).toBe('DE123456789');
      expect(seller.country).toBe('DE');
    });

    it('should include buyer info in ParsedInvoice', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);
      const parsed = result.metadata?.parsedInvoice as Record<string, unknown>;
      const buyer = parsed.buyer as Record<string, unknown>;

      expect(buyer.name).toBe('Kunde AG');
      expect(buyer.vatId).toBe('DE987654321');
    });

    it('should include line items in ParsedInvoice', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);
      const parsed = result.metadata?.parsedInvoice as Record<string, unknown>;
      const lineItems = parsed.lineItems as Array<Record<string, unknown>>;

      expect(lineItems).toHaveLength(1);
      expect(lineItems[0]?.description).toBe('Beratungsleistung');
      expect(lineItems[0]?.quantity).toBe(10);
      expect(lineItems[0]?.unitPrice).toBe(100);
    });
  });

  describe('privacy - no PII in result', () => {
    it('should not include raw XML in result', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);
      const resultJson = JSON.stringify(result);

      // Should not contain XML fragments
      expect(resultJson).not.toContain('<?xml');
      expect(resultJson).not.toContain('<Invoice');
      expect(resultJson).not.toContain('xmlns:');
    });

    it('should not include temp keys in result', async () => {
      const xml = readFileSync(join(fixturesDir, 'xrechnung-min.xml'), 'utf-8');
      const context = createMockContext(xml);

      const result = await parserFilter.execute(context);
      const resultJson = JSON.stringify(result);

      // Should not contain temp key patterns
      expect(resultJson).not.toMatch(/temp[_-]key/i);
      expect(resultJson).not.toMatch(/invoice[_-]key/i);
    });
  });
});
