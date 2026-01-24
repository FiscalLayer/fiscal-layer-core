import type {
  KositRunner,
  KositRunnerConfig,
  KositValidateOptions,
  KositValidationResult,
  KositValidationItem,
  KositVersionInfo,
} from './types.js';

/**
 * Docker-specific configuration for KoSIT runner
 */
export interface DockerKositRunnerConfig extends KositRunnerConfig {
  /**
   * Docker image to use
   * @default "itplr/validator:latest"
   */
  image?: string;

  /**
   * Docker network to use
   */
  network?: string;

  /**
   * Container name prefix
   * @default "kosit-validator"
   */
  containerPrefix?: string;

  /**
   * Port for the validator HTTP API
   * @default 8080
   */
  port?: number;

  /**
   * Volume mount for scenarios
   */
  scenarioVolume?: string;

  /**
   * Memory limit for container
   * @default "512m"
   */
  memoryLimit?: string;

  /**
   * CPU limit for container
   * @default "1.0"
   */
  cpuLimit?: string;

  /**
   * Pull image on startup
   * @default true
   */
  pullOnStart?: boolean;

  /**
   * Remove container on close
   * @default true
   */
  removeOnClose?: boolean;
}

/**
 * DockerKositRunner runs the KoSIT validator in a Docker container.
 *
 * This implementation:
 * 1. Starts a KoSIT validator container (itplr/validator or custom)
 * 2. Sends XML documents via HTTP API
 * 3. Parses the validation report response
 *
 * Prerequisites:
 * - Docker must be installed and accessible
 * - The KoSIT validator image must be available
 *
 * The container exposes an HTTP API:
 * - POST /validate - Validate XML document
 * - GET /health - Health check
 * - GET /version - Version info
 *
 * TODO: Implement this class when Docker integration is required
 *
 * @example
 * ```typescript
 * const runner = new DockerKositRunner({
 *   image: 'itplr/validator:latest',
 *   port: 8080,
 *   scenarioVolume: '/path/to/scenarios:/scenarios',
 * });
 *
 * await runner.start();
 *
 * const result = await runner.validate(invoiceXml);
 *
 * await runner.close();
 * ```
 */
export class DockerKositRunner implements KositRunner {
  private readonly config: DockerKositRunnerConfig;
  private containerId: string | null = null;
  private baseUrl: string | null = null;
  private closed = false;

  constructor(config: DockerKositRunnerConfig = {}) {
    this.config = {
      image: 'itplr/validator:latest',
      containerPrefix: 'kosit-validator',
      port: 8080,
      memoryLimit: '512m',
      cpuLimit: '1.0',
      pullOnStart: true,
      removeOnClose: true,
      timeoutMs: 30000,
      ...config,
    };
  }

  /**
   * Start the Docker container.
   *
   * This should be called before validate().
   */
  async start(): Promise<void> {
    this.checkClosed();

    if (this.containerId) {
      throw new Error('Container already started');
    }

    // TODO: Implement Docker container startup
    //
    // 1. Check if Docker is available
    //    - Run: docker info
    //    - Throw if not available
    //
    // 2. Pull the image if needed
    //    - Run: docker pull ${this.config.image}
    //
    // 3. Start the container
    //    - Run: docker run -d \
    //             --name ${this.config.containerPrefix}-${Date.now()} \
    //             -p ${this.config.port}:8080 \
    //             -m ${this.config.memoryLimit} \
    //             --cpus ${this.config.cpuLimit} \
    //             ${this.config.scenarioVolume ? `-v ${this.config.scenarioVolume}` : ''} \
    //             ${this.config.image}
    //
    // 4. Wait for container to be ready
    //    - Poll health endpoint until ready
    //
    // 5. Store container ID and base URL
    //    this.containerId = '<container-id>';
    //    this.baseUrl = `http://localhost:${this.config.port}`;

    throw new Error(
      'DockerKositRunner not implemented. Use MockKositRunner for now.',
    );
  }

  async validate(
    xml: string,
    options?: KositValidateOptions,
  ): Promise<KositValidationResult> {
    this.checkClosed();

    if (!this.baseUrl) {
      throw new Error('Container not started. Call start() first.');
    }

    // TODO: Implement validation via HTTP API
    //
    // 1. Send POST request to ${this.baseUrl}/validate
    //    - Headers: Content-Type: application/xml
    //    - Body: xml
    //    - Query params: scenario, format (from options)
    //
    // 2. Parse the response (KoSIT validation report XML)
    //    - Extract errors, warnings from <rep:message> elements
    //    - Extract validation status
    //    - Map to KositValidationResult
    //
    // 3. Handle errors
    //    - Timeout
    //    - Container not responding
    //    - Invalid response format

    throw new Error(
      'DockerKositRunner not implemented. Use MockKositRunner for now.',
    );
  }

  async healthCheck(): Promise<boolean> {
    if (this.closed || !this.baseUrl) {
      return false;
    }

    // TODO: Implement health check
    //
    // 1. Send GET request to ${this.baseUrl}/health
    // 2. Return true if status 200
    // 3. Return false otherwise

    return false;
  }

  async getVersion(): Promise<string> {
    this.checkClosed();

    if (!this.baseUrl) {
      return 'docker-kosit-runner/0.0.0 (not started)';
    }

    // TODO: Implement version check
    //
    // 1. Send GET request to ${this.baseUrl}/version
    // 2. Parse and return version string

    return `docker-kosit-runner/0.0.0 (${this.config.image})`;
  }

  async getVersionInfo(): Promise<KositVersionInfo> {
    this.checkClosed();

    // TODO: Implement version info retrieval
    //
    // 1. Send GET request to ${this.baseUrl}/version
    // 2. Parse and return structured version info

    const versionInfo: KositVersionInfo = {
      validatorVersion: '0.0.0-docker',
      dictionaryVersion: 'unknown',
      dictionaryHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    if (this.config.image !== undefined) {
      versionInfo.imageVersion = this.config.image;
    }
    return versionInfo;
  }

  async close(): Promise<void> {
    if (this.closed) return;

    this.closed = true;

    if (this.containerId && this.config.removeOnClose) {
      // TODO: Stop and remove container
      //
      // 1. Run: docker stop ${this.containerId}
      // 2. Run: docker rm ${this.containerId}
    }

    this.containerId = null;
    this.baseUrl = null;
  }

  /**
   * Get the container ID (for debugging)
   */
  getContainerId(): string | null {
    return this.containerId;
  }

  /**
   * Get the base URL (for debugging)
   */
  getBaseUrl(): string | null {
    return this.baseUrl;
  }

  private checkClosed(): void {
    if (this.closed) {
      throw new Error('KositRunner is closed');
    }
  }
}

/**
 * Parse a KoSIT validation report XML into a KositValidationResult.
 *
 * TODO: Implement XML parsing when Docker runner is implemented.
 *
 * @param reportXml - The KoSIT validation report XML
 * @returns Parsed validation result
 */
export function parseKositReport(reportXml: string): KositValidationResult {
  // TODO: Parse the KoSIT validation report XML
  //
  // The report format is documented at:
  // https://github.com/itplr-kosit/validator
  //
  // Key elements to extract:
  // - <rep:assessment>
  //   - <rep:accept>true/false</rep:accept>
  // - <rep:scenarioMatched>
  //   - <rep:name>scenario name</rep:name>
  // - <rep:validationStepResult>
  //   - <rep:valid>true/false</rep:valid>
  //   - <rep:message> (repeating)
  //     - @level: error/warning/info
  //     - @code: rule ID
  //     - @location: XPath
  //     - text content: message

  throw new Error('parseKositReport not implemented');
}

/**
 * Check if Docker is available on this system.
 *
 * @returns True if Docker is available and accessible
 */
export async function isDockerAvailable(): Promise<boolean> {
  // TODO: Implement Docker availability check
  //
  // Run: docker info
  // Return true if exit code 0, false otherwise

  return false;
}
