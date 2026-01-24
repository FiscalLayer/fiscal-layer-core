import type { RawInvoice, ParsedInvoice } from '../core/invoice.js';
import type { Diagnostic } from '../core/diagnostic.js';
import type { StepResult } from '../execution/result.js';
import type { ExecutionPlan } from '../execution/plan.js';
import type { MaskingPolicy } from '../privacy/masking.js';
import type { RetentionPolicy } from '../privacy/retention.js';

/**
 * Validation options provided by the caller
 */
export interface ValidationOptions {
  /**
   * Locale for diagnostic messages (e.g., 'de-DE', 'en-US')
   * @default 'en-US'
   */
  locale?: string;

  /**
   * Whether to continue validation after first error
   * @default true
   */
  continueOnError?: boolean;

  /**
   * Maximum validation duration in milliseconds
   * @default 30000
   */
  timeoutMs?: number;

  /**
   * Specific filters to skip (by ID)
   */
  skipFilters?: string[];

  /**
   * Custom masking policy (overrides default)
   */
  maskingPolicy?: MaskingPolicy;

  /**
   * Custom retention policy (overrides default)
   */
  retentionPolicy?: RetentionPolicy;

  /**
   * Additional metadata to attach to the report
   */
  metadata?: Record<string, unknown>;
}

/**
 * ValidationContext carries the state through the pipeline.
 *
 * This is the primary interface that filters interact with.
 * It provides access to:
 * - The original and parsed invoice data
 * - Results from previous filter steps
 * - Configuration and options
 * - Utility methods for diagnostics
 *
 * @remarks
 * The context is immutable from the filter's perspective.
 * Filters should not attempt to modify the context directly.
 */
export interface ValidationContext {
  /**
   * Unique identifier for this validation run
   */
  readonly runId: string;

  /**
   * Correlation ID for distributed tracing across systems.
   * Generated at API entry point and propagated to all steps.
   * MUST be included in all step results and logs.
   */
  readonly correlationId: string;

  /**
   * Timestamp when validation started (ISO 8601)
   */
  readonly startedAt: string;

  /**
   * Original raw invoice input
   *
   * @remarks
   * Access to raw content is restricted by retention policy.
   * Filters should prefer using `parsedInvoice` when possible.
   */
  readonly rawInvoice: RawInvoice;

  /**
   * Parsed invoice data (populated after Parser filter)
   * Undefined until the parser filter has executed.
   */
  readonly parsedInvoice: ParsedInvoice | undefined;

  /**
   * The execution plan being used
   */
  readonly executionPlan: ExecutionPlan;

  /**
   * Validation options from the caller
   */
  readonly options: ValidationOptions;

  /**
   * Results from completed filter steps
   */
  readonly completedSteps: readonly StepResult[];

  /**
   * All diagnostics accumulated so far
   */
  readonly diagnostics: readonly Diagnostic[];

  /**
   * Whether validation should be aborted (timeout or fatal error)
   */
  readonly aborted: boolean;

  /**
   * Abort reason (if aborted)
   */
  readonly abortReason: string | undefined;

  /**
   * Get the result of a specific filter (if already executed)
   */
  getStepResult(filterId: string): StepResult | undefined;

  /**
   * Check if a filter has already been executed
   */
  hasExecuted(filterId: string): boolean;

  /**
   * Get configuration for the current filter
   */
  getFilterConfig(filterId: string): Record<string, unknown> | undefined;
}

/**
 * Mutable context used internally by the pipeline orchestrator.
 * Filters receive the readonly ValidationContext interface.
 */
export interface MutableValidationContext extends ValidationContext {
  /**
   * Update parsed invoice data
   */
  setParsedInvoice(invoice: ParsedInvoice): void;

  /**
   * Add a step result
   */
  addStepResult(result: StepResult): void;

  /**
   * Add diagnostics
   */
  addDiagnostics(diagnostics: Diagnostic[]): void;

  /**
   * Mark validation as aborted
   */
  abort(reason: string): void;
}

/**
 * Filter-specific context with configuration
 */
export interface FilterContext extends ValidationContext {
  /**
   * Configuration for the current filter
   */
  readonly config: Record<string, unknown>;
}
