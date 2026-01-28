import type {
  ValidationContext,
  MutableValidationContext,
  ValidationOptions,
  RawInvoice,
  ParsedInvoice,
  Diagnostic,
  StepResult,
  ExecutionPlan,
} from '@fiscal-layer/contracts';

/**
 * Clock interface for injectable time source.
 * Allows deterministic testing and reproducible audits.
 */
export interface Clock {
  now(): Date;
}

/**
 * IdGenerator interface for injectable ID generation.
 * Allows deterministic testing and reproducible audits.
 */
export interface IdGenerator {
  /** Generate a unique identifier */
  generate(prefix?: string): string;
}

/**
 * Default clock implementation using system time.
 */
export const defaultClock: Clock = {
  now: () => new Date(),
};

/**
 * Default ID generator using timestamp + crypto random.
 */
export const defaultIdGenerator: IdGenerator = {
  generate: (prefix?: string) => {
    const timestamp = Date.now().toString(36);
    const random = globalThis.crypto.randomUUID().slice(0, 8);
    return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
  },
};

export interface ContextInit {
  invoice: RawInvoice;
  options: ValidationOptions;
  plan: ExecutionPlan;
  correlationId?: string;
  /**
   * Optional clock for deterministic testing.
   * Defaults to system clock.
   */
  clock?: Clock;
  /**
   * Optional ID generator for deterministic testing.
   * Defaults to timestamp + crypto random.
   */
  idGenerator?: IdGenerator;
}

/**
 * Implementation of the validation context.
 */
export class ValidationContextImpl implements MutableValidationContext {
  readonly runId: string;
  readonly correlationId: string;
  readonly startedAt: string;
  readonly rawInvoice: RawInvoice;
  readonly executionPlan: ExecutionPlan;
  readonly options: ValidationOptions;

  private _parsedInvoice?: ParsedInvoice;
  private _completedSteps: StepResult[] = [];
  private _diagnostics: Diagnostic[] = [];
  private _aborted = false;
  private _abortReason?: string;
  private _filterConfigs: Map<string, Record<string, unknown>> = new Map();

  constructor(init: ContextInit) {
    const clock = init.clock ?? defaultClock;
    const idGenerator = init.idGenerator ?? defaultIdGenerator;

    this.runId = idGenerator.generate('run');
    this.correlationId = init.correlationId ?? this.runId;
    this.startedAt = clock.now().toISOString();
    this.rawInvoice = init.invoice;
    this.options = init.options;
    this.executionPlan = init.plan;

    // Pre-populate filter configs from plan
    for (const step of this.flattenSteps(init.plan.steps)) {
      if (step.config) {
        this._filterConfigs.set(step.filterId, step.config);
      }
    }
  }

  private flattenSteps(
    steps: ExecutionPlan['steps'],
  ): Array<{ filterId: string; config: Record<string, unknown> | undefined }> {
    const result: Array<{ filterId: string; config: Record<string, unknown> | undefined }> = [];
    for (const step of steps) {
      result.push({ filterId: step.filterId, config: step.config });
      if (step.children) {
        result.push(...this.flattenSteps(step.children));
      }
    }
    return result;
  }

  get parsedInvoice(): ParsedInvoice | undefined {
    return this._parsedInvoice;
  }

  get completedSteps(): ReadonlyArray<StepResult> {
    return this._completedSteps;
  }

  get diagnostics(): ReadonlyArray<Diagnostic> {
    return this._diagnostics;
  }

  get aborted(): boolean {
    return this._aborted;
  }

  get abortReason(): string | undefined {
    return this._abortReason;
  }

  getStepResult(filterId: string): StepResult | undefined {
    return this._completedSteps.find((s) => s.filterId === filterId);
  }

  hasExecuted(filterId: string): boolean {
    return this._completedSteps.some((s) => s.filterId === filterId);
  }

  getFilterConfig<T = Record<string, unknown>>(filterId: string): T | undefined {
    return this._filterConfigs.get(filterId) as T | undefined;
  }

  // Mutable methods (used internally by pipeline)

  setParsedInvoice(invoice: ParsedInvoice): void {
    this._parsedInvoice = invoice;
  }

  addStepResult(result: StepResult): void {
    this._completedSteps.push(result);
  }

  addDiagnostics(diagnostics: Diagnostic[]): void {
    this._diagnostics.push(...diagnostics);
  }

  abort(reason: string): void {
    this._aborted = true;
    this._abortReason = reason;
  }
}
