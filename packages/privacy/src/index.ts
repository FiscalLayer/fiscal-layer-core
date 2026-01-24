/**
 * @fiscal-layer/privacy
 *
 * Privacy and data protection utilities for FiscalLayer.
 *
 * @packageDocumentation
 */

export { DataMasker } from './masking/masker.js';
export { createDefaultMaskingPolicy, createStrictMaskingPolicy } from './masking/policies.js';

export { createZeroRetentionPolicy, createAuditRetentionPolicy } from './retention/policies.js';
export { RetentionEnforcer } from './retention/enforcer.js';

// Re-export types
export type { MaskingPolicy, MaskingRule, RetentionPolicy, RetentionRule } from '@fiscal-layer/contracts';
