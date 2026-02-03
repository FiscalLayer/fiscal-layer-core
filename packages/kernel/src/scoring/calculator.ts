import type { Diagnostic, StepResult } from '@fiscal-layer/contracts';

/**
 * Weight factors for scoring
 */
const WEIGHTS = {
  error: -20,
  warning: -5,
  info: 0,
  hint: 0,
  stepFailed: -15,
  stepWarning: -3,
  stepError: -10,
} as const;

/**
 * Calculate compliance score from diagnostics and step results.
 *
 * Score ranges from 0 to 100:
 * - 100: Perfect compliance (no issues)
 * - 80-99: Minor warnings
 * - 50-79: Significant warnings
 * - 1-49: Errors but partially compliant
 * - 0: Complete failure
 *
 * @param diagnostics - All diagnostics from validation
 * @param steps - All step results
 * @returns Compliance score (0-100)
 */
export function calculateScore(
  diagnostics: readonly Diagnostic[],
  steps: readonly StepResult[],
): number {
  let score = 100;

  // Deduct for diagnostics
  for (const diagnostic of diagnostics) {
    const weight = WEIGHTS[diagnostic.severity];
    score += weight;
  }

  // Deduct for step execution issues
  // NOTE: Legacy status removed - derive from execution + diagnostics
  for (const step of steps) {
    if (step.execution === 'errored') {
      score += WEIGHTS.stepError;
    } else if (step.execution === 'ran') {
      // Check diagnostics for failure/warning
      const hasErrors = step.diagnostics.some((d) => d.severity === 'error');
      const hasWarnings = step.diagnostics.some((d) => d.severity === 'warning');
      if (hasErrors) {
        score += WEIGHTS.stepFailed;
      } else if (hasWarnings) {
        score += WEIGHTS.stepWarning;
      }
    }
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

/**
 * Determine the score category.
 */
export function getScoreCategory(
  score: number,
): 'excellent' | 'good' | 'fair' | 'poor' | 'critical' {
  if (score >= 95) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 20) return 'poor';
  return 'critical';
}
