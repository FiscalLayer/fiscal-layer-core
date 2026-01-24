import type {
  PluginRegistry,
  Filter,
  FilterMetadata,
  FilterRegistrationOptions,
  RegisteredFilter,
  ConfiguredFilter,
} from '@fiscal-layer/contracts';

/**
 * Implementation of the plugin registry.
 */
export class PluginRegistryImpl implements PluginRegistry {
  private filters: Map<string, RegisteredFilter> = new Map();
  private aliases: Map<string, string> = new Map();

  register(filter: Filter, options: FilterRegistrationOptions = {}): void {
    if (this.filters.has(filter.id)) {
      throw new Error(`Filter '${filter.id}' is already registered`);
    }

    const registered: RegisteredFilter = {
      filter,
      options,
      registeredAt: new Date().toISOString(),
    };

    this.filters.set(filter.id, registered);

    // Register aliases
    if (options.aliases) {
      for (const alias of options.aliases) {
        if (this.aliases.has(alias)) {
          throw new Error(`Alias '${alias}' is already registered`);
        }
        this.aliases.set(alias, filter.id);
      }
    }
  }

  unregister(filterId: string): boolean {
    const registered = this.filters.get(filterId);
    if (!registered) return false;

    // Remove aliases
    if (registered.options.aliases) {
      for (const alias of registered.options.aliases) {
        this.aliases.delete(alias);
      }
    }

    return this.filters.delete(filterId);
  }

  get(filterId: string): RegisteredFilter | undefined {
    // Check direct ID
    const direct = this.filters.get(filterId);
    if (direct) return direct;

    // Check alias
    const resolvedId = this.aliases.get(filterId);
    if (resolvedId) {
      return this.filters.get(resolvedId);
    }

    return undefined;
  }

  has(filterId: string): boolean {
    return this.filters.has(filterId) || this.aliases.has(filterId);
  }

  list(options?: { tags?: string[]; enabled?: boolean }): RegisteredFilter[] {
    let result = Array.from(this.filters.values());

    if (options?.tags && options.tags.length > 0) {
      result = result.filter((r) =>
        options.tags!.some((tag) => r.filter.tags?.includes(tag)),
      );
    }

    if (options?.enabled !== undefined) {
      result = result.filter((r) => (r.options.enabled ?? true) === options.enabled);
    }

    // Sort by priority
    return result.sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0));
  }

  getMetadata(filterId: string): FilterMetadata | undefined {
    const registered = this.get(filterId);
    if (!registered) return undefined;

    const { filter } = registered;
    const metadata: FilterMetadata = {
      id: filter.id,
      name: filter.name,
      version: filter.version,
    };
    if (filter.description !== undefined) {
      metadata.description = filter.description;
    }
    if (filter.author !== undefined) {
      metadata.author = filter.author;
    }
    if (filter.tags !== undefined) {
      metadata.tags = filter.tags;
    }
    if (filter.dependsOn !== undefined) {
      metadata.dependsOn = filter.dependsOn;
    }
    if (filter.executionMode !== undefined) {
      metadata.executionMode = filter.executionMode;
    }
    return metadata;
  }

  configure(filterId: string, config?: Record<string, unknown>): ConfiguredFilter | undefined {
    const registered = this.get(filterId);
    if (!registered) return undefined;

    return {
      filter: registered.filter,
      config: { ...registered.options.defaultConfig, ...config },
    };
  }

  async initializeAll(): Promise<void> {
    const promises = Array.from(this.filters.values())
      .filter((r) => r.filter.onInit)
      .map((r) => r.filter.onInit!());

    await Promise.all(promises);
  }

  async destroyAll(): Promise<void> {
    const promises = Array.from(this.filters.values())
      .filter((r) => r.filter.onDestroy)
      .map((r) => r.filter.onDestroy!());

    await Promise.all(promises);
  }

  clear(): void {
    this.filters.clear();
    this.aliases.clear();
  }

  size(): number {
    return this.filters.size;
  }
}
