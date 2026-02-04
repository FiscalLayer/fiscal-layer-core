/* eslint-disable @typescript-eslint/await-thenable -- Hook results may or may not be promises */
/* eslint-disable @typescript-eslint/no-extraneous-class -- Namespace class for hook management */
/**
 * Kernel Event Hooks
 *
 * Abstract event hooks for extensibility without coupling to billing.
 * This is the OSS-safe interface - implementations go in private packages.
 *
 * @packageDocumentation
 */

import type { StepResult, ValidationReport } from '@fiscal-layer/contracts';

/**
 * Event emitted when a pipeline run starts.
 */
export interface PipelineStartEvent {
  runId: string;
  correlationId: string;
  timestamp: string;
  planId: string;
  planVersion: string;
}

/**
 * Event emitted when a pipeline run completes.
 */
export interface PipelineCompleteEvent {
  runId: string;
  correlationId: string;
  timestamp: string;
  durationMs: number;
  status: string;
  stepCount: number;
}

/**
 * Event emitted when a filter step starts.
 */
export interface StepStartEvent {
  runId: string;
  correlationId: string;
  timestamp: string;
  filterId: string;
  filterVersion: string;
}

/**
 * Event emitted when a filter step completes.
 */
export interface StepCompleteEvent {
  runId: string;
  correlationId: string;
  timestamp: string;
  filterId: string;
  filterVersion: string;
  status: string;
  durationMs: number;
  diagnosticCount: number;
}

/**
 * Abstract event hooks interface.
 *
 * Implement this interface to receive pipeline events.
 * All methods are optional and async-safe.
 *
 * @example
 * ```typescript
 * // In private billing package:
 * class BillingEventHooks implements KernelEventHooks {
 *   onStepComplete(event: StepCompleteEvent) {
 *     this.emitBillingEvent(event);
 *   }
 * }
 * ```
 */
export interface KernelEventHooks {
  /**
   * Called when a pipeline run starts.
   */
  onPipelineStart?(event: PipelineStartEvent): void | Promise<void>;

  /**
   * Called when a pipeline run completes.
   */
  onPipelineComplete?(event: PipelineCompleteEvent): void | Promise<void>;

  /**
   * Called when a filter step starts.
   */
  onStepStart?(event: StepStartEvent): void | Promise<void>;

  /**
   * Called when a filter step completes.
   */
  onStepComplete?(event: StepCompleteEvent): void | Promise<void>;

  /**
   * Called when validation report is generated.
   */
  onReportGenerated?(report: ValidationReport): void | Promise<void>;

  /**
   * Flush any buffered events (for async implementations).
   */
  flush?(): Promise<void>;
}

/**
 * Composite event hooks that dispatches to multiple listeners.
 */
export class CompositeEventHooks implements KernelEventHooks {
  private readonly hooks: KernelEventHooks[];

  constructor(hooks: KernelEventHooks[]) {
    this.hooks = hooks;
  }

  async onPipelineStart(event: PipelineStartEvent): Promise<void> {
    await Promise.all(this.hooks.map((h) => h.onPipelineStart?.(event)));
  }

  async onPipelineComplete(event: PipelineCompleteEvent): Promise<void> {
    await Promise.all(this.hooks.map((h) => h.onPipelineComplete?.(event)));
  }

  async onStepStart(event: StepStartEvent): Promise<void> {
    await Promise.all(this.hooks.map((h) => h.onStepStart?.(event)));
  }

  async onStepComplete(event: StepCompleteEvent): Promise<void> {
    await Promise.all(this.hooks.map((h) => h.onStepComplete?.(event)));
  }

  async onReportGenerated(report: ValidationReport): Promise<void> {
    await Promise.all(this.hooks.map((h) => h.onReportGenerated?.(report)));
  }

  async flush(): Promise<void> {
    await Promise.all(this.hooks.map((h) => h.flush?.()));
  }
}

/**
 * No-op event hooks (default when no hooks configured).
 */
export class NoopEventHooks implements KernelEventHooks {
  // All methods are no-ops by default (interface methods are optional)
}

/**
 * Console event hooks for debugging.
 */
export class ConsoleEventHooks implements KernelEventHooks {
  private readonly prefix: string;

  constructor(options?: { prefix?: string }) {
    this.prefix = options?.prefix ?? '[KernelEvents]';
  }

  onPipelineStart(event: PipelineStartEvent): void {
    console.log(`${this.prefix} Pipeline started`, {
      runId: event.runId,
      planId: event.planId,
    });
  }

  onPipelineComplete(event: PipelineCompleteEvent): void {
    console.log(`${this.prefix} Pipeline completed`, {
      runId: event.runId,
      status: event.status,
      durationMs: event.durationMs,
    });
  }

  onStepStart(event: StepStartEvent): void {
    console.log(`${this.prefix} Step started`, {
      runId: event.runId,
      filterId: event.filterId,
    });
  }

  onStepComplete(event: StepCompleteEvent): void {
    console.log(`${this.prefix} Step completed`, {
      runId: event.runId,
      filterId: event.filterId,
      status: event.status,
      durationMs: event.durationMs,
    });
  }
}

/**
 * Create event hooks from StepResult for common use cases.
 */
export function createStepCompleteEvent(
  runId: string,
  correlationId: string,
  result: StepResult,
  filterVersion: string,
): StepCompleteEvent {
  // Use execution status
  const status = result.execution;

  return {
    runId,
    correlationId,
    timestamp: new Date().toISOString(),
    filterId: result.filterId,
    filterVersion,
    status,
    durationMs: result.durationMs,
    diagnosticCount: result.diagnostics.length,
  };
}
