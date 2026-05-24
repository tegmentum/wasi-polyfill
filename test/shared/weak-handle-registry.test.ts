/**
 * Tests for WeakHandleRegistry's bidirectional handle allocation
 * (REMEDIATION-PLAN 1.3). Browser interfaces hand out stable handles for
 * host-owned objects via `handleFor` (dedup by reference); the registry holds
 * weak references and prunes on drop/GC. GC finalization timing is not
 * deterministically testable, so these cover the non-GC API contract.
 */

import { describe, it, expect } from 'vitest'
import { WeakHandleRegistry } from '../../src/shared/registry.js'

describe('WeakHandleRegistry.handleFor', () => {
  it('returns the same handle for the same object (dedup by identity)', () => {
    const reg = new WeakHandleRegistry<object>()
    const obj = { id: 1 }
    const h1 = reg.handleFor(obj)
    const h2 = reg.handleFor(obj)
    expect(h1).toBe(h2)
  })

  it('returns distinct handles for distinct objects', () => {
    const reg = new WeakHandleRegistry<object>()
    const a = {}
    const b = {}
    expect(reg.handleFor(a)).not.toBe(reg.handleFor(b))
  })

  it('resolves a handle back to its object', () => {
    const reg = new WeakHandleRegistry<object>()
    const obj = { name: 'x' }
    const h = reg.handleFor(obj)
    expect(reg.get(h)).toBe(obj)
    expect(reg.has(h)).toBe(true)
  })

  it('returns undefined for unknown handles', () => {
    const reg = new WeakHandleRegistry<object>()
    expect(reg.get(999)).toBeUndefined()
    expect(reg.has(999)).toBe(false)
  })

  it('register() always allocates a fresh handle', () => {
    const reg = new WeakHandleRegistry<object>()
    const obj = {}
    expect(reg.register(obj)).not.toBe(reg.register(obj))
  })

  it('drop() removes the entry and lets the object re-register fresh', () => {
    const reg = new WeakHandleRegistry<object>()
    const obj = {}
    const h1 = reg.handleFor(obj)
    expect(reg.drop(h1)).toBe(true)
    expect(reg.get(h1)).toBeUndefined()

    // After drop, the reverse map is cleared, so a new handle is minted.
    const h2 = reg.handleFor(obj)
    expect(h2).not.toBe(h1)
    expect(reg.get(h2)).toBe(obj)
  })

  it('honors a custom start handle', () => {
    const reg = new WeakHandleRegistry<object>(100)
    expect(reg.handleFor({})).toBe(100)
  })
})
