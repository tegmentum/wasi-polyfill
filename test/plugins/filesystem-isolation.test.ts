/**
 * Tests for per-polyfill filesystem isolation (REMEDIATION-PLAN 2.10).
 *
 * The filesystem instance (and its descriptor handle space) is now scoped to a
 * ResourceContext: fs/types and preopens of one polyfill share it, while
 * different polyfills get isolated filesystems (no shared file data).
 */

import { describe, it, expect } from 'vitest'
import { ResourceContext } from '../../src/wasip2/core/index.js'
import { resolveFilesystemTypesInstance } from '../../src/wasip2/plugins/filesystem/impl-memory.js'
import { memoryPreopensImplementation } from '../../src/wasip2/plugins/filesystem/preopens.js'

describe('filesystem instance isolation per ResourceContext', () => {
  it('returns the same instance within one context', () => {
    const ctx = new ResourceContext()
    expect(resolveFilesystemTypesInstance({ context: ctx })).toBe(
      resolveFilesystemTypesInstance({ context: ctx })
    )
  })

  it('isolates file data between contexts', () => {
    const a = resolveFilesystemTypesInstance({ context: new ResourceContext() })
    const b = resolveFilesystemTypesInstance({ context: new ResourceContext() })
    expect(a).not.toBe(b)

    a.getFileSystem().createDirectory('/secret')
    expect(a.getFileSystem().getNode('/secret').tag).toBe('ok')
    // B's filesystem is a different instance — it must not see A's directory.
    expect(b.getFileSystem().getNode('/secret').tag).toBe('err')
  })

  it('preopens share the fs/types filesystem within a context', () => {
    const ctx = new ResourceContext()
    const fsInstance = resolveFilesystemTypesInstance({ context: ctx })
    fsInstance.getFileSystem().createDirectory('/data')

    const preopens = memoryPreopensImplementation.create({
      context: ctx,
      options: { preopens: [{ path: '/data' }] },
    })
    const getDirectories = preopens.getImports()['get-directories'] as () => Array<
      [number, string]
    >
    const dirs = getDirectories()
    expect(dirs.some(([, alias]) => alias === '/data')).toBe(true)
  })

  it('preopens in a different context do not see another context’s files', () => {
    const ctxA = new ResourceContext()
    resolveFilesystemTypesInstance({ context: ctxA }).getFileSystem().createDirectory('/only-a')

    const preopens = memoryPreopensImplementation.create({
      context: new ResourceContext(),
      options: { preopens: [{ path: '/only-a' }] },
    })
    const getDirectories = preopens.getImports()['get-directories'] as () => Array<
      [number, string]
    >
    expect(getDirectories().length).toBe(0)
  })
})
