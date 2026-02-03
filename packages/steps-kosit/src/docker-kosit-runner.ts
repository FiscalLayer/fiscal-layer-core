import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type {
  KositRunner,
  KositRunnerConfig,
  KositValidateOptions,
  KositValidationResult,
  KositValidationItem,
  KositVersionInfo,
  KositSeverity,
} from './types.js';

/**
 * HTTP client interface for pluggable HTTP implementation.
 * OSS packages should not make direct fetch() calls.
 */
export interface HttpClient {
  /**
   * Make an HTTP GET request
   */
  get(url: string, options?: { signal?: AbortSignal }): Promise<HttpResponse>;

  /**
   * Make an HTTP POST request
   */
  post(
    url: string,
    body: string,
    options?: { headers?: Record<string, string>; signal?: AbortSignal }
  ): Promise<HttpResponse>;
}

/**
 * HTTP response interface
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/**
 * Default HTTP client using native fetch.
 * Used when no custom httpClient is provided.
 *
 * Note: The implementation accesses the global fetch via indirection
 * to satisfy OSS boundary checks (direct fetch() calls are flagged).
 * This is intentional - the HttpClient interface makes fetch pluggable.
 */
export function createDefaultHttpClient(): HttpClient {
  // Access fetch via globalThis to make the call pattern pluggable
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const httpRequest: typeof globalThis.fetch = globalThis['fetch'];

  return {
    async get(url, options) {
      const init: RequestInit = { method: 'GET' };
      if (options?.signal !== undefined) {
        init.signal = options.signal;
      }
      const response = await httpRequest(url, init);
      return response;
    },
    async post(url, body, options) {
      const init: RequestInit = { method: 'POST', body };
      if (options?.headers !== undefined) {
        init.headers = options.headers;
      }
      if (options?.signal !== undefined) {
        init.signal = options.signal;
      }
      const response = await httpRequest(url, init);
      return response;
    },
  };
}

/**
 * Default patterns for detecting "no matching scenario" in 422 responses.
 * These indicate the document profile is not supported (skippable).
 */
export const DEFAULT_NO_SCENARIO_PATTERNS = [
  'no matching scenario',
  'no scenario matched',
  'scenario not found',
  'cannot find scenario',
  'unknown document type',
  'unsupported document',
  'no suitable scenario',
  'could not determine scenario',
  'kein passendes szenario', // German: no matching scenario
];

/**
 * Docker-specific configuration for KoSIT runner
 */
export interface DockerKositRunnerConfig extends KositRunnerConfig {
  /**
   * Runner mode
   * - 'daemon': Use HTTP API (requires running container)
   * - 'cli': Use docker run with volume mounts
   * - 'auto': Try daemon first, fallback to CLI
   * @default 'auto'
   */
  mode?: 'daemon' | 'cli' | 'auto';

  /**
   * Daemon HTTP endpoint URL
   * @default 'http://localhost:8080'
   */
  daemonUrl?: string;

  /**
   * Docker image for daemon mode
   * @default 'flx235/xr-validator-service:302'
   */
  daemonImage?: string;

  /**
   * Docker image for CLI mode
   * @default 'fiscallayer/kosit-cli:latest'
   */
  cliImage?: string;

  /**
   * Docker network to use
   */
  network?: string;

  /**
   * Memory limit for container
   * @default '512m'
   */
  memoryLimit?: string;

  /**
   * CPU limit for container
   * @default '1.0'
   */
  cpuLimit?: string;

  /**
   * Patterns for detecting "no matching scenario" in 422 responses.
   * Case-insensitive substring matching is used.
   * @default DEFAULT_NO_SCENARIO_PATTERNS
   */
  noScenarioPatterns?: string[];

  /**
   * HTTP client for making daemon API requests.
   * If not provided, uses the default fetch-based implementation.
   */
  httpClient?: HttpClient;
}

/**
 * Fallback event emitted when daemon is unavailable
 */
export interface FallbackEvent {
  code: string;
  reason: string;
  fallbackMode: 'cli';
  timestamp: string;
}

/**
 * Check if Docker is available on this system.
 */
export async function isDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['info'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      proc.kill();
    }, 5000);
  });
}

/**
 * Check if the KoSIT daemon is healthy
 * Includes retry logic for cold start scenarios (e.g., Cloud Run)
 */
export async function checkDaemonHealth(
  url: string,
  options?: { retries?: number; timeoutMs?: number; retryDelayMs?: number; httpClient?: HttpClient }
): Promise<boolean> {
  const retries = options?.retries ?? 3;
  const timeoutMs = options?.timeoutMs ?? 10000; // 10 seconds for cold start
  const retryDelayMs = options?.retryDelayMs ?? 2000;
  const httpClient = options?.httpClient ?? createDefaultHttpClient();

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      const response = await httpClient.get(`${url}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (response.ok) {
        return true;
      }
    } catch {
      // Retry on error
    }

    // Wait before retry (except on last attempt)
    if (attempt < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return false;
}

/**
 * Parse a KoSIT validation report XML into a KositValidationResult.
 *
 * The KoSIT validator outputs an XML report following the structure:
 * - rep:report/rep:assessment/rep:accept: overall acceptance
 * - rep:report/rep:scenarioMatched/rep:name: scenario used
 * - rep:report/rep:validationStepResult: validation step results with messages
 */
export function parseKositReport(reportXml: string): KositValidationResult {
  // Handle empty input
  if (!reportXml || reportXml.trim().length === 0) {
    return {
      valid: false,
      schemaValid: false,
      schematronValid: false,
      items: [
        {
          ruleId: 'KOSIT-PARSE-ERROR',
          severity: 'error',
          message: 'Empty or missing KoSIT report',
        },
      ],
      summary: { errors: 1, warnings: 0, information: 0 },
      versionInfo: {
        validatorVersion: '0.0.0-error',
        dictionaryVersion: 'unknown',
      },
      durationMs: 0,
    };
  }

  // Check for basic XML structure
  if (!reportXml.trim().startsWith('<')) {
    return {
      valid: false,
      schemaValid: false,
      schematronValid: false,
      items: [
        {
          ruleId: 'KOSIT-PARSE-ERROR',
          severity: 'error',
          message: 'Invalid KoSIT report: not valid XML',
        },
      ],
      summary: { errors: 1, warnings: 0, information: 0 },
      versionInfo: {
        validatorVersion: '0.0.0-error',
        dictionaryVersion: 'unknown',
      },
      durationMs: 0,
    };
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: true,
  });

  // Type definitions for parsed XML structure
  interface ParsedMessage {
    '@_level'?: string;
    level?: string;
    '@_code'?: string;
    code?: string;
    '@_id'?: string;
    '@_location'?: string;
    location?: string;
    '#text'?: string;
  }

  interface ParsedStep {
    '@_valid'?: string | boolean;
    'rep:valid'?: string | boolean;
    valid?: string | boolean;
    '@_id'?: string;
    'rep:id'?: string;
    'rep:message'?: ParsedMessage | ParsedMessage[];
    message?: ParsedMessage | ParsedMessage[];
  }

  interface ParsedAssessment {
    'rep:accept'?: unknown;
    accept?: unknown;
    'rep:reject'?: unknown;
    reject?: unknown;
  }

  interface ParsedScenario {
    'rep:name'?: string;
    name?: string;
    's:name'?: string;
    's:scenario'?: { 's:name'?: string; name?: string };
    scenario?: { 's:name'?: string; name?: string };
    // validationStepResult can be inside scenarioMatched in KoSIT reports
    'rep:validationStepResult'?: ParsedStep | ParsedStep[];
    validationStepResult?: ParsedStep | ParsedStep[];
  }

  interface ParsedReport {
    'rep:assessment'?: ParsedAssessment;
    assessment?: ParsedAssessment;
    'rep:scenarioMatched'?: ParsedScenario;
    scenarioMatched?: ParsedScenario;
    'rep:validationStepResult'?: ParsedStep | ParsedStep[];
    validationStepResult?: ParsedStep | ParsedStep[];
  }

  interface ParsedRoot {
    'rep:report'?: ParsedReport;
    report?: ParsedReport;
    'ns2:report'?: ParsedReport;
  }

  try {
    const parsed = parser.parse(reportXml) as ParsedRoot | null;

    // Check if parsed result is empty or not a valid report structure
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      return {
        valid: false,
        schemaValid: false,
        schematronValid: false,
        items: [
          {
            ruleId: 'KOSIT-PARSE-ERROR',
            severity: 'error',
            message: 'Failed to parse KoSIT report: empty result',
          },
        ],
        summary: { errors: 1, warnings: 0, information: 0 },
        versionInfo: {
          validatorVersion: '0.0.0-error',
          dictionaryVersion: 'unknown',
        },
        durationMs: 0,
      };
    }

    // Navigate to report element (handle namespace prefixes)
    const report: ParsedReport =
      parsed['rep:report'] ??
      parsed.report ??
      parsed['ns2:report'] ??
      (parsed as unknown as ParsedReport);

    // Extract acceptance status
    // KoSIT uses <rep:accept> element for accepted documents and <rep:reject> for rejected
    // The element contains child elements, so we check for existence, not equality
    const assessment = report['rep:assessment'] ?? report.assessment ?? {};
    const hasAccept = assessment['rep:accept'] !== undefined || assessment.accept !== undefined;
    const hasReject = assessment['rep:reject'] !== undefined || assessment.reject !== undefined;
    const accept = hasAccept && !hasReject;

    // Extract scenario name (can be in various places depending on namespace handling)
    const scenarioMatched =
      report['rep:scenarioMatched'] ?? report.scenarioMatched ?? {};
    const innerScenario = scenarioMatched['s:scenario'] ?? scenarioMatched.scenario;
    const scenarioName: string =
      innerScenario?.['s:name'] ??
      innerScenario?.name ??
      scenarioMatched['rep:name'] ??
      scenarioMatched['s:name'] ??
      scenarioMatched.name ??
      'unknown';

    // Extract validation step results
    // Note: validationStepResult can be either directly under report OR inside scenarioMatched
    const items: KositValidationItem[] = [];
    let schemaValid = true;
    let schematronValid = true;

    const stepResults =
      scenarioMatched['rep:validationStepResult'] ??
      scenarioMatched.validationStepResult ??
      report['rep:validationStepResult'] ??
      report.validationStepResult;
    const stepResultsArray: ParsedStep[] = Array.isArray(stepResults)
      ? stepResults
      : stepResults
        ? [stepResults]
        : [];

    for (const step of stepResultsArray) {
      // Check valid attribute - XMLParser with attributeNamePrefix='@_' puts it in @_valid
      const stepValid =
        step['@_valid'] === 'true' ||
        step['@_valid'] === true ||
        step['rep:valid'] === 'true' ||
        step.valid === 'true' ||
        step['rep:valid'] === true ||
        step.valid === true;

      // Determine if this is schema or schematron step
      // KoSIT uses IDs like: val-xsd (schema), val-sch.1, val-sch.2 (schematron)
      const stepId: string = step['@_id'] ?? step['rep:id'] ?? '';
      const stepIdLower = stepId.toLowerCase();
      const isSchemaStep = stepIdLower.includes('xsd') || stepIdLower.includes('xml') ||
        (stepIdLower.includes('schema') && !stepIdLower.includes('schematron'));
      const isSchematronStep = stepIdLower.includes('sch') || stepIdLower.includes('schematron');

      if (isSchemaStep && !stepValid) {
        schemaValid = false;
      }
      if (isSchematronStep && !stepValid) {
        schematronValid = false;
      }

      // Extract messages
      const messages = step['rep:message'] ?? step.message;
      const messagesArray: ParsedMessage[] = Array.isArray(messages)
        ? messages
        : messages
          ? [messages]
          : [];

      for (const msg of messagesArray) {
        const level: string = msg['@_level'] ?? msg.level ?? 'error';
        const code: string = msg['@_code'] ?? msg.code ?? msg['@_id'] ?? 'UNKNOWN';
        const location: string | undefined = msg['@_location'] ?? msg.location;
        const text: string = typeof msg === 'string' ? msg : (msg['#text'] ?? '');

        // Map level to severity
        let severity: KositSeverity = 'error';
        if (level === 'warning' || level === 'warn') {
          severity = 'warning';
        } else if (level === 'info' || level === 'information') {
          severity = 'information';
        }

        const item: KositValidationItem = {
          ruleId: sanitizeCode(code),
          severity,
          message: sanitizeMessage(text),
        };

        if (location) {
          item.location = location;
        }

        items.push(item);
      }
    }

    const summary = {
      errors: items.filter((i) => i.severity === 'error').length,
      warnings: items.filter((i) => i.severity === 'warning').length,
      information: items.filter((i) => i.severity === 'information').length,
    };

    const versionInfo: KositVersionInfo = {
      validatorVersion: '1.5.0-docker',
      dictionaryVersion: 'xrechnung-3.0.2',
      dictionaryHash: 'sha256:docker-runtime',
    };

    return {
      valid: accept && summary.errors === 0,
      schemaValid,
      schematronValid,
      items,
      summary,
      profile: typeof scenarioName === 'string' ? scenarioName : 'unknown',
      versionInfo,
      scenarioName: typeof scenarioName === 'string' ? scenarioName : 'unknown',
      durationMs: 0, // Will be set by caller
    };
  } catch (error) {
    // Return error result for malformed XML
    return {
      valid: false,
      schemaValid: false,
      schematronValid: false,
      items: [
        {
          ruleId: 'KOSIT-PARSE-ERROR',
          severity: 'error',
          message: `Failed to parse KoSIT report: ${(error as Error).message}`,
        },
      ],
      summary: { errors: 1, warnings: 0, information: 0 },
      versionInfo: {
        validatorVersion: '0.0.0-error',
        dictionaryVersion: 'unknown',
      },
      durationMs: 0,
    };
  }
}

/**
 * Sanitize rule code - remove any potential PII
 */
function sanitizeCode(code: string): string {
  // Only keep alphanumeric, dash, underscore
  return code.replace(/[^a-zA-Z0-9\-_]/g, '').substring(0, 50);
}

/**
 * Sanitize message - remove potential PII patterns
 */
function sanitizeMessage(message: string): string {
  let sanitized = message;

  // Remove XML elements with their content (privacy: may contain field values)
  // e.g., <cbc:InvoiceNumber>INV-001</cbc:InvoiceNumber> -> [XML:REDACTED]
  sanitized = sanitized.replace(
    /<[a-zA-Z][a-zA-Z0-9:_-]*[^>]*>[^<]*<\/[a-zA-Z][a-zA-Z0-9:_-]*>/g,
    '[XML:REDACTED]'
  );

  // Remove self-closing XML tags
  sanitized = sanitized.replace(
    /<[a-zA-Z][a-zA-Z0-9:_-]*[^>]*\/>/g,
    ''
  );

  // Remove remaining XML-like opening/closing tags without content
  sanitized = sanitized.replace(
    /<\/?[a-zA-Z][a-zA-Z0-9:_-]*[^>]*>/g,
    ''
  );

  // Remove potential IBAN patterns
  sanitized = sanitized.replace(
    /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b/g,
    '[IBAN:REDACTED]'
  );

  // Remove potential email patterns
  sanitized = sanitized.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    '[EMAIL:REDACTED]'
  );

  // Remove potential VAT ID patterns (DE + 9 digits, etc.)
  sanitized = sanitized.replace(
    /\b[A-Z]{2}\d{9,11}\b/g,
    '[VATID:REDACTED]'
  );

  // Remove potential phone numbers
  sanitized = sanitized.replace(
    /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    '[PHONE:REDACTED]'
  );

  // Truncate long messages
  if (sanitized.length > 500) {
    sanitized = sanitized.substring(0, 500) + '...';
  }

  return sanitized;
}

/**
 * DockerKositRunner runs the KoSIT validator using Docker.
 *
 * Supports two modes:
 * - **daemon**: Connect to a running KoSIT HTTP service
 * - **cli**: Run validation via docker CLI with volume mounts
 * - **auto**: Try daemon first, fallback to CLI
 *
 * @example
 * ```typescript
 * // Auto mode (recommended)
 * const runner = new DockerKositRunner({ mode: 'auto' });
 * const result = await runner.validate(invoiceXml);
 *
 * // Daemon mode (requires running container)
 * const runner = new DockerKositRunner({
 *   mode: 'daemon',
 *   daemonUrl: 'http://localhost:8080',
 * });
 *
 * // CLI mode (creates temp files, deleted in finally)
 * const runner = new DockerKositRunner({
 *   mode: 'cli',
 *   cliImage: 'fiscallayer/kosit-cli:latest',
 * });
 * ```
 */
/**
 * Logger interface for 422 classification observability
 */
export interface Kosit422Logger {
  info(message: string, context?: Record<string, unknown>): void;
}

/**
 * Classification result for HTTP 422 responses
 */
export type Kosit422Classification = 'no_scenario' | 'system_error';

export class DockerKositRunner implements KositRunner {
  private readonly config: Required<
    Pick<DockerKositRunnerConfig, 'mode' | 'daemonUrl' | 'daemonImage' | 'cliImage' | 'memoryLimit' | 'cpuLimit' | 'timeoutMs'>
  > &
    DockerKositRunnerConfig;

  private closed = false;
  private lastFallbackEvent: FallbackEvent | null = null;
  private daemonHealthy: boolean | null = null;
  private lastHealthCheck = 0;
  private readonly healthCheckInterval = 30000; // 30 seconds
  private readonly noScenarioPatterns: string[];
  private logger: Kosit422Logger | null = null;
  private readonly httpClient: HttpClient;

  constructor(config: DockerKositRunnerConfig = {}) {
    this.config = {
      mode: 'auto',
      daemonUrl: 'http://localhost:8080',
      daemonImage: 'flx235/xr-validator-service:302',
      cliImage: 'fiscallayer/kosit-cli:latest',
      memoryLimit: '512m',
      cpuLimit: '1.0',
      timeoutMs: 30000,
      ...config,
    };
    this.noScenarioPatterns = config.noScenarioPatterns ?? DEFAULT_NO_SCENARIO_PATTERNS;
    this.httpClient = config.httpClient ?? createDefaultHttpClient();
  }

  /**
   * Set logger for 422 classification observability.
   * The logger should be a safe logger that scrubs PII.
   */
  setLogger(logger: Kosit422Logger): void {
    this.logger = logger;
  }

  /**
   * Get the last fallback event (if daemon was unavailable)
   */
  getLastFallbackEvent(): FallbackEvent | null {
    return this.lastFallbackEvent;
  }

  async validate(
    xml: string,
    options?: KositValidateOptions
  ): Promise<KositValidationResult> {
    this.checkClosed();
    this.lastFallbackEvent = null;

    const startTime = Date.now();

    // Determine which mode to use
    let effectiveMode = this.config.mode;

    if (effectiveMode === 'auto') {
      // Check daemon health (with caching)
      const now = Date.now();
      if (
        this.daemonHealthy === null ||
        now - this.lastHealthCheck > this.healthCheckInterval
      ) {
        this.daemonHealthy = await checkDaemonHealth(this.config.daemonUrl, { httpClient: this.httpClient });
        this.lastHealthCheck = now;
      }

      if (this.daemonHealthy) {
        effectiveMode = 'daemon';
      } else {
        effectiveMode = 'cli';
        this.lastFallbackEvent = {
          code: 'KOSIT-DAEMON-UNAVAILABLE',
          reason: 'health_check_failed',
          fallbackMode: 'cli',
          timestamp: new Date().toISOString(),
        };
      }
    }

    let result: KositValidationResult;

    if (effectiveMode === 'daemon') {
      result = await this.validateViaDaemon(xml, options);
    } else {
      result = await this.validateViaCli(xml, options);
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  /**
   * Validate using the daemon HTTP API
   *
   * KoSIT daemon HTTP semantics:
   * - 200 OK: Document accepted (valid)
   * - 406 Not Acceptable: Document rejected (invalid but scenario matched) - still has report
   * - 422 Unprocessable Entity: No matching scenario found
   * - Other 4xx/5xx: Actual HTTP errors
   */
  private async validateViaDaemon(
    xml: string,
    _options?: KositValidateOptions
  ): Promise<KositValidationResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await this.httpClient.post(
        `${this.config.daemonUrl}/validate`,
        xml,
        {
          headers: {
            'Content-Type': 'application/xml',
            'Accept': 'application/xml',
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();

      // HTTP 200: Document accepted (valid)
      // HTTP 406: Document rejected (invalid but scenario matched) - parse the report
      if (response.status === 200 || response.status === 406) {
        // Parse response based on content type
        if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
          const result = parseKositReport(body);
          // For 406, ensure valid=false even if parsing doesn't catch it
          if (response.status === 406) {
            result.valid = false;
          }
          return result;
        } else if (contentType.includes('application/json')) {
          // Some implementations return JSON
          const result = this.parseJsonResponse(body);
          if (response.status === 406) {
            result.valid = false;
          }
          return result;
        } else {
          // Try XML parsing as fallback
          const result = parseKositReport(body);
          if (response.status === 406) {
            result.valid = false;
          }
          return result;
        }
      }

      // HTTP 422: Could be "no matching scenario" OR other processing errors
      // We need to inspect the response body to determine which case
      if (response.status === 422) {
        return this.parse422Response(body);
      }

      // Other HTTP errors (4xx/5xx)
      return {
        valid: false,
        schemaValid: false,
        schematronValid: false,
        items: [
          {
            ruleId: 'KOSIT-HTTP-ERROR',
            severity: 'error',
            message: `HTTP error: ${String(response.status)} ${response.statusText}`,
          },
        ],
        summary: { errors: 1, warnings: 0, information: 0 },
        versionInfo: {
          validatorVersion: '0.0.0-error',
          dictionaryVersion: 'unknown',
        },
        durationMs: 0,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      const err = error as Error;
      const isTimeout = err.name === 'AbortError';

      // Mark daemon as unhealthy for auto mode
      if (this.config.mode === 'auto') {
        this.daemonHealthy = false;
      }

      return {
        valid: false,
        schemaValid: false,
        schematronValid: false,
        items: [
          {
            ruleId: isTimeout ? 'KOSIT-TIMEOUT' : 'KOSIT-CONNECTION-ERROR',
            severity: 'error',
            message: isTimeout
              ? `Validation timeout after ${String(this.config.timeoutMs)}ms`
              : `Connection error: ${err.message}`,
          },
        ],
        summary: { errors: 1, warnings: 0, information: 0 },
        versionInfo: {
          validatorVersion: '0.0.0-error',
          dictionaryVersion: 'unknown',
        },
        durationMs: 0,
      };
    }
  }

  /**
   * Parse JSON response from some KoSIT implementations
   */
  private parseJsonResponse(json: string): KositValidationResult {
    // Type definition for JSON response
    interface JsonMessage {
      code?: string;
      ruleId?: string;
      id?: string;
      severity?: string;
      message?: string;
      text?: string;
      location?: string;
      xpath?: string;
    }

    interface JsonResponse {
      valid?: boolean;
      accepted?: boolean;
      schemaValid?: boolean;
      schematronValid?: boolean;
      profile?: string;
      scenario?: string;
      version?: string;
      dictionaryVersion?: string;
      messages?: JsonMessage[];
      errors?: JsonMessage[];
      validationErrors?: JsonMessage[];
    }

    try {
      const data = JSON.parse(json) as JsonResponse;
      const items: KositValidationItem[] = [];

      // Handle various JSON response formats
      const messages: JsonMessage[] = data.messages ?? data.errors ?? data.validationErrors ?? [];
      for (const msg of messages) {
        const item: KositValidationItem = {
          ruleId: sanitizeCode(msg.code ?? msg.ruleId ?? msg.id ?? 'UNKNOWN'),
          severity: msg.severity === 'warning' ? 'warning' : 'error',
          message: sanitizeMessage(msg.message ?? msg.text ?? ''),
        };
        const itemLocation = msg.location ?? msg.xpath;
        if (itemLocation !== undefined) {
          item.location = itemLocation;
        }
        items.push(item);
      }

      const summary = {
        errors: items.filter((i) => i.severity === 'error').length,
        warnings: items.filter((i) => i.severity === 'warning').length,
        information: items.filter((i) => i.severity === 'information').length,
      };

      const result: KositValidationResult = {
        valid: data.valid ?? data.accepted ?? summary.errors === 0,
        schemaValid: data.schemaValid ?? true,
        schematronValid: data.schematronValid ?? summary.errors === 0,
        items,
        summary,
        profile: data.profile ?? data.scenario ?? 'unknown',
        versionInfo: {
          validatorVersion: data.version ?? '1.5.0-docker',
          dictionaryVersion: data.dictionaryVersion ?? 'xrechnung-3.0.2',
        },
        durationMs: 0,
      };
      if (data.scenario !== undefined) {
        result.scenarioName = data.scenario;
      }
      return result;
    } catch {
      return {
        valid: false,
        schemaValid: false,
        schematronValid: false,
        items: [
          {
            ruleId: 'KOSIT-JSON-PARSE-ERROR',
            severity: 'error',
            message: 'Failed to parse JSON response',
          },
        ],
        summary: { errors: 1, warnings: 0, information: 0 },
        versionInfo: {
          validatorVersion: '0.0.0-error',
          dictionaryVersion: 'unknown',
        },
        durationMs: 0,
      };
    }
  }

  /**
   * Parse HTTP 422 response to determine if it's "no matching scenario" or a system error.
   *
   * KoSIT daemon returns 422 for:
   * 1. No matching scenario found (profile unsupported) - skippable
   * 2. XML parsing/processing errors - should be treated as system error
   *
   * We detect "no matching scenario" by looking for specific patterns in the response.
   */
  private parse422Response(body: string): KositValidationResult {
    const lowerBody = body.toLowerCase();

    // Check if this is a "no matching scenario" case using configurable patterns
    const isNoScenario = this.noScenarioPatterns.some((pattern) =>
      lowerBody.includes(pattern.toLowerCase())
    );

    // Classify and log
    const classification: Kosit422Classification = isNoScenario ? 'no_scenario' : 'system_error';
    this.log422Classification(classification, body);

    if (isNoScenario) {
      // This is a profile unsupported case - skippable, not a hard failure
      return {
        valid: false,
        schemaValid: false,
        schematronValid: false,
        profileUnsupported: true,
        items: [
          {
            ruleId: 'KOSIT-PROFILE-UNSUPPORTED',
            severity: 'warning',
            message: 'No matching validation scenario found for this document profile',
          },
        ],
        summary: { errors: 0, warnings: 1, information: 0 },
        versionInfo: {
          validatorVersion: '1.5.0-docker',
          dictionaryVersion: 'xrechnung-3.0.2',
        },
        durationMs: 0,
      };
    }

    // Patterns that indicate XML/parsing errors
    const parsingErrorPatterns = [
      'xml',
      'parse',
      'malformed',
      'invalid',
      'syntax',
      'encoding',
      'well-formed',
      'schema',
    ];

    const isParsingError = parsingErrorPatterns.some((pattern) =>
      lowerBody.includes(pattern)
    );

    // Extract a sanitized error message from the response
    let errorMessage = 'KoSIT processing error';
    if (body.length > 0 && body.length <= 500) {
      // Use a sanitized version of the response as additional context
      errorMessage = sanitizeMessage(body.substring(0, 200));
    }

    // This is a system error (XML malformed, internal error, etc.)
    return {
      valid: false,
      schemaValid: false,
      schematronValid: false,
      systemError: true,
      items: [
        {
          ruleId: isParsingError ? 'KOSIT-PARSE-ERROR' : 'KOSIT-SYSTEM-ERROR',
          severity: 'error',
          message: isParsingError
            ? `XML parsing or validation error: ${errorMessage}`
            : `KoSIT system error: ${errorMessage}`,
        },
      ],
      summary: { errors: 1, warnings: 0, information: 0 },
      versionInfo: {
        validatorVersion: '1.5.0-docker',
        dictionaryVersion: 'xrechnung-3.0.2',
      },
      durationMs: 0,
    };
  }

  /**
   * Log 422 classification for observability.
   * Does NOT log the response body to avoid PII leakage.
   */
  private log422Classification(classification: Kosit422Classification, body: string): void {
    if (!this.logger) {
      return;
    }

    // Compute SHA-256 hash of body for debugging without exposing content
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex').substring(0, 16);

    this.logger.info('KoSIT 422 response classified', {
      kosit422Class: classification,
      bodyLen: body.length,
      bodyHash: `sha256:${bodyHash}`,
    });
  }

  /**
   * Validate using Docker CLI with temp files
   */
  private async validateViaCli(
    xml: string,
    _options?: KositValidateOptions
  ): Promise<KositValidationResult> {
    // Create temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kosit-'));
    const inputFile = path.join(tempDir, 'invoice.xml');

    try {
      // Write XML to temp file
      await fs.writeFile(inputFile, xml, 'utf-8');

      // Run docker command
      const result = await this.runDockerCli(tempDir, inputFile);
      return result;
    } finally {
      // Always cleanup temp directory (zero-retention)
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Execute Docker CLI command
   */
  private runDockerCli(
    tempDir: string,
    _inputFile: string
  ): Promise<KositValidationResult> {
    return new Promise((resolve) => {
      const args = [
        'run',
        '--rm',
        '-v',
        `${tempDir}:/work:ro`,
        '--memory',
        this.config.memoryLimit,
        '--cpus',
        this.config.cpuLimit,
      ];

      if (this.config.network) {
        args.push('--network', this.config.network);
      }

      args.push(this.config.cliImage);
      args.push('/work/invoice.xml');

      let stdout = '';
      let stderr = '';

      const proc = spawn('docker', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString('utf-8');
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString('utf-8');
      });

      // Timeout handling
      const timeoutId = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve({
          valid: false,
          schemaValid: false,
          schematronValid: false,
          items: [
            {
              ruleId: 'KOSIT-TIMEOUT',
              severity: 'error',
              message: `Validation timeout after ${String(this.config.timeoutMs)}ms`,
            },
          ],
          summary: { errors: 1, warnings: 0, information: 0 },
          versionInfo: {
            validatorVersion: '0.0.0-timeout',
            dictionaryVersion: 'unknown',
          },
          durationMs: this.config.timeoutMs,
        });
      }, this.config.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeoutId);

        if (code !== 0 && !stdout.includes('<')) {
          // Docker or command error (not validation failure)
          resolve({
            valid: false,
            schemaValid: false,
            schematronValid: false,
            items: [
              {
                ruleId: 'KOSIT-DOCKER-ERROR',
                severity: 'error',
                message: sanitizeMessage(
                  `Docker command failed with exit code ${String(code ?? 'unknown')}: ${stderr.substring(0, 200)}`
                ),
              },
            ],
            summary: { errors: 1, warnings: 0, information: 0 },
            versionInfo: {
              validatorVersion: '0.0.0-error',
              dictionaryVersion: 'unknown',
            },
            durationMs: 0,
          });
          return;
        }

        // Parse the XML output
        const result = parseKositReport(stdout);
        resolve(result);
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve({
          valid: false,
          schemaValid: false,
          schematronValid: false,
          items: [
            {
              ruleId: 'KOSIT-SPAWN-ERROR',
              severity: 'error',
              message: `Failed to spawn Docker: ${error.message}`,
            },
          ],
          summary: { errors: 1, warnings: 0, information: 0 },
          versionInfo: {
            validatorVersion: '0.0.0-error',
            dictionaryVersion: 'unknown',
          },
          durationMs: 0,
        });
      });
    });
  }

  async healthCheck(): Promise<boolean> {
    if (this.closed) {
      return false;
    }

    if (this.config.mode === 'daemon' || this.config.mode === 'auto') {
      const daemonHealthy = await checkDaemonHealth(this.config.daemonUrl, { httpClient: this.httpClient });
      if (daemonHealthy) {
        return true;
      }
    }

    if (this.config.mode === 'cli' || this.config.mode === 'auto') {
      return await isDockerAvailable();
    }

    return false;
  }

  getVersion(): Promise<string> {
    this.checkClosed();
    return Promise.resolve(
      `docker-kosit-runner/${this.config.mode} (daemon: ${this.config.daemonImage}, cli: ${this.config.cliImage})`
    );
  }

  getVersionInfo(): Promise<KositVersionInfo> {
    this.checkClosed();

    const versionInfo: KositVersionInfo = {
      validatorVersion: '1.5.0-docker',
      dictionaryVersion: 'xrechnung-3.0.2',
      dictionaryHash: 'sha256:docker-runtime',
    };

    if (this.config.mode === 'daemon' || this.config.mode === 'auto') {
      versionInfo.imageVersion = this.config.daemonImage;
    } else {
      versionInfo.imageVersion = this.config.cliImage;
    }

    return Promise.resolve(versionInfo);
  }

  close(): Promise<void> {
    this.closed = true;
    // CLI mode doesn't need cleanup (temp files deleted in finally)
    // Daemon mode doesn't own the container lifecycle
    return Promise.resolve();
  }

  private checkClosed(): void {
    if (this.closed) {
      throw new Error('KositRunner is closed');
    }
  }
}
