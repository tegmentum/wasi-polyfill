/**
 * Tests for real WebAssembly GC feature detection (REMEDIATION-PLAN 3.15).
 * Previously isWasmGcEnabled() was hardcoded to false.
 */

import { describe, it, expect } from 'vitest'
import { isWasmGcEnabled } from '../../../src/browser/index.js'

// \0asm v1 + a type section declaring `struct { i8 }` — validates only under GC.
const GC_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x5f, 0x01,
  0x78, 0x00,
])

describe('isWasmGcEnabled', () => {
  it('returns a boolean matching WebAssembly.validate of a GC module', () => {
    const expected = WebAssembly.validate(GC_PROBE)
    expect(isWasmGcEnabled()).toBe(expected)
  })

  it('is stable across calls (memoized)', () => {
    expect(isWasmGcEnabled()).toBe(isWasmGcEnabled())
  })

  it('does not validate a plain (non-GC) module as GC-specific', () => {
    // An empty module validates regardless of GC; detection must rely on the
    // GC-specific struct type, not just "is WebAssembly present".
    const emptyModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
    expect(WebAssembly.validate(emptyModule)).toBe(true)
    // The detector's answer is tied to the GC probe specifically.
    expect(isWasmGcEnabled()).toBe(WebAssembly.validate(GC_PROBE))
  })
})
