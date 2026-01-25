import type {
  ExecutionPlan,
  ExecutionStep,
  ExecutionPlanSnapshot,
  ExecutionStepSnapshot,
  EngineVersions,
} from '@fiscal-layer/contracts';
import { computeConfigHash } from '@fiscal-layer/shared';

/**
 * Calculate SHA-256 hash of the execution plan configuration.
 * Uses canonical JSON stringification for deterministic cross-process hashing.
 *
 * @param plan - The execution plan to hash
 * @returns Hash in format: "sha256:<hex>"
 */
export function calculateConfigHash(plan: ExecutionPlan): string {
  // Create deterministic representation (excluding mutable fields like createdAt)
  const hashInput = {
    id: plan.id,
    version: plan.version,
    steps: plan.steps,
    globalConfig: plan.globalConfig,
  };

  return computeConfigHash(hashInput);
}

/**
 * Calculate SHA-256 hash of the complete plan snapshot.
 * This hash covers: steps, kernelVersion, and effective config hash.
 *
 * NOTE: nodeVersion is intentionally EXCLUDED from the hash to prevent
 * environment-specific drift (e.g., Node 20.10.0 vs 20.11.0).
 * The full engineVersions are recorded in the snapshot for auditing,
 * but only kernelVersion affects the hash since it reflects code changes.
 *
 * @param snapshot - The execution plan snapshot (without planHash field)
 * @returns Hash in format: "sha256:<hex>"
 */
export function calculatePlanHash(
  snapshot: Omit<ExecutionPlanSnapshot, 'planHash'>,
): string {
  // Create deterministic representation for plan hash
  // Excludes createdAt as it changes on each execution
  // Excludes nodeVersion to prevent environment drift
  const hashInput = {
    planId: snapshot.planId,
    planVersion: snapshot.planVersion,
    configSnapshotHash: snapshot.configSnapshotHash,
    steps: snapshot.steps,
    // Only include kernelVersion (from package.json, stable across environments)
    // nodeVersion is recorded in engineVersions but not hashed
    kernelVersion: snapshot.engineVersions.kernelVersion,
  };

  return computeConfigHash(hashInput);
}

/**
 * Verify that a plan matches its config hash.
 *
 * @param plan - The execution plan to verify
 * @returns true if hash matches
 */
export function verifyConfigHash(plan: ExecutionPlan): boolean {
  const calculated = calculateConfigHash(plan);
  return calculated === plan.configHash;
}

/**
 * Verify that a plan snapshot matches its plan hash.
 *
 * @param snapshot - The execution plan snapshot to verify
 * @returns true if hash matches
 */
export function verifyPlanHash(snapshot: ExecutionPlanSnapshot): boolean {
  const calculated = calculatePlanHash(snapshot);
  return calculated === snapshot.planHash;
}

/**
 * Calculate hash of step configuration.
 *
 * @param config - Step-specific configuration
 * @returns Hash in format: "sha256:<hex>"
 */
export function calculateStepConfigHash(config: Record<string, unknown>): string {
  return computeConfigHash(config);
}

/**
 * Determine the failure policy for a step.
 * Maps from ExecutionStep to the canonical policy name.
 */
export function getStepFailurePolicy(
  step: ExecutionStep,
): 'fail_fast' | 'soft_fail' | 'always_run' {
  // Check explicit failurePolicy
  if (step.failurePolicy) {
    if (typeof step.failurePolicy === 'string') {
      return step.failurePolicy as 'fail_fast' | 'soft_fail' | 'always_run';
    }
    // FailurePolicyConfig - extract the policy name
    return step.failurePolicy.policy as 'fail_fast' | 'soft_fail' | 'always_run';
  }

  // Legacy: check continueOnFailure
  if (step.continueOnFailure === false) {
    return 'fail_fast';
  }
  if (step.continueOnFailure === true) {
    return 'soft_fail';
  }

  // Default based on typical filter behavior
  // Parser and schema validation should fail fast
  if (step.filterId === 'parser' || step.filterId === 'kosit') {
    return 'fail_fast';
  }

  // Semantic and fingerprint should always run
  if (step.filterId === 'semantic-risk' || step.filterId === 'fingerprint') {
    return 'always_run';
  }

  // Default to soft_fail for external verifiers
  return 'soft_fail';
}

/**
 * Create a step snapshot from an execution step.
 *
 * @param step - The execution step
 * @param filterVersion - Version of the filter that will execute this step
 * @returns Step snapshot for the execution plan snapshot
 */
export function createStepSnapshot(
  step: ExecutionStep,
  filterVersion: string,
): ExecutionStepSnapshot {
  const snapshot: ExecutionStepSnapshot = {
    stepName: step.filterId,
    failurePolicy: getStepFailurePolicy(step),
    filterVersion,
  };

  // Add optional fields
  if (step.config) {
    snapshot.configHash = calculateStepConfigHash(step.config);
  }
  if (step.order !== undefined) {
    snapshot.order = step.order;
  }
  if (step.parallel) {
    snapshot.parallel = step.parallel;
  }

  // Handle children recursively
  if (step.children && step.children.length > 0) {
    snapshot.children = step.children
      .filter((child) => child.enabled !== false)
      .map((child) => createStepSnapshot(child, child.filterVersion ?? 'unknown'));
  }

  return snapshot;
}

/**
 * Build a complete execution plan snapshot.
 *
 * @param plan - The execution plan
 * @param effectiveConfig - The merged effective configuration
 * @param engineVersions - Engine and component versions
 * @param filterVersions - Map of filterId -> version from registry
 * @returns Complete execution plan snapshot with computed planHash
 */
export function buildExecutionPlanSnapshot(
  plan: ExecutionPlan,
  effectiveConfig: Record<string, unknown>,
  engineVersions: EngineVersions,
  filterVersions: Record<string, string>,
): ExecutionPlanSnapshot {
  const configSnapshotHash = computeConfigHash(effectiveConfig);

  // Build step snapshots with filter versions from registry
  const steps = plan.steps
    .filter((step) => step.enabled !== false)
    .map((step) => {
      const version = filterVersions[step.filterId] ?? step.filterVersion ?? 'unknown';
      return createStepSnapshot(step, version);
    });

  // Create snapshot without planHash first
  const snapshotWithoutHash: Omit<ExecutionPlanSnapshot, 'planHash'> = {
    planId: plan.id,
    configSnapshotHash,
    createdAt: new Date().toISOString(),
    steps,
    engineVersions,
  };

  // Add optional fields if present
  if (plan.version !== undefined) {
    snapshotWithoutHash.planVersion = plan.version;
  }
  if (plan.name !== undefined) {
    snapshotWithoutHash.planName = plan.name;
  }

  // Calculate planHash from the snapshot
  const planHash = calculatePlanHash(snapshotWithoutHash);

  return {
    ...snapshotWithoutHash,
    planHash,
  };
}
