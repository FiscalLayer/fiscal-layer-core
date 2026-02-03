import type { Diagnostic } from '../core/diagnostic.js';
import type { InvoiceFormat, ParsedInvoice } from '../core/invoice.js';
import type { StepResult, StepStatistics } from './result.js';
import type { ExecutionPlan, ExecutionPlanSnapshot, EngineVersions } from './plan.js';
import type { ComplianceFingerprint } from './fingerprint.js';
import type { UsageSummary } from '../billing/events.js';
import type { RetentionWarning } from '../privacy/retention-enforcer.js';
import type { PolicyGateDecision } from './policy-gate.js';

/**
 * Report state describes the EXECUTION LIFECYCLE of the pipeline.
 *
 * OSS Boundary: This type describes EXECUTION FACTS, not VALIDATION DECISIONS.
 * - 'complete': Pipeline ran all applicable steps to completion
 * - 'incomplete': Pipeline was aborted or stopped early
 * - 'errored': Pipeline encountered execution errors (not validation errors)
 *
 * Validation decisions (ALLOW/BLOCK) come from `finalDecision` which is
 * computed by the PolicyGate filter (or Private decision layer).
 */
export type ReportState = 'complete' | 'incomplete' | 'errored';

/**
 * Overall validation status.
 *
 * @deprecated This type encodes VALIDATION DECISIONS which belong in the Private layer.
 * Use `reportState` for execution facts and `finalDecision.decision` for validation decisions.
 *
 * OSS Boundary: ValidationReport should report EXECUTION FACTS only:
 * - What steps ran/skipped/errored
 * - What diagnostics were produced
 * - Execution timing and metadata
 *
 * The Private decision layer (PolicyGate) interprets these facts into
 * decisions (ALLOW/ALLOW_WITH_WARNINGS/BLOCK) stored in `finalDecision`.
 *
 * Migration:
 * - Use `report.reportState` for execution lifecycle ('complete'/'incomplete'/'errored')
 * - Use `report.finalDecision.decision` for the actual decision
 * - Use `report.steps` execution status for raw execution facts
 * - This field will be removed in a future major version
 */
export type ValidationStatus =
  | 'APPROVED' // Decision - use finalDecision.decision instead
  | 'APPROVED_WITH_WARNINGS' // Decision - use finalDecision.decision instead
  | 'REJECTED' // Decision - use finalDecision.decision instead
  | 'ERROR' // Execution fact - use reportState instead
  | 'TIMEOUT'; // Execution fact - use reportState instead

/**
 * Constants for ValidationStatus values.
 * Use these instead of string literals in implementation code.
 * @internal
 */
export const ValidationStatusValues = {
  APPROVED: 'APPROVED' as const,
  APPROVED_WITH_WARNINGS: 'APPROVED_WITH_WARNINGS' as const,
  REJECTED: 'REJECTED' as const,
  ERROR: 'ERROR' as const,
  TIMEOUT: 'TIMEOUT' as const,
} as const;

/**
 * Plan snapshot captures the exact execution plan used for validation.
 * This provides evidence chain for audit purposes - "what rules were applied?"
 */
export interface PlanSnapshot {
  /**
   * Plan ID
   */
  id: string;

  /**
   * Plan version
   */
  version: string;

  /**
   * SHA-256 hash of the canonical plan configuration
   * Format: "sha256:<hex>"
   */
  configHash: string;

  /**
   * SHA-256 hash of the complete plan snapshot.
   * Includes: steps, versions, configSnapshotHash.
   * Used for audit trail integrity verification.
   * Format: "sha256:<hex>"
   */
  planHash: string;

  /**
   * SHA-256 hash of the effective runtime configuration.
   * This captures the merged config: system defaults + tenant + request overrides.
   * Format: "sha256:<hex>"
   */
  configSnapshotHash: string;

  /**
   * Engine and component versions used during execution.
   * Critical for reproducibility.
   */
  engineVersions: EngineVersions;

  /**
   * Filter versions used in this execution
   * Maps filterId -> version
   */
  filterVersions: Record<string, string>;

  /**
   * Step configuration hashes
   * Maps filterId -> configHash
   */
  stepConfigHashes: Record<string, string>;

  /**
   * When this snapshot was captured
   */
  capturedAt: string;

  /**
   * Optional: full plan for debug/audit purposes
   * Only included if explicitly requested
   */
  fullPlan?: ExecutionPlan;

  /**
   * Optional: full execution snapshot with step details
   * Only included if explicitly requested for detailed audit
   */
  executionSnapshot?: ExecutionPlanSnapshot;
}

/**
 * Summary of the validated invoice (safe to store)
 */
export interface InvoiceSummary {
  /** Detected format */
  format: InvoiceFormat;

  /** Invoice number (may be masked) */
  invoiceNumber?: string;

  /** Issue date */
  issueDate?: string;

  /** Currency */
  currency?: string;

  /** Total amount */
  totalAmount?: number;

  /** Seller VAT ID (masked) */
  sellerVatId?: string;

  /** Buyer VAT ID (masked) */
  buyerVatId?: string;

  /** Number of line items */
  lineItemCount?: number;
}

/**
 * ValidationReport is the complete output of the validation pipeline.
 *
 * This contains all diagnostics, step results, and metadata about the validation.
 * A masked version is available via `maskedReport` for safe storage/logging.
 *
 * @example
 * ```typescript
 * const report: ValidationReport = {
 *   runId: 'run-abc123',
 *   status: 'APPROVED_WITH_WARNINGS',
 *   score: 85,
 *   diagnostics: [...],
 *   steps: [...],
 *   fingerprint: {...},
 *   // ...
 * };
 * ```
 */
export interface ValidationReport {
  /**
   * Unique identifier for this validation run
   */
  runId: string;

  /**
   * Pipeline execution lifecycle state.
   *
   * OSS Boundary: This describes EXECUTION FACTS, not VALIDATION DECISIONS.
   * - 'complete': All applicable steps ran to completion
   * - 'incomplete': Pipeline was aborted or stopped early
   * - 'errored': Pipeline encountered execution errors
   *
   * For validation decisions, use `finalDecision.decision`.
   */
  reportState: ReportState;

  /**
   * Overall validation status.
   *
   * @deprecated Use `reportState` for execution facts and `finalDecision.decision` for decisions.
   * This field is derived from `finalDecision` when present, otherwise falls back to legacy behavior.
   * Will be removed in a future major version.
   */
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Backwards compatibility: status field kept for existing consumers
  status: ValidationStatus;

  /**
   * Compliance score (0-100).
   * 100 = perfect compliance, 0 = completely non-compliant.
   *
   * @deprecated Score calculation is DECISION LOGIC that belongs in Private layer.
   * OSS should report raw diagnostics; Private layer computes scores.
   *
   * Migration: Score will be moved to `finalDecision.metadata.score` in Private.
   */
  score: number;

  /**
   * All diagnostics from all steps
   */
  diagnostics: Diagnostic[];

  /**
   * Diagnostic counts by severity
   */
  diagnosticCounts: {
    errors: number;
    warnings: number;
    info: number;
    hints: number;
  };

  /**
   * Results from each step
   */
  steps: StepResult[];

  /**
   * Step execution statistics.
   *
   * Note: StepStatistics now contains only execution facts (ran/skipped/errored).
   * Decision-based statistics (passed/failed/warnings) have been removed.
   * Use LegacyStepStatistics for backwards compatibility during migration.
   */
  stepStatistics: StepStatistics;

  /**
   * Invoice summary (masked, safe to store)
   */
  invoiceSummary: InvoiceSummary;

  /**
   * Full parsed invoice data (NOT safe to store - use for immediate processing only)
   * This may be undefined if retention policy prevents access
   */
  parsedInvoice?: ParsedInvoice;

  /**
   * Plan snapshot - captures exactly what was executed
   * Provides evidence chain for audit: "what rules were applied?"
   */
  planSnapshot: PlanSnapshot;

  /**
   * Compliance fingerprint (cryptographic attestation)
   */
  fingerprint: ComplianceFingerprint;

  /**
   * Validation timing
   */
  timing: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };

  /**
   * Request metadata
   */
  metadata?: Record<string, unknown>;

  /**
   * Correlation ID for tracing
   */
  correlationId?: string;

  /**
   * Usage summary for billing
   */
  usageSummary?: UsageSummary;

  /**
   * Retention enforcement warnings.
   * These indicate issues with cleanup but don't affect validation result.
   * Present only if cleanup had issues (queued for retry, etc.)
   */
  retentionWarnings?: RetentionWarning[];

  /**
   * Applied retention policy type.
   * Indicates how temp data was handled after pipeline completion.
   * - 'zero-retention': Immediate deletion (default for privacy)
   * - 'audit-retention': Retained for audit period before deletion
   * - 'custom': Custom policy defined by configuration
   * - undefined: No enforcer configured (backwards compatibility)
   */
  appliedRetentionPolicy?: 'zero-retention' | 'audit-retention' | 'custom';

  /**
   * Final decision from PolicyGate filter.
   * Contains the ALLOW/ALLOW_WITH_WARNINGS/BLOCK decision with audit trail.
   * Only present if PolicyGate filter was executed in the pipeline.
   */
  finalDecision?: PolicyGateDecision;
}

/**
 * Masked report safe for logging and long-term storage
 */
export interface MaskedValidationReport
  extends Omit<ValidationReport, 'parsedInvoice' | 'diagnostics'> {
  /**
   * Diagnostics with sensitive data masked
   */
  diagnostics: Diagnostic[];

  /**
   * Indicates this is a masked report
   */
  isMasked: true;
}
