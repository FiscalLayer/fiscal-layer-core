import type { Filter, FilterContext, StepResult, Diagnostic } from '@fiscal-layer/contracts';

/**
 * Semantic Risk Assessment filter.
 *
 * Analyzes invoice for business logic issues and potential risks.
 * This is part of the OSS core - no external API calls.
 */
export const semanticRiskFilter: Filter = {
  id: 'semantic-risk',
  name: 'Semantic Risk Assessment',
  version: '0.0.1',
  description: 'Analyzes invoice for business logic issues and risk indicators',
  tags: ['semantic', 'risk'],
  dependsOn: ['parser'],

  configSchema: {
    type: 'object',
    properties: {
      riskThreshold: {
        type: 'number',
        description: 'Risk score threshold for warnings',
        default: 0.5,
        minimum: 0,
        maximum: 1,
      },
      checkCalculations: {
        type: 'boolean',
        description: 'Verify amount calculations',
        default: true,
      },
      checkDates: {
        type: 'boolean',
        description: 'Check for date anomalies',
        default: true,
      },
    },
  },

  async execute(context: FilterContext): Promise<StepResult> {
    const startTime = Date.now();
    const config = context.config as {
      riskThreshold?: number;
      checkCalculations?: boolean;
      checkDates?: boolean;
    };
    const diagnostics: Diagnostic[] = [];

    const invoice = context.parsedInvoice;
    if (!invoice) {
      return {
        filterId: 'semantic-risk',
        status: 'skipped',
        diagnostics: [
          {
            code: 'SEM-SKIP-001',
            message: 'No parsed invoice data available',
            severity: 'info',
            category: 'semantic',
            source: 'semantic-risk',
          },
        ],
        durationMs: Date.now() - startTime,
      };
    }

    // Check calculations
    if (config.checkCalculations !== false) {
      const calcDiagnostics = checkCalculations(invoice);
      diagnostics.push(...calcDiagnostics);
    }

    // Check dates
    if (config.checkDates !== false) {
      const dateDiagnostics = checkDates(invoice);
      diagnostics.push(...dateDiagnostics);
    }

    // Check for high-risk patterns
    const riskDiagnostics = checkRiskPatterns(invoice);
    diagnostics.push(...riskDiagnostics);

    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    const hasWarnings = diagnostics.some((d) => d.severity === 'warning');

    return {
      filterId: 'semantic-risk',
      status: hasErrors ? 'failed' : hasWarnings ? 'warning' : 'passed',
      diagnostics,
      durationMs: Date.now() - startTime,
      metadata: {
        checksPerformed: ['calculations', 'dates', 'risk-patterns'],
      },
    };
  },
};

function checkCalculations(invoice: {
  totalAmount?: number;
  taxAmount?: number;
  lineItems?: Array<{ lineTotal?: number }>;
}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Check if line items sum matches total
  if (invoice.lineItems && invoice.lineItems.length > 0 && invoice.totalAmount) {
    const lineSum = invoice.lineItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
    const expectedTotal = lineSum + (invoice.taxAmount ?? 0);

    // Allow small rounding differences (0.01 EUR)
    if (Math.abs(expectedTotal - invoice.totalAmount) > 0.01) {
      diagnostics.push({
        code: 'SEM-CALC-001',
        message: `Total amount mismatch: calculated ${expectedTotal.toFixed(2)}, stated ${invoice.totalAmount.toFixed(2)}`,
        severity: 'error',
        category: 'semantic',
        source: 'semantic-risk',
        context: {
          calculated: expectedTotal,
          stated: invoice.totalAmount,
          difference: Math.abs(expectedTotal - invoice.totalAmount),
        },
      });
    }
  }

  return diagnostics;
}

function checkDates(invoice: { issueDate?: string; dueDate?: string }): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const now = new Date();

  // Check if issue date is in the future
  if (invoice.issueDate) {
    const issueDate = new Date(invoice.issueDate);
    if (issueDate > now) {
      diagnostics.push({
        code: 'SEM-DATE-001',
        message: 'Invoice issue date is in the future',
        severity: 'warning',
        category: 'semantic',
        source: 'semantic-risk',
        context: {
          issueDate: invoice.issueDate,
          currentDate: now.toISOString().split('T')[0],
        },
      });
    }
  }

  // Check if due date is before issue date
  if (invoice.issueDate && invoice.dueDate) {
    const issueDate = new Date(invoice.issueDate);
    const dueDate = new Date(invoice.dueDate);
    if (dueDate < issueDate) {
      diagnostics.push({
        code: 'SEM-DATE-002',
        message: 'Due date is before issue date',
        severity: 'warning',
        category: 'semantic',
        source: 'semantic-risk',
        context: {
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
        },
      });
    }
  }

  return diagnostics;
}

function checkRiskPatterns(invoice: { totalAmount?: number }): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Flag unusually large amounts
  if (invoice.totalAmount && invoice.totalAmount > 100000) {
    diagnostics.push({
      code: 'SEM-RISK-001',
      message: 'High-value invoice detected - consider additional verification',
      severity: 'info',
      category: 'semantic',
      source: 'semantic-risk',
      context: {
        amount: invoice.totalAmount,
        threshold: 100000,
      },
    });
  }

  // Round number detection (potential fraud indicator)
  if (invoice.totalAmount && invoice.totalAmount > 1000 && invoice.totalAmount % 1000 === 0) {
    diagnostics.push({
      code: 'SEM-RISK-002',
      message: 'Invoice total is a round number - may warrant review',
      severity: 'hint',
      category: 'semantic',
      source: 'semantic-risk',
    });
  }

  return diagnostics;
}
