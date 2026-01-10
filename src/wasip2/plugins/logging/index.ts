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
  isBufferLoggerInstance,
  type BufferLogConfig,
  type BufferLoggerBuffer,
} from './impl-buffer.js'

// NDJSON implementation
export {
  ndjsonLogImplementation,
  createNdjsonCollector,
  createNdjsonFileWriter,
  type NdjsonLogConfig,
  type NdjsonFieldMapping,
  type NdjsonTimestampFormat,
  type NdjsonLogEntry,
} from './impl-ndjson.js'

// OTLP implementation
export {
  otlpLogImplementation,
  createOtlpTestLogger,
  type OtlpLogConfig,
  type OtlpResource,
  type OtlpScope,
} from './impl-otlp.js'
