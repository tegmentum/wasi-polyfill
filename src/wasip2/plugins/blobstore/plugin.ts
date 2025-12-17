/**
 * wasi:blobstore plugin definitions
 *
 * Provides blob storage functionality with multiple backends.
 *
 * Interfaces:
 * - wasi:blobstore/blobstore - Main blobstore operations
 * - wasi:blobstore/container - Container resource operations
 * - wasi:blobstore/types - Type definitions
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { memoryBlobstoreImplementation } from './impl-memory.js'

/**
 * WASI blobstore main interface definition
 */
export const BLOBSTORE_INTERFACE: WasiInterface = {
  package: 'wasi:blobstore',
  name: 'blobstore',
  version: '0.2.0-draft',
}

/**
 * WASI blobstore container interface definition
 */
export const BLOBSTORE_CONTAINER_INTERFACE: WasiInterface = {
  package: 'wasi:blobstore',
  name: 'container',
  version: '0.2.0-draft',
}

/**
 * WASI blobstore types interface definition
 */
export const BLOBSTORE_TYPES_INTERFACE: WasiInterface = {
  package: 'wasi:blobstore',
  name: 'types',
  version: '0.2.0-draft',
}

/**
 * wasi:blobstore/blobstore plugin
 *
 * Main blobstore operations for container management.
 *
 * Implementations:
 * - memory: In-memory store (default, non-persistent)
 *
 * Operations:
 * - create-container(name) -> container
 * - get-container(name) -> container
 * - delete-container(name)
 * - container-exists(name) -> bool
 * - copy-object(src, dest)
 * - move-object(src, dest)
 */
export const blobstorePlugin: WasiPlugin = createPlugin(
  BLOBSTORE_INTERFACE,
  {
    memory: memoryBlobstoreImplementation,
  },
  'memory'
)

/**
 * wasi:blobstore/container plugin
 *
 * Container resource operations.
 *
 * Implementations:
 * - memory: In-memory container operations
 *
 * Operations:
 * - name() -> string
 * - info() -> container-metadata
 * - has-object(name) -> bool
 * - object-info(name) -> object-metadata
 * - get-data(name, start?, end?) -> bytes
 * - write-data(name, data)
 * - delete-object(name)
 * - delete-objects(names)
 * - list-objects() -> list<string>
 * - clear()
 */
export const blobstoreContainerPlugin: WasiPlugin = createPlugin(
  BLOBSTORE_CONTAINER_INTERFACE,
  {
    memory: memoryBlobstoreImplementation,
  },
  'memory'
)

/**
 * All blobstore plugins for convenient registration
 */
export const blobstorePlugins: WasiPlugin[] = [blobstorePlugin, blobstoreContainerPlugin]
