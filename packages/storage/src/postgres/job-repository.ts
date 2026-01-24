/**
 * PostgreSQL Job Repository
 *
 * Lightweight PostgreSQL-based job persistence with zero-retention principles:
 * - Never stores raw invoice content
 * - Never stores PII (uses masked summaries only)
 * - Clears invoice_content_key after processing
 *
 * Uses the 'pg' driver directly for minimal overhead.
 */

import type { Pool, PoolClient, QueryResult } from 'pg';
import type {
  JobRecord,
  CreateJobInput,
  UpdateJobStatusInput,
  StoreJobResultInput,
  PostgresConfig,
} from './types.js';
import { priorityToNumber } from './types.js';

/**
 * Row returned from PostgreSQL jobs table.
 */
interface JobRow {
  id: string;
  status: string;
  priority: number;
  invoice_content_key: string | null;
  format: string | null;
  options: Record<string, unknown> | null;
  tenant_id: string | null;
  correlation_id: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  result_fingerprint_id: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  plan_hash: string | null;
  config_snapshot_hash: string | null;
  engine_versions: Record<string, unknown> | null;
  report_summary: Record<string, unknown> | null;
  error_summary: string | null;
}

/**
 * Convert database row to JobRecord.
 */
function rowToJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    status: row.status as JobRecord['status'],
    priority: row.priority,
    invoiceContentKey: row.invoice_content_key,
    format: row.format,
    options: row.options ?? {},
    tenantId: row.tenant_id,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    resultFingerprintId: row.result_fingerprint_id,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    planHash: row.plan_hash,
    configSnapshotHash: row.config_snapshot_hash,
    engineVersions: row.engine_versions as JobRecord['engineVersions'],
    reportSummary: row.report_summary as JobRecord['reportSummary'],
    errorSummary: row.error_summary,
  };
}

/**
 * JobRepository provides CRUD operations for validation jobs.
 *
 * @example
 * ```typescript
 * import { Pool } from 'pg';
 * import { JobRepository } from '@fiscal-layer/storage';
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const repo = new JobRepository(pool);
 *
 * // Create a job
 * const job = await repo.createJob({
 *   invoiceContentKey: 'temp:invoice:abc123',
 *   tenantId: 'tenant-1',
 * });
 *
 * // Update status
 * await repo.updateJobStatus(job.id, {
 *   status: 'processing',
 *   startedAt: new Date(),
 * });
 *
 * // Store result
 * await repo.storeJobResult(job.id, {
 *   status: 'completed',
 *   completedAt: new Date(),
 *   planHash: 'sha256:abc...',
 *   configSnapshotHash: 'sha256:def...',
 *   engineVersions: { kernelVersion: '0.0.1' },
 *   reportSummary: { status: 'APPROVED', score: 95, ... },
 * });
 * ```
 */
export class JobRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create a new job in PENDING status.
   */
  async createJob(input: CreateJobInput): Promise<JobRecord> {
    const id = input.id ?? this.generateJobId();
    const priority = priorityToNumber(input.priority);

    const query = `
      INSERT INTO jobs (
        id, status, priority, invoice_content_key, format, options,
        tenant_id, correlation_id, max_retries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      id,
      'pending',
      priority,
      input.invoiceContentKey,
      input.format ?? null,
      JSON.stringify(input.options ?? {}),
      input.tenantId ?? null,
      input.correlationId ?? null,
      input.maxRetries ?? 3,
    ];

    const result = await this.pool.query<JobRow>(query, values);
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create job: no row returned');
    }
    return rowToJobRecord(row);
  }

  /**
   * Get a job by ID.
   */
  async getJobById(jobId: string): Promise<JobRecord | null> {
    const query = 'SELECT * FROM jobs WHERE id = $1';
    const result = await this.pool.query<JobRow>(query, [jobId]);
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return rowToJobRecord(row);
  }

  /**
   * Update job status and related fields.
   * Used by worker to mark job as PROCESSING or handle retries.
   */
  async updateJobStatus(jobId: string, input: UpdateJobStatusInput): Promise<JobRecord | null> {
    const setClauses: string[] = ['status = $2'];
    const values: unknown[] = [jobId, input.status];
    let paramIndex = 3;

    if (input.startedAt !== undefined) {
      setClauses.push(`started_at = $${paramIndex}`);
      values.push(input.startedAt);
      paramIndex++;
    }

    if (input.completedAt !== undefined) {
      setClauses.push(`completed_at = $${paramIndex}`);
      values.push(input.completedAt);
      paramIndex++;
    }

    if (input.retryCount !== undefined) {
      setClauses.push(`retry_count = $${paramIndex}`);
      values.push(input.retryCount);
      paramIndex++;
    }

    if (input.errorMessage !== undefined) {
      setClauses.push(`error_message = $${paramIndex}`);
      values.push(input.errorMessage);
      paramIndex++;
    }

    const query = `
      UPDATE jobs SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.pool.query<JobRow>(query, values);
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return rowToJobRecord(row);
  }

  /**
   * Store job result after validation completes.
   * This is the main method for recording audit trail data.
   *
   * IMPORTANT: This also clears invoice_content_key (zero-retention).
   */
  async storeJobResult(jobId: string, input: StoreJobResultInput): Promise<JobRecord | null> {
    const query = `
      UPDATE jobs SET
        status = $2,
        completed_at = $3,
        result_fingerprint_id = $4,
        plan_hash = $5,
        config_snapshot_hash = $6,
        engine_versions = $7,
        report_summary = $8,
        error_summary = $9,
        invoice_content_key = NULL  -- Zero-retention: clear after processing
      WHERE id = $1
      RETURNING *
    `;

    const values = [
      jobId,
      input.status,
      input.completedAt,
      input.resultFingerprintId ?? null,
      input.planHash,
      input.configSnapshotHash,
      JSON.stringify(input.engineVersions),
      input.reportSummary ? JSON.stringify(input.reportSummary) : null,
      input.errorSummary ?? null,
    ];

    const result = await this.pool.query<JobRow>(query, values);
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return rowToJobRecord(row);
  }

  /**
   * Get jobs by status (for worker polling or monitoring).
   */
  async getJobsByStatus(
    status: JobRecord['status'],
    limit = 100,
  ): Promise<JobRecord[]> {
    const query = `
      SELECT * FROM jobs
      WHERE status = $1
      ORDER BY priority ASC, created_at ASC
      LIMIT $2
    `;

    const result = await this.pool.query<JobRow>(query, [status, limit]);
    return result.rows.map(rowToJobRecord);
  }

  /**
   * Get jobs for a tenant.
   */
  async getJobsByTenant(
    tenantId: string,
    options?: { status?: JobRecord['status']; limit?: number },
  ): Promise<JobRecord[]> {
    let query = 'SELECT * FROM jobs WHERE tenant_id = $1';
    const values: unknown[] = [tenantId];

    if (options?.status) {
      query += ' AND status = $2';
      values.push(options.status);
    }

    query += ' ORDER BY created_at DESC';

    if (options?.limit) {
      query += ` LIMIT $${values.length + 1}`;
      values.push(options.limit);
    }

    const result = await this.pool.query<JobRow>(query, values);
    return result.rows.map(rowToJobRecord);
  }

  /**
   * Cancel a pending job.
   */
  async cancelJob(jobId: string): Promise<JobRecord | null> {
    const query = `
      UPDATE jobs SET
        status = 'cancelled',
        completed_at = NOW(),
        invoice_content_key = NULL  -- Zero-retention
      WHERE id = $1 AND status IN ('pending', 'processing')
      RETURNING *
    `;

    const result = await this.pool.query<JobRow>(query, [jobId]);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return rowToJobRecord(row);
  }

  /**
   * Increment retry count and optionally reset status.
   */
  async incrementRetry(jobId: string, errorMessage?: string): Promise<JobRecord | null> {
    const query = `
      UPDATE jobs SET
        retry_count = retry_count + 1,
        status = CASE
          WHEN retry_count + 1 >= max_retries THEN 'failed'
          ELSE 'pending'
        END,
        error_message = COALESCE($2, error_message),
        started_at = NULL
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.pool.query<JobRow>(query, [jobId, errorMessage ?? null]);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return rowToJobRecord(row);
  }

  /**
   * Claim a pending job for processing (atomic operation).
   * Returns the job if successfully claimed, null otherwise.
   */
  async claimJob(jobId: string, workerId?: string): Promise<JobRecord | null> {
    const query = `
      UPDATE jobs SET
        status = 'processing',
        started_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *
    `;

    const result = await this.pool.query<JobRow>(query, [jobId]);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return rowToJobRecord(row);
  }

  /**
   * Get queue statistics.
   */
  async getStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  }> {
    const query = `
      SELECT status, COUNT(*) as count
      FROM jobs
      GROUP BY status
    `;

    const result = await this.pool.query<{ status: string; count: string }>(query);

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const row of result.rows) {
      const status = row.status as keyof typeof stats;
      if (status in stats) {
        stats[status] = parseInt(row.count, 10);
      }
    }

    return stats;
  }

  /**
   * Clean up old completed/failed jobs.
   * Used for maintenance to prevent unbounded table growth.
   */
  async cleanupOldJobs(olderThanDays: number): Promise<number> {
    const query = `
      DELETE FROM jobs
      WHERE status IN ('completed', 'failed', 'cancelled')
        AND completed_at < NOW() - INTERVAL '1 day' * $1
    `;

    const result = await this.pool.query(query, [olderThanDays]);
    return result.rowCount ?? 0;
  }

  /**
   * Execute a function within a transaction.
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Close the pool connection.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  private generateJobId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `job_${timestamp}_${random}`;
  }
}

/**
 * Create a JobRepository from environment variables.
 */
export async function createJobRepositoryFromEnv(): Promise<JobRepository> {
  // Dynamic import to avoid loading pg when not needed
  const { Pool } = await import('pg');

  const config: PostgresConfig = {};

  if (process.env['DATABASE_URL']) {
    config.connectionString = process.env['DATABASE_URL'];
  } else {
    config.host = process.env['POSTGRES_HOST'] ?? 'localhost';
    config.port = parseInt(process.env['POSTGRES_PORT'] ?? '5432', 10);
    config.database = process.env['POSTGRES_DB'] ?? 'fiscallayer';
    config.user = process.env['POSTGRES_USER'] ?? 'fiscallayer';
    config.password = process.env['POSTGRES_PASSWORD'];
  }

  config.poolSize = parseInt(process.env['POSTGRES_POOL_SIZE'] ?? '10', 10);

  const pool = new Pool({
    connectionString: config.connectionString,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.poolSize,
  });

  return new JobRepository(pool);
}
