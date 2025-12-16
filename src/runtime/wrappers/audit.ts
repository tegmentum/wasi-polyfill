/**
 * Audit wrapper for providers
 *
 * Logs all method calls with arguments, results, and durations.
 * Supports redaction of sensitive data.
 */

import type {
  Provider,
  ProviderContext,
  Logger,
} from '../provider.js'
import type { Redactor } from '../policy.js'
import { formatInterfaceString } from '../../core/types.js'

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  /** Timestamp of the call */
  timestamp: number
  /** Provider ID */
  providerId: string
  /** Interface being called */
  interface: string
  /** Method name */
  method: string
  /** Call arguments (may be redacted) */
  args: unknown[]
  /** Call result (may be redacted) */
  result?: unknown
  /** Error if the call failed */
  error?: string
  /** Duration in milliseconds */
  durationMs: number
  /** Additional context */
  context?: Record<string, unknown>
}

/**
 * Audit sink interface for receiving log entries
 */
export interface AuditSink {
  /** Log an audit entry */
  log(entry: AuditLogEntry): void
  /** Flush any buffered entries */
  flush?(): void | Promise<void>
}

/**
 * Console audit sink - logs to console
 */
export class ConsoleAuditSink implements AuditSink {
  private readonly logger: Logger

  constructor(logger?: Logger) {
    this.logger = logger ?? console
  }

  log(entry: AuditLogEntry): void {
    const status = entry.error ? 'FAILED' : 'OK'
    const msg = `[AUDIT] ${entry.providerId}.${entry.method} ${status} (${entry.durationMs.toFixed(2)}ms)`

    if (entry.error) {
      this.logger.warn(msg, { error: entry.error, args: entry.args })
    } else {
      this.logger.debug(msg, { args: entry.args, result: entry.result })
    }
  }
}

/**
 * Array audit sink - collects entries in memory
 */
export class ArrayAuditSink implements AuditSink {
  readonly entries: AuditLogEntry[] = []
  private readonly maxEntries: number

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries
  }

  log(entry: AuditLogEntry): void {
    this.entries.push(entry)

    // Trim if over max
    if (this.entries.length > this.maxEntries) {
      this.entries.shift()
    }
  }

  clear(): void {
    this.entries.length = 0
  }

  getEntries(): AuditLogEntry[] {
    return [...this.entries]
  }

  getEntriesForMethod(method: string): AuditLogEntry[] {
    return this.entries.filter((e) => e.method === method)
  }

  getEntriesForProvider(providerId: string): AuditLogEntry[] {
    return this.entries.filter((e) => e.providerId === providerId)
  }

  getFailedEntries(): AuditLogEntry[] {
    return this.entries.filter((e) => e.error !== undefined)
  }
}

/**
 * Audit wrapper configuration
 */
export interface AuditWrapperConfig {
  /** Audit sink to receive log entries */
  sink: AuditSink
  /** Redactor for sensitive data (optional) */
  redactor?: Redactor
  /** Whether to log arguments */
  logArgs?: boolean
  /** Whether to log results */
  logResults?: boolean
  /** Methods to exclude from logging */
  excludeMethods?: string[]
  /** Additional context to include in all entries */
  context?: Record<string, unknown>
}

/**
 * Redact a value for logging
 */
function redactValue(value: unknown, redactor?: Redactor): unknown {
  if (!redactor) {
    return value
  }

  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'string') {
    return value // Strings are logged as-is; specific redaction happens at higher level
  }

  if (value instanceof Uint8Array) {
    return `<Uint8Array(${value.length})>`
  }

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, redactor))
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      // Redact common sensitive keys
      if (/password|secret|key|token|auth/i.test(k)) {
        result[k] = '[REDACTED]'
      } else {
        result[k] = redactValue(v, redactor)
      }
    }
    return result
  }

  return value
}

/**
 * Create an audited version of a provider
 *
 * Wraps all methods to log calls, arguments, results, and durations.
 */
export function createAuditWrapper(
  provider: Provider,
  config: AuditWrapperConfig
): Provider {
  const {
    sink,
    redactor,
    logArgs = true,
    logResults = false,
    excludeMethods = [],
    context = {},
  } = config

  const interfaceStr = formatInterfaceString(provider.witInterface)
  const excludeSet = new Set(excludeMethods)

  // Get the original imports
  const originalImports = provider.getImports()

  // Wrap each method
  const wrappedImports: Record<string, unknown> = {}

  for (const [methodName, method] of Object.entries(originalImports)) {
    if (typeof method !== 'function') {
      wrappedImports[methodName] = method
      continue
    }

    if (excludeSet.has(methodName)) {
      wrappedImports[methodName] = method
      continue
    }

    // Create wrapped method
    wrappedImports[methodName] = (...args: unknown[]) => {
      const startTime = performance.now()
      const timestamp = Date.now()

      try {
        const result = (method as (...args: unknown[]) => unknown)(...args)

        // Handle async results
        if (result instanceof Promise) {
          return result
            .then((asyncResult) => {
              const durationMs = performance.now() - startTime

              sink.log({
                timestamp,
                providerId: provider.id,
                interface: interfaceStr,
                method: methodName,
                args: logArgs ? args.map((a) => redactValue(a, redactor)) : [],
                result: logResults ? redactValue(asyncResult, redactor) : undefined,
                durationMs,
                context,
              })

              return asyncResult
            })
            .catch((error) => {
              const durationMs = performance.now() - startTime

              sink.log({
                timestamp,
                providerId: provider.id,
                interface: interfaceStr,
                method: methodName,
                args: logArgs ? args.map((a) => redactValue(a, redactor)) : [],
                error: error instanceof Error ? error.message : String(error),
                durationMs,
                context,
              })

              throw error
            })
        }

        // Sync result
        const durationMs = performance.now() - startTime

        sink.log({
          timestamp,
          providerId: provider.id,
          interface: interfaceStr,
          method: methodName,
          args: logArgs ? args.map((a) => redactValue(a, redactor)) : [],
          result: logResults ? redactValue(result, redactor) : undefined,
          durationMs,
          context,
        })

        return result
      } catch (error) {
        const durationMs = performance.now() - startTime

        sink.log({
          timestamp,
          providerId: provider.id,
          interface: interfaceStr,
          method: methodName,
          args: logArgs ? args.map((a) => redactValue(a, redactor)) : [],
          error: error instanceof Error ? error.message : String(error),
          durationMs,
          context,
        })

        throw error
      }
    }
  }

  // Return wrapped provider
  return {
    id: provider.id,
    witInterface: provider.witInterface,
    state: provider.state,
    capabilities: () => provider.capabilities(),
    init: (ctx: ProviderContext) => provider.init(ctx),
    getImports: () => wrappedImports,
    close: () => provider.close(),
  }
}

/**
 * Wrap a provider with audit logging
 */
export function withAudit(
  provider: Provider,
  sink: AuditSink,
  options?: Partial<Omit<AuditWrapperConfig, 'sink'>>
): Provider {
  return createAuditWrapper(provider, { sink, ...options })
}
