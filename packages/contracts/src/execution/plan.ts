/**
 * Condition for conditional step execution
 */
export interface StepCondition {
  /**
   * Type of condition
   */
  type: 'filter-passed' | 'filter-failed' | 'field-exists' | 'custom';

  /**
   * Reference filter ID (for filter-passed/filter-failed)
   */
  filterId?: string;

  /**
   * Field path (for field-exists)
   */
  fieldPath?: string;

  /**
   * Custom condition expression
   */
  expression?: string;
}

import type { FailurePolicy, FailurePolicyConfig } from './failure-policy.js';

/**
 * A single step in the execution plan
 */
export interface ExecutionStep {
  /**
   * Filter ID to execute
   */
  filterId: string;

  /**
   * Filter version (for traceability)
   */
  filterVersion?: string;

  /**
   * Whether this step is enabled
   * @default true
   */
  enabled?: boolean;

  /**
   * Filter-specific configuration
   */
  config?: Record<string, unknown>;

  /**
   * SHA-256 hash of the step configuration
   */
  configHash?: string;

  /**
   * Execution order (lower = earlier)
   * Steps with same order may run in parallel
   */
  order?: number;

  /**
   * Timeout for this specific step (ms)
   */
  timeoutMs?: number;

  /**
   * Failure policy for this step
   * Overrides default policy for the filter
   */
  failurePolicy?: FailurePolicy | FailurePolicyConfig;

  /**
   * Whether to continue pipeline if this step fails
   * @deprecated Use failurePolicy instead
   * @default true for warnings, false for errors
   */
  continueOnFailure?: boolean;

  /**
   * Condition for executing this step
   */
  condition?: StepCondition;

  /**
   * Child steps (for grouped/parallel execution)
   */
  children?: ExecutionStep[];

  /**
   * Whether children should run in parallel
   * @default false
   */
  parallel?: boolean;
}

/**
 * ExecutionPlan captures the exact configuration used for validation.
 *
 * The plan provides:
 * - Reproducibility: Same plan = same validation behavior
 * - Traceability: Config hash proves what rules were applied
 * - Flexibility: Plans can be customized per request
 *
 * @example
 * ```typescript
 * const plan: ExecutionPlan = {
 *   id: 'default-v1',
 *   version: '1.0.0',
 *   steps: [
 *     { filterId: 'parser', enabled: true },
 *     { filterId: 'kosit', enabled: true },
 *     {
 *       filterId: 'live-verifiers',
 *       parallel: true,
 *       children: [
 *         { filterId: 'vies', enabled: true },
 *         { filterId: 'ecb-rates', enabled: true },
 *       ]
 *     },
 *     { filterId: 'semantic-risk', enabled: true },
 *     { filterId: 'fingerprint', enabled: true },
 *   ],
 *   configHash: 'sha256:abc123...',
 *   createdAt: '2024-01-23T12:00:00Z',
 * };
 * ```
 */
export interface ExecutionPlan {
  /**
   * Unique identifier for this plan
   */
  id: string;

  /**
   * Plan version (semantic versioning)
   */
  version: string;

  /**
   * Human-readable name
   */
  name?: string;

  /**
   * Description of this plan's purpose
   */
  description?: string;

  /**
   * Ordered list of execution steps
   */
  steps: ExecutionStep[];

  /**
   * SHA-256 hash of the serialized plan configuration
   * Used to verify plan integrity and for traceability
   */
  configHash: string;

  /**
   * When this plan was created (ISO 8601)
   */
  createdAt: string;

  /**
   * Who created this plan
   */
  createdBy?: string;

  /**
   * Global configuration that applies to all steps
   */
  globalConfig?: {
    /** Default timeout for steps (ms) */
    defaultTimeout?: number;

    /** Default locale */
    locale?: string;

    /** Maximum parallel executions */
    maxParallelism?: number;
  };

  /**
   * Tags for categorization and filtering
   */
  tags?: string[];

  /**
   * Whether this is the default plan
   */
  isDefault?: boolean;
}

/**
 * Plan builder options
 */
export interface PlanBuilderOptions {
  /**
   * Base plan to extend
   */
  basePlan?: ExecutionPlan;

  /**
   * Automatically calculate config hash
   * @default true
   */
  autoHash?: boolean;
}

/**
 * Engine and dependency versions for reproducibility audit.
 * Captures the exact versions of all components used during validation.
 */
export interface EngineVersions {
  /**
   * Kernel package version (from package.json)
   */
  kernelVersion: string;

  /**
   * Hash of validation dictionary/rules (for Schematron, custom rules)
   */
  dictionaryHash?: string;

  /**
   * KoSIT validator version (if used)
   */
  kositVersion?: string;

  /**
   * Node.js runtime version
   */
  nodeVersion?: string;

  /**
   * Additional component versions (extensible)
   */
  components?: Record<string, string>;
}

/**
 * ExecutionPlanSnapshot captures the complete execution configuration
 * at the moment of validation, including engine versions and effective config hash.
 *
 * This provides the evidence chain for audit: "Exactly how was this invoice validated?"
 *
 * Key properties:
 * - planHash: SHA-256 of (steps + versions + configSnapshotHash) - proves plan integrity
 * - configSnapshotHash: SHA-256 of effective runtime config - proves config used
 * - engineVersions: Exact versions of all components - enables reproduction
 *
 * IMPORTANT: This snapshot NEVER contains:
 * - PII (personal identifiable information)
 * - Temp storage keys
 * - Raw invoice content
 *
 * @example
 * ```typescript
 * const snapshot: ExecutionPlanSnapshot = {
 *   planId: 'default-v1',
 *   planHash: 'sha256:abc123...',
 *   configSnapshotHash: 'sha256:def456...',
 *   createdAt: '2024-01-23T12:00:00Z',
 *   steps: [
 *     { stepName: 'parser', failurePolicy: 'fail_fast', filterVersion: '1.0.0' },
 *     { stepName: 'kosit', failurePolicy: 'fail_fast', filterVersion: '2.1.0' },
 *   ],
 *   engineVersions: {
 *     kernelVersion: '0.0.1',
 *     kositVersion: '1.5.0',
 *     nodeVersion: '20.10.0',
 *   },
 * };
 * ```
 */
export interface ExecutionPlanSnapshot {
  /**
   * Plan identifier (from ExecutionPlan.id)
   */
  planId: string;

  /**
   * SHA-256 hash of the canonical plan representation.
   * Includes: steps array, engine versions, configSnapshotHash.
   * Format: "sha256:<hex>"
   */
  planHash: string;

  /**
   * SHA-256 hash of the effective runtime configuration.
   * This is the merged result of: system defaults + tenant config + request overrides.
   * Format: "sha256:<hex>"
   */
  configSnapshotHash: string;

  /**
   * When this snapshot was created (ISO 8601)
   */
  createdAt: string;

  /**
   * Ordered list of execution steps with their configurations.
   * Each step captures: filter ID, failure policy, filter version, config hash.
   */
  steps: ExecutionStepSnapshot[];

  /**
   * Versions of all engine components used.
   * Critical for reproducibility and audit.
   */
  engineVersions: EngineVersions;

  /**
   * Plan version (from ExecutionPlan.version)
   */
  planVersion?: string;

  /**
   * Plan name (from ExecutionPlan.name)
   */
  planName?: string;
}

/**
 * Snapshot of a single execution step.
 * Captures filter identity, version, and configuration hash for audit.
 */
export interface ExecutionStepSnapshot {
  /**
   * Filter/step name (e.g., 'parser', 'kosit', 'vies')
   */
  stepName: string;

  /**
   * Failure policy applied to this step
   */
  failurePolicy: 'fail_fast' | 'soft_fail' | 'always_run';

  /**
   * Filter version that executed this step
   */
  filterVersion: string;

  /**
   * SHA-256 hash of step-specific configuration.
   * Format: "sha256:<hex>"
   */
  configHash?: string;

  /**
   * Execution order (from ExecutionStep.order)
   */
  order?: number;

  /**
   * Whether this was a parallel execution group
   */
  parallel?: boolean;

  /**
   * Child step snapshots (for parallel/grouped execution)
   */
  children?: ExecutionStepSnapshot[];
}
