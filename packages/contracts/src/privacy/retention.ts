/**
 * Retention period units
 */
export type RetentionUnit = 'seconds' | 'minutes' | 'hours' | 'days';

/**
 * Data classification levels
 */
export type DataClassification =
  | 'public' // Can be freely stored and shared
  | 'internal' // Internal use only
  | 'confidential' // Sensitive business data
  | 'restricted'; // PII, requires special handling

/**
 * Retention rule for specific data categories
 */
export interface RetentionRule {
  /**
   * Data category this rule applies to
   */
  category: string;

  /**
   * Data classification
   */
  classification: DataClassification;

  /**
   * Maximum retention period
   */
  maxRetention: {
    value: number;
    unit: RetentionUnit;
  };

  /**
   * Whether data should be encrypted at rest
   */
  encryptAtRest?: boolean;

  /**
   * Whether to require explicit consent for storage
   */
  requireConsent?: boolean;

  /**
   * Action to take after retention period
   */
  expirationAction: 'delete' | 'anonymize' | 'archive';
}

/**
 * RetentionPolicy defines how long different types of data can be kept.
 *
 * FiscalLayer follows a zero-retention policy by default:
 * - Original invoice content is never persisted
 * - Only compliance fingerprints and masked summaries are stored
 *
 * @example
 * ```typescript
 * const policy: RetentionPolicy = {
 *   id: 'zero-retention-v1',
 *   name: 'Zero Retention Policy',
 *   rules: [
 *     {
 *       category: 'raw-invoice',
 *       classification: 'restricted',
 *       maxRetention: { value: 60, unit: 'seconds' },
 *       expirationAction: 'delete',
 *     },
 *     {
 *       category: 'compliance-fingerprint',
 *       classification: 'internal',
 *       maxRetention: { value: 10, unit: 'years' },
 *       expirationAction: 'archive',
 *     },
 *   ],
 * };
 * ```
 */
export interface RetentionPolicy {
  /**
   * Policy identifier
   */
  id: string;

  /**
   * Human-readable name
   */
  name: string;

  /**
   * Policy description
   */
  description?: string;

  /**
   * Retention rules by category
   */
  rules: RetentionRule[];

  /**
   * Default rule for uncategorized data
   */
  defaultRule: RetentionRule;

  /**
   * Whether this is the default policy
   */
  isDefault?: boolean;

  /**
   * Policy version
   */
  version: string;

  /**
   * When this policy was created
   */
  createdAt: string;

  /**
   * Regulatory references (e.g., GDPR Article 5)
   */
  regulatoryReferences?: string[];
}

/**
 * Standard data categories for retention
 */
export const DATA_CATEGORIES = {
  /** Original invoice XML/JSON */
  RAW_INVOICE: 'raw-invoice',

  /** Parsed invoice data */
  PARSED_INVOICE: 'parsed-invoice',

  /** Validation diagnostics */
  DIAGNOSTICS: 'diagnostics',

  /** Compliance fingerprint */
  FINGERPRINT: 'compliance-fingerprint',

  /** Masked summary */
  MASKED_SUMMARY: 'masked-summary',

  /** Audit logs */
  AUDIT_LOG: 'audit-log',

  /** API request logs */
  REQUEST_LOG: 'request-log',
} as const;

export type DataCategory = (typeof DATA_CATEGORIES)[keyof typeof DATA_CATEGORIES];
