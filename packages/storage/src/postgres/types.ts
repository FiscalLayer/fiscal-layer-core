/**
 * PostgreSQL Job Repository Types
 *
 * Types for job persistence with zero-retention principles:
 * - Never store raw invoice content
 * - Never store PII
 * - Only store metadata, hashes, and sanitized summaries
 */

import type { EngineVersions, PolicyGateDecision } from '@fiscal-layer/contracts';

/**
 * Job status in the database.
 *
 * Status mapping from PolicyGate decisions:
 * - ALLOW -> 'completed'
 * - ALLOW_WITH_WARNINGS -> 'completed_with_warnings'
 * - BLOCK -> 'blocked'
 */
export type JobStatus =
  | 'pending'
  | 'processing'
  | 'completed'             // Validation passed (ALLOW)
  | 'completed_with_warnings' // Validation passed with warnings (ALLOW_WITH_WARNINGS)
  | 'blocked'               // Rejected by PolicyGate (BLOCK)
  | 'failed'                // Processing error (not policy rejection)
  | 'cancelled';

/**
 * Job priority levels (lower number = higher priority).
 */
export type JobPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Sanitized report summary (no PII, no raw content).
 */
export interface ReportSummary {
  status: string;
  score: number;
  diagnosticCounts: {
    errors: number;
    warnings: number;
    info: number;
    hints: number;
  };
  fingerprintId?: string;
  runId?: string;
  /**
   * PolicyGate decision (if PolicyGate was enabled).
   * Contains decision outcome and audit trail.
   */
  finalDecision?: PolicyGateDecision;
}

/**
 * Job record in the database.
 */
export interface JobRecord {
  id: string;
  status: JobStatus;
  priority: number;
  invoiceContentKey: string | null; // Cleared after processing
  format: string | null;
  options: Record<string, unknown>;
  tenantId: string | null;
  correlationId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  resultFingerprintId: string | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  // Phase C audit fields
  planHash: string | null;
  configSnapshotHash: string | null;
  engineVersions: EngineVersions | null;
  reportSummary: ReportSummary | null;
  errorSummary: string | null;
}

/**
 * Input for creating a new job.
 */
export interface CreateJobInput {
  id?: string | undefined;
  invoiceContentKey: string;
  format?: string | undefined;
  options?: Record<string, unknown> | undefined;
  priority?: JobPriority | undefined;
  tenantId?: string | undefined;
  correlationId?: string | undefined;
  maxRetries?: number | undefined;
}

/**
 * Input for updating job status.
 */
export interface UpdateJobStatusInput {
  status: JobStatus;
  startedAt?: Date;
  completedAt?: Date;
  retryCount?: number;
  errorMessage?: string;
}

/**
 * Input for storing job result (after validation completes).
 */
export interface StoreJobResultInput {
  /**
   * Final job status based on PolicyGate decision:
   * - 'completed': ALLOW
   * - 'completed_with_warnings': ALLOW_WITH_WARNINGS
   * - 'blocked': BLOCK
   * - 'failed': Processing error (not policy rejection)
   */
  status: 'completed' | 'completed_with_warnings' | 'blocked' | 'failed';
  completedAt: Date;
  resultFingerprintId?: string;
  planHash: string;
  configSnapshotHash: string;
  engineVersions: EngineVersions;
  reportSummary?: ReportSummary;
  errorSummary?: string;
}

/**
 * PostgreSQL connection configuration.
 */
export interface PostgresConfig {
  connectionString?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  database?: string | undefined;
  user?: string | undefined;
  password?: string | undefined;
  ssl?: boolean | { rejectUnauthorized: boolean } | undefined;
  poolSize?: number | undefined;
}

/**
 * Priority mapping for database storage.
 */
export const PRIORITY_MAP: Record<JobPriority, number> = {
  critical: 1,
  high: 5,
  normal: 10,
  low: 20,
} as const;

/**
 * Convert priority string to number.
 */
export function priorityToNumber(priority: JobPriority | number | undefined): number {
  if (typeof priority === 'number') return priority;
  if (priority === undefined) return PRIORITY_MAP.normal;
  return PRIORITY_MAP[priority];
}

/**
 * Convert priority number to string.
 */
export function numberToPriority(num: number): JobPriority {
  if (num <= 1) return 'critical';
  if (num <= 5) return 'high';
  if (num <= 10) return 'normal';
  return 'low';
}

