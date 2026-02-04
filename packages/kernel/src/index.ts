/**
 * @fiscal-layer/kernel
 *
 * Core pipeline engine for FiscalLayer validation (OSS).
 *
 * This package has zero external runtime dependencies and is part of
 * the open-source distribution.
 *
 * For billing/metering functionality, see @fiscal-layer/billing (private).
 *
 * @packageDocumentation
 */

export { Pipeline } from './pipeline/pipeline.js';
export { PluginRegistryImpl } from './registry/registry.js';
export { ValidationContextImpl, defaultClock, defaultIdGenerator } from './context/context.js';

// Determinism support: injectable clock and ID generator for testing/audits
export type { Clock, IdGenerator, ContextInit } from './context/context.js';

export { createDefaultPlan, createPlanBuilder } from './plan/builder.js';
export {
  calculateConfigHash,
  calculatePlanHash,
  verifyConfigHash,
  verifyPlanHash,
  buildExecutionPlanSnapshot,
  createStepSnapshot,
  getStepFailurePolicy,
} from './plan/hash.js';

export {
  buildEffectiveConfig,
  getEngineVersions,
  getKernelVersion,
  getNodeVersion,
  computeDictionaryHash,
  extractFilterVersions,
  DEFAULT_PIPELINE_CONFIG,
} from './config/effective-config.js';

export type { TenantConfig, RequestOverrides, EffectiveConfig } from './config/effective-config.js';

export { generateFingerprintId, createFingerprint } from './fingerprint/generator.js';

export { calculateScore } from './scoring/calculator.js';

// Event Hooks (OSS-safe abstraction)
// Implementations go in private packages (e.g., @fiscal-layer/billing)
export {
  CompositeEventHooks,
  NoopEventHooks,
  ConsoleEventHooks,
  createStepCompleteEvent,
} from './events/hooks.js';

export type {
  KernelEventHooks,
  PipelineStartEvent,
  PipelineCompleteEvent,
  StepStartEvent,
  StepCompleteEvent,
} from './events/hooks.js';

// Re-export commonly used types
export type {
  Pipeline as PipelineInterface,
  PipelineConfig,
  PipelineInput,
} from '@fiscal-layer/contracts';
