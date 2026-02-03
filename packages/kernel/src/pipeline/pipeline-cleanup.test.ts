/* eslint-disable @typescript-eslint/no-deprecated -- Tests use deprecated StepStatus for backward compatibility */
/* eslint-disable @typescript-eslint/no-unused-vars -- Some imports used for type documentation */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Pipeline } from './pipeline.js';
import { PluginRegistryImpl } from '../registry/registry.js';
import type {
  Filter,
  StepResult,
  StepStatus,
  ExecutionStatus,
  ExecutionPlan,
  PipelineCleanupEnforcer,
  PipelineCleanupConfig,
  PipelineCleanupContext,
  PipelineCleanupResult,
  TempStore,
  CleanupQueue,
} from '@fiscal-layer/contracts';

/**
 * Create a test plan that matches the mock filters registered in tests.
 * This avoids "filter not found" errors that occur with createTestPlan().
 */
function createTestPlan(): ExecutionPlan {
  return {
    id: 'test-plan',
    version: '1.0.0',
    steps: [
      { filterId: 'parser', enabled: true, order: 10 },
      { filterId: 'kosit', enabled: true, order: 20 },
      {
        filterId: 'live-verifiers',
        enabled: true,
        order: 30,
        parallel: true,
        children: [
          { filterId: 'vies', enabled: true },
          { filterId: 'ecb-rates', enabled: true },
          { filterId: 'peppol', enabled: true },
        ],
      },
      { filterId: 'semantic-risk', enabled: true, order: 40 },
      { filterId: 'fingerprint', enabled: true, order: 50 },
    ],
    configHash: 'test-hash',
    createdAt: new Date().toISOString(),
  };
}

// Helper to map status to execution
function statusToExecution(status: StepStatus): ExecutionStatus {
  switch (status) {
    case 'passed':
    case 'failed':
    case 'warning':
      return 'ran';
    case 'skipped':
      return 'skipped';
    case 'timeout':
    case 'error':
      return 'errored';
  }
}

// Mock filter for testing
const createMockFilter = (
  id: string,
  status: StepStatus = 'passed',
  shouldThrow = false,
): Filter => ({
  id,
  name: `Mock Filter ${id}`,
  version: '1.0.0',
  execute() {
    if (shouldThrow) {
      return Promise.reject(new Error(`Filter ${id} intentionally failed`));
    }
    // In the new model, validation failures produce error diagnostics
    const diagnostics =
      status === 'failed'
        ? [{ code: `${id.toUpperCase()}-001`, severity: 'error' as const, message: 'Mock validation error', category: 'schema' as const, source: id }]
        : status === 'warning'
          ? [{ code: `${id.toUpperCase()}-002`, severity: 'warning' as const, message: 'Mock validation warning', category: 'business-rule' as const, source: id }]
          : [];

    return Promise.resolve({
      filterId: id,
      execution: statusToExecution(status),
      diagnostics,
      durationMs: 10,
    });
  },
});

// Mock TempStore for testing
const createMockTempStore = (): TempStore & { deletedKeys: string[] } => {
  const store = new Map<string, unknown>();
  const deletedKeys: string[] = [];

  return {
    deletedKeys,
    set<T>(key: string, data: T) {
      store.set(key, data);
      return Promise.resolve({
        key,
        data,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        ttlMs: 60000,
        encrypted: false,
        category: 'test',
      });
    },
    get<T>(key: string): Promise<T | undefined> {
      return Promise.resolve(store.get(key) as T | undefined);
    },
    getMetadata() {
      return Promise.resolve(undefined);
    },
    has(key: string) {
      return Promise.resolve(store.has(key));
    },
    delete(key: string) {
      deletedKeys.push(key);
      return Promise.resolve(store.delete(key));
    },
    secureDelete(key: string) {
      deletedKeys.push(key);
      return Promise.resolve(store.delete(key));
    },
    ttl() {
      return Promise.resolve(-1);
    },
    extendTtl() {
      return Promise.resolve(undefined);
    },
    cleanup() {
      return Promise.resolve(0);
    },
    stats() {
      return Promise.resolve({
        totalEntries: store.size,
        totalSizeBytes: 0,
        byCategory: {},
        expiredPending: 0,
        failedDeletesPending: 0,
      });
    },
    close() {
      store.clear();
      return Promise.resolve();
    },
  };
};

// Mock CleanupQueue for testing
const createMockCleanupQueue = (): CleanupQueue => ({
  enqueue() {
    return Promise.resolve();
  },
  pending() {
    return Promise.resolve([]);
  },
  markCompleted() {
    return Promise.resolve();
  },
  markFailed() {
    return Promise.resolve();
  },
  process() {
    return Promise.resolve({
      processed: 0,
      succeeded: 0,
      failed: 0,
      abandoned: 0,
      abandonedKeys: [],
    });
  },
});

// Mock PipelineCleanupEnforcer for testing
const createMockCleanupEnforcer = (
  tempStore: TempStore,
): PipelineCleanupEnforcer & { cleanupCalls: PipelineCleanupContext[] } => {
  const cleanupCalls: PipelineCleanupContext[] = [];

  return {
    cleanupCalls,
    async cleanup(context: PipelineCleanupContext): Promise<PipelineCleanupResult> {
      cleanupCalls.push(context);

      // Actually delete from temp store
      let deleted = 0;
      for (const key of context.tempKeys) {
        const result = await tempStore.secureDelete(key);
        if (result) deleted++;
      }

      return {
        completed: true,
        deleted,
        queued: [],
        durationMs: 1,
        warnings: [],
      };
    },
    getConfig(): PipelineCleanupConfig {
      return {
        store: tempStore,
        cleanupQueue: createMockCleanupQueue(),
      };
    },
    getPolicyType() {
      return 'zero-retention' as const;
    },
  };
};

describe('Pipeline Finally Cleanup (Redline Tests)', () => {
  let registry: PluginRegistryImpl;
  let tempStore: TempStore & { deletedKeys: string[] };
  let cleanupEnforcer: PipelineCleanupEnforcer & { cleanupCalls: PipelineCleanupContext[] };

  beforeEach(() => {
    registry = new PluginRegistryImpl();
    registry.register(createMockFilter('parser'));
    registry.register(createMockFilter('kosit'));
    registry.register(createMockFilter('vies'));
    registry.register(createMockFilter('ecb-rates'));
    registry.register(createMockFilter('peppol'));
    registry.register(createMockFilter('semantic-risk'));
    registry.register(createMockFilter('fingerprint'));

    tempStore = createMockTempStore();
    cleanupEnforcer = createMockCleanupEnforcer(tempStore);
  });

  describe('Guaranteed Cleanup Execution', () => {
    it('should call cleanup enforcer on successful pipeline execution', async () => {
      const pipeline = new Pipeline({
        registry,
        defaultPlan: createTestPlan(),
        cleanupEnforcer,
      });

      const report = await pipeline.execute({
        invoice: { content: '<Invoice>Test</Invoice>' },
      });

      expect(report.status).toBe('APPROVED');
      expect(report.appliedRetentionPolicy).toBe('zero-retention');
      expect(cleanupEnforcer.cleanupCalls).toHaveLength(1);
      const call = cleanupEnforcer.cleanupCalls[0];
      if (!call) throw new Error('Expected cleanup call');
      expect(call.pipelineStatus).toBe('success');
      expect(call.tempKeys).toContain(`raw-invoice:${report.runId}`);
    });

    it('should call cleanup enforcer when filter fails (fail-fast)', async () => {
      // Register a failing filter
      registry.unregister('kosit');
      registry.register(createMockFilter('kosit', 'failed'));

      const pipeline = new Pipeline({
        registry,
        defaultPlan: createTestPlan(),
        cleanupEnforcer,
      });

      const report = await pipeline.execute({
        invoice: { content: '<Invoice>Test</Invoice>' },
      });

      // Filter failure with fail-fast causes abort → ERROR status
      expect(report.status).toBe('ERROR');
      expect(cleanupEnforcer.cleanupCalls).toHaveLength(1);
      const call = cleanupEnforcer.cleanupCalls[0];
      if (!call) throw new Error('Expected cleanup call');
      expect(call.pipelineStatus).toBe('failure');
    });

    it('should call cleanup enforcer when filter throws error', async () => {
      // Register a throwing filter
      registry.unregister('parser');
      registry.register(createMockFilter('parser', 'passed', true));

      const pipeline = new Pipeline({
        registry,
        defaultPlan: createTestPlan(),
        cleanupEnforcer,
      });

      // Pipeline should still complete (error is caught)
      await pipeline.execute({
        invoice: { content: '<Invoice>Test</Invoice>' },
      });

      // Cleanup should still have been called
      expect(cleanupEnforcer.cleanupCalls).toHaveLength(1);
    });
  });

  describe('TempStore Cleanup Verification', () => {
    it('should attempt to delete raw-invoice key after pipeline execution', async () => {
      const pipeline = new Pipeline({
        registry,
        defaultPlan: createTestPlan(),
        cleanupEnforcer,
      });

      const report = await pipeline.execute({
        invoice: { content: '<Invoice>Test</Invoice>' },
      });

      // Verify secureDelete was called with the correct key
      expect(tempStore.deletedKeys).toContain(`raw-invoice:${report.runId}`);
    });

    it('should delete temp key even when pipeline fails', async () => {
      registry.unregister('kosit');
      registry.register(createMockFilter('kosit', 'failed'));

      const pipeline = new Pipeline({
        registry,
        defaultPlan: createTestPlan(),
        cleanupEnforcer,
      });

      const report = await pipeline.execute({
        invoice: { content: '<Invoice>Test</Invoice>' },
      });

      // Even on failure, cleanup should run
      expect(tempStore.deletedKeys).toContain(`raw-invoice:${report.runId}`);
    });

    it('should return undefined after secureDelete for temp key', async () => {
      // Pre-populate the store with a test key
      const testKey = 'raw-invoice:test-run-123';
      await tempStore.set(testKey, '<Invoice>Sensitive Data</Invoice>');

      // Verify it exists
      expect(await tempStore.get(testKey)).toBe('<Invoice>Sensitive Data</Invoice>');

      // Secure delete it
      await tempStore.secureDelete(testKey);

      // Verify it's gone
      expect(await tempStore.get(testKey)).toBeUndefined();
    });
  });

  describe('Cleanup Error Handling', () => {
    it('should not throw when cleanup enforcer fails', async () => {
      // Create a failing cleanup enforcer
      const failingEnforcer: PipelineCleanupEnforcer = {
        cleanup(): Promise<PipelineCleanupResult> {
          return Promise.reject(new Error('Cleanup failed intentionally'));
        },
        getConfig() {
          return {
            store: tempStore,
            cleanupQueue: createMockCleanupQueue(),
          };
        },
        getPolicyType() {
          return 'zero-retention' as const;
        },
      };

      const pipeline = new Pipeline({
        registry,
        defaultPlan: createTestPlan(),
        cleanupEnforcer: failingEnforcer,
      });

      // Should not throw
      const report = await pipeline.execute({
        invoice: { content: '<Invoice>Test</Invoice>' },
      });

      expect(report.status).toBe('APPROVED');
      // Should have emergency warning
      expect(report.retentionWarnings).toBeDefined();
      expect(report.retentionWarnings).toHaveLength(1);
      const warning = report.retentionWarnings?.[0];
      if (!warning) throw new Error('Expected warning');
      expect(warning.code).toBe('CLEANUP_ERROR');
    });

    it('should add retention warnings to report when cleanup has issues', async () => {
      // Create an enforcer that returns warnings
      const warningEnforcer: PipelineCleanupEnforcer = {
        cleanup(_context: PipelineCleanupContext): Promise<PipelineCleanupResult> {
          return Promise.resolve({
            completed: true,
            deleted: 1,
            queued: ['some-failed-key'],
            durationMs: 5,
            warnings: [
              {
                code: 'CLEANUP_QUEUED',
                message: '1 key queued for retry',
                timestamp: new Date().toISOString(),
                affectedCount: 1,
              },
            ],
          });
        },
        getConfig() {
          return {
            store: tempStore,
            cleanupQueue: createMockCleanupQueue(),
          };
        },
        getPolicyType() {
          return 'zero-retention' as const;
        },
      };

      const pipeline = new Pipeline({
        registry,
        defaultPlan: createTestPlan(),
        cleanupEnforcer: warningEnforcer,
      });

      const report = await pipeline.execute({
        invoice: { content: '<Invoice>Test</Invoice>' },
      });

      expect(report.retentionWarnings).toBeDefined();
      expect(report.retentionWarnings).toHaveLength(1);
      const warning = report.retentionWarnings?.[0];
      if (!warning) throw new Error('Expected warning');
      expect(warning.code).toBe('CLEANUP_QUEUED');
    });
  });

  describe('Cleanup Event Emission', () => {
    it('should emit onCleanup event after cleanup completes', async () => {
      const onCleanup = vi.fn<(result: PipelineCleanupResult) => void>();

      const pipeline = new Pipeline({
        registry,
        defaultPlan: createTestPlan(),
        cleanupEnforcer,
        events: {
          onCleanup,
        },
      });

      await pipeline.execute({
        invoice: { content: '<Invoice>Test</Invoice>' },
      });

      expect(onCleanup).toHaveBeenCalledTimes(1);
      expect(onCleanup).toHaveBeenCalledWith(
        expect.objectContaining({
          completed: true,
          deleted: expect.any(Number) as number,
        }),
      );
    });
  });

  describe('No Enforcer Configured', () => {
    it('should work without cleanup enforcer (for backwards compatibility)', async () => {
      const pipeline = new Pipeline({
        registry,
        defaultPlan: createTestPlan(),
        // No cleanupEnforcer
      });

      const report = await pipeline.execute({
        invoice: { content: '<Invoice>Test</Invoice>' },
      });

      expect(report.status).toBe('APPROVED');
      expect(report.retentionWarnings).toBeUndefined();
      expect(report.appliedRetentionPolicy).toBeUndefined();
    });
  });

  describe('PII Safety in Warnings', () => {
    it('retentionWarnings should NOT contain temp keys or PII', async () => {
      // Create an enforcer that returns warnings
      const warningEnforcer: PipelineCleanupEnforcer = {
        cleanup(_context: PipelineCleanupContext): Promise<PipelineCleanupResult> {
          return Promise.resolve({
            completed: true,
            deleted: 1,
            queued: ['raw-invoice:sensitive-run-id-12345'], // This should NOT appear in warnings
            durationMs: 5,
            warnings: [
              {
                code: 'CLEANUP_QUEUED',
                message: '1 temp key(s) queued for retry cleanup', // Generic, no keys
                timestamp: new Date().toISOString(),
                affectedCount: 1, // Count only, no keys
              },
            ],
          });
        },
        getConfig() {
          return {
            store: tempStore,
            cleanupQueue: createMockCleanupQueue(),
          };
        },
        getPolicyType() {
          return 'zero-retention' as const;
        },
      };

      const pipeline = new Pipeline({
        registry,
        defaultPlan: createTestPlan(),
        cleanupEnforcer: warningEnforcer,
      });

      const report = await pipeline.execute({
        invoice: { content: '<Invoice>Test</Invoice>' },
      });

      // Verify warnings exist but don't contain sensitive data
      expect(report.retentionWarnings).toBeDefined();
      expect(report.retentionWarnings).toHaveLength(1);

      const warning = report.retentionWarnings?.[0];
      if (!warning) throw new Error('Expected warning');

      // Verify no temp keys or PII in warning message
      expect(warning.message).not.toContain('raw-invoice:');
      expect(warning.message).not.toContain('sensitive-run-id');
      expect(warning.code).toBe('CLEANUP_QUEUED');
      expect(warning.affectedCount).toBe(1);

      // Verify appliedRetentionPolicy is set
      expect(report.appliedRetentionPolicy).toBe('zero-retention');
    });
  });
});
