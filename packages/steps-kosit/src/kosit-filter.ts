import type { Filter, FilterContext, StepResult, Diagnostic } from '@fiscal-layer/contracts';
import type { KositRunner, KositRunnerConfig, KositValidateOptions } from './types.js';
import { kositItemsToDiagnostics } from './types.js';
import { MockKositRunner } from './mock-kosit-runner.js';
import { DockerKositRunner, type DockerKositRunnerConfig } from './docker-kosit-runner.js';

/**
 * KoSIT filter configuration
 */
export interface KositFilterConfig extends KositRunnerConfig, Partial<DockerKositRunnerConfig> {
  /**
   * Runner type to use
   * @default 'mock'
   */
  runnerType?: 'mock' | 'docker' | 'native';

  /**
   * Pre-configured runner instance
   * If provided, runnerType is ignored
   */
  runner?: KositRunner;

  /**
   * Fail on warnings
   * @default false
   */
  failOnWarnings?: boolean;

  /**
   * Include raw output in metadata
   * @default false
   */
  includeRawOutput?: boolean;
}

/**
 * Create the KoSIT validation filter.
 *
 * This filter validates invoices against the KoSIT validator,
 * checking both XML schema and Schematron rules.
 *
 * @param config - Filter configuration
 * @returns The configured filter
 */
export function createKositFilter(config: KositFilterConfig = {}): Filter {
  let runner: KositRunner | null = null;

  return {
    id: 'kosit',
    name: 'KoSIT Validator',
    version: '1.0.0',
    description: 'Validates invoices using the KoSIT validator (XRechnung/EN16931)',
    tags: ['validation', 'schema', 'schematron', 'xrechnung'],

    async onInit() {
      if (config.runner) {
        runner = config.runner;
      } else {
        // Create runner based on type
        switch (config.runnerType) {
          case 'docker': {
            const dockerConfig: DockerKositRunnerConfig = {};
            if (config.mode !== undefined) dockerConfig.mode = config.mode;
            if (config.daemonUrl !== undefined) dockerConfig.daemonUrl = config.daemonUrl;
            if (config.daemonImage !== undefined) dockerConfig.daemonImage = config.daemonImage;
            if (config.cliImage !== undefined) dockerConfig.cliImage = config.cliImage;
            if (config.network !== undefined) dockerConfig.network = config.network;
            if (config.memoryLimit !== undefined) dockerConfig.memoryLimit = config.memoryLimit;
            if (config.cpuLimit !== undefined) dockerConfig.cpuLimit = config.cpuLimit;
            if (config.timeoutMs !== undefined) dockerConfig.timeoutMs = config.timeoutMs;
            runner = new DockerKositRunner(dockerConfig);
            break;
          }
          case 'native':
            // TODO: Use NativeKositRunner when implemented
            throw new Error(
              'Native runner not implemented. Use "mock" or provide a custom runner.',
            );
          case 'mock':
          default:
            runner = new MockKositRunner(config);
        }
      }

      // Health check
      const healthy = await runner.healthCheck();
      if (!healthy) {
        throw new Error('KoSIT runner health check failed');
      }
    },

    async onDestroy() {
      if (runner && !config.runner) {
        // Only close if we created the runner
        await runner.close();
      }
      runner = null;
    },

    async execute(context: FilterContext): Promise<StepResult> {
      if (!runner) {
        return {
          filterId: 'kosit',
          status: 'error',
          diagnostics: [],
          durationMs: 0,
          error: {
            name: 'RunnerNotInitialized',
            message: 'KoSIT runner not initialized. Call onInit() first.',
          },
        };
      }

      const startTime = Date.now();
      const diagnostics: Diagnostic[] = [];

      try {
        // Get the raw invoice XML
        const rawXml = context.rawInvoice.content;

        if (!rawXml || rawXml.trim().length === 0) {
          return {
            filterId: 'kosit',
            status: 'failed',
            diagnostics: [
              {
                code: 'KOSIT-001',
                message: 'Empty invoice content',
                severity: 'error',
                category: 'schema',
                source: 'kosit',
              },
            ],
            durationMs: Date.now() - startTime,
          };
        }

        // Map InvoiceFormat to KoSIT format
        const formatHint = context.rawInvoice.formatHint;
        const validateOptions: KositValidateOptions = {};
        if (formatHint === 'xrechnung') validateOptions.format = 'xrechnung';
        else if (formatHint === 'zugferd') validateOptions.format = 'zugferd';
        else if (formatHint === 'peppol-bis') validateOptions.format = 'peppol';
        else if (formatHint === 'ubl') validateOptions.format = 'ubl';
        else if (formatHint === 'cii') validateOptions.format = 'cii';
        // 'unknown' leaves format undefined (no hint)

        if (config.includeRawOutput === true) {
          validateOptions.includeRawOutput = true;
        }

        // Run validation
        const result = await runner.validate(rawXml, validateOptions);

        // Check for fallback event (DockerKositRunner in auto mode)
        let fallbackEvent: { code: string; reason: string; fallbackMode: string } | undefined;
        if (runner instanceof DockerKositRunner) {
          const event = runner.getLastFallbackEvent();
          if (event) {
            fallbackEvent = {
              code: event.code,
              reason: event.reason,
              fallbackMode: event.fallbackMode,
            };
            // Add info diagnostic about fallback
            diagnostics.push({
              code: event.code,
              message: `KoSIT daemon unavailable, using CLI fallback: ${event.reason}`,
              severity: 'info',
              category: 'internal',
              source: 'kosit',
              context: {
                fallbackMode: event.fallbackMode,
                timestamp: event.timestamp,
              },
            });
          }
        }

        // Convert KoSIT items to diagnostics
        const kositDiagnostics = kositItemsToDiagnostics(result.items, 'kosit');
        diagnostics.push(...kositDiagnostics);

        // Determine status
        let status: StepResult['status'];
        if (!result.valid) {
          status = 'failed';
        } else if (result.summary.warnings > 0 && config.failOnWarnings) {
          status = 'failed';
        } else if (result.summary.warnings > 0) {
          status = 'warning';
        } else {
          status = 'passed';
        }

        return {
          filterId: 'kosit',
          filterVersion: '1.0.0',
          status,
          diagnostics,
          durationMs: Date.now() - startTime,
          metadata: {
            profile: result.profile,
            validatorVersion: result.versionInfo.validatorVersion,
            scenarioName: result.scenarioName,
            schemaValid: result.schemaValid,
            schematronValid: result.schematronValid,
            summary: result.summary,
            ...(config.includeRawOutput && result.rawOutput
              ? { rawOutput: result.rawOutput }
              : {}),
            ...(fallbackEvent ? { fallbackEvent } : {}),
          },
        };
      } catch (error) {
        const err = error as Error;
        const errorInfo: { name: string; message: string; stack?: string } = {
          name: err.name,
          message: err.message,
        };
        if (err.stack !== undefined) {
          errorInfo.stack = err.stack;
        }
        return {
          filterId: 'kosit',
          filterVersion: '1.0.0',
          status: 'error',
          diagnostics: [
            {
              code: 'KOSIT-ERR',
              message: `KoSIT validation error: ${err.message}`,
              severity: 'error',
              category: 'internal',
              source: 'kosit',
            },
          ],
          durationMs: Date.now() - startTime,
          error: errorInfo,
        };
      }
    },
  };
}
