import type { RetentionPolicy, DATA_CATEGORIES } from '@fiscal-layer/contracts';

/**
 * Create the zero-retention policy (default for FiscalLayer).
 *
 * This policy ensures original invoice content is never persisted.
 */
export function createZeroRetentionPolicy(): RetentionPolicy {
  return {
    id: 'zero-retention-v1',
    name: 'Zero Retention Policy',
    description: 'Original documents are never persisted. Only compliance fingerprints and masked summaries are stored.',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    isDefault: true,
    regulatoryReferences: ['GDPR Article 5(1)(e)', 'DSGVO §5'],

    rules: [
      {
        category: 'raw-invoice',
        classification: 'restricted',
        maxRetention: { value: 60, unit: 'seconds' },
        encryptAtRest: true,
        expirationAction: 'delete',
      },
      {
        category: 'parsed-invoice',
        classification: 'confidential',
        maxRetention: { value: 5, unit: 'minutes' },
        encryptAtRest: true,
        expirationAction: 'delete',
      },
      {
        category: 'diagnostics',
        classification: 'internal',
        maxRetention: { value: 30, unit: 'days' },
        expirationAction: 'anonymize',
      },
      {
        category: 'compliance-fingerprint',
        classification: 'internal',
        maxRetention: { value: 3650, unit: 'days' }, // 10 years (GoBD)
        expirationAction: 'archive',
      },
      {
        category: 'masked-summary',
        classification: 'internal',
        maxRetention: { value: 3650, unit: 'days' }, // 10 years (GoBD)
        expirationAction: 'archive',
      },
      {
        category: 'audit-log',
        classification: 'internal',
        maxRetention: { value: 3650, unit: 'days' }, // 10 years (GoBD)
        expirationAction: 'archive',
      },
      {
        category: 'request-log',
        classification: 'internal',
        maxRetention: { value: 90, unit: 'days' },
        expirationAction: 'delete',
      },
    ],

    defaultRule: {
      category: 'unknown',
      classification: 'restricted',
      maxRetention: { value: 1, unit: 'hours' },
      encryptAtRest: true,
      expirationAction: 'delete',
    },
  };
}

/**
 * Create an audit-friendly retention policy.
 *
 * Keeps more data for audit purposes while still protecting PII.
 * Use this when historical traceability is more important.
 */
export function createAuditRetentionPolicy(): RetentionPolicy {
  return {
    id: 'audit-retention-v1',
    name: 'Audit Retention Policy',
    description: 'Extended retention for audit purposes. Original documents are still not persisted.',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    isDefault: false,
    regulatoryReferences: ['GoBD', 'AO §147'],

    rules: [
      {
        category: 'raw-invoice',
        classification: 'restricted',
        maxRetention: { value: 60, unit: 'seconds' }, // Still zero-retention
        encryptAtRest: true,
        expirationAction: 'delete',
      },
      {
        category: 'parsed-invoice',
        classification: 'confidential',
        maxRetention: { value: 30, unit: 'minutes' }, // Slightly longer for processing
        encryptAtRest: true,
        requireConsent: true,
        expirationAction: 'delete',
      },
      {
        category: 'diagnostics',
        classification: 'internal',
        maxRetention: { value: 365, unit: 'days' }, // 1 year
        expirationAction: 'archive',
      },
      {
        category: 'compliance-fingerprint',
        classification: 'internal',
        maxRetention: { value: 3650, unit: 'days' }, // 10 years
        expirationAction: 'archive',
      },
      {
        category: 'masked-summary',
        classification: 'internal',
        maxRetention: { value: 3650, unit: 'days' }, // 10 years
        expirationAction: 'archive',
      },
      {
        category: 'audit-log',
        classification: 'internal',
        maxRetention: { value: 3650, unit: 'days' }, // 10 years
        expirationAction: 'archive',
      },
      {
        category: 'request-log',
        classification: 'internal',
        maxRetention: { value: 365, unit: 'days' }, // 1 year
        expirationAction: 'anonymize',
      },
    ],

    defaultRule: {
      category: 'unknown',
      classification: 'restricted',
      maxRetention: { value: 24, unit: 'hours' },
      encryptAtRest: true,
      expirationAction: 'delete',
    },
  };
}
