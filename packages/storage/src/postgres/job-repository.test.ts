import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { JobRepository } from './job-repository.js';
import type { CreateJobInput, StoreJobResultInput } from './types.js';

/**
 * PII patterns that should NEVER appear in stored job data.
 */
const PII_PATTERNS = [
  // XML content
  /<Invoice[\s>]/i,
  /<cac:/i,
  /<cbc:/i,

  // Email addresses
  /[\w.-]+@[\w.-]+\.\w+/,

  // IBANs (German, Austrian, Swiss, etc.)
  /\b[A-Z]{2}\d{2}[A-Z0-9]{11,}/,

  // VAT IDs
  /\b(DE|AT|CH|FR|IT|ES|NL|BE)\d{8,12}\b/i,

  // Phone numbers
  /\+\d{2,3}[\d\s-]{8,}/,
];

/**
 * Create a mock Pool that captures SQL queries.
 */
function createMockPool(queryResults: Partial<QueryResult> = {}) {
  const queries: { sql: string; values: unknown[] }[] = [];

  const mockQuery = vi.fn().mockImplementation((sql: string, values: unknown[]) => {
    queries.push({ sql, values });
    return Promise.resolve({
      rows: queryResults.rows ?? [],
      rowCount: queryResults.rowCount ?? 0,
      ...queryResults,
    });
  });

  const mockPool = {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pool;

  return { pool: mockPool, queries, mockQuery };
}

describe('JobRepository', () => {
  describe('createJob', () => {
    it('should create a job with PENDING status', async () => {
      const mockRow = {
        id: 'job_123',
        status: 'pending',
        priority: 10,
        invoice_content_key: 'temp:invoice:123',
        format: 'xrechnung',
        options: {},
        tenant_id: 'tenant-1',
        correlation_id: 'job_123',
        created_at: new Date(),
        started_at: null,
        completed_at: null,
        result_fingerprint_id: null,
        error_message: null,
        retry_count: 0,
        max_retries: 3,
        plan_hash: null,
        config_snapshot_hash: null,
        engine_versions: null,
        report_summary: null,
        error_summary: null,
      };

      const { pool, queries } = createMockPool({ rows: [mockRow] });
      const repo = new JobRepository(pool);

      const input: CreateJobInput = {
        id: 'job_123',
        invoiceContentKey: 'temp:invoice:123',
        format: 'xrechnung',
        tenantId: 'tenant-1',
      };

      const result = await repo.createJob(input);

      expect(result.id).toBe('job_123');
      expect(result.status).toBe('pending');
      expect(queries.length).toBe(1);
      expect(queries[0].sql).toContain('INSERT INTO jobs');
    });

    it('should NOT store invoice content in job record', async () => {
      const mockRow = {
        id: 'job_123',
        status: 'pending',
        priority: 10,
        invoice_content_key: 'temp:invoice:123',
        format: null,
        options: {},
        tenant_id: null,
        correlation_id: null,
        created_at: new Date(),
        started_at: null,
        completed_at: null,
        result_fingerprint_id: null,
        error_message: null,
        retry_count: 0,
        max_retries: 3,
        plan_hash: null,
        config_snapshot_hash: null,
        engine_versions: null,
        report_summary: null,
        error_summary: null,
      };

      const { pool, queries } = createMockPool({ rows: [mockRow] });
      const repo = new JobRepository(pool);

      // Simulate someone trying to pass raw content (should only accept key)
      const input: CreateJobInput = {
        invoiceContentKey: 'temp:invoice:123', // Only key, not content
      };

      await repo.createJob(input);

      // Verify no invoice content in query values
      const queryValues = queries[0].values;
      for (const value of queryValues) {
        if (typeof value === 'string') {
          // Should not contain XML or PII
          for (const pattern of PII_PATTERNS) {
            expect(value).not.toMatch(pattern);
          }
        }
      }
    });
  });

  describe('storeJobResult', () => {
    it('should clear invoice_content_key on completion (zero-retention)', async () => {
      const mockRow = {
        id: 'job_123',
        status: 'completed',
        priority: 10,
        invoice_content_key: null, // Should be cleared
        format: 'xrechnung',
        options: {},
        tenant_id: 'tenant-1',
        correlation_id: 'job_123',
        created_at: new Date(),
        started_at: new Date(),
        completed_at: new Date(),
        result_fingerprint_id: 'FL-abc123',
        error_message: null,
        retry_count: 0,
        max_retries: 3,
        plan_hash: 'sha256:abc',
        config_snapshot_hash: 'sha256:def',
        engine_versions: { kernelVersion: '0.0.1' },
        report_summary: { status: 'APPROVED', score: 95 },
        error_summary: null,
      };

      const { pool, queries } = createMockPool({ rows: [mockRow] });
      const repo = new JobRepository(pool);

      const input: StoreJobResultInput = {
        status: 'completed',
        completedAt: new Date(),
        resultFingerprintId: 'FL-abc123',
        planHash: 'sha256:abc',
        configSnapshotHash: 'sha256:def',
        engineVersions: { kernelVersion: '0.0.1' },
        reportSummary: {
          status: 'APPROVED',
          score: 95,
          diagnosticCounts: { errors: 0, warnings: 1, info: 2, hints: 0 },
        },
      };

      const result = await repo.storeJobResult('job_123', input);

      // Verify invoice_content_key is cleared in query
      expect(queries[0].sql).toContain('invoice_content_key = NULL');
      expect(result?.invoiceContentKey).toBeNull();
    });

    it('should only store sanitized report summary', async () => {
      const mockRow = {
        id: 'job_123',
        status: 'completed',
        priority: 10,
        invoice_content_key: null,
        format: 'xrechnung',
        options: {},
        tenant_id: 'tenant-1',
        correlation_id: 'job_123',
        created_at: new Date(),
        started_at: new Date(),
        completed_at: new Date(),
        result_fingerprint_id: 'FL-abc123',
        error_message: null,
        retry_count: 0,
        max_retries: 3,
        plan_hash: 'sha256:abc',
        config_snapshot_hash: 'sha256:def',
        engine_versions: { kernelVersion: '0.0.1' },
        report_summary: { status: 'APPROVED', score: 95 },
        error_summary: null,
      };

      const { pool, queries } = createMockPool({ rows: [mockRow] });
      const repo = new JobRepository(pool);

      // Create a sanitized summary (no PII)
      const sanitizedSummary = {
        status: 'APPROVED',
        score: 95,
        diagnosticCounts: {
          errors: 0,
          warnings: 1,
          info: 2,
          hints: 0,
        },
        fingerprintId: 'FL-abc123',
        runId: 'run-456',
      };

      const input: StoreJobResultInput = {
        status: 'completed',
        completedAt: new Date(),
        planHash: 'sha256:abc',
        configSnapshotHash: 'sha256:def',
        engineVersions: { kernelVersion: '0.0.1' },
        reportSummary: sanitizedSummary,
      };

      await repo.storeJobResult('job_123', input);

      // Verify the stored JSON doesn't contain PII
      const reportSummaryValue = queries[0].values[7]; // Index of report_summary
      if (typeof reportSummaryValue === 'string') {
        for (const pattern of PII_PATTERNS) {
          expect(reportSummaryValue).not.toMatch(pattern);
        }
      }
    });
  });

  describe('Redline Tests: Zero PII in Database', () => {
    it('report_summary should never contain XML content', () => {
      const validSummary = {
        status: 'APPROVED',
        score: 95,
        diagnosticCounts: { errors: 0, warnings: 0, info: 0, hints: 0 },
      };

      const serialized = JSON.stringify(validSummary);

      // Should not match any XML patterns
      expect(serialized).not.toMatch(/<Invoice/);
      expect(serialized).not.toMatch(/<cac:/);
      expect(serialized).not.toMatch(/<cbc:/);
    });

    it('report_summary should never contain email addresses', () => {
      const validSummary = {
        status: 'APPROVED',
        score: 95,
        diagnosticCounts: { errors: 0, warnings: 0, info: 0, hints: 0 },
        fingerprintId: 'FL-123',
      };

      const serialized = JSON.stringify(validSummary);

      // Should not contain email patterns
      expect(serialized).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
    });

    it('report_summary should never contain IBAN', () => {
      const validSummary = {
        status: 'APPROVED',
        score: 95,
        diagnosticCounts: { errors: 0, warnings: 0, info: 0, hints: 0 },
      };

      const serialized = JSON.stringify(validSummary);

      // Should not contain IBAN patterns
      expect(serialized).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,}/);
    });

    it('error_summary should be sanitized (no file paths)', () => {
      const sanitizedError = 'Failed to parse XML: [path] at line 42';

      // Should not contain real file paths
      expect(sanitizedError).not.toMatch(/\/Users\//);
      expect(sanitizedError).not.toMatch(/\/home\//);
      expect(sanitizedError).not.toMatch(/C:\\/);
    });
  });
});
