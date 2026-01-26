import type { Diagnostic } from '@fiscal-layer/contracts';

/**
 * KoSIT validation severity levels
 */
export type KositSeverity = 'error' | 'warning' | 'information';

/**
 * KoSIT validation result for a single rule
 */
export interface KositValidationItem {
  /**
   * Rule ID (e.g., "BR-DE-01", "BR-01")
   */
  ruleId: string;

  /**
   * Severity level
   */
  severity: KositSeverity;

  /**
   * Human-readable message
   */
  message: string;

  /**
   * XPath location in the document
   */
  location?: string;

  /**
   * Line number (if available)
   */
  line?: number;

  /**
   * Column number (if available)
   */
  column?: number;

  /**
   * Test expression that failed
   */
  test?: string;

  /**
   * Rule source (schema, schematron file)
   */
  source?: string;
}

/**
 * Version information for KoSIT validation.
 * Used for traceability - "what rules were applied?"
 */
export interface KositVersionInfo {
  /**
   * KoSIT validator version
   * @example "1.5.0"
   */
  validatorVersion: string;

  /**
   * Docker image version (if using Docker runner)
   * @example "ghcr.io/itplr-kosit/validator:v1.5.0"
   */
  imageVersion?: string;

  /**
   * Schematron dictionary/rules version
   * @example "xrechnung-schematron-3.0.2"
   */
  dictionaryVersion: string;

  /**
   * Hash of the schematron files used
   * Format: "sha256:<hex>"
   */
  dictionaryHash?: string;

  /**
   * Scenario configuration version
   * @example "xrechnung_3.0.2_2024-01-15"
   */
  scenarioVersion?: string;

  /**
   * Date when these rules were published
   */
  rulesPublishedAt?: string;

  /**
   * Build timestamp of the validator
   */
  buildTimestamp?: string;
}

/**
 * KoSIT validation result
 */
export interface KositValidationResult {
  /**
   * Overall validation status
   */
  valid: boolean;

  /**
   * Schema validation passed
   */
  schemaValid: boolean;

  /**
   * Schematron validation passed
   */
  schematronValid: boolean;

  /**
   * Document profile/format not supported by validator configuration.
   * When true, validation could not be performed (no matching scenario).
   * Pipeline should treat this as skipped, not failed.
   */
  profileUnsupported?: boolean;

  /**
   * System-level error occurred (XML parse error, service error, etc.).
   * When true, validation failed due to system issues, not document content.
   * Pipeline should treat this as a hard failure (SYSTEM block type).
   */
  systemError?: boolean;

  /**
   * All validation items (errors, warnings, info)
   */
  items: KositValidationItem[];

  /**
   * Summary counts
   */
  summary: {
    errors: number;
    warnings: number;
    information: number;
  };

  /**
   * Detected document format/profile
   */
  profile?: string;

  /**
   * Validator version (simple string for backward compatibility)
   * @deprecated Use versionInfo.validatorVersion instead
   */
  validatorVersion?: string;

  /**
   * Detailed version information for traceability
   */
  versionInfo: KositVersionInfo;

  /**
   * Scenario name used
   */
  scenarioName?: string;

  /**
   * Duration in milliseconds
   */
  durationMs: number;

  /**
   * Raw output (for debugging)
   */
  rawOutput?: string;
}

/**
 * KoSIT runner configuration
 */
export interface KositRunnerConfig {
  /**
   * Timeout in milliseconds
   * @default 30000
   */
  timeoutMs?: number;

  /**
   * Scenario directory path
   */
  scenarioDir?: string;

  /**
   * Custom scenarios to load
   */
  scenarios?: string[];

  /**
   * Enable debug output
   */
  debug?: boolean;
}

/**
 * KoSIT runner interface.
 *
 * Implementations:
 * - MockKositRunner: Returns predefined results for testing
 * - DockerKositRunner: Runs KoSIT in a Docker container
 * - NativeKositRunner: Runs KoSIT JAR directly (requires Java)
 */
export interface KositRunner {
  /**
   * Validate an XML document.
   *
   * @param xml - XML content to validate
   * @param options - Optional validation options
   * @returns Validation result
   */
  validate(xml: string, options?: KositValidateOptions): Promise<KositValidationResult>;

  /**
   * Check if the runner is available/healthy.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get the runner's version information.
   * @deprecated Use getVersionInfo() for detailed version info
   */
  getVersion(): Promise<string>;

  /**
   * Get detailed version information for traceability.
   */
  getVersionInfo(): Promise<KositVersionInfo>;

  /**
   * Clean up resources.
   */
  close(): Promise<void>;
}

/**
 * Options for validation
 */
export interface KositValidateOptions {
  /**
   * Document format hint
   */
  format?: 'xrechnung' | 'zugferd' | 'peppol' | 'ubl' | 'cii';

  /**
   * Specific scenario to use
   */
  scenario?: string;

  /**
   * Include raw output in result
   */
  includeRawOutput?: boolean;
}

/**
 * Convert KoSIT validation items to FiscalLayer diagnostics
 */
export function kositItemsToDiagnostics(
  items: KositValidationItem[],
  filterId: string,
): Diagnostic[] {
  return items.map((item) => {
    const diagnostic: Diagnostic = {
      code: item.ruleId,
      message: item.message,
      severity:
        item.severity === 'error'
          ? 'error'
          : item.severity === 'warning'
            ? 'warning'
            : 'info',
      category: 'business-rule',
      source: filterId,
    };

    // Add location if available (XPath string)
    if (item.location) {
      diagnostic.location = item.location;
    }

    // Add context with line/column info if available
    const context: Record<string, unknown> = {};
    if (item.test) {
      context['test'] = item.test;
    }
    if (item.source) {
      context['ruleSource'] = item.source;
    }
    if (item.line !== undefined) {
      context['line'] = item.line;
    }
    if (item.column !== undefined) {
      context['column'] = item.column;
    }
    if (Object.keys(context).length > 0) {
      diagnostic.context = context;
    }

    return diagnostic;
  });
}
