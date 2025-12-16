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
