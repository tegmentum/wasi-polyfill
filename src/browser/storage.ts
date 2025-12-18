/**
 * browser:storage - IndexedDB-backed key-value storage
 *
 * Provides a capability-scoped interface to browser storage
 * using IndexedDB for consistent async behavior and large value support.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  mapErrorToBrowserError,
  type Result,
  ok,
  browserErr,
  type Bytes,
  stringToBytes,
  bytesToString,
} from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Storage options.
 */
export interface StorageOptions {
  /** Database name (default: 'browser-storage') */
  databaseName?: string
  /** Store name (default: 'keyvalue') */
  storeName?: string
  /** Maximum value size in bytes (default: 10MB) */
  maxValueSize?: number
}

/**
 * Storage entry with metadata.
 */
interface StorageEntry {
  /** The stored value */
  value: Uint8Array
  /** Creation timestamp */
  created: number
  /** Last modified timestamp */
  modified: number
  /** Optional expiration timestamp */
  expires?: number
}

// =============================================================================
// Browser Storage
// =============================================================================

/**
 * IndexedDB-backed storage implementation.
 */
export class BrowserStorage {
  private databaseName: string
  private storeName: string
  private maxValueSize: number
  private db: IDBDatabase | null = null
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(options: StorageOptions = {}) {
    this.databaseName = options.databaseName ?? 'browser-storage'
    this.storeName = options.storeName ?? 'keyvalue'
    this.maxValueSize = options.maxValueSize ?? 10 * 1024 * 1024 // 10MB
  }

  /**
   * Open or get the database connection.
   */
  private async getDatabase(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db
    }

    if (this.dbPromise) {
      return this.dbPromise
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1)

      request.onerror = () => {
        this.dbPromise = null
        reject(request.error)
      }

      request.onsuccess = () => {
        this.db = request.result
        this.dbPromise = null
        resolve(request.result)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' })
        }
      }
    })

    return this.dbPromise
  }

  /**
   * Execute a transaction.
   */
  private async transaction<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.getDatabase()
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, mode)
      const store = transaction.objectStore(this.storeName)
      const request = operation(store)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  }

  /**
   * Get a value from storage.
   */
  async get(key: string): Promise<Result<Bytes | null, BrowserError>> {
    try {
      const entry = await this.transaction<{ key: string; data: StorageEntry } | undefined>(
        'readonly',
        (store) => store.get(key)
      )

      if (!entry) {
        return ok(null)
      }

      // Check expiration
      if (entry.data.expires && entry.data.expires < Date.now()) {
        // Expired - delete and return null
        await this.delete(key)
        return ok(null)
      }

      return ok(entry.data.value)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get a value as a string.
   */
  async getString(key: string): Promise<Result<string | null, BrowserError>> {
    const result = await this.get(key)
    if (!result.ok) {
      return result
    }
    if (result.value === null) {
      return ok(null)
    }
    return ok(bytesToString(result.value))
  }

  /**
   * Set a value in storage.
   */
  async set(key: string, value: Bytes, ttlMs?: number): Promise<Result<void, BrowserError>> {
    // Check size limit
    if (value.length > this.maxValueSize) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Value size ${value.length} exceeds maximum ${this.maxValueSize}`
      )
    }

    try {
      const now = Date.now()
      const entry: StorageEntry = {
        value,
        created: now,
        modified: now,
      }

      if (ttlMs !== undefined) {
        entry.expires = now + ttlMs
      }

      await this.transaction('readwrite', (store) =>
        store.put({ key, data: entry })
      )

      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Set a string value in storage.
   */
  async setString(key: string, value: string, ttlMs?: number): Promise<Result<void, BrowserError>> {
    return this.set(key, stringToBytes(value), ttlMs)
  }

  /**
   * Delete a value from storage.
   */
  async delete(key: string): Promise<Result<boolean, BrowserError>> {
    try {
      // Check if key exists first
      const existing = await this.transaction<{ key: string } | undefined>(
        'readonly',
        (store) => store.get(key)
      )

      if (!existing) {
        return ok(false)
      }

      await this.transaction('readwrite', (store) => store.delete(key))
      return ok(true)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Check if a key exists.
   */
  async has(key: string): Promise<Result<boolean, BrowserError>> {
    try {
      const entry = await this.transaction<{ key: string; data: StorageEntry } | undefined>(
        'readonly',
        (store) => store.get(key)
      )

      if (!entry) {
        return ok(false)
      }

      // Check expiration
      if (entry.data.expires && entry.data.expires < Date.now()) {
        return ok(false)
      }

      return ok(true)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get all keys.
   */
  async keys(): Promise<Result<string[], BrowserError>> {
    try {
      const db = await this.getDatabase()
      return new Promise<Result<string[], BrowserError>>((resolve) => {
        const transaction = db.transaction(this.storeName, 'readonly')
        const store = transaction.objectStore(this.storeName)
        const request = store.getAllKeys()

        request.onerror = () => {
          resolve({ ok: false, error: mapErrorToBrowserError(request.error) })
        }

        request.onsuccess = () => {
          const keys = request.result.map(k => String(k))
          resolve(ok(keys))
        }
      })
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Clear all values.
   */
  async clear(): Promise<Result<void, BrowserError>> {
    try {
      await this.transaction('readwrite', (store) => store.clear())
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get storage size estimate.
   */
  async size(): Promise<Result<{ count: number; bytes: number }, BrowserError>> {
    try {
      const db = await this.getDatabase()
      return new Promise<Result<{ count: number; bytes: number }, BrowserError>>((resolve) => {
        const transaction = db.transaction(this.storeName, 'readonly')
        const store = transaction.objectStore(this.storeName)
        const request = store.getAll()

        request.onerror = () => {
          resolve({ ok: false, error: mapErrorToBrowserError(request.error) })
        }

        request.onsuccess = () => {
          const entries = request.result as Array<{ key: string; data: StorageEntry }>
          let bytes = 0
          for (const entry of entries) {
            bytes += entry.data.value.length
          }
          resolve(ok({ count: entries.length, bytes }))
        }
      })
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

// =============================================================================
// Default Instance
// =============================================================================

const storageInstances = new Map<string, BrowserStorage>()

/**
 * Get a storage instance by database name.
 */
export function getStorage(databaseName?: string): BrowserStorage {
  const name = databaseName ?? 'browser-storage'
  let storage = storageInstances.get(name)
  if (!storage) {
    storage = new BrowserStorage({ databaseName: name })
    storageInstances.set(name, storage)
  }
  return storage
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:storage imports object.
 */
export function getBrowserStorageImports(databaseName?: string): Record<string, unknown> {
  const storage = getStorage(databaseName)

  return {
    'browser:storage/storage': {
      // Core operations
      get: (key: string) => storage.get(key),
      'get-string': (key: string) => storage.getString(key),
      set: (key: string, value: Bytes, ttlMs?: number) => storage.set(key, value, ttlMs),
      'set-string': (key: string, value: string, ttlMs?: number) => storage.setString(key, value, ttlMs),
      delete: (key: string) => storage.delete(key),
      has: (key: string) => storage.has(key),

      // Enumeration
      keys: () => storage.keys(),
      clear: () => storage.clear(),
      size: () => storage.size(),
    },
  }
}
