import type {
  Pipeline as PipelineInterface,
  PipelineConfig,
  PipelineInput,
  ValidationReport,
  ExecutionPlan,
  ExecutionStep,
  ExecutionPlanSnapshot,
  StepResult,
  PluginRegistry,
  FilterContext,
  InvoiceSummary,
  PlanSnapshot,
  PipelineCleanupResult,
  RetentionWarning,
  EngineVersions,
  PolicyGateDecision,
  FinalDecision,
  DecisionReasonCode,
  StepDecisionAnalysis,
} from '@fiscal-layer/contracts';
import { computeConfigHash } from '@fiscal-layer/shared';
import { ValidationContextImpl } from '../context/context.js';
import { createFingerprint } from '../fingerprint/generator.js';
import { calculateScore } from '../scoring/calculator.js';
import {
  buildEffectiveConfig,
  getEngineVersions,
  extractFilterVersions,
  type TenantConfig,
  type RequestOverrides,
  type EngineVersionOptions,
} from '../config/effective-config.js';
import { buildExecutionPlanSnapshot } from '../plan/hash.js';

/**
 * Metadata for tracked temp keys (for debugging/auditing)
 */
interface TempKeyMetadata {
  /** Why this key was created */
  purpose: string;
  /** Which component created it */
  createdBy: string;
  /** When it was tracked */
  trackedAt: string;
}

/**
 * Tracks temp keys created during pipeline execution for guaranteed cleanup.
 * Stores purpose/createdBy metadata for debugging (but NOT logged to avoid PII leakage).
 */
class TempKeyTracker {
  private readonly keys = new Map<string, TempKeyMetadata>();

  track(key: string, purpose: string, createdBy: string): void {
    this.keys.set(key, {
      purpose,
      createdBy,
      trackedAt: new Date().toISOString(),
    });
  }

  getKeys(): string[] {
    return Array.from(this.keys.keys());
  }

  /** Get count without exposing keys (safe for logging) */
  getCount(): number {
    return this.keys.size;
  }

  /** Get categories (safe for logging - no full keys) */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const key of this.keys.keys()) {
      const colonIndex = key.indexOf(':');
      if (colonIndex > 0) {
        categories.add(key.slice(0, colonIndex));
      }
    }
    return Array.from(categories);
  }

  clear(): void {
    this.keys.clear();
  }
}

/**
 * Extended pipeline configuration with tenant and engine version options.
 */
export interface ExtendedPipelineConfig extends PipelineConfig {
  /** Tenant-specific configuration */
  tenantConfig?: TenantConfig;
  /** Engine version overrides (for testing or custom components) */
  engineVersionOverrides?: EngineVersionOptions;
}

/**
 * Pipeline orchestrates the execution of validation filters.
 */
export class Pipeline implements PipelineInterface {
  private readonly config: ExtendedPipelineConfig;
  private readonly registry: PluginRegistry;
  private executionPlan: ExecutionPlan;
  private executing = false;

  constructor(config: ExtendedPipelineConfig & { registry: PluginRegistry }) {
    this.config = config;
    this.registry = config.registry;
    this.executionPlan = config.defaultPlan;
  }

  async execute(input: PipelineInput): Promise<ValidationReport> {
    if (this.executing) {
      throw new Error('Pipeline is already executing');
    }

    this.executing = true;
    const startTime = Date.now();
    const plan = input.plan ?? this.executionPlan;
    const tempKeyTracker = new TempKeyTracker();

    // Variables to capture for finally block
    let context: ValidationContextImpl | undefined;
    let report: ValidationReport | undefined;
    let pipelineStatus: 'success' | 'failure' | 'timeout' | 'error' = 'error';
    let cleanupResult: PipelineCleanupResult | undefined;

    // Build effective config BEFORE try block (needed for snapshot in both paths)
    const requestOverrides: RequestOverrides | undefined = input.options?.metadata
      ? { metadata: input.options.metadata }
      : undefined;
    const effectiveConfigResult = buildEffectiveConfig(
      this.config.tenantConfig,
      requestOverrides,
    );

    // Get engine versions for audit trail
    const versionOverrides = this.config.engineVersionOverrides;
    const engineVersions = getEngineVersions(
      versionOverrides
        ? {
            kositVersion: versionOverrides.kositVersion,
            dictionaryHash: versionOverrides.dictionaryHash,
            components: versionOverrides.components,
          }
        : undefined,
    );

    // Extract filter versions from registry
    const filterVersions = extractFilterVersions(this.registry);

    // Build execution plan snapshot for audit trail
    const executionSnapshot = buildExecutionPlanSnapshot(
      plan,
      effectiveConfigResult.config,
      engineVersions,
      filterVersions,
    );

    try {
      // Notify start
      this.config.events?.onStart?.(input);

      // Create validation context
      const contextInit: {
        invoice: typeof input.invoice;
        options: NonNullable<typeof input.options>;
        plan: typeof plan;
        correlationId?: string;
      } = {
        invoice: input.invoice,
        options: input.options ?? {},
        plan,
      };
      if (input.correlationId !== undefined) {
        contextInit.correlationId = input.correlationId;
      }
      context = new ValidationContextImpl(contextInit);

      // Track invoice temp key for cleanup (raw invoice stored externally)
      // Standard key format: "raw-invoice:{runId}"
      tempKeyTracker.track(`raw-invoice:${context.runId}`, 'raw invoice content', 'pipeline:execute');
      tempKeyTracker.track(`parsed-invoice:${context.runId}`, 'parsed invoice data', 'pipeline:execute');

      // Execute steps
      await this.executeSteps(plan.steps, context);

      // Calculate score
      const score = calculateScore(context.diagnostics, context.completedSteps);

      // Determine status
      const status = this.determineStatus(context, score);
      pipelineStatus = status === 'APPROVED' || status === 'APPROVED_WITH_WARNINGS'
        ? 'success'
        : status === 'TIMEOUT'
          ? 'timeout'
          : 'failure';

      // Create fingerprint
      const fingerprint = createFingerprint({
        runId: context.runId,
        status,
        score,
        steps: [...context.completedSteps],
        diagnostics: [...context.diagnostics],
        plan,
        invoiceSummary: this.createInvoiceSummary(context),
        durationMs: Date.now() - startTime,
      });

      // Build plan snapshot for audit trail (includes execution snapshot)
      const planSnapshot = this.createPlanSnapshot(
        plan,
        context.completedSteps,
        executionSnapshot,
        effectiveConfigResult.configHash,
        engineVersions,
      );

      // Build report
      report = {
        runId: context.runId,
        status,
        score,
        diagnostics: [...context.diagnostics],
        diagnosticCounts: this.countDiagnostics(context.diagnostics),
        steps: [...context.completedSteps],
        stepStatistics: this.calculateStepStats(context.completedSteps),
        invoiceSummary: this.createInvoiceSummary(context),
        planSnapshot,
        fingerprint,
        timing: {
          startedAt: context.startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
      };

      // Add optional fields
      if (context.parsedInvoice !== undefined) {
        report.parsedInvoice = context.parsedInvoice;
      }
      if (input.options?.metadata !== undefined) {
        report.metadata = input.options.metadata;
      }
      if (input.correlationId !== undefined) {
        report.correlationId = input.correlationId;
      }

      // Extract PolicyGate decision if present
      const finalDecision = this.extractPolicyGateDecision(context.completedSteps);
      if (finalDecision !== undefined) {
        report.finalDecision = finalDecision;
      }

      // Notify complete
      this.config.events?.onComplete?.(report);

      return report;
    } catch (error) {
      pipelineStatus = 'error';
      this.config.events?.onError?.(error as Error);
      throw error;
    } finally {
      // GUARANTEED CLEANUP: Always runs regardless of success/failure
      // This is the "finally secure delete" semantics
      if (this.config.cleanupEnforcer && context) {
        // Record applied retention policy in report
        if (report) {
          report.appliedRetentionPolicy = this.config.cleanupEnforcer.getPolicyType();
        }

        try {
          cleanupResult = await this.config.cleanupEnforcer.cleanup({
            runId: context.runId,
            correlationId: context.correlationId,
            tempKeys: tempKeyTracker.getKeys(),
            pipelineStatus,
          });

          // Emit cleanup event
          this.config.events?.onCleanup?.(cleanupResult);

          // Add warnings to report if we have one
          if (report && cleanupResult.warnings.length > 0) {
            report.retentionWarnings = cleanupResult.warnings;
          }
        } catch {
          // Cleanup errors must NEVER prevent report return
          // This catch is a safety net - the enforcer itself should never throw
          const emergencyWarning: RetentionWarning = {
            code: 'CLEANUP_ERROR',
            message: 'Cleanup enforcer failed unexpectedly',
            timestamp: new Date().toISOString(),
            affectedCount: tempKeyTracker.getCount(),
          };
          if (report) {
            report.retentionWarnings = [emergencyWarning];
          }
        }
      }

      // Clear temp key tracker
      tempKeyTracker.clear();
      this.executing = false;
    }
  }

  private async executeSteps(
    steps: ExecutionStep[],
    context: ValidationContextImpl,
  ): Promise<void> {
    for (const step of steps) {
      if (context.aborted) break;
      if (!step.enabled) continue;

      // Check condition
      if (step.condition && !this.evaluateCondition(step.condition, context)) {
        context.addStepResult({
          filterId: step.filterId,
          status: 'skipped',
          diagnostics: [],
          durationMs: 0,
        });
        continue;
      }

      // Handle parallel children
      if (step.children && step.parallel) {
        await this.executeParallel(step.children, context);
        continue;
      }

      // Handle sequential children
      if (step.children) {
        await this.executeSteps(step.children, context);
        continue;
      }

      // Execute single filter
      await this.executeFilter(step, context);
    }
  }

  private async executeParallel(
    steps: ExecutionStep[],
    context: ValidationContextImpl,
  ): Promise<void> {
    const maxParallelism = this.config.maxParallelism ?? 5;
    const enabledSteps = steps.filter((s) => s.enabled !== false);

    // Execute in batches
    for (let i = 0; i < enabledSteps.length; i += maxParallelism) {
      const batch = enabledSteps.slice(i, i + maxParallelism);
      const results = await Promise.allSettled(
        batch.map((step) => this.executeFilter(step, context)),
      );

      // Handle rejections
      for (const result of results) {
        if (result.status === 'rejected') {
          this.config.events?.onError?.(result.reason as Error);
        }
      }
    }
  }

  private async executeFilter(step: ExecutionStep, context: ValidationContextImpl): Promise<void> {
    const registered = this.registry.get(step.filterId);
    if (!registered) {
      context.addStepResult({
        filterId: step.filterId,
        status: 'error',
        diagnostics: [],
        durationMs: 0,
        error: {
          name: 'FilterNotFound',
          message: `Filter '${step.filterId}' not found in registry`,
        },
      });
      return;
    }

    const filter = registered.filter;
    const config = { ...registered.options.defaultConfig, ...step.config };

    this.config.events?.onStepStart?.(step.filterId);
    const startTime = Date.now();

    try {
      const filterContext: FilterContext = {
        runId: context.runId,
        correlationId: context.correlationId,
        startedAt: context.startedAt,
        rawInvoice: context.rawInvoice,
        parsedInvoice: context.parsedInvoice,
        executionPlan: context.executionPlan,
        options: context.options,
        completedSteps: context.completedSteps,
        diagnostics: context.diagnostics,
        aborted: context.aborted,
        abortReason: context.abortReason,
        getStepResult: (filterId: string) => context.getStepResult(filterId),
        hasExecuted: (filterId: string) => context.hasExecuted(filterId),
        getFilterConfig: <T = Record<string, unknown>>(filterId: string) =>
          context.getFilterConfig<T>(filterId),
        config,
      };

      const result = await this.withTimeout(
        filter.execute(filterContext),
        step.timeoutMs ?? this.config.defaultFilterTimeout ?? 10000,
        step.filterId,
      );

      const durationMs = Date.now() - startTime;
      const stepResult: StepResult = {
        ...result,
        filterId: step.filterId,
        filterVersion: filter.version,
        durationMs,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };

      context.addStepResult(stepResult);
      context.addDiagnostics(result.diagnostics);

      // Update parsed invoice if parser
      if (step.filterId === 'parser' && result.metadata?.['parsedInvoice']) {
        context.setParsedInvoice(result.metadata['parsedInvoice'] as never);
      }

      this.config.events?.onStepComplete?.(step.filterId, durationMs);

      // Check if we should abort
      if (result.status === 'failed' && !step.continueOnFailure) {
        context.abort(`Filter '${step.filterId}' failed`);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const err = error as Error;

      const errorInfo: { name: string; message: string; stack?: string } = {
        name: err.name,
        message: err.message,
      };
      if (err.stack !== undefined) {
        errorInfo.stack = err.stack;
      }
      context.addStepResult({
        filterId: step.filterId,
        filterVersion: filter.version,
        status: 'error',
        diagnostics: [],
        durationMs,
        error: errorInfo,
      });

      this.config.events?.onError?.(err, step.filterId);
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, filterId: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Filter '${filterId}' timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }

  private evaluateCondition(
    condition: ExecutionStep['condition'],
    context: ValidationContextImpl,
  ): boolean {
    if (!condition) return true;

    switch (condition.type) {
      case 'filter-passed':
        return context.getStepResult(condition.filterId ?? '')?.status === 'passed';
      case 'filter-failed':
        return context.getStepResult(condition.filterId ?? '')?.status === 'failed';
      case 'field-exists':
        return condition.fieldPath ? this.fieldExists(context, condition.fieldPath) : false;
      default:
        return true;
    }
  }

  private fieldExists(context: ValidationContextImpl, path: string): boolean {
    if (!context.parsedInvoice) return false;
    const parts = path.split('.');
    let current: unknown = context.parsedInvoice;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return false;
      current = (current as Record<string, unknown>)[part];
    }
    return current !== undefined;
  }

  private determineStatus(
    context: ValidationContextImpl,
    score: number,
  ): ValidationReport['status'] {
    if (context.aborted) return 'ERROR';

    const hasErrors = context.diagnostics.some((d) => d.severity === 'error');
    const hasWarnings = context.diagnostics.some((d) => d.severity === 'warning');

    if (hasErrors) return 'REJECTED';
    if (hasWarnings) return 'APPROVED_WITH_WARNINGS';
    return 'APPROVED';
  }

  private countDiagnostics(diagnostics: readonly { severity: string }[]) {
    return {
      errors: diagnostics.filter((d) => d.severity === 'error').length,
      warnings: diagnostics.filter((d) => d.severity === 'warning').length,
      info: diagnostics.filter((d) => d.severity === 'info').length,
      hints: diagnostics.filter((d) => d.severity === 'hint').length,
    };
  }

  private calculateStepStats(steps: readonly StepResult[]) {
    return {
      total: steps.length,
      passed: steps.filter((s) => s.status === 'passed').length,
      failed: steps.filter((s) => s.status === 'failed').length,
      warnings: steps.filter((s) => s.status === 'warning').length,
      skipped: steps.filter((s) => s.status === 'skipped').length,
      timedOut: steps.filter((s) => s.status === 'timeout').length,
      errors: steps.filter((s) => s.status === 'error').length,
      totalDurationMs: steps.reduce((sum, s) => sum + s.durationMs, 0),
    };
  }

  private createInvoiceSummary(context: ValidationContextImpl): InvoiceSummary {
    const invoice = context.parsedInvoice;
    const summary: InvoiceSummary = {
      format: invoice?.format ?? 'unknown',
    };
    if (invoice?.invoiceNumber !== undefined) {
      summary.invoiceNumber = invoice.invoiceNumber;
    }
    if (invoice?.issueDate !== undefined) {
      summary.issueDate = invoice.issueDate;
    }
    if (invoice?.currency !== undefined) {
      summary.currency = invoice.currency;
    }
    if (invoice?.totalAmount !== undefined) {
      summary.totalAmount = invoice.totalAmount;
    }
    if (invoice?.seller?.vatId) {
      summary.sellerVatId = this.maskVatId(invoice.seller.vatId);
    }
    if (invoice?.buyer?.vatId) {
      summary.buyerVatId = this.maskVatId(invoice.buyer.vatId);
    }
    if (invoice?.lineItems?.length !== undefined) {
      summary.lineItemCount = invoice.lineItems.length;
    }
    return summary;
  }

  private maskVatId(vatId: string): string {
    if (vatId.length <= 4) return '****';
    return vatId.slice(0, 2) + '***' + vatId.slice(-2);
  }

  private createPlanSnapshot(
    plan: ExecutionPlan,
    completedSteps: readonly StepResult[],
    executionSnapshot: ExecutionPlanSnapshot,
    configSnapshotHash: string,
    engineVersions: EngineVersions,
  ): PlanSnapshot {
    // Collect filter versions from completed steps
    const filterVersions: Record<string, string> = {};
    const stepConfigHashes: Record<string, string> = {};

    for (const step of completedSteps) {
      if (step.filterVersion !== undefined) {
        filterVersions[step.filterId] = step.filterVersion;
      }
      // Hash the step config if available
      const stepConfig = this.getStepConfig(plan, step.filterId);
      if (stepConfig !== undefined) {
        stepConfigHashes[step.filterId] = computeConfigHash(stepConfig);
      }
    }

    return {
      id: plan.id,
      version: plan.version,
      configHash: plan.configHash,
      planHash: executionSnapshot.planHash,
      configSnapshotHash,
      engineVersions,
      filterVersions,
      stepConfigHashes,
      capturedAt: new Date().toISOString(),
      executionSnapshot,
    };
  }

  private getStepConfig(
    plan: ExecutionPlan,
    filterId: string,
  ): Record<string, unknown> | undefined {
    const findConfig = (
      steps: ExecutionStep[],
    ): Record<string, unknown> | undefined => {
      for (const step of steps) {
        if (step.filterId === filterId) {
          return step.config;
        }
        if (step.children) {
          const found = findConfig(step.children);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    };
    return findConfig(plan.steps);
  }

  /**
   * Extract PolicyGateDecision from completed steps.
   * Returns undefined if PolicyGate was not executed.
   */
  private extractPolicyGateDecision(
    completedSteps: readonly StepResult[],
  ): PolicyGateDecision | undefined {
    // Look for policy-gate step result
    const policyGateStep = completedSteps.find(
      (s) => s.filterId === 'policy-gate' || s.filterId === 'steps-policy-gate',
    );

    if (!policyGateStep?.metadata) {
      return undefined;
    }

    const metadata = policyGateStep.metadata;

    // Validate required fields
    const decision = metadata['decision'];
    const reasonCodes = metadata['reasonCodes'];
    const appliedPolicyVersion = metadata['appliedPolicyVersion'];
    const effectiveAt = metadata['effectiveAt'];
    const summary = metadata['summary'];

    if (
      typeof decision !== 'string' ||
      !Array.isArray(reasonCodes) ||
      typeof appliedPolicyVersion !== 'string' ||
      typeof effectiveAt !== 'string' ||
      typeof summary !== 'string'
    ) {
      return undefined;
    }

    // Build the PolicyGateDecision
    const result: PolicyGateDecision = {
      decision: decision as FinalDecision,
      reasonCodes: reasonCodes as DecisionReasonCode[],
      appliedPolicyVersion,
      effectiveAt,
      summary,
    };

    // Include step analysis if present
    const stepAnalysis = metadata['stepAnalysis'];
    if (Array.isArray(stepAnalysis) && stepAnalysis.length > 0) {
      result.stepAnalysis = stepAnalysis as StepDecisionAnalysis[];
    }

    return result;
  }

  getExecutionPlan(): ExecutionPlan {
    return this.executionPlan;
  }

  setExecutionPlan(plan: ExecutionPlan): void {
    this.executionPlan = plan;
  }

  isExecuting(): boolean {
    return this.executing;
  }
}
