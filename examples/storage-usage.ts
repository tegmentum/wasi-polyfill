/**
 * Storage plugin usage examples for @tegmentum/wasi-polyfill
 *
 * This example demonstrates how to use the key-value and blobstore plugins
 * with different backends: memory, IndexedDB, and OPFS.
 */

import { createDevPolyfill, Polyfill } from '@tegmentum/wasi-polyfill'
import {
  keyvalueStorePlugin,
  keyvalueAtomicsPlugin,
  keyvalueBatchPlugin,
  keyvaluePlugins,
  createMemoryStore,
  createIdbStore,
  isIdbStoreAvailable,
  createRecordingStore,
  createReplayStore,
} from '@tegmentum/wasi-polyfill/plugins/keyvalue'
import {
  blobstorePlugin,
  blobstoreContainerPlugin,
  blobstorePlugins,
  createMemoryBlobstore,
  createOpfsBlobstore,
  isOpfsBlobstoreAvailable,
  createRecordingBlobstore,
  createReplayBlobstore,
} from '@tegmentum/wasi-polyfill/plugins/blobstore'

// ============================================================================
// Example 1: In-Memory Key-Value Store
// ============================================================================

async function memoryKeyValueUsage() {
  const polyfill = createDevPolyfill()

  // Create a memory store with optional initial data
  const store = createMemoryStore({
    initialData: {
      default: new Map([
        ['user:1', new TextEncoder().encode('{"name":"Alice"}')],
        ['user:2', new TextEncoder().encode('{"name":"Bob"}')],
      ]),
    },
  })

  // Register key-value plugin with memory backend
  polyfill.registerPlugin(keyvalueStorePlugin, {
    implementation: 'memory',
    store,
  })

  const result = await polyfill.forInterfaces(['wasi:keyvalue/store@0.2.0'])

  console.log('Key-value store loaded')

  // Access the store functions
  const imports = result.imports['wasi:keyvalue/store@0.2.0']
  const open = imports['open'] as (name: string) => unknown

  // Open a bucket
  const bucket = open('default')
  console.log('Opened bucket:', bucket)

  polyfill.destroy()
}

// ============================================================================
// Example 2: Key-Value Store with Atomics
// ============================================================================

async function atomicKeyValueUsage() {
  const polyfill = createDevPolyfill()

  // Register store and atomics plugins
  polyfill.registerPlugin(keyvalueStorePlugin, {
    implementation: 'memory',
  })
  polyfill.registerPlugin(keyvalueAtomicsPlugin, {
    implementation: 'memory',
  })

  const result = await polyfill.forInterfaces([
    'wasi:keyvalue/store@0.2.0',
    'wasi:keyvalue/atomics@0.2.0',
  ])

  console.log('Key-value store with atomics loaded')

  // The atomics interface provides:
  // - increment(bucket, key, delta) -> new_value
  // - compare-and-swap(bucket, key, expected, desired) -> result

  polyfill.destroy()
}

// ============================================================================
// Example 3: Key-Value Batch Operations
// ============================================================================

async function batchKeyValueUsage() {
  const polyfill = createDevPolyfill()

  // Register all keyvalue plugins at once
  for (const plugin of keyvaluePlugins) {
    polyfill.registerPlugin(plugin, {
      implementation: 'memory',
    })
  }

  const result = await polyfill.forInterfaces([
    'wasi:keyvalue/store@0.2.0',
    'wasi:keyvalue/atomics@0.2.0',
    'wasi:keyvalue/batch@0.2.0',
  ])

  console.log('Key-value with batch operations loaded')

  // The batch interface provides:
  // - get-many(bucket, keys) -> list<option<data>>
  // - set-many(bucket, key-values) -> result
  // - delete-many(bucket, keys) -> result

  polyfill.destroy()
}

// ============================================================================
// Example 4: IndexedDB Key-Value Store (Browser Persistence)
// ============================================================================

async function idbKeyValueUsage() {
  if (!isIdbStoreAvailable()) {
    console.log('IndexedDB is not available')
    return
  }

  const polyfill = createDevPolyfill()

  // Create an IndexedDB-backed store
  const store = createIdbStore({
    databaseName: 'my-app-kv',
  })

  polyfill.registerPlugin(keyvalueStorePlugin, {
    implementation: 'idb',
    store,
  })

  const result = await polyfill.forInterfaces(['wasi:keyvalue/store@0.2.0'])

  console.log('IndexedDB key-value store loaded')
  // Data persists across page reloads

  polyfill.destroy()
}

// ============================================================================
// Example 5: Recording and Replaying Key-Value Operations
// ============================================================================

async function replayKeyValueUsage() {
  // First, create a recording store to capture operations
  const cassette: Array<{ request: unknown; response: unknown }> = []
  const recordingStore = createRecordingStore({
    cassette,
    fallback: createMemoryStore(),
  })

  const polyfill1 = createDevPolyfill()
  polyfill1.registerPlugin(keyvalueStorePlugin, {
    implementation: 'replay',
    store: recordingStore,
  })

  // Run your component and record all operations
  const result1 = await polyfill1.forInterfaces(['wasi:keyvalue/store@0.2.0'])
  // ... component runs and makes keyvalue calls ...
  polyfill1.destroy()

  console.log('Recorded operations:', cassette.length)

  // Later, replay the recorded operations for testing
  const replayStore = createReplayStore({
    cassette,
  })

  const polyfill2 = createDevPolyfill()
  polyfill2.registerPlugin(keyvalueStorePlugin, {
    implementation: 'replay',
    store: replayStore,
  })

  // The component will receive the same responses as during recording
  const result2 = await polyfill2.forInterfaces(['wasi:keyvalue/store@0.2.0'])
  polyfill2.destroy()
}

// ============================================================================
// Example 6: In-Memory Blobstore
// ============================================================================

async function memoryBlobstoreUsage() {
  const polyfill = createDevPolyfill()

  // Create a memory blobstore with optional initial data
  const store = createMemoryBlobstore({
    initialContainers: ['uploads', 'processed'],
  })

  // Register blobstore plugins
  polyfill.registerPlugin(blobstorePlugin, {
    implementation: 'memory',
    store,
  })
  polyfill.registerPlugin(blobstoreContainerPlugin, {
    implementation: 'memory',
    store,
  })

  const result = await polyfill.forInterfaces([
    'wasi:blobstore/blobstore@0.2.0-draft',
    'wasi:blobstore/container@0.2.0-draft',
  ])

  console.log('Blobstore loaded')

  // Access the blobstore functions
  const blobstoreImports = result.imports['wasi:blobstore@0.2.0-draft']
  const createContainer = blobstoreImports['create-container'] as (
    name: string
  ) => unknown

  // Create a new container
  const container = createContainer('my-container')
  console.log('Created container:', container)

  polyfill.destroy()
}

// ============================================================================
// Example 7: OPFS Blobstore (Browser Persistence)
// ============================================================================

async function opfsBlobstoreUsage() {
  if (!isOpfsBlobstoreAvailable()) {
    console.log('OPFS blobstore is not available')
    return
  }

  const polyfill = createDevPolyfill()

  // Create an OPFS-backed blobstore for persistent blob storage
  const store = createOpfsBlobstore({
    rootDirectory: 'my-app-blobs',
  })

  // Register all blobstore plugins
  for (const plugin of blobstorePlugins) {
    polyfill.registerPlugin(plugin, {
      implementation: 'opfs',
      store,
    })
  }

  const result = await polyfill.forInterfaces([
    'wasi:blobstore/blobstore@0.2.0-draft',
    'wasi:blobstore/container@0.2.0-draft',
  ])

  console.log('OPFS blobstore loaded')
  // Blobs persist across page reloads

  polyfill.destroy()
}

// ============================================================================
// Example 8: Combined Key-Value and Blobstore
// ============================================================================

async function combinedStorageUsage() {
  const polyfill = createDevPolyfill()

  // Use key-value for metadata and indexes
  polyfill.registerPlugin(keyvalueStorePlugin, {
    implementation: 'memory',
  })

  // Use blobstore for large binary objects
  polyfill.registerPlugin(blobstorePlugin, {
    implementation: 'memory',
  })
  polyfill.registerPlugin(blobstoreContainerPlugin, {
    implementation: 'memory',
  })

  const result = await polyfill.forInterfaces([
    'wasi:keyvalue/store@0.2.0',
    'wasi:blobstore/blobstore@0.2.0-draft',
    'wasi:blobstore/container@0.2.0-draft',
  ])

  console.log('Combined storage loaded')
  console.log('  - Key-value for metadata')
  console.log('  - Blobstore for large objects')

  // Example use case:
  // - Store file metadata (name, size, type) in key-value
  // - Store file contents in blobstore
  // - Key-value key contains blobstore container/object reference

  polyfill.destroy()
}

// Run examples
export {
  memoryKeyValueUsage,
  atomicKeyValueUsage,
  batchKeyValueUsage,
  idbKeyValueUsage,
  replayKeyValueUsage,
  memoryBlobstoreUsage,
  opfsBlobstoreUsage,
  combinedStorageUsage,
}
