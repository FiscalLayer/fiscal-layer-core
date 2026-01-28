# @fiscal-layer/kernel

> Core pipeline engine for FiscalLayer - zero external runtime dependencies

This package contains the core pipeline orchestrator that executes validation filters. It is designed to be runtime-agnostic and can be used in any JavaScript environment (Node.js, Deno, browsers, serverless).

## OSS Boundary Constraints (CRITICAL)

**Kernel MUST NOT interpret diagnostics.**

Kernel is the orchestration layer. It coordinates filter execution, collects results, and produces execution summaries. It does NOT make compliance decisions.

| Kernel Outputs | NOT Kernel's Job |
|----------------|------------------|
| `reportState` (execution lifecycle) | ALLOW / BLOCK / APPROVED / REJECTED |
| `diagnostics` (collected from steps) | Severity interpretation |
| `execution` (ran/skipped/errored) | Risk scoring decisions |
| `timing` (performance metrics) | Policy thresholds |

**Any aggregation beyond counting belongs to `@fiscal-layer/decision-engine`.**

### What This Means in Practice

```typescript
// CORRECT: Kernel outputs execution facts
report.reportState    // 'COMPLETE' | 'PARTIAL' | 'EMPTY'
report.steps          // array of StepResult with diagnostics
report.diagnostics    // flattened list of all diagnostics

// WRONG: Kernel should NEVER output these
report.status         // ❌ 'APPROVED' / 'REJECTED' - decision logic
report.decision       // ❌ 'ALLOW' / 'BLOCK' - policy judgment
report.riskLevel      // ❌ 'HIGH' / 'MEDIUM' / 'LOW' - interpretation
```

**All decision-related logic lives in the Private layer (`@fiscal-layer/decision-engine`).**

## Installation

```bash
pnpm add @fiscal-layer/kernel
```

## Key Features

- **Zero External Dependencies**: Only depends on `@fiscal-layer/contracts`
- **Runtime Agnostic**: Works in Node.js, Deno, browsers, serverless
- **Parallel Execution**: Supports concurrent filter execution
- **Configurable Pipeline**: Filters can be enabled/disabled/reordered
- **Execution Plans**: Reproducible validation with versioned configurations
- **Billing Emitters**: Step-level usage tracking for billing integration
- **Plan Snapshots**: Audit trail with canonical configHash

## Usage

```typescript
import {
  Pipeline,
  PluginRegistryImpl,
  createDefaultPlan,
  createFingerprint,
  calculateUsageSummary,
  MemoryBillingEmitter,
} from '@fiscal-layer/kernel';
import { parserFilter, kositFilter } from '@fiscal-layer/filters';

// Create and populate registry
const registry = new PluginRegistryImpl();
registry.register(parserFilter);
registry.register(kositFilter);

// Create billing emitter
const billingEmitter = new MemoryBillingEmitter();

// Create pipeline
const pipeline = new Pipeline({
  registry,
  defaultPlan: createDefaultPlan(),
  billingEmitter,
});

// Execute validation
const report = await pipeline.execute({
  invoice: {
    content: '<Invoice>...</Invoice>',
    contentType: 'application/xml',
  },
  options: {
    locale: 'de-DE',
    correlationId: 'req-123',  // Required
  },
});

console.log(report.status);           // 'APPROVED' | 'REJECTED' | ...
console.log(report.fingerprint.id);   // 'FL-abc123...'
console.log(report.planSnapshot.configHash);  // 'sha256:...'

// Get usage summary for billing
const events = billingEmitter.getEvents();
const usage = calculateUsageSummary(events, report);
console.log(usage.totalBillableUnits);  // 2 (e.g., VIES + ECB)
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Pipeline                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Context   │  │  Executor   │  │  Reporter   │ │
│  │   Builder   │  │             │  │             │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────┐    ┌─────────────┐   ┌─────────────┐
│  Registry   │    │   Filters   │   │ Fingerprint │
└─────────────┘    └─────────────┘   └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  Billing    │
                   │  Emitter    │
                   └─────────────┘
```

## Exported Components

### Pipeline

- `Pipeline` - Main pipeline orchestrator
- `PluginRegistryImpl` - Filter registration and lookup
- `ValidationContextImpl` - Validation context implementation

### Plan Building

- `createDefaultPlan()` - Create a default execution plan
- `createPlanBuilder()` - Fluent builder for custom plans
- `calculateConfigHash()` - Calculate canonical plan config hash

### Fingerprint

- `generateFingerprintId()` - Generate unique fingerprint IDs (`FL-xxx`)
- `createFingerprint()` - Create compliance fingerprint from report

### Scoring

- `calculateScore()` - Calculate validation score (0-100)

### Billing

- `MemoryBillingEmitter` - In-memory billing event collector
- `ConsoleBillingEmitter` - Log billing events to console
- `CompositeBillingEmitter` - Combine multiple emitters
- `NoopBillingEmitter` - No-op emitter for testing
- `createFilterBillingEvent()` - Create filter execution event
- `createExternalApiBillingEvent()` - Create external API call event
- `calculateUsageSummary()` - Aggregate events into usage summary

## Billing Integration

```typescript
import {
  MemoryBillingEmitter,
  calculateUsageSummary,
  createFilterBillingEvent,
} from '@fiscal-layer/kernel';

const emitter = new MemoryBillingEmitter();

// Events are emitted during pipeline execution
// After execution:
const events = emitter.getEvents();
const usage = calculateUsageSummary(events, report);

// Usage contains step-level attribution
usage.steps.forEach(step => {
  console.log(`${step.verifierName}: ${step.units} ${step.unitType} (billable: ${step.billable})`);
});
// VIES VAT Validator: 1 vies_lookup (billable: true)
// KoSIT Schema Validator: 1 validation (billable: false)
```
