import { spawn } from 'node:child_process';
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
 */
export async function checkDaemonHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 3000);

    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
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
    'rep:valid'?: string | boolean;
    valid?: string | boolean;
    '@_id'?: string;
    'rep:id'?: string;
    'rep:message'?: ParsedMessage | ParsedMessage[];
    message?: ParsedMessage | ParsedMessage[];
  }

  interface ParsedReport {
    'rep:assessment'?: { 'rep:accept'?: string | boolean; accept?: string | boolean };
    assessment?: { 'rep:accept'?: string | boolean; accept?: string | boolean };
    'rep:scenarioMatched'?: { 'rep:name'?: string; name?: string };
    scenarioMatched?: { 'rep:name'?: string; name?: string };
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
    const assessment = report['rep:assessment'] ?? report.assessment ?? {};
    const accept =
      assessment['rep:accept'] === 'true' ||
      assessment.accept === 'true' ||
      assessment['rep:accept'] === true ||
      assessment.accept === true;

    // Extract scenario name
    const scenarioMatched =
      report['rep:scenarioMatched'] ?? report.scenarioMatched ?? {};
    const scenarioName: string =
      scenarioMatched['rep:name'] ??
      scenarioMatched.name ??
      'unknown';

    // Extract validation step results
    const items: KositValidationItem[] = [];
    let schemaValid = true;
    let schematronValid = true;

    const stepResults = report['rep:validationStepResult'] ??
      report.validationStepResult;
    const stepResultsArray: ParsedStep[] = Array.isArray(stepResults)
      ? stepResults
      : stepResults
        ? [stepResults]
        : [];

    for (const step of stepResultsArray) {
      const stepValid =
        step['rep:valid'] === 'true' ||
        step.valid === 'true' ||
        step['rep:valid'] === true ||
        step.valid === true;

      // Determine if this is schema or schematron step
      const stepId: string = step['@_id'] ?? step['rep:id'] ?? '';
      if (stepId.toLowerCase().includes('schema') && !stepValid) {
        schemaValid = false;
      }
      if (stepId.toLowerCase().includes('schematron') && !stepValid) {
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
        this.daemonHealthy = await checkDaemonHealth(this.config.daemonUrl);
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
      const response = await fetch(`${this.config.daemonUrl}/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
        },
        body: xml,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
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
      }

      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();

      // Parse response based on content type
      if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
        return parseKositReport(body);
      } else if (contentType.includes('application/json')) {
        // Some implementations return JSON
        return this.parseJsonResponse(body);
      } else {
        // Try XML parsing as fallback
        return parseKositReport(body);
      }
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
      const daemonHealthy = await checkDaemonHealth(this.config.daemonUrl);
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
