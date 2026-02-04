# @fiscal-layer/steps-kosit

> KoSIT validator wrapper for FiscalLayer - XRechnung, ZUGFeRD, Peppol validation

This package provides integration with the [KoSIT validator](https://github.com/itplr-kosit/validator) for validating German e-invoices (XRechnung, ZUGFeRD) and Peppol BIS documents.

## Installation

```bash
pnpm add @fiscal-layer/steps-kosit
```

## Key Features

- **Dual-Mode Docker**: HTTP daemon (primary) + CLI fallback with auto-switching
- **Zero-Retention**: Temp files always deleted in `finally` blocks
- **PII Sanitization**: Sensitive data automatically redacted from outputs
- **Version Tracking**: Full traceability with dictionary/scenario versions
- **BR-DE Rules**: German business rules validation (BR-DE-01 through BR-DE-21)

## Quick Start

```typescript
import { createKositFilter, DockerKositRunner } from '@fiscal-layer/steps-kosit';

// Using filter (recommended)
const filter = createKositFilter({
  runnerType: 'docker',
  mode: 'auto', // Tries daemon first, falls back to CLI
});

// Or use runner directly
const runner = new DockerKositRunner({
  mode: 'auto',
  daemonUrl: 'http://localhost:8080',
});

const result = await runner.validate(xmlContent);
console.log(result.valid);
console.log(result.items);
```

## Docker Modes

### Daemon Mode (Primary)

Uses a running KoSIT HTTP service for validation:

```bash
# Start the daemon
docker run -d -p 8080:8080 flx235/xr-validator-service:302
```

```typescript
const runner = new DockerKositRunner({
  mode: 'daemon',
  daemonUrl: 'http://localhost:8080',
});
```

### CLI Mode (Fallback)

Uses `docker run` with volume mounts for one-off validations:

```typescript
const runner = new DockerKositRunner({
  mode: 'cli',
  cliImage: 'fiscallayer/kosit-cli:latest',
  memoryLimit: '512m',
  cpuLimit: '1.0',
});
```

### Auto Mode (Recommended)

Automatically switches between daemon and CLI:

```typescript
const runner = new DockerKositRunner({
  mode: 'auto', // Default
  daemonUrl: 'http://localhost:8080',
});

// Check if fallback occurred
const fallbackEvent = runner.getLastFallbackEvent();
if (fallbackEvent) {
  console.log(`Fallback to CLI: ${fallbackEvent.reason}`);
}
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

Runs the real KoSIT validator via Docker:

```typescript
import { DockerKositRunner, isDockerAvailable, checkDaemonHealth } from '@fiscal-layer/steps-kosit';

// Check availability
if (await isDockerAvailable()) {
  const daemonUp = await checkDaemonHealth('http://localhost:8080');

  const runner = new DockerKositRunner({
    mode: daemonUp ? 'daemon' : 'cli',
    daemonUrl: 'http://localhost:8080',
    timeoutMs: 30000,
  });

  const result = await runner.validate(xml);
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
  validatorVersion: string; // "1.5.0"
  imageVersion?: string; // "flx235/xr-validator-service:302"
  dictionaryVersion: string; // "xrechnung-schematron-3.0.2"
  dictionaryHash?: string; // "sha256:abc123..."
  scenarioVersion?: string; // "xrechnung_3.0.2_2024-01-15"
  rulesPublishedAt?: string; // "2024-01-15T00:00:00Z"
  buildTimestamp?: string; // Build time of validator
}

const result = await runner.validate(xml);
console.log(result.versionInfo.dictionaryVersion);
// "xrechnung-schematron-3.0.2"
```

## KoSIT Filter

Ready-to-use filter for the FiscalLayer pipeline:

```typescript
import { createKositFilter } from '@fiscal-layer/steps-kosit';

const kositFilter = createKositFilter({
  runnerType: 'docker',
  mode: 'auto',
  daemonUrl: 'http://localhost:8080',
  failOnWarnings: false,
});

await kositFilter.onInit();
const result = await kositFilter.execute(context);
await kositFilter.onDestroy();
```

### Filter Configuration

```typescript
interface KositFilterConfig {
  runnerType?: 'mock' | 'docker' | 'native';
  runner?: KositRunner; // Pre-configured runner

  // Docker options
  mode?: 'daemon' | 'cli' | 'auto';
  daemonUrl?: string;
  daemonImage?: string;
  cliImage?: string;
  memoryLimit?: string;
  cpuLimit?: string;

  // Behavior
  failOnWarnings?: boolean;
  includeRawOutput?: boolean;
  timeoutMs?: number;
}
```

## Error Handling

### Fallback Events

When daemon is unavailable in auto mode:

```typescript
{
  code: 'KOSIT-DAEMON-UNAVAILABLE',
  reason: 'health_check_failed',
  fallbackMode: 'cli',
  timestamp: '2024-01-15T10:00:00.000Z'
}
```

### Error Classification

| Error Code                 | Meaning                           | BlockType  |
| -------------------------- | --------------------------------- | ---------- |
| `KOSIT-TIMEOUT`            | Validation timed out              | SYSTEM     |
| `KOSIT-DOCKER-ERROR`       | Docker command failed             | SYSTEM     |
| `KOSIT-DAEMON-UNAVAILABLE` | HTTP daemon not reachable         | SYSTEM     |
| `KOSIT-SPAWN-ERROR`        | Failed to start Docker            | SYSTEM     |
| `BR-DE-*`                  | XRechnung business rule violation | COMPLIANCE |
| `BR-*`                     | EN16931 business rule violation   | COMPLIANCE |

## PII Sanitization

All output messages are automatically sanitized:

```
Original: Invalid IBAN: DE89370400440532013000
Sanitized: Invalid IBAN: [IBAN:REDACTED]

Original: Contact: john@example.com
Sanitized: Contact: [EMAIL:REDACTED]
```

## Environment Variables

| Variable             | Default                           | Description                 |
| -------------------- | --------------------------------- | --------------------------- |
| `KOSIT_RUNNER_TYPE`  | `mock`                            | `mock` or `docker`          |
| `KOSIT_DOCKER_MODE`  | `auto`                            | `daemon`, `cli`, or `auto`  |
| `KOSIT_DAEMON_URL`   | `http://localhost:8080`           | Daemon HTTP endpoint        |
| `KOSIT_DAEMON_IMAGE` | `flx235/xr-validator-service:302` | Daemon Docker image         |
| `KOSIT_CLI_IMAGE`    | `fiscallayer/kosit-cli:latest`    | CLI Docker image            |
| `KOSIT_TIMEOUT_MS`   | `30000`                           | Validation timeout          |
| `KOSIT_MEMORY_LIMIT` | `512m`                            | Container memory (CLI mode) |
| `KOSIT_CPU_LIMIT`    | `1.0`                             | Container CPU (CLI mode)    |

## Testing

```bash
# Unit tests (no Docker required)
pnpm --filter @fiscal-layer/steps-kosit test

# With Docker daemon (integration tests)
docker run -d -p 8080:8080 flx235/xr-validator-service:302
pnpm --filter @fiscal-layer/steps-kosit test
```

## Validation Result

```typescript
interface KositValidationResult {
  valid: boolean; // Overall validation status
  schemaValid: boolean; // XSD schema validation passed
  schematronValid: boolean; // Schematron rules passed
  items: KositValidationItem[]; // All errors/warnings/info
  summary: {
    errors: number;
    warnings: number;
    information: number;
  };
  profile?: string; // Detected profile
  versionInfo: KositVersionInfo;
  scenarioName?: string;
  durationMs: number;
  rawOutput?: string; // Raw validator output (if requested)
}

interface KositValidationItem {
  ruleId: string; // 'BR-DE-01', 'BR-01', etc.
  severity: 'error' | 'warning' | 'information';
  message: string; // PII-sanitized message
  location?: string; // XPath location
  line?: number;
  column?: number;
  test?: string; // Failed test expression
  source?: string; // Schema/schematron file
}
```

## Supported Rules (Mock)

The MockKositRunner simulates these German business rules:

| Rule     | Description                         |
| -------- | ----------------------------------- |
| BR-DE-01 | Specification identifier required   |
| BR-DE-02 | Seller electronic address           |
| BR-DE-03 | Buyer electronic address            |
| BR-DE-05 | Payment means required              |
| BR-DE-06 | Payment account for credit transfer |
| BR-DE-09 | Tax representative name             |
| BR-DE-13 | Valid invoice type code             |
| BR-DE-17 | Payable amount required             |
| BR-DE-18 | German VAT ID                       |
| BR-DE-21 | Due date for payment terms          |

## Exports

```typescript
// Types
export * from './types.js';

// Runners
export {
  MockKositRunner,
  createAlwaysValidRunner,
  createFixedErrorRunner,
} from './mock-kosit-runner.js';
export {
  DockerKositRunner,
  parseKositReport,
  isDockerAvailable,
  checkDaemonHealth,
} from './docker-kosit-runner.js';
export type { DockerKositRunnerConfig, FallbackEvent } from './docker-kosit-runner.js';

// Filter
export { createKositFilter } from './kosit-filter.js';
export type { KositFilterConfig } from './kosit-filter.js';
```
