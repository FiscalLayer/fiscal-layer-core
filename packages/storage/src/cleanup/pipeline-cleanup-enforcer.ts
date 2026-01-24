import type {
  PipelineCleanupEnforcer,
  PipelineCleanupConfig,
  PipelineCleanupContext,
  PipelineCleanupResult,
  RetentionPolicyType,
  RetentionWarning,
} from '@fiscal-layer/contracts';
import { SecureDeleteFilter } from './secure-delete-filter.js';

/**
 * Default logger that logs to console (safe - no sensitive data)
 */
const defaultLogger = {
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (process.env['NODE_ENV'] !== 'production') {
      console.debug(`[PipelineCleanup] ${message}`, meta ?? '');
    }
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(`[PipelineCleanup] ${message}`, meta ?? '');
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    console.error(`[PipelineCleanup] ${message}`, meta ?? '');
  },
};

/**
 * Implementation of PipelineCleanupEnforcer.
 *
 * Wraps SecureDeleteFilter and provides guaranteed cleanup with:
 * - Error handling that never throws
 * - Warnings for failed operations
 * - Audit event emission
 */
export class PipelineCleanupEnforcerImpl implements PipelineCleanupEnforcer {
  private readonly secureDeleteFilter: SecureDeleteFilter;
  private readonly config: PipelineCleanupConfig;
  private readonly policyType: RetentionPolicyType;
  private readonly logger: PipelineCleanupConfig['logger'];

  constructor(config: PipelineCleanupConfig) {
    this.config = config;
    this.secureDeleteFilter = new SecureDeleteFilter(config.store, config.cleanupQueue);
    this.policyType = config.policyType ?? 'zero-retention';
    this.logger = config.logger ?? defaultLogger;
  }

  /**
   * Clean up temp keys after pipeline execution.
   *
   * This method NEVER throws - all errors become warnings.
   */
  async cleanup(context: PipelineCleanupContext): Promise<PipelineCleanupResult> {
    const startTime = Date.now();
    const warnings: RetentionWarning[] = [];

    // Early return if no keys to clean
    if (context.tempKeys.length === 0) {
      this.logger?.debug('No temp keys to clean up', {
        runId: context.runId,
        correlationId: context.correlationId,
      });

      return {
        completed: true,
        deleted: 0,
        queued: [],
        durationMs: 0,
        warnings: [],
      };
    }

    try {
      this.logger?.debug('Starting cleanup', {
        runId: context.runId,
        correlationId: context.correlationId,
        keyCount: context.tempKeys.length,
        pipelineStatus: context.pipelineStatus,
      });

      // Use SecureDeleteFilter for actual cleanup
      const result = await this.secureDeleteFilter.cleanup({
        keys: context.tempKeys,
        correlationId: context.correlationId,
        runId: context.runId,
        pipelineStatus: context.pipelineStatus,
      });

      const durationMs = Date.now() - startTime;

      // Generate warnings for queued keys
      if (result.queued.length > 0) {
        warnings.push({
          code: 'CLEANUP_QUEUED',
          message: `${String(result.queued.length)} temp key(s) queued for retry cleanup`,
          timestamp: new Date().toISOString(),
          affectedCount: result.queued.length,
        });

        this.logger?.warn('Some keys queued for retry', {
          runId: context.runId,
          correlationId: context.correlationId,
          queuedCount: result.queued.length,
        });
      }

      // Check for partial cleanup
      if (result.queued.length > 0 && result.deleted > 0) {
        warnings.push({
          code: 'CLEANUP_PARTIAL',
          message: `Partial cleanup: ${String(result.deleted)} deleted, ${String(result.queued.length)} pending`,
          timestamp: new Date().toISOString(),
          affectedCount: result.queued.length,
        });
      }

      this.logger?.debug('Cleanup completed', {
        runId: context.runId,
        correlationId: context.correlationId,
        deleted: result.deleted,
        queued: result.queued.length,
        durationMs,
      });

      return {
        completed: true,
        deleted: result.deleted,
        queued: result.queued,
        durationMs,
        warnings,
      };
    } catch (error) {
      // CRITICAL: Never throw from cleanup - capture as warning
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      warnings.push({
        code: 'CLEANUP_ERROR',
        message: `Cleanup failed: ${errorMessage}`,
        timestamp: new Date().toISOString(),
        affectedCount: context.tempKeys.length,
      });

      this.logger?.error('Cleanup failed', {
        runId: context.runId,
        correlationId: context.correlationId,
        error: errorMessage,
        keyCount: context.tempKeys.length,
      });

      return {
        completed: false,
        deleted: 0,
        queued: context.tempKeys, // All keys considered queued for retry
        durationMs,
        warnings,
      };
    }
  }

  getConfig(): PipelineCleanupConfig {
    return this.config;
  }

  getPolicyType(): RetentionPolicyType {
    return this.policyType;
  }
}

/**
 * Factory function to create a PipelineCleanupEnforcer.
 */
export function createPipelineCleanupEnforcer(
  config: PipelineCleanupConfig,
): PipelineCleanupEnforcer {
  return new PipelineCleanupEnforcerImpl(config);
}
