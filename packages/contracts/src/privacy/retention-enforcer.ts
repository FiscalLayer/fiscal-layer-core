import type { TempStore, CleanupQueue } from '../storage/temp-store.js';
import type { RetentionPolicy } from './retention.js';

/**
 * Retention policy type for quick reference
 */
export type RetentionPolicyType = 'zero-retention' | 'audit-retention' | 'custom';

/**
 * Configuration for the pipeline cleanup enforcer
 */
export interface PipelineCleanupConfig {
  /**
   * TempStore instance for secure deletion
   */
  store: TempStore;

  /**
   * Cleanup queue for failed delete retries
   */
  cleanupQueue: CleanupQueue;

  /**
   * Retention policy to enforce
   */
  policy?: RetentionPolicy;

  /**
   * Policy type shorthand (default: 'zero-retention')
   */
  policyType?: RetentionPolicyType;

  /**
   * Whether to emit audit events on cleanup (default: true)
   */
  emitAuditEvents?: boolean;

  /**
   * Logger for cleanup operations (optional)
   * Must be a safe logger that won't log sensitive data
   */
  logger?: {
    debug: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * Result of pipeline cleanup
 */
export interface PipelineCleanupResult {
  /**
   * Whether cleanup completed (may still have queued failures)
   */
  completed: boolean;

  /**
   * Number of keys successfully deleted
   */
  deleted: number;

  /**
   * Keys that were queued for retry (cleanup failed but will retry)
   */
  queued: string[];

  /**
   * Duration of the cleanup operation in ms
   */
  durationMs: number;

  /**
   * Non-sensitive warnings to include in report
   */
  warnings: RetentionWarning[];
}

/**
 * A non-sensitive warning about retention enforcement.
 * These are safe to include in the validation report.
 */
export interface RetentionWarning {
  /**
   * Warning code for programmatic handling
   */
  code: 'CLEANUP_QUEUED' | 'CLEANUP_ERROR' | 'CLEANUP_PARTIAL';

  /**
   * Human-readable message (no sensitive data)
   */
  message: string;

  /**
   * Timestamp when the warning occurred
   */
  timestamp: string;

  /**
   * Number of affected keys (don't expose the keys themselves)
   */
  affectedCount?: number;
}

/**
 * Context for pipeline cleanup.
 * This is what the Pipeline passes to the enforcer.
 */
export interface PipelineCleanupContext {
  /**
   * Unique run identifier
   */
  runId: string;

  /**
   * Correlation ID for tracing
   */
  correlationId: string;

  /**
   * Keys to clean up
   */
  tempKeys: string[];

  /**
   * Pipeline completion status
   */
  pipelineStatus: 'success' | 'failure' | 'timeout' | 'error';
}

/**
 * PipelineCleanupEnforcer ensures temp data is deleted after pipeline execution.
 *
 * This acts as the "finally" semantics for the pipeline - it runs
 * regardless of whether the pipeline succeeded, failed, or timed out.
 *
 * Key guarantees:
 * 1. Cleanup ALWAYS runs (finally semantics)
 * 2. Cleanup failures don't prevent report return
 * 3. Failed deletes are queued for retry
 * 4. Warnings are returned (not thrown) for audit
 *
 * @example
 * ```typescript
 * const enforcer = createPipelineCleanupEnforcer({
 *   store: tempStore,
 *   cleanupQueue: queue,
 *   policyType: 'zero-retention',
 * });
 *
 * // In pipeline finally block
 * const result = await enforcer.cleanup({
 *   runId: ctx.runId,
 *   correlationId: ctx.correlationId,
 *   tempKeys: ['raw-invoice:abc', 'parsed:abc'],
 *   pipelineStatus: 'success',
 * });
 *
 * // Add warnings to report
 * report.retentionWarnings = result.warnings;
 * ```
 */
export interface PipelineCleanupEnforcer {
  /**
   * Clean up temp keys after pipeline execution.
   *
   * This method NEVER throws - errors become warnings in the result.
   *
   * @param context - Cleanup context
   * @returns Result with cleanup stats and warnings
   */
  cleanup(context: PipelineCleanupContext): Promise<PipelineCleanupResult>;

  /**
   * Get the current configuration
   */
  getConfig(): PipelineCleanupConfig;

  /**
   * Get the policy type being enforced
   */
  getPolicyType(): RetentionPolicyType;
}

/**
 * Audit event emitted when cleanup completes
 */
export interface RetentionCleanupEvent {
  /**
   * Event type
   */
  type: 'RETENTION_CLEANUP';

  /**
   * Run ID
   */
  runId: string;

  /**
   * Correlation ID
   */
  correlationId: string;

  /**
   * Cleanup result
   */
  result: 'success' | 'partial' | 'failed';

  /**
   * Number of keys deleted
   */
  deleted: number;

  /**
   * Number of keys queued for retry
   */
  queued: number;

  /**
   * Pipeline status that triggered cleanup
   */
  pipelineStatus: 'success' | 'failure' | 'timeout' | 'error';

  /**
   * Timestamp
   */
  timestamp: string;
}

/**
 * Audit event emitted when cleanup fails permanently
 */
export interface RetentionDeleteFailedEvent {
  /**
   * Event type
   */
  type: 'RETENTION_DELETE_FAILED';

  /**
   * Run ID (if available)
   */
  runId?: string;

  /**
   * Correlation ID (if available)
   */
  correlationId?: string;

  /**
   * Number of keys that failed
   */
  failedCount: number;

  /**
   * Categories of failed keys (no actual key content)
   */
  categories: string[];

  /**
   * Error message
   */
  error: string;

  /**
   * Timestamp
   */
  timestamp: string;
}
