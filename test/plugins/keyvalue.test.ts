import { describe, it, expect } from 'vitest'
import {
  keyvalueStorePlugin,
  keyvalueAtomicsPlugin,
  keyvalueBatchPlugin,
  memoryStoreImplementation,
  createMemoryStore,
  noSuchStore,
  accessDenied,
  otherError,
  kvOk,
  kvErr,
  DEFAULT_STORE_CONFIG,
  type KeyValueResult,
  type KeyResponse,
} from '../../src/wasip2/plugins/keyvalue/index.js'

describe('wasi:keyvalue/store', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(keyvalueStorePlugin.witInterface.package).toBe('wasi:keyvalue')
      expect(keyvalueStorePlugin.witInterface.name).toBe('store')
      expect(keyvalueStorePlugin.witInterface.version).toBe('0.2.0-draft')
    })

    it('has memory as default implementation', () => {
      expect(keyvalueStorePlugin.defaultImplementation).toBe('memory')
    })
  })

  describe('error helpers', () => {
    it('noSuchStore creates correct error', () => {
      const err = noSuchStore()
      expect(err.tag).toBe('no-such-store')
    })

    it('accessDenied creates correct error', () => {
      const err = accessDenied()
      expect(err.tag).toBe('access-denied')
    })

    it('otherError creates correct error', () => {
      const err = otherError('test message')
      expect(err.tag).toBe('other')
      expect(err.val).toBe('test message')
    })

    it('kvOk creates success result', () => {
      const result = kvOk(42)
      expect(result.ok).toBe(true)
      expect(result.value).toBe(42)
    })

    it('kvErr creates error result', () => {
      const result = kvErr(noSuchStore())
      expect(result.ok).toBe(false)
      expect(result.error.tag).toBe('no-such-store')
    })
  })

  describe('default config', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_STORE_CONFIG.maxValueSize).toBe(1024 * 1024)
      expect(DEFAULT_STORE_CONFIG.pageSize).toBe(100)
    })
  })
})

describe('memory implementation', () => {
  it('has correct metadata', () => {
    expect(memoryStoreImplementation.name).toBe('memory')
    expect(memoryStoreImplementation.description).toContain('memory')
  })

  describe('open', () => {
    it('opens a bucket and returns handle', () => {
      const { instance } = createMemoryStore()
      const imports = instance.getImports() as {
        open: (id: string) => KeyValueResult<number>
      }

      const result = imports.open('test-bucket')
      expect(result.ok).toBe(true)
      expect(result.value).toBeGreaterThan(0)
    })

    it('returns different handles for same bucket', () => {
      const { instance } = createMemoryStore()
      const imports = instance.getImports() as {
        open: (id: string) => KeyValueResult<number>
      }

      const result1 = imports.open('test-bucket')
      const result2 = imports.open('test-bucket')

      expect(result1.ok).toBe(true)
      expect(result2.ok).toBe(true)
      expect(result1.value).not.toBe(result2.value)
    })

    it('respects allowedBuckets restriction', () => {
      const { instance } = createMemoryStore({
        allowedBuckets: ['allowed'],
      })
      const imports = instance.getImports() as {
        open: (id: string) => KeyValueResult<number>
      }

      const allowed = imports.open('allowed')
      const denied = imports.open('denied')

      expect(allowed.ok).toBe(true)
      expect(denied.ok).toBe(false)
      if (!denied.ok) {
        expect(denied.error.tag).toBe('access-denied')
      }
    })
  })

  describe('bucket operations', () => {
    const getTestImports = () => {
      const { instance } = createMemoryStore()
      const imports = instance.getImports() as {
        open: (id: string) => KeyValueResult<number>
        '[method]bucket.get': (handle: number, key: string) => KeyValueResult<Uint8Array | undefined>
        '[method]bucket.set': (handle: number, key: string, value: Uint8Array) => KeyValueResult<void>
        '[method]bucket.delete': (handle: number, key: string) => KeyValueResult<void>
        '[method]bucket.exists': (handle: number, key: string) => KeyValueResult<boolean>
        '[method]bucket.list-keys': (handle: number, cursor?: string) => KeyValueResult<KeyResponse>
        '[resource-drop]bucket': (handle: number) => void
      }
      return imports
    }

    describe('get/set', () => {
      it('returns undefined for non-existent key', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        const result = imports['[method]bucket.get'](handle, 'nonexistent')
        expect(result.ok).toBe(true)
        expect(result.value).toBeUndefined()
      })

      it('sets and gets a value', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        const value = new TextEncoder().encode('hello world')
        const setResult = imports['[method]bucket.set'](handle, 'key1', value)
        expect(setResult.ok).toBe(true)

        const getResult = imports['[method]bucket.get'](handle, 'key1')
        expect(getResult.ok).toBe(true)
        if (getResult.ok && getResult.value) {
          expect(new TextDecoder().decode(getResult.value)).toBe('hello world')
        }
      })

      it('overwrites existing value', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        imports['[method]bucket.set'](handle, 'key1', new TextEncoder().encode('first'))
        imports['[method]bucket.set'](handle, 'key1', new TextEncoder().encode('second'))

        const result = imports['[method]bucket.get'](handle, 'key1')
        expect(result.ok).toBe(true)
        if (result.ok && result.value) {
          expect(new TextDecoder().decode(result.value)).toBe('second')
        }
      })

      it('returns copy of value', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        const original = new Uint8Array([1, 2, 3])
        imports['[method]bucket.set'](handle, 'key1', original)

        const result1 = imports['[method]bucket.get'](handle, 'key1')
        const result2 = imports['[method]bucket.get'](handle, 'key1')

        expect(result1.ok).toBe(true)
        expect(result2.ok).toBe(true)
        if (result1.ok && result2.ok) {
          expect(result1.value).not.toBe(result2.value) // Different instances
          expect(result1.value).toEqual(result2.value) // Same content
        }
      })
    })

    describe('delete', () => {
      it('deletes existing key', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        imports['[method]bucket.set'](handle, 'key1', new Uint8Array([1]))
        const deleteResult = imports['[method]bucket.delete'](handle, 'key1')
        expect(deleteResult.ok).toBe(true)

        const getResult = imports['[method]bucket.get'](handle, 'key1')
        expect(getResult.ok).toBe(true)
        expect(getResult.value).toBeUndefined()
      })

      it('succeeds for non-existent key', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        const result = imports['[method]bucket.delete'](handle, 'nonexistent')
        expect(result.ok).toBe(true)
      })
    })

    describe('exists', () => {
      it('returns false for non-existent key', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        const result = imports['[method]bucket.exists'](handle, 'nonexistent')
        expect(result.ok).toBe(true)
        expect(result.value).toBe(false)
      })

      it('returns true for existing key', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        imports['[method]bucket.set'](handle, 'key1', new Uint8Array([1]))

        const result = imports['[method]bucket.exists'](handle, 'key1')
        expect(result.ok).toBe(true)
        expect(result.value).toBe(true)
      })
    })

    describe('list-keys', () => {
      it('returns empty list for empty bucket', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        const result = imports['[method]bucket.list-keys'](handle)
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.keys).toEqual([])
          expect(result.value.cursor).toBeUndefined()
        }
      })

      it('returns all keys sorted', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        imports['[method]bucket.set'](handle, 'zebra', new Uint8Array([1]))
        imports['[method]bucket.set'](handle, 'apple', new Uint8Array([2]))
        imports['[method]bucket.set'](handle, 'mango', new Uint8Array([3]))

        const result = imports['[method]bucket.list-keys'](handle)
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.value.keys).toEqual(['apple', 'mango', 'zebra'])
        }
      })

      it('paginates results', () => {
        const { instance } = createMemoryStore({ pageSize: 2 })
        const imports = instance.getImports() as {
          open: (id: string) => KeyValueResult<number>
          '[method]bucket.set': (handle: number, key: string, value: Uint8Array) => KeyValueResult<void>
          '[method]bucket.list-keys': (handle: number, cursor?: string) => KeyValueResult<KeyResponse>
        }

        const { value: handle } = imports.open('test') as { ok: true; value: number }
        imports['[method]bucket.set'](handle, 'a', new Uint8Array([1]))
        imports['[method]bucket.set'](handle, 'b', new Uint8Array([2]))
        imports['[method]bucket.set'](handle, 'c', new Uint8Array([3]))
        imports['[method]bucket.set'](handle, 'd', new Uint8Array([4]))
        imports['[method]bucket.set'](handle, 'e', new Uint8Array([5]))

        // First page
        const page1 = imports['[method]bucket.list-keys'](handle)
        expect(page1.ok).toBe(true)
        if (page1.ok) {
          expect(page1.value.keys).toEqual(['a', 'b'])
          expect(page1.value.cursor).toBeDefined()

          // Second page
          const page2 = imports['[method]bucket.list-keys'](handle, page1.value.cursor)
          expect(page2.ok).toBe(true)
          if (page2.ok) {
            expect(page2.value.keys).toEqual(['c', 'd'])
            expect(page2.value.cursor).toBeDefined()

            // Third page (last)
            const page3 = imports['[method]bucket.list-keys'](handle, page2.value.cursor)
            expect(page3.ok).toBe(true)
            if (page3.ok) {
              expect(page3.value.keys).toEqual(['e'])
              expect(page3.value.cursor).toBeUndefined()
            }
          }
        }
      })
    })

    describe('invalid handle', () => {
      it('returns error for invalid bucket handle', () => {
        const imports = getTestImports()

        const result = imports['[method]bucket.get'](999, 'key')
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.tag).toBe('no-such-store')
        }
      })

      it('returns error after handle dropped', () => {
        const imports = getTestImports()
        const { value: handle } = imports.open('test') as { ok: true; value: number }

        imports['[resource-drop]bucket'](handle)

        const result = imports['[method]bucket.get'](handle, 'key')
        expect(result.ok).toBe(false)
      })
    })
  })

  describe('limits', () => {
    it('enforces max value size', () => {
      const { instance } = createMemoryStore({ maxValueSize: 10 })
      const imports = instance.getImports() as {
        open: (id: string) => KeyValueResult<number>
        '[method]bucket.set': (handle: number, key: string, value: Uint8Array) => KeyValueResult<void>
      }

      const { value: handle } = imports.open('test') as { ok: true; value: number }

      // Small value should work
      const smallResult = imports['[method]bucket.set'](handle, 'small', new Uint8Array(5))
      expect(smallResult.ok).toBe(true)

      // Large value should fail
      const largeResult = imports['[method]bucket.set'](handle, 'large', new Uint8Array(20))
      expect(largeResult.ok).toBe(false)
      if (!largeResult.ok) {
        expect(largeResult.error.tag).toBe('other')
      }
    })

    it('enforces max keys', () => {
      const { instance } = createMemoryStore({ maxKeys: 2 })
      const imports = instance.getImports() as {
        open: (id: string) => KeyValueResult<number>
        '[method]bucket.set': (handle: number, key: string, value: Uint8Array) => KeyValueResult<void>
      }

      const { value: handle } = imports.open('test') as { ok: true; value: number }

      imports['[method]bucket.set'](handle, 'key1', new Uint8Array([1]))
      imports['[method]bucket.set'](handle, 'key2', new Uint8Array([2]))

      // Third key should fail
      const result = imports['[method]bucket.set'](handle, 'key3', new Uint8Array([3]))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.tag).toBe('other')
      }

      // Overwriting existing key should work
      const overwrite = imports['[method]bucket.set'](handle, 'key1', new Uint8Array([10]))
      expect(overwrite.ok).toBe(true)
    })
  })

  describe('initial data', () => {
    it('populates bucket from initial data', () => {
      const initialData = new Map<string, Map<string, Uint8Array>>([
        ['bucket1', new Map([
          ['key1', new TextEncoder().encode('value1')],
          ['key2', new TextEncoder().encode('value2')],
        ])],
      ])

      const { instance } = createMemoryStore({ initialData })
      const imports = instance.getImports() as {
        open: (id: string) => KeyValueResult<number>
        '[method]bucket.get': (handle: number, key: string) => KeyValueResult<Uint8Array | undefined>
      }

      const { value: handle } = imports.open('bucket1') as { ok: true; value: number }

      const result1 = imports['[method]bucket.get'](handle, 'key1')
      expect(result1.ok).toBe(true)
      if (result1.ok && result1.value) {
        expect(new TextDecoder().decode(result1.value)).toBe('value1')
      }
    })
  })

  describe('shared bucket state', () => {
    it('multiple handles see same data', () => {
      const { instance } = createMemoryStore()
      const imports = instance.getImports() as {
        open: (id: string) => KeyValueResult<number>
        '[method]bucket.get': (handle: number, key: string) => KeyValueResult<Uint8Array | undefined>
        '[method]bucket.set': (handle: number, key: string, value: Uint8Array) => KeyValueResult<void>
      }

      const { value: handle1 } = imports.open('shared') as { ok: true; value: number }
      const { value: handle2 } = imports.open('shared') as { ok: true; value: number }

      // Write through handle1
      imports['[method]bucket.set'](handle1, 'key', new TextEncoder().encode('value'))

      // Read through handle2
      const result = imports['[method]bucket.get'](handle2, 'key')
      expect(result.ok).toBe(true)
      if (result.ok && result.value) {
        expect(new TextDecoder().decode(result.value)).toBe('value')
      }
    })
  })
})

describe('wasi:keyvalue/atomics', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(keyvalueAtomicsPlugin.witInterface.package).toBe('wasi:keyvalue')
      expect(keyvalueAtomicsPlugin.witInterface.name).toBe('atomics')
    })
  })
})

describe('wasi:keyvalue/batch', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(keyvalueBatchPlugin.witInterface.package).toBe('wasi:keyvalue')
      expect(keyvalueBatchPlugin.witInterface.name).toBe('batch')
    })
  })
})

describe('plugin integration', () => {
  it('can create memory store via plugin', () => {
    const instance = keyvalueStorePlugin.create({
      implementation: 'memory',
    })

    const imports = instance.getImports() as {
      open: (id: string) => KeyValueResult<number>
    }

    const result = imports.open('test')
    expect(result.ok).toBe(true)
  })
})
