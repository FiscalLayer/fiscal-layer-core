import { createHash } from 'crypto';

/**
 * Canonical JSON stringification for deterministic hashing.
 * - Sorts object keys alphabetically
 * - Removes undefined values
 * - Uses consistent formatting (no extra whitespace)
 */
export function canonicalStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value: unknown) => {
    if (value === undefined) {
      return undefined; // Will be omitted
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Sort object keys
      const sorted: Record<string, unknown> = {};
      const valueObj = value as Record<string, unknown>;
      for (const key of Object.keys(valueObj).sort()) {
        if (valueObj[key] !== undefined) {
          sorted[key] = valueObj[key];
        }
      }
      return sorted;
    }
    return value;
  });
}

/**
 * Compute SHA-256 hash of canonically stringified data.
 * Returns hash in format: "sha256:<hex>"
 */
export function computeConfigHash(config: unknown): string {
  const canonical = canonicalStringify(config);
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Verify that a config matches a previously computed hash.
 */
export function verifyConfigHash(config: unknown, expectedHash: string): boolean {
  const actualHash = computeConfigHash(config);
  return actualHash === expectedHash;
}

/**
 * Extract hash algorithm and value from hash string.
 */
export function parseHash(hashString: string): { algorithm: string; value: string } | null {
  const match = /^(\w+):([a-fA-F0-9]+)$/.exec(hashString);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    algorithm: match[1],
    value: match[2],
  };
}

/**
 * Generate a short hash for display purposes (first 12 chars).
 */
export function shortHash(hashString: string): string {
  const parsed = parseHash(hashString);
  if (!parsed) {
    return hashString.slice(0, 12);
  }
  return `${parsed.algorithm}:${parsed.value.slice(0, 12)}`;
}
