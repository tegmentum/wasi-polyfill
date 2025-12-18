/**
 * WASI Preview 3 adapters
 *
 * Provides bridges between:
 * - Sync and async calling conventions
 * - P2 and P3 interfaces
 *
 * @packageDocumentation
 */

export {
  AsyncSyncBridge,
  EventDispatcher,
  createBridgeContext,
  blockingCall,
  promisify,
  wrapSyncAsAsync,
  wrapAsyncWithDefault,
  streamToFuture,
  futureToStream,
  pipeStream,
  mergeStreams,
  type BridgeContext,
} from './async-sync-bridge.js'

// P2 to P3 adapters
export {
  adaptInputStream,
  adaptOutputStream,
  adaptPollable,
  adaptFileRead,
  adaptFileWrite,
  adaptDirectoryRead,
  adaptP2ToP3,
  createStreamFromCallback,
  createWriterFromCallback,
  type P2InputStream,
  type P2OutputStream,
  type P2Pollable,
  type P2Descriptor,
  type P2Plugin,
  type P3Plugin,
} from './p2-to-p3.js'
