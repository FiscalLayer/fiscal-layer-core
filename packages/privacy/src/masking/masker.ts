import type { MaskingPolicy, MaskingRule, MaskingResult, MaskingStrategy } from '@fiscal-layer/contracts';

/**
 * DataMasker applies masking rules to objects containing sensitive data.
 */
export class DataMasker {
  private readonly policy: MaskingPolicy;

  constructor(policy: MaskingPolicy) {
    this.policy = policy;
  }

  /**
   * Mask sensitive data in an object according to the policy.
   */
  mask<T extends object>(data: T): MaskingResult<T> {
    const maskedFields: string[] = [];
    const stats = {
      totalFields: 0,
      maskedCount: 0,
      byStrategy: {} as Record<MaskingStrategy, number>,
    };

    const masked = this.maskObject(data, '', maskedFields, stats);

    return {
      data: masked as T,
      maskedFields,
      stats,
    };
  }

  private maskObject(
    obj: unknown,
    path: string,
    maskedFields: string[],
    stats: { totalFields: number; maskedCount: number; byStrategy: Record<string, number> },
  ): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item, index) =>
        this.maskObject(item, `${path}[${index}]`, maskedFields, stats),
      );
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = path ? `${path}.${key}` : key;
      stats.totalFields++;

      const rule = this.findMatchingRule(fieldPath);

      if (rule && typeof value === 'string') {
        const maskedValue = this.applyMasking(value, rule);
        result[key] = maskedValue;
        maskedFields.push(fieldPath);
        stats.maskedCount++;
        stats.byStrategy[rule.strategy] = (stats.byStrategy[rule.strategy] ?? 0) + 1;
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.maskObject(value, fieldPath, maskedFields, stats);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private findMatchingRule(fieldPath: string): MaskingRule | undefined {
    // Sort by priority (higher priority = applied later, takes precedence)
    const sortedRules = [...this.policy.rules].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
    );

    for (const rule of sortedRules) {
      if (this.matchesPattern(fieldPath, rule.fieldPath)) {
        return rule;
      }
    }

    return undefined;
  }

  private matchesPattern(fieldPath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*\*/g, '{{GLOBSTAR}}') // Temp placeholder for **
      .replace(/\*/g, '[^.]+') // * matches single path segment
      .replace(/\{\{GLOBSTAR\}\}/g, '.*'); // ** matches any path

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(fieldPath);
  }

  private applyMasking(value: string, rule: MaskingRule): string {
    switch (rule.strategy) {
      case 'redact':
        return '[REDACTED]';

      case 'partial': {
        const config = rule.config as { showStart?: number; showEnd?: number; maskChar?: string } | undefined;
        const showStart = config?.showStart ?? 2;
        const showEnd = config?.showEnd ?? 2;
        const maskChar = config?.maskChar ?? '*';

        if (value.length <= showStart + showEnd) {
          return maskChar.repeat(value.length);
        }

        const start = value.slice(0, showStart);
        const end = value.slice(-showEnd);
        const middle = maskChar.repeat(Math.min(value.length - showStart - showEnd, 5));
        return `${start}${middle}${end}`;
      }

      case 'hash': {
        // Simple hash for demonstration
        let hash = 0;
        for (let i = 0; i < value.length; i++) {
          hash = (hash << 5) - hash + value.charCodeAt(i);
          hash = hash & hash;
        }
        return `hash:${Math.abs(hash).toString(16).slice(0, 8)}`;
      }

      case 'truncate': {
        const config = rule.config as { maxLength?: number; suffix?: string } | undefined;
        const maxLength = config?.maxLength ?? 10;
        const suffix = config?.suffix ?? '...';

        if (value.length <= maxLength) {
          return value;
        }
        return value.slice(0, maxLength - suffix.length) + suffix;
      }

      case 'tokenize':
        // Use crypto.randomUUID for cryptographically secure token generation
        // Slice to get a shorter, readable token while maintaining uniqueness
        return `[TOKEN:${globalThis.crypto.randomUUID().slice(0, 8)}]`;

      case 'generalize':
        // Simplified generalization
        return '[GENERALIZED]';

      default:
        return value;
    }
  }
}
