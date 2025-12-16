/**
 * In-memory key-value store implementation
 *
 * Provides a simple in-memory key-value store for testing
 * and non-persistent use cases.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  type KeyValueResult,
  type KeyResponse,
  type StoreConfig,
  DEFAULT_STORE_CONFIG,
  noSuchStore,
  accessDenied,
  otherError,
  kvOk,
  kvErr,
} from './types.js'

/**
 * Configuration for in-memory store
 */
export interface MemoryStoreConfig extends PluginConfig, StoreConfig {
  /**
   * Initial data to populate buckets with
   * Map of bucket identifier -> key-value pairs
   */
  initialData?: Map<string, Map<string, Uint8Array>>

  /**
   * Allowed bucket identifiers (if set, only these can be opened)
   */
  allowedBuckets?: string[]
}

/**
 * In-memory bucket implementation
 */
class MemoryBucket {
  private data: Map<string, Uint8Array>
  private readonly maxKeys: number
  private readonly maxValueSize: number
  private readonly pageSize: number

  constructor(
    initialData?: Map<string, Uint8Array>,
    config: Required<StoreConfig> = DEFAULT_STORE_CONFIG
  ) {
    this.data = initialData ? new Map(initialData) : new Map()
    this.maxKeys = config.maxKeys
    this.maxValueSize = config.maxValueSize
    this.pageSize = config.pageSize
  }

  get(key: string): KeyValueResult<Uint8Array | undefined> {
    const value = this.data.get(key)
    return kvOk(value ? new Uint8Array(value) : undefined)
  }

  set(key: string, value: Uint8Array): KeyValueResult<void> {
    // Check value size
    if (value.length > this.maxValueSize) {
      return kvErr(otherError(`Value size ${value.length} exceeds maximum ${this.maxValueSize}`))
    }

    // Check key count for new keys
    if (!this.data.has(key) && this.data.size >= this.maxKeys) {
      return kvErr(otherError(`Maximum key count ${this.maxKeys} exceeded`))
    }

    // Store a copy of the value
    this.data.set(key, new Uint8Array(value))
    return kvOk(undefined)
  }

  delete(key: string): KeyValueResult<void> {
    this.data.delete(key)
    return kvOk(undefined)
  }

  exists(key: string): KeyValueResult<boolean> {
    return kvOk(this.data.has(key))
  }

  listKeys(cursor?: string): KeyValueResult<KeyResponse> {
    const allKeys = Array.from(this.data.keys()).sort()

    let startIndex = 0
    if (cursor) {
      const cursorIndex = parseInt(cursor, 10)
      if (!isNaN(cursorIndex)) {
        startIndex = cursorIndex
      }
    }

    const endIndex = Math.min(startIndex + this.pageSize, allKeys.length)
    const keys = allKeys.slice(startIndex, endIndex)

    const response: KeyResponse = { keys }
    if (endIndex < allKeys.length) {
      response.cursor = endIndex.toString()
    }

    return kvOk(response)
  }

  /**
   * Atomic increment
   */
  increment(key: string, delta: bigint): KeyValueResult<bigint> {
    const existing = this.data.get(key)
    let currentValue = 0n

    if (existing) {
      // Parse as 64-bit signed integer (little-endian)
      if (existing.length === 8) {
        const view = new DataView(existing.buffer, existing.byteOffset, existing.byteLength)
        currentValue = view.getBigInt64(0, true)
      } else {
        return kvErr(otherError('Value is not a valid 64-bit integer'))
      }
    }

    const newValue = currentValue + delta

    // Store as 64-bit signed integer (little-endian)
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setBigInt64(0, newValue, true)
    this.data.set(key, new Uint8Array(buffer))

    return kvOk(newValue)
  }

  /**
   * Get multiple values
   */
  getMany(keys: string[]): KeyValueResult<Map<string, Uint8Array>> {
    const result = new Map<string, Uint8Array>()
    for (const key of keys) {
      const value = this.data.get(key)
      if (value) {
        result.set(key, new Uint8Array(value))
      }
    }
    return kvOk(result)
  }

  /**
   * Set multiple values
   */
  setMany(entries: Map<string, Uint8Array>): KeyValueResult<void> {
    // Validate all entries first
    for (const [key, value] of entries) {
      if (value.length > this.maxValueSize) {
        return kvErr(
          otherError(`Value size ${value.length} for key "${key}" exceeds maximum ${this.maxValueSize}`)
        )
      }
    }

    // Count new keys
    let newKeyCount = 0
    for (const key of entries.keys()) {
      if (!this.data.has(key)) {
        newKeyCount++
      }
    }

    if (this.data.size + newKeyCount > this.maxKeys) {
      return kvErr(otherError(`Would exceed maximum key count ${this.maxKeys}`))
    }

    // Apply all entries
    for (const [key, value] of entries) {
      this.data.set(key, new Uint8Array(value))
    }

    return kvOk(undefined)
  }

  /**
   * Delete multiple keys
   */
  deleteMany(keys: string[]): KeyValueResult<void> {
    for (const key of keys) {
      this.data.delete(key)
    }
    return kvOk(undefined)
  }

  /**
   * Get the number of keys in the bucket
   */
  get size(): number {
    return this.data.size
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.data.clear()
  }
}

/**
 * In-memory store instance
 */
class MemoryStoreInstance implements PluginInstance {
  private readonly buckets: Map<string, MemoryBucket> = new Map()
  private readonly bucketHandles: Map<number, MemoryBucket> = new Map()
  private nextHandle = 1
  private readonly config: Required<StoreConfig>
  private readonly allowedBuckets?: Set<string>
  private readonly initialData?: Map<string, Map<string, Uint8Array>>

  constructor(config: MemoryStoreConfig) {
    this.config = {
      maxKeys: config.maxKeys ?? DEFAULT_STORE_CONFIG.maxKeys,
      maxValueSize: config.maxValueSize ?? DEFAULT_STORE_CONFIG.maxValueSize,
      pageSize: config.pageSize ?? DEFAULT_STORE_CONFIG.pageSize,
    }
    if (config.allowedBuckets) {
      this.allowedBuckets = new Set(config.allowedBuckets)
    }
    if (config.initialData) {
      this.initialData = config.initialData
    }
  }

  getImports(): Record<string, unknown> {
    return {
      open: this.open.bind(this),
      // Bucket methods (dispatched by handle)
      '[method]bucket.get': this.bucketGet.bind(this),
      '[method]bucket.set': this.bucketSet.bind(this),
      '[method]bucket.delete': this.bucketDelete.bind(this),
      '[method]bucket.exists': this.bucketExists.bind(this),
      '[method]bucket.list-keys': this.bucketListKeys.bind(this),
      // Resource drop
      '[resource-drop]bucket': this.dropBucket.bind(this),
    }
  }

  destroy(): void {
    this.buckets.clear()
    this.bucketHandles.clear()
  }

  /**
   * Open a bucket by identifier
   */
  private open(identifier: string): KeyValueResult<number> {
    // Check if bucket is allowed
    if (this.allowedBuckets && !this.allowedBuckets.has(identifier)) {
      return kvErr(accessDenied())
    }

    // Get or create bucket
    let bucket = this.buckets.get(identifier)
    if (!bucket) {
      const initialData = this.initialData?.get(identifier)
      bucket = new MemoryBucket(initialData, this.config)
      this.buckets.set(identifier, bucket)
    }

    // Create handle
    const handle = this.nextHandle++
    this.bucketHandles.set(handle, bucket)
    return kvOk(handle)
  }

  /**
   * Get bucket by handle
   */
  private getBucket(handle: number): MemoryBucket | undefined {
    return this.bucketHandles.get(handle)
  }

  /**
   * Bucket.get method
   */
  private bucketGet(handle: number, key: string): KeyValueResult<Uint8Array | undefined> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.get(key)
  }

  /**
   * Bucket.set method
   */
  private bucketSet(handle: number, key: string, value: Uint8Array): KeyValueResult<void> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.set(key, value)
  }

  /**
   * Bucket.delete method
   */
  private bucketDelete(handle: number, key: string): KeyValueResult<void> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.delete(key)
  }

  /**
   * Bucket.exists method
   */
  private bucketExists(handle: number, key: string): KeyValueResult<boolean> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.exists(key)
  }

  /**
   * Bucket.list-keys method
   */
  private bucketListKeys(handle: number, cursor?: string): KeyValueResult<KeyResponse> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.listKeys(cursor)
  }

  /**
   * Drop bucket handle
   */
  private dropBucket(handle: number): void {
    this.bucketHandles.delete(handle)
  }

  /**
   * Get a bucket directly for testing
   */
  getBucketByIdentifier(identifier: string): MemoryBucket | undefined {
    return this.buckets.get(identifier)
  }
}

/**
 * In-memory key-value store implementation
 *
 * Provides a simple in-memory store suitable for:
 * - Testing
 * - Short-lived data
 * - Development environments
 *
 * Note: Data is not persisted across instance destruction.
 */
export const memoryStoreImplementation: Implementation = {
  name: 'memory',
  description: 'In-memory key-value store (non-persistent)',
  create(config: PluginConfig): PluginInstance {
    return new MemoryStoreInstance(config as MemoryStoreConfig)
  },
}

/**
 * Create a memory store and return both the instance and direct access
 *
 * Convenience function for tests:
 * ```typescript
 * const { instance, getBucket } = createMemoryStore()
 * const imports = instance.getImports()
 *
 * const result = imports.open('test')
 * const bucket = getBucket('test')
 * ```
 */
export function createMemoryStore(
  config?: MemoryStoreConfig
): { instance: PluginInstance; store: MemoryStoreInstance } {
  const instance = new MemoryStoreInstance(config ?? {})
  return { instance, store: instance }
}
