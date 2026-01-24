import type { RetentionPolicy, RetentionRule, DataCategory } from '@fiscal-layer/contracts';

/**
 * RetentionEnforcer checks and enforces data retention policies.
 */
export class RetentionEnforcer {
  private readonly policy: RetentionPolicy;

  constructor(policy: RetentionPolicy) {
    this.policy = policy;
  }

  /**
   * Get the retention rule for a specific data category.
   */
  getRule(category: string): RetentionRule {
    const rule = this.policy.rules.find((r) => r.category === category);
    return rule ?? this.policy.defaultRule;
  }

  /**
   * Check if data should be retained based on category and age.
   */
  shouldRetain(category: string, createdAt: Date): boolean {
    const rule = this.getRule(category);
    const maxAgeMs = this.toMilliseconds(rule.maxRetention.value, rule.maxRetention.unit);
    const ageMs = Date.now() - createdAt.getTime();

    return ageMs < maxAgeMs;
  }

  /**
   * Get the expiration date for data in a category.
   */
  getExpirationDate(category: string, createdAt: Date): Date {
    const rule = this.getRule(category);
    const maxAgeMs = this.toMilliseconds(rule.maxRetention.value, rule.maxRetention.unit);

    return new Date(createdAt.getTime() + maxAgeMs);
  }

  /**
   * Check if data requires encryption at rest.
   */
  requiresEncryption(category: string): boolean {
    const rule = this.getRule(category);
    return rule.encryptAtRest ?? false;
  }

  /**
   * Check if data requires explicit consent.
   */
  requiresConsent(category: string): boolean {
    const rule = this.getRule(category);
    return rule.requireConsent ?? false;
  }

  /**
   * Get the action to take when data expires.
   */
  getExpirationAction(category: string): 'delete' | 'anonymize' | 'archive' {
    const rule = this.getRule(category);
    return rule.expirationAction;
  }

  /**
   * Get a summary of retention rules.
   */
  getSummary(): Array<{
    category: string;
    retention: string;
    action: string;
    encrypted: boolean;
  }> {
    return this.policy.rules.map((rule) => ({
      category: rule.category,
      retention: `${rule.maxRetention.value} ${rule.maxRetention.unit}`,
      action: rule.expirationAction,
      encrypted: rule.encryptAtRest ?? false,
    }));
  }

  private toMilliseconds(value: number, unit: RetentionRule['maxRetention']['unit']): number {
    switch (unit) {
      case 'seconds':
        return value * 1000;
      case 'minutes':
        return value * 60 * 1000;
      case 'hours':
        return value * 60 * 60 * 1000;
      case 'days':
        return value * 24 * 60 * 60 * 1000;
      default:
        return value * 1000;
    }
  }
}
