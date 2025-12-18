/**
 * OTLP (OpenTelemetry Protocol) logging implementation
 *
 * Exports log records via OpenTelemetry Protocol for:
 * - Integration with observability platforms (Jaeger, Datadog, New Relic)
 * - Correlation with traces and metrics
 * - Standardized telemetry collection
 *
 * Supports:
 * - OTLP/HTTP JSON export
 * - Batching for efficient network usage
 * - Resource and scope attributes
 * - Log record attributes
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  type LogLevel,
  type LogFilterConfig,
  levelFromNumber,
  shouldLog,
  shouldLogContext,
} from './types.js'

/**
 * OTLP severity number mapping
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 */
const OTLP_SEVERITY: Record<LogLevel, number> = {
  trace: 1,   // TRACE
  debug: 5,   // DEBUG
  info: 9,    // INFO
  warn: 13,   // WARN
  error: 17,  // ERROR
  critical: 21, // FATAL
}

/**
 * OTLP severity text mapping
 */
const OTLP_SEVERITY_TEXT: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  critical: 'FATAL',
}

/**
 * OTLP resource attributes
 */
export interface OtlpResource {
  /**
   * Service name (required for most backends)
   */
  'service.name'?: string

  /**
   * Service version
   */
  'service.version'?: string

  /**
   * Service instance ID
   */
  'service.instance.id'?: string

  /**
   * Deployment environment (production, staging, etc.)
   */
  'deployment.environment'?: string

  /**
   * Additional resource attributes
   */
  [key: string]: string | number | boolean | undefined
}

/**
 * OTLP instrumentation scope
 */
export interface OtlpScope {
  /**
   * Instrumentation library name
   */
  name: string

  /**
   * Instrumentation library version
   */
  version?: string
}

/**
 * Configuration for OTLP logging
 */
export interface OtlpLogConfig extends PluginConfig, LogFilterConfig {
  /**
   * OTLP endpoint URL
   * @default 'http://localhost:4318/v1/logs'
   */
  endpoint?: string

  /**
   * Request headers (e.g., for authentication)
   */
  headers?: Record<string, string>

  /**
   * Resource attributes identifying the service
   */
  resource?: OtlpResource

  /**
   * Instrumentation scope
   */
  scope?: OtlpScope

  /**
   * Batch size before sending
   * @default 10
   */
  batchSize?: number

  /**
   * Maximum time to wait before sending partial batch (ms)
   * @default 5000
   */
  batchTimeout?: number

  /**
   * Request timeout (ms)
   * @default 10000
   */
  requestTimeout?: number

  /**
   * Custom fetch function (for testing or custom transports)
   */
  fetchFn?: typeof fetch

  /**
   * Callback for export errors
   */
  onError?: (error: Error) => void

  /**
   * Callback for successful exports
   */
  onExport?: (count: number) => void
}

/**
 * OTLP log record (simplified)
 */
interface OtlpLogRecord {
  timeUnixNano: string
  severityNumber: number
  severityText: string
  body: { stringValue: string }
  attributes: Array<{ key: string; value: { stringValue: string } }>
}

/**
 * OTLP export request body
 */
interface OtlpExportLogsRequest {
  resourceLogs: Array<{
    resource: {
      attributes: Array<{ key: string; value: { stringValue: string } }>
    }
    scopeLogs: Array<{
      scope: {
        name: string
        version?: string
      }
      logRecords: OtlpLogRecord[]
    }>
  }>
}

/**
 * Convert resource attributes to OTLP format
 */
function resourceToOtlp(resource: OtlpResource): Array<{ key: string; value: { stringValue: string } }> {
  const attributes: Array<{ key: string; value: { stringValue: string } }> = []

  for (const [key, value] of Object.entries(resource)) {
    if (value !== undefined) {
      attributes.push({
        key,
        value: { stringValue: String(value) },
      })
    }
  }

  return attributes
}

/**
 * OTLP logging instance
 */
class OtlpLogInstance implements PluginInstance {
  private readonly minLevel: LogLevel
  private readonly filterConfig: LogFilterConfig
  private readonly endpoint: string
  private readonly headers: Record<string, string>
  private readonly resource: OtlpResource
  private readonly scope: OtlpScope
  private readonly batchSize: number
  private readonly batchTimeout: number
  private readonly requestTimeout: number
  private readonly fetchFn: typeof fetch
  private readonly onError?: (error: Error) => void
  private readonly onExport?: (count: number) => void

  private batch: OtlpLogRecord[] = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private exporting = false

  constructor(config: OtlpLogConfig) {
    this.minLevel = config.minLevel ?? 'trace'
    this.filterConfig = config
    this.endpoint = config.endpoint ?? 'http://localhost:4318/v1/logs'
    this.headers = config.headers ?? {}
    this.resource = config.resource ?? {
      'service.name': 'wasi-component',
    }
    this.scope = config.scope ?? {
      name: '@tegmentum/wasi-polyfill',
      version: '1.0.0',
    }
    this.batchSize = config.batchSize ?? 10
    this.batchTimeout = config.batchTimeout ?? 5000
    this.requestTimeout = config.requestTimeout ?? 10000
    this.fetchFn = config.fetchFn ?? fetch
    if (config.onError !== undefined) {
      this.onError = config.onError
    }
    if (config.onExport !== undefined) {
      this.onExport = config.onExport
    }
  }

  getImports(): Record<string, unknown> {
    return {
      log: this.log.bind(this),
    }
  }

  destroy(): void {
    // Flush remaining batch
    this.flush()

    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
  }

  /**
   * Log a message via OTLP
   */
  private log(level: number, context: string, message: string): void {
    const levelName = levelFromNumber(level)

    // Check level filter
    if (!shouldLog(levelName, this.minLevel)) {
      return
    }

    // Check context filter
    if (!shouldLogContext(context, this.filterConfig)) {
      return
    }

    // Get timestamp
    const timestamp = this.getTimestamp()

    // Create OTLP log record
    const record: OtlpLogRecord = {
      timeUnixNano: timestamp.toString(),
      severityNumber: OTLP_SEVERITY[levelName],
      severityText: OTLP_SEVERITY_TEXT[levelName],
      body: { stringValue: message },
      attributes: [],
    }

    // Add context as attribute if non-empty
    if (context) {
      record.attributes.push({
        key: 'log.context',
        value: { stringValue: context },
      })
    }

    // Add to batch
    this.batch.push(record)

    // Schedule export if batch is full
    if (this.batch.length >= this.batchSize) {
      this.exportBatch()
    } else if (!this.batchTimer) {
      // Start timeout for partial batch
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null
        this.exportBatch()
      }, this.batchTimeout)
    }
  }

  /**
   * Get current timestamp in nanoseconds
   */
  private getTimestamp(): bigint {
    // Use high-resolution time if available
    if (typeof performance !== 'undefined') {
      const perfNow = performance.now()
      const baseTime = Date.now() - perfNow
      return BigInt(Math.floor((baseTime + perfNow) * 1_000_000))
    }
    return BigInt(Date.now()) * 1_000_000n
  }

  /**
   * Export current batch
   */
  private exportBatch(): void {
    if (this.batch.length === 0 || this.exporting) {
      return
    }

    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    // Take the batch
    const records = this.batch
    this.batch = []
    const count = records.length

    // Build request
    const request: OtlpExportLogsRequest = {
      resourceLogs: [
        {
          resource: {
            attributes: resourceToOtlp(this.resource),
          },
          scopeLogs: [
            {
              scope: this.scope.version !== undefined
                ? { name: this.scope.name, version: this.scope.version }
                : { name: this.scope.name },
              logRecords: records,
            },
          ],
        },
      ],
    }

    // Send async (don't block logging)
    this.exporting = true
    this.sendRequest(request, count).finally(() => {
      this.exporting = false
    })
  }

  /**
   * Send export request
   */
  private async sendRequest(request: OtlpExportLogsRequest, count: number): Promise<void> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout)

    try {
      const response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`OTLP export failed: HTTP ${response.status}`)
      }

      this.onExport?.(count)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.onError?.(err)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Flush all pending logs
   */
  flush(): void {
    this.exportBatch()
  }

  /**
   * Get the number of pending log records
   */
  get pendingCount(): number {
    return this.batch.length
  }
}

/**
 * OTLP logging implementation
 *
 * Exports logs via OpenTelemetry Protocol for integration
 * with observability platforms.
 */
export const otlpLogImplementation: Implementation = {
  name: 'otlp',
  description: 'OpenTelemetry Protocol logging for observability platforms',
  create(config: PluginConfig): PluginInstance {
    return new OtlpLogInstance(config as OtlpLogConfig)
  },
}

/**
 * Create an OTLP logger with test capture
 *
 * Useful for testing:
 * ```typescript
 * const { instance, requests, flush } = createOtlpTestLogger()
 * const imports = instance.getImports()
 *
 * imports.log(2, 'test', 'Hello!')
 * await flush()
 *
 * expect(requests.length).toBe(1)
 * ```
 */
export function createOtlpTestLogger(
  config?: Omit<OtlpLogConfig, 'endpoint' | 'fetchFn'>
): {
  instance: PluginInstance
  requests: OtlpExportLogsRequest[]
  flush: () => Promise<void>
} {
  const requests: OtlpExportLogsRequest[] = []

  const mockFetch = async (_url: string, init?: RequestInit): Promise<Response> => {
    if (init?.body) {
      requests.push(JSON.parse(init.body as string) as OtlpExportLogsRequest)
    }
    return new Response('{}', { status: 200 })
  }

  const instanceConfig: OtlpLogConfig = {
    ...(config ?? {}),
    endpoint: 'http://test/v1/logs',
    fetchFn: mockFetch as typeof fetch,
  }

  // Set test-friendly batch defaults
  if (instanceConfig.batchSize === undefined) {
    instanceConfig.batchSize = 1 // Immediate export for tests
  }
  if (instanceConfig.batchTimeout === undefined) {
    instanceConfig.batchTimeout = 0
  }

  const instance = new OtlpLogInstance(instanceConfig)

  const flush = async (): Promise<void> => {
    (instance as OtlpLogInstance).flush()
    // Wait for async export
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  return { instance, requests, flush }
}
