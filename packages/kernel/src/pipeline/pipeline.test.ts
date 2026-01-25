import { describe, it, expect, beforeEach } from 'vitest';
import { Pipeline } from './pipeline.js';
import { PluginRegistryImpl } from '../registry/registry.js';
import { createDefaultPlan } from '../plan/builder.js';
import type { Filter, StepResult } from '@fiscal-layer/contracts';

// Mock filter for testing
const createMockFilter = (id: string, status: StepResult['status'] = 'passed'): Filter => ({
  id,
  name: `Mock Filter ${id}`,
  version: '1.0.0',
  execute() {
    return Promise.resolve({
      filterId: id,
      status,
      diagnostics: [],
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
    registry.register(createMockFilter('steps-amount-validation'));
    registry.register(createMockFilter('semantic-risk'));
    registry.register(createMockFilter('fingerprint'));
    registry.register(createMockFilter('steps-policy-gate'));

    pipeline = new Pipeline({
      registry,
      defaultPlan: createDefaultPlan(),
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
      const skippedSteps = report.steps.filter((s) => s.status === 'skipped');
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
      expect(policyGateStep?.status).not.toBe('skipped');
    });
  });
});
