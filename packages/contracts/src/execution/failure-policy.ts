/**
 * Failure policy determines how the pipeline handles step failures.
 *
 * - `fail_fast`: Stop pipeline immediately on failure (default for KoSIT)
 * - `soft_fail`: Log failure, mark step as failed, continue pipeline (default for external verifiers)
 * - `best_effort`: Try to execute, ignore errors, continue (for optional enrichments)
 * - `always_run`: Execute regardless of previous failures (default for semantic/fingerprint)
 */
export type FailurePolicy = 'fail_fast' | 'soft_fail' | 'best_effort' | 'always_run';

/**
 * HTTP status codes that are generally safe to retry
 */
export const RETRYABLE_STATUS_CODES = [
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
] as const;

/**
 * Error types that are generally safe to retry
 */
export const RETRYABLE_ERROR_TYPES = [
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'NETWORK_ERROR',
  'TIMEOUT',
  'SERVICE_UNAVAILABLE',
] as const;

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /**
   * Number of retries before applying failure policy
   * @default 0
   */
  maxRetries: number;

  /**
   * Initial delay between retries in milliseconds
   * @default 1000
   */
  initialDelayMs: number;

  /**
   * Exponential backoff multiplier for retries
   * @default 2
   */
  backoffMultiplier: number;

  /**
   * Maximum delay between retries in milliseconds
   * @default 30000
   */
  maxDelayMs: number;

  /**
   * Total time budget for all retries in milliseconds.
   * Once exceeded, no more retries will be attempted.
   * @default undefined (no budget)
   */
  totalBudgetMs?: number;

  /**
   * HTTP status codes that should trigger a retry
   * @default RETRYABLE_STATUS_CODES
   */
  retryableStatusCodes?: number[];

  /**
   * Error types that should trigger a retry
   * @default RETRYABLE_ERROR_TYPES
   */
  retryableErrorTypes?: string[];

  /**
   * Custom function to determine if an error is retryable
   */
  isRetryable?: (error: unknown) => boolean;

  /**
   * Jitter factor to randomize delay (0 = no jitter, 1 = up to 100% jitter)
   * @default 0.1
   */
  jitterFactor?: number;
}

/**
 * Failure policy configuration with retry support.
 */
export interface FailurePolicyConfig {
  /**
   * The failure policy to apply
   */
  policy: FailurePolicy;

  /**
   * Retry configuration
   */
  retry?: RetryConfig;

  /**
   * Custom error handler for this step
   */
  onError?: 'log' | 'alert' | 'ignore';

  /**
   * @deprecated Use retry.maxRetries instead
   */
  retries?: number;

  /**
   * @deprecated Use retry.initialDelayMs instead
   */
  retryDelayMs?: number;

  /**
   * @deprecated Use retry.backoffMultiplier instead
   */
  backoffMultiplier?: number;

  /**
   * @deprecated Use retry.maxDelayMs instead
   */
  maxRetryDelayMs?: number;
}

/**
 * Create a retry config with sensible defaults
 */
export function createRetryConfig(overrides: Partial<RetryConfig> = {}): RetryConfig {
  const config: RetryConfig = {
    maxRetries: overrides.maxRetries ?? 3,
    initialDelayMs: overrides.initialDelayMs ?? 1000,
    backoffMultiplier: overrides.backoffMultiplier ?? 2,
    maxDelayMs: overrides.maxDelayMs ?? 30000,
    retryableStatusCodes: overrides.retryableStatusCodes ?? [...RETRYABLE_STATUS_CODES],
    retryableErrorTypes: overrides.retryableErrorTypes ?? [...RETRYABLE_ERROR_TYPES],
    jitterFactor: overrides.jitterFactor ?? 0.1,
  };

  // Only set optional properties if provided (for exactOptionalPropertyTypes)
  if (overrides.totalBudgetMs !== undefined) {
    config.totalBudgetMs = overrides.totalBudgetMs;
  }
  if (overrides.isRetryable !== undefined) {
    config.isRetryable = overrides.isRetryable;
  }

  return config;
}

/**
 * Calculate delay for a given retry attempt with exponential backoff and jitter
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig,
): number {
  const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const clampedDelay = Math.min(baseDelay, config.maxDelayMs);

  // Add jitter
  const jitter = config.jitterFactor ?? 0;
  const jitterAmount = clampedDelay * jitter * Math.random();
  return Math.round(clampedDelay + jitterAmount);
}

/**
 * Check if an error is retryable based on config
 */
export function isErrorRetryable(
  error: unknown,
  config: RetryConfig,
): boolean {
  // Custom check first
  if (config.isRetryable) {
    return config.isRetryable(error);
  }

  const err = error as Record<string, unknown>;

  // Check HTTP status code (bracket notation for index signature access)
  const status = err['status'];
  if (status && typeof status === 'number') {
    if (config.retryableStatusCodes?.includes(status)) {
      return true;
    }
  }
  const statusCode = err['statusCode'];
  if (statusCode && typeof statusCode === 'number') {
    if (config.retryableStatusCodes?.includes(statusCode)) {
      return true;
    }
  }

  // Check error code
  const code = err['code'];
  if (code && typeof code === 'string') {
    if (config.retryableErrorTypes?.includes(code)) {
      return true;
    }
  }

  // Check error type
  const errType = err['type'];
  if (errType && typeof errType === 'string') {
    if (config.retryableErrorTypes?.includes(errType)) {
      return true;
    }
  }

  return false;
}

/**
 * Default failure policies by filter category.
 *
 * External verifiers have a total budget of 2 seconds to prevent
 * worker congestion during API instability.
 */
export const DEFAULT_FAILURE_POLICIES: Record<string, FailurePolicyConfig> = {
  // Schema validation must pass - no retries
  parser: {
    policy: 'fail_fast',
  },

  // KoSIT validation must pass - no retries
  kosit: {
    policy: 'fail_fast',
  },

  // VIES VAT validation - external API, graceful failure
  vies: {
    policy: 'soft_fail',
    retry: createRetryConfig({
      maxRetries: 2,
      initialDelayMs: 500,
      backoffMultiplier: 2,
      totalBudgetMs: 2000, // 2 second total budget
    }),
    onError: 'log',
  },

  // ECB rates - external API, graceful failure
  'ecb-rates': {
    policy: 'soft_fail',
    retry: createRetryConfig({
      maxRetries: 2,
      initialDelayMs: 300,
      backoffMultiplier: 2,
      totalBudgetMs: 1500, // 1.5 second total budget
    }),
    onError: 'log',
  },

  // Peppol directory - external API, graceful failure
  peppol: {
    policy: 'soft_fail',
    retry: createRetryConfig({
      maxRetries: 2,
      initialDelayMs: 500,
      backoffMultiplier: 2,
      totalBudgetMs: 2000, // 2 second total budget
    }),
    onError: 'log',
  },

  // Business logic always runs - no retries
  'semantic-risk': {
    policy: 'always_run',
  },

  // Fingerprint must complete - no retries
  fingerprint: {
    policy: 'always_run',
  },

  // Dispatcher is best-effort
  dispatcher: {
    policy: 'best_effort',
    retry: createRetryConfig({
      maxRetries: 1,
      initialDelayMs: 200,
      totalBudgetMs: 500,
    }),
    onError: 'ignore',
  },
};

/**
 * Get the default failure policy for a filter
 */
export function getDefaultFailurePolicy(filterId: string): FailurePolicyConfig {
  return (
    DEFAULT_FAILURE_POLICIES[filterId] ?? {
      policy: 'soft_fail',
      retries: 0,
    }
  );
}
