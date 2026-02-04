# @fiscal-layer/privacy

> Privacy and data protection utilities for FiscalLayer

This package provides privacy-by-design utilities for handling sensitive invoice data in compliance with GDPR and German data protection requirements.

## Installation

```bash
pnpm add @fiscal-layer/privacy
```

## Features

- **Data Masking**: Mask PII fields in reports and logs
- **Retention Policies**: Manage data lifecycle
- **Zero-Retention Mode**: Process without persisting original documents

## Usage

```typescript
import {
  DataMasker,
  createDefaultMaskingPolicy,
  createZeroRetentionPolicy,
} from '@fiscal-layer/privacy';

// Create masker with default policy
const masker = new DataMasker(createDefaultMaskingPolicy());

// Mask sensitive data
const maskedReport = masker.mask(validationReport);
```

## Policies

### Masking Policy

Controls how sensitive fields are masked:

```typescript
const policy = createDefaultMaskingPolicy();
// Masks: email, phone, contact names, partial VAT IDs
```

### Retention Policy

Controls how long data is kept:

```typescript
const policy = createZeroRetentionPolicy();
// Raw invoice: 60 seconds
// Fingerprint: 10 years
```
