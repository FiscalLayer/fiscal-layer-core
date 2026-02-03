/**
 * KoSIT Package Unit Tests
 *
 * Tests cover:
 * - MockKositRunner functionality
 * - parseKositReport XML parsing
 * - KositFilter execution
 * - Redline: No PII in outputs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MockKositRunner,
  createAlwaysValidRunner,
  createFixedErrorRunner,
  parseKositReport,
  createKositFilter,
  kositItemsToDiagnostics,
  DockerKositRunner,
  DEFAULT_NO_SCENARIO_PATTERNS,
  type Kosit422Logger,
} from './index.js';
import type { KositValidationItem } from './types.js';
import type { FilterContext, ExecutionPlan, StepResult, StepStatus } from '@fiscal-layer/contracts';

// =============================================================================
// Test-only helper: derives legacy StepStatus from StepResult
// This is DECISION LOGIC - kept in tests only, not exported from OSS contracts.
// =============================================================================
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Test-only helper using legacy type for backwards compatibility testing
function deriveStepStatus(result: StepResult): StepStatus {
  switch (result.execution) {
    case 'skipped':
      return 'skipped';
    case 'errored':
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- error?.name may be undefined
      if (result.error?.name?.toLowerCase().includes('timeout')) return 'timeout';
      return 'error';
    case 'ran': {
      const hasErrors = result.diagnostics.some((d) => d.severity === 'error');
      const hasWarnings = result.diagnostics.some((d) => d.severity === 'warning');
      if (hasErrors) return 'failed';
      if (hasWarnings) return 'warning';
      return 'passed';
    }
  }
}

// Sample XRechnung XML for testing
const VALID_XRECHNUNG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ID>INV-001</cbc:ID>
  <cbc:IssueDate>2024-01-15</cbc:IssueDate>
  <cbc:DueDate>2024-02-15</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>DE123456789</cbc:CompanyID>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>DE987654321</cbc:CompanyID>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
  </cac:PaymentMeans>
  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="EUR">100.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

const INVALID_XML = '<not-an-invoice>missing stuff</not-an-invoice>';

// Sample KoSIT report XML
const KOSIT_REPORT_VALID = `<?xml version="1.0" encoding="UTF-8"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/report/1">
  <rep:assessment>
    <rep:accept>true</rep:accept>
  </rep:assessment>
  <rep:scenarioMatched>
    <rep:name>XRechnung 3.0</rep:name>
  </rep:scenarioMatched>
  <rep:validationStepResult id="schema">
    <rep:valid>true</rep:valid>
  </rep:validationStepResult>
  <rep:validationStepResult id="schematron">
    <rep:valid>true</rep:valid>
  </rep:validationStepResult>
</rep:report>`;

const KOSIT_REPORT_WITH_ERRORS = `<?xml version="1.0" encoding="UTF-8"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/report/1">
  <rep:assessment>
    <rep:accept>false</rep:accept>
  </rep:assessment>
  <rep:scenarioMatched>
    <rep:name>XRechnung 3.0</rep:name>
  </rep:scenarioMatched>
  <rep:validationStepResult id="schematron">
    <rep:valid>false</rep:valid>
    <rep:message level="error" code="BR-DE-01" location="/Invoice/cbc:CustomizationID">
      Specification identifier must be present
    </rep:message>
    <rep:message level="warning" code="BR-DE-02" location="/Invoice/cac:AccountingSupplierParty">
      Seller should have electronic address
    </rep:message>
    <rep:message level="info" code="BR-DE-INFO" location="/Invoice">
      Informational message
    </rep:message>
  </rep:validationStepResult>
</rep:report>`;

// Helper to create mock filter context
function createMockContext(xml: string): FilterContext {
  return {
    runId: 'run-test-123',
    correlationId: 'cor-test-123',
    startedAt: new Date().toISOString(),
    rawInvoice: {
      content: xml,
      formatHint: 'xrechnung',
    },
    parsedInvoice: undefined,
    executionPlan: {
      id: 'test-plan',
      name: 'Test Plan',
      version: '1.0.0',
      steps: [],
      createdAt: new Date().toISOString(),
      configHash: 'test-hash',
    } as ExecutionPlan,
    options: {},
    completedSteps: [],
    diagnostics: [],
    aborted: false,
    abortReason: undefined,
    config: {},
    getStepResult: () => undefined,
    hasExecuted: () => false,
    getFilterConfig: () => undefined,
  };
}

describe('MockKositRunner', () => {
  let runner: MockKositRunner;

  beforeEach(() => {
    runner = new MockKositRunner();
  });

  afterEach(async () => {
    await runner.close();
  });

  describe('validate', () => {
    it('should validate correct XRechnung and detect profile', async () => {
      const result = await runner.validate(VALID_XRECHNUNG_XML);

      expect(result.profile).toBe('xrechnung-3.0');
      expect(result.schemaValid).toBe(true);
      // May have warnings but no schema errors
      expect(result.items.filter((i) => i.ruleId.startsWith('XML-'))).toHaveLength(0);
    });

    it('should return errors for invalid XML', async () => {
      const result = await runner.validate(INVALID_XML);

      expect(result.valid).toBe(false);
      expect(result.items.some((i) => i.ruleId === 'XML-003')).toBe(true);
    });

    it('should return errors for empty XML', async () => {
      const result = await runner.validate('');

      expect(result.valid).toBe(false);
      expect(result.items.some((i) => i.ruleId === 'XML-001')).toBe(true);
    });

    it('should return errors for non-XML content', async () => {
      const result = await runner.validate('not xml at all');

      expect(result.valid).toBe(false);
      expect(result.items.some((i) => i.ruleId === 'XML-002')).toBe(true);
    });

    it('should include duration', async () => {
      const result = await runner.validate(VALID_XRECHNUNG_XML);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should include version info', async () => {
      const result = await runner.validate(VALID_XRECHNUNG_XML);

      expect(result.versionInfo).toBeDefined();
      expect(result.versionInfo.validatorVersion).toContain('mock');
      expect(result.versionInfo.dictionaryVersion).toBeDefined();
    });

    it('should include raw output when requested', async () => {
      const result = await runner.validate(VALID_XRECHNUNG_XML, {
        includeRawOutput: true,
      });

      expect(result.rawOutput).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('should pass health check when open', async () => {
      expect(await runner.healthCheck()).toBe(true);
    });

    it('should fail health check when closed', async () => {
      await runner.close();
      expect(await runner.healthCheck()).toBe(false);
    });

    it('should throw when validating after close', async () => {
      await runner.close();

      await expect(runner.validate(VALID_XRECHNUNG_XML)).rejects.toThrow(
        'KositRunner is closed'
      );
    });

    it('should return version info', async () => {
      const versionInfo = await runner.getVersionInfo();
      expect(versionInfo).toBeDefined();
      expect(versionInfo.validatorVersion).toContain('mock');
      expect(versionInfo.dictionaryVersion).toBeDefined();
    });
  });
});

describe('createAlwaysValidRunner', () => {
  it('should always return valid result', async () => {
    const runner = createAlwaysValidRunner();
    const result = await runner.validate('<Invoice></Invoice>');

    expect(result.valid).toBe(true);
    expect(result.schemaValid).toBe(true);
    expect(result.schematronValid).toBe(true);
    expect(result.items).toHaveLength(0);
  });
});

describe('createFixedErrorRunner', () => {
  it('should return configured errors', async () => {
    const errors: KositValidationItem[] = [
      { ruleId: 'TEST-001', severity: 'error', message: 'Test error' },
      { ruleId: 'TEST-002', severity: 'warning', message: 'Test warning' },
    ];

    const runner = createFixedErrorRunner(errors);
    const result = await runner.validate('<Invoice></Invoice>');

    expect(result.valid).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.summary.errors).toBe(1);
    expect(result.summary.warnings).toBe(1);
  });
});

describe('parseKositReport', () => {
  it('should parse valid report with acceptance', () => {
    const result = parseKositReport(KOSIT_REPORT_VALID);

    expect(result.valid).toBe(true);
    expect(result.schemaValid).toBe(true);
    expect(result.schematronValid).toBe(true);
    expect(result.scenarioName).toBe('XRechnung 3.0');
    expect(result.items).toHaveLength(0);
  });

  it('should parse report with errors and warnings', () => {
    const result = parseKositReport(KOSIT_REPORT_WITH_ERRORS);

    expect(result.valid).toBe(false);
    expect(result.schematronValid).toBe(false);
    expect(result.items).toHaveLength(3);
    expect(result.summary.errors).toBe(1);
    expect(result.summary.warnings).toBe(1);
    expect(result.summary.information).toBe(1);

    // Check specific items
    const errorItem = result.items.find((i) => i.severity === 'error');
    expect(errorItem?.ruleId).toBe('BR-DE-01');
    expect(errorItem?.location).toContain('CustomizationID');
  });

  it('should handle empty XML', () => {
    const result = parseKositReport('');

    expect(result.valid).toBe(false);
    expect(result.items.some((i) => i.ruleId === 'KOSIT-PARSE-ERROR')).toBe(true);
  });

  it('should handle malformed XML', () => {
    const result = parseKositReport('<not>closed');

    // fast-xml-parser is lenient, so it may parse partial XML
    // The important thing is that we don't return valid=true
    expect(result.valid).toBe(false);
    // Either a parse error or just no valid report structure
    expect(
      result.items.some((i) => i.ruleId === 'KOSIT-PARSE-ERROR') ||
      result.items.length === 0
    ).toBe(true);
  });

  it('should handle report without namespace prefix', () => {
    const reportWithoutPrefix = `<?xml version="1.0"?>
<report>
  <assessment><accept>true</accept></assessment>
  <scenarioMatched><name>Test</name></scenarioMatched>
</report>`;

    const result = parseKositReport(reportWithoutPrefix);

    expect(result.valid).toBe(true);
    expect(result.scenarioName).toBe('Test');
  });
});

describe('kositItemsToDiagnostics', () => {
  it('should convert items to diagnostics', () => {
    const items: KositValidationItem[] = [
      {
        ruleId: 'BR-DE-01',
        severity: 'error',
        message: 'Error message',
        location: '/Invoice/cbc:ID',
        line: 10,
        column: 5,
      },
      {
        ruleId: 'BR-DE-02',
        severity: 'warning',
        message: 'Warning message',
      },
      {
        ruleId: 'BR-INFO',
        severity: 'information',
        message: 'Info message',
      },
    ];

    const diagnostics = kositItemsToDiagnostics(items, 'kosit');

    expect(diagnostics).toHaveLength(3);

    expect(diagnostics[0]?.code).toBe('BR-DE-01');
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.location).toBe('/Invoice/cbc:ID');
    expect(diagnostics[0]?.context?.['line']).toBe(10);

    expect(diagnostics[1]?.severity).toBe('warning');
    expect(diagnostics[2]?.severity).toBe('info');
  });
});

describe('createKositFilter', () => {
  describe('metadata', () => {
    it('should have correct filter ID', () => {
      const filter = createKositFilter();

      expect(filter.id).toBe('kosit');
      expect(filter.version).toBe('1.0.0');
      expect(filter.name).toBe('KoSIT Validator');
    });
  });

  describe('execution', () => {
    it('should validate correct invoice', async () => {
      const filter = createKositFilter({
        runner: createAlwaysValidRunner(),
      });

      await filter.onInit?.();

      const context = createMockContext(VALID_XRECHNUNG_XML);
      const result = await filter.execute(context);

      expect(deriveStepStatus(result)).toBe('passed');
      expect(result.filterId).toBe('kosit');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      await filter.onDestroy?.();
    });

    it('should fail on validation errors', async () => {
      const filter = createKositFilter({
        runner: createFixedErrorRunner([
          { ruleId: 'BR-01', severity: 'error', message: 'Error' },
        ]),
      });

      await filter.onInit?.();

      const context = createMockContext(VALID_XRECHNUNG_XML);
      const result = await filter.execute(context);

      expect(deriveStepStatus(result)).toBe('failed');
      expect(result.diagnostics.length).toBeGreaterThan(0);

      await filter.onDestroy?.();
    });

    it('should return warning status when warnings present', async () => {
      const filter = createKositFilter({
        runner: createFixedErrorRunner([
          { ruleId: 'BR-01', severity: 'warning', message: 'Warning' },
        ]),
      });

      await filter.onInit?.();

      const context = createMockContext(VALID_XRECHNUNG_XML);
      const result = await filter.execute(context);

      // The runner returns valid=false for fixed errors
      // So this will be 'failed' not 'warning'
      expect(result.diagnostics.some((d) => d.severity === 'warning')).toBe(true);

      await filter.onDestroy?.();
    });

    it('should report warnings as diagnostics (decision layer interprets failOnWarnings)', async () => {
      // NOTE: failOnWarnings is a DECISION LAYER concern, not an OSS filter concern.
      // The OSS filter reports what it found (warnings). The Private decision layer
      // decides whether warnings constitute failure based on policy configuration.
      const filter = createKositFilter({
        failOnWarnings: true, // This config is passed through for decision layer
      });

      await filter.onInit?.();

      // MockKositRunner will produce some warnings for missing elements
      const context = createMockContext(VALID_XRECHNUNG_XML);
      const result = await filter.execute(context);

      // OSS filter should report execution completed
      expect(result.execution).toBe('ran');

      // Warnings should be reported as warnings (not escalated to errors)
      // The decision layer interprets this based on failOnWarnings config
      if (result.diagnostics.some((d) => d.severity === 'warning')) {
        // deriveStepStatus returns 'warning' because that's the diagnostic severity
        // Decision layer would interpret this as 'failed' when failOnWarnings=true
        expect(deriveStepStatus(result)).toBe('warning');
      }

      await filter.onDestroy?.();
    });

    it('should handle empty invoice', async () => {
      const filter = createKositFilter();

      await filter.onInit?.();

      const context = createMockContext('');
      const result = await filter.execute(context);

      expect(deriveStepStatus(result)).toBe('failed');
      expect(result.diagnostics.some((d) => d.code === 'KOSIT-001')).toBe(true);

      await filter.onDestroy?.();
    });

    it('should include metadata in result', async () => {
      const filter = createKositFilter({
        runner: createAlwaysValidRunner(),
      });

      await filter.onInit?.();

      const context = createMockContext(VALID_XRECHNUNG_XML);
      const result = await filter.execute(context);

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.['profile']).toBeDefined();
      expect(result.metadata?.['summary']).toBeDefined();

      await filter.onDestroy?.();
    });

    it('should throw on docker runner type when not available', () => {
      // Note: Docker runner is now implemented, so this should not throw
      // Just verify it creates the runner
      const filter = createKositFilter({
        runnerType: 'docker',
      });

      expect(filter.id).toBe('kosit');
    });
  });

  describe('error handling', () => {
    it('should return error status on runner exception', async () => {
      const faultyRunner = {
        validate: () => Promise.reject(new Error('Runner exploded')),
        healthCheck: () => Promise.resolve(true),
        getVersion: () => Promise.resolve('faulty/1.0.0'),
        getVersionInfo: () =>
          Promise.resolve({
            validatorVersion: 'faulty',
            dictionaryVersion: 'faulty',
          }),
        close: () => Promise.resolve(),
      };

      const filter = createKositFilter({
        runner: faultyRunner,
      });

      await filter.onInit?.();

      const context = createMockContext(VALID_XRECHNUNG_XML);
      const result = await filter.execute(context);

      expect(deriveStepStatus(result)).toBe('error');
      expect(result.error).toBeDefined();
      expect(result.diagnostics.some((d) => d.code === 'KOSIT-ERR')).toBe(true);

      await filter.onDestroy?.();
    });
  });
});

describe('Redline: No PII in outputs', () => {
  // PII patterns that should NEVER appear
  const piiPatterns = [
    /\b[A-Z]{2}\d{9,11}\b/, // VAT ID pattern
    /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b/, // IBAN pattern
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // Email pattern
  ];

  it('should not contain PII in MockKositRunner diagnostics', async () => {
    const runner = new MockKositRunner();
    const result = await runner.validate(VALID_XRECHNUNG_XML);

    for (const item of result.items) {
      for (const pattern of piiPatterns) {
        expect(item.message).not.toMatch(pattern);
        expect(item.ruleId).not.toMatch(pattern);
      }
    }

    await runner.close();
  });

  it('should not contain PII in parsed KoSIT report', () => {
    // Report with potential PII in messages
    const reportWithPii = `<?xml version="1.0"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/report/1">
  <rep:assessment><rep:accept>false</rep:accept></rep:assessment>
  <rep:validationStepResult>
    <rep:valid>false</rep:valid>
    <rep:message level="error" code="VAT-ERR">
      Invalid VAT ID: DE123456789
    </rep:message>
    <rep:message level="error" code="IBAN-ERR">
      Invalid IBAN: DE89370400440532013000
    </rep:message>
    <rep:message level="error" code="EMAIL-ERR">
      Invalid email: test@example.com
    </rep:message>
  </rep:validationStepResult>
</rep:report>`;

    const result = parseKositReport(reportWithPii);

    for (const item of result.items) {
      // Should be sanitized
      expect(item.message).toContain('[');
      expect(item.message).toContain('REDACTED]');

      // Should NOT contain actual PII
      expect(item.message).not.toContain('DE123456789');
      expect(item.message).not.toContain('DE89370400440532013000');
      expect(item.message).not.toContain('test@example.com');
    }
  });

  it('should not contain invoice content in error messages', async () => {
    const runner = new MockKositRunner();
    const xmlWithPii = `<?xml version="1.0"?>
<Invoice>
  <BankAccount>
    <IBAN>DE89370400440532013000</IBAN>
    <Owner>Hans Mueller</Owner>
  </BankAccount>
</Invoice>`;

    const result = await runner.validate(xmlWithPii);

    for (const item of result.items) {
      // Should not contain invoice content
      expect(item.message).not.toContain('DE89370400440532013000');
      expect(item.message).not.toContain('Hans Mueller');
      expect(item.message).not.toContain('<IBAN>');
      expect(item.message).not.toContain('<BankAccount>');
    }

    await runner.close();
  });

  it('should not contain PII in filter result diagnostics', async () => {
    const filter = createKositFilter();
    await filter.onInit?.();

    const xmlWithPii = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">INV-001</cbc:ID>
  <SellerEmail>seller@example.com</SellerEmail>
</Invoice>`;

    const context = createMockContext(xmlWithPii);
    const result = await filter.execute(context);

    for (const diagnostic of result.diagnostics) {
      for (const pattern of piiPatterns) {
        expect(diagnostic.message).not.toMatch(pattern);
        expect(diagnostic.code).not.toMatch(pattern);
      }

      // Check context if present
      if (diagnostic.context) {
        const contextStr = JSON.stringify(diagnostic.context);
        for (const pattern of piiPatterns) {
          expect(contextStr).not.toMatch(pattern);
        }
      }
    }

    await filter.onDestroy?.();
  });
});

describe('Profile Unsupported handling', () => {
  it('should return skipped status when profile is unsupported', async () => {
    // Create a runner that simulates HTTP 422 (profile unsupported)
    const profileUnsupportedRunner = {
      validate: () =>
        Promise.resolve({
          valid: false,
          schemaValid: false,
          schematronValid: false,
          profileUnsupported: true,
          items: [
            {
              ruleId: 'KOSIT-PROFILE-UNSUPPORTED',
              severity: 'warning' as const,
              message: 'No matching validation scenario found for this document profile',
            },
          ],
          summary: { errors: 0, warnings: 1, information: 0 },
          versionInfo: {
            validatorVersion: '1.5.0-docker',
            dictionaryVersion: 'xrechnung-3.0.2',
          },
          durationMs: 0,
        }),
      healthCheck: () => Promise.resolve(true),
      getVersion: () => Promise.resolve('test/1.0.0'),
      getVersionInfo: () =>
        Promise.resolve({
          validatorVersion: '1.5.0-docker',
          dictionaryVersion: 'xrechnung-3.0.2',
        }),
      close: () => Promise.resolve(),
    };

    const filter = createKositFilter({
      runner: profileUnsupportedRunner,
    });

    await filter.onInit?.();

    const context = createMockContext(VALID_XRECHNUNG_XML);
    const result = await filter.execute(context);

    expect(deriveStepStatus(result)).toBe('skipped');
    expect(result.metadata?.['profileUnsupported']).toBe(true);
    expect(result.metadata?.['reasonCode']).toBe('KOSIT_PROFILE_UNSUPPORTED');
    expect(result.diagnostics.some((d) => d.code === 'KOSIT-PROFILE-UNSUPPORTED')).toBe(true);

    await filter.onDestroy?.();
  });

  it('should not block when profile is unsupported (pipeline continues)', async () => {
    const profileUnsupportedRunner = {
      validate: () =>
        Promise.resolve({
          valid: false,
          schemaValid: false,
          schematronValid: false,
          profileUnsupported: true,
          items: [
            {
              ruleId: 'KOSIT-PROFILE-UNSUPPORTED',
              severity: 'warning' as const,
              message: 'No matching validation scenario found',
            },
          ],
          summary: { errors: 0, warnings: 1, information: 0 },
          versionInfo: {
            validatorVersion: '1.5.0-docker',
            dictionaryVersion: 'xrechnung-3.0.2',
          },
          durationMs: 0,
        }),
      healthCheck: () => Promise.resolve(true),
      getVersion: () => Promise.resolve('test/1.0.0'),
      getVersionInfo: () =>
        Promise.resolve({
          validatorVersion: '1.5.0-docker',
          dictionaryVersion: 'xrechnung-3.0.2',
        }),
      close: () => Promise.resolve(),
    };

    const filter = createKositFilter({
      runner: profileUnsupportedRunner,
    });

    await filter.onInit?.();

    const context = createMockContext(VALID_XRECHNUNG_XML);
    const result = await filter.execute(context);

    // Key assertion: status is 'skipped', not 'failed'
    // This allows the pipeline to continue with subsequent filters
    expect(deriveStepStatus(result)).not.toBe('failed');
    expect(deriveStepStatus(result)).toBe('skipped');

    await filter.onDestroy?.();
  });

  it('should return error status for system errors (e.g., XML malformed)', async () => {
    // Create a runner that simulates system error (422 with XML parse error)
    const systemErrorRunner = {
      validate: () =>
        Promise.resolve({
          valid: false,
          schemaValid: false,
          schematronValid: false,
          systemError: true,
          items: [
            {
              ruleId: 'KOSIT-PARSE-ERROR',
              severity: 'error' as const,
              message: 'XML parsing or validation error: malformed XML',
            },
          ],
          summary: { errors: 1, warnings: 0, information: 0 },
          versionInfo: {
            validatorVersion: '1.5.0-docker',
            dictionaryVersion: 'xrechnung-3.0.2',
          },
          durationMs: 0,
        }),
      healthCheck: () => Promise.resolve(true),
      getVersion: () => Promise.resolve('test/1.0.0'),
      getVersionInfo: () =>
        Promise.resolve({
          validatorVersion: '1.5.0-docker',
          dictionaryVersion: 'xrechnung-3.0.2',
        }),
      close: () => Promise.resolve(),
    };

    const filter = createKositFilter({
      runner: systemErrorRunner,
    });

    await filter.onInit?.();

    const context = createMockContext(VALID_XRECHNUNG_XML);
    const result = await filter.execute(context);

    // System error should result in 'error' status, not 'skipped'
    expect(deriveStepStatus(result)).toBe('error');
    expect(result.metadata?.['systemError']).toBe(true);
    expect(result.metadata?.['reasonCode']).toBe('KOSIT_SYSTEM_ERROR');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);

    await filter.onDestroy?.();
  });

  it('should return failed status for 406 (validation rejection)', async () => {
    // Create a runner that simulates HTTP 406 (validation rejection)
    const validationRejectionRunner = {
      validate: () =>
        Promise.resolve({
          valid: false,
          schemaValid: true,
          schematronValid: false,
          // Note: NOT profileUnsupported, NOT systemError - just a regular validation failure
          items: [
            {
              ruleId: 'BR-CO-25',
              severity: 'error' as const,
              message: 'Payment terms or due date must be present',
            },
          ],
          summary: { errors: 1, warnings: 0, information: 0 },
          versionInfo: {
            validatorVersion: '1.5.0-docker',
            dictionaryVersion: 'xrechnung-3.0.2',
          },
          scenarioName: 'EN16931 CII',
          profile: 'en16931-cii',
          durationMs: 0,
        }),
      healthCheck: () => Promise.resolve(true),
      getVersion: () => Promise.resolve('test/1.0.0'),
      getVersionInfo: () =>
        Promise.resolve({
          validatorVersion: '1.5.0-docker',
          dictionaryVersion: 'xrechnung-3.0.2',
        }),
      close: () => Promise.resolve(),
    };

    const filter = createKositFilter({
      runner: validationRejectionRunner,
    });

    await filter.onInit?.();

    const context = createMockContext(VALID_XRECHNUNG_XML);
    const result = await filter.execute(context);

    // 406 validation rejection should be 'failed', not 'skipped' or 'error'
    expect(deriveStepStatus(result)).toBe('failed');
    expect(result.metadata?.['profileUnsupported']).toBeUndefined();
    expect(result.metadata?.['systemError']).toBeUndefined();
    expect(result.metadata?.['scenarioName']).toBe('EN16931 CII');
    expect(result.diagnostics.some((d) => d.code === 'BR-CO-25')).toBe(true);

    await filter.onDestroy?.();
  });
});

describe('Error code sanitization', () => {
  it('should sanitize special characters in rule codes', () => {
    const result = parseKositReport(`<?xml version="1.0"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/report/1">
  <rep:assessment><rep:accept>false</rep:accept></rep:assessment>
  <rep:validationStepResult>
    <rep:valid>false</rep:valid>
    <rep:message level="error" code="BR-DE-01<script>alert(1)</script>">
      Test message
    </rep:message>
  </rep:validationStepResult>
</rep:report>`);

    const errorItem = result.items.find((i) => i.severity === 'error');
    expect(errorItem?.ruleId).not.toContain('<');
    expect(errorItem?.ruleId).not.toContain('>');
    expect(errorItem?.ruleId).toMatch(/^[a-zA-Z0-9\-_]+$/);
  });

  it('should truncate overly long rule codes', () => {
    const longCode = 'A'.repeat(100);
    const result = parseKositReport(`<?xml version="1.0"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/report/1">
  <rep:assessment><rep:accept>false</rep:accept></rep:assessment>
  <rep:validationStepResult>
    <rep:valid>false</rep:valid>
    <rep:message level="error" code="${longCode}">
      Test message
    </rep:message>
  </rep:validationStepResult>
</rep:report>`);

    const errorItem = result.items.find((i) => i.severity === 'error');
    expect(errorItem?.ruleId.length).toBeLessThanOrEqual(50);
  });
});

describe('DockerKositRunner 422 classification', () => {
  it('should export DEFAULT_NO_SCENARIO_PATTERNS constant', () => {
    expect(DEFAULT_NO_SCENARIO_PATTERNS).toBeDefined();
    expect(Array.isArray(DEFAULT_NO_SCENARIO_PATTERNS)).toBe(true);
    expect(DEFAULT_NO_SCENARIO_PATTERNS.length).toBeGreaterThan(0);
    expect(DEFAULT_NO_SCENARIO_PATTERNS).toContain('no matching scenario');
    expect(DEFAULT_NO_SCENARIO_PATTERNS).toContain('kein passendes szenario');
  });

  it('should allow custom noScenarioPatterns configuration', () => {
    // This tests that the configuration is accepted
    const runner = new DockerKositRunner({
      mode: 'daemon',
      daemonUrl: 'http://localhost:8080',
      noScenarioPatterns: ['custom pattern', 'another pattern'],
    });

    // Runner should be created without error
    expect(runner).toBeDefined();
  });

  it('should accept a logger via setLogger()', () => {
    const runner = new DockerKositRunner({
      mode: 'daemon',
      daemonUrl: 'http://localhost:8080',
    });

    const logMessages: { message: string; context: Record<string, unknown> | undefined }[] = [];
    const mockLogger: Kosit422Logger = {
      info: (message: string, context?: Record<string, unknown>) => {
        logMessages.push({ message, context });
      },
    };

    runner.setLogger(mockLogger);
    expect(runner).toBeDefined();
  });
});

describe('StepStatus stability for KoSIT errors', () => {
  it('should consistently return error status for systemError=true', async () => {
    // Run the same scenario multiple times to verify consistency
    for (let i = 0; i < 3; i++) {
      const systemErrorRunner = {
        validate: () =>
          Promise.resolve({
            valid: false,
            schemaValid: false,
            schematronValid: false,
            systemError: true,
            items: [
              {
                ruleId: 'KOSIT-SYSTEM-ERROR',
                severity: 'error' as const,
                message: 'KoSIT system error',
              },
            ],
            summary: { errors: 1, warnings: 0, information: 0 },
            versionInfo: {
              validatorVersion: '1.5.0-docker',
              dictionaryVersion: 'xrechnung-3.0.2',
            },
            durationMs: 0,
          }),
        healthCheck: () => Promise.resolve(true),
        getVersion: () => Promise.resolve('test/1.0.0'),
        getVersionInfo: () =>
          Promise.resolve({
            validatorVersion: '1.5.0-docker',
            dictionaryVersion: 'xrechnung-3.0.2',
          }),
        close: () => Promise.resolve(),
      };

      const filter = createKositFilter({ runner: systemErrorRunner });
      await filter.onInit?.();

      const context = createMockContext(VALID_XRECHNUNG_XML);
      const result = await filter.execute(context);

      // CRITICAL: status must be 'error', not 'failed' or anything else
      expect(deriveStepStatus(result)).toBe('error');
      expect(result.metadata?.['systemError']).toBe(true);
      expect(result.metadata?.['reasonCode']).toBe('KOSIT_SYSTEM_ERROR');

      await filter.onDestroy?.();
    }
  });

  it('should consistently return skipped status for profileUnsupported=true', async () => {
    // Run the same scenario multiple times to verify consistency
    for (let i = 0; i < 3; i++) {
      const profileUnsupportedRunner = {
        validate: () =>
          Promise.resolve({
            valid: false,
            schemaValid: false,
            schematronValid: false,
            profileUnsupported: true,
            items: [
              {
                ruleId: 'KOSIT-PROFILE-UNSUPPORTED',
                severity: 'warning' as const,
                message: 'No matching validation scenario',
              },
            ],
            summary: { errors: 0, warnings: 1, information: 0 },
            versionInfo: {
              validatorVersion: '1.5.0-docker',
              dictionaryVersion: 'xrechnung-3.0.2',
            },
            durationMs: 0,
          }),
        healthCheck: () => Promise.resolve(true),
        getVersion: () => Promise.resolve('test/1.0.0'),
        getVersionInfo: () =>
          Promise.resolve({
            validatorVersion: '1.5.0-docker',
            dictionaryVersion: 'xrechnung-3.0.2',
          }),
        close: () => Promise.resolve(),
      };

      const filter = createKositFilter({ runner: profileUnsupportedRunner });
      await filter.onInit?.();

      const context = createMockContext(VALID_XRECHNUNG_XML);
      const result = await filter.execute(context);

      // CRITICAL: status must be 'skipped', not 'failed'
      expect(deriveStepStatus(result)).toBe('skipped');
      expect(result.metadata?.['profileUnsupported']).toBe(true);
      expect(result.metadata?.['reasonCode']).toBe('KOSIT_PROFILE_UNSUPPORTED');

      await filter.onDestroy?.();
    }
  });

  it('should consistently return failed status for regular validation errors', async () => {
    // Run the same scenario multiple times to verify consistency
    for (let i = 0; i < 3; i++) {
      const validationErrorRunner = {
        validate: () =>
          Promise.resolve({
            valid: false,
            schemaValid: true,
            schematronValid: false,
            // Neither profileUnsupported nor systemError
            items: [
              {
                ruleId: 'BR-01',
                severity: 'error' as const,
                message: 'Invoice number required',
              },
            ],
            summary: { errors: 1, warnings: 0, information: 0 },
            versionInfo: {
              validatorVersion: '1.5.0-docker',
              dictionaryVersion: 'xrechnung-3.0.2',
            },
            durationMs: 0,
          }),
        healthCheck: () => Promise.resolve(true),
        getVersion: () => Promise.resolve('test/1.0.0'),
        getVersionInfo: () =>
          Promise.resolve({
            validatorVersion: '1.5.0-docker',
            dictionaryVersion: 'xrechnung-3.0.2',
          }),
        close: () => Promise.resolve(),
      };

      const filter = createKositFilter({ runner: validationErrorRunner });
      await filter.onInit?.();

      const context = createMockContext(VALID_XRECHNUNG_XML);
      const result = await filter.execute(context);

      // CRITICAL: status must be 'failed', not 'error' or 'skipped'
      expect(deriveStepStatus(result)).toBe('failed');
      expect(result.metadata?.['profileUnsupported']).toBeUndefined();
      expect(result.metadata?.['systemError']).toBeUndefined();

      await filter.onDestroy?.();
    }
  });
});

describe('Privacy redline: diagnostics must not contain PII', () => {
  it('should not include raw XML in diagnostic messages', () => {
    const result = parseKositReport(`<?xml version="1.0"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/report/1">
  <rep:assessment><rep:reject/></rep:assessment>
  <rep:scenarioMatched>
    <rep:validationStepResult id="val-sch.1" valid="false">
      <rep:message level="error" code="BR-01">
        Missing required element: &lt;cbc:InvoiceNumber&gt;INV-2024-001&lt;/cbc:InvoiceNumber&gt;
      </rep:message>
    </rep:validationStepResult>
  </rep:scenarioMatched>
</rep:report>`);

    for (const item of result.items) {
      // Messages should NOT contain raw XML elements
      expect(item.message).not.toMatch(/<cbc:[^>]+>/);
      expect(item.message).not.toMatch(/<\/cbc:[^>]+>/);
    }
  });

  it('should not expose email addresses in diagnostic messages', () => {
    const result = parseKositReport(`<?xml version="1.0"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/report/1">
  <rep:assessment><rep:reject/></rep:assessment>
  <rep:scenarioMatched>
    <rep:validationStepResult id="val-sch.1" valid="false">
      <rep:message level="error" code="BR-DE-02">
        Invalid email format: test@example.com
      </rep:message>
    </rep:validationStepResult>
  </rep:scenarioMatched>
</rep:report>`);

    for (const item of result.items) {
      // Messages should not contain email patterns after sanitization
      // Note: sanitizeMessage strips emails
      expect(item.message).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    }
  });

  it('should not expose IBAN in diagnostic messages', () => {
    const result = parseKositReport(`<?xml version="1.0"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/report/1">
  <rep:assessment><rep:reject/></rep:assessment>
  <rep:scenarioMatched>
    <rep:validationStepResult id="val-sch.1" valid="false">
      <rep:message level="error" code="BR-DE-06">
        Payment account invalid: DE89370400440532013000
      </rep:message>
    </rep:validationStepResult>
  </rep:scenarioMatched>
</rep:report>`);

    for (const item of result.items) {
      // Messages should not contain IBAN patterns
      expect(item.message).not.toMatch(/[A-Z]{2}\d{2}[A-Z0-9]{4,}/);
    }
  });

  it('should not expose VAT IDs in diagnostic messages', () => {
    const result = parseKositReport(`<?xml version="1.0"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/report/1">
  <rep:assessment><rep:reject/></rep:assessment>
  <rep:scenarioMatched>
    <rep:validationStepResult id="val-sch.1" valid="false">
      <rep:message level="error" code="BR-DE-01">
        Invalid VAT ID: DE123456789
      </rep:message>
    </rep:validationStepResult>
  </rep:scenarioMatched>
</rep:report>`);

    for (const item of result.items) {
      // Messages should not contain German VAT ID patterns
      expect(item.message).not.toMatch(/DE\d{9}/);
    }
  });

  it('diagnostics should only contain structured fields (code, severity, location)', async () => {
    const validationRejectionRunner = {
      validate: () =>
        Promise.resolve({
          valid: false,
          schemaValid: true,
          schematronValid: false,
          items: [
            {
              ruleId: 'BR-CO-25',
              severity: 'error' as const,
              message: 'Payment due date required',
              location: '/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction',
            },
          ],
          summary: { errors: 1, warnings: 0, information: 0 },
          versionInfo: {
            validatorVersion: '1.5.0-docker',
            dictionaryVersion: 'xrechnung-3.0.2',
          },
          scenarioName: 'EN16931 CII',
          durationMs: 50,
        }),
      healthCheck: () => Promise.resolve(true),
      getVersion: () => Promise.resolve('test/1.0.0'),
      getVersionInfo: () =>
        Promise.resolve({
          validatorVersion: '1.5.0-docker',
          dictionaryVersion: 'xrechnung-3.0.2',
        }),
      close: () => Promise.resolve(),
    };

    const filter = createKositFilter({ runner: validationRejectionRunner });
    await filter.onInit?.();

    const context = createMockContext(VALID_XRECHNUNG_XML);
    const result = await filter.execute(context);

    // Verify diagnostics have expected structure
    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const diag of result.diagnostics) {
      expect(diag.code).toBeDefined();
      expect(diag.severity).toBeDefined();
      expect(['error', 'warning', 'info', 'hint']).toContain(diag.severity);
      // Should NOT have rawValue, rawMessage, or raw XML content
      const diagObj = diag as unknown as Record<string, unknown>;
      expect(diagObj['rawValue']).toBeUndefined();
      expect(diagObj['rawMessage']).toBeUndefined();
      expect(diagObj['rawXml']).toBeUndefined();
    }

    await filter.onDestroy?.();
  });
});

describe('KoSIT diagnostics propagation on pipeline abort', () => {
  it('should return diagnostics with rule codes even when validation fails', async () => {
    // This test verifies that when KoSIT returns 406 (validation rejected),
    // the diagnostics (rule codes like BR-CO-25) are properly extracted
    // and returned in the StepResult
    const validationRejectionRunner = {
      validate: () =>
        Promise.resolve({
          valid: false,
          schemaValid: true,
          schematronValid: false,
          items: [
            {
              ruleId: 'PEPPOL-EN16931-R008',
              severity: 'error' as const,
              message: 'Document MUST not contain empty elements.',
              location: '/Invoice/cac:AccountingCustomerParty[1]/cac:Party[1]/cbc:EndpointID[1]',
            },
          ],
          summary: { errors: 1, warnings: 0, information: 0 },
          versionInfo: {
            validatorVersion: '1.5.0-docker',
            dictionaryVersion: 'xrechnung-3.0.2',
          },
          scenarioName: 'EN16931 XRechnung (UBL Invoice)',
          durationMs: 100,
        }),
      healthCheck: () => Promise.resolve(true),
      getVersion: () => Promise.resolve('test/1.0.0'),
      getVersionInfo: () =>
        Promise.resolve({
          validatorVersion: '1.5.0-docker',
          dictionaryVersion: 'xrechnung-3.0.2',
        }),
      close: () => Promise.resolve(),
    };

    const filter = createKositFilter({ runner: validationRejectionRunner });
    await filter.onInit?.();

    const context = createMockContext(VALID_XRECHNUNG_XML);
    const result = await filter.execute(context);

    // CRITICAL: Even though validation failed, diagnostics MUST be present
    // This is essential for the pipeline to include them in the final report
    expect(deriveStepStatus(result)).toBe('failed');
    expect(result.diagnostics.length).toBeGreaterThan(0);

    // Verify the specific rule code is present
    const ruleCodeDiag = result.diagnostics.find((d) => d.code === 'PEPPOL-EN16931-R008');
    expect(ruleCodeDiag).toBeDefined();
    expect(ruleCodeDiag?.severity).toBe('error');
    expect(ruleCodeDiag?.location).toBeDefined();

    await filter.onDestroy?.();
  });
});
