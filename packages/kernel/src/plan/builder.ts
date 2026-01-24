import type { ExecutionPlan, ExecutionStep } from '@fiscal-layer/contracts';
import { calculateConfigHash } from './hash.js';

/**
 * Create the default execution plan for FiscalLayer.
 */
export function createDefaultPlan(): ExecutionPlan {
  const steps: ExecutionStep[] = [
    {
      filterId: 'parser',
      enabled: true,
      order: 10,
    },
    {
      filterId: 'kosit',
      enabled: true,
      order: 20,
      continueOnFailure: false,
    },
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
    {
      filterId: 'semantic-risk',
      enabled: true,
      order: 40,
    },
    {
      filterId: 'fingerprint',
      enabled: true,
      order: 50,
    },
  ];

  const plan: ExecutionPlan = {
    id: 'default-v1',
    version: '1.0.0',
    name: 'Default FiscalLayer Plan',
    description: 'Standard validation pipeline with all built-in filters',
    steps,
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

/**
 * Plan builder for creating custom execution plans.
 */
export interface PlanBuilder {
  setId(id: string): PlanBuilder;
  setVersion(version: string): PlanBuilder;
  setName(name: string): PlanBuilder;
  addStep(step: ExecutionStep): PlanBuilder;
  removeStep(filterId: string): PlanBuilder;
  enableStep(filterId: string): PlanBuilder;
  disableStep(filterId: string): PlanBuilder;
  setStepConfig(filterId: string, config: Record<string, unknown>): PlanBuilder;
  build(): ExecutionPlan;
}

/**
 * Create a new plan builder.
 */
export function createPlanBuilder(base?: ExecutionPlan): PlanBuilder {
  const plan: ExecutionPlan = base
    ? { ...base, steps: [...base.steps] }
    : {
        id: `plan-${Date.now()}`,
        version: '1.0.0',
        steps: [],
        configHash: '',
        createdAt: new Date().toISOString(),
      };

  const builder: PlanBuilder = {
    setId(id: string) {
      plan.id = id;
      return builder;
    },

    setVersion(version: string) {
      plan.version = version;
      return builder;
    },

    setName(name: string) {
      plan.name = name;
      return builder;
    },

    addStep(step: ExecutionStep) {
      plan.steps.push(step);
      return builder;
    },

    removeStep(filterId: string) {
      plan.steps = plan.steps.filter((s) => s.filterId !== filterId);
      return builder;
    },

    enableStep(filterId: string) {
      const step = plan.steps.find((s) => s.filterId === filterId);
      if (step) step.enabled = true;
      return builder;
    },

    disableStep(filterId: string) {
      const step = plan.steps.find((s) => s.filterId === filterId);
      if (step) step.enabled = false;
      return builder;
    },

    setStepConfig(filterId: string, config: Record<string, unknown>) {
      const step = plan.steps.find((s) => s.filterId === filterId);
      if (step) step.config = { ...step.config, ...config };
      return builder;
    },

    build(): ExecutionPlan {
      plan.configHash = calculateConfigHash(plan);
      return { ...plan };
    },
  };

  return builder;
}
