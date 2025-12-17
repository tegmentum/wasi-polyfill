/**
 * wasi:keyvalue plugin
 *
 * Provides key-value store functionality with multiple backends.
 *
 * Interfaces:
 * - wasi:keyvalue/store - Core store operations
 * - wasi:keyvalue/atomics - Atomic operations
 * - wasi:keyvalue/batch - Batch operations
 *
 * Implementations:
 * - memory: In-memory store (non-persistent)
 */

// Plugin definitions and interfaces
export {
  keyvalueStorePlugin,
  keyvalueAtomicsPlugin,
  keyvalueBatchPlugin,
  keyvaluePlugins,
  KEYVALUE_STORE_INTERFACE,
  KEYVALUE_ATOMICS_INTERFACE,
  KEYVALUE_BATCH_INTERFACE,
} from './plugin.js'

// Types and utilities
export {
  type KeyValueError,
  type KeyValueResult,
  type KeyResponse,
  type Bucket,
  type AtomicBucket,
  type BatchBucket,
  type CasHandle,
  type StoreConfig,
  DEFAULT_STORE_CONFIG,
  noSuchStore,
  accessDenied,
  otherError,
  kvOk,
  kvErr,
} from './types.js'

// Memory implementation
export {
  memoryStoreImplementation,
  createMemoryStore,
  type MemoryStoreConfig,
} from './impl-memory.js'

// IndexedDB implementation
export {
  idbStoreImplementation,
  createIdbStore,
  isIdbStoreAvailable,
  type IdbStoreConfig,
} from './impl-idb.js'

// Replay implementation
export {
  replayStoreImplementation,
  createRecordingStore,
  createReplayStore,
  type ReplayStoreConfig,
  type KvCassetteRequest,
  type KvCassetteResponse,
  type KvCassetteGet,
  type KvCassetteSet,
  type KvCassetteDelete,
  type KvCassetteExists,
  type KvCassetteListKeys,
} from './impl-replay.js'
