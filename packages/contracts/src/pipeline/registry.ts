import type { Filter, FilterMetadata, ConfiguredFilter } from './filter.js';

/**
 * Filter registration options
 */
export interface FilterRegistrationOptions {
  /**
   * Override the filter's default priority
   * Lower numbers execute first
   */
  priority?: number;

  /**
   * Mark as default enabled/disabled
   */
  enabled?: boolean;

  /**
   * Default configuration for this filter
   */
  defaultConfig?: Record<string, unknown>;

  /**
   * Aliases for this filter ID
   */
  aliases?: string[];
}

/**
 * Registered filter entry
 */
export interface RegisteredFilter {
  filter: Filter;
  options: FilterRegistrationOptions;
  registeredAt: string;
}

/**
 * PluginRegistry manages the registration and lookup of filters.
 *
 * The registry is the central place where filters are registered
 * and made available to the pipeline. It supports:
 * - Registration with options (priority, config, aliases)
 * - Lookup by ID or alias
 * - Discovery via tags or metadata
 * - Lifecycle management (init/destroy hooks)
 *
 * @example
 * ```typescript
 * const registry = new PluginRegistry();
 *
 * // Register a filter
 * registry.register(myFilter, { priority: 100 });
 *
 * // Get a filter
 * const filter = registry.get('my-filter');
 *
 * // List all filters
 * const all = registry.list();
 * ```
 */
export interface PluginRegistry {
  /**
   * Register a filter
   *
   * @param filter - The filter to register
   * @param options - Registration options
   * @throws If a filter with the same ID is already registered
   */
  register(filter: Filter, options?: FilterRegistrationOptions): void;

  /**
   * Unregister a filter by ID
   *
   * @param filterId - The filter ID to unregister
   * @returns True if the filter was found and removed
   */
  unregister(filterId: string): boolean;

  /**
   * Get a filter by ID or alias
   *
   * @param filterId - The filter ID or alias
   * @returns The filter or undefined if not found
   */
  get(filterId: string): RegisteredFilter | undefined;

  /**
   * Check if a filter is registered
   *
   * @param filterId - The filter ID or alias
   */
  has(filterId: string): boolean;

  /**
   * List all registered filters
   *
   * @param options - Optional filtering options
   */
  list(options?: { tags?: string[]; enabled?: boolean }): RegisteredFilter[];

  /**
   * Get filter metadata only (without the filter implementation)
   *
   * @param filterId - The filter ID
   */
  getMetadata(filterId: string): FilterMetadata | undefined;

  /**
   * Create a configured filter instance
   *
   * @param filterId - The filter ID
   * @param config - Configuration to merge with defaults
   */
  configure(filterId: string, config?: Record<string, unknown>): ConfiguredFilter | undefined;

  /**
   * Initialize all registered filters
   * Calls onInit() on each filter that has it
   */
  initializeAll(): Promise<void>;

  /**
   * Destroy all registered filters
   * Calls onDestroy() on each filter that has it
   */
  destroyAll(): Promise<void>;

  /**
   * Clear all registered filters
   */
  clear(): void;

  /**
   * Get the number of registered filters
   */
  size(): number;
}
