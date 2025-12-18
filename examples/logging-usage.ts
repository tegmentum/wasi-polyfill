/**
 * Logging plugin usage examples for @tegmentum/wasi-polyfill
 *
 * This example demonstrates how to use the logging plugin with
 * different backends: console, buffer, NDJSON, and OTLP.
 */

import { createDevPolyfill, Polyfill } from '@tegmentum/wasi-polyfill'
import {
  loggingPlugin,
  consoleLogImplementation,
  bufferLogImplementation,
  ndjsonLogImplementation,
  otlpLogImplementation,
  createBufferLogger,
  createNdjsonCollector,
  createNdjsonFileWriter,
  createOtlpTestLogger,
  LOG_LEVEL_VALUES,
  levelFromNumber,
  shouldLog,
  type LogEntry,
  type LogLevel,
} from '@tegmentum/wasi-polyfill/plugins/logging'

// ============================================================================
// Example 1: Console Logging (Default)
// ============================================================================

async function consoleLoggingUsage() {
  const polyfill = createDevPolyfill()

  // Register logging plugin with console backend (default)
  polyfill.registerPlugin(loggingPlugin, {
    implementation: 'console',
    // Optional: Set minimum log level
    minLevel: 'debug',
    // Optional: Include context in console output
    includeContext: true,
  })

  const result = await polyfill.forInterfaces(['wasi:logging/logging@0.1.0-draft'])

  console.log('Console logging loaded')

  // The WASM component can now use wasi:logging/logging
  // Example component code:
  //
  // wasi::logging::log(Level::Info, "app", "Application started");
  // wasi::logging::log(Level::Debug, "db", "Query executed: SELECT ...");

  polyfill.destroy()
}

// ============================================================================
// Example 2: Buffer Logging for Testing
// ============================================================================

async function bufferLoggingUsage() {
  const polyfill = createDevPolyfill()

  // Create a buffer logger that captures log entries
  const { instance: logger, buffer } = createBufferLogger({
    maxEntries: 1000, // Maximum entries to keep
    minLevel: 'trace', // Capture everything
  })

  polyfill.registerPlugin(loggingPlugin, {
    implementation: 'buffer',
    logger,
  })

  const result = await polyfill.forInterfaces(['wasi:logging/logging@0.1.0-draft'])

  // After running the component, inspect captured logs
  const entries = buffer.getEntries()
  console.log('Captured log entries:', entries.length)

  // Filter by level
  const errors = buffer.getEntries().filter((e) => e.level === 'error')
  console.log('Error entries:', errors.length)

  // Filter by context
  const dbLogs = buffer.getEntries().filter((e) => e.context === 'database')
  console.log('Database logs:', dbLogs.length)

  // Clear buffer
  buffer.clear()

  polyfill.destroy()
}

// ============================================================================
// Example 3: NDJSON Logging (Newline-Delimited JSON)
// ============================================================================

async function ndjsonLoggingUsage() {
  const polyfill = createDevPolyfill()

  // Create an NDJSON collector that accumulates log lines
  const collector = createNdjsonCollector()

  polyfill.registerPlugin(loggingPlugin, {
    implementation: 'ndjson',
    collector,
    // Customize field mapping
    fieldMapping: {
      level: 'severity',
      context: 'logger',
      message: 'msg',
      timestamp: 'ts',
    },
    // Timestamp format: 'iso8601' | 'unix' | 'unixMillis'
    timestampFormat: 'iso8601',
    // Additional fields to include in every log
    additionalFields: {
      service: 'my-app',
      version: '1.0.0',
    },
  })

  const result = await polyfill.forInterfaces(['wasi:logging/logging@0.1.0-draft'])

  // After running the component, get NDJSON lines
  const lines = collector.getLines()
  console.log('NDJSON log lines:', lines.length)
  console.log('Example line:', lines[0])

  // Output format:
  // {"ts":"2024-01-15T10:30:00Z","severity":"info","logger":"app","msg":"Started","service":"my-app","version":"1.0.0"}

  polyfill.destroy()
}

// ============================================================================
// Example 4: NDJSON File Writer (Node.js)
// ============================================================================

async function ndjsonFileLoggingUsage() {
  // This example is for Node.js environments
  if (typeof process === 'undefined') {
    console.log('File logging only available in Node.js')
    return
  }

  const polyfill = createDevPolyfill()

  // Create a file writer that appends NDJSON to a file
  const writer = createNdjsonFileWriter({
    filePath: '/var/log/my-app.ndjson',
    // Rotate file when it reaches this size
    maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
    // Keep this many rotated files
    maxFiles: 5,
  })

  polyfill.registerPlugin(loggingPlugin, {
    implementation: 'ndjson',
    writer,
  })

  const result = await polyfill.forInterfaces(['wasi:logging/logging@0.1.0-draft'])

  console.log('NDJSON file logging configured')

  // Logs are written to file as component runs
  // Don't forget to close the writer when done
  // await writer.close()

  polyfill.destroy()
}

// ============================================================================
// Example 5: OTLP Logging (OpenTelemetry)
// ============================================================================

async function otlpLoggingUsage() {
  const polyfill = createDevPolyfill()

  polyfill.registerPlugin(loggingPlugin, {
    implementation: 'otlp',
    // OTLP endpoint for log export
    endpoint: 'http://localhost:4318/v1/logs',
    // Resource attributes
    resource: {
      'service.name': 'my-wasm-app',
      'service.version': '1.0.0',
      'deployment.environment': 'production',
    },
    // Instrumentation scope
    scope: {
      name: '@tegmentum/wasi-polyfill',
      version: '1.0.0',
    },
    // Batching configuration
    batchSize: 100,
    flushIntervalMs: 5000,
  })

  const result = await polyfill.forInterfaces(['wasi:logging/logging@0.1.0-draft'])

  console.log('OTLP logging configured')
  // Logs are automatically batched and sent to the OTLP collector

  polyfill.destroy()
}

// ============================================================================
// Example 6: OTLP Test Logger (For Unit Tests)
// ============================================================================

async function otlpTestLoggingUsage() {
  const polyfill = createDevPolyfill()

  // Create a test logger that captures OTLP log records without network
  const testLogger = createOtlpTestLogger()

  polyfill.registerPlugin(loggingPlugin, {
    implementation: 'otlp',
    testLogger,
    resource: {
      'service.name': 'test-app',
    },
  })

  const result = await polyfill.forInterfaces(['wasi:logging/logging@0.1.0-draft'])

  // After running tests, verify OTLP records
  const records = testLogger.getRecords()
  console.log('OTLP records captured:', records.length)

  // Verify specific log attributes
  const hasServiceName = records.every((r) =>
    r.resource?.attributes?.some(
      (a) => a.key === 'service.name' && a.value?.stringValue === 'test-app'
    )
  )
  console.log('All records have service name:', hasServiceName)

  polyfill.destroy()
}

// ============================================================================
// Example 7: Custom Log Filter
// ============================================================================

async function filteredLoggingUsage() {
  const polyfill = createDevPolyfill()

  // Create a custom filter for fine-grained control
  const { instance: logger, buffer } = createBufferLogger()

  polyfill.registerPlugin(loggingPlugin, {
    implementation: 'buffer',
    logger,
    // Global minimum level
    minLevel: 'info',
    // Context-specific levels (override global)
    contextLevels: {
      database: 'debug', // More verbose for database context
      security: 'trace', // Most verbose for security context
      http: 'warn', // Less verbose for HTTP context
    },
  })

  const result = await polyfill.forInterfaces(['wasi:logging/logging@0.1.0-draft'])

  console.log('Filtered logging configured')

  // With this configuration:
  // - database.debug: captured
  // - database.info: captured
  // - security.trace: captured
  // - http.info: filtered out (below warn)
  // - http.warn: captured

  polyfill.destroy()
}

// ============================================================================
// Example 8: Log Level Utilities
// ============================================================================

function logLevelUtilitiesUsage() {
  // Convert between level numbers and names
  console.log('Level values:', LOG_LEVEL_VALUES)
  // { trace: 0, debug: 1, info: 2, warn: 3, error: 4, critical: 5 }

  // Convert number to level name
  const level = levelFromNumber(2)
  console.log('Level 2 is:', level) // 'info'

  // Check if a level should be logged
  const minLevel: LogLevel = 'info'
  console.log('Should log debug?', shouldLog('debug', minLevel)) // false
  console.log('Should log info?', shouldLog('info', minLevel)) // true
  console.log('Should log error?', shouldLog('error', minLevel)) // true

  // Example log entry structure
  const entry: LogEntry = {
    level: 'info',
    context: 'my-component',
    message: 'Processing complete',
    timestamp: new Date(),
  }
  console.log('Log entry:', entry)
}

// Run examples
export {
  consoleLoggingUsage,
  bufferLoggingUsage,
  ndjsonLoggingUsage,
  ndjsonFileLoggingUsage,
  otlpLoggingUsage,
  otlpTestLoggingUsage,
  filteredLoggingUsage,
  logLevelUtilitiesUsage,
}
