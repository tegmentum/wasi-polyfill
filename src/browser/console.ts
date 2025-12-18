/**
 * browser:console - Structured logging interface
 *
 * Provides a capability-scoped interface to browser console logging
 * without requiring DOM access.
 *
 * @packageDocumentation
 */

// =============================================================================
// Log Level
// =============================================================================

/**
 * Log level for console output.
 */
export enum LogLevel {
  /** Verbose debug information */
  DEBUG = 'debug',
  /** General information */
  INFO = 'info',
  /** Warning messages */
  WARN = 'warn',
  /** Error messages */
  ERROR = 'error',
  /** Trace/verbose logging */
  TRACE = 'trace',
}

// =============================================================================
// Log Parts (Structured Logging)
// =============================================================================

/**
 * Log part for structured logging.
 */
export type LogPart =
  | { tag: 'text'; value: string }
  | { tag: 'number'; value: number }
  | { tag: 'boolean'; value: boolean }
  | { tag: 'bytes'; value: Uint8Array }
  | { tag: 'object'; value: Record<string, unknown> }
  | { tag: 'array'; value: unknown[] }
  | { tag: 'null' }
  | { tag: 'undefined' }

/**
 * Convert a LogPart to a value suitable for console output.
 */
function logPartToValue(part: LogPart): unknown {
  switch (part.tag) {
    case 'text':
      return part.value
    case 'number':
      return part.value
    case 'boolean':
      return part.value
    case 'bytes':
      return `[Uint8Array(${part.value.length})]`
    case 'object':
      return part.value
    case 'array':
      return part.value
    case 'null':
      return null
    case 'undefined':
      return undefined
  }
}

// =============================================================================
// Console Logger
// =============================================================================

/**
 * Configuration for the console logger.
 */
export interface ConsoleLoggerConfig {
  /** Minimum log level to output (default: debug) */
  minLevel?: LogLevel
  /** Prefix for all log messages */
  prefix?: string
  /** Whether to include timestamps (default: false) */
  timestamps?: boolean
  /** Custom console object (for testing) */
  console?: Console
}

/**
 * Console logger instance.
 */
export class ConsoleLogger {
  private config: Required<Omit<ConsoleLoggerConfig, 'console'>> & { console: Console }
  private timers: Map<string, number> = new Map()

  constructor(config: ConsoleLoggerConfig = {}) {
    this.config = {
      minLevel: config.minLevel ?? LogLevel.DEBUG,
      prefix: config.prefix ?? '',
      timestamps: config.timestamps ?? false,
      console: config.console ?? globalThis.console,
    }
  }

  /**
   * Check if a log level should be output.
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.TRACE, LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR]
    const minIndex = levels.indexOf(this.config.minLevel)
    const levelIndex = levels.indexOf(level)
    return levelIndex >= minIndex
  }

  /**
   * Format a message with prefix and optional timestamp.
   */
  private formatMessage(message: string): string {
    let result = message

    if (this.config.prefix) {
      result = `${this.config.prefix} ${result}`
    }

    if (this.config.timestamps) {
      const timestamp = new Date().toISOString()
      result = `[${timestamp}] ${result}`
    }

    return result
  }

  /**
   * Log a message at the specified level.
   */
  log(level: LogLevel, message: string): void {
    if (!this.shouldLog(level)) {
      return
    }

    const formattedMessage = this.formatMessage(message)

    switch (level) {
      case LogLevel.TRACE:
        this.config.console.trace(formattedMessage)
        break
      case LogLevel.DEBUG:
        this.config.console.debug(formattedMessage)
        break
      case LogLevel.INFO:
        this.config.console.info(formattedMessage)
        break
      case LogLevel.WARN:
        this.config.console.warn(formattedMessage)
        break
      case LogLevel.ERROR:
        this.config.console.error(formattedMessage)
        break
    }
  }

  /**
   * Log structured data at the specified level.
   */
  logStructured(level: LogLevel, parts: LogPart[]): void {
    if (!this.shouldLog(level)) {
      return
    }

    const values = parts.map(logPartToValue)
    const prefix = this.config.prefix ? `${this.config.prefix} ` : ''
    const timestamp = this.config.timestamps ? `[${new Date().toISOString()}] ` : ''
    const fullPrefix = `${timestamp}${prefix}`

    switch (level) {
      case LogLevel.TRACE:
        this.config.console.trace(fullPrefix, ...values)
        break
      case LogLevel.DEBUG:
        this.config.console.debug(fullPrefix, ...values)
        break
      case LogLevel.INFO:
        this.config.console.info(fullPrefix, ...values)
        break
      case LogLevel.WARN:
        this.config.console.warn(fullPrefix, ...values)
        break
      case LogLevel.ERROR:
        this.config.console.error(fullPrefix, ...values)
        break
    }
  }

  /**
   * Start a timer with the given label.
   */
  time(label: string): void {
    this.timers.set(label, performance.now())
  }

  /**
   * End a timer and log the elapsed time.
   */
  timeEnd(label: string): void {
    const start = this.timers.get(label)
    if (start === undefined) {
      this.config.console.warn(`Timer '${label}' does not exist`)
      return
    }

    const elapsed = performance.now() - start
    this.timers.delete(label)
    this.log(LogLevel.INFO, `${label}: ${elapsed.toFixed(2)}ms`)
  }

  /**
   * Log the elapsed time without ending the timer.
   */
  timeLog(label: string, message?: string): void {
    const start = this.timers.get(label)
    if (start === undefined) {
      this.config.console.warn(`Timer '${label}' does not exist`)
      return
    }

    const elapsed = performance.now() - start
    const msg = message ? `${label}: ${elapsed.toFixed(2)}ms - ${message}` : `${label}: ${elapsed.toFixed(2)}ms`
    this.log(LogLevel.INFO, msg)
  }

  /**
   * Create a new group (collapsed by default).
   */
  group(label: string): void {
    const formattedLabel = this.formatMessage(label)
    this.config.console.groupCollapsed(formattedLabel)
  }

  /**
   * Create a new expanded group.
   */
  groupExpanded(label: string): void {
    const formattedLabel = this.formatMessage(label)
    this.config.console.group(formattedLabel)
  }

  /**
   * End the current group.
   */
  groupEnd(): void {
    this.config.console.groupEnd()
  }

  /**
   * Clear the console.
   */
  clear(): void {
    this.config.console.clear()
  }

  /**
   * Log a count for the given label.
   */
  count(label: string): void {
    this.config.console.count(label)
  }

  /**
   * Reset a count for the given label.
   */
  countReset(label: string): void {
    this.config.console.countReset(label)
  }

  /**
   * Log a table (for array/object data).
   */
  table(data: unknown[], columns?: string[]): void {
    if (columns) {
      this.config.console.table(data, columns)
    } else {
      this.config.console.table(data)
    }
  }

  /**
   * Assert a condition, logging an error if false.
   */
  assert(condition: boolean, message: string): void {
    this.config.console.assert(condition, this.formatMessage(message))
  }

  // Convenience methods
  trace(message: string): void {
    this.log(LogLevel.TRACE, message)
  }

  debug(message: string): void {
    this.log(LogLevel.DEBUG, message)
  }

  info(message: string): void {
    this.log(LogLevel.INFO, message)
  }

  warn(message: string): void {
    this.log(LogLevel.WARN, message)
  }

  error(message: string): void {
    this.log(LogLevel.ERROR, message)
  }
}

// =============================================================================
// Default Logger
// =============================================================================

let defaultLogger: ConsoleLogger | null = null

/**
 * Get the default console logger.
 */
export function getDefaultLogger(): ConsoleLogger {
  if (!defaultLogger) {
    defaultLogger = new ConsoleLogger()
  }
  return defaultLogger
}

/**
 * Set the default console logger configuration.
 */
export function configureDefaultLogger(config: ConsoleLoggerConfig): void {
  defaultLogger = new ConsoleLogger(config)
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Log a message at the specified level.
 */
export function log(level: LogLevel, message: string): void {
  getDefaultLogger().log(level, message)
}

/**
 * Log structured data at the specified level.
 */
export function logStructured(level: LogLevel, parts: LogPart[]): void {
  getDefaultLogger().logStructured(level, parts)
}

/**
 * Start a timer.
 */
export function time(label: string): void {
  getDefaultLogger().time(label)
}

/**
 * End a timer.
 */
export function timeEnd(label: string): void {
  getDefaultLogger().timeEnd(label)
}

/**
 * Log elapsed time without ending timer.
 */
export function timeLog(label: string, message?: string): void {
  getDefaultLogger().timeLog(label, message)
}

// Convenience exports
export const trace = (message: string) => log(LogLevel.TRACE, message)
export const debug = (message: string) => log(LogLevel.DEBUG, message)
export const info = (message: string) => log(LogLevel.INFO, message)
export const warn = (message: string) => log(LogLevel.WARN, message)
export const error = (message: string) => log(LogLevel.ERROR, message)

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:console imports object.
 */
export function getBrowserConsoleImports(config?: ConsoleLoggerConfig): Record<string, unknown> {
  const logger = config ? new ConsoleLogger(config) : getDefaultLogger()

  return {
    'browser:console/console': {
      // Core logging
      log: (level: LogLevel, message: string) => logger.log(level, message),
      'log-structured': (level: LogLevel, parts: LogPart[]) => logger.logStructured(level, parts),

      // Timers
      time: (label: string) => logger.time(label),
      'time-end': (label: string) => logger.timeEnd(label),
      'time-log': (label: string, message?: string) => logger.timeLog(label, message),

      // Groups
      group: (label: string) => logger.group(label),
      'group-expanded': (label: string) => logger.groupExpanded(label),
      'group-end': () => logger.groupEnd(),

      // Other
      clear: () => logger.clear(),
      count: (label: string) => logger.count(label),
      'count-reset': (label: string) => logger.countReset(label),
      table: (data: unknown[], columns?: string[]) => logger.table(data, columns),
      assert: (condition: boolean, message: string) => logger.assert(condition, message),

      // Convenience
      trace: (message: string) => logger.trace(message),
      debug: (message: string) => logger.debug(message),
      info: (message: string) => logger.info(message),
      warn: (message: string) => logger.warn(message),
      error: (message: string) => logger.error(message),
    },
  }
}
