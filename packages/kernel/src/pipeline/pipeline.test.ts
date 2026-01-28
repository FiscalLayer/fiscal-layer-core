import { describe, it, expect, beforeEach } from 'vitest';
import { Pipeline } from './pipeline.js';
import { PluginRegistryImpl } from '../registry/registry.js';
import type { Filter, StepStatus, ExecutionStatus, ExecutionPlan } from '@fiscal-layer/contracts';

/**
 * Create a test plan that matches the mock filters registered in tests.
 * This avoids "filter not found" errors that occur with createDefaultPlan().
 */
function createTestPlan(): ExecutionPlan {
  return {
    id: 'test-plan',
    version: '1.0.0',
    steps: [
      { filterId: 'parser', enabled: true, order: 10 },
      { filterId: 'kosit', enabled: true, order: 20, continueOnFailure: false },
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
      { filterId: 'steps-policy-gate', enabled: true, order: 60, failurePolicy: 'always_run' },
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
const createMockFilter = (id: string, status: StepStatus = 'passed'): Filter => ({
  id,
  name: `Mock Filter ${id}`,
  version: '1.0.0',
  execute() {
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

describe('Pipeline', () => {
  let registry: PluginRegistryImpl;
  let pipeline: Pipeline;

  beforeEach(() => {
    registry = new PluginRegistryImpl();
    registry.register(createMockFilter('parser'));
    registry.register(createMockFilter('kosit'));
    registry.register(createMockFilter('vies'));
    registry.register(createMockFilter('ecb-rates'));
    registry.register(createMockFilter('peppol'));
    registry.register(createMockFilter('semantic-risk'));
    registry.register(createMockFilter('fingerprint'));
    registry.register(createMockFilter('steps-policy-gate'));

    pipeline = new Pipeline({
      registry,
      defaultPlan: createTestPlan(),
    });
  });

  it('should execute pipeline and return report', async () => {
    const report = await pipeline.execute({
      invoice: {
        content: '<Invoice>Test</Invoice>',
      },
    });

    expect(report).toBeDefined();
    expect(report.runId).toBeDefined();
    expect(report.status).toBe('APPROVED');
    expect(report.score).toBe(100);
    expect(report.fingerprint).toBeDefined();
    expect(report.fingerprint.id).toMatch(/^FL-/);
  });

  it('should mark as ERROR when filter fails with fail-fast (abort)', async () => {
    // Register a failing filter
    registry.unregister('kosit');
    registry.register(createMockFilter('kosit', 'failed'));

    const report = await pipeline.execute({
      invoice: {
        content: '<Invoice>Test</Invoice>',
      },
    });

    // With fail-fast, filter failure causes abort → ERROR status
    expect(report.status).toBe('ERROR');
    expect(report.score).toBeLessThan(100);
  });

  it('should include timing information', async () => {
    const report = await pipeline.execute({
      invoice: {
        content: '<Invoice>Test</Invoice>',
      },
    });

    expect(report.timing).toBeDefined();
    expect(report.timing.startedAt).toBeDefined();
    expect(report.timing.completedAt).toBeDefined();
    expect(report.timing.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should respect execution plan', async () => {
    const report = await pipeline.execute({
      invoice: {
        content: '<Invoice>Test</Invoice>',
      },
    });

    // Should have executed multiple steps
    expect(report.steps.length).toBeGreaterThan(0);
  });

  describe('Abort semantics', () => {
    it('should mark aborted steps as SKIPPED with reason', async () => {
      // Register a failing kosit filter to trigger abort
      registry.unregister('kosit');
      registry.register(createMockFilter('kosit', 'failed'));

      const report = await pipeline.execute({
        invoice: {
          content: '<Invoice>Test</Invoice>',
        },
      });

      // Steps after kosit should be marked as skipped
      const skippedSteps = report.steps.filter((s) => s.execution === 'skipped');
      expect(skippedSteps.length).toBeGreaterThan(0);

      // Each skipped step should have metadata explaining why
      for (const step of skippedSteps) {
        expect(step.metadata).toBeDefined();
        expect(step.metadata?.['skippedReason']).toBe('pipeline_aborted');
      }
    });

    it('should execute always_run steps even when aborted', async () => {
      // Register a failing kosit filter to trigger abort
      registry.unregister('kosit');
      registry.register(createMockFilter('kosit', 'failed'));

      const report = await pipeline.execute({
        invoice: {
          content: '<Invoice>Test</Invoice>',
        },
      });

      // policy-gate has always_run policy, should still execute
      const policyGateStep = report.steps.find((s) => s.filterId === 'steps-policy-gate');
      expect(policyGateStep).toBeDefined();
      expect(policyGateStep?.execution).not.toBe('skipped');
    });
  });
});
