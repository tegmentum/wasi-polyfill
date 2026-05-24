/**
 * Regression tests for browser capability enforcement (REMEDIATION-PLAN 2.4).
 *
 * getBrowserImports() used to wire up every interface unconditionally, so a
 * component had full host access regardless of what it was "granted". A
 * capabilities allow-list now gates which interfaces are provided.
 */

import { describe, it, expect } from 'vitest'
import { getBrowserImports } from '../../../src/browser/index.js'

describe('getBrowserImports capability enforcement', () => {
  it('provides every interface when no allow-list is given (back-compat)', () => {
    const all = getBrowserImports()
    expect(all['browser:worker']).toBeDefined()
    // A representative sample of other interfaces is present too.
    expect(Object.keys(all).length).toBeGreaterThan(10)
  })

  it('only wires granted interfaces when an allow-list is given', () => {
    const imports = getBrowserImports({ capabilities: ['worker'] })
    expect(imports['browser:worker']).toBeDefined()
    // Ungranted interfaces must be absent.
    expect(imports['browser:dom']).toBeUndefined()
    expect(imports['browser:clipboard']).toBeUndefined()
  })

  it('excludes an interface that is not granted', () => {
    const imports = getBrowserImports({ capabilities: ['fetch'] })
    expect(imports['browser:worker']).toBeUndefined()
  })

  it('an empty allow-list grants no gated interfaces', () => {
    const empty = getBrowserImports({ capabilities: [] })
    const full = getBrowserImports()
    expect(empty['browser:worker']).toBeUndefined()
    expect(Object.keys(empty).length).toBeLessThan(Object.keys(full).length)
    // Pure host utilities (types/runtime) remain available.
    expect(Object.keys(empty).length).toBeGreaterThan(0)
  })

  it('keeps the always-on utilities across all capability sets', () => {
    const empty = getBrowserImports({ capabilities: [] })
    const granted = getBrowserImports({ capabilities: ['worker'] })
    // Every key present with an empty allow-list (the utilities) is also present
    // when a capability is granted.
    for (const key of Object.keys(empty)) {
      expect(granted[key]).toBeDefined()
    }
  })
})
