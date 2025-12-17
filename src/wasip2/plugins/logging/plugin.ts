/**
 * wasi:logging plugin definition
 *
 * Provides structured logging with severity levels and context grouping.
 *
 * Implementations:
 * - console: Log to browser/Node console (default)
 * - buffer: Capture in ring buffer for debugging/testing
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { consoleLogImplementation } from './impl-console.js'
import { bufferLogImplementation } from './impl-buffer.js'

/**
 * WASI logging interface definition
 */
export const LOGGING_INTERFACE: WasiInterface = {
  package: 'wasi:logging',
  name: 'logging',
  version: '0.1.0-draft',
}

/**
 * wasi:logging/logging plugin
 *
 * Simple logging API for emitting structured log messages.
 *
 * Implementations:
 * - console: Log to browser/Node console (default)
 * - buffer: Capture in ring buffer for debugging/testing
 *
 * The interface provides a single function:
 * - log(level: u32, context: string, message: string): void
 *
 * Log levels:
 * - 0 = trace
 * - 1 = debug
 * - 2 = info
 * - 3 = warn
 * - 4 = error
 * - 5 = critical
 */
export const loggingPlugin: WasiPlugin = createPlugin(
  LOGGING_INTERFACE,
  {
    console: consoleLogImplementation,
    buffer: bufferLogImplementation,
  },
  'console'
)

/**
 * All logging plugins for convenient registration
 */
export const loggingPlugins: WasiPlugin[] = [loggingPlugin]
