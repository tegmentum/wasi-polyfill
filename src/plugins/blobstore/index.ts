/**
 * wasi:blobstore plugin
 *
 * Provides blob/object storage functionality with multiple backends.
 *
 * Interfaces:
 * - wasi:blobstore/blobstore - Main blobstore operations
 * - wasi:blobstore/container - Container resource operations
 * - wasi:blobstore/types - Type definitions
 *
 * Implementations:
 * - memory: In-memory store (non-persistent)
 */

// Plugin definitions and interfaces
export {
  blobstorePlugin,
  blobstoreContainerPlugin,
  blobstorePlugins,
  BLOBSTORE_INTERFACE,
  BLOBSTORE_CONTAINER_INTERFACE,
  BLOBSTORE_TYPES_INTERFACE,
} from './plugin.js'

// Types and utilities
export {
  type ContainerName,
  type ObjectName,
  type Timestamp,
  type ObjectSize,
  type BlobstoreError,
  type BlobstoreResult,
  type ContainerMetadata,
  type ObjectMetadata,
  type ObjectId,
  type Container,
  type BlobstoreConfig,
  DEFAULT_BLOBSTORE_CONFIG,
  blobOk,
  blobErr,
} from './types.js'

// Memory implementation
export {
  memoryBlobstoreImplementation,
  createMemoryBlobstore,
  type MemoryBlobstoreConfig,
} from './impl-memory.js'
