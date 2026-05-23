/**
 * Regression tests for wasi:keyvalue atomics + batch (REMEDIATION-PLAN Phase 2.2).
 *
 * The MemoryBucket implemented increment/getMany/setMany/deleteMany and the
 * plugin advertised atomics/batch + compare-and-swap, but getImports() only ever
 * exported the core store methods. Calling atomics.increment / batch.* therefore
 * hit a missing import. These tests assert the methods are exported and work,
 * including CAS, and that buckets are shared across the store/atomics/batch
 * interface instances (which the polyfill creates separately).
 */

import { describe, it, expect } from 'vitest'
import {
  createMemoryStore,
  memoryStoreImplementation,
} from '../../src/wasip2/plugins/keyvalue/index.js'

type KvOk<T> = { tag: 'ok'; val: T }
type KvResult<T> = KvOk<T> | { tag: 'err'; val: unknown }

interface KvImports {
  open(id: string): KvResult<number>
  increment(handle: number, key: string, delta: bigint): KvResult<bigint>
  'get-many'(handle: number, keys: string[]): KvResult<Array<[string, Uint8Array]>>
  'set-many'(
    handle: number,
    entries: Array<[string, Uint8Array]>
  ): KvResult<void>
  'delete-many'(handle: number, keys: string[]): KvResult<void>
  '[static]cas.new'(handle: number, key: string): KvResult<number>
  '[method]cas.current'(casHandle: number): KvResult<Uint8Array | undefined>
  swap(casHandle: number, value: Uint8Array): KvResult<boolean>
  '[method]bucket.get'(handle: number, key: string): KvResult<Uint8Array | undefined>
  '[method]bucket.set'(
    handle: number,
    key: string,
    value: Uint8Array
  ): KvResult<void>
  [key: string]: unknown
}

function openBucket(imports: KvImports, id = 'test'): number {
  const res = imports.open(id)
  expect(res.tag).toBe('ok')
  return (res as KvOk<number>).val
}

describe('wasi:keyvalue/atomics + batch are exported and functional', () => {
  it('exports the atomics and batch import keys', () => {
    const { instance } = createMemoryStore()
    const imports = instance.getImports()
    for (const key of [
      'increment',
      'get-many',
      'set-many',
      'delete-many',
      '[static]cas.new',
      '[method]cas.current',
      'swap',
      '[resource-drop]cas',
    ]) {
      expect(typeof imports[key], `import "${key}"`).toBe('function')
    }
  })

  it('increment accumulates on a fresh and existing key', () => {
    const { instance } = createMemoryStore()
    const imports = instance.getImports() as unknown as KvImports
    const handle = openBucket(imports)

    const first = imports.increment(handle, 'counter', 5n)
    expect(first).toEqual({ tag: 'ok', val: 5n })

    const second = imports.increment(handle, 'counter', 3n)
    expect(second).toEqual({ tag: 'ok', val: 8n })

    const third = imports.increment(handle, 'counter', -2n)
    expect(third).toEqual({ tag: 'ok', val: 6n })
  })

  it('get-many / set-many / delete-many round-trip', () => {
    const { instance } = createMemoryStore()
    const imports = instance.getImports() as unknown as KvImports
    const handle = openBucket(imports)

    const a = new Uint8Array([1, 2])
    const b = new Uint8Array([3, 4])
    const setRes = imports['set-many'](handle, [
      ['a', a],
      ['b', b],
    ])
    expect(setRes.tag).toBe('ok')

    const got = imports['get-many'](handle, ['a', 'b', 'missing'])
    expect(got.tag).toBe('ok')
    const entries = (got as KvOk<Array<[string, Uint8Array]>>).val
    const asObj = Object.fromEntries(entries.map(([k, v]) => [k, Array.from(v)]))
    expect(asObj).toEqual({ a: [1, 2], b: [3, 4] })

    const del = imports['delete-many'](handle, ['a'])
    expect(del.tag).toBe('ok')
    const after = imports['get-many'](handle, ['a', 'b'])
    expect((after as KvOk<Array<[string, Uint8Array]>>).val.map(([k]) => k)).toEqual(['b'])
  })

  it('compare-and-swap succeeds when unchanged and fails after intervening write', () => {
    const { instance } = createMemoryStore()
    const imports = instance.getImports() as unknown as KvImports
    const handle = openBucket(imports)

    imports['[method]bucket.set'](handle, 'k', new Uint8Array([1]))

    const cas1 = imports['[static]cas.new'](handle, 'k')
    expect(cas1.tag).toBe('ok')
    const casHandle1 = (cas1 as KvOk<number>).val

    // current() reflects the snapshot at cas.new time.
    const cur = imports['[method]cas.current'](casHandle1)
    expect(Array.from((cur as KvOk<Uint8Array>).val)).toEqual([1])

    // Unchanged → swap succeeds.
    const ok = imports.swap(casHandle1, new Uint8Array([2]))
    expect(ok).toEqual({ tag: 'ok', val: true })
    expect(
      Array.from(
        (imports['[method]bucket.get'](handle, 'k') as KvOk<Uint8Array>).val
      )
    ).toEqual([2])

    // A second, stale CAS handle taken before the next write should fail.
    const cas2 = imports['[static]cas.new'](handle, 'k')
    const casHandle2 = (cas2 as KvOk<number>).val
    imports['[method]bucket.set'](handle, 'k', new Uint8Array([99])) // intervening write
    const fail = imports.swap(casHandle2, new Uint8Array([3]))
    expect(fail).toEqual({ tag: 'ok', val: false })
  })

  it('shares buckets across separately-created plugin instances', () => {
    // The polyfill creates one instance per interface (store/atomics/batch).
    // They must share the same backing store so a bucket opened on one resolves
    // on another.
    const storeInst = memoryStoreImplementation.create({})
    const atomicsInst = memoryStoreImplementation.create({})
    const storeImports = storeInst.getImports() as unknown as KvImports
    const atomicsImports = atomicsInst.getImports() as unknown as KvImports

    const handle = openBucket(storeImports, 'cross-iface')
    storeImports['[method]bucket.set'](handle, 'n', new Uint8Array([0]))

    // increment via the *atomics* instance using the handle from the *store*.
    const inc = atomicsImports.increment(handle, 'n2', 7n)
    expect(inc).toEqual({ tag: 'ok', val: 7n })

    // and the store instance sees writes the atomics instance made.
    const got = storeImports['get-many'](handle, ['n2'])
    expect((got as KvOk<Array<[string, Uint8Array]>>).val.map(([k]) => k)).toEqual(['n2'])
  })
})
