/* eslint-disable @typescript-eslint/require-await -- TempStore interface requires async methods, but memory implementation is synchronous */
import type {
  TempStore,
  TempStoreEntry,
  TempStoreOptions,
  TempStoreStats,
} from '@fiscal-layer/contracts';

/**
 * Default TTL: 60 seconds
 */
const DEFAULT_TTL_MS = 60_000;

/**
 * Cleanup interval: 10 seconds
 */
const CLEANUP_INTERVAL_MS = 10_000;

/**
 * Internal entry with data
 */
interface InternalEntry<T = unknown> extends TempStoreEntry<T> {
  /**
   * Size estimate in bytes
   */
  sizeBytes: number;
}

/**
 * MemoryTempStore provides in-memory temporary storage with TTL.
 *
 * Features:
 * - Automatic TTL-based expiration
 * - Periodic cleanup of expired entries
 * - Secure deletion (data overwrite)
 * - Category-based statistics
 *
 * Limitations:
 * - Not distributed (single instance only)
 * - Data lost on process restart
 * - Memory bound by process limits
 *
 * Use for:
 * - Development and testing
 * - Single-instance deployments
 * - Edge/serverless functions
 */
export class MemoryTempStore implements TempStore {
  private readonly entries = new Map<string, InternalEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private lastCleanupAt: string | undefined;
  private closed = false;

  constructor(options?: { cleanupIntervalMs?: number }) {
    const interval = options?.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS;
    this.startCleanupTimer(interval);
  }

  async set<T>(key: string, data: T, options?: TempStoreOptions): Promise<TempStoreEntry<T>> {
    this.checkClosed();

    const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const category = options?.category ?? 'unknown';

    // Estimate size (rough approximation)
    const sizeBytes = this.estimateSize(data);

    const entry: InternalEntry<T> = {
      key,
      data,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ttlMs,
      encrypted: options?.encrypt ?? category === 'raw-invoice',
      category,
      sizeBytes,
    };
    if (options?.correlationId !== undefined) {
      entry.correlationId = options.correlationId;
    }

    this.entries.set(key, entry as InternalEntry);

    const result: TempStoreEntry<T> = {
      key: entry.key,
      data: entry.data,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      ttlMs: entry.ttlMs,
      encrypted: entry.encrypted,
      category: entry.category,
    };
    if (entry.correlationId !== undefined) {
      result.correlationId = entry.correlationId;
    }
    return result;
  }

  async get<T>(key: string): Promise<T | undefined> {
    this.checkClosed();

    const entry = this.entries.get(key);
    if (!entry) return undefined;

    // Check expiration
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.data as T;
  }

  async getMetadata(key: string): Promise<Omit<TempStoreEntry, 'data'> | undefined> {
    this.checkClosed();

    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }

    const metadata: Omit<TempStoreEntry, 'data'> = {
      key: entry.key,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      ttlMs: entry.ttlMs,
      encrypted: entry.encrypted,
      category: entry.category,
    };
    if (entry.correlationId !== undefined) {
      metadata.correlationId = entry.correlationId;
    }
    return metadata;
  }

  async has(key: string): Promise<boolean> {
    this.checkClosed();

    const entry = this.entries.get(key);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return false;
    }

    return true;
  }

  async delete(key: string): Promise<boolean> {
    this.checkClosed();
    return this.entries.delete(key);
  }

  async secureDelete(key: string): Promise<boolean> {
    this.checkClosed();

    const entry = this.entries.get(key);
    if (!entry) return false;

    // Overwrite data with zeros (as much as possible in JS)
    if (typeof entry.data === 'string') {
      // Replace string content with zeros
      (entry as InternalEntry<string>).data = '\0'.repeat(entry.data.length);
    } else if (typeof entry.data === 'object' && entry.data !== null) {
      // Clear object properties
      this.secureWipeObject(entry.data as Record<string, unknown>);
    }

    // Delete the entry
    return this.entries.delete(key);
  }

  async ttl(key: string): Promise<number> {
    this.checkClosed();

    const entry = this.entries.get(key);
    if (!entry) return -1;

    const expiresAt = new Date(entry.expiresAt).getTime();
    const remaining = expiresAt - Date.now();

    if (remaining <= 0) {
      this.entries.delete(key);
      return -1;
    }

    return remaining;
  }

  async extendTtl(key: string, additionalMs: number): Promise<string | undefined> {
    this.checkClosed();

    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }

    const currentExpires = new Date(entry.expiresAt).getTime();
    const newExpires = new Date(currentExpires + additionalMs);
    entry.expiresAt = newExpires.toISOString();
    entry.ttlMs += additionalMs;

    return entry.expiresAt;
  }

  async cleanup(): Promise<number> {
    this.checkClosed();

    let cleaned = 0;
    const now = Date.now();

    for (const [key, entry] of this.entries) {
      if (new Date(entry.expiresAt).getTime() <= now) {
        // Secure delete for sensitive categories
        if (entry.category === 'raw-invoice' || entry.category === 'parsed-invoice') {
          await this.secureDelete(key);
        } else {
          this.entries.delete(key);
        }
        cleaned++;
      }
    }

    this.lastCleanupAt = new Date().toISOString();
    return cleaned;
  }

  async stats(): Promise<TempStoreStats> {
    this.checkClosed();

    const byCategory: Record<string, number> = {};
    let totalSizeBytes = 0;
    let expiredPending = 0;
    const now = Date.now();

    for (const entry of this.entries.values()) {
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
      totalSizeBytes += entry.sizeBytes;

      if (new Date(entry.expiresAt).getTime() <= now) {
        expiredPending++;
      }
    }

    const stats: TempStoreStats = {
      totalEntries: this.entries.size,
      totalSizeBytes,
      byCategory,
      expiredPending,
      failedDeletesPending: 0, // MemoryTempStore doesn't track failed deletes
    };
    if (this.lastCleanupAt !== undefined) {
      stats.lastCleanupAt = this.lastCleanupAt;
    }
    return stats;
  }

  async close(): Promise<void> {
    if (this.closed) return;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Secure delete all sensitive entries (before marking as closed)
    for (const [key, entry] of this.entries) {
      if (entry.category === 'raw-invoice' || entry.category === 'parsed-invoice') {
        await this.secureDelete(key);
      }
    }

    this.closed = true;
    this.entries.clear();
  }

  /**
   * Get the number of entries (for testing)
   */
  get size(): number {
    return this.entries.size;
  }

  private startCleanupTimer(intervalMs: number): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(() => {
        // Ignore cleanup errors
      });
    }, intervalMs);

    // Don't block process exit
    this.cleanupTimer.unref();
  }

  private isExpired(entry: InternalEntry): boolean {
    return new Date(entry.expiresAt).getTime() <= Date.now();
  }

  private estimateSize(data: unknown): number {
    if (typeof data === 'string') {
      return data.length * 2; // UTF-16
    }
    if (typeof data === 'number') {
      return 8;
    }
    if (typeof data === 'boolean') {
      return 4;
    }
    if (data === null || data === undefined) {
      return 0;
    }
    // Rough estimate for objects
    return JSON.stringify(data).length * 2;
  }

  private secureWipeObject(obj: Record<string, unknown>): void {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (typeof value === 'string') {
        obj[key] = '\0'.repeat(value.length);
      } else if (typeof value === 'object' && value !== null) {
        this.secureWipeObject(value as Record<string, unknown>);
      } else {
        obj[key] = null;
      }
    }
  }

  private checkClosed(): void {
    if (this.closed) {
      throw new Error('TempStore is closed');
    }
  }
}
