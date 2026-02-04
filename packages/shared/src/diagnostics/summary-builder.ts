/**
 * Diagnostics Summary Builder
 *
 * Aggregates validation diagnostics into a privacy-safe summary
 * suitable for API responses and exports.
 */

import type { Diagnostic, DiagnosticSeverity } from '@fiscal-layer/contracts';

/**
 * Options for building diagnostics summary
 */
export interface DiagnosticsSummaryOptions {
  /**
   * Maximum number of diagnostics to process per step.
   * Prevents memory issues with very large documents.
   * @default 200
   */
  maxDiagnosticsPerStep?: number;

  /**
   * Maximum number of top rules to include in summary.
   * @default 10
   */
  maxTopRules?: number;

  /**
   * Whether to include hints in the summary.
   * @default false
   */
  includeHints?: boolean;
}

/**
 * A rule occurrence in the summary
 */
export interface TopRuleEntry {
  /**
   * The rule identifier (e.g., 'BR-DE-01')
   */
  ruleId: string;

  /**
   * Severity level of this rule's diagnostics
   */
  severity: DiagnosticSeverity;

  /**
   * Number of occurrences of this rule
   */
  count: number;

  /**
   * i18n key for the rule title
   * Format: 'rules.<RULE_ID>.title'
   */
  titleKey: string;

  /**
   * i18n key for the rule hint (optional)
   * Format: 'rules.<RULE_ID>.hint'
   */
  hintKey?: string;
}

/**
 * Aggregated diagnostics summary
 */
export interface DiagnosticsSummary {
  /**
   * Most frequent rules, sorted by count descending
   */
  topRules: TopRuleEntry[];

  /**
   * Total counts by severity level
   */
  totalBySeverity: {
    error: number;
    warning: number;
    info: number;
    hint: number;
  };

  /**
   * Whether the diagnostics were truncated due to limits
   */
  truncated: boolean;

  /**
   * Total number of diagnostics processed
   */
  totalCount: number;
}

/**
 * Default options for summary building
 */
const DEFAULT_OPTIONS: Required<DiagnosticsSummaryOptions> = {
  maxDiagnosticsPerStep: 200,
  maxTopRules: 10,
  includeHints: false,
};

/**
 * Build a privacy-safe diagnostics summary from raw diagnostics.
 *
 * This function:
 * - Counts occurrences of each rule
 * - Aggregates by severity
 * - Returns only rule IDs and counts (no raw messages)
 * - Respects truncation limits
 *
 * @param diagnostics - Array of diagnostics to summarize
 * @param options - Summary options
 * @returns Aggregated summary safe for API responses
 *
 * @example
 * const summary = buildDiagnosticsSummary(report.diagnostics);
 * console.log(summary.topRules[0]); // { ruleId: 'BR-DE-01', severity: 'error', count: 3, ... }
 */
export function buildDiagnosticsSummary(
  diagnostics: readonly Diagnostic[],
  options?: DiagnosticsSummaryOptions,
): DiagnosticsSummary {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Initialize totals
  const totalBySeverity = {
    error: 0,
    warning: 0,
    info: 0,
    hint: 0,
  };

  // Track rule occurrences: ruleId -> { severity, count }
  const ruleMap = new Map<string, { severity: DiagnosticSeverity; count: number }>();

  // Process diagnostics with truncation
  const limit = opts.maxDiagnosticsPerStep;
  const truncated = diagnostics.length > limit;
  const toProcess = truncated ? diagnostics.slice(0, limit) : diagnostics;

  for (const diag of toProcess) {
    // Skip hints if not included
    if (diag.severity === 'hint' && !opts.includeHints) {
      continue;
    }

    // Update severity totals
    totalBySeverity[diag.severity]++;

    // Extract rule ID from diagnostic code
    const ruleId = extractRuleId(diag.code);
    if (!ruleId) {
      continue;
    }

    // Update rule count
    const existing = ruleMap.get(ruleId);
    if (existing) {
      existing.count++;
      // Keep the highest severity for this rule
      existing.severity = higherSeverity(existing.severity, diag.severity);
    } else {
      ruleMap.set(ruleId, { severity: diag.severity, count: 1 });
    }
  }

  // Convert map to sorted array (by count descending, then by severity)
  const sortedRules = Array.from(ruleMap.entries())
    .map(([ruleId, data]) => ({
      ruleId,
      severity: data.severity,
      count: data.count,
      titleKey: `rules.${ruleId}.title`,
      hintKey: `rules.${ruleId}.hint`,
    }))
    .sort((a, b) => {
      // Sort by count descending
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      // Then by severity (error > warning > info > hint)
      return severityRank(b.severity) - severityRank(a.severity);
    })
    .slice(0, opts.maxTopRules);

  return {
    topRules: sortedRules,
    totalBySeverity,
    truncated,
    totalCount: toProcess.length,
  };
}

/**
 * Extract rule ID from a diagnostic code.
 * Handles various code formats:
 * - 'BR-DE-01' -> 'BR-DE-01'
 * - 'SCHEMA:BR-01' -> 'BR-01'
 * - 'kosit:BR-DE-17' -> 'BR-DE-17'
 */
function extractRuleId(code: string): string | null {
  if (!code) {
    return null;
  }

  // If code contains a colon, take the part after it
  const colonIndex = code.indexOf(':');
  const ruleIdPart = colonIndex >= 0 ? code.slice(colonIndex + 1) : code;

  // Validate it looks like a rule ID (starts with known prefix)
  const ruleIdPattern = /^(BR|PEPPOL|UBL|CII|SCH)/i;
  if (ruleIdPattern.test(ruleIdPart)) {
    return ruleIdPart.toUpperCase();
  }

  // For other codes, use them as-is but uppercase
  return ruleIdPart.toUpperCase();
}

/**
 * Get the higher severity between two
 */
function higherSeverity(a: DiagnosticSeverity, b: DiagnosticSeverity): DiagnosticSeverity {
  const rankA = severityRank(a);
  const rankB = severityRank(b);
  return rankA >= rankB ? a : b;
}

/**
 * Numeric rank for severity (higher = more severe)
 */
function severityRank(severity: DiagnosticSeverity): number {
  switch (severity) {
    case 'error':
      return 4;
    case 'warning':
      return 3;
    case 'info':
      return 2;
    case 'hint':
      return 1;
    default:
      return 0;
  }
}
