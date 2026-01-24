/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

/**
 * Logger options
 */
export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  context?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Create a simple logger.
 * In production, replace with a proper logging library (pino, winston, etc.)
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = LOG_LEVELS[options.level ?? 'info'];
  const prefix = options.prefix ?? 'fiscal-layer';
  const baseContext = options.context ?? {};

  const shouldLog = (level: LogLevel): boolean => LOG_LEVELS[level] >= minLevel;

  const formatMessage = (level: LogLevel, message: string, context?: Record<string, unknown>): string => {
    const timestamp = new Date().toISOString();
    const mergedContext = { ...baseContext, ...context };
    const contextStr = Object.keys(mergedContext).length > 0
      ? ` ${JSON.stringify(mergedContext)}`
      : '';

    return `[${timestamp}] [${level.toUpperCase()}] [${prefix}] ${message}${contextStr}`;
  };

  const logger: Logger = {
    debug(message: string, context?: Record<string, unknown>) {
      if (shouldLog('debug')) {
        console.debug(formatMessage('debug', message, context));
      }
    },

    info(message: string, context?: Record<string, unknown>) {
      if (shouldLog('info')) {
        console.info(formatMessage('info', message, context));
      }
    },

    warn(message: string, context?: Record<string, unknown>) {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', message, context));
      }
    },

    error(message: string, context?: Record<string, unknown>) {
      if (shouldLog('error')) {
        console.error(formatMessage('error', message, context));
      }
    },

    child(context: Record<string, unknown>): Logger {
      const childOptions: LoggerOptions = {
        prefix,
        context: { ...baseContext, ...context },
      };
      if (options.level !== undefined) {
        childOptions.level = options.level;
      }
      return createLogger(childOptions);
    },
  };

  return logger;
}
