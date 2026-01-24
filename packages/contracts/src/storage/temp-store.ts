/**
 * Temporary storage for short-lived data with TTL.
 *
 * TempStore provides the data boundary between Edge (API) and Engine layers.
 * - Edge layer writes raw invoice with short TTL
 * - Engine layer reads via temp_key only
 * - No direct access to persisted raw data
 */

/**
 * Entry metadata for temporary storage
 */
export interface TempStoreEntry<T = unknown> {
  /**
   * Unique key for this entry
   */
  key: string;

  /**
   * The stored data
   */
  data: T;

  /**
   * When the entry was created (ISO 8601)
   */
  createdAt: string;

  /**
   * When the entry expires (ISO 8601)
   */
  expiresAt: string;

  /**
   * TTL in milliseconds
   */
  ttlMs: number;

  /**
   * Whether the entry is encrypted at rest
   */
  encrypted: boolean;

  /**
   * Data category for retention policy
   */
  category: string;

  /**
   * Correlation ID for tracing
   */
  correlationId?: string;
}

/**
 * Options for storing temporary data
 */
export interface TempStoreOptions {
  /**
   * Time-to-live in milliseconds
   * @default 60000 (1 minute)
   */
  ttlMs?: number;

  /**
   * Data category for retention policy
   */
  category?: string;

  /**
   * Whether to encrypt at rest
   * @default true for raw-invoice category
   */
  encrypt?: boolean;

  /**
   * Correlation ID for tracing
   */
  correlationId?: string;
}

/**
 * Temporary storage interface.
 *
 * Implementations:
 * - MemoryTempStore: In-memory with automatic TTL cleanup
 * - RedisTempStore: Redis-backed for distributed deployments
 */
export interface TempStore {
  /**
   * Store data with automatic TTL expiration.
   *
   * @param key - Unique key for the entry
   * @param data - Data to store
   * @param options - Storage options
   * @returns The created entry metadata
   */
  set<T>(key: string, data: T, options?: TempStoreOptions): Promise<TempStoreEntry<T>>;

  /**
   * Retrieve data by key.
   *
   * @param key - The entry key
   * @returns The data if found and not expired, undefined otherwise
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Get entry metadata without data.
   *
   * @param key - The entry key
   * @returns Entry metadata if found
   */
  getMetadata(key: string): Promise<Omit<TempStoreEntry, 'data'> | undefined>;

  /**
   * Check if a key exists and is not expired.
   *
   * @param key - The entry key
   * @returns True if the key exists and is valid
   */
  has(key: string): Promise<boolean>;

  /**
   * Delete an entry immediately.
   * Used for secure deletion after processing.
   *
   * @param key - The entry key
   * @returns True if the entry was deleted
   */
  delete(key: string): Promise<boolean>;

  /**
   * Secure delete: overwrite with zeros before deletion.
   * Use for sensitive data like raw invoices.
   *
   * @param key - The entry key
   * @returns True if the entry was securely deleted
   */
  secureDelete(key: string): Promise<boolean>;

  /**
   * Get the remaining TTL for an entry.
   *
   * @param key - The entry key
   * @returns Remaining TTL in milliseconds, or -1 if expired/not found
   */
  ttl(key: string): Promise<number>;

  /**
   * Extend the TTL for an entry.
   *
   * @param key - The entry key
   * @param additionalMs - Additional milliseconds to add
   * @returns New expiration time, or undefined if not found
   */
  extendTtl(key: string, additionalMs: number): Promise<string | undefined>;

  /**
   * Clean up expired entries.
   * Called automatically by implementations, but can be triggered manually.
   */
  cleanup(): Promise<number>;

  /**
   * Get statistics about the store.
   */
  stats(): Promise<TempStoreStats>;

  /**
   * Close the store and release resources.
   */
  close(): Promise<void>;
}

/**
 * Statistics for temporary storage
 */
export interface TempStoreStats {
  /**
   * Total number of entries
   */
  totalEntries: number;

  /**
   * Total size in bytes (approximate)
   */
  totalSizeBytes: number;

  /**
   * Entries by category
   */
  byCategory: Record<string, number>;

  /**
   * Number of expired entries pending cleanup
   */
  expiredPending: number;

  /**
   * Number of failed deletes pending retry
   */
  failedDeletesPending: number;

  /**
   * Last cleanup timestamp
   */
  lastCleanupAt?: string;
}

/**
 * Record of a failed delete operation for retry queue
 */
export interface FailedDeleteRecord {
  /**
   * The key that failed to delete
   */
  key: string;

  /**
   * When the failure occurred
   */
  failedAt: string;

  /**
   * Number of retry attempts
   */
  retryCount: number;

  /**
   * Maximum retry attempts before giving up
   */
  maxRetries: number;

  /**
   * Error message from last attempt
   */
  lastError?: string;

  /**
   * Data category (for audit/compliance)
   */
  category?: string;

  /**
   * Correlation ID for tracing
   */
  correlationId?: string;
}

/**
 * Cleanup queue for failed delete operations.
 *
 * When a secure delete fails, the key is added to this queue for retry.
 * This ensures no sensitive data is accidentally retained.
 */
export interface CleanupQueue {
  /**
   * Add a key to the cleanup queue
   */
  enqueue(record: Omit<FailedDeleteRecord, 'failedAt' | 'retryCount'>): Promise<void>;

  /**
   * Get all pending cleanup records
   */
  pending(): Promise<FailedDeleteRecord[]>;

  /**
   * Mark a record as successfully cleaned
   */
  markCompleted(key: string): Promise<void>;

  /**
   * Mark a record as permanently failed (max retries exceeded)
   */
  markFailed(key: string, error: string): Promise<void>;

  /**
   * Process the queue (attempt to delete pending items)
   */
  process(store: TempStore): Promise<CleanupQueueResult>;
}

/**
 * Result of processing the cleanup queue
 */
export interface CleanupQueueResult {
  /**
   * Number of items processed
   */
  processed: number;

  /**
   * Number of items successfully cleaned
   */
  succeeded: number;

  /**
   * Number of items that failed again
   */
  failed: number;

  /**
   * Number of items that exceeded max retries
   */
  abandoned: number;

  /**
   * Keys that were abandoned (for alerting)
   */
  abandonedKeys: string[];
}

/**
 * Options for secure cleanup on pipeline completion
 */
export interface SecureCleanupOptions {
  /**
   * Keys to clean up
   */
  keys: string[];

  /**
   * Correlation ID for tracing
   */
  correlationId?: string;

  /**
   * Run ID for tracing
   */
  runId?: string;

  /**
   * Whether cleanup was triggered by success or failure
   */
  pipelineStatus: 'success' | 'failure' | 'timeout' | 'error';
}

/**
 * Result of secure cleanup operation
 */
export interface SecureCleanupResult {
  /**
   * Number of keys successfully deleted
   */
  deleted: number;

  /**
   * Keys that were queued for retry
   */
  queued: string[];

  /**
   * Total processing time in ms
   */
  durationMs: number;
}
