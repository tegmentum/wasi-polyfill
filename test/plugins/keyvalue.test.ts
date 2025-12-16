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
} from '../../src/plugins/keyvalue/index.js'

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
      expect(result.tag).toBe('ok')
      expect(result.val).toBe(42)
    })

    it('kvErr creates error result', () => {
      const result = kvErr(noSuchStore())
      expect(result.tag).toBe('err')
      expect(result.val.tag).toBe('no-such-store')
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
      expect(result.tag).toBe('ok')
      expect(result.val).toBeGreaterThan(0)
    })

    it('returns different handles for same bucket', () => {
      const { instance } = createMemoryStore()
      const imports = instance.getImports() as {
        open: (id: string) => KeyValueResult<number>
      }

      const result1 = imports.open('test-bucket')
      const result2 = imports.open('test-bucket')

      expect(result1.tag).toBe('ok')
      expect(result2.tag).toBe('ok')
      expect(result1.val).not.toBe(result2.val)
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

      expect(allowed.tag).toBe('ok')
      expect(denied.tag).toBe('err')
      if (denied.tag === 'err') {
        expect(denied.val.tag).toBe('access-denied')
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
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        const result = imports['[method]bucket.get'](handle, 'nonexistent')
        expect(result.tag).toBe('ok')
        expect(result.val).toBeUndefined()
      })

      it('sets and gets a value', () => {
        const imports = getTestImports()
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        const value = new TextEncoder().encode('hello world')
        const setResult = imports['[method]bucket.set'](handle, 'key1', value)
        expect(setResult.tag).toBe('ok')

        const getResult = imports['[method]bucket.get'](handle, 'key1')
        expect(getResult.tag).toBe('ok')
        if (getResult.tag === 'ok' && getResult.val) {
          expect(new TextDecoder().decode(getResult.val)).toBe('hello world')
        }
      })

      it('overwrites existing value', () => {
        const imports = getTestImports()
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        imports['[method]bucket.set'](handle, 'key1', new TextEncoder().encode('first'))
        imports['[method]bucket.set'](handle, 'key1', new TextEncoder().encode('second'))

        const result = imports['[method]bucket.get'](handle, 'key1')
        expect(result.tag).toBe('ok')
        if (result.tag === 'ok' && result.val) {
          expect(new TextDecoder().decode(result.val)).toBe('second')
        }
      })

      it('returns copy of value', () => {
        const imports = getTestImports()
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        const original = new Uint8Array([1, 2, 3])
        imports['[method]bucket.set'](handle, 'key1', original)

        const result1 = imports['[method]bucket.get'](handle, 'key1')
        const result2 = imports['[method]bucket.get'](handle, 'key1')

        expect(result1.tag).toBe('ok')
        expect(result2.tag).toBe('ok')
        if (result1.tag === 'ok' && result2.tag === 'ok') {
          expect(result1.val).not.toBe(result2.val) // Different instances
          expect(result1.val).toEqual(result2.val) // Same content
        }
      })
    })

    describe('delete', () => {
      it('deletes existing key', () => {
        const imports = getTestImports()
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        imports['[method]bucket.set'](handle, 'key1', new Uint8Array([1]))
        const deleteResult = imports['[method]bucket.delete'](handle, 'key1')
        expect(deleteResult.tag).toBe('ok')

        const getResult = imports['[method]bucket.get'](handle, 'key1')
        expect(getResult.tag).toBe('ok')
        expect(getResult.val).toBeUndefined()
      })

      it('succeeds for non-existent key', () => {
        const imports = getTestImports()
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        const result = imports['[method]bucket.delete'](handle, 'nonexistent')
        expect(result.tag).toBe('ok')
      })
    })

    describe('exists', () => {
      it('returns false for non-existent key', () => {
        const imports = getTestImports()
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        const result = imports['[method]bucket.exists'](handle, 'nonexistent')
        expect(result.tag).toBe('ok')
        expect(result.val).toBe(false)
      })

      it('returns true for existing key', () => {
        const imports = getTestImports()
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        imports['[method]bucket.set'](handle, 'key1', new Uint8Array([1]))

        const result = imports['[method]bucket.exists'](handle, 'key1')
        expect(result.tag).toBe('ok')
        expect(result.val).toBe(true)
      })
    })

    describe('list-keys', () => {
      it('returns empty list for empty bucket', () => {
        const imports = getTestImports()
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        const result = imports['[method]bucket.list-keys'](handle)
        expect(result.tag).toBe('ok')
        if (result.tag === 'ok') {
          expect(result.val.keys).toEqual([])
          expect(result.val.cursor).toBeUndefined()
        }
      })

      it('returns all keys sorted', () => {
        const imports = getTestImports()
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        imports['[method]bucket.set'](handle, 'zebra', new Uint8Array([1]))
        imports['[method]bucket.set'](handle, 'apple', new Uint8Array([2]))
        imports['[method]bucket.set'](handle, 'mango', new Uint8Array([3]))

        const result = imports['[method]bucket.list-keys'](handle)
        expect(result.tag).toBe('ok')
        if (result.tag === 'ok') {
          expect(result.val.keys).toEqual(['apple', 'mango', 'zebra'])
        }
      })

      it('paginates results', () => {
        const { instance } = createMemoryStore({ pageSize: 2 })
        const imports = instance.getImports() as {
          open: (id: string) => KeyValueResult<number>
          '[method]bucket.set': (handle: number, key: string, value: Uint8Array) => KeyValueResult<void>
          '[method]bucket.list-keys': (handle: number, cursor?: string) => KeyValueResult<KeyResponse>
        }

        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }
        imports['[method]bucket.set'](handle, 'a', new Uint8Array([1]))
        imports['[method]bucket.set'](handle, 'b', new Uint8Array([2]))
        imports['[method]bucket.set'](handle, 'c', new Uint8Array([3]))
        imports['[method]bucket.set'](handle, 'd', new Uint8Array([4]))
        imports['[method]bucket.set'](handle, 'e', new Uint8Array([5]))

        // First page
        const page1 = imports['[method]bucket.list-keys'](handle)
        expect(page1.tag).toBe('ok')
        if (page1.tag === 'ok') {
          expect(page1.val.keys).toEqual(['a', 'b'])
          expect(page1.val.cursor).toBeDefined()

          // Second page
          const page2 = imports['[method]bucket.list-keys'](handle, page1.val.cursor)
          expect(page2.tag).toBe('ok')
          if (page2.tag === 'ok') {
            expect(page2.val.keys).toEqual(['c', 'd'])
            expect(page2.val.cursor).toBeDefined()

            // Third page (last)
            const page3 = imports['[method]bucket.list-keys'](handle, page2.val.cursor)
            expect(page3.tag).toBe('ok')
            if (page3.tag === 'ok') {
              expect(page3.val.keys).toEqual(['e'])
              expect(page3.val.cursor).toBeUndefined()
            }
          }
        }
      })
    })

    describe('invalid handle', () => {
      it('returns error for invalid bucket handle', () => {
        const imports = getTestImports()

        const result = imports['[method]bucket.get'](999, 'key')
        expect(result.tag).toBe('err')
        if (result.tag === 'err') {
          expect(result.val.tag).toBe('no-such-store')
        }
      })

      it('returns error after handle dropped', () => {
        const imports = getTestImports()
        const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

        imports['[resource-drop]bucket'](handle)

        const result = imports['[method]bucket.get'](handle, 'key')
        expect(result.tag).toBe('err')
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

      const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

      // Small value should work
      const smallResult = imports['[method]bucket.set'](handle, 'small', new Uint8Array(5))
      expect(smallResult.tag).toBe('ok')

      // Large value should fail
      const largeResult = imports['[method]bucket.set'](handle, 'large', new Uint8Array(20))
      expect(largeResult.tag).toBe('err')
      if (largeResult.tag === 'err') {
        expect(largeResult.val.tag).toBe('other')
      }
    })

    it('enforces max keys', () => {
      const { instance } = createMemoryStore({ maxKeys: 2 })
      const imports = instance.getImports() as {
        open: (id: string) => KeyValueResult<number>
        '[method]bucket.set': (handle: number, key: string, value: Uint8Array) => KeyValueResult<void>
      }

      const { val: handle } = imports.open('test') as { tag: 'ok'; val: number }

      imports['[method]bucket.set'](handle, 'key1', new Uint8Array([1]))
      imports['[method]bucket.set'](handle, 'key2', new Uint8Array([2]))

      // Third key should fail
      const result = imports['[method]bucket.set'](handle, 'key3', new Uint8Array([3]))
      expect(result.tag).toBe('err')
      if (result.tag === 'err') {
        expect(result.val.tag).toBe('other')
      }

      // Overwriting existing key should work
      const overwrite = imports['[method]bucket.set'](handle, 'key1', new Uint8Array([10]))
      expect(overwrite.tag).toBe('ok')
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

      const { val: handle } = imports.open('bucket1') as { tag: 'ok'; val: number }

      const result1 = imports['[method]bucket.get'](handle, 'key1')
      expect(result1.tag).toBe('ok')
      if (result1.tag === 'ok' && result1.val) {
        expect(new TextDecoder().decode(result1.val)).toBe('value1')
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

      const { val: handle1 } = imports.open('shared') as { tag: 'ok'; val: number }
      const { val: handle2 } = imports.open('shared') as { tag: 'ok'; val: number }

      // Write through handle1
      imports['[method]bucket.set'](handle1, 'key', new TextEncoder().encode('value'))

      // Read through handle2
      const result = imports['[method]bucket.get'](handle2, 'key')
      expect(result.tag).toBe('ok')
      if (result.tag === 'ok' && result.val) {
        expect(new TextDecoder().decode(result.val)).toBe('value')
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
    expect(result.tag).toBe('ok')
  })
})
