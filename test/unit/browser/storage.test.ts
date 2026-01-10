/**
 * browser:storage tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BrowserStorage,
  getStorage,
  getBrowserStorageImports,
} from '../../../src/browser/storage.js'
import { stringToBytes, bytesToString } from '../../../src/browser/types.js'

// =============================================================================
// Mock IndexedDB
// =============================================================================

// Create a more realistic IndexedDB mock for testing with shared storage
function createMockIDB() {
  // Shared storage across all transactions for a database
  const databaseStorage = new Map<string, Map<string, { key: string; data: unknown }>>()

  function getStoreData(dbName: string, storeName: string): Map<string, { key: string; data: unknown }> {
    const key = `${dbName}:${storeName}`
    if (!databaseStorage.has(key)) {
      databaseStorage.set(key, new Map())
    }
    return databaseStorage.get(key)!
  }

  function createMockRequest<T>(): IDBRequest<T> & {
    _resolve: (value: T) => void
    _reject: (error: Error) => void
  } {
    let onsuccess: ((event: Event) => void) | null = null
    let onerror: ((event: Event) => void) | null = null
    let result: T | undefined
    let error: DOMException | null = null
    let readyState: IDBRequestReadyState = 'pending'

    const request = {
      get result() { return result as T },
      get error() { return error },
      get readyState() { return readyState },
      source: null,
      transaction: null,
      get onsuccess() { return onsuccess },
      set onsuccess(fn: ((event: Event) => void) | null) { onsuccess = fn },
      get onerror() { return onerror },
      set onerror(fn: ((event: Event) => void) | null) { onerror = fn },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      _resolve(value: T) {
        result = value
        readyState = 'done'
        if (onsuccess) {
          onsuccess(new Event('success'))
        }
      },
      _reject(err: Error) {
        error = err as DOMException
        readyState = 'done'
        if (onerror) {
          onerror(new Event('error'))
        }
      },
    }

    return request as IDBRequest<T> & {
      _resolve: (value: T) => void
      _reject: (error: Error) => void
    }
  }

  function createMockObjectStore(dbName: string, storeName: string): IDBObjectStore {
    const storeData = getStoreData(dbName, storeName)

    return {
      name: storeName,
      keyPath: 'key',
      indexNames: { length: 0, contains: () => false, item: () => null, [Symbol.iterator]: function* () {} },
      transaction: {} as IDBTransaction,
      autoIncrement: false,
      get: vi.fn((key: string) => {
        const request = createMockRequest<{ key: string; data: unknown } | undefined>()
        setTimeout(() => {
          request._resolve(storeData.get(key))
        }, 0)
        return request
      }),
      getAll: vi.fn(() => {
        const request = createMockRequest<Array<{ key: string; data: unknown }>>()
        setTimeout(() => {
          request._resolve(Array.from(storeData.values()))
        }, 0)
        return request
      }),
      getAllKeys: vi.fn(() => {
        const request = createMockRequest<string[]>()
        setTimeout(() => {
          request._resolve(Array.from(storeData.keys()))
        }, 0)
        return request
      }),
      put: vi.fn((value: { key: string; data: unknown }) => {
        const request = createMockRequest<IDBValidKey>()
        setTimeout(() => {
          storeData.set(value.key, value)
          request._resolve(value.key)
        }, 0)
        return request
      }),
      delete: vi.fn((key: string) => {
        const request = createMockRequest<undefined>()
        setTimeout(() => {
          storeData.delete(key)
          request._resolve(undefined)
        }, 0)
        return request
      }),
      clear: vi.fn(() => {
        const request = createMockRequest<undefined>()
        setTimeout(() => {
          storeData.clear()
          request._resolve(undefined)
        }, 0)
        return request
      }),
      count: vi.fn(() => {
        const request = createMockRequest<number>()
        setTimeout(() => {
          request._resolve(storeData.size)
        }, 0)
        return request
      }),
      add: vi.fn(),
      createIndex: vi.fn(),
      deleteIndex: vi.fn(),
      index: vi.fn(),
      openCursor: vi.fn(),
      openKeyCursor: vi.fn(),
      getKey: vi.fn(),
    } as unknown as IDBObjectStore
  }

  function createMockTransaction(dbName: string, storeName: string, mode?: IDBTransactionMode): IDBTransaction {
    return {
      objectStore: () => createMockObjectStore(dbName, storeName),
      abort: vi.fn(),
      commit: vi.fn(),
      db: {} as IDBDatabase,
      durability: 'default',
      error: null,
      mode: mode ?? 'readonly',
      objectStoreNames: { length: 1, contains: () => true, item: () => storeName, [Symbol.iterator]: function* () { yield storeName } },
      onabort: null,
      oncomplete: null,
      onerror: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as IDBTransaction
  }

  function createMockDatabase(name: string, storeName: string): IDBDatabase {
    return {
      name,
      version: 1,
      objectStoreNames: {
        length: 1,
        contains: (n: string) => n === storeName,
        item: (i: number) => i === 0 ? storeName : null,
        [Symbol.iterator]: function* () { yield storeName },
      },
      close: vi.fn(),
      createObjectStore: vi.fn((sn: string) => createMockObjectStore(name, sn)),
      deleteObjectStore: vi.fn(),
      transaction: vi.fn((storeNames: string | string[], mode?: IDBTransactionMode) => {
        const sn = Array.isArray(storeNames) ? storeNames[0]! : storeNames
        return createMockTransaction(name, sn, mode)
      }),
      onabort: null,
      onclose: null,
      onerror: null,
      onversionchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as IDBDatabase
  }

  const mockIDB = {
    open: vi.fn((name: string, _version?: number) => {
      const request = createMockRequest<IDBDatabase>()

      setTimeout(() => {
        const db = createMockDatabase(name, 'keyvalue')
        request._resolve(db)
      }, 0)

      return request
    }),
    deleteDatabase: vi.fn((name: string) => {
      // Clear all stores for this database
      for (const key of databaseStorage.keys()) {
        if (key.startsWith(`${name}:`)) {
          databaseStorage.delete(key)
        }
      }
      const request = createMockRequest<undefined>()
      setTimeout(() => request._resolve(undefined), 0)
      return request
    }),
    databases: vi.fn().mockResolvedValue([]),
    cmp: vi.fn((a, b) => a < b ? -1 : a > b ? 1 : 0),
  }

  return mockIDB
}

describe('browser:storage', () => {
  let originalIndexedDB: IDBFactory
  let mockIDB: ReturnType<typeof createMockIDB>

  beforeEach(() => {
    originalIndexedDB = globalThis.indexedDB
    mockIDB = createMockIDB()
    ;(globalThis as unknown as Record<string, unknown>).indexedDB = mockIDB
  })

  afterEach(() => {
    ;(globalThis as unknown as Record<string, unknown>).indexedDB = originalIndexedDB
  })

  describe('BrowserStorage', () => {
    it('creates storage with default options', () => {
      const storage = new BrowserStorage()
      expect(storage).toBeDefined()
    })

    it('creates storage with custom options', () => {
      const storage = new BrowserStorage({
        databaseName: 'custom-db',
        storeName: 'custom-store',
        maxValueSize: 5 * 1024 * 1024,
      })
      expect(storage).toBeDefined()
    })

    it('sets and gets values', async () => {
      const storage = new BrowserStorage()
      const value = stringToBytes('test value')

      const setResult = await storage.set('test-key', value)
      expect(setResult.ok).toBe(true)

      const getResult = await storage.get('test-key')
      expect(getResult.ok).toBe(true)
      if (getResult.ok) {
        expect(getResult.value).not.toBeNull()
        expect(bytesToString(getResult.value!)).toBe('test value')
      }
    })

    it('sets and gets string values', async () => {
      const storage = new BrowserStorage()

      const setResult = await storage.setString('string-key', 'hello world')
      expect(setResult.ok).toBe(true)

      const getResult = await storage.getString('string-key')
      expect(getResult.ok).toBe(true)
      if (getResult.ok) {
        expect(getResult.value).toBe('hello world')
      }
    })

    it('returns null for non-existent keys', async () => {
      const storage = new BrowserStorage()

      const result = await storage.get('non-existent')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBeNull()
      }
    })

    it('deletes values', async () => {
      const storage = new BrowserStorage()
      const value = stringToBytes('to delete')

      await storage.set('delete-key', value)

      const deleteResult = await storage.delete('delete-key')
      expect(deleteResult.ok).toBe(true)
      if (deleteResult.ok) {
        expect(deleteResult.value).toBe(true)
      }

      const getResult = await storage.get('delete-key')
      expect(getResult.ok).toBe(true)
      if (getResult.ok) {
        expect(getResult.value).toBeNull()
      }
    })

    it('returns false when deleting non-existent key', async () => {
      const storage = new BrowserStorage()

      const result = await storage.delete('non-existent')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe(false)
      }
    })

    it('checks if key exists', async () => {
      const storage = new BrowserStorage()
      const value = stringToBytes('exists')

      await storage.set('exists-key', value)

      const hasResult = await storage.has('exists-key')
      expect(hasResult.ok).toBe(true)
      if (hasResult.ok) {
        expect(hasResult.value).toBe(true)
      }

      const notHasResult = await storage.has('not-exists')
      expect(notHasResult.ok).toBe(true)
      if (notHasResult.ok) {
        expect(notHasResult.value).toBe(false)
      }
    })

    it('gets all keys', async () => {
      const storage = new BrowserStorage()

      await storage.set('key1', stringToBytes('value1'))
      await storage.set('key2', stringToBytes('value2'))
      await storage.set('key3', stringToBytes('value3'))

      const keysResult = await storage.keys()
      expect(keysResult.ok).toBe(true)
      if (keysResult.ok) {
        expect(keysResult.value.length).toBe(3)
        expect(keysResult.value).toContain('key1')
        expect(keysResult.value).toContain('key2')
        expect(keysResult.value).toContain('key3')
      }
    })

    it('clears all values', async () => {
      const storage = new BrowserStorage()

      await storage.set('key1', stringToBytes('value1'))
      await storage.set('key2', stringToBytes('value2'))

      const clearResult = await storage.clear()
      expect(clearResult.ok).toBe(true)

      const keysResult = await storage.keys()
      expect(keysResult.ok).toBe(true)
      if (keysResult.ok) {
        expect(keysResult.value.length).toBe(0)
      }
    })

    it('gets storage size', async () => {
      const storage = new BrowserStorage()

      await storage.set('key1', stringToBytes('value1'))
      await storage.set('key2', stringToBytes('longer value'))

      const sizeResult = await storage.size()
      expect(sizeResult.ok).toBe(true)
      if (sizeResult.ok) {
        expect(sizeResult.value.count).toBe(2)
        expect(sizeResult.value.bytes).toBeGreaterThan(0)
      }
    })

    it('rejects values exceeding max size', async () => {
      const storage = new BrowserStorage({ maxValueSize: 10 })
      const largeValue = new Uint8Array(100)

      const result = await storage.set('large-key', largeValue)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('invalid-argument')
      }
    })

    it('handles TTL for values', async () => {
      const storage = new BrowserStorage()
      const value = stringToBytes('expiring value')

      // Set with very short TTL
      await storage.set('ttl-key', value, 1) // 1ms TTL

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10))

      const result = await storage.get('ttl-key')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBeNull()
      }
    })

    it('closes database connection', async () => {
      const storage = new BrowserStorage()

      // Trigger database open
      await storage.set('test', stringToBytes('value'))

      // Close should not throw
      storage.close()
    })
  })

  describe('getStorage', () => {
    it('returns same instance for same database name', () => {
      const storage1 = getStorage('test-db')
      const storage2 = getStorage('test-db')
      expect(storage1).toBe(storage2)
    })

    it('returns different instances for different database names', () => {
      const storage1 = getStorage('db1')
      const storage2 = getStorage('db2')
      expect(storage1).not.toBe(storage2)
    })

    it('uses default database name', () => {
      const storage1 = getStorage()
      const storage2 = getStorage()
      expect(storage1).toBe(storage2)
    })
  })

  describe('getBrowserStorageImports', () => {
    it('returns valid imports object', () => {
      const imports = getBrowserStorageImports()

      expect(imports['browser:storage/storage']).toBeDefined()
      expect(typeof imports['browser:storage/storage']).toBe('object')
    })

    it('includes all required functions', () => {
      const imports = getBrowserStorageImports()
      const storageImports = imports['browser:storage/storage'] as Record<string, unknown>

      expect(typeof storageImports['get']).toBe('function')
      expect(typeof storageImports['get-string']).toBe('function')
      expect(typeof storageImports['set']).toBe('function')
      expect(typeof storageImports['set-string']).toBe('function')
      expect(typeof storageImports['delete']).toBe('function')
      expect(typeof storageImports['has']).toBe('function')
      expect(typeof storageImports['keys']).toBe('function')
      expect(typeof storageImports['clear']).toBe('function')
      expect(typeof storageImports['size']).toBe('function')
    })

    it('uses custom database name when provided', () => {
      const imports = getBrowserStorageImports('custom-storage')
      expect(imports['browser:storage/storage']).toBeDefined()
    })
  })
})
