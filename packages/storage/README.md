# @fiscal-layer/storage

> Storage implementations for FiscalLayer - TempStore, CleanupQueue, SecureDelete

This package provides storage implementations for temporary invoice data with TTL, secure deletion, and cleanup queue for failed deletes.

## Installation

```bash
pnpm add @fiscal-layer/storage
```

## Key Features

- **TempStore**: Temporary storage with TTL (memory or Redis)
- **SecureDelete**: Overwrite-before-delete for sensitive data
- **CleanupQueue**: Retry queue for failed deletes
- **SecureDeleteFilter**: Pipeline "finally" block for guaranteed cleanup

## TempStore

Temporary storage for invoice data with automatic TTL expiration:

```typescript
import { MemoryTempStore } from '@fiscal-layer/storage';

const store = new MemoryTempStore();

// Store invoice with 60s TTL
const entry = await store.set('invoice-123', invoiceData, {
  ttlMs: 60000,
  category: 'raw-invoice',
});

// Retrieve
const data = await store.get<InvoiceData>('invoice-123');

// Check TTL
const remaining = await store.ttl('invoice-123'); // milliseconds

// Secure delete (overwrites before delete)
await store.secureDelete('invoice-123');

// Close and cleanup
await store.close();
```

### Implementations

| Implementation    | Use Case             | Backend       |
| ----------------- | -------------------- | ------------- |
| `MemoryTempStore` | Development, testing | In-memory Map |
| `RedisTempStore`  | Production           | Redis         |

### Redis TempStore

```typescript
import { RedisTempStore } from '@fiscal-layer/storage';

const store = new RedisTempStore({
  host: 'localhost',
  port: 6379,
  password: 'secret',
  db: 0,
  keyPrefix: 'fl:temp:',
});
```

## CleanupQueue

Retry queue for failed secure deletes:

```typescript
import { MemoryCleanupQueue } from '@fiscal-layer/storage';

const queue = new MemoryCleanupQueue();

// Enqueue failed delete
await queue.enqueue({
  key: 'invoice-123',
  maxRetries: 3,
  category: 'raw-invoice',
  correlationId: 'req-456',
});

// Check pending items
const pending = await queue.pending();
console.log(pending.length); // 1

// Process queue (retry deletes)
const result = await queue.process(tempStore);
console.log(result.succeeded); // ['invoice-123']
console.log(result.failed); // []
```

## SecureDeleteFilter

Pipeline "finally" block that guarantees cleanup after validation:

```typescript
import { SecureDeleteFilter, MemoryCleanupQueue, TEMP_KEY_CATEGORIES } from '@fiscal-layer/storage';

const cleanupQueue = new MemoryCleanupQueue();
const secureDelete = new SecureDeleteFilter(tempStore, cleanupQueue);

// Cleanup by correlation ID
const result = await secureDelete.cleanup({
  correlationId: 'req-123',
});

// Cleanup by category
await secureDelete.cleanup({
  category: TEMP_KEY_CATEGORIES.RAW_INVOICE,
});

// Cleanup specific keys
await secureDelete.cleanup({
  keys: ['invoice-123', 'parsed-123'],
  maxRetries: 3, // Queue failures for retry
});

// Result
console.log(result.deletedKeys); // Successfully deleted
console.log(result.failedKeys); // Failed (queued for retry)
console.log(result.queuedForRetry); // Number queued
```

### Key Categories

```typescript
import { TEMP_KEY_CATEGORIES } from '@fiscal-layer/storage';

TEMP_KEY_CATEGORIES.RAW_INVOICE; // 'raw-invoice'
TEMP_KEY_CATEGORIES.PARSED_INVOICE; // 'parsed-invoice'
TEMP_KEY_CATEGORIES.VALIDATION_RESULT; // 'validation-result'
TEMP_KEY_CATEGORIES.FINGERPRINT; // 'fingerprint'
TEMP_KEY_CATEGORIES.TEMP_FILE; // 'temp-file'
```

## Guaranteed Cleanup Pattern

```typescript
import { MemoryTempStore, MemoryCleanupQueue, SecureDeleteFilter } from '@fiscal-layer/storage';

const tempStore = new MemoryTempStore();
const cleanupQueue = new MemoryCleanupQueue();
const secureDelete = new SecureDeleteFilter(tempStore, cleanupQueue);

async function validateInvoice(invoice: Invoice, correlationId: string) {
  // Store invoice
  await tempStore.set(`raw:${correlationId}`, invoice, {
    ttlMs: 60000,
    category: 'raw-invoice',
    correlationId,
  });

  try {
    // Run validation pipeline
    const result = await pipeline.execute({ invoice, correlationId });
    return result;
  } finally {
    // ALWAYS cleanup - like a finally block
    await secureDelete.cleanup({ correlationId });

    // Process any queued failed deletes
    await cleanupQueue.process(tempStore);
  }
}
```

## Exports

```typescript
// Temporary storage
export { MemoryTempStore } from './temp/memory-temp-store.js';
export { RedisTempStore } from './temp/redis-temp-store.js';

// Cleanup utilities
export { MemoryCleanupQueue } from './cleanup/memory-cleanup-queue.js';
export { SecureDeleteFilter, TEMP_KEY_CATEGORIES } from './cleanup/secure-delete-filter.js';

// Re-exported types from contracts
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
```

## Configuration

### Memory TempStore

```typescript
const store = new MemoryTempStore({
  defaultTtlMs: 60000, // Default TTL (60s)
  cleanupIntervalMs: 10000, // Cleanup expired entries every 10s
  maxEntries: 10000, // Max entries before eviction
});
```

### Redis TempStore

```typescript
const store = new RedisTempStore({
  host: 'localhost',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  keyPrefix: 'fl:temp:',
  defaultTtlMs: 60000,
  secureDeleteOverwriteBytes: 64, // Bytes to overwrite before delete
});
```
