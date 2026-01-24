/**
 * @fiscal-layer/storage
 *
 * Storage implementations for FiscalLayer.
 *
 * @packageDocumentation
 */

// Temporary storage
export * from './temp/index.js';

// Cleanup utilities
export * from './cleanup/index.js';

// PostgreSQL storage (requires pg peer dependency)
export * from './postgres/index.js';

// Re-export types from contracts
export type {
  TempStore,
  TempStoreEntry,
  TempStoreOptions,
  TempStoreStats,
  CleanupQueue,
  CleanupQueueResult,
  FailedDeleteRecord,
  SecureCleanupOptions,
  SecureCleanupResult,
} from '@fiscal-layer/contracts';
