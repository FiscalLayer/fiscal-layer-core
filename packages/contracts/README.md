# @fiscal-layer/contracts

> TypeScript interfaces and types for FiscalLayer

This package contains all the TypeScript interfaces, types, and contracts that define the FiscalLayer system. It has **zero runtime dependencies** and is the foundation for all other packages.

## Installation

```bash
pnpm add @fiscal-layer/contracts
```

## Core Interfaces

### Pipeline & Filters

- `Filter` - A stateless validation step
- `Pipeline` - Orchestrates filter execution
- `PluginRegistry` - Manages filter registration
- `ValidationContext` - Carries state through the pipeline (with required `correlationId`)

### Validation

- `StepResult` - Result of a single filter execution
- `ValidationReport` - Complete validation output
- `ComplianceFingerprint` - Cryptographic attestation
- `PlanSnapshot` - Audit trail with configHash and filter versions

### Privacy

- `RetentionPolicy` - Document retention rules
- `MaskingPolicy` - PII masking configuration

### Execution

- `ExecutionPlan` - Configuration snapshot for reproducibility
- `ExecutionStep` - Single step in the plan
- `FailurePolicyConfig` - Failure handling with retry support
- `RetryConfig` - Exponential backoff with time budget

### Storage

- `TempStore` - Temporary storage with TTL
- `CleanupQueue` - Failed delete retry queue
- `SecureCleanupOptions` - Secure delete configuration

### Billing

- `BillingEvent` - Billable action record
- `StepUsage` - Step-level usage with `verifierName` and `billable` flag
- `UsageSummary` - Validation run usage summary
- `BillingUnitType` - Unit types: `validation`, `vies_lookup`, `ecb_rate`, etc.

## Usage

```typescript
import type {
  Filter,
  ValidationContext,
  StepResult,
  ValidationReport,
  FailurePolicyConfig,
  RetryConfig,
} from '@fiscal-layer/contracts';

// Implement a custom filter
const myFilter: Filter = {
  id: 'my-filter',
  name: 'My Filter',
  version: '1.0.0',

  async execute(context: ValidationContext): Promise<StepResult> {
    // correlationId is now REQUIRED
    console.log(`Processing ${context.correlationId}`);

    return {
      filterId: 'my-filter',
      status: 'passed',
      diagnostics: [],
      durationMs: 0,
    };
  },
};

// Configure retry with budget
const retryConfig: RetryConfig = {
  maxRetries: 2,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  totalBudgetMs: 2000, // Never spend more than 2s on retries
};
```

## Key Types

### Retry Configuration

```typescript
interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
  totalBudgetMs?: number; // Total time budget for all retries
  retryableStatusCodes?: number[]; // [408, 429, 500, 502, 503, 504]
  retryableErrorTypes?: string[]; // ['ETIMEDOUT', 'ECONNRESET', ...]
  jitterFactor?: number; // 0.1 = 10% jitter
}
```

### Billing Unit Types

```typescript
type BillingUnitType =
  | 'validation' // Internal validation
  | 'vies_lookup' // VIES VAT lookup (billable)
  | 'ecb_rate' // ECB rate fetch (billable)
  | 'peppol_lookup' // Peppol directory (billable)
  | 'fingerprint' // Fingerprint generation
  | 'storage_byte' // Storage bytes
  | 'custom';
```

## Design Principles

1. **Zero Dependencies** - This package has no runtime dependencies
2. **Type Safety** - Strict TypeScript with no `any` types
3. **Stability** - Interfaces follow semantic versioning strictly
4. **Documentation** - All types are thoroughly documented with JSDoc
5. **Audit Ready** - Types support full traceability (configHash, versions)
