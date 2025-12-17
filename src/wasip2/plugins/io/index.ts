/**
 * wasi:io plugin
 *
 * Provides I/O stream and polling functionality.
 * This is a foundational plugin used by other WASI interfaces.
 *
 * Interfaces:
 * - wasi:io/poll - Polling for readiness (using Promises)
 * - wasi:io/streams - Input/output streams
 * - wasi:io/error - Error handling
 */

// Plugin exports
export {
  pollPlugin,
  streamsPlugin,
  errorPlugin,
  ioPlugins,
  POLL_INTERFACE,
  STREAMS_INTERFACE,
  ERROR_INTERFACE,
} from './plugin.js'

// Pollable
export {
  Pollable,
  PollableRegistry,
  globalPollableRegistry,
  createTimerPollable,
  createReadyPollable,
} from './pollable.js'

// Streams
export type { StreamBase, InputStream, OutputStream, StreamError } from './streams.js'
export {
  StreamRegistry,
  MemoryInputStream,
  MemoryOutputStream,
  globalStreamRegistry,
} from './streams.js'

// Error
export { IoError, ErrorRegistry, globalErrorRegistry } from './error.js'
