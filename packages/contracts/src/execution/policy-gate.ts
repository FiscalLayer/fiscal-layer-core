/**
 * PolicyGate types for compliance firewall decision making.
 *
 * PolicyGate is the final decision layer in the validation pipeline.
 * It evaluates all step results and produces a traceable, auditable decision.
 *
 * Key principles:
 * - PolicyGate only makes decisions, never modifies step results
 * - All decisions are traceable with policyVersion and reasonCodes
 * - No PII in reasonCodes or decision metadata
 * - Pluggable: PolicyGate is a standard Filter, can be enabled/disabled
 *
 * @packageDocumentation
 */

/**
 * Final decision enum for the compliance firewall.
 *
 * - ALLOW: Invoice passes all policy checks, safe to process
 * - ALLOW_WITH_WARNINGS: Invoice passes but has non-critical issues
 * - BLOCK: Invoice fails policy checks, must be rejected
 */
export type FinalDecision = 'ALLOW' | 'ALLOW_WITH_WARNINGS' | 'BLOCK';

/**
 * Categorizes the source of a BLOCK decision for operations/alerting.
 *
 * This distinction is useful for:
 * - Operational dashboards (separating "customer issues" from "system issues")
 * - Alerting (SYSTEM blocks may need on-call response)
 * - Reporting (compliance reports vs. operational reports)
 *
 * - COMPLIANCE: Invoice failed validation rules (schema, business rules, amount mismatches)
 * - POLICY: Invoice blocked by policy configuration (risk threshold, required checks)
 * - SYSTEM: System error prevented validation (timeout, service unavailable)
 */
export type BlockType = 'COMPLIANCE' | 'POLICY' | 'SYSTEM';

/**
 * Reason codes explaining why a decision was made.
 * These must be non-sensitive and safe for logging/audit.
 *
 * STABILITY GUARANTEE:
 * - ReasonCodes are STABLE ENUMS - never contain dynamic strings
 * - Never include PII, paths, values, or invoice-specific data
 * - For detailed context, use StepDecisionAnalysis[] with sanitized fields
 * - New codes require version bump and documentation update
 *
 * Each code maps to a specific policy rule that triggered.
 */
export type DecisionReasonCode =
  // Hard blocks - immediate rejection
  | 'HARD_BLOCK_PRESENT' // Step returned HARD_BLOCK severity
  // Error-based decisions
  | 'ERROR_PRESENT' // Validation errors found
  | 'SCHEMA_ERROR' // Schema validation failed
  | 'SCHEMATRON_ERROR' // Schematron rules failed
  // Warning-based decisions
  | 'WARNINGS_PRESENT' // Non-critical warnings found
  // External verification
  | 'EXTERNAL_VERIFIER_FAILED' // VIES/ECB/Peppol verification failed
  | 'EXTERNAL_VERIFIER_UNAVAILABLE' // External service unreachable
  // Risk-based decisions
  | 'RISK_SCORE_BLOCK' // Risk score exceeds block threshold
  | 'RISK_SCORE_WARN' // Risk score exceeds warn threshold
  // Required checks
  | 'REQUIRED_CHECK_MISSING' // Required step not executed
  | 'REQUIRED_CHECK_FAILED' // Required step failed
  // Step status
  | 'STEP_TIMEOUT' // A step timed out
  | 'STEP_ERROR' // A step had an internal error
  | 'STEP_SKIPPED_ABORTED' // A step was skipped due to pipeline abort
  // Policy
  | 'POLICY_OVERRIDE' // Manual policy override applied
  | 'DEFAULT_ALLOW'; // No issues found, default allow

/**
 * Configuration for the PolicyGate filter.
 *
 * This controls how the PolicyGate interprets step results
 * and makes the final decision.
 */
export interface PolicyGateConfig {
  /**
   * How to handle validation errors.
   * - 'block': Errors result in BLOCK decision (default)
   * - 'allow_with_warnings': Errors result in ALLOW_WITH_WARNINGS
   *
   * @default 'block'
   */
  errorBehavior: 'block' | 'allow_with_warnings';

  /**
   * How to handle external verifier failures (VIES, ECB, Peppol).
   * - 'warn': Failures result in ALLOW_WITH_WARNINGS (default)
   * - 'block': Failures result in BLOCK
   *
   * @default 'warn'
   */
  externalVerifierFailure: 'warn' | 'block';

  /**
   * Risk score thresholds for decisions.
   * Only evaluated if report contains a riskScore.
   *
   * - warn: Score >= this triggers ALLOW_WITH_WARNINGS
   * - block: Score >= this triggers BLOCK
   */
  riskThresholds?: {
    warn: number;
    block: number;
  };

  /**
   * List of step IDs that must be executed and pass.
   * If any of these are missing or failed, the decision is BLOCK.
   *
   * CONVENTION: Use stable filter IDs, not display names:
   * - 'parser' (not 'Parser Filter')
   * - 'kosit' (not 'KoSIT Validator')
   * - 'steps-amount-validation' (hyphenated, lowercase)
   *
   * @example ['parser', 'kosit', 'steps-amount-validation']
   */
  requiredChecks?: string[];

  /**
   * Policy version identifier for audit trail.
   * Should be updated when policy rules change.
   *
   * @default 'default-v1'
   */
  policyVersion: string;

  /**
   * Whether to include detailed step analysis in decision metadata.
   * Useful for debugging but increases response size.
   *
   * @default false
   */
  includeStepAnalysis?: boolean;
}

/**
 * Default PolicyGate configuration.
 * Used when no custom config is provided.
 */
export const DEFAULT_POLICY_GATE_CONFIG: PolicyGateConfig = {
  errorBehavior: 'block',
  externalVerifierFailure: 'warn',
  policyVersion: 'default-v1',
  includeStepAnalysis: false,
};

/**
 * The PolicyGate decision with full audit trail.
 *
 * This is the output of the PolicyGate filter, providing
 * a traceable record of the decision made.
 */
export interface PolicyGateDecision {
  /**
   * The final decision: ALLOW, ALLOW_WITH_WARNINGS, or BLOCK
   */
  decision: FinalDecision;

  /**
   * Reason codes explaining why this decision was made.
   * Multiple codes may be present (e.g., ERROR_PRESENT + WARNINGS_PRESENT).
   * Empty array for ALLOW with no issues (DEFAULT_ALLOW is implicit).
   */
  reasonCodes: DecisionReasonCode[];

  /**
   * Categorizes the source of a BLOCK decision.
   * Only present when decision is 'BLOCK'.
   *
   * - COMPLIANCE: Failed validation rules (schema errors, business rule violations)
   * - POLICY: Blocked by policy config (risk thresholds, required checks)
   * - SYSTEM: System error (timeout, service unavailable)
   */
  blockType?: BlockType;

  /**
   * The policy version that was applied.
   * Matches PolicyGateConfig.policyVersion.
   */
  appliedPolicyVersion: string;

  /**
   * When this decision became effective (ISO 8601).
   */
  effectiveAt: string;

  /**
   * Summary of what triggered the decision.
   * Human-readable, non-sensitive.
   *
   * @example "Blocked due to 3 schema errors"
   * @example "Allowed with 2 warnings"
   */
  summary: string;

  /**
   * Optional detailed analysis of each step's contribution to the decision.
   * Only present if PolicyGateConfig.includeStepAnalysis is true.
   */
  stepAnalysis?: StepDecisionAnalysis[];
}

/**
 * Analysis of how a single step contributed to the decision.
 */
export interface StepDecisionAnalysis {
  /**
   * Step/filter ID
   */
  stepId: string;

  /**
   * Step execution status
   */
  status: string;

  /**
   * Whether this step contributed to the final decision
   */
  contributedToDecision: boolean;

  /**
   * What this step contributed (if anything)
   */
  contribution?: 'block' | 'warn' | 'neutral';

  /**
   * Reason codes this step triggered
   */
  triggeredReasons: DecisionReasonCode[];

  /**
   * Count of diagnostics by severity from this step
   */
  diagnosticCounts: {
    errors: number;
    warnings: number;
    info: number;
  };
}

/**
 * Type guard to check if a value is a valid FinalDecision
 */
export function isFinalDecision(value: unknown): value is FinalDecision {
  return value === 'ALLOW' || value === 'ALLOW_WITH_WARNINGS' || value === 'BLOCK';
}

/**
 * Type guard to check if a value is a valid DecisionReasonCode
 */
export function isDecisionReasonCode(value: unknown): value is DecisionReasonCode {
  const validCodes: DecisionReasonCode[] = [
    'HARD_BLOCK_PRESENT',
    'ERROR_PRESENT',
    'SCHEMA_ERROR',
    'SCHEMATRON_ERROR',
    'WARNINGS_PRESENT',
    'EXTERNAL_VERIFIER_FAILED',
    'EXTERNAL_VERIFIER_UNAVAILABLE',
    'RISK_SCORE_BLOCK',
    'RISK_SCORE_WARN',
    'REQUIRED_CHECK_MISSING',
    'REQUIRED_CHECK_FAILED',
    'STEP_TIMEOUT',
    'STEP_ERROR',
    'STEP_SKIPPED_ABORTED',
    'POLICY_OVERRIDE',
    'DEFAULT_ALLOW',
  ];
  return typeof value === 'string' && validCodes.includes(value as DecisionReasonCode);
}
