import type {
  CleanupQueue,
  FailedDeleteRecord,
  SecureCleanupOptions,
  SecureCleanupResult,
  TempStore,
} from '@fiscal-layer/contracts';

/**
 * SecureDeleteFilter ensures all temporary data is deleted after pipeline completion.
 *
 * This acts as a "finally" block for the pipeline - it runs regardless of
 * whether the pipeline succeeded, failed, or timed out.
 *
 * @example
 * ```typescript
 * const filter = new SecureDeleteFilter(tempStore, cleanupQueue);
 *
 * // Always call this at the end of pipeline execution
 * await filter.cleanup({
 *   keys: ['raw-invoice:abc', 'parsed:abc'],
 *   correlationId: ctx.correlationId,
 *   runId: ctx.runId,
 *   pipelineStatus: 'success',
 * });
 * ```
 */
export class SecureDeleteFilter {
  constructor(
    private readonly store: TempStore,
    private readonly cleanupQueue: CleanupQueue,
  ) {}

  /**
   * Clean up all temporary data associated with a pipeline run.
   *
   * This method:
   * 1. Attempts to securely delete all provided keys
   * 2. Queues any failed deletes for retry
   * 3. Returns a summary of the cleanup operation
   *
   * @param options - Cleanup options including keys to delete
   * @returns Summary of the cleanup operation
   */
  async cleanup(options: SecureCleanupOptions): Promise<SecureCleanupResult> {
    const startTime = Date.now();
    const result: SecureCleanupResult = {
      deleted: 0,
      queued: [],
      durationMs: 0,
    };

    // Delete all keys using allSettled - NEVER throws, processes ALL keys
    const deleteResults = await Promise.allSettled(
      options.keys.map(async (key) => {
        const deleted = await this.store.secureDelete(key);
        return { key, deleted };
      }),
    );

    // Process results - allSettled guarantees ALL keys are processed
    for (let i = 0; i < deleteResults.length; i++) {
      const settledResult = deleteResults[i];
      const key = options.keys[i];
      if (!settledResult || !key) continue;

      if (settledResult.status === 'fulfilled') {
        // Delete succeeded (or key was already gone)
        result.deleted++;
      } else {
        // Delete failed - queue for retry
        result.queued.push(key);
        const enqueueRecord: Omit<FailedDeleteRecord, 'failedAt' | 'retryCount'> = {
          key,
          maxRetries: 3,
          lastError: settledResult.reason instanceof Error
            ? settledResult.reason.message
            : String(settledResult.reason),
        };
        if (options.correlationId !== undefined) {
          enqueueRecord.correlationId = options.correlationId;
        }
        const category = this.getCategoryFromKey(key);
        if (category !== undefined) {
          enqueueRecord.category = category;
        }
        await this.cleanupQueue.enqueue(enqueueRecord);
      }
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  /**
   * Extract category from key naming convention.
   * Keys are expected to follow: "category:id" format.
   */
  private getCategoryFromKey(key: string): string | undefined {
    const colonIndex = key.indexOf(':');
    if (colonIndex > 0) {
      return key.slice(0, colonIndex);
    }
    return undefined;
  }

  /**
   * Process the cleanup queue (call periodically or after pipeline batches).
   */
  async processQueue(): Promise<void> {
    const result = await this.cleanupQueue.process(this.store);

    // Log abandoned keys for alerting
    if (result.abandonedKeys.length > 0) {
      // In production, this should trigger an alert
      console.error(
        `[ALERT] Cleanup queue: ${String(result.abandonedKeys.length)} keys abandoned after max retries:`,
        result.abandonedKeys,
      );
    }
  }
}

/**
 * Metadata for tracked temp keys (for debugging/auditing).
 * These are internal details - NEVER log the actual key values.
 */
interface TempKeyMetadata {
  /** Why this key was created */
  purpose: string;
  /** Which component created it */
  createdBy: string;
  /** When it was tracked */
  trackedAt: string;
}

/**
 * Context keys that should be cleaned up for a validation run.
 *
 * Use this helper to ensure all temporary keys are tracked for cleanup.
 * Stores purpose/createdBy metadata for debugging (but NOT logged to avoid PII).
 */
export class TempKeyTracker {
  private readonly keys = new Map<string, TempKeyMetadata>();

  /**
   * Track a key for cleanup with metadata
   */
  track(key: string, purpose: string, createdBy: string): void {
    this.keys.set(key, {
      purpose,
      createdBy,
      trackedAt: new Date().toISOString(),
    });
  }

  /**
   * Get all tracked keys (internal only - don't log these)
   */
  getKeys(): string[] {
    return Array.from(this.keys.keys());
  }

  /**
   * Get count without exposing keys (safe for logging)
   */
  getCount(): number {
    return this.keys.size;
  }

  /**
   * Get categories (safe for logging - no full keys)
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const key of this.keys.keys()) {
      const colonIndex = key.indexOf(':');
      if (colonIndex > 0) {
        categories.add(key.slice(0, colonIndex));
      }
    }
    return Array.from(categories);
  }

  /**
   * Clear all tracked keys
   */
  clear(): void {
    this.keys.clear();
  }

  /**
   * Check if a key is tracked
   */
  has(key: string): boolean {
    return this.keys.has(key);
  }

  /**
   * Remove a specific key from tracking
   */
  untrack(key: string): void {
    this.keys.delete(key);
  }
}

/**
 * Generate standard temp key for a validation run.
 */
export function generateTempKey(category: string, runId: string): string {
  return `${category}:${runId}`;
}

/**
 * Standard temp key categories
 */
export const TEMP_KEY_CATEGORIES = {
  RAW_INVOICE: 'raw-invoice',
  PARSED_INVOICE: 'parsed-invoice',
  CANONICAL_INVOICE: 'canonical-invoice',
  INTERMEDIATE_RESULT: 'intermediate',
  EXTERNAL_RESPONSE: 'external-response',
} as const;
