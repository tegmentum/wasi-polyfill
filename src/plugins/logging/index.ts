/**
 * wasi:logging plugin
 *
 * Provides structured logging with severity levels and context grouping.
 *
 * Interfaces:
 * - wasi:logging/logging - Simple logging API
 *
 * Implementations:
 * - console: Log to browser/Node console
 * - buffer: Capture in ring buffer for debugging/testing
 */

// Plugin definitions and interfaces
export { loggingPlugin, loggingPlugins, LOGGING_INTERFACE } from './plugin.js'

// Types and utilities
export {
  type LogLevel,
  type LogEntry,
  type LogSink,
  type LogFilterConfig,
  LOG_LEVEL_VALUES,
  levelFromNumber,
  shouldLog,
  shouldLogContext,
} from './types.js'

// Console implementation
export {
  consoleLogImplementation,
  type ConsoleLogConfig,
} from './impl-console.js'

// Buffer implementation
export {
  bufferLogImplementation,
  createBufferLogger,
  type BufferLogConfig,
} from './impl-buffer.js'
