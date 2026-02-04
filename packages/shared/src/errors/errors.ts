/**
 * Base error class for FiscalLayer
 */
export class FiscalLayerError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'FiscalLayerError';
    this.code = code;
    if (context !== undefined) {
      this.context = context;
    }

    // Maintains proper stack trace for where error was thrown

    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
    };
  }
}

/**
 * Error thrown during validation
 */
export class ValidationError extends FiscalLayerError {
  readonly diagnostics?: { code: string; message: string }[];

  constructor(
    message: string,
    diagnostics?: { code: string; message: string }[],
    context?: Record<string, unknown>,
  ) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'ValidationError';
    if (diagnostics !== undefined) {
      this.diagnostics = diagnostics;
    }
  }
}

/**
 * Error thrown for configuration issues
 */
export class ConfigurationError extends FiscalLayerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', context);
    this.name = 'ConfigurationError';
  }
}

/**
 * Error thrown when a filter is not found
 */
export class FilterNotFoundError extends FiscalLayerError {
  readonly filterId: string;

  constructor(filterId: string) {
    super(`Filter '${filterId}' not found in registry`, 'FILTER_NOT_FOUND', { filterId });
    this.name = 'FilterNotFoundError';
    this.filterId = filterId;
  }
}

/**
 * Error thrown when pipeline execution times out
 */
export class TimeoutError extends FiscalLayerError {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, context?: Record<string, unknown>) {
    super(message, 'TIMEOUT_ERROR', { ...context, timeoutMs });
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
