import type { JSONSchema } from '../utils/json-schema.js';
import type { FilterContext } from './context.js';
import type { StepResult } from '../execution/result.js';

/**
 * Filter execution mode
 */
export type FilterExecutionMode = 'sequential' | 'parallel';

/**
 * Filter metadata for registration and discovery
 */
export interface FilterMetadata {
  /** Unique filter identifier (namespaced, e.g., 'fiscal-layer/kosit') */
  id: string;

  /** Human-readable name */
  name: string;

  /** Semantic version */
  version: string;

  /** Brief description */
  description?: string;

  /** Author or maintainer */
  author?: string;

  /** Tags for categorization */
  tags?: string[];

  /** Dependencies on other filters (must run before this one) */
  dependsOn?: string[];

  /** Execution mode when part of a group */
  executionMode?: FilterExecutionMode;
}

/**
 * A Filter is a stateless processing unit in the validation pipeline.
 *
 * Filters must be:
 * - **Stateless**: No instance state between executions
 * - **Idempotent**: Same input always produces same output
 * - **Side-effect free**: No external mutations during execution
 *
 * @example
 * ```typescript
 * const myFilter: Filter = {
 *   id: 'my-org/my-filter',
 *   name: 'My Custom Filter',
 *   version: '1.0.0',
 *
 *   async execute(context) {
 *     const { parsedInvoice } = context;
 *     // Validation logic...
 *     return {
 *       filterId: this.id,
 *       status: 'passed',
 *       diagnostics: [],
 *       durationMs: 0
 *     };
 *   }
 * };
 * ```
 */
export interface Filter extends FilterMetadata {
  /**
   * JSON Schema for filter configuration.
   * If provided, configuration will be validated against this schema.
   */
  configSchema?: JSONSchema;

  /**
   * Execute the filter's validation logic.
   *
   * @param context - The current validation context
   * @returns Promise resolving to the step result
   */
  execute(context: FilterContext): Promise<StepResult>;

  /**
   * Optional initialization hook.
   * Called once when the filter is registered.
   */
  onInit?(): Promise<void>;

  /**
   * Optional cleanup hook.
   * Called when the filter is unregistered or the system shuts down.
   */
  onDestroy?(): Promise<void>;

  /**
   * Optional validation of configuration.
   * Called before execution if config is provided.
   *
   * @param config - The configuration to validate
   * @returns True if valid, or array of validation errors
   */
  validateConfig?(config: unknown): boolean | string[];
}

/**
 * Factory function type for creating filter instances
 */
export type FilterFactory = (config?: Record<string, unknown>) => Filter;

/**
 * Filter with resolved configuration
 */
export interface ConfiguredFilter {
  filter: Filter;
  config: Record<string, unknown>;
}
