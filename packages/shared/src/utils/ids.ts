/**
 * Generate a unique ID.
 * Uses timestamp + random for simplicity (no external deps).
 * In production, consider using nanoid or uuid.
 */
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

/**
 * Generate a correlation ID for request tracing.
 */
export function generateCorrelationId(): string {
  return generateId('cor');
}

/**
 * Generate a run ID for validation runs.
 */
export function generateRunId(): string {
  return generateId('run');
}

/**
 * Generate a fingerprint ID.
 */
export function generateFingerprintId(): string {
  return generateId('FL');
}
