/**
 * Tests for the WASIP1 Node host filesystem backend (REMEDIATION-PLAN 3.1).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { createNodeFilesystem } from '../../src/wasip1/hostfs-node.js'
import { FileType } from '../../src/wasip1/types.js'
import type { Filesystem } from '../../src/wasip1/path.js'
import type { FileResource, DirectoryResource } from '../../src/wasip1/fd.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

describe('WASIP1 Node hostfs', () => {
  let root: string
  let hostfs: Filesystem

  beforeEach(() => {
    root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'wasi-hostfs-'))
    hostfs = createNodeFilesystem(root)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('creates, writes, and reads a file at an offset', () => {
    const file = hostfs.open('hello.txt', { create: true }) as FileResource
    const data = enc.encode('hello world')
    expect(file.write(0n, data)).toBe(data.length)
    expect(file.size()).toBe(BigInt(data.length))
    const read = file.read(6n, 5)
    expect(dec.decode(read)).toBe('world')
    file.close?.()

    // The bytes really landed on disk.
    expect(fs.readFileSync(nodePath.join(root, 'hello.txt'), 'utf8')).toBe('hello world')
  })

  it('creates and lists directories', () => {
    hostfs.createDirectory('sub')
    const file = hostfs.open('sub/a.txt', { create: true }) as FileResource
    file.write(0n, enc.encode('x'))
    file.close?.()

    const dir = hostfs.open('sub', { directory: true }) as DirectoryResource
    const names = dir.readdir().map((e) => e.name)
    expect(names).toContain('a.txt')
    const entry = dir.readdir().find((e) => e.name === 'a.txt')!
    expect(entry.type).toBe(FileType.REGULAR_FILE)
  })

  it('stat reports directory vs file', () => {
    hostfs.createDirectory('d')
    expect(hostfs.stat('d').filetype).toBe(FileType.DIRECTORY)
    const f = hostfs.open('f', { create: true }) as FileResource
    f.write(0n, enc.encode('abc'))
    f.close?.()
    const st = hostfs.stat('f')
    expect(st.filetype).toBe(FileType.REGULAR_FILE)
    expect(st.size).toBe(3n)
  })

  it('renames and unlinks files; removes directories', () => {
    const f = hostfs.open('old.txt', { create: true }) as FileResource
    f.write(0n, enc.encode('data'))
    f.close?.()
    hostfs.rename('old.txt', 'new.txt')
    expect(fs.existsSync(nodePath.join(root, 'new.txt'))).toBe(true)
    expect(fs.existsSync(nodePath.join(root, 'old.txt'))).toBe(false)

    hostfs.unlink('new.txt')
    expect(fs.existsSync(nodePath.join(root, 'new.txt'))).toBe(false)

    hostfs.createDirectory('empty')
    hostfs.removeDirectory('empty')
    expect(fs.existsSync(nodePath.join(root, 'empty'))).toBe(false)
  })

  it('round-trips symlinks', () => {
    const f = hostfs.open('target.txt', { create: true }) as FileResource
    f.write(0n, enc.encode('t'))
    f.close?.()
    hostfs.symlink!('target.txt', 'link.txt')
    expect(hostfs.readlink!('link.txt')).toBe('target.txt')
  })

  it('honors O_EXCL (fails if the file already exists)', () => {
    hostfs.open('excl.txt', { create: true }) as FileResource
    expect(() =>
      hostfs.open('excl.txt', { create: true, exclusive: true })
    ).toThrow(/exist/i)
  })

  describe('sandbox containment', () => {
    it('rejects ".." escapes', () => {
      expect(() => hostfs.open('../escape.txt', { create: true })).toThrow(
        /escapes sandbox/
      )
    })

    it('rejects deep ".." escapes', () => {
      expect(() => hostfs.stat('../../../../etc/passwd')).toThrow(/escapes sandbox/)
    })

    it('rejects symlink escapes', () => {
      // Create a symlink inside the sandbox pointing outside it.
      const outside = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'wasi-outside-'))
      try {
        fs.symlinkSync(outside, nodePath.join(root, 'evil'))
        expect(() => hostfs.open('evil/secret.txt', { create: true })).toThrow(
          /escapes sandbox/
        )
      } finally {
        fs.rmSync(outside, { recursive: true, force: true })
      }
    })
  })
})
