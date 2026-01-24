import type { RawInvoice } from '../core/invoice.js';
import type { ValidationOptions } from './context.js';
import type { ValidationReport } from '../execution/report.js';
import type { ExecutionPlan } from '../execution/plan.js';
import type {
  PipelineCleanupEnforcer,
  PipelineCleanupResult,
} from '../privacy/retention-enforcer.js';

/**
 * Input for pipeline execution
 */
export interface PipelineInput {
  /**
   * The invoice to validate
   */
  invoice: RawInvoice;

  /**
   * Validation options
   */
  options?: ValidationOptions;

  /**
   * Execution plan to use (optional, uses default if not provided)
   */
  plan?: ExecutionPlan;

  /**
   * Correlation ID for tracing (optional, auto-generated if not provided)
   */
  correlationId?: string;
}

/**
 * Pipeline execution events for monitoring
 */
export interface PipelineEvents {
  /**
   * Emitted when pipeline execution starts
   */
  onStart?: (input: PipelineInput) => void;

  /**
   * Emitted when a filter step starts
   */
  onStepStart?: (filterId: string) => void;

  /**
   * Emitted when a filter step completes
   */
  onStepComplete?: (filterId: string, durationMs: number) => void;

  /**
   * Emitted when pipeline execution completes
   */
  onComplete?: (report: ValidationReport) => void;

  /**
   * Emitted on errors
   */
  onError?: (error: Error, filterId?: string) => void;

  /**
   * Emitted when retention cleanup completes (in finally block)
   */
  onCleanup?: (result: PipelineCleanupResult) => void;
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  /**
   * Default execution plan
   */
  defaultPlan: ExecutionPlan;

  /**
   * Maximum concurrent parallel filter executions
   * @default 5
   */
  maxParallelism?: number;

  /**
   * Default timeout for individual filters (ms)
   * @default 10000
   */
  defaultFilterTimeout?: number;

  /**
   * Default timeout for entire pipeline (ms)
   * @default 30000
   */
  defaultPipelineTimeout?: number;

  /**
   * Event handlers
   */
  events?: PipelineEvents;

  /**
   * Cleanup enforcer for guaranteed temp data deletion.
   * When provided, cleanup runs in the finally block.
   */
  cleanupEnforcer?: PipelineCleanupEnforcer;
}

/**
 * Pipeline orchestrates the execution of filters.
 *
 * The pipeline:
 * - Manages filter ordering and dependencies
 * - Handles sequential and parallel execution
 * - Accumulates results into a ValidationReport
 * - Supports conditional execution and early termination
 *
 * @example
 * ```typescript
 * const pipeline = new Pipeline(config);
 *
 * const report = await pipeline.execute({
 *   invoice: { content: '<Invoice>...</Invoice>' },
 *   options: { locale: 'de-DE' }
 * });
 *
 * console.log(report.status); // 'APPROVED' | 'REJECTED' | ...
 * ```
 */
export interface Pipeline {
  /**
   * Execute the validation pipeline
   *
   * @param input - Pipeline input with invoice and options
   * @returns Promise resolving to the validation report
   */
  execute(input: PipelineInput): Promise<ValidationReport>;

  /**
   * Get the current execution plan
   */
  getExecutionPlan(): ExecutionPlan;

  /**
   * Update the execution plan
   */
  setExecutionPlan(plan: ExecutionPlan): void;

  /**
   * Check if the pipeline is currently executing
   */
  isExecuting(): boolean;
}
