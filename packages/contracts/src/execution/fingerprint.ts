import type { ValidationStatus, InvoiceSummary } from './report.js';

/**
 * Verification status for specific checks
 */
export type VerificationStatus =
  | 'VERIFIED' // Verified successfully
  | 'VERIFIED_LIVE' // Verified against live external service
  | 'UNVERIFIED' // Could not verify
  | 'FAILED' // Verification failed
  | 'SKIPPED' // Verification was skipped
  | 'NOT_APPLICABLE'; // Not applicable to this invoice

/**
 * Individual check results in the fingerprint
 */
export interface FingerprintChecks {
  /** Schema/structure validation */
  schemaValidation?: VerificationStatus;

  /** Business rules validation */
  businessRules?: VerificationStatus;

  /** VAT ID verification */
  vatVerification?: VerificationStatus;

  /** Exchange rate verification */
  exchangeRateVerification?: VerificationStatus;

  /** Rounding/calculation accuracy */
  calculationAccuracy?: VerificationStatus;

  /** Peppol participant verification */
  peppolVerification?: VerificationStatus;

  /** Additional custom checks */
  [key: string]: VerificationStatus | undefined;
}

/**
 * Risk notes and warnings
 */
export interface RiskNote {
  /** Note code */
  code: string;

  /** Human-readable message */
  message: string;

  /** Severity level */
  severity: 'low' | 'medium' | 'high';

  /** Category */
  category?: string;
}

/**
 * ComplianceFingerprint is the cryptographic attestation of validation.
 *
 * This is the primary output that should be stored long-term.
 * It proves that a specific invoice was validated at a specific time
 * with specific rules, without storing the original invoice content.
 *
 * @example
 * ```typescript
 * const fingerprint: ComplianceFingerprint = {
 *   id: 'FL-9928374',
 *   status: 'APPROVED_WITH_WARNINGS',
 *   score: 98,
 *   timestamp: '2024-01-23T12:00:00Z',
 *   checks: {
 *     schemaValidation: 'VERIFIED',
 *     vatVerification: 'VERIFIED_LIVE',
 *     calculationAccuracy: 'VERIFIED',
 *   },
 *   riskNotes: [
 *     { code: 'VAT-EXP-30', message: 'Seller VAT ID expires in 30 days', severity: 'medium' }
 *   ],
 *   fingerprint: 'sha256:e3b0c44298fc1c149afbf4c8996fb...',
 *   executionPlan: { id: 'default-v1', version: '1.0.0', configHash: 'sha256:...' },
 * };
 * ```
 */
export interface ComplianceFingerprint {
  /**
   * Unique FiscalLayer ID
   * Format: 'FL-{nanoid}'
   */
  id: string;

  /**
   * Overall validation status
   */
  status: ValidationStatus;

  /**
   * Compliance score (0-100)
   */
  score: number;

  /**
   * Validation timestamp (ISO 8601)
   */
  timestamp: string;

  /**
   * Individual check results
   */
  checks: FingerprintChecks;

  /**
   * Risk notes and warnings
   */
  riskNotes: RiskNote[];

  /**
   * SHA-256 hash of the full validation report
   * This proves the fingerprint was generated from a specific validation
   */
  fingerprint: string;

  /**
   * Execution plan reference
   */
  executionPlan: {
    id: string;
    version: string;
    configHash: string;
  };

  /**
   * Invoice summary (masked)
   */
  invoiceSummary: InvoiceSummary;

  /**
   * Filter versions used
   */
  filterVersions: Record<string, string>;

  /**
   * Validation duration (ms)
   */
  durationMs: number;

  /**
   * Optional signature for additional integrity
   */
  signature?: {
    algorithm: string;
    value: string;
    keyId?: string;
  };
}

/**
 * Options for fingerprint generation
 */
export interface FingerprintOptions {
  /**
   * Whether to include a signature
   */
  sign?: boolean;

  /**
   * Key ID for signing
   */
  keyId?: string;

  /**
   * Additional metadata to include in hash
   */
  metadata?: Record<string, unknown>;
}
