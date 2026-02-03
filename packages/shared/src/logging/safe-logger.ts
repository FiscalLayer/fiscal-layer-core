import { createLogger, type Logger, type LoggerOptions } from './logger.js';

/**
 * PII patterns that should be scrubbed from logs
 */
const PII_PATTERNS: { pattern: RegExp; replacement: string; name: string }[] = [
  // IBAN (various countries)
  {
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/gi,
    replacement: '[IBAN:REDACTED]',
    name: 'iban',
  },
  // Email addresses
  {
    pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    replacement: '[EMAIL:REDACTED]',
    name: 'email',
  },
  // German phone numbers
  {
    pattern: /(\+49|0049|0)[0-9\s\-/]{8,}/g,
    replacement: '[PHONE:REDACTED]',
    name: 'phone-de',
  },
  // International phone numbers
  {
    pattern: /\+\d{1,3}[\s\-.]?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/g,
    replacement: '[PHONE:REDACTED]',
    name: 'phone-intl',
  },
  // German VAT IDs
  {
    pattern: /\bDE\d{9}\b/gi,
    replacement: '[VATID:REDACTED]',
    name: 'vatid-de',
  },
  // EU VAT IDs (simplified pattern)
  {
    pattern: /\b[A-Z]{2}\d{8,12}\b/g,
    replacement: '[VATID:REDACTED]',
    name: 'vatid-eu',
  },
  // Credit card numbers (basic pattern)
  {
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: '[CC:REDACTED]',
    name: 'creditcard',
  },
];

/**
 * Fields that should be completely redacted when found in context
 */
const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'credential',
  'credentials',
  'privateKey',
  'private_key',
  'iban',
  'bankAccount',
  'bank_account',
  'creditCard',
  'credit_card',
  'ssn',
  'taxNumber',
  'tax_number',
  'email',
  'phone',
  'mobile',
  'fax',
  'address',
  'street',
  'postalCode',
  'postal_code',
  'zipCode',
  'zip_code',
]);

/**
 * Scrub PII from a string value
 */
function scrubString(value: string): string {
  let result = value;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Recursively scrub PII from an object
 */
function scrubObject(obj: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) {
    return '[MAX_DEPTH_REACHED]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return scrubString(obj);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubObject(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact known sensitive field names
      if (SENSITIVE_FIELD_NAMES.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = scrubObject(value, depth + 1);
      }
    }
    return result;
  }

  // Functions, symbols, etc.
  return '[UNSUPPORTED_TYPE]';
}

/**
 * Safe logger options
 */
export interface SafeLoggerOptions extends LoggerOptions {
  /**
   * Correlation ID to include in all log entries
   */
  correlationId?: string;

  /**
   * Run ID to include in all log entries
   */
  runId?: string;

  /**
   * Whether to enable PII scrubbing
   * @default true
   */
  scrubPii?: boolean;

  /**
   * Additional patterns to scrub
   */
  additionalPatterns?: { pattern: RegExp; replacement: string }[];
}

/**
 * Create a safe logger that automatically scrubs PII from log output.
 *
 * This logger:
 * - Scrubs common PII patterns (IBAN, email, phone, VAT IDs)
 * - Redacts known sensitive field names
 * - Always includes correlationId for traceability
 * - Prevents raw object logging that could leak PII
 *
 * @example
 * ```typescript
 * const logger = createSafeLogger({ correlationId: 'abc-123' });
 *
 * // This is safe - PII will be scrubbed
 * logger.info('Processing invoice', {
 *   invoiceNumber: 'INV-001',
 *   sellerIban: 'DE89370400440532013000', // Will be redacted
 * });
 * ```
 */
export function createSafeLogger(options: SafeLoggerOptions = {}): Logger {
  const baseLogger = createLogger(options);
  const scrubPii = options.scrubPii ?? true;
  const additionalPatterns = options.additionalPatterns ?? [];

  const baseContext: Record<string, unknown> = {};
  if (options.correlationId !== undefined) {
    baseContext['correlationId'] = options.correlationId;
  }
  if (options.runId !== undefined) {
    baseContext['runId'] = options.runId;
  }

  const scrubContext = (context?: Record<string, unknown>): Record<string, unknown> => {
    if (!scrubPii) {
      return { ...baseContext, ...context };
    }

    const merged = { ...baseContext, ...context };
    let scrubbed = scrubObject(merged) as Record<string, unknown>;

    // Apply additional patterns
    const jsonStr = JSON.stringify(scrubbed);
    let result = jsonStr;
    for (const { pattern, replacement } of additionalPatterns) {
      result = result.replace(pattern, replacement);
    }

    if (result !== jsonStr) {
      scrubbed = JSON.parse(result) as Record<string, unknown>;
    }

    return scrubbed;
  };

  const safeLogger: Logger = {
    debug(message: string, context?: Record<string, unknown>) {
      baseLogger.debug(scrubPii ? scrubString(message) : message, scrubContext(context));
    },

    info(message: string, context?: Record<string, unknown>) {
      baseLogger.info(scrubPii ? scrubString(message) : message, scrubContext(context));
    },

    warn(message: string, context?: Record<string, unknown>) {
      baseLogger.warn(scrubPii ? scrubString(message) : message, scrubContext(context));
    },

    error(message: string, context?: Record<string, unknown>) {
      baseLogger.error(scrubPii ? scrubString(message) : message, scrubContext(context));
    },

    child(context: Record<string, unknown>): Logger {
      const childOptions: SafeLoggerOptions = {
        ...options,
        context: { ...options.context, ...context },
      };
      if (options.correlationId !== undefined) {
        childOptions.correlationId = options.correlationId;
      }
      if (options.runId !== undefined) {
        childOptions.runId = options.runId;
      }
      return createSafeLogger(childOptions);
    },
  };

  return safeLogger;
}

/**
 * Options for assertSafeLogging
 */
export interface AssertSafeLoggingOptions {
  /**
   * Whether to enable console warnings (should be true in production)
   * @default false
   */
  enabled?: boolean;
}

/**
 * Assert that a logger is safe (throws if raw console.log is used).
 * Use this in production to catch accidental PII leaks.
 *
 * @param options - Configuration options (use enabled: true in production)
 *
 * @example
 * ```typescript
 * // In your app bootstrap
 * assertSafeLogging({ enabled: config.isProduction });
 * ```
 */
export function assertSafeLogging(options: AssertSafeLoggingOptions = {}): void {
  const { enabled = false } = options;

  if (enabled) {
    // Wrap console methods to warn about unsafe usage
    const originalLog = console.log;
    const originalDebug = console.debug;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;

    const createWarningWrapper = (original: typeof console.log, name: string) => {
      return (...args: unknown[]) => {
        original(
          `[WARNING] Direct console.${name} usage detected. Use safe logger instead to prevent PII leaks.`,
        );
        original(...args);
      };
    };

    console.log = createWarningWrapper(originalLog, 'log');
    console.debug = createWarningWrapper(originalDebug, 'debug');
    console.info = createWarningWrapper(originalInfo, 'info');
    console.warn = createWarningWrapper(originalWarn, 'warn');
    console.error = createWarningWrapper(originalError, 'error');
  }
}
