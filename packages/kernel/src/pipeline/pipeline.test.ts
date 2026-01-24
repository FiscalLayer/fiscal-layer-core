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
    registry.register(createMockFilter('semantic-risk'));
    registry.register(createMockFilter('fingerprint'));

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
});
