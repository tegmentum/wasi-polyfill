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

/** Compare two optional byte buffers for equality (used by compare-and-swap). */
function bytesEqual(
  a: Uint8Array | undefined,
  b: Uint8Array | undefined
): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** A live compare-and-swap handle: the target bucket/key and the snapshot. */
interface CasEntry {
  bucket: MemoryBucket
  key: string
  snapshot: Uint8Array | undefined
}

/**
 * Shared backing state for the keyvalue store/atomics/batch interfaces.
 *
 * The WIT `bucket` resource is defined in `wasi:keyvalue/store` and re-`use`d by
 * `atomics` and `batch`. Resources share identity across interfaces, so a bucket
 * opened via `store.open` must resolve when later passed to `atomics.increment`
 * or `batch.get-many`. The polyfill instantiates one PluginInstance per
 * interface, so the three instances must point at the same BucketStore for
 * handles to line up.
 */
class BucketStore {
  readonly buckets: Map<string, MemoryBucket> = new Map()
  readonly bucketHandles: Map<number, MemoryBucket> = new Map()
  readonly casHandles: Map<number, CasEntry> = new Map()
  nextHandle = 1
  readonly config: Required<StoreConfig>
  readonly allowedBuckets?: Set<string>
  readonly initialData?: Map<string, Map<string, Uint8Array>>

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

  open(identifier: string): KeyValueResult<number> {
    if (this.allowedBuckets && !this.allowedBuckets.has(identifier)) {
      return kvErr(accessDenied())
    }

    let bucket = this.buckets.get(identifier)
    if (!bucket) {
      const initialData = this.initialData?.get(identifier)
      bucket = new MemoryBucket(initialData, this.config)
      this.buckets.set(identifier, bucket)
    }

    const handle = this.nextHandle++
    this.bucketHandles.set(handle, bucket)
    return kvOk(handle)
  }

  getBucket(handle: number): MemoryBucket | undefined {
    return this.bucketHandles.get(handle)
  }

  getBucketByIdentifier(identifier: string): MemoryBucket | undefined {
    return this.buckets.get(identifier)
  }

  clear(): void {
    this.buckets.clear()
    this.bucketHandles.clear()
    this.casHandles.clear()
  }
}

/**
 * In-memory store instance.
 *
 * A thin facade over a {@link BucketStore}. The same instance exposes the
 * store, atomics, and batch imports; when used through the plugins they share a
 * single backing store (see {@link memoryStoreImplementation}).
 */
class MemoryStoreInstance implements PluginInstance {
  private readonly store: BucketStore
  private readonly ownsStore: boolean

  constructor(store: BucketStore, ownsStore: boolean) {
    this.store = store
    this.ownsStore = ownsStore
  }

  getImports(): Record<string, unknown> {
    return {
      // --- wasi:keyvalue/store -------------------------------------------
      open: (identifier: string) => this.store.open(identifier),
      '[method]bucket.get': (handle: number, key: string) =>
        this.withBucket(handle, (b) => b.get(key)),
      '[method]bucket.set': (handle: number, key: string, value: Uint8Array) =>
        this.withBucket(handle, (b) => b.set(key, value)),
      '[method]bucket.delete': (handle: number, key: string) =>
        this.withBucket(handle, (b) => b.delete(key)),
      '[method]bucket.exists': (handle: number, key: string) =>
        this.withBucket(handle, (b) => b.exists(key)),
      '[method]bucket.list-keys': (handle: number, cursor?: string) =>
        this.withBucket(handle, (b) => b.listKeys(cursor)),
      '[resource-drop]bucket': (handle: number) => this.dropBucket(handle),

      // --- wasi:keyvalue/atomics -----------------------------------------
      increment: (handle: number, key: string, delta: bigint | number) =>
        this.withBucket(handle, (b) =>
          b.increment(key, typeof delta === 'bigint' ? delta : BigInt(delta))
        ),
      '[static]cas.new': (handle: number, key: string) =>
        this.casNew(handle, key),
      '[method]cas.current': (casHandle: number) => this.casCurrent(casHandle),
      swap: (casHandle: number, value: Uint8Array) =>
        this.casSwap(casHandle, value),
      '[resource-drop]cas': (casHandle: number) =>
        this.store.casHandles.delete(casHandle),

      // --- wasi:keyvalue/batch -------------------------------------------
      'get-many': (handle: number, keys: string[]) =>
        this.bucketGetMany(handle, keys),
      'set-many': (
        handle: number,
        entries: Map<string, Uint8Array> | Array<[string, Uint8Array]>
      ) => this.bucketSetMany(handle, entries),
      'delete-many': (handle: number, keys: string[]) =>
        this.withBucket(handle, (b) => b.deleteMany(keys)),
    }
  }

  destroy(): void {
    // Only the owning (isolated) instance clears the backing store; plugin
    // instances share a singleton that must survive a single interface teardown.
    if (this.ownsStore) {
      this.store.clear()
    }
  }

  /** Resolve a bucket handle and run `fn`, or return no-such-store. */
  private withBucket<T>(
    handle: number,
    fn: (bucket: MemoryBucket) => KeyValueResult<T>
  ): KeyValueResult<T> {
    const bucket = this.store.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return fn(bucket)
  }

  /** batch.get-many → list of [key, value] tuples (WIT list<tuple<...>>). */
  private bucketGetMany(
    handle: number,
    keys: string[]
  ): KeyValueResult<Array<[string, Uint8Array]>> {
    return this.withBucket(handle, (bucket) => {
      const res = bucket.getMany(keys)
      if (res.tag === 'err') return res
      return kvOk(Array.from(res.val.entries()))
    })
  }

  /** batch.set-many, accepting either a Map or list of [key, value] tuples. */
  private bucketSetMany(
    handle: number,
    entries: Map<string, Uint8Array> | Array<[string, Uint8Array]>
  ): KeyValueResult<void> {
    const map = entries instanceof Map ? entries : new Map(entries)
    return this.withBucket(handle, (bucket) => bucket.setMany(map))
  }

  /** atomics: open a compare-and-swap handle capturing the current value. */
  private casNew(bucketHandle: number, key: string): KeyValueResult<number> {
    const bucket = this.store.getBucket(bucketHandle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    const current = bucket.get(key)
    const snapshot =
      current.tag === 'ok' && current.val ? new Uint8Array(current.val) : undefined
    const handle = this.store.nextHandle++
    this.store.casHandles.set(handle, { bucket, key, snapshot })
    return kvOk(handle)
  }

  /** atomics: the value captured when the cas handle was created. */
  private casCurrent(
    casHandle: number
  ): KeyValueResult<Uint8Array | undefined> {
    const cas = this.store.casHandles.get(casHandle)
    if (!cas) {
      return kvErr(noSuchStore())
    }
    return kvOk(cas.snapshot ? new Uint8Array(cas.snapshot) : undefined)
  }

  /**
   * atomics: set the value iff it is unchanged since the cas handle was
   * created. Returns true on success, false if another writer intervened.
   */
  private casSwap(
    casHandle: number,
    value: Uint8Array
  ): KeyValueResult<boolean> {
    const cas = this.store.casHandles.get(casHandle)
    if (!cas) {
      return kvErr(noSuchStore())
    }
    const current = cas.bucket.get(cas.key)
    const actual = current.tag === 'ok' ? current.val : undefined
    if (!bytesEqual(actual, cas.snapshot)) {
      return kvOk(false)
    }
    const setResult = cas.bucket.set(cas.key, value)
    if (setResult.tag === 'err') {
      return kvErr(setResult.val)
    }
    cas.snapshot = new Uint8Array(value)
    return kvOk(true)
  }

  /** Drop a bucket handle. */
  private dropBucket(handle: number): void {
    this.store.bucketHandles.delete(handle)
  }
}

/**
 * Backing store shared by the store/atomics/batch plugin instances.
 *
 * Like the other plugins' module-level registries, this is process-global so
 * that the three keyvalue interfaces operate on the same buckets. (Per-polyfill
 * isolation is tracked separately in REMEDIATION-PLAN Phase 2.10.)
 */
let sharedBucketStore: BucketStore | undefined

export const memoryStoreImplementation: Implementation = {
  name: 'memory',
  description: 'In-memory key-value store (non-persistent)',
  create(config: PluginConfig): PluginInstance {
    if (!sharedBucketStore) {
      sharedBucketStore = new BucketStore(config as MemoryStoreConfig)
    }
    return new MemoryStoreInstance(sharedBucketStore, false)
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
  // Tests get an isolated backing store (ownsStore: true) so they don't share
  // buckets with the process-global plugin store or with each other.
  const instance = new MemoryStoreInstance(new BucketStore(config ?? {}), true)
  return { instance, store: instance }
}
