/**
 * BullMQ Job Payload Definitions
 *
 * These types define the structure of job data for async processing.
 * Locale is included for i18n context propagation.
 */

/**
 * Supported locales for i18n
 */
export type SupportedLocale = 'de-DE' | 'en-GB' | 'zh-Hans';

/**
 * Base job payload with common fields
 */
export interface BaseJobPayload {
  /** Correlation ID for tracing */
  correlationId: string;

  /** Locale for response translation */
  locale: SupportedLocale;

  /** Job creation timestamp */
  createdAt: string;
}

/**
 * Validation job payload
 */
export interface ValidationJobPayload extends BaseJobPayload {
  /** Temp store key for invoice data */
  invoiceKey: string;

  /** Tenant ID for multi-tenant scenarios */
  tenantId?: string;

  /** Optional execution plan ID override */
  planId?: string;

  /** Optional validation options */
  options?: {
    /** Skip external API calls (VIES, ECB, etc.) */
    skipExternalCalls?: boolean;

    /** Include parsed invoice in response */
    includeParsedInvoice?: boolean;

    /** Custom metadata to attach to report */
    metadata?: Record<string, unknown>;
  };
}

/**
 * Job status for tracking progress
 */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * Job result summary (stored after completion)
 */
export interface JobResultSummary {
  /** Validation status */
  status: 'APPROVED' | 'APPROVED_WITH_WARNINGS' | 'REJECTED' | 'ERROR' | 'TIMEOUT';

  /** Compliance score (0-100) */
  score: number;

  /** Diagnostic counts */
  diagnosticCounts: {
    errors: number;
    warnings: number;
    info: number;
    hints: number;
  };

  /** Compliance fingerprint */
  fingerprint?: string;
}
