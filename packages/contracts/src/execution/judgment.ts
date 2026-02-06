/**
 * Judgment Output Contract
 *
 * Frozen output contract for CFO-readable validation judgments.
 * This interface bridges the technical validation pipeline and
 * business-level decision communication (ERP/audit/CFO).
 *
 * @packageDocumentation
 */

import type { FinalDecision, BlockType } from './policy-gate.js';
import type { EvidenceLevel } from '../core/document-nature.js';

// ---------------------------------------------------------------------------
// Enums & Constants
// ---------------------------------------------------------------------------

/**
 * Final conclusion for the judgment, mapped from FinalDecision.
 * These are the only values a consumer will ever see.
 */
export type JudgmentConclusion = 'OK' | 'WARNING' | 'BLOCK';

/**
 * Controlled vocabulary for risk severity in judgment output.
 * Mirrors RiskSeverity from risk-scenario.ts but defined here
 * for contract stability.
 */
export type RiskSeverityContract = 'OK' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'WARNING';

/**
 * Canonical mapping from FinalDecision to JudgmentConclusion.
 * This mapping is immutable.
 */
export const DECISION_TO_CONCLUSION: Readonly<Record<FinalDecision, JudgmentConclusion>> = {
  ALLOW: 'OK',
  ALLOW_WITH_WARNINGS: 'WARNING',
  BLOCK: 'BLOCK',
} as const;

/**
 * Sentinel value for primaryRiskId when no risk scenario was matched.
 * Used instead of internal IDs like "RISK_OK" which are not part of the
 * whitepaper risk catalogue.
 *
 * When primaryRiskId === RISK_ID_NONE, hitRiskIds MUST be [].
 */
export const RISK_ID_NONE = 'NONE' as const;

// ---------------------------------------------------------------------------
// Sub-interfaces
// ---------------------------------------------------------------------------

/**
 * Explains how the final conclusion was reached, including
 * whether evidence-level capping was applied.
 */
export interface DecisionBasis {
  /** Raw conclusion from policy engine (before evidence capping) */
  rawConclusion: JudgmentConclusion;

  /** Final conclusion after evidence-level constraints */
  finalConclusion: JudgmentConclusion;

  /** Whether the conclusion was capped by evidence level */
  wasEvidenceCapped: boolean;

  /** If capped, explains why (e.g., "E1 scanned documents cannot achieve definitive OK") */
  capReason?: string | undefined;
}

/**
 * Non-sensitive summary of validation inputs for audit context.
 * Does NOT contain PII.
 */
export interface InputsSummary {
  /** Evidence level of the source document */
  evidenceLevel: EvidenceLevel;

  /** Document type / format (e.g., 'xrechnung', 'zugferd', 'pdf-scanned') */
  documentFormat: string;

  /** Invoice standard (e.g., 'EN16931', 'UBL', 'CII') */
  standard?: string | undefined;

  /** Country context derived from seller/buyer, NOT PII (e.g., 'DE', 'EU-cross-border') */
  taxJurisdiction?: string | undefined;
}

/**
 * Manual review checklist with explicit trigger condition.
 */
export interface ManualReviewChecklist {
  /** Why manual review is required (e.g., 'evidence_level_E1', 'extraction_uncertainty') */
  requiredBecause: string;

  /** Checklist items for manual verification */
  items: string[];
}

/**
 * Structured explanation of the judgment for customer display.
 */
export interface JudgmentExplanation {
  /** Human-readable summary paragraph */
  summary: string;

  /** Short headline */
  headline: string;

  /** Reason codes that contributed to this conclusion */
  reasonCodes: string[];

  /** Block type, only present when conclusion is BLOCK */
  blockType?: BlockType | undefined;
}

/**
 * Audit trail for regulatory evidence.
 * All fields are non-sensitive and safe for long-term storage.
 */
export interface JudgmentAuditTrace {
  /** Correlation ID linking to the original validation run */
  correlationId: string;

  /** Unique run ID for this validation */
  runId: string;

  /** Policy version that produced the decision */
  policyVersion: string;

  /** Version of the judgment assembler */
  judgmentVersion: string;

  /**
   * SHA-256 digest of the source PolicyGateDecision.
   * Fixed format: "sha256:<64-character-hex-string>"
   * Computed via computeConfigHash() from @fiscal-layer/shared.
   */
  sourceDecisionDigest: string;

  /** When the policy decision became effective (ISO 8601) */
  decisionEffectiveAt: string;

  /** When this judgment was generated (ISO 8601) */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Risk Definition Types
// ---------------------------------------------------------------------------

/**
 * Trigger condition for a risk definition.
 */
export interface RiskTrigger {
  /** Type of trigger ('reason_code' or 'diagnostic_code') */
  type: 'reason_code' | 'diagnostic_code';

  /** Specific reason codes that trigger this risk */
  reasonCodes?: string[] | undefined;

  /** Diagnostic codes that trigger this risk */
  diagnosticCodes?: string[] | undefined;

  /** Human-readable description of when this trigger fires */
  description: string;
}

/**
 * Evidence strategy defines maximum conclusion per evidence level.
 */
export interface EvidenceStrategy {
  /** Maximum conclusion allowed at this evidence level */
  maxConclusion: JudgmentConclusion;

  /** i18n key for guidance text at this evidence level */
  guidanceKey: string;
}

/**
 * Structured definition of a risk scenario with triggers and evidence strategies.
 */
export interface RiskDefinition {
  /** Risk ID (internal system ID) */
  id: string;

  /** External/whitepaper-stable ID */
  externalId: string;

  /** Severity level */
  severity: RiskSeverityContract;

  /** Regulatory basis (e.g., '§ 15 UStG') */
  regulatoryBasis: string;

  /** Conditions under which this risk fires */
  triggers: RiskTrigger[];

  /** Maximum conclusion per evidence level */
  evidenceStrategies: Record<EvidenceLevel, EvidenceStrategy>;

  /** Audit relevance level */
  auditRelevance: 'critical' | 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// JudgmentOutput (FROZEN)
// ---------------------------------------------------------------------------

/**
 * STABILITY GUARANTEE (v1.0):
 * - This interface is FROZEN after initial release
 * - Existing required fields MUST NOT be renamed, removed, or change type
 * - New fields may ONLY be added as OPTIONAL (never required)
 * - auditTrace.sourceDecisionDigest format is fixed: "sha256:<64-char-hex>"
 * - JudgmentConclusion values ('OK' | 'WARNING' | 'BLOCK') are immutable
 * - RiskSeverityContract values are immutable
 * - DECISION_TO_CONCLUSION mapping is immutable
 *
 * Breaking changes require a new major version with a new type name.
 *
 * Required fields (frozen, names/types cannot change):
 *   conclusion, decisionBasis, primaryRiskId, primaryRiskSeverity,
 *   hitRiskIds, explanation, recommendedActions, inputsSummary,
 *   auditTrace, locale, disclaimerKey
 *
 * Optional fields (may be absent):
 *   manualReviewChecklist
 */
export interface JudgmentOutput {
  // === Decision ===

  /** Final conclusion: OK, WARNING, or BLOCK */
  conclusion: JudgmentConclusion;

  /** How the conclusion was reached (includes evidence capping info) */
  decisionBasis: DecisionBasis;

  // === Risk ===

  /** Primary risk ID (whitepaper-stable external ID, e.g., 'RISK_001') */
  primaryRiskId: string;

  /** Severity of the primary risk (controlled enum) */
  primaryRiskSeverity: RiskSeverityContract;

  /** All matched external risk IDs */
  hitRiskIds: string[];

  // === Explanation ===

  /** Structured explanation for customer display */
  explanation: JudgmentExplanation;

  /** Recommended actions for the user */
  recommendedActions: string[];

  // === Evidence & Inputs ===

  /** Non-sensitive summary of validation inputs */
  inputsSummary: InputsSummary;

  // === Audit ===

  /** Audit trail for regulatory evidence */
  auditTrace: JudgmentAuditTrace;

  // === Manual Review ===

  /** Manual review checklist (present when manual review is required) */
  manualReviewChecklist?: ManualReviewChecklist | undefined;

  // === Meta ===

  /** Locale used to generate this judgment */
  locale: string;

  /** i18n key for disclaimer text */
  disclaimerKey: string;
}
