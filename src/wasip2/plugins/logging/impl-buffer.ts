/**
 * Ring buffer logging implementation
 *
 * Stores log entries in a bounded buffer for debugging and testing.
 * Useful for:
 * - Capturing logs during tests
 * - Debugging without external log systems
 * - Snapshot/replay testing
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  type LogLevel,
  type LogEntry,
  type LogFilterConfig,
  levelFromNumber,
  shouldLog,
  shouldLogContext,
} from './types.js'

/**
 * Configuration for buffer logging
 */
export interface BufferLogConfig extends PluginConfig, LogFilterConfig {
  /**
   * Maximum number of entries to keep (default: 1000)
   */
  maxEntries?: number

  /**
   * Use wall clock time instead of monotonic (default: false)
   */
  useWallTime?: boolean
}

/**
 * Buffer logging instance interface.
 *
 * Provides queryable access to captured logs.
 * This interface is exported for type checking purposes.
 */
export interface BufferLoggerBuffer {
  getEntries(): readonly LogEntry[]
  getEntriesByLevel(level: LogLevel): LogEntry[]
  getEntriesByContext(context: string): LogEntry[]
  getEntriesAtLevel(minLevel: LogLevel): LogEntry[]
  clear(): void
  readonly count: number
  readonly hasErrors: boolean
  format(options?: { showTimestamp?: boolean }): string[]
  toJSON(): LogEntry[]
}

/**
 * Type guard to check if a plugin instance is a buffer logger
 */
export function isBufferLoggerInstance(
  instance: PluginInstance
): instance is PluginInstance & BufferLoggerBuffer {
  return (
    typeof instance === 'object' &&
    instance !== null &&
    'getEntries' in instance &&
    typeof (instance as Record<string, unknown>).getEntries === 'function' &&
    'clear' in instance &&
    typeof (instance as Record<string, unknown>).clear === 'function' &&
    'count' in instance
  )
}

class BufferLogInstance implements PluginInstance, BufferLoggerBuffer {
  private readonly minLevel: LogLevel
  private readonly filterConfig: LogFilterConfig
  private readonly maxEntries: number
  private readonly useWallTime: boolean
  private readonly entries: LogEntry[] = []

  constructor(config: BufferLogConfig) {
    this.minLevel = config.minLevel ?? 'trace'
    this.filterConfig = config
    this.maxEntries = config.maxEntries ?? 1000
    this.useWallTime = config.useWallTime ?? false
  }

  getImports(): Record<string, unknown> {
    return {
      log: this.log.bind(this),
    }
  }

  destroy(): void {
    this.entries.length = 0
  }

  /**
   * Log a message to the buffer
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

    // Create entry
    const entry: LogEntry = {
      timestamp: this.getTimestamp(),
      level: levelName,
      context,
      message,
    }

    // Add to buffer, removing oldest if full
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift()
    }
    this.entries.push(entry)
  }

  /**
   * Get current timestamp
   */
  private getTimestamp(): bigint {
    if (this.useWallTime) {
      return BigInt(Date.now()) * 1_000_000n
    }

    if (typeof performance !== 'undefined') {
      return BigInt(Math.floor(performance.now() * 1_000_000))
    }

    // Fallback to wall time
    return BigInt(Date.now()) * 1_000_000n
  }

  /**
   * Get all captured log entries
   */
  getEntries(): readonly LogEntry[] {
    return this.entries
  }

  /**
   * Get entries filtered by level
   */
  getEntriesByLevel(level: LogLevel): LogEntry[] {
    return this.entries.filter((e) => e.level === level)
  }

  /**
   * Get entries filtered by context
   */
  getEntriesByContext(context: string): LogEntry[] {
    return this.entries.filter((e) => e.context === context)
  }

  /**
   * Get entries at or above a minimum level
   */
  getEntriesAtLevel(minLevel: LogLevel): LogEntry[] {
    return this.entries.filter((e) => shouldLog(e.level, minLevel))
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.length = 0
  }

  /**
   * Get the number of entries
   */
  get count(): number {
    return this.entries.length
  }

  /**
   * Check if any errors have been logged
   */
  get hasErrors(): boolean {
    return this.entries.some((e) => e.level === 'error' || e.level === 'critical')
  }

  /**
   * Get entries as formatted strings
   */
  format(options?: { showTimestamp?: boolean }): string[] {
    return this.entries.map((entry) => {
      const parts: string[] = []

      if (options?.showTimestamp) {
        parts.push(`[${entry.timestamp}]`)
      }

      parts.push(`[${entry.level.toUpperCase()}]`)

      if (entry.context) {
        parts.push(`[${entry.context}]`)
      }

      parts.push(entry.message)

      return parts.join(' ')
    })
  }

  /**
   * Export entries as JSON for snapshots
   */
  toJSON(): LogEntry[] {
    return [...this.entries]
  }
}

/**
 * Ring buffer logging implementation
 *
 * Captures log entries in memory for debugging and testing.
 * The buffer is bounded to prevent memory leaks.
 */
export const bufferLogImplementation: Implementation = {
  name: 'buffer',
  description: 'Capture logs in ring buffer for debugging/testing',
  create(config: PluginConfig): PluginInstance {
    return new BufferLogInstance(config as BufferLogConfig)
  },
}

/**
 * Create a buffer logger and return both the instance and query interface
 *
 * Convenience function for tests:
 * ```typescript
 * const { instance, buffer } = createBufferLogger()
 * const imports = instance.getImports()
 *
 * // Use the imports...
 * imports.log(2, 'test', 'Hello!')
 *
 * // Query the buffer
 * expect(buffer.count).toBe(1)
 * expect(buffer.getEntries()[0].message).toBe('Hello!')
 * ```
 */
export function createBufferLogger(
  config?: BufferLogConfig
): { instance: PluginInstance; buffer: BufferLogInstance } {
  const instance = new BufferLogInstance(config ?? {})
  return { instance, buffer: instance }
}
