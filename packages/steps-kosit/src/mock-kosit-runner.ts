import type {
  KositRunner,
  KositRunnerConfig,
  KositValidateOptions,
  KositValidationItem,
  KositValidationResult,
  KositVersionInfo,
} from './types.js';

/**
 * Mock validation rules for testing.
 * These simulate the BR-DE (German business rules) from XRechnung.
 */
const MOCK_RULES: {
  id: string;
  pattern: RegExp;
  severity: 'error' | 'warning';
  message: string;
}[] = [
  {
    id: 'BR-DE-01',
    pattern: /<cbc:CustomizationID>.*urn:cen\.eu:en16931/i,
    severity: 'error',
    message: 'An invoice shall have a Specification identifier (BR-DE-01)',
  },
  {
    id: 'BR-DE-02',
    pattern: /<cac:AccountingSupplierParty>.*<cbc:EndpointID/is,
    severity: 'warning',
    message: 'The Seller should have an electronic address (BR-DE-02)',
  },
  {
    id: 'BR-DE-03',
    pattern: /<cac:AccountingCustomerParty>.*<cbc:EndpointID/is,
    severity: 'warning',
    message: 'The Buyer should have an electronic address (BR-DE-03)',
  },
  {
    id: 'BR-DE-05',
    pattern: /<cac:PaymentMeans>/,
    severity: 'error',
    message: 'Payment means shall be provided (BR-DE-05)',
  },
  {
    id: 'BR-DE-06',
    pattern: /<cbc:PaymentMeansCode>(30|58|59)<\/cbc:PaymentMeansCode>/,
    severity: 'error',
    message: 'Payment account must be provided for credit transfer (BR-DE-06)',
  },
  {
    id: 'BR-DE-09',
    pattern: /<cac:TaxRepresentativeParty>/,
    severity: 'warning',
    message: 'Tax representative name must match seller name (BR-DE-09)',
  },
  {
    id: 'BR-DE-13',
    pattern: /<cbc:InvoiceTypeCode>(380|381|384|389)<\/cbc:InvoiceTypeCode>/,
    severity: 'error',
    message: 'Invoice type code must be valid (BR-DE-13)',
  },
  {
    id: 'BR-DE-17',
    pattern: /<cac:LegalMonetaryTotal>.*<cbc:PayableAmount/is,
    severity: 'error',
    message: 'Payable amount shall be provided (BR-DE-17)',
  },
  {
    id: 'BR-DE-18',
    pattern: /<cbc:CompanyID.*>DE\d{9}<\/cbc:CompanyID>/,
    severity: 'warning',
    message: 'German VAT ID should be provided (BR-DE-18)',
  },
  {
    id: 'BR-DE-21',
    pattern: /<cbc:DueDate>/,
    severity: 'warning',
    message: 'Due date should be provided for payment terms (BR-DE-21)',
  },
];

/**
 * MockKositRunner provides a mock implementation of KoSIT validation
 * for testing and development purposes.
 *
 * It applies a set of simplified rules that simulate the German
 * business rules (BR-DE-xx) from the XRechnung specification.
 */
export class MockKositRunner implements KositRunner {
  private readonly config: KositRunnerConfig;
  private closed = false;

  /**
   * Version string for this mock runner
   */
  static readonly VERSION = 'mock-kosit-runner/1.0.0';

  /**
   * Detailed version info for traceability
   */
  static readonly VERSION_INFO: KositVersionInfo = {
    validatorVersion: '1.0.0-mock',
    imageVersion: 'mock/local',
    dictionaryVersion: 'xrechnung-schematron-mock-3.0.2',
    dictionaryHash: 'sha256:mock0000000000000000000000000000000000000000000000000000000000',
    scenarioVersion: 'xrechnung_3.0.2_mock',
    rulesPublishedAt: '2024-01-15T00:00:00Z',
    buildTimestamp: new Date().toISOString(),
  };

  constructor(config: KositRunnerConfig = {}) {
    this.config = {
      timeoutMs: 30000,
      debug: false,
      ...config,
    };
  }

  validate(
    xml: string,
    options?: KositValidateOptions,
  ): Promise<KositValidationResult> {
    if (this.closed) {
      return Promise.reject(new Error('KositRunner is closed'));
    }

    const startTime = Date.now();
    const items: KositValidationItem[] = [];

    // Basic XML validation
    if (!xml || xml.trim().length === 0) {
      items.push({
        ruleId: 'XML-001',
        severity: 'error',
        message: 'Empty XML document',
      });
    } else if (!xml.trim().startsWith('<')) {
      items.push({
        ruleId: 'XML-002',
        severity: 'error',
        message: 'Document does not start with XML declaration or element',
      });
    }

    // Check for basic invoice structure (with optional namespace prefix)
    const hasInvoiceRoot =
      /<(?:[a-z]+:)?Invoice\b/i.test(xml) ||
      /<(?:[a-z]+:)?CrossIndustryInvoice\b/i.test(xml);

    if (!hasInvoiceRoot) {
      items.push({
        ruleId: 'XML-003',
        severity: 'error',
        message: 'Document does not contain an Invoice root element',
      });
    }

    // Apply mock rules
    for (const rule of MOCK_RULES) {
      const matches = rule.pattern.test(xml);

      // For most rules, absence of the pattern is an error
      // Some rules check for presence of problematic patterns
      if (rule.id.startsWith('BR-DE-')) {
        if (!matches) {
          // Rule condition not satisfied
          items.push({
            ruleId: rule.id,
            severity: rule.severity,
            message: rule.message,
            source: 'xrechnung-schematron',
          });
        }
      }
    }

    // Detect profile/format
    let profile = 'unknown';
    if (/urn:cen\.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung/i.test(xml)) {
      profile = 'xrechnung-3.0';
    } else if (/urn:cen\.eu:en16931:2017/i.test(xml)) {
      profile = 'en16931';
    } else if (/urn:factur-x\.eu:1p0/i.test(xml) || /zugferd/i.test(xml)) {
      profile = 'zugferd-2.1';
    }

    const summary = {
      errors: items.filter((i) => i.severity === 'error').length,
      warnings: items.filter((i) => i.severity === 'warning').length,
      information: items.filter((i) => i.severity === 'information').length,
    };

    const result: KositValidationResult = {
      valid: summary.errors === 0,
      schemaValid: !items.some(
        (i) => i.severity === 'error' && i.ruleId.startsWith('XML-'),
      ),
      schematronValid: !items.some(
        (i) => i.severity === 'error' && i.ruleId.startsWith('BR-'),
      ),
      items,
      summary,
      profile,
      validatorVersion: MockKositRunner.VERSION,
      versionInfo: MockKositRunner.VERSION_INFO,
      scenarioName: options?.scenario ?? 'default',
      durationMs: Date.now() - startTime,
    };

    if (options?.includeRawOutput) {
      result.rawOutput = JSON.stringify(items, null, 2);
    }

    if (this.config.debug) {
      console.log('[MockKositRunner] Validation result:', {
        valid: result.valid,
        errors: summary.errors,
        warnings: summary.warnings,
        profile: result.profile,
      });
    }

    return Promise.resolve(result);
  }

  healthCheck(): Promise<boolean> {
    return Promise.resolve(!this.closed);
  }

  getVersion(): Promise<string> {
    return Promise.resolve(MockKositRunner.VERSION);
  }

  getVersionInfo(): Promise<KositVersionInfo> {
    return Promise.resolve(MockKositRunner.VERSION_INFO);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  private checkClosed(): void {
    if (this.closed) {
      throw new Error('KositRunner is closed');
    }
  }
}

const ALWAYS_VALID_VERSION_INFO: KositVersionInfo = {
  validatorVersion: '1.0.0-always-valid',
  dictionaryVersion: 'always-valid-mock',
  dictionaryHash: 'sha256:alwaysvalid0000000000000000000000000000000000000000000000000000',
};

/**
 * Create a mock runner that always returns valid
 */
export function createAlwaysValidRunner(): KositRunner {
  return {
    validate(): Promise<KositValidationResult> {
      return Promise.resolve({
        valid: true,
        schemaValid: true,
        schematronValid: true,
        items: [],
        summary: { errors: 0, warnings: 0, information: 0 },
        profile: 'xrechnung-3.0',
        validatorVersion: 'always-valid/1.0.0',
        versionInfo: ALWAYS_VALID_VERSION_INFO,
        durationMs: 1,
      });
    },
    healthCheck() {
      return Promise.resolve(true);
    },
    getVersion() {
      return Promise.resolve('always-valid/1.0.0');
    },
    getVersionInfo() {
      return Promise.resolve(ALWAYS_VALID_VERSION_INFO);
    },
    close() {
      return Promise.resolve();
    },
  };
}

const FIXED_ERROR_VERSION_INFO: KositVersionInfo = {
  validatorVersion: '1.0.0-fixed-error',
  dictionaryVersion: 'fixed-error-mock',
  dictionaryHash: 'sha256:fixederror000000000000000000000000000000000000000000000000000000',
};

/**
 * Create a mock runner that always returns specific errors
 */
export function createFixedErrorRunner(errors: KositValidationItem[]): KositRunner {
  return {
    validate(): Promise<KositValidationResult> {
      return Promise.resolve({
        valid: false,
        schemaValid: false,
        schematronValid: false,
        items: errors,
        summary: {
          errors: errors.filter((e) => e.severity === 'error').length,
          warnings: errors.filter((e) => e.severity === 'warning').length,
          information: errors.filter((e) => e.severity === 'information').length,
        },
        validatorVersion: 'fixed-error/1.0.0',
        versionInfo: FIXED_ERROR_VERSION_INFO,
        durationMs: 1,
      });
    },
    healthCheck() {
      return Promise.resolve(true);
    },
    getVersion() {
      return Promise.resolve('fixed-error/1.0.0');
    },
    getVersionInfo() {
      return Promise.resolve(FIXED_ERROR_VERSION_INFO);
    },
    close() {
      return Promise.resolve();
    },
  };
}
