/**
 * Tests for WASIP2 memory-filesystem symbolic + hard links (REMEDIATION-PLAN 3.2).
 *
 * Previously symlink-at/readlink-at/link-at returned Unsupported. The memory FS
 * now supports symlinks (create/read, intermediate + final following with loop
 * detection, relative and absolute targets) and hard links.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MemoryFileSystem,
  FilesystemErrorCode,
} from '../../src/wasip2/plugins/filesystem/index.js'

describe('MemoryFileSystem symbolic links', () => {
  let fs: MemoryFileSystem

  beforeEach(() => {
    fs = new MemoryFileSystem()
  })

  function expectOk<T>(r: { tag: string; val?: T }): T {
    expect(r.tag).toBe('ok')
    return (r as { tag: 'ok'; val: T }).val
  }

  it('creates and reads back a symlink without following it', () => {
    fs.createFile('/target.txt', { create: true })
    expectOk(fs.symlink('target.txt', '/link.txt'))

    // readlink returns the verbatim target.
    expect(expectOk(fs.readlink('/link.txt'))).toBe('target.txt')

    // getNode without following yields the symlink node itself.
    const node = expectOk(fs.getNode('/link.txt'))
    expect(node.type).toBe('symlink')
  })

  it('follows a symlink to its target when requested', () => {
    fs.createFile('/target.txt', { create: true })
    fs.symlink('target.txt', '/link.txt')

    const followed = expectOk(fs.getNode('/link.txt', undefined, true))
    expect(followed.type).toBe('file')
    // Same underlying node as the target.
    expect(followed).toBe(expectOk(fs.getNode('/target.txt')))
  })

  it('follows an absolute-target symlink', () => {
    fs.createDirectory('/a')
    fs.createFile('/a/f.txt', { create: true })
    fs.symlink('/a/f.txt', '/abs-link')
    const followed = expectOk(fs.getNode('/abs-link', undefined, true))
    expect(followed).toBe(expectOk(fs.getNode('/a/f.txt')))
  })

  it('follows symlinks in intermediate path components', () => {
    fs.createDirectory('/realdir')
    fs.createFile('/realdir/inside.txt', { create: true })
    fs.symlink('realdir', '/dirlink')

    // '/dirlink/inside.txt' must traverse the symlinked directory.
    const node = expectOk(fs.getNode('/dirlink/inside.txt'))
    expect(node.type).toBe('file')
    expect(node).toBe(expectOk(fs.getNode('/realdir/inside.txt')))
  })

  it('reports a loop for self-referential symlink chains', () => {
    fs.symlink('b', '/a')
    fs.symlink('a', '/b')
    const r = fs.getNode('/a', undefined, true)
    expect(r.tag).toBe('err')
    if (r.tag === 'err') expect(r.val).toBe(FilesystemErrorCode.Loop)
  })

  it('readlink on a non-symlink errors', () => {
    fs.createFile('/regular.txt', { create: true })
    const r = fs.readlink('/regular.txt')
    expect(r.tag).toBe('err')
    if (r.tag === 'err') expect(r.val).toBe(FilesystemErrorCode.Invalid)
  })

  it('rejects creating a symlink where something already exists', () => {
    fs.createFile('/exists', { create: true })
    const r = fs.symlink('whatever', '/exists')
    expect(r.tag).toBe('err')
    if (r.tag === 'err') expect(r.val).toBe(FilesystemErrorCode.Exist)
  })
})

describe('MemoryFileSystem hard links', () => {
  let fs: MemoryFileSystem

  beforeEach(() => {
    fs = new MemoryFileSystem()
  })

  it('creates a hard link to the same underlying node', () => {
    fs.createFile('/orig.txt', { create: true })
    const r = fs.hardLink('/orig.txt', '/hard.txt', false)
    expect(r.tag).toBe('ok')

    const a = fs.getNode('/orig.txt')
    const b = fs.getNode('/hard.txt')
    expect(a.tag).toBe('ok')
    expect(b.tag).toBe('ok')
    if (a.tag === 'ok' && b.tag === 'ok') {
      expect(b.val).toBe(a.val) // same node reference
    }
  })

  it('refuses to hard-link a directory', () => {
    fs.createDirectory('/d')
    const r = fs.hardLink('/d', '/d2', false)
    expect(r.tag).toBe('err')
    if (r.tag === 'err') expect(r.val).toBe(FilesystemErrorCode.NotPermitted)
  })

  it('refuses to overwrite an existing target', () => {
    fs.createFile('/a', { create: true })
    fs.createFile('/b', { create: true })
    const r = fs.hardLink('/a', '/b', false)
    expect(r.tag).toBe('err')
    if (r.tag === 'err') expect(r.val).toBe(FilesystemErrorCode.Exist)
  })
})
