# @fiscal-layer/shared

> Shared utilities for FiscalLayer - safe logging, decimal arithmetic, canonical hashing

This package provides common utilities used across FiscalLayer packages, with a focus on security (PII scrubbing), financial precision (decimal arithmetic), and audit compliance (canonical hashing).

## Installation

```bash
pnpm add @fiscal-layer/shared
```

## Key Features

- **Safe Logger**: Auto-scrubs PII (IBAN, email, VAT ID, phone) from logs
- **Decimal Arithmetic**: Banker's rounding with explicit rounding modes
- **Canonical Hash**: Deterministic JSON + SHA-256 for config traceability
- **ID Generation**: Unique IDs and correlation IDs

## Safe Logger

Prevents PII leaks in logs by auto-scrubbing sensitive patterns:

```typescript
import { createSafeLogger } from '@fiscal-layer/shared';

const logger = createSafeLogger({
  prefix: 'validation-api',
  correlationId: 'req-123', // Auto-included in all log entries
});

// PII is automatically scrubbed
logger.info('Processing invoice', {
  iban: 'DE89370400440532013000', // → [IBAN:REDACTED]
  email: 'user@example.com', // → [EMAIL:REDACTED]
  vatId: 'DE123456789', // → [VAT_ID:REDACTED]
  phone: '+49 30 12345678', // → [PHONE:REDACTED]
});

// Output:
// {"level":"info","prefix":"validation-api","correlationId":"req-123",
//  "message":"Processing invoice","iban":"[IBAN:REDACTED]","email":"[EMAIL:REDACTED]",...}
```

### PII Patterns Scrubbed

| Type        | Pattern               | Replacement         |
| ----------- | --------------------- | ------------------- |
| IBAN        | `XX00XXXX0000...`     | `[IBAN:REDACTED]`   |
| Email       | `*@*.*`               | `[EMAIL:REDACTED]`  |
| VAT ID      | `XX000000000`         | `[VAT_ID:REDACTED]` |
| Phone       | `+00 00 00000...`     | `[PHONE:REDACTED]`  |
| Credit Card | `0000-0000-0000-0000` | `[CC:REDACTED]`     |

### Assertion Helper

```typescript
import { assertSafeLogging } from '@fiscal-layer/shared';

// In tests: verify PII was scrubbed
const logOutput = capturedLogs.join('\n');
assertSafeLogging(logOutput); // Throws if raw PII detected
```

## Decimal Arithmetic

Financial-grade decimal operations with explicit rounding modes:

```typescript
import {
  add,
  subtract,
  multiply,
  divide,
  sum,
  percentage,
  round,
  compare,
  equals,
  isZero,
  isNegative,
  isPositive,
  fromNumber,
  toNumber,
  formatForDisplay,
  DEFAULT_ROUNDING_MODE, // 'ROUND_HALF_EVEN' (Banker's rounding)
} from '@fiscal-layer/shared';

// Basic arithmetic
const subtotal = sum(['100.00', '200.50', '50.25']); // '350.75'
const tax = multiply(subtotal, '0.19'); // '66.64' (banker's rounding)
const total = add(subtotal, tax); // '417.39'

// Explicit rounding mode
const commercial = multiply('10.00', '1.005', { roundingMode: 'ROUND_HALF_UP' });

// Comparison
if (compare(total, '400.00') > 0) {
  console.log('Total exceeds 400');
}

// Display formatting
const display = formatForDisplay(total, { locale: 'de-DE', currency: 'EUR' });
// '417,39 €'
```

### Rounding Modes

| Mode              | Description                 | Use Case                              |
| ----------------- | --------------------------- | ------------------------------------- |
| `ROUND_HALF_EVEN` | Banker's rounding (default) | Financial calculations                |
| `ROUND_HALF_UP`   | Commercial rounding         | Display/UI                            |
| `ROUND_DOWN`      | Truncate                    | Tax calculations (some jurisdictions) |
| `ROUND_UP`        | Always round up             | Conservative estimates                |
| `ROUND_CEILING`   | Round toward +∞             | Ceiling calculations                  |
| `ROUND_FLOOR`     | Round toward -∞             | Floor calculations                    |

### Why Not `decimal.js`?

The built-in implementation uses `bigint` for:

- Zero external dependencies
- Predictable behavior across all runtimes
- Explicit rounding mode on every operation (no global state)

## Canonical Hash

Deterministic hashing for audit trails and config verification:

```typescript
import {
  canonicalStringify,
  computeConfigHash,
  verifyConfigHash,
  shortHash,
} from '@fiscal-layer/shared';

// Canonical stringify: sorted keys, no undefined values
const canonical = canonicalStringify({ b: 2, a: 1 });
// '{"a":1,"b":2}' (keys sorted)

// Compute hash
const hash = computeConfigHash({ steps: [...], version: '1.0' });
// 'sha256:a1b2c3d4e5f6...'

// Verify hash
const isValid = verifyConfigHash(config, hash);  // true/false

// Short hash for display
const short = shortHash(hash);  // 'a1b2c3d4'
```

## ID Generation

```typescript
import { generateId, generateCorrelationId } from '@fiscal-layer/shared';

const id = generateId(); // 'abc123xyz789...' (nanoid)
const correlationId = generateCorrelationId(); // 'req-abc123xyz789'
```

## Error Types

```typescript
import { FiscalLayerError, ValidationError, ConfigurationError } from '@fiscal-layer/shared';

throw new ValidationError('Invalid invoice format', {
  code: 'INVALID_FORMAT',
  details: { expected: 'xrechnung', actual: 'unknown' },
});
```

## Exports

```typescript
// Logging
export { createLogger, createSafeLogger, assertSafeLogging };
export type { Logger, LogLevel, SafeLoggerOptions };

// Decimal
export {
  add,
  subtract,
  multiply,
  divide,
  sum,
  percentage,
  round,
  abs,
  negate,
  compare,
  equals,
  isZero,
  isNegative,
  isPositive,
  fromNumber,
  toNumber,
  formatForDisplay,
  isValidDecimalAmount,
  DEFAULT_ROUNDING_MODE,
  DEFAULT_DECIMAL_PLACES,
  MAX_DECIMAL_PLACES,
};
export type { RoundingMode, DecimalConfig };

// Crypto
export { canonicalStringify, computeConfigHash, verifyConfigHash, parseHash, shortHash };

// IDs
export { generateId, generateCorrelationId };

// Errors
export { FiscalLayerError, ValidationError, ConfigurationError };
```
