# @fiscal-layer/steps-kosit

> KoSIT validator wrapper for FiscalLayer - XRechnung, ZUGFeRD, Peppol validation

This package provides integration with the [KoSIT validator](https://github.com/itplr-kosit/validator) for validating German e-invoices (XRechnung, ZUGFeRD) and Peppol BIS documents.

## Installation

```bash
pnpm add @fiscal-layer/steps-kosit
```

## Key Features

- **Multiple Runners**: Mock (testing), Docker (production), Native (future)
- **Version Tracking**: Full traceability with dictionary/scenario versions
- **BR-DE Rules**: German business rules validation (BR-DE-01 through BR-DE-21)
- **Filter Integration**: Ready-to-use filter for FiscalLayer pipeline

## Quick Start

```typescript
import { MockKositRunner, createKositFilter } from '@fiscal-layer/steps-kosit';

// Create a runner
const runner = new MockKositRunner({ debug: true });

// Validate an invoice
const result = await runner.validate(xmlContent, {
  format: 'xrechnung',
  includeRawOutput: true,
});

console.log(result.valid);           // true/false
console.log(result.items);           // Validation errors/warnings
console.log(result.versionInfo);     // Version tracking info
```

## Runners

### MockKositRunner (Development)

Simulates KoSIT validation with simplified BR-DE rules:

```typescript
import { MockKositRunner } from '@fiscal-layer/steps-kosit';

const runner = new MockKositRunner({
  timeoutMs: 30000,
  debug: false,
});

const result = await runner.validate(xml);

// Simulated rules: BR-DE-01, BR-DE-02, BR-DE-05, BR-DE-13, etc.
```

### DockerKositRunner (Production)

Runs the real KoSIT validator in a Docker container:

```typescript
import { DockerKositRunner, isDockerAvailable } from '@fiscal-layer/steps-kosit';

// Check if Docker is available
if (await isDockerAvailable()) {
  const runner = new DockerKositRunner({
    image: 'ghcr.io/itplr-kosit/validator:latest',
    scenarioDir: '/path/to/scenarios',
    timeoutMs: 60000,
    debug: true,
  });

  const result = await runner.validate(xml, {
    scenario: 'xrechnung',
  });
}
```

### Test Helpers

```typescript
import { createAlwaysValidRunner, createFixedErrorRunner } from '@fiscal-layer/steps-kosit';

// Always returns valid
const validRunner = createAlwaysValidRunner();

// Always returns specific errors
const errorRunner = createFixedErrorRunner([
  { ruleId: 'BR-DE-01', severity: 'error', message: 'Missing specification ID' },
]);
```

## Version Tracking

Every validation result includes detailed version information:

```typescript
interface KositVersionInfo {
  validatorVersion: string;      // "1.5.0"
  imageVersion?: string;         // "ghcr.io/itplr-kosit/validator:v1.5.0"
  dictionaryVersion: string;     // "xrechnung-schematron-3.0.2"
  dictionaryHash?: string;       // "sha256:abc123..."
  scenarioVersion?: string;      // "xrechnung_3.0.2_2024-01-15"
  rulesPublishedAt?: string;     // "2024-01-15T00:00:00Z"
  buildTimestamp?: string;       // Build time of validator
}

const result = await runner.validate(xml);
console.log(result.versionInfo.dictionaryVersion);
// "xrechnung-schematron-3.0.2"
```

**Why is this important?**

> When BR-DE-18 fails, you need to know which version of the schematron rules
> was applied. Rule interpretations change between versions.

## KoSIT Filter

Ready-to-use filter for the FiscalLayer pipeline:

```typescript
import { createKositFilter } from '@fiscal-layer/steps-kosit';
import { MockKositRunner } from '@fiscal-layer/steps-kosit';

const kositFilter = createKositFilter({
  runner: new MockKositRunner(),
  failurePolicy: 'fail_fast',  // Stop pipeline on schema errors
});

// Register with pipeline
registry.register(kositFilter);
```

### Filter Configuration

```typescript
interface KositFilterConfig {
  runner: KositRunner;
  failurePolicy?: FailurePolicy;  // 'fail_fast' (default)
  format?: 'xrechnung' | 'zugferd' | 'peppol' | 'ubl' | 'cii';
  scenario?: string;
  includeRawOutput?: boolean;
}
```

## Validation Result

```typescript
interface KositValidationResult {
  valid: boolean;              // Overall validation status
  schemaValid: boolean;        // XSD schema validation passed
  schematronValid: boolean;    // Schematron rules passed
  items: KositValidationItem[];  // All errors/warnings/info
  summary: {
    errors: number;
    warnings: number;
    information: number;
  };
  profile?: string;            // Detected profile ('xrechnung-3.0', 'zugferd-2.1')
  versionInfo: KositVersionInfo;  // Full version tracking
  scenarioName?: string;
  durationMs: number;
  rawOutput?: string;          // Raw validator output (if requested)
}

interface KositValidationItem {
  ruleId: string;              // 'BR-DE-01', 'BR-01', etc.
  severity: 'error' | 'warning' | 'information';
  message: string;
  location?: string;           // XPath location
  line?: number;
  column?: number;
  test?: string;               // Failed test expression
  source?: string;             // Schema/schematron file
}
```

## Convert to Diagnostics

```typescript
import { kositItemsToDiagnostics } from '@fiscal-layer/steps-kosit';

const diagnostics = kositItemsToDiagnostics(result.items, 'kosit');
// Returns Diagnostic[] compatible with ValidationReport
```

## Supported Rules (Mock)

The MockKositRunner simulates these German business rules:

| Rule | Description |
|------|-------------|
| BR-DE-01 | Specification identifier required |
| BR-DE-02 | Seller electronic address |
| BR-DE-03 | Buyer electronic address |
| BR-DE-05 | Payment means required |
| BR-DE-06 | Payment account for credit transfer |
| BR-DE-09 | Tax representative name |
| BR-DE-13 | Valid invoice type code |
| BR-DE-17 | Payable amount required |
| BR-DE-18 | German VAT ID |
| BR-DE-21 | Due date for payment terms |

## Exports

```typescript
// Types
export * from './types.js';

// Runners
export { MockKositRunner, createAlwaysValidRunner, createFixedErrorRunner } from './mock-kosit-runner.js';
export { DockerKositRunner, parseKositReport, isDockerAvailable } from './docker-kosit-runner.js';
export type { DockerKositRunnerConfig } from './docker-kosit-runner.js';

// Filter
export { createKositFilter } from './kosit-filter.js';
export type { KositFilterConfig } from './kosit-filter.js';

// Type exports
export type {
  KositRunner,
  KositRunnerConfig,
  KositValidateOptions,
  KositValidationResult,
  KositValidationItem,
  KositVersionInfo,
  KositSeverity,
} from './types.js';
```

## Docker Setup

To use the DockerKositRunner in production:

```yaml
# docker-compose.yml
services:
  kosit:
    image: ghcr.io/itplr-kosit/validator:latest
    ports:
      - '8080:8080'
    volumes:
      - ./scenarios:/scenarios:ro
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8080/health']
```

```typescript
const runner = new DockerKositRunner({
  baseUrl: 'http://localhost:8080',
  // or use Docker directly:
  image: 'ghcr.io/itplr-kosit/validator:latest',
});
```
