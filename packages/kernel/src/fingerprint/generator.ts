import type {
  ComplianceFingerprint,
  ValidationStatus,
  StepResult,
  Diagnostic,
  ExecutionPlan,
  InvoiceSummary,
  FingerprintChecks,
  RiskNote,
  VerificationStatus,
} from '@fiscal-layer/contracts';

/**
 * Generate a unique fingerprint ID.
 * Format: FL-{timestamp}-{random}
 */
export function generateFingerprintId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `FL-${timestamp}-${random}`;
}

interface FingerprintInput {
  runId: string;
  status: ValidationStatus;
  score: number;
  steps: StepResult[];
  diagnostics: Diagnostic[];
  plan: ExecutionPlan;
  invoiceSummary: InvoiceSummary;
  durationMs: number;
}

/**
 * Create a compliance fingerprint from validation results.
 */
export function createFingerprint(input: FingerprintInput): ComplianceFingerprint {
  const { runId, status, score, steps, diagnostics, plan, invoiceSummary, durationMs } = input;

  // Extract check results from steps
  const checks = extractChecks(steps);

  // Extract risk notes from diagnostics
  const riskNotes = extractRiskNotes(diagnostics);

  // Get filter versions
  const filterVersions: Record<string, string> = {};
  for (const step of steps) {
    if (step.filterVersion) {
      filterVersions[step.filterId] = step.filterVersion;
    }
  }

  // Calculate fingerprint hash
  const fingerprintData = JSON.stringify({
    runId,
    status,
    score,
    checks,
    invoiceSummary,
    planConfigHash: plan.configHash,
    timestamp: new Date().toISOString(),
  });
  const fingerprint = simpleHash(fingerprintData);

  return {
    id: generateFingerprintId(),
    status,
    score,
    timestamp: new Date().toISOString(),
    checks,
    riskNotes,
    fingerprint: `sha256:${fingerprint}`,
    executionPlan: {
      id: plan.id,
      version: plan.version,
      configHash: plan.configHash,
    },
    invoiceSummary,
    filterVersions,
    durationMs,
  };
}

function extractChecks(steps: StepResult[]): FingerprintChecks {
  const checks: FingerprintChecks = {};

  for (const step of steps) {
    const verificationStatus = mapStepStatus(step.status);

    switch (step.filterId) {
      case 'parser':
        // Parser doesn't produce a check
        break;
      case 'kosit':
        checks['schemaValidation'] = verificationStatus;
        checks['businessRules'] = verificationStatus;
        break;
      case 'vies':
        checks['vatVerification'] = step.metadata?.['liveVerified']
          ? 'VERIFIED_LIVE'
          : verificationStatus;
        break;
      case 'ecb-rates':
        checks['exchangeRateVerification'] = verificationStatus;
        break;
      case 'peppol':
        checks['peppolVerification'] = verificationStatus;
        break;
      case 'semantic-risk':
        checks['calculationAccuracy'] = verificationStatus;
        break;
      default:
        checks[step.filterId] = verificationStatus;
    }
  }

  return checks;
}

function mapStepStatus(status: StepResult['status']): VerificationStatus {
  switch (status) {
    case 'passed':
      return 'VERIFIED';
    case 'failed':
      return 'FAILED';
    case 'warning':
      return 'VERIFIED';
    case 'skipped':
      return 'SKIPPED';
    case 'timeout':
    case 'error':
      return 'UNVERIFIED';
    default:
      return 'UNVERIFIED';
  }
}

function extractRiskNotes(diagnostics: Diagnostic[]): RiskNote[] {
  return diagnostics
    .filter((d) => d.severity === 'warning' || d.category === 'semantic')
    .map((d) => ({
      code: d.code,
      message: d.message,
      severity: d.severity === 'error' ? 'high' : d.severity === 'warning' ? 'medium' : 'low',
      category: d.category,
    }));
}

/**
 * Simple hash function for fingerprint generation.
 * In production, use Web Crypto API or Node.js crypto.
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}
