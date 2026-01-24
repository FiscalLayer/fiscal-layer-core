# @fiscal-layer/filters-core

> Core validation filters for FiscalLayer (OSS)

This package contains **offline validation filters** that do NOT make external API calls. Safe to audit, fork, and use in air-gapped environments.

## Open Source

This package is part of the FiscalLayer Open Core distribution under Apache 2.0 license.

## Package Boundary Architecture

FiscalLayer uses an **Open Core** model with clear package boundaries:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OSS Packages (Apache 2.0)                    │
├─────────────────────────────────────────────────────────────────────┤
│  @fiscal-layer/contracts    - Type definitions & interfaces        │
│  @fiscal-layer/kernel       - Pipeline engine                       │
│  @fiscal-layer/filters-core - Offline validation (this package)     │
│  @fiscal-layer/steps-parser - XML parsing & format detection        │
│  @fiscal-layer/steps-kosit  - KoSIT wrapper (local Docker/Java)     │
│  @fiscal-layer/privacy      - PII masking & safe logging            │
│  @fiscal-layer/shared       - Utilities (decimal math, hashing)     │
│  @fiscal-layer/storage      - TempStore abstraction                 │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ NO imports allowed
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Private Packages (Proprietary)                  │
├─────────────────────────────────────────────────────────────────────┤
│  @fiscal-layer/filters-live     - External APIs (VIES, ECB, Peppol) │
│  @fiscal-layer/billing          - Stripe integration                │
│  @fiscal-layer/storage-tenant   - Multi-tenant isolation            │
│  apps/api, apps/worker, apps/cli - Applications                     │
└─────────────────────────────────────────────────────────────────────┘
```

### OSS Boundary Rules

This package (and all OSS packages) **MUST NOT**:

1. ❌ Import from `@fiscal-layer/filters-live`, `billing`, `storage-tenant`
2. ❌ Make external HTTP/API calls
3. ❌ Read `process.env` directly (use dependency injection)
4. ❌ Include tenant-specific logic (`tenantId` references)
5. ❌ Log PII (use safe logger from `@fiscal-layer/shared`)

Run boundary check before commits:
```bash
pnpm check:oss-boundary
```

## Installation

```bash
pnpm add @fiscal-layer/filters-core
```

## Included Filters

| Filter | ID | Description | External API |
|--------|-----|-------------|--------------|
| Parser | `parser` | Parses invoice documents, detects format | No |
| KoSIT | `kosit` | Schema/Schematron validation (local Docker) | No |
| Semantic Risk | `semantic-risk` | Business logic analysis | No |

## Usage

```typescript
import {
  parserFilter,
  kositFilter,
  semanticRiskFilter,
  CORE_FILTER_IDS,
} from '@fiscal-layer/filters-core';

// Register with pipeline
registry.register(parserFilter);
registry.register(kositFilter);
registry.register(semanticRiskFilter);
```

## Filter Details

### Parser Filter

Parses invoice documents and detects format:
- XRechnung
- ZUGFeRD / Factur-X
- Peppol BIS
- UBL
- CII

```typescript
const result = await parserFilter.execute(context);
// result.metadata.detectedFormat = 'xrechnung'
// result.metadata.parsedInvoice = { ... }
```

### KoSIT Filter

Validates against German e-invoice standards using the [KoSIT validator](https://github.com/itplr-kosit/validator).

**Important**: This filter wraps `@fiscal-layer/steps-kosit` which runs KoSIT **locally** via Docker container or Java subprocess. No external API calls.

```typescript
const result = await kositFilter.execute(context);
// Validates against XRechnung/ZUGFeRD schemas and BR-DE rules
```

### Semantic Risk Filter

Analyzes invoice for business logic issues:
- Calculation verification (line items vs totals)
- Date anomaly detection (future dates, due < issue)
- High-value transaction flagging
- Round number detection

```typescript
const result = await semanticRiskFilter.execute(context);
// result.diagnostics may contain SEM-CALC-001, SEM-DATE-001, etc.
```

## What's NOT in This Package

The following filters require external API calls and are in `@fiscal-layer/filters-live` (private):

- **VIES** - EU VAT ID verification
- **ECB Rates** - Exchange rate validation
- **Peppol** - Participant lookup

## License

Apache License 2.0 - See [LICENSE](../../LICENSE)
