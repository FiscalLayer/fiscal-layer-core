/**
 * Severity levels for diagnostics
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Category of the diagnostic
 */
export type DiagnosticCategory =
  | 'schema' // XML/JSON schema validation
  | 'business-rule' // Schematron / business logic
  | 'live-verification' // External API verification
  | 'semantic' // Semantic/risk analysis
  | 'format' // Format detection/parsing
  | 'internal'; // Internal errors

/**
 * A single diagnostic message from validation
 */
export interface Diagnostic {
  /**
   * Unique code for this diagnostic type
   * Format: {CATEGORY}-{RULE_ID}
   * Examples: 'BR-DE-01', 'VIES-001', 'SEM-AMOUNT-MISMATCH'
   */
  code: string;

  /**
   * Human-readable message
   */
  message: string;

  /**
   * Localized message (if available)
   */
  localizedMessage?: string;

  /**
   * Severity level
   */
  severity: DiagnosticSeverity;

  /**
   * Category of the diagnostic
   */
  category: DiagnosticCategory;

  /**
   * Source filter that generated this diagnostic
   */
  source: string;

  /**
   * Location in the source document (XPath or JSON path)
   */
  location?: string;

  /**
   * Additional context (e.g., expected vs actual values)
   */
  context?: Record<string, unknown>;

  /**
   * Suggested fix (if applicable)
   */
  suggestion?: string;

  /**
   * Link to documentation about this rule
   */
  documentationUrl?: string;
}

/**
 * Localization key mapping for diagnostic codes
 */
export interface DiagnosticLocalization {
  /** Diagnostic code */
  code: string;

  /** Locale code (e.g., 'de-DE', 'en-US') */
  locale: string;

  /** Localized message template */
  message: string;

  /** Localized suggestion template */
  suggestion?: string;
}
