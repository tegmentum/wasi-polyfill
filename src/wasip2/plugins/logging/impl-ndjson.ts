/**
 * NDJSON (Newline-Delimited JSON) logging implementation
 *
 * Outputs log entries as newline-delimited JSON for:
 * - Integration with log aggregation systems (ELK, Splunk, Loki)
 * - Structured log storage and querying
 * - Stream processing with tools like jq
 *
 * Each log entry is formatted as a single JSON line:
 * {"timestamp":"2024-01-15T10:30:00.000Z","level":"info","context":"app","message":"Hello"}
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  type LogLevel,
  type LogEntry,
  type LogSink,
  type LogFilterConfig,
  levelFromNumber,
  shouldLog,
  shouldLogContext,
} from './types.js'

/**
 * NDJSON field mapping configuration
 */
export interface NdjsonFieldMapping {
  /**
   * Field name for timestamp (default: 'timestamp')
   */
  timestamp?: string

  /**
   * Field name for level (default: 'level')
   */
  level?: string

  /**
   * Field name for context (default: 'context')
   */
  context?: string

  /**
   * Field name for message (default: 'message')
   */
  message?: string
}

/**
 * NDJSON timestamp format
 */
export type NdjsonTimestampFormat = 'iso' | 'unix' | 'unix_ms' | 'unix_ns'

/**
 * Configuration for NDJSON logging
 */
export interface NdjsonLogConfig extends PluginConfig, LogFilterConfig {
  /**
   * Output sink for NDJSON lines
   * @default console.log
   */
  output?: (line: string) => void

  /**
   * Custom log sink that receives parsed entries
   */
  sink?: LogSink

  /**
   * Timestamp format
   * @default 'iso'
   */
  timestampFormat?: NdjsonTimestampFormat

  /**
   * Field name mapping
   */
  fields?: NdjsonFieldMapping

  /**
   * Additional static fields to include in every log entry
   */
  staticFields?: Record<string, unknown>

  /**
   * Whether to include context only when non-empty
   * @default true
   */
  omitEmptyContext?: boolean

  /**
   * Pretty print JSON (for debugging, not recommended for production)
   * @default false
   */
  pretty?: boolean
}

/**
 * NDJSON formatted log entry
 */
/**
 * NDJSON log entry - flexible type for dynamic field mapping
 * The actual fields depend on the configured field names
 */
export type NdjsonLogEntry = Record<string, unknown>

/**
 * Format timestamp according to configuration
 */
function formatTimestamp(timestamp: bigint, format: NdjsonTimestampFormat): string | number {
  switch (format) {
    case 'iso':
      // Convert nanoseconds to milliseconds for Date
      return new Date(Number(timestamp / 1_000_000n)).toISOString()
    case 'unix':
      return Number(timestamp / 1_000_000_000n)
    case 'unix_ms':
      return Number(timestamp / 1_000_000n)
    case 'unix_ns':
      return Number(timestamp)
    default:
      return new Date(Number(timestamp / 1_000_000n)).toISOString()
  }
}

/**
 * NDJSON logging instance
 */
class NdjsonLogInstance implements PluginInstance {
  private readonly minLevel: LogLevel
  private readonly filterConfig: LogFilterConfig
  private readonly output: (line: string) => void
  private readonly sink?: LogSink
  private readonly timestampFormat: NdjsonTimestampFormat
  private readonly fields: Required<NdjsonFieldMapping>
  private readonly staticFields: Record<string, unknown>
  private readonly omitEmptyContext: boolean
  private readonly pretty: boolean
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: NdjsonLogConfig) {
    this.minLevel = config.minLevel ?? 'trace'
    this.filterConfig = config
    this.output = config.output ?? ((line) => console.log(line))
    if (config.sink !== undefined) {
      this.sink = config.sink
    }
    this.timestampFormat = config.timestampFormat ?? 'iso'
    this.fields = {
      timestamp: config.fields?.timestamp ?? 'timestamp',
      level: config.fields?.level ?? 'level',
      context: config.fields?.context ?? 'context',
      message: config.fields?.message ?? 'message',
    }
    this.staticFields = config.staticFields ?? {}
    this.omitEmptyContext = config.omitEmptyContext ?? true
    this.pretty = config.pretty ?? false
  }

  getImports(): Record<string, unknown> {
    return {
      log: this.log.bind(this),
    }
  }

  destroy(): void {
    this.flush()
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  /**
   * Log a message in NDJSON format
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

    // Create log entry
    const entry: LogEntry = {
      timestamp,
      level: levelName,
      context,
      message,
    }

    // Forward to sink if provided
    if (this.sink) {
      this.sink.log(entry)
    }

    // Build NDJSON object
    const ndjsonEntry: NdjsonLogEntry = {
      [this.fields.timestamp]: formatTimestamp(timestamp, this.timestampFormat),
      [this.fields.level]: levelName,
      [this.fields.message]: message,
      ...this.staticFields,
    }

    // Add context if non-empty or if we're not omitting empty contexts
    if (context || !this.omitEmptyContext) {
      ndjsonEntry[this.fields.context] = context
    }

    // Serialize to JSON
    const line = this.pretty
      ? JSON.stringify(ndjsonEntry, null, 2)
      : JSON.stringify(ndjsonEntry)

    // Output
    this.output(line)
  }

  /**
   * Get current timestamp in nanoseconds
   */
  private getTimestamp(): bigint {
    if (typeof performance !== 'undefined') {
      return BigInt(Math.floor(performance.now() * 1_000_000))
    }
    return BigInt(Date.now()) * 1_000_000n
  }

  /**
   * Flush any pending output
   */
  flush(): void {
    if (this.sink?.flush) {
      this.sink.flush()
    }
  }
}

/**
 * NDJSON logging implementation
 *
 * Outputs log entries as newline-delimited JSON.
 * Compatible with log aggregation systems like ELK, Splunk, and Loki.
 */
export const ndjsonLogImplementation: Implementation = {
  name: 'ndjson',
  description: 'Newline-delimited JSON logging for log aggregation systems',
  create(config: PluginConfig): PluginInstance {
    return new NdjsonLogInstance(config as NdjsonLogConfig)
  },
}

/**
 * Create an NDJSON log collector that captures entries
 *
 * Useful for testing:
 * ```typescript
 * const { instance, lines } = createNdjsonCollector()
 * const imports = instance.getImports()
 *
 * imports.log(2, 'test', 'Hello!')
 *
 * expect(lines.length).toBe(1)
 * expect(JSON.parse(lines[0]).message).toBe('Hello!')
 * ```
 */
export function createNdjsonCollector(
  config?: Omit<NdjsonLogConfig, 'output'>
): { instance: PluginInstance; lines: string[]; entries: NdjsonLogEntry[] } {
  const lines: string[] = []
  const entries: NdjsonLogEntry[] = []

  const instance = new NdjsonLogInstance({
    ...config,
    output: (line) => {
      lines.push(line)
      entries.push(JSON.parse(line) as NdjsonLogEntry)
    },
  })

  return { instance, lines, entries }
}

/**
 * Create a file-based NDJSON logger (for Node.js or environments with file access)
 *
 * Note: This creates a writer function that buffers writes.
 * Use the flush method to ensure all data is written.
 */
export function createNdjsonFileWriter(
  writeFile: (path: string, content: string) => Promise<void>,
  filePath: string,
  config?: Omit<NdjsonLogConfig, 'output'>
): { instance: PluginInstance; flush: () => Promise<void> } {
  const buffer: string[] = []
  let flushPromise: Promise<void> | null = null

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return

    const content = buffer.join('\n') + '\n'
    buffer.length = 0

    await writeFile(filePath, content)
  }

  const instance = new NdjsonLogInstance({
    ...config,
    output: (line) => {
      buffer.push(line)
      // Auto-flush when buffer gets large
      if (buffer.length >= 100 && !flushPromise) {
        flushPromise = flush().finally(() => {
          flushPromise = null
        })
      }
    },
  })

  return { instance, flush }
}
