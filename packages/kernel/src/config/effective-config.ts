import type { EngineVersions } from '@fiscal-layer/contracts';
import { computeConfigHash } from '@fiscal-layer/shared';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Default system configuration for the pipeline.
 */
export const DEFAULT_PIPELINE_CONFIG = {
  defaultFilterTimeout: 10000,
  maxParallelism: 5,
  locale: 'en-US',
  strictMode: false,
  retryOnError: false,
  maxRetries: 0,
} as const;

/**
 * Tenant-specific configuration that can override defaults.
 */
export interface TenantConfig {
  /** Custom timeout for filters */
  defaultFilterTimeout?: number;
  /** Custom parallelism limit */
  maxParallelism?: number;
  /** Custom locale */
  locale?: string;
  /** Strict mode for validation */
  strictMode?: boolean;
  /** Enable retry on error */
  retryOnError?: boolean;
  /** Max retries */
  maxRetries?: number;
  /** Additional tenant-specific settings */
  custom?: Record<string, unknown>;
}

/**
 * Request-level overrides (limited to safe options).
 */
export interface RequestOverrides {
  /** Override locale for this request */
  locale?: string;
  /** Custom timeout for this request */
  timeoutMs?: number;
  /** Additional request metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Effective configuration result.
 */
export interface EffectiveConfig {
  /** Merged configuration */
  config: Record<string, unknown>;
  /** SHA-256 hash of the config */
  configHash: string;
  /** Sources that contributed to this config */
  sources: ('default' | 'tenant' | 'request')[];
}

/**
 * Build effective configuration by merging:
 * 1. System defaults
 * 2. Tenant configuration (if provided)
 * 3. Request overrides (if provided, limited scope)
 *
 * The merge follows precedence: request > tenant > system defaults.
 *
 * @param tenantConfig - Tenant-specific configuration (optional)
 * @param requestOverrides - Request-level overrides (optional, limited)
 * @returns Merged effective configuration with hash
 */
export function buildEffectiveConfig(
  tenantConfig?: TenantConfig,
  requestOverrides?: RequestOverrides,
): EffectiveConfig {
  const sources: EffectiveConfig['sources'] = ['default'];

  // Start with defaults
  const merged: Record<string, unknown> = { ...DEFAULT_PIPELINE_CONFIG };

  // Apply tenant config if provided
  if (tenantConfig) {
    sources.push('tenant');
    if (tenantConfig.defaultFilterTimeout !== undefined) {
      merged['defaultFilterTimeout'] = tenantConfig.defaultFilterTimeout;
    }
    if (tenantConfig.maxParallelism !== undefined) {
      merged['maxParallelism'] = tenantConfig.maxParallelism;
    }
    if (tenantConfig.locale !== undefined) {
      merged['locale'] = tenantConfig.locale;
    }
    if (tenantConfig.strictMode !== undefined) {
      merged['strictMode'] = tenantConfig.strictMode;
    }
    if (tenantConfig.retryOnError !== undefined) {
      merged['retryOnError'] = tenantConfig.retryOnError;
    }
    if (tenantConfig.maxRetries !== undefined) {
      merged['maxRetries'] = tenantConfig.maxRetries;
    }
    if (tenantConfig.custom) {
      merged['custom'] = { ...tenantConfig.custom };
    }
  }

  // Apply request overrides (limited scope for safety)
  if (requestOverrides) {
    sources.push('request');
    if (requestOverrides.locale !== undefined) {
      merged['locale'] = requestOverrides.locale;
    }
    if (requestOverrides.timeoutMs !== undefined) {
      merged['defaultFilterTimeout'] = requestOverrides.timeoutMs;
    }
    if (requestOverrides.metadata !== undefined) {
      merged['requestMetadata'] = requestOverrides.metadata;
    }
  }

  return {
    config: merged,
    configHash: computeConfigHash(merged),
    sources,
  };
}

/**
 * Cached kernel version to avoid repeated file reads.
 */
let cachedKernelVersion: string | undefined;

/**
 * Get the kernel package version from package.json.
 * This reads the version at runtime for accurate tracking.
 */
export function getKernelVersion(): string {
  if (cachedKernelVersion) {
    return cachedKernelVersion;
  }

  try {
    // Get the directory of this module
    const currentDir = dirname(fileURLToPath(import.meta.url));
    // Navigate to package root (src/config -> src -> kernel)
    const packageJsonPath = join(currentDir, '..', '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
    cachedKernelVersion = packageJson.version;
    return cachedKernelVersion;
  } catch {
    // Fallback to a default if file read fails (e.g., in bundled environment)
    return '0.0.0-unknown';
  }
}

/**
 * Get the current Node.js version.
 */
export function getNodeVersion(): string {
  return process.version.replace(/^v/, '');
}

/**
 * Compute a hash of dictionary/rules content for version tracking.
 *
 * @param content - Dictionary or rules content as string
 * @returns Hash in format: "sha256:<hex>"
 */
export function computeDictionaryHash(content: string): string {
  return computeConfigHash({ content });
}

/**
 * Default KoSIT version (can be overridden by actual runner).
 */
const DEFAULT_KOSIT_VERSION = '1.5.0';

/**
 * Options for engine version overrides.
 */
export interface EngineVersionOptions {
  kositVersion?: string | undefined;
  dictionaryHash?: string | undefined;
  components?: Record<string, string> | undefined;
}

/**
 * Get engine versions for the current runtime.
 *
 * @param options - Optional overrides for testing
 * @returns EngineVersions object
 */
export function getEngineVersions(options?: EngineVersionOptions): EngineVersions {
  const versions: EngineVersions = {
    kernelVersion: getKernelVersion(),
    nodeVersion: getNodeVersion(),
  };

  // Add KoSIT version if provided or use default
  versions.kositVersion = options?.kositVersion ?? DEFAULT_KOSIT_VERSION;

  // Add dictionary hash if provided
  if (options?.dictionaryHash) {
    versions.dictionaryHash = options.dictionaryHash;
  }

  // Add additional components if provided
  if (options?.components) {
    versions.components = options.components;
  }

  return versions;
}

/**
 * Extract filter versions from a plugin registry.
 *
 * @param registry - The plugin registry
 * @returns Map of filterId -> version
 */
export function extractFilterVersions(registry: {
  list: () => { filter: { id: string; version: string } }[];
}): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const registered of registry.list()) {
    versions[registered.filter.id] = registered.filter.version;
  }
  return versions;
}
