/**
 * IndexedDB key-value store implementation
 *
 * Provides persistent key-value storage using IndexedDB.
 * Suitable for browser environments that need data persistence.
 *
 * Features:
 * - Persistent storage across page reloads
 * - Multiple isolated buckets per database
 * - Atomic batch operations via transactions
 * - Works in all modern browsers and Web Workers
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
 * Configuration for IndexedDB store
 */
export interface IdbStoreConfig extends PluginConfig, StoreConfig {
  /**
   * IndexedDB database name
   * @default 'wasi-keyvalue'
   */
  databaseName?: string

  /**
   * Database version (increment to trigger schema updates)
   * @default 1
   */
  databaseVersion?: number

  /**
   * Allowed bucket identifiers (if set, only these can be opened)
   */
  allowedBuckets?: string[]

  /**
   * Prefix for bucket object stores
   * @default 'bucket_'
   */
  bucketPrefix?: string
}

/**
 * Check if IndexedDB is available
 */
export function isIdbStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * Open an IndexedDB database
 */
function openDatabase(
  name: string,
  version: number,
  buckets: string[],
  prefix: string
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create object stores for buckets
      for (const bucket of buckets) {
        const storeName = `${prefix}${bucket}`
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName)
        }
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      reject(request.error)
    }
  })
}

/**
 * IDB bucket implementation
 */
class IdbBucket {
  private readonly db: IDBDatabase
  private readonly storeName: string
  private readonly maxValueSize: number
  private readonly pageSize: number

  constructor(
    db: IDBDatabase,
    storeName: string,
    config: Required<StoreConfig>
  ) {
    this.db = db
    this.storeName = storeName
    this.maxValueSize = config.maxValueSize
    this.pageSize = config.pageSize
  }

  async get(key: string): Promise<KeyValueResult<Uint8Array | undefined>> {
    try {
      const tx = this.db.transaction(this.storeName, 'readonly')
      const store = tx.objectStore(this.storeName)
      const request = store.get(key)

      return new Promise((resolve) => {
        request.onsuccess = () => {
          const value = request.result as Uint8Array | undefined
          resolve(kvOk(value ? new Uint8Array(value) : undefined))
        }
        request.onerror = () => {
          resolve(kvErr(otherError(request.error?.message ?? 'IDB get failed')))
        }
      })
    } catch (error) {
      return kvErr(otherError(error instanceof Error ? error.message : String(error)))
    }
  }

  async set(key: string, value: Uint8Array): Promise<KeyValueResult<void>> {
    try {
      if (value.length > this.maxValueSize) {
        return kvErr(otherError(`Value size ${value.length} exceeds maximum ${this.maxValueSize}`))
      }

      const tx = this.db.transaction(this.storeName, 'readwrite')
      const store = tx.objectStore(this.storeName)
      const request = store.put(new Uint8Array(value), key)

      return new Promise((resolve) => {
        request.onsuccess = () => {
          resolve(kvOk(undefined))
        }
        request.onerror = () => {
          resolve(kvErr(otherError(request.error?.message ?? 'IDB set failed')))
        }
      })
    } catch (error) {
      return kvErr(otherError(error instanceof Error ? error.message : String(error)))
    }
  }

  async delete(key: string): Promise<KeyValueResult<void>> {
    try {
      const tx = this.db.transaction(this.storeName, 'readwrite')
      const store = tx.objectStore(this.storeName)
      const request = store.delete(key)

      return new Promise((resolve) => {
        request.onsuccess = () => {
          resolve(kvOk(undefined))
        }
        request.onerror = () => {
          resolve(kvErr(otherError(request.error?.message ?? 'IDB delete failed')))
        }
      })
    } catch (error) {
      return kvErr(otherError(error instanceof Error ? error.message : String(error)))
    }
  }

  async exists(key: string): Promise<KeyValueResult<boolean>> {
    try {
      const tx = this.db.transaction(this.storeName, 'readonly')
      const store = tx.objectStore(this.storeName)
      const request = store.count(key)

      return new Promise((resolve) => {
        request.onsuccess = () => {
          resolve(kvOk(request.result > 0))
        }
        request.onerror = () => {
          resolve(kvErr(otherError(request.error?.message ?? 'IDB exists failed')))
        }
      })
    } catch (error) {
      return kvErr(otherError(error instanceof Error ? error.message : String(error)))
    }
  }

  async listKeys(cursor?: string): Promise<KeyValueResult<KeyResponse>> {
    try {
      const tx = this.db.transaction(this.storeName, 'readonly')
      const store = tx.objectStore(this.storeName)
      const request = store.getAllKeys()

      return new Promise((resolve) => {
        request.onsuccess = () => {
          const allKeys = (request.result as string[]).sort()

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

          resolve(kvOk(response))
        }
        request.onerror = () => {
          resolve(kvErr(otherError(request.error?.message ?? 'IDB listKeys failed')))
        }
      })
    } catch (error) {
      return kvErr(otherError(error instanceof Error ? error.message : String(error)))
    }
  }

  async increment(key: string, delta: bigint): Promise<KeyValueResult<bigint>> {
    try {
      const tx = this.db.transaction(this.storeName, 'readwrite')
      const store = tx.objectStore(this.storeName)

      return new Promise((resolve) => {
        const getRequest = store.get(key)

        getRequest.onsuccess = () => {
          let currentValue = 0n

          const existing = getRequest.result as Uint8Array | undefined
          if (existing && existing.length === 8) {
            const view = new DataView(existing.buffer, existing.byteOffset, existing.byteLength)
            currentValue = view.getBigInt64(0, true)
          }

          const newValue = currentValue + delta

          const buffer = new ArrayBuffer(8)
          const view = new DataView(buffer)
          view.setBigInt64(0, newValue, true)

          const putRequest = store.put(new Uint8Array(buffer), key)

          putRequest.onsuccess = () => {
            resolve(kvOk(newValue))
          }
          putRequest.onerror = () => {
            resolve(kvErr(otherError(putRequest.error?.message ?? 'IDB increment failed')))
          }
        }

        getRequest.onerror = () => {
          resolve(kvErr(otherError(getRequest.error?.message ?? 'IDB increment get failed')))
        }
      })
    } catch (error) {
      return kvErr(otherError(error instanceof Error ? error.message : String(error)))
    }
  }

  async getMany(keys: string[]): Promise<KeyValueResult<Map<string, Uint8Array>>> {
    try {
      const tx = this.db.transaction(this.storeName, 'readonly')
      const store = tx.objectStore(this.storeName)
      const result = new Map<string, Uint8Array>()

      const promises = keys.map((key) => {
        return new Promise<void>((resolve) => {
          const request = store.get(key)
          request.onsuccess = () => {
            if (request.result) {
              result.set(key, new Uint8Array(request.result))
            }
            resolve()
          }
          request.onerror = () => resolve()
        })
      })

      await Promise.all(promises)
      return kvOk(result)
    } catch (error) {
      return kvErr(otherError(error instanceof Error ? error.message : String(error)))
    }
  }

  async setMany(entries: Map<string, Uint8Array>): Promise<KeyValueResult<void>> {
    try {
      // Validate sizes
      for (const [key, value] of entries) {
        if (value.length > this.maxValueSize) {
          return kvErr(
            otherError(`Value size ${value.length} for key "${key}" exceeds maximum ${this.maxValueSize}`)
          )
        }
      }

      const tx = this.db.transaction(this.storeName, 'readwrite')
      const store = tx.objectStore(this.storeName)

      const promises = Array.from(entries).map(([key, value]) => {
        return new Promise<void>((resolve, reject) => {
          const request = store.put(new Uint8Array(value), key)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
      })

      await Promise.all(promises)
      return kvOk(undefined)
    } catch (error) {
      return kvErr(otherError(error instanceof Error ? error.message : String(error)))
    }
  }

  async deleteMany(keys: string[]): Promise<KeyValueResult<void>> {
    try {
      const tx = this.db.transaction(this.storeName, 'readwrite')
      const store = tx.objectStore(this.storeName)

      const promises = keys.map((key) => {
        return new Promise<void>((resolve) => {
          const request = store.delete(key)
          request.onsuccess = () => resolve()
          request.onerror = () => resolve()
        })
      })

      await Promise.all(promises)
      return kvOk(undefined)
    } catch (error) {
      return kvErr(otherError(error instanceof Error ? error.message : String(error)))
    }
  }
}

/**
 * IndexedDB store instance
 */
class IdbStoreInstance implements PluginInstance {
  private db: IDBDatabase | null = null
  private readonly buckets: Map<string, IdbBucket> = new Map()
  private readonly bucketHandles: Map<number, IdbBucket> = new Map()
  private nextHandle = 1
  private readonly config: Required<StoreConfig>
  private readonly databaseName: string
  private readonly databaseVersion: number
  private readonly bucketPrefix: string
  private readonly allowedBuckets?: Set<string>
  private initPromise: Promise<void> | null = null

  constructor(config: IdbStoreConfig) {
    this.config = {
      maxKeys: config.maxKeys ?? DEFAULT_STORE_CONFIG.maxKeys,
      maxValueSize: config.maxValueSize ?? DEFAULT_STORE_CONFIG.maxValueSize,
      pageSize: config.pageSize ?? DEFAULT_STORE_CONFIG.pageSize,
    }
    this.databaseName = config.databaseName ?? 'wasi-keyvalue'
    this.databaseVersion = config.databaseVersion ?? 1
    this.bucketPrefix = config.bucketPrefix ?? 'bucket_'
    if (config.allowedBuckets) {
      this.allowedBuckets = new Set(config.allowedBuckets)
    }
  }

  private async initialize(): Promise<void> {
    if (this.db) return
    if (this.initPromise) {
      await this.initPromise
      return
    }

    this.initPromise = (async () => {
      const buckets = this.allowedBuckets ? Array.from(this.allowedBuckets) : ['default']
      this.db = await openDatabase(
        this.databaseName,
        this.databaseVersion,
        buckets,
        this.bucketPrefix
      )
    })()

    await this.initPromise
  }

  getImports(): Record<string, unknown> {
    return {
      open: this.open.bind(this),
      '[method]bucket.get': this.bucketGet.bind(this),
      '[method]bucket.set': this.bucketSet.bind(this),
      '[method]bucket.delete': this.bucketDelete.bind(this),
      '[method]bucket.exists': this.bucketExists.bind(this),
      '[method]bucket.list-keys': this.bucketListKeys.bind(this),
      '[resource-drop]bucket': this.dropBucket.bind(this),
    }
  }

  destroy(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.buckets.clear()
    this.bucketHandles.clear()
  }

  private async open(identifier: string): Promise<KeyValueResult<number>> {
    try {
      if (this.allowedBuckets && !this.allowedBuckets.has(identifier)) {
        return kvErr(accessDenied())
      }

      await this.initialize()

      let bucket = this.buckets.get(identifier)
      if (!bucket) {
        const storeName = `${this.bucketPrefix}${identifier}`

        // Create object store if needed
        if (!this.db!.objectStoreNames.contains(storeName)) {
          // Need to reopen with higher version to add object store
          this.db!.close()
          const version = this.db!.version + 1
          this.db = await openDatabase(
            this.databaseName,
            version,
            [identifier],
            this.bucketPrefix
          )
        }

        bucket = new IdbBucket(this.db!, storeName, this.config)
        this.buckets.set(identifier, bucket)
      }

      const handle = this.nextHandle++
      this.bucketHandles.set(handle, bucket)
      return kvOk(handle)
    } catch (error) {
      return kvErr(otherError(error instanceof Error ? error.message : String(error)))
    }
  }

  private getBucket(handle: number): IdbBucket | undefined {
    return this.bucketHandles.get(handle)
  }

  private async bucketGet(handle: number, key: string): Promise<KeyValueResult<Uint8Array | undefined>> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.get(key)
  }

  private async bucketSet(handle: number, key: string, value: Uint8Array): Promise<KeyValueResult<void>> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.set(key, value)
  }

  private async bucketDelete(handle: number, key: string): Promise<KeyValueResult<void>> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.delete(key)
  }

  private async bucketExists(handle: number, key: string): Promise<KeyValueResult<boolean>> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.exists(key)
  }

  private async bucketListKeys(handle: number, cursor?: string): Promise<KeyValueResult<KeyResponse>> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.listKeys(cursor)
  }

  private dropBucket(handle: number): void {
    this.bucketHandles.delete(handle)
  }
}

/**
 * IndexedDB key-value store implementation
 *
 * Provides persistent storage using IndexedDB. Suitable for:
 * - Browser environments needing persistent key-value storage
 * - Progressive Web Apps (PWAs)
 * - Offline-capable applications
 */
export const idbStoreImplementation: Implementation = {
  name: 'idb',
  description: 'IndexedDB key-value store (persistent)',
  create(config: PluginConfig): PluginInstance {
    return new IdbStoreInstance(config as IdbStoreConfig)
  },
}

/**
 * Create an IndexedDB store for direct use
 */
export function createIdbStore(config?: IdbStoreConfig): IdbStoreInstance {
  return new IdbStoreInstance(config ?? {})
}
