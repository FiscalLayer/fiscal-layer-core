/**
 * Masking strategy types
 */
export type MaskingStrategy =
  | 'redact' // Complete removal (replace with '[REDACTED]')
  | 'partial' // Partial masking (e.g., 'DE123***89')
  | 'hash' // One-way hash (e.g., 'sha256:abc...')
  | 'tokenize' // Replace with reversible token
  | 'truncate' // Truncate to N characters
  | 'generalize'; // Generalize (e.g., exact age -> age range)

/**
 * Configuration for partial masking
 */
export interface PartialMaskConfig {
  /** Characters to show at start */
  showStart?: number;

  /** Characters to show at end */
  showEnd?: number;

  /** Character to use for masking */
  maskChar?: string;
}

/**
 * Configuration for truncation
 */
export interface TruncateConfig {
  /** Maximum length */
  maxLength: number;

  /** Suffix to add (e.g., '...') */
  suffix?: string;
}

/**
 * Configuration for generalization
 */
export interface GeneralizeConfig {
  /** Generalization type */
  type: 'range' | 'category' | 'custom';

  /** Range boundaries (for numeric) */
  ranges?: { min: number; max: number; label: string }[];

  /** Category mappings */
  categories?: Record<string, string>;
}

/**
 * Field masking rule
 */
export interface MaskingRule {
  /**
   * Field path (dot notation, e.g., 'buyer.email')
   * Supports wildcards: 'buyer.*', '*.email'
   */
  fieldPath: string;

  /**
   * Masking strategy to apply
   */
  strategy: MaskingStrategy;

  /**
   * Strategy-specific configuration
   */
  config?: PartialMaskConfig | TruncateConfig | GeneralizeConfig;

  /**
   * Condition for applying this rule
   */
  condition?: {
    /** Only apply if field matches pattern */
    pattern?: string;

    /** Only apply if data classification matches */
    classification?: string;
  };

  /**
   * Priority (higher = applied later, can override)
   */
  priority?: number;
}

/**
 * MaskingPolicy defines how sensitive data should be masked.
 *
 * This is applied to all output (reports, logs, storage) to ensure
 * PII and sensitive business data is properly protected.
 *
 * @example
 * ```typescript
 * const policy: MaskingPolicy = {
 *   id: 'default-masking-v1',
 *   name: 'Default Masking Policy',
 *   rules: [
 *     // Completely redact email and phone
 *     { fieldPath: '*.email', strategy: 'redact' },
 *     { fieldPath: '*.phone', strategy: 'redact' },
 *
 *     // Partially mask VAT IDs
 *     {
 *       fieldPath: '*.vatId',
 *       strategy: 'partial',
 *       config: { showStart: 2, showEnd: 2, maskChar: '*' }
 *     },
 *
 *     // Hash person names
 *     { fieldPath: '*.contactName', strategy: 'hash' },
 *   ],
 * };
 * ```
 */
export interface MaskingPolicy {
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
   * Masking rules
   */
  rules: MaskingRule[];

  /**
   * Default strategy for unmatched PII fields
   */
  defaultPiiStrategy?: MaskingStrategy;

  /**
   * Whether to detect and mask PII automatically
   */
  autoDetectPii?: boolean;

  /**
   * PII detection patterns (regex)
   */
  piiPatterns?: {
    name: string;
    pattern: string;
    strategy: MaskingStrategy;
  }[];

  /**
   * Policy version
   */
  version: string;

  /**
   * When this policy was created
   */
  createdAt: string;

  /**
   * Whether this is the default policy
   */
  isDefault?: boolean;
}

/**
 * Result of masking operation
 */
export interface MaskingResult<T> {
  /** Masked data */
  data: T;

  /** Fields that were masked */
  maskedFields: string[];

  /** Masking statistics */
  stats: {
    totalFields: number;
    maskedCount: number;
    byStrategy: Record<MaskingStrategy, number>;
  };
}

/**
 * Common PII field patterns
 */
export const PII_FIELDS = {
  EMAIL: '*.email',
  PHONE: '*.phone',
  FAX: '*.fax',
  CONTACT_NAME: '*.contactName',
  CONTACT_PERSON: '*.contactPerson',
  BANK_ACCOUNT: '*.bankAccount',
  IBAN: '*.iban',
  BIC: '*.bic',
} as const;
