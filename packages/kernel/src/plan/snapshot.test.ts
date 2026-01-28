import { describe, it, expect, beforeEach } from 'vitest';
import { Pipeline } from '../pipeline/pipeline.js';
import { PluginRegistryImpl } from '../registry/registry.js';
import { createPlanBuilder } from './builder.js';
import {
  buildExecutionPlanSnapshot,
  calculatePlanHash,
  verifyPlanHash,
  calculateConfigHash,
} from './hash.js';
import {
  buildEffectiveConfig,
  getEngineVersions,
} from '../config/effective-config.js';
import type { Filter, StepStatus, ExecutionStatus, EngineVersions, ExecutionPlan } from '@fiscal-layer/contracts';

/**
 * Create a test plan that matches the mock filters registered in tests.
 */
function createTestPlan(): ExecutionPlan {
  const plan: ExecutionPlan = {
    id: 'default-v1',
    version: '1.0.0',
    name: 'Test Plan',
    description: 'Test validation pipeline',
    steps: [
      { filterId: 'parser', enabled: true, order: 10, failurePolicy: 'fail_fast' },
      { filterId: 'kosit', enabled: true, order: 20, failurePolicy: 'fail_fast' },
      {
        filterId: 'live-verifiers',
        enabled: true,
        order: 30,
        parallel: true,
        failurePolicy: 'soft_fail',
        children: [
          { filterId: 'vies', enabled: true },
          { filterId: 'ecb-rates', enabled: true },
          { filterId: 'peppol', enabled: true },
        ],
      },
      { filterId: 'semantic-risk', enabled: true, order: 40, config: { threshold: 50 } },
      { filterId: 'fingerprint', enabled: true, order: 50 },
    ],
    configHash: '', // Will be calculated
    createdAt: new Date().toISOString(),
    isDefault: true,
    globalConfig: {
      defaultTimeout: 10000,
      locale: 'en-US',
      maxParallelism: 5,
    },
  };
  plan.configHash = calculateConfigHash(plan);
  return plan;
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
  version: string,
  status: StepStatus = 'passed',
): Filter => ({
  id,
  name: `Mock Filter ${id}`,
  version,
  execute() {
    return Promise.resolve({
      filterId: id,
      execution: statusToExecution(status),
      status,
      diagnostics: [],
      durationMs: 10,
    });
  },
});

describe('ExecutionPlanSnapshot', () => {
  describe('Snapshot Determinism', () => {
    it('same config should produce identical planHash across multiple builds', () => {
      const plan = createTestPlan();
      const effectiveConfig = buildEffectiveConfig();
      const engineVersions: EngineVersions = {
        kernelVersion: '0.0.1',
        kositVersion: '1.5.0',
        nodeVersion: '20.10.0',
      };
      const filterVersions = {
        parser: '1.0.0',
        kosit: '2.0.0',
        vies: '1.0.0',
        'ecb-rates': '1.0.0',
        peppol: '1.0.0',
        'semantic-risk': '1.0.0',
        fingerprint: '1.0.0',
      };

      // Build snapshot multiple times
      const snapshot1 = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        engineVersions,
        filterVersions,
      );
      const snapshot2 = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        engineVersions,
        filterVersions,
      );
      const snapshot3 = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        engineVersions,
        filterVersions,
      );

      // All planHashes should be identical
      expect(snapshot1.planHash).toBe(snapshot2.planHash);
      expect(snapshot2.planHash).toBe(snapshot3.planHash);
      expect(snapshot1.configSnapshotHash).toBe(snapshot2.configSnapshotHash);
    });

    it('same effective config should produce identical configSnapshotHash', () => {
      const config1 = buildEffectiveConfig();
      const config2 = buildEffectiveConfig();
      const config3 = buildEffectiveConfig();

      expect(config1.configHash).toBe(config2.configHash);
      expect(config2.configHash).toBe(config3.configHash);
    });

    it('planHash should be verifiable', () => {
      const plan = createTestPlan();
      const effectiveConfig = buildEffectiveConfig();
      const engineVersions: EngineVersions = {
        kernelVersion: '0.0.1',
      };

      const snapshot = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        engineVersions,
        {},
      );

      // Verify should pass
      expect(verifyPlanHash(snapshot)).toBe(true);
    });
  });

  describe('Snapshot Sensitivity', () => {
    const baseEngineVersions: EngineVersions = {
      kernelVersion: '0.0.1',
      kositVersion: '1.5.0',
    };
    const baseFilterVersions = {
      parser: '1.0.0',
      kosit: '2.0.0',
    };

    it('changing a filter version should change planHash', () => {
      const plan = createTestPlan();
      const effectiveConfig = buildEffectiveConfig();

      const snapshot1 = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        baseEngineVersions,
        { ...baseFilterVersions, parser: '1.0.0' },
      );

      const snapshot2 = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        baseEngineVersions,
        { ...baseFilterVersions, parser: '1.0.1' }, // Changed version
      );

      expect(snapshot1.planHash).not.toBe(snapshot2.planHash);
    });

    it('changing engine version should change planHash', () => {
      const plan = createTestPlan();
      const effectiveConfig = buildEffectiveConfig();

      const snapshot1 = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        { kernelVersion: '0.0.1' },
        baseFilterVersions,
      );

      const snapshot2 = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        { kernelVersion: '0.0.2' }, // Changed version
        baseFilterVersions,
      );

      expect(snapshot1.planHash).not.toBe(snapshot2.planHash);
    });

    it('changing effective config should change configSnapshotHash', () => {
      const config1 = buildEffectiveConfig();
      const config2 = buildEffectiveConfig({ maxParallelism: 10 }); // Tenant override

      expect(config1.configHash).not.toBe(config2.configHash);
    });

    it('changing step config should change planHash', () => {
      const plan1 = createPlanBuilder(createTestPlan())
        .setStepConfig('parser', { option1: 'value1' })
        .build();

      const plan2 = createPlanBuilder(createTestPlan())
        .setStepConfig('parser', { option1: 'value2' }) // Different config
        .build();

      const effectiveConfig = buildEffectiveConfig();

      const snapshot1 = buildExecutionPlanSnapshot(
        plan1,
        effectiveConfig.config,
        baseEngineVersions,
        baseFilterVersions,
      );

      const snapshot2 = buildExecutionPlanSnapshot(
        plan2,
        effectiveConfig.config,
        baseEngineVersions,
        baseFilterVersions,
      );

      expect(snapshot1.planHash).not.toBe(snapshot2.planHash);
    });

    it('adding/removing a step should change planHash', () => {
      const plan1 = createTestPlan();
      // Disable a top-level step (not a child step)
      const plan2 = createPlanBuilder(createTestPlan())
        .disableStep('fingerprint')
        .build();

      const effectiveConfig = buildEffectiveConfig();

      const snapshot1 = buildExecutionPlanSnapshot(
        plan1,
        effectiveConfig.config,
        baseEngineVersions,
        baseFilterVersions,
      );

      const snapshot2 = buildExecutionPlanSnapshot(
        plan2,
        effectiveConfig.config,
        baseEngineVersions,
        baseFilterVersions,
      );

      expect(snapshot1.planHash).not.toBe(snapshot2.planHash);
    });
  });

  describe('Snapshot Structure', () => {
    it('snapshot should contain all required fields', () => {
      const plan = createTestPlan();
      const effectiveConfig = buildEffectiveConfig();
      const engineVersions: EngineVersions = {
        kernelVersion: '0.0.1',
        kositVersion: '1.5.0',
        nodeVersion: '20.10.0',
        dictionaryHash: 'sha256:abc123',
      };

      const snapshot = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        engineVersions,
        { parser: '1.0.0' },
      );

      // Required fields
      expect(snapshot.planId).toBe(plan.id);
      expect(snapshot.planVersion).toBe(plan.version);
      expect(snapshot.planName).toBe(plan.name);
      expect(snapshot.planHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(snapshot.configSnapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(snapshot.createdAt).toBeDefined();
      expect(new Date(snapshot.createdAt).toISOString()).toBe(snapshot.createdAt);

      // Engine versions
      expect(snapshot.engineVersions.kernelVersion).toBe('0.0.1');
      expect(snapshot.engineVersions.kositVersion).toBe('1.5.0');
      expect(snapshot.engineVersions.nodeVersion).toBe('20.10.0');
      expect(snapshot.engineVersions.dictionaryHash).toBe('sha256:abc123');

      // Steps
      expect(snapshot.steps.length).toBeGreaterThan(0);
      const parserStep = snapshot.steps.find((s) => s.stepName === 'parser');
      expect(parserStep).toBeDefined();
      expect(parserStep?.filterVersion).toBe('1.0.0');
      expect(parserStep?.failurePolicy).toBeDefined();
    });

    it('step snapshots should include failure policy', () => {
      const plan = createTestPlan();
      const effectiveConfig = buildEffectiveConfig();
      const engineVersions: EngineVersions = { kernelVersion: '0.0.1' };

      const snapshot = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        engineVersions,
        {},
      );

      // Parser should be fail_fast (critical validation)
      const parserStep = snapshot.steps.find((s) => s.stepName === 'parser');
      expect(parserStep?.failurePolicy).toBe('fail_fast');

      // Live verifiers parent should be soft_fail
      const liveVerifiersStep = snapshot.steps.find((s) => s.stepName === 'live-verifiers');
      expect(liveVerifiersStep?.failurePolicy).toBe('soft_fail');
    });

    it('snapshot should NOT contain PII or temp keys', () => {
      const plan = createTestPlan();
      const effectiveConfig = buildEffectiveConfig();
      const engineVersions: EngineVersions = { kernelVersion: '0.0.1' };

      const snapshot = buildExecutionPlanSnapshot(
        plan,
        effectiveConfig.config,
        engineVersions,
        {},
      );

      // Convert to string for checking
      const snapshotJson = JSON.stringify(snapshot);

      // Should NOT contain temp key patterns
      expect(snapshotJson).not.toContain('raw-invoice:');
      expect(snapshotJson).not.toContain('parsed-invoice:');
      expect(snapshotJson).not.toContain('temp-');

      // Should NOT contain PII patterns
      expect(snapshotJson).not.toContain('@'); // No email
      expect(snapshotJson).not.toContain('IBAN'); // No bank info
      expect(snapshotJson).not.toContain('phone'); // No phone
    });
  });
});

describe('Pipeline Report Hashes', () => {
  let registry: PluginRegistryImpl;

  beforeEach(() => {
    registry = new PluginRegistryImpl();
    registry.register(createMockFilter('parser', '1.0.0'));
    registry.register(createMockFilter('kosit', '2.1.0'));
    registry.register(createMockFilter('vies', '1.0.0'));
    registry.register(createMockFilter('ecb-rates', '1.0.0'));
    registry.register(createMockFilter('peppol', '1.0.0'));
    registry.register(createMockFilter('semantic-risk', '1.0.0'));
    registry.register(createMockFilter('fingerprint', '1.0.0'));
  });

  it('report should contain planHash, configSnapshotHash, and engineVersions', async () => {
    const pipeline = new Pipeline({
      registry,
      defaultPlan: createTestPlan(),
    });

    const report = await pipeline.execute({
      invoice: { content: '<Invoice>Test</Invoice>' },
    });

    // PlanSnapshot should have new fields
    expect(report.planSnapshot).toBeDefined();
    expect(report.planSnapshot.planHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.planSnapshot.configSnapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.planSnapshot.engineVersions).toBeDefined();
    expect(report.planSnapshot.engineVersions.kernelVersion).toBeDefined();
  });

  it('report should include executionSnapshot with step details', async () => {
    const pipeline = new Pipeline({
      registry,
      defaultPlan: createTestPlan(),
    });

    const report = await pipeline.execute({
      invoice: { content: '<Invoice>Test</Invoice>' },
    });

    expect(report.planSnapshot.executionSnapshot).toBeDefined();
    const snapshot = report.planSnapshot.executionSnapshot;
    if (snapshot) {
      expect(snapshot.planId).toBe('default-v1');
      expect(snapshot.steps.length).toBeGreaterThan(0);
      expect(snapshot.engineVersions.kernelVersion).toBeDefined();
    }
  });

  it('same pipeline config should produce consistent planHash across executions', async () => {
    const pipeline = new Pipeline({
      registry,
      defaultPlan: createTestPlan(),
      engineVersionOverrides: {
        kositVersion: '1.5.0', // Fix version for determinism
      },
    });

    const report1 = await pipeline.execute({
      invoice: { content: '<Invoice>Test1</Invoice>' },
    });
    const report2 = await pipeline.execute({
      invoice: { content: '<Invoice>Test2</Invoice>' },
    });

    // PlanHash should be identical (same config, different invoice content)
    expect(report1.planSnapshot.planHash).toBe(report2.planSnapshot.planHash);
    expect(report1.planSnapshot.configSnapshotHash).toBe(report2.planSnapshot.configSnapshotHash);
  });

  it('different tenant config should produce different configSnapshotHash', async () => {
    const pipeline1 = new Pipeline({
      registry,
      defaultPlan: createTestPlan(),
      tenantConfig: { maxParallelism: 5 },
    });

    const pipeline2 = new Pipeline({
      registry,
      defaultPlan: createTestPlan(),
      tenantConfig: { maxParallelism: 10 }, // Different config
    });

    const report1 = await pipeline1.execute({
      invoice: { content: '<Invoice>Test</Invoice>' },
    });
    const report2 = await pipeline2.execute({
      invoice: { content: '<Invoice>Test</Invoice>' },
    });

    // ConfigSnapshotHash should be different
    expect(report1.planSnapshot.configSnapshotHash).not.toBe(report2.planSnapshot.configSnapshotHash);
  });

  it('filter versions from completed steps should match registry', async () => {
    const pipeline = new Pipeline({
      registry,
      defaultPlan: createTestPlan(),
    });

    const report = await pipeline.execute({
      invoice: { content: '<Invoice>Test</Invoice>' },
    });

    // Check that filter versions in snapshot match registry
    expect(report.planSnapshot.filterVersions['parser']).toBe('1.0.0');
    expect(report.planSnapshot.filterVersions['kosit']).toBe('2.1.0');
  });

  it('planSnapshot should have all required audit trail fields', async () => {
    const pipeline = new Pipeline({
      registry,
      defaultPlan: createTestPlan(),
    });

    const report = await pipeline.execute({
      invoice: { content: '<Invoice>Test</Invoice>' },
    });

    const snapshot = report.planSnapshot;

    // Core identity
    expect(snapshot.id).toBe('default-v1');
    expect(snapshot.version).toBe('1.0.0');

    // Hashes for integrity
    expect(snapshot.configHash).toMatch(/^sha256:/);
    expect(snapshot.planHash).toMatch(/^sha256:/);
    expect(snapshot.configSnapshotHash).toMatch(/^sha256:/);

    // Version tracking
    expect(snapshot.engineVersions).toBeDefined();
    expect(snapshot.filterVersions).toBeDefined();
    expect(snapshot.stepConfigHashes).toBeDefined();

    // Timestamp
    expect(snapshot.capturedAt).toBeDefined();
    expect(new Date(snapshot.capturedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('Effective Config', () => {
  it('should merge tenant config with defaults', () => {
    const result = buildEffectiveConfig({
      maxParallelism: 10,
      locale: 'de-DE',
    });

    expect(result.config['maxParallelism']).toBe(10);
    expect(result.config['locale']).toBe('de-DE');
    expect(result.config['defaultFilterTimeout']).toBe(10000); // Default
    expect(result.sources).toContain('tenant');
  });

  it('should apply request overrides over tenant config', () => {
    const result = buildEffectiveConfig(
      { locale: 'de-DE' },
      { locale: 'fr-FR', timeoutMs: 5000 },
    );

    expect(result.config['locale']).toBe('fr-FR'); // Request wins
    expect(result.config['defaultFilterTimeout']).toBe(5000); // From request
    expect(result.sources).toContain('request');
  });

  it('should produce consistent hash for same config', () => {
    const result1 = buildEffectiveConfig({ maxParallelism: 10 });
    const result2 = buildEffectiveConfig({ maxParallelism: 10 });

    expect(result1.configHash).toBe(result2.configHash);
  });
});

describe('Engine Versions', () => {
  it('should return kernel version', () => {
    const versions = getEngineVersions();

    expect(versions.kernelVersion).toBeDefined();
    expect(versions.kernelVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should return node version', () => {
    const versions = getEngineVersions();

    expect(versions.nodeVersion).toBeDefined();
    expect(versions.nodeVersion).toMatch(/^\d+\./);
  });

  it('should accept custom component versions', () => {
    const versions = getEngineVersions({
      kositVersion: '1.6.0',
      dictionaryHash: 'sha256:custom123',
      components: {
        customValidator: '2.0.0',
      },
    });

    expect(versions.kositVersion).toBe('1.6.0');
    expect(versions.dictionaryHash).toBe('sha256:custom123');
    expect(versions.components?.['customValidator']).toBe('2.0.0');
  });
});
