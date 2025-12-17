/**
 * wasi:keyvalue plugin definitions
 *
 * Provides key-value store functionality with multiple backends.
 *
 * Interfaces:
 * - wasi:keyvalue/store - Core store operations (get, set, delete, exists, list-keys)
 * - wasi:keyvalue/atomics - Atomic operations (increment, compare-and-swap)
 * - wasi:keyvalue/batch - Batch operations (get-many, set-many, delete-many)
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { memoryStoreImplementation } from './impl-memory.js'

/**
 * WASI keyvalue store interface definition
 */
export const KEYVALUE_STORE_INTERFACE: WasiInterface = {
  package: 'wasi:keyvalue',
  name: 'store',
  version: '0.2.0-draft',
}

/**
 * WASI keyvalue atomics interface definition
 */
export const KEYVALUE_ATOMICS_INTERFACE: WasiInterface = {
  package: 'wasi:keyvalue',
  name: 'atomics',
  version: '0.2.0-draft',
}

/**
 * WASI keyvalue batch interface definition
 */
export const KEYVALUE_BATCH_INTERFACE: WasiInterface = {
  package: 'wasi:keyvalue',
  name: 'batch',
  version: '0.2.0-draft',
}

/**
 * wasi:keyvalue/store plugin
 *
 * Core key-value store operations.
 *
 * Implementations:
 * - memory: In-memory store (default, non-persistent)
 *
 * Operations:
 * - open(identifier: string) -> bucket
 * - bucket.get(key) -> option<bytes>
 * - bucket.set(key, value)
 * - bucket.delete(key)
 * - bucket.exists(key) -> bool
 * - bucket.list-keys(cursor?) -> key-response
 */
export const keyvalueStorePlugin: WasiPlugin = createPlugin(
  KEYVALUE_STORE_INTERFACE,
  {
    memory: memoryStoreImplementation,
  },
  'memory'
)

/**
 * wasi:keyvalue/atomics plugin
 *
 * Atomic key-value operations.
 *
 * Implementations:
 * - memory: In-memory store with atomic operations
 *
 * Operations:
 * - increment(bucket, key, delta) -> new-value
 * - cas.new(bucket, key) -> cas-handle
 * - cas.current() -> option<bytes>
 * - cas.swap(new-value) -> bool
 */
export const keyvalueAtomicsPlugin: WasiPlugin = createPlugin(
  KEYVALUE_ATOMICS_INTERFACE,
  {
    memory: memoryStoreImplementation,
  },
  'memory'
)

/**
 * wasi:keyvalue/batch plugin
 *
 * Batch key-value operations for efficiency.
 *
 * Implementations:
 * - memory: In-memory store with batch operations
 *
 * Operations:
 * - get-many(bucket, keys) -> map<key, value>
 * - set-many(bucket, entries)
 * - delete-many(bucket, keys)
 */
export const keyvalueBatchPlugin: WasiPlugin = createPlugin(
  KEYVALUE_BATCH_INTERFACE,
  {
    memory: memoryStoreImplementation,
  },
  'memory'
)

/**
 * All keyvalue plugins for convenient registration
 */
export const keyvaluePlugins: WasiPlugin[] = [
  keyvalueStorePlugin,
  keyvalueAtomicsPlugin,
  keyvalueBatchPlugin,
]
