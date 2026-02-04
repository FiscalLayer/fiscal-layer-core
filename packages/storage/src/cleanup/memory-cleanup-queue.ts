/* eslint-disable @typescript-eslint/require-await -- CleanupQueue interface requires async methods, but memory implementation is synchronous */
import type {
  CleanupQueue,
  CleanupQueueResult,
  FailedDeleteRecord,
  TempStore,
} from '@fiscal-layer/contracts';

/**
 * In-memory cleanup queue for failed delete operations.
 *
 * In production, use a Redis-backed queue for durability.
 */
export class MemoryCleanupQueue implements CleanupQueue {
  private readonly queue = new Map<string, FailedDeleteRecord>();
  private readonly completedKeys = new Set<string>();
  private readonly failedKeys = new Map<string, string>(); // key -> error

  async enqueue(record: Omit<FailedDeleteRecord, 'failedAt' | 'retryCount'>): Promise<void> {
    const existing = this.queue.get(record.key);

    this.queue.set(record.key, {
      ...record,
      failedAt: new Date().toISOString(),
      retryCount: existing ? existing.retryCount + 1 : 0,
    });
  }

  async pending(): Promise<FailedDeleteRecord[]> {
    return Array.from(this.queue.values());
  }

  async markCompleted(key: string): Promise<void> {
    this.queue.delete(key);
    this.completedKeys.add(key);
  }

  async markFailed(key: string, error: string): Promise<void> {
    this.queue.delete(key);
    this.failedKeys.set(key, error);
  }

  async process(store: TempStore): Promise<CleanupQueueResult> {
    const result: CleanupQueueResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      abandoned: 0,
      abandonedKeys: [],
    };

    const records = await this.pending();

    for (const record of records) {
      result.processed++;

      // Check if max retries exceeded
      if (record.retryCount >= record.maxRetries) {
        result.abandoned++;
        result.abandonedKeys.push(record.key);
        await this.markFailed(record.key, 'Max retries exceeded');
        continue;
      }

      try {
        // Attempt secure delete
        const deleted = await store.secureDelete(record.key);
        if (deleted) {
          result.succeeded++;
          await this.markCompleted(record.key);
        } else {
          // Key might already be gone - mark as completed
          result.succeeded++;
          await this.markCompleted(record.key);
        }
      } catch (error) {
        result.failed++;

        // Re-enqueue with incremented retry count
        await this.enqueue({
          ...record,
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  /**
   * Get keys that were abandoned (for alerting/audit)
   */
  getAbandonedKeys(): Map<string, string> {
    return new Map(this.failedKeys);
  }

  /**
   * Clear all state (for testing)
   */
  clear(): void {
    this.queue.clear();
    this.completedKeys.clear();
    this.failedKeys.clear();
  }
}
