/**
 * wasi:blobstore types
 *
 * Types for the blob storage interface including containers,
 * objects, metadata, and streaming values.
 */

/**
 * Container name (string identifier)
 */
export type ContainerName = string

/**
 * Object name within a container
 */
export type ObjectName = string

/**
 * Timestamp in milliseconds since Unix epoch
 */
export type Timestamp = bigint

/**
 * Object size in bytes
 */
export type ObjectSize = bigint

/**
 * Blobstore error (simple string for now)
 */
export type BlobstoreError = string

/**
 * Result type for blobstore operations
 */
export type BlobstoreResult<T> =
  | { tag: 'ok'; val: T }
  | { tag: 'err'; val: BlobstoreError }

/**
 * Create a successful result
 */
export function blobOk<T>(value: T): BlobstoreResult<T> {
  return { tag: 'ok', val: value }
}

/**
 * Create an error result
 */
export function blobErr<T>(error: BlobstoreError): BlobstoreResult<T> {
  return { tag: 'err', val: error }
}

/**
 * Container metadata
 */
export interface ContainerMetadata {
  /**
   * Container name
   */
  name: ContainerName

  /**
   * Creation timestamp (ms since epoch)
   */
  createdAt: Timestamp
}

/**
 * Object metadata
 */
export interface ObjectMetadata {
  /**
   * Object name
   */
  name: ObjectName

  /**
   * Container this object belongs to
   */
  container: ContainerName

  /**
   * Creation timestamp (ms since epoch)
   */
  createdAt: Timestamp

  /**
   * Object size in bytes
   */
  size: ObjectSize
}

/**
 * Object identifier (container + object name)
 */
export interface ObjectId {
  /**
   * Container name
   */
  container: ContainerName

  /**
   * Object name
   */
  object: ObjectName
}

/**
 * Container interface
 */
export interface Container {
  /**
   * Get container name
   */
  name(): ContainerName

  /**
   * Get container info
   */
  info(): BlobstoreResult<ContainerMetadata>

  /**
   * Check if object exists
   */
  hasObject(name: ObjectName): BlobstoreResult<boolean>

  /**
   * Get object metadata
   */
  objectInfo(name: ObjectName): BlobstoreResult<ObjectMetadata>

  /**
   * Get object data (with optional byte range)
   */
  getData(name: ObjectName, start?: bigint, end?: bigint): BlobstoreResult<Uint8Array>

  /**
   * Write object data
   */
  writeData(name: ObjectName, data: Uint8Array): BlobstoreResult<void>

  /**
   * Delete an object
   */
  deleteObject(name: ObjectName): BlobstoreResult<void>

  /**
   * Delete multiple objects
   */
  deleteObjects(names: ObjectName[]): BlobstoreResult<void>

  /**
   * List object names
   */
  listObjects(): BlobstoreResult<ObjectName[]>

  /**
   * Clear all objects
   */
  clear(): BlobstoreResult<void>
}

/**
 * Blobstore configuration
 */
export interface BlobstoreConfig {
  /**
   * Maximum object size in bytes (default: 10MB)
   */
  maxObjectSize?: number

  /**
   * Maximum number of objects per container (default: unlimited)
   */
  maxObjectsPerContainer?: number

  /**
   * Maximum number of containers (default: unlimited)
   */
  maxContainers?: number
}

/**
 * Default blobstore configuration
 */
export const DEFAULT_BLOBSTORE_CONFIG: Required<BlobstoreConfig> = {
  maxObjectSize: 10 * 1024 * 1024, // 10MB
  maxObjectsPerContainer: Number.MAX_SAFE_INTEGER,
  maxContainers: Number.MAX_SAFE_INTEGER,
}
