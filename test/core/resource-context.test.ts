/**
 * Tests for per-polyfill ResourceContext isolation (REMEDIATION-PLAN 2.10).
 *
 * Plugin backing state (here, the keyvalue store) is scoped to a ResourceContext
 * so it is shared within one polyfill but isolated between polyfills.
 */

import { describe, it, expect } from 'vitest'
import { ResourceContext } from '../../src/wasip2/core/index.js'
import { memoryStoreImplementation } from '../../src/wasip2/plugins/keyvalue/index.js'

type KvOk<T> = { ok: true; value: T }
interface KvImports {
  open(id: string): KvOk<number>
  '[method]bucket.set'(h: number, k: string, v: Uint8Array): unknown
  '[method]bucket.get'(h: number, k: string): KvOk<Uint8Array | undefined>
  [key: string]: unknown
}

function kvFor(context: ResourceContext): KvImports {
  return memoryStoreImplementation.create({ context }).getImports() as unknown as KvImports
}

describe('ResourceContext', () => {
  it('lazily creates and caches a resource per key', () => {
    const ctx = new ResourceContext()
    const key = Symbol('test')
    let calls = 0
    const a = ctx.get(key, () => ({ id: ++calls }))
    const b = ctx.get(key, () => ({ id: ++calls }))
    expect(a).toBe(b)
    expect(calls).toBe(1)
    expect(ctx.has(key)).toBe(true)
  })

  it('clear() drops cached resources', () => {
    const ctx = new ResourceContext()
    const key = Symbol('test')
    ctx.get(key, () => 1)
    ctx.clear()
    expect(ctx.has(key)).toBe(false)
  })
})

describe('keyvalue state is isolated per ResourceContext', () => {
  const bytes = new Uint8Array([1, 2, 3])

  it('two contexts do not share buckets', () => {
    const a = kvFor(new ResourceContext())
    const b = kvFor(new ResourceContext())

    const ha = a.open('shared').value
    a['[method]bucket.set'](ha, 'k', bytes)

    // B opens the same bucket name but on its own store — key is absent.
    const hb = b.open('shared').value
    const got = b['[method]bucket.get'](hb, 'k')
    expect(got).toEqual({ ok: true, value: undefined })
  })

  it('instances sharing one context share buckets (within a polyfill)', () => {
    const ctx = new ResourceContext()
    const a = kvFor(ctx)
    const b = kvFor(ctx)

    const ha = a.open('shared').value
    a['[method]bucket.set'](ha, 'k', bytes)

    const hb = b.open('shared').value
    const got = b['[method]bucket.get'](hb, 'k') as KvOk<Uint8Array>
    expect(Array.from(got.value)).toEqual([1, 2, 3])
  })
})
