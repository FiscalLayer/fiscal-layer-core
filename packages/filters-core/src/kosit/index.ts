import type { Filter, FilterContext, StepResult, Diagnostic } from '@fiscal-layer/contracts';

/**
 * KoSIT Validator filter - validates against German e-invoice standards.
 *
 * This is a WRAPPER for the @fiscal-layer/steps-kosit package.
 * The actual validation logic is in steps-kosit (also OSS).
 *
 * This filter does NOT make external API calls - KoSIT runs locally
 * via Docker container or Java subprocess.
 */
export const kositFilter: Filter = {
  id: 'kosit',
  name: 'KoSIT Validator',
  version: '0.0.1',
  description: 'Validates against XRechnung/ZUGFeRD schemas and Schematron rules',
  tags: ['core', 'validation', 'schema'],
  dependsOn: ['parser'],

  configSchema: {
    type: 'object',
    properties: {
      schemaVersion: {
        type: 'string',
        description: 'XRechnung schema version',
        default: '3.0.2',
      },
      strictMode: {
        type: 'boolean',
        description: 'Enable strict validation mode',
        default: false,
      },
    },
  },

  async execute(context: FilterContext): Promise<StepResult> {
    const startTime = Date.now();
    const config = context.config as { schemaVersion?: string; strictMode?: boolean };

    // Check if parser ran successfully
    const parserResult = context.getStepResult('parser');
    if (!parserResult || parserResult.status === 'failed') {
      return {
        filterId: 'kosit',
        status: 'skipped',
        diagnostics: [
          {
            code: 'KOSIT-SKIP-001',
            message: 'Skipped KoSIT validation: Parser did not complete successfully',
            severity: 'info',
            category: 'internal',
            source: 'kosit',
          },
        ],
        durationMs: Date.now() - startTime,
      };
    }

    // Placeholder validation
    // In production, this would use @fiscal-layer/steps-kosit
    const diagnostics: Diagnostic[] = [];
    const format = context.parsedInvoice?.format;

    // Simulate some validation results
    if (format === 'unknown') {
      diagnostics.push({
        code: 'KOSIT-001',
        message: 'Unknown invoice format - cannot validate against schema',
        severity: 'error',
        category: 'schema',
        source: 'kosit',
      });
    }

    // Add a sample warning for demonstration
    if (!config.strictMode) {
      diagnostics.push({
        code: 'BR-DE-21',
        message: 'Payment means type code should be specified for German invoices',
        localizedMessage: 'Der Zahlungsmitteltyp sollte für deutsche Rechnungen angegeben werden',
        severity: 'warning',
        category: 'business-rule',
        source: 'kosit',
        documentationUrl: 'https://www.xoev.de/xrechnung',
      });
    }

    const hasErrors = diagnostics.some((d) => d.severity === 'error');

    return {
      filterId: 'kosit',
      status: hasErrors ? 'failed' : diagnostics.length > 0 ? 'warning' : 'passed',
      diagnostics,
      durationMs: Date.now() - startTime,
      metadata: {
        schemaVersion: config.schemaVersion ?? '3.0.2',
        validatorVersion: '1.5.0', // KoSIT validator version
      },
    };
  },
};
