/**
 * Tests for context-scoped wasi:io/error registry (REMEDIATION-PLAN 2.10,
 * first coupled-space resource group).
 *
 * The error registry is io-internal (self-contained), so it is the one io
 * resource registry that can be isolated per-polyfill today. This verifies the
 * resolve + global-pre-seed pattern that the pollable/stream registries will
 * later reuse.
 */

import { describe, it, expect } from 'vitest'
import { ResourceContext } from '../../src/wasip2/core/index.js'
import {
  resolveErrorRegistry,
  globalErrorRegistry,
} from '../../src/wasip2/plugins/io/error.js'

describe('io error registry context resolution', () => {
  it('falls back to the global registry when no context is supplied', () => {
    expect(resolveErrorRegistry({})).toBe(globalErrorRegistry)
  })

  it('returns the same registry for the same context', () => {
    const ctx = new ResourceContext()
    expect(resolveErrorRegistry({ context: ctx })).toBe(
      resolveErrorRegistry({ context: ctx })
    )
  })

  it('isolates registries between different contexts', () => {
    const a = new ResourceContext()
    const b = new ResourceContext()
    const ra = resolveErrorRegistry({ context: a })
    const rb = resolveErrorRegistry({ context: b })
    expect(ra).not.toBe(rb)
    expect(ra).not.toBe(globalErrorRegistry)
  })

  it('isolated registries track errors independently', () => {
    const a = resolveErrorRegistry({ context: new ResourceContext() })
    const b = resolveErrorRegistry({ context: new ResourceContext() })
    const handle = a.create(new Error('boom'), 'debug')
    expect(a.get(handle)).toBeDefined()
    expect(b.get(handle)).toBeUndefined()
  })
})
