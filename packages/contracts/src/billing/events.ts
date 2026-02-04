/**
 * Billing event types for metering and monetization.
 *
 * These events are emitted during pipeline execution and can be
 * consumed by billing systems to track usage.
 */

/**
 * Event type for billing
 */
export type BillingEventType =
  | 'validation.started'
  | 'validation.completed'
  | 'filter.executed'
  | 'external.api.call'
  | 'storage.temporary'
  | 'storage.fingerprint';

/**
 * A billing event records a billable action
 */
export interface BillingEvent {
  /**
   * Unique event identifier
   */
  id: string;

  /**
   * Event type
   */
  type: BillingEventType;

  /**
   * Timestamp (ISO 8601)
   */
  timestamp: string;

  /**
   * Correlation ID linking to the validation run
   */
  correlationId: string;

  /**
   * Run ID from the pipeline
   */
  runId: string;

  /**
   * Tenant/customer identifier (for multi-tenant setups)
   */
  tenantId?: string;

  /**
   * Whether this event is billable
   */
  billable: boolean;

  /**
   * Unit count for the billable action
   */
  units: number;

  /**
   * Unit type (e.g., 'validation', 'api_call', 'byte')
   */
  unitType: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Billing event for filter execution
 */
export interface FilterBillingEvent extends BillingEvent {
  type: 'filter.executed';
  filterId: string;
  filterVersion: string;
  durationMs: number;
  status: string;
}

/**
 * Billing event for external API calls
 */
export interface ExternalApiBillingEvent extends BillingEvent {
  type: 'external.api.call';
  service: string;
  endpoint?: string;
  responseStatus?: number;
  durationMs: number;
}

/**
 * Usage summary for a validation run
 */
export interface UsageSummary {
  /**
   * Run ID
   */
  runId: string;

  /**
   * Correlation ID
   */
  correlationId: string;

  /**
   * Total duration in milliseconds
   */
  totalDurationMs: number;

  /**
   * Step-by-step breakdown
   */
  steps: StepUsage[];

  /**
   * External API calls
   */
  externalCalls: ExternalCallUsage[];

  /**
   * Total billable units
   */
  totalBillableUnits: number;

  /**
   * Breakdown by unit type
   */
  unitsByType: Record<string, number>;
}

/**
 * Unit types for billing.
 * These are standard unit types for billing purposes.
 */
export type BillingUnitType =
  | 'validation' // One validation run
  | 'api_call' // One external API call
  | 'vies_lookup' // VIES VAT lookup
  | 'ecb_rate' // ECB rate fetch
  | 'peppol_lookup' // Peppol directory lookup
  | 'storage_byte' // Temporary storage bytes
  | 'fingerprint' // One fingerprint generation
  | 'custom'; // Custom unit type

/**
 * Usage for a single step
 */
export interface StepUsage {
  /**
   * Filter ID (e.g., "vies", "kosit")
   */
  filterId: string;

  /**
   * Human-readable verifier name for billing attribution.
   * This is the display name in billing reports.
   * @example "VIES VAT Validator", "KoSIT Schema Validator"
   */
  verifierName: string;

  /**
   * Filter version for traceability
   */
  filterVersion: string;

  /**
   * Execution duration in milliseconds
   */
  durationMs: number;

  /**
   * Whether this step is billable.
   * External API calls are typically billable, internal validation is not.
   */
  billable: boolean;

  /**
   * Number of billable units consumed
   */
  units: number;

  /**
   * Type of unit being billed
   */
  unitType: BillingUnitType;

  /**
   * Step status (for conditional billing)
   */
  status: 'passed' | 'failed' | 'skipped' | 'error';

  /**
   * Whether this was a retried operation
   */
  isRetry: boolean;

  /**
   * Retry attempt number (0 for first attempt)
   */
  retryAttempt: number;
}

/**
 * Usage for external API calls
 */
export interface ExternalCallUsage {
  /**
   * Service identifier (e.g., "vies", "ecb", "peppol")
   */
  service: string;

  /**
   * Human-readable service name for billing attribution
   * @example "VIES VAT Validation Service"
   */
  serviceName: string;

  /**
   * Total number of calls made
   */
  callCount: number;

  /**
   * Total duration across all calls in milliseconds
   */
  totalDurationMs: number;

  /**
   * Number of successful calls
   */
  successCount: number;

  /**
   * Number of failed calls
   */
  failureCount: number;

  /**
   * Number of retry attempts
   */
  retryCount: number;

  /**
   * Unit type for billing
   */
  unitType: BillingUnitType;

  /**
   * Total billable units
   * Typically equals successCount unless configured otherwise
   */
  billableUnits: number;
}

/**
 * Billing event emitter interface
 */
export interface BillingEventEmitter {
  /**
   * Emit a billing event
   */
  emit(event: BillingEvent): void;

  /**
   * Flush pending events (for batching implementations)
   */
  flush(): Promise<void>;
}

/**
 * Default verifier names for billing attribution.
 * Maps filter IDs to human-readable names.
 */
export const DEFAULT_VERIFIER_NAMES: Record<string, string> = {
  parser: 'Invoice Parser',
  kosit: 'KoSIT Schema Validator',
  vies: 'VIES VAT Validator',
  'vies-pro': 'VIES Pro VAT Validator',
  'ecb-rates': 'ECB Exchange Rate Service',
  peppol: 'Peppol Directory Lookup',
  'semantic-risk': 'Semantic Risk Analyzer',
  fingerprint: 'Compliance Fingerprint Generator',
  dispatcher: 'Result Dispatcher',
};

/**
 * Default billing configuration per filter.
 * Determines which filters are billable and their unit types.
 */
export const DEFAULT_BILLING_CONFIG: Record<
  string,
  { billable: boolean; unitType: BillingUnitType }
> = {
  parser: { billable: false, unitType: 'validation' },
  kosit: { billable: false, unitType: 'validation' },
  vies: { billable: true, unitType: 'vies_lookup' },
  'vies-pro': { billable: true, unitType: 'vies_lookup' },
  'ecb-rates': { billable: true, unitType: 'ecb_rate' },
  peppol: { billable: true, unitType: 'peppol_lookup' },
  'semantic-risk': { billable: false, unitType: 'validation' },
  fingerprint: { billable: false, unitType: 'fingerprint' },
  dispatcher: { billable: false, unitType: 'validation' },
};

/**
 * Get the verifier name for a filter ID.
 */
export function getVerifierName(filterId: string): string {
  return DEFAULT_VERIFIER_NAMES[filterId] ?? filterId;
}

/**
 * Get the billing configuration for a filter ID.
 */
export function getBillingConfig(filterId: string): {
  billable: boolean;
  unitType: BillingUnitType;
} {
  return DEFAULT_BILLING_CONFIG[filterId] ?? { billable: false, unitType: 'validation' };
}
