/**
 * Console logging implementation
 *
 * Logs messages to the browser/Node console with appropriate
 * console methods based on log level.
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
 * Configuration for console logging
 */
export interface ConsoleLogConfig extends PluginConfig, LogFilterConfig {
  /**
   * Whether to include timestamps in output
   */
  showTimestamp?: boolean

  /**
   * Whether to include the context in output
   */
  showContext?: boolean

  /**
   * Custom console object to use (defaults to globalThis.console)
   */
  console?: Console
}

/**
 * Console logging instance
 */
class ConsoleLogInstance implements PluginInstance {
  private readonly minLevel: LogLevel
  private readonly filterConfig: LogFilterConfig
  private readonly showTimestamp: boolean
  private readonly showContext: boolean
  private readonly console: Console

  constructor(config: ConsoleLogConfig) {
    this.minLevel = config.minLevel ?? 'trace'
    this.filterConfig = config
    this.showTimestamp = config.showTimestamp ?? false
    this.showContext = config.showContext ?? true
    this.console = config.console ?? globalThis.console
  }

  getImports(): Record<string, unknown> {
    return {
      log: this.log.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  /**
   * Log a message
   *
   * @param level - Log level (0-5, trace to critical)
   * @param context - Context string for grouping
   * @param message - The log message
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

    // Format the message
    const formattedMessage = this.formatMessage(levelName, context, message)

    // Log to appropriate console method
    this.logToConsole(levelName, formattedMessage)
  }

  /**
   * Format a log message
   */
  private formatMessage(level: LogLevel, context: string, message: string): string {
    const parts: string[] = []

    if (this.showTimestamp) {
      parts.push(`[${new Date().toISOString()}]`)
    }

    parts.push(`[${level.toUpperCase()}]`)

    if (this.showContext && context) {
      parts.push(`[${context}]`)
    }

    parts.push(message)

    return parts.join(' ')
  }

  /**
   * Log to the appropriate console method
   */
  private logToConsole(level: LogLevel, message: string): void {
    switch (level) {
      case 'trace':
        // Use debug for trace (console.trace adds stack trace)
        this.console.debug(message)
        break
      case 'debug':
        this.console.debug(message)
        break
      case 'info':
        this.console.info(message)
        break
      case 'warn':
        this.console.warn(message)
        break
      case 'error':
        this.console.error(message)
        break
      case 'critical':
        this.console.error(message)
        break
    }
  }
}

/**
 * Console logging implementation
 *
 * Maps log levels to console methods:
 * - trace, debug -> console.debug
 * - info -> console.info
 * - warn -> console.warn
 * - error, critical -> console.error
 */
export const consoleLogImplementation: Implementation = {
  name: 'console',
  description: 'Log to browser/Node console',
  create(config: PluginConfig): PluginInstance {
    return new ConsoleLogInstance(config as ConsoleLogConfig)
  },
}
