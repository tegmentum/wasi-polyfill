/**
 * Tests for the OPFS session-scoped set-times override store
 * (REMEDIATION-PLAN 3.12). OPFS has no native set-times API, so rather than
 * silently no-op'ing, the descriptor records an in-memory override that stat
 * reflects. The full descriptor flow is browser-only (Playwright e2e); this
 * covers the store's merge semantics directly.
 */

import { describe, it, expect } from 'vitest'
import { OpfsTimesStore } from '../../src/wasip2/plugins/filesystem/index.js'

const t = (seconds: bigint) => ({ seconds, nanoseconds: 0 })

describe('OpfsTimesStore', () => {
  it('returns undefined for unknown keys', () => {
    expect(new OpfsTimesStore().get('a/b')).toBeUndefined()
  })

  it('stores access and modification times', () => {
    const store = new OpfsTimesStore()
    store.set('file.txt', t(10n), t(20n))
    expect(store.get('file.txt')).toEqual({ atim: t(10n), mtim: t(20n) })
  })

  it('merges partial updates (no-change leaves the other field intact)', () => {
    const store = new OpfsTimesStore()
    store.set('f', t(1n), t(2n))
    store.set('f', undefined, t(99n)) // only modification changes
    expect(store.get('f')).toEqual({ atim: t(1n), mtim: t(99n) })
    store.set('f', t(5n), undefined) // only access changes
    expect(store.get('f')).toEqual({ atim: t(5n), mtim: t(99n) })
  })

  it('is a no-op when both timestamps are undefined', () => {
    const store = new OpfsTimesStore()
    store.set('f', undefined, undefined)
    expect(store.get('f')).toBeUndefined()
  })

  it('keys are independent', () => {
    const store = new OpfsTimesStore()
    store.set('a', t(1n), t(1n))
    store.set('b', t(2n), t(2n))
    expect(store.get('a')).toEqual({ atim: t(1n), mtim: t(1n) })
    expect(store.get('b')).toEqual({ atim: t(2n), mtim: t(2n) })
  })
})
