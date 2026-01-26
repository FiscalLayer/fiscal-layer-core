import { describe, it, expect } from 'vitest';
import { buildDiagnosticsSummary } from './summary-builder.js';
import type { Diagnostic } from '@fiscal-layer/contracts';

/**
 * Helper to create a diagnostic
 */
function createDiagnostic(
  code: string,
  severity: 'error' | 'warning' | 'info' | 'hint' = 'error',
  message = 'Test message'
): Diagnostic {
  return {
    code,
    message,
    severity,
    category: 'business-rule',
    source: 'test',
  };
}

describe('buildDiagnosticsSummary', () => {
  it('should count diagnostics by severity', () => {
    const diagnostics: Diagnostic[] = [
      createDiagnostic('BR-01', 'error'),
      createDiagnostic('BR-02', 'error'),
      createDiagnostic('BR-03', 'warning'),
      createDiagnostic('BR-04', 'info'),
    ];

    const summary = buildDiagnosticsSummary(diagnostics);

    expect(summary.totalBySeverity.error).toBe(2);
    expect(summary.totalBySeverity.warning).toBe(1);
    expect(summary.totalBySeverity.info).toBe(1);
    expect(summary.totalBySeverity.hint).toBe(0);
  });

  it('should aggregate rules by count', () => {
    const diagnostics: Diagnostic[] = [
      createDiagnostic('BR-01', 'error'),
      createDiagnostic('BR-01', 'error'),
      createDiagnostic('BR-01', 'error'),
      createDiagnostic('BR-02', 'error'),
      createDiagnostic('BR-02', 'error'),
      createDiagnostic('BR-03', 'warning'),
    ];

    const summary = buildDiagnosticsSummary(diagnostics);

    expect(summary.topRules[0]?.ruleId).toBe('BR-01');
    expect(summary.topRules[0]?.count).toBe(3);
    expect(summary.topRules[1]?.ruleId).toBe('BR-02');
    expect(summary.topRules[1]?.count).toBe(2);
    expect(summary.topRules[2]?.ruleId).toBe('BR-03');
    expect(summary.topRules[2]?.count).toBe(1);
  });

  it('should generate correct titleKey and hintKey', () => {
    const diagnostics: Diagnostic[] = [
      createDiagnostic('BR-DE-01', 'error'),
    ];

    const summary = buildDiagnosticsSummary(diagnostics);

    expect(summary.topRules[0]?.titleKey).toBe('rules.BR-DE-01.title');
    expect(summary.topRules[0]?.hintKey).toBe('rules.BR-DE-01.hint');
  });

  it('should extract rule ID from prefixed codes', () => {
    const diagnostics: Diagnostic[] = [
      createDiagnostic('SCHEMA:BR-01', 'error'),
      createDiagnostic('kosit:BR-DE-17', 'error'),
    ];

    const summary = buildDiagnosticsSummary(diagnostics);

    expect(summary.topRules.find((r) => r.ruleId === 'BR-01')).toBeDefined();
    expect(summary.topRules.find((r) => r.ruleId === 'BR-DE-17')).toBeDefined();
  });

  it('should respect maxTopRules option', () => {
    const diagnostics: Diagnostic[] = [];
    for (let i = 1; i <= 20; i++) {
      diagnostics.push(createDiagnostic(`BR-${String(i).padStart(2, '0')}`, 'error'));
    }

    const summary = buildDiagnosticsSummary(diagnostics, { maxTopRules: 5 });

    expect(summary.topRules.length).toBe(5);
  });

  it('should exclude hints by default', () => {
    const diagnostics: Diagnostic[] = [
      createDiagnostic('BR-01', 'error'),
      createDiagnostic('BR-02', 'hint'),
    ];

    const summary = buildDiagnosticsSummary(diagnostics);

    expect(summary.totalBySeverity.hint).toBe(0);
    expect(summary.topRules.find((r) => r.ruleId === 'BR-02')).toBeUndefined();
  });

  it('should include hints when option is set', () => {
    const diagnostics: Diagnostic[] = [
      createDiagnostic('BR-01', 'error'),
      createDiagnostic('BR-02', 'hint'),
    ];

    const summary = buildDiagnosticsSummary(diagnostics, { includeHints: true });

    expect(summary.totalBySeverity.hint).toBe(1);
    expect(summary.topRules.find((r) => r.ruleId === 'BR-02')).toBeDefined();
  });

  it('should truncate when over maxDiagnosticsPerStep', () => {
    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < 300; i++) {
      diagnostics.push(createDiagnostic('BR-01', 'error'));
    }

    const summary = buildDiagnosticsSummary(diagnostics, { maxDiagnosticsPerStep: 200 });

    expect(summary.truncated).toBe(true);
    expect(summary.totalCount).toBe(200);
  });

  it('should not truncate when under limit', () => {
    const diagnostics: Diagnostic[] = [
      createDiagnostic('BR-01', 'error'),
      createDiagnostic('BR-02', 'warning'),
    ];

    const summary = buildDiagnosticsSummary(diagnostics);

    expect(summary.truncated).toBe(false);
    expect(summary.totalCount).toBe(2);
  });

  it('should handle empty diagnostics', () => {
    const summary = buildDiagnosticsSummary([]);

    expect(summary.topRules).toEqual([]);
    expect(summary.totalBySeverity.error).toBe(0);
    expect(summary.totalBySeverity.warning).toBe(0);
    expect(summary.totalBySeverity.info).toBe(0);
    expect(summary.totalBySeverity.hint).toBe(0);
    expect(summary.truncated).toBe(false);
    expect(summary.totalCount).toBe(0);
  });

  it('should keep highest severity when same rule has multiple severities', () => {
    const diagnostics: Diagnostic[] = [
      createDiagnostic('BR-01', 'info'),
      createDiagnostic('BR-01', 'error'),
      createDiagnostic('BR-01', 'warning'),
    ];

    const summary = buildDiagnosticsSummary(diagnostics);

    expect(summary.topRules[0]?.severity).toBe('error');
    expect(summary.topRules[0]?.count).toBe(3);
  });
});

/**
 * REDLINE TESTS - Privacy Guarantees
 *
 * These tests ensure the summary output does NOT contain
 * any PII or sensitive XML content that could leak in API responses.
 */
describe('buildDiagnosticsSummary - Privacy Redline Tests', () => {
  /**
   * PII patterns that MUST NOT appear in output
   */
  const PII_PATTERNS = {
    // XML content markers
    xmlDeclaration: /^<\?xml/,
    xmlTags: /<cbc:|<cac:|xmlns:/,
    xmlNamespaces: /urn:oasis|urn:un:/,

    // Personal data patterns
    email: /[\w.-]+@[\w.-]+\.\w{2,}/,
    iban: /[A-Z]{2}\d{2}[A-Z0-9]{11,30}/,
    germanVatId: /DE\d{9}/,
    phoneNumber: /\+?\d{10,15}/,

    // File system paths
    unixPath: /\/Users\/|\/home\/|\/tmp\//,
    windowsPath: /[A-Z]:\\Users\\|\\Documents\\/,

    // Raw XML element content
    rawXmlContent: /<[^>]+>[^<]*<\/[^>]+>/,
  };

  /**
   * Create diagnostics with potentially sensitive content
   */
  function createSensitiveDiagnostics(): Diagnostic[] {
    return [
      // Diagnostic with XML in message
      {
        code: 'BR-DE-01',
        message: 'Invalid content: <cbc:Name>John Doe</cbc:Name>',
        severity: 'error',
        category: 'business-rule',
        source: 'kosit',
        location: '/Invoice/cac:AccountingSupplierParty/cac:Party/cbc:Name',
      },
      // Diagnostic with email
      {
        code: 'BR-DE-02',
        message: 'Email format invalid: john.doe@example.com',
        severity: 'error',
        category: 'business-rule',
        source: 'kosit',
      },
      // Diagnostic with IBAN
      {
        code: 'BR-DE-05',
        message: 'IBAN validation failed: DE89370400440532013000',
        severity: 'error',
        category: 'business-rule',
        source: 'kosit',
      },
      // Diagnostic with VAT ID
      {
        code: 'BR-DE-04',
        message: 'VAT ID invalid: DE123456789',
        severity: 'error',
        category: 'business-rule',
        source: 'kosit',
      },
      // Diagnostic with file path
      {
        code: 'INTERNAL-01',
        message: 'File not found: /Users/john/invoices/invoice.xml',
        severity: 'error',
        category: 'internal',
        source: 'system',
      },
    ];
  }

  it('should NOT contain XML declaration in output', () => {
    const diagnostics = createSensitiveDiagnostics();
    const summary = buildDiagnosticsSummary(diagnostics);
    const output = JSON.stringify(summary);

    expect(output).not.toMatch(PII_PATTERNS.xmlDeclaration);
  });

  it('should NOT contain XML tags in output', () => {
    const diagnostics = createSensitiveDiagnostics();
    const summary = buildDiagnosticsSummary(diagnostics);
    const output = JSON.stringify(summary);

    expect(output).not.toMatch(PII_PATTERNS.xmlTags);
  });

  it('should NOT contain email addresses in output', () => {
    const diagnostics = createSensitiveDiagnostics();
    const summary = buildDiagnosticsSummary(diagnostics);
    const output = JSON.stringify(summary);

    expect(output).not.toMatch(PII_PATTERNS.email);
  });

  it('should NOT contain IBAN in output', () => {
    const diagnostics = createSensitiveDiagnostics();
    const summary = buildDiagnosticsSummary(diagnostics);
    const output = JSON.stringify(summary);

    expect(output).not.toMatch(PII_PATTERNS.iban);
  });

  it('should NOT contain German VAT ID in output', () => {
    const diagnostics = createSensitiveDiagnostics();
    const summary = buildDiagnosticsSummary(diagnostics);
    const output = JSON.stringify(summary);

    expect(output).not.toMatch(PII_PATTERNS.germanVatId);
  });

  it('should NOT contain file paths in output', () => {
    const diagnostics = createSensitiveDiagnostics();
    const summary = buildDiagnosticsSummary(diagnostics);
    const output = JSON.stringify(summary);

    expect(output).not.toMatch(PII_PATTERNS.unixPath);
    expect(output).not.toMatch(PII_PATTERNS.windowsPath);
  });

  it('should NOT contain raw XML content in output', () => {
    const diagnostics = createSensitiveDiagnostics();
    const summary = buildDiagnosticsSummary(diagnostics);
    const output = JSON.stringify(summary);

    expect(output).not.toMatch(PII_PATTERNS.rawXmlContent);
  });

  it('should only contain safe fields in output', () => {
    const diagnostics = createSensitiveDiagnostics();
    const summary = buildDiagnosticsSummary(diagnostics);

    // Verify structure contains only expected safe fields
    expect(Object.keys(summary)).toEqual([
      'topRules',
      'totalBySeverity',
      'truncated',
      'totalCount',
    ]);

    for (const rule of summary.topRules) {
      expect(Object.keys(rule)).toEqual([
        'ruleId',
        'severity',
        'count',
        'titleKey',
        'hintKey',
      ]);
      // Rule ID should only contain alphanumeric and hyphens
      expect(rule.ruleId).toMatch(/^[A-Z0-9-]+$/);
      // Title key should be a safe i18n key format
      expect(rule.titleKey).toMatch(/^rules\.[A-Z0-9-]+\.title$/);
    }
  });
});
