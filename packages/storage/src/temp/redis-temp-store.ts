import type { TempStore, TempStoreEntry, TempStoreOptions, TempStoreStats } from '@fiscal-layer/contracts';

/**
 * Redis-based TempStore configuration
 */
export interface RedisTempStoreConfig {
  /**
   * Redis connection URL
   * @example "redis://localhost:6379"
   */
  url?: string;

  /**
   * Redis host
   * @default "localhost"
   */
  host?: string;

  /**
   * Redis port
   * @default 6379
   */
  port?: number;

  /**
   * Redis password
   */
  password?: string;

  /**
   * Redis database number
   * @default 0
   */
  db?: number;

  /**
   * Key prefix for all entries
   * @default "fl:temp:"
   */
  keyPrefix?: string;

  /**
   * Enable TLS
   * @default false
   */
  tls?: boolean;
}

/**
 * Internal structure for stored entries
 */
interface StoredEntry<T = unknown> {
  data: T;
  meta: {
    createdAt: string;
    expiresAt: string;
    ttlMs: number;
    encrypted: boolean;
    category: string;
    correlationId?: string;
  };
}

/**
 * RedisTempStore provides distributed temporary storage with TTL.
 *
 * Features:
 * - Redis-backed for distributed deployments
 * - Native TTL support via Redis PEXPIRE
 * - Cluster-safe with key prefix isolation
 * - JSON serialization for complex data types
 *
 * Requirements:
 * - ioredis peer dependency must be installed
 *
 * @example
 * ```typescript
 * import { RedisTempStore } from '@fiscal-layer/storage';
 *
 * const store = new RedisTempStore({
 *   url: process.env.REDIS_URL,
 * });
 * await store.initialize();
 *
 * // Store invoice content with 60s TTL
 * await store.set('invoice:123', invoiceContent, {
 *   ttlMs: 60_000,
 *   category: 'raw-invoice',
 *   correlationId: 'job-123',
 * });
 *
 * // Retrieve content
 * const content = await store.get<string>('invoice:123');
 * ```
 */
export class RedisTempStore implements TempStore {
  private readonly config: Required<Pick<RedisTempStoreConfig, 'keyPrefix'>> & RedisTempStoreConfig;
  private client: import('ioredis').Redis | null = null;
  private closed = false;
  private initialized = false;

  constructor(config: RedisTempStoreConfig = {}) {
    this.config = {
      host: 'localhost',
      port: 6379,
      db: 0,
      keyPrefix: 'fl:temp:',
      tls: false,
      ...config,
    };
  }

  /**
   * Initialize Redis connection.
   * Must be called before using the store.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Dynamic import to avoid loading ioredis when not needed
    const ioredis = await import('ioredis');
    // ioredis exports Redis as both default and named export
    const RedisConstructor = ioredis.Redis ?? ioredis.default;

    if (this.config.url) {
      this.client = new RedisConstructor(this.config.url, {
        maxRetriesPerRequest: null, // Required for BullMQ compatibility
        enableReadyCheck: true,
        lazyConnect: false,
      });
    } else {
      // Build options object conditionally to satisfy exactOptionalPropertyTypes
      const redisOptions: import('ioredis').RedisOptions = {
        host: this.config.host ?? 'localhost',
        port: this.config.port ?? 6379,
        db: this.config.db ?? 0,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: false,
      };
      if (this.config.password !== undefined) {
        redisOptions.password = this.config.password;
      }
      if (this.config.tls) {
        redisOptions.tls = {};
      }
      this.client = new RedisConstructor(redisOptions);
    }

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 10000);

      this.client!.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.client!.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    this.initialized = true;
  }

  private getFullKey(key: string): string {
    return this.config.keyPrefix + key;
  }

  async set<T>(key: string, data: T, options?: TempStoreOptions): Promise<TempStoreEntry<T>> {
    this.checkClosed();
    await this.ensureInitialized();

    const fullKey = this.getFullKey(key);
    const ttlMs = options?.ttlMs ?? 60_000;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const meta: StoredEntry<T>['meta'] = {
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ttlMs,
      encrypted: options?.encrypt ?? false,
      category: options?.category ?? 'default',
    };
    if (options?.correlationId !== undefined) {
      meta.correlationId = options.correlationId;
    }

    const entry: StoredEntry<T> = { data, meta };

    const serialized = JSON.stringify(entry);
    await this.client!.set(fullKey, serialized, 'PX', ttlMs);

    const result: TempStoreEntry<T> = {
      key,
      data,
      createdAt: entry.meta.createdAt,
      expiresAt: entry.meta.expiresAt,
      ttlMs,
      encrypted: entry.meta.encrypted,
      category: entry.meta.category,
    };
    if (entry.meta.correlationId !== undefined) {
      result.correlationId = entry.meta.correlationId;
    }

    return result;
  }

  async get<T>(key: string): Promise<T | undefined> {
    this.checkClosed();
    await this.ensureInitialized();

    const fullKey = this.getFullKey(key);
    const value = await this.client!.get(fullKey);

    if (!value) return undefined;

    try {
      const entry = JSON.parse(value) as StoredEntry<T>;
      return entry.data;
    } catch {
      // Invalid JSON, treat as not found
      return undefined;
    }
  }

  async getMetadata(key: string): Promise<Omit<TempStoreEntry, 'data'> | undefined> {
    this.checkClosed();
    await this.ensureInitialized();

    const fullKey = this.getFullKey(key);
    const value = await this.client!.get(fullKey);

    if (!value) return undefined;

    try {
      const entry = JSON.parse(value) as StoredEntry;
      const result: Omit<TempStoreEntry, 'data'> = {
        key,
        createdAt: entry.meta.createdAt,
        expiresAt: entry.meta.expiresAt,
        ttlMs: entry.meta.ttlMs,
        encrypted: entry.meta.encrypted,
        category: entry.meta.category,
      };
      if (entry.meta.correlationId !== undefined) {
        result.correlationId = entry.meta.correlationId;
      }
      return result;
    } catch {
      return undefined;
    }
  }

  async has(key: string): Promise<boolean> {
    this.checkClosed();
    await this.ensureInitialized();

    const fullKey = this.getFullKey(key);
    const exists = await this.client!.exists(fullKey);
    return exists === 1;
  }

  async delete(key: string): Promise<boolean> {
    this.checkClosed();
    await this.ensureInitialized();

    const fullKey = this.getFullKey(key);
    const deleted = await this.client!.del(fullKey);
    return deleted === 1;
  }

  async secureDelete(key: string): Promise<boolean> {
    this.checkClosed();
    await this.ensureInitialized();

    const fullKey = this.getFullKey(key);

    // Check if key exists first
    const exists = await this.client!.exists(fullKey);
    if (exists !== 1) return false;

    // Overwrite with zeros before deletion
    // Note: Redis doesn't guarantee secure deletion from memory/disk,
    // but this provides defense-in-depth
    const zeroData = JSON.stringify({ data: null, meta: { overwritten: true } });
    await this.client!.set(fullKey, zeroData);

    // Delete the key
    const deleted = await this.client!.del(fullKey);
    return deleted === 1;
  }

  async ttl(key: string): Promise<number> {
    this.checkClosed();
    await this.ensureInitialized();

    const fullKey = this.getFullKey(key);
    const ttl = await this.client!.pttl(fullKey);

    // PTTL returns:
    // -2 if key doesn't exist
    // -1 if key exists but has no TTL
    // positive number: TTL in milliseconds
    return ttl < 0 ? -1 : ttl;
  }

  async extendTtl(key: string, additionalMs: number): Promise<string | undefined> {
    this.checkClosed();
    await this.ensureInitialized();

    const fullKey = this.getFullKey(key);

    // Get current TTL
    const currentTtl = await this.client!.pttl(fullKey);
    if (currentTtl < 0) return undefined;

    // Calculate new TTL
    const newTtl = currentTtl + additionalMs;
    await this.client!.pexpire(fullKey, newTtl);

    // Return new expiration time
    const newExpiresAt = new Date(Date.now() + newTtl);
    return newExpiresAt.toISOString();
  }

  async cleanup(): Promise<number> {
    // Redis handles TTL automatically via PEXPIRE
    // No manual cleanup needed
    return 0;
  }

  async stats(): Promise<TempStoreStats> {
    this.checkClosed();
    await this.ensureInitialized();

    // Use SCAN to count entries with our prefix
    // This is expensive but necessary for stats
    let totalEntries = 0;
    let totalSizeBytes = 0;
    const byCategory: Record<string, number> = {};
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.client!.scan(
        cursor,
        'MATCH',
        this.config.keyPrefix + '*',
        'COUNT',
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        totalEntries++;

        // Get value to check category and size
        const value = await this.client!.get(key);
        if (value) {
          totalSizeBytes += value.length;

          try {
            const entry = JSON.parse(value) as StoredEntry;
            const category = entry.meta.category;
            byCategory[category] = (byCategory[category] ?? 0) + 1;
          } catch {
            // Invalid JSON, count as 'unknown'
            byCategory['unknown'] = (byCategory['unknown'] ?? 0) + 1;
          }
        }
      }
    } while (cursor !== '0');

    const result: TempStoreStats = {
      totalEntries,
      totalSizeBytes,
      byCategory,
      expiredPending: 0, // Redis handles expiration automatically
      failedDeletesPending: 0,
    };
    // lastCleanupAt is optional - Redis handles expiration automatically
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  /**
   * Check if the store is connected to Redis.
   */
  isConnected(): boolean {
    return this.initialized && !this.closed && this.client?.status === 'ready';
  }

  private checkClosed(): void {
    if (this.closed) {
      throw new Error('TempStore is closed');
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// NOTE: createRedisTempStoreFromEnv() was removed in PR#2.5 (OSS boundary).
// Apps should create RedisTempStore directly with their own env config:
//
//   const store = new RedisTempStore({
//     url: process.env['REDIS_URL'],
//     host: process.env['REDIS_HOST'],
//     port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
//     password: process.env['REDIS_PASSWORD'],
//   });
//   await store.initialize();
