import type { MaskingPolicy } from '@fiscal-layer/contracts';

/**
 * Create the default masking policy for FiscalLayer.
 */
export function createDefaultMaskingPolicy(): MaskingPolicy {
  return {
    id: 'default-masking-v1',
    name: 'Default Masking Policy',
    description: 'Standard masking policy for GDPR compliance',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    isDefault: true,

    rules: [
      // Completely redact contact information
      { fieldPath: '*.email', strategy: 'redact', priority: 10 },
      { fieldPath: '*.phone', strategy: 'redact', priority: 10 },
      { fieldPath: '*.fax', strategy: 'redact', priority: 10 },
      { fieldPath: '*.contactName', strategy: 'redact', priority: 10 },
      { fieldPath: '*.contactPerson', strategy: 'redact', priority: 10 },

      // Partially mask VAT IDs (show country code + last 2 digits)
      {
        fieldPath: '*.vatId',
        strategy: 'partial',
        config: { showStart: 2, showEnd: 2, maskChar: '*' },
        priority: 10,
      },

      // Partially mask bank details
      {
        fieldPath: '*.iban',
        strategy: 'partial',
        config: { showStart: 4, showEnd: 4, maskChar: '*' },
        priority: 10,
      },
      { fieldPath: '*.bic', strategy: 'redact', priority: 10 },
      { fieldPath: '*.bankAccount', strategy: 'redact', priority: 10 },

      // Hash addresses (allows comparison without exposing details)
      { fieldPath: '*.street', strategy: 'hash', priority: 5 },

      // Keep certain fields visible
      // (No rules = no masking)
    ],

    defaultPiiStrategy: 'redact',
    autoDetectPii: true,

    piiPatterns: [
      // Email pattern
      {
        name: 'email',
        pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
        strategy: 'redact',
      },
      // Phone pattern (German)
      {
        name: 'phone-de',
        pattern: '(\\+49|0)[0-9\\s/-]{8,}',
        strategy: 'redact',
      },
      // IBAN pattern
      {
        name: 'iban',
        pattern: '[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}([A-Z0-9]?){0,16}',
        strategy: 'partial',
      },
    ],
  };
}

/**
 * Create a strict masking policy (masks more fields).
 */
export function createStrictMaskingPolicy(): MaskingPolicy {
  const defaultPolicy = createDefaultMaskingPolicy();

  return {
    ...defaultPolicy,
    id: 'strict-masking-v1',
    name: 'Strict Masking Policy',
    description: 'Maximum privacy protection - masks most identifying information',
    isDefault: false,

    rules: [
      ...defaultPolicy.rules,

      // Additional strict rules for all common PII field names
      { fieldPath: '*.name', strategy: 'hash', priority: 20 },
      { fieldPath: '*.companyName', strategy: 'hash', priority: 20 },
      { fieldPath: '*.city', strategy: 'redact', priority: 20 },
      {
        fieldPath: '*.postalCode',
        strategy: 'partial',
        config: { showStart: 2, showEnd: 0 },
        priority: 20,
      },
      { fieldPath: '*.taxNumber', strategy: 'redact', priority: 20 },
      { fieldPath: '*.mobile', strategy: 'redact', priority: 20 },
      { fieldPath: '*.contactEmail', strategy: 'redact', priority: 20 },
      { fieldPath: '*.recipientEmail', strategy: 'redact', priority: 20 },
      { fieldPath: '*.sensitiveEmail', strategy: 'redact', priority: 20 },
      { fieldPath: '*.sensitivePhone', strategy: 'redact', priority: 20 },

      // Address fields
      { fieldPath: '*.address', strategy: 'redact', priority: 20 },
      { fieldPath: '*.address.street', strategy: 'redact', priority: 25 },
      { fieldPath: '*.address.streetName', strategy: 'redact', priority: 25 },
      { fieldPath: '*.streetName', strategy: 'redact', priority: 20 },
      { fieldPath: '*.additionalStreetName', strategy: 'redact', priority: 20 },
    ],

    piiPatterns: [
      ...(defaultPolicy.piiPatterns ?? []),
      // Address pattern
      {
        name: 'address',
        pattern:
          '\\d+\\s+[A-Za-z]+\\s+(Str|Street|Road|Ave|Avenue|Blvd|Way|Lane|Dr|Drive|Straße|Weg|Platz)',
        strategy: 'redact',
      },
    ],
  };
}
