/**
 * wasi:logging types and utilities
 *
 * The logging interface provides a simple API for emitting structured
 * log messages with severity levels and context grouping.
 */

/**
 * Log severity levels
 *
 * Ordered from most to least verbose:
 * - trace: Variable values and control flow
 * - debug: Information useful for debugging
 * - info: General operational information
 * - warn: Hazardous situations
 * - error: Serious errors
 * - critical: Fatal errors
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical'

/**
 * Numeric log level values for comparison
 * Higher numbers = more severe
 */
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  critical: 5,
}

/**
 * Convert a numeric log level to its name
 */
export function levelFromNumber(n: number): LogLevel {
  switch (n) {
    case 0:
      return 'trace'
    case 1:
      return 'debug'
    case 2:
      return 'info'
    case 3:
      return 'warn'
    case 4:
      return 'error'
    case 5:
      return 'critical'
    default:
      // Default to info for unknown values
      return 'info'
  }
}

/**
 * A single log entry
 */
export interface LogEntry {
  /**
   * When the log was recorded (monotonic nanoseconds or wall time)
   */
  timestamp: bigint

  /**
   * Severity level
   */
  level: LogLevel

  /**
   * Context string for grouping related messages
   */
  context: string

  /**
   * The log message
   */
  message: string
}

/**
 * Log sink interface for custom logging destinations
 */
export interface LogSink {
  /**
   * Handle a log entry
   */
  log(entry: LogEntry): void

  /**
   * Flush any buffered entries (optional)
   */
  flush?(): void | Promise<void>

  /**
   * Close the sink and release resources (optional)
   */
  close?(): void | Promise<void>
}

/**
 * Configuration for log level filtering
 */
export interface LogFilterConfig {
  /**
   * Minimum level to log (default: 'trace')
   */
  minLevel?: LogLevel

  /**
   * Context patterns to include (if set, only matching contexts are logged)
   */
  includeContexts?: string[]

  /**
   * Context patterns to exclude
   */
  excludeContexts?: string[]
}

/**
 * Check if a log level should be logged based on minimum level
 */
export function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_VALUES[level] >= LOG_LEVEL_VALUES[minLevel]
}

/**
 * Check if a context should be logged based on filter config
 */
export function shouldLogContext(context: string, config: LogFilterConfig): boolean {
  // Check exclusions first
  if (config.excludeContexts) {
    for (const pattern of config.excludeContexts) {
      if (contextMatches(context, pattern)) {
        return false
      }
    }
  }

  // If inclusions are specified, context must match one
  if (config.includeContexts && config.includeContexts.length > 0) {
    for (const pattern of config.includeContexts) {
      if (contextMatches(context, pattern)) {
        return true
      }
    }
    return false
  }

  return true
}

/**
 * Simple context pattern matching
 * Supports '*' as wildcard for any characters
 */
function contextMatches(context: string, pattern: string): boolean {
  if (pattern === '*') {
    return true
  }

  if (pattern.includes('*')) {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*')
    return new RegExp(`^${regexPattern}$`).test(context)
  }

  return context === pattern
}
