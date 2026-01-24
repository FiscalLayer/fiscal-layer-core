# FiscalLayer Core

> Open-source validation engine for German/EU e-invoicing (XRechnung, ZUGFeRD, Peppol)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org/)

FiscalLayer Core is the open-source validation engine that powers [FiscalLayer](https://fiscallayer.dev). It provides a modular, auditable pipeline for validating electronic invoices against German and EU regulatory standards.

## Packages

| Package | Description |
|---------|-------------|
| `@fiscal-layer/contracts` | TypeScript interfaces, types, failure policies |
| `@fiscal-layer/kernel` | Pipeline orchestrator, fingerprint generation, event hooks |
| `@fiscal-layer/filters-core` | Parser, KoSIT validator, Semantic Risk analyzer |
| `@fiscal-layer/steps-kosit` | KoSIT validator wrapper with version tracking |
| `@fiscal-layer/privacy` | PII masking, retention policies |
| `@fiscal-layer/shared` | Safe logger, decimal arithmetic, canonical hashing |
| `@fiscal-layer/storage` | TempStore abstraction, SecureDeleteFilter |

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+
pnpm install
pnpm build

# Run tests
pnpm test
```

## Usage Example

```typescript
import { PipelineEngine } from '@fiscal-layer/kernel';
import { ParserFilter, KoSITFilter, SemanticRiskFilter } from '@fiscal-layer/filters-core';
import { MemoryTempStore } from '@fiscal-layer/storage';

// Create pipeline
const engine = new PipelineEngine({
  filters: [
    new ParserFilter(),
    new KoSITFilter(),
    new SemanticRiskFilter(),
  ],
  tempStore: new MemoryTempStore(),
});

// Validate an invoice
const result = await engine.execute({
  correlationId: 'inv-001',
  format: 'xrechnung',
  content: '<Invoice>...</Invoice>',
});

console.log(result.status); // 'valid' | 'invalid' | 'error'
console.log(result.diagnostics); // Validation messages
console.log(result.planSnapshot); // Audit trail
```

## Architecture

FiscalLayer uses a **Pipes & Filters** architecture where each filter is a stateless validation step:

```
┌─────────┬─────────┬──────────┬────────────┐
│ Parser  │  KoSIT  │ Semantic │ Fingerprint│
│         │Validator│   Risk   │            │
└─────────┴─────────┴──────────┴────────────┘
     ↓         ↓          ↓           ↓
  [Parse]  [Schema]   [Rules]    [Hash+Sign]
```

### Failure Policies

Each filter has a configurable failure policy:

- **`fail_fast`**: Stop pipeline immediately (schema errors)
- **`soft_fail`**: Log and continue (optional verifications)
- **`always_run`**: Execute regardless of prior failures (cleanup, fingerprint)

### Privacy by Design

- **Zero Retention**: Original documents deleted after validation
- **PII Scrubbing**: Automatic masking in logs (IBAN, email, VAT ID)
- **Compliance Fingerprint**: Cryptographic proof without storing content

## Key Features

### Plan Snapshot (Audit Trail)

Every validation includes a reproducible audit trail:

```typescript
planSnapshot: {
  id: 'plan-abc123',
  configHash: 'sha256:a1b2c3...', // Canonical config hash
  filterVersions: { kosit: '1.5.0' },
  capturedAt: '2024-01-15T10:30:00Z',
}
```

### Safe Logger

Auto-scrubs sensitive data from logs:

```typescript
import { createSafeLogger } from '@fiscal-layer/shared';

const logger = createSafeLogger({ correlationId: 'req-123' });
logger.info('Processing', { iban: 'DE89370400440532013000' });
// Output: {"correlationId":"req-123","iban":"[IBAN:REDACTED]"}
```

### Decimal Arithmetic

Financial precision with Banker's rounding:

```typescript
import { multiply } from '@fiscal-layer/shared';

const total = multiply('100.00', '1.19', {
  roundingMode: 'ROUND_HALF_EVEN'
});
```

## Project Structure

```
fiscal-layer-core/
├── packages/
│   ├── contracts/       # TypeScript interfaces
│   ├── kernel/          # Pipeline engine
│   ├── filters-core/    # Validation filters
│   ├── steps-kosit/     # KoSIT wrapper
│   ├── privacy/         # PII masking
│   ├── shared/          # Utilities
│   └── storage/         # TempStore
├── LICENSE              # Apache 2.0
└── tsconfig.base.json   # Shared TS config
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

### Running Single Package Tests

```bash
pnpm --filter @fiscal-layer/kernel test
```

## Relationship to FiscalLayer SaaS

This repository contains the **open-source core** of FiscalLayer. The commercial SaaS offering adds:

- External API integrations (VIES VAT, ECB rates, Peppol)
- Multi-tenant isolation
- Usage-based billing
- REST API with authentication
- Async job queue processing

For the full SaaS experience, visit [fiscallayer.dev](https://fiscallayer.dev).

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

### Code Style

- TypeScript strict mode
- ESLint + Prettier
- Conventional Commits

## License

Apache License 2.0 - See [LICENSE](./LICENSE) for details.

**Why Apache 2.0?**
- Explicit patent grants protect contributors and users
- Enterprise-friendly for German/EU compliance software
- Allows commercial use with attribution

---

*This repository is automatically synced from the FiscalLayer private monorepo.*
