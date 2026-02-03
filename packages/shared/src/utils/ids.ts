/**
 * ID generation utilities with support for deterministic testing.
 *
 * By default, uses timestamp + crypto.randomUUID() for unique IDs.
 * For deterministic testing, pass a custom IdGenerator.
 */

/**
 * IdGenerator interface for injectable ID generation.
 * Allows deterministic testing and reproducible audits.
 */
export interface IdGenerator {
  /** Generate a unique identifier */
  generate(prefix?: string): string;
}

/**
 * Default ID generator using timestamp + crypto random.
 * Uses globalThis.crypto.randomUUID() for cryptographically secure randomness.
 */
export const defaultIdGenerator: IdGenerator = {
  generate: (prefix?: string) => {
    const timestamp = Date.now().toString(36);
    const random = globalThis.crypto.randomUUID().slice(0, 8);
    return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
  },
};

/**
 * Options for ID generation functions.
 */
export interface GenerateIdOptions {
  /**
   * Custom ID generator for deterministic testing.
   * If not provided, uses default generator with timestamp + crypto random.
   */
  idGenerator?: IdGenerator;
}

/**
 * Generate a unique ID.
 * Uses timestamp + crypto.randomUUID() for uniqueness and security.
 *
 * @param prefix - Optional prefix for the ID
 * @param options - Optional settings including custom IdGenerator
 * @returns A unique identifier string
 *
 * @example
 * // Default usage
 * generateId('user') // => 'user-lq2x4y-a1b2c3d4'
 *
 * // Deterministic testing
 * const fixedGenerator = { generate: () => 'fixed-id' };
 * generateId('user', { idGenerator: fixedGenerator }) // => 'fixed-id'
 */
export function generateId(prefix = '', options?: GenerateIdOptions): string {
  const generator = options?.idGenerator ?? defaultIdGenerator;
  return generator.generate(prefix || undefined);
}

/**
 * Generate a correlation ID for request tracing.
 *
 * @param options - Optional settings including custom IdGenerator
 */
export function generateCorrelationId(options?: GenerateIdOptions): string {
  return generateId('cor', options);
}

/**
 * Generate a run ID for validation runs.
 *
 * @param options - Optional settings including custom IdGenerator
 */
export function generateRunId(options?: GenerateIdOptions): string {
  return generateId('run', options);
}

/**
 * Generate a fingerprint ID.
 *
 * @param options - Optional settings including custom IdGenerator
 */
export function generateFingerprintId(options?: GenerateIdOptions): string {
  return generateId('FL', options);
}
