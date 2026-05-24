/**
 * Regression tests for the capacity-doubling growth of memory-FS files
 * (REMEDIATION-PLAN 4.1).
 *
 * The optimization keeps `node.content` a view whose `.length` is the logical
 * file size while the backing ArrayBuffer may be larger, so these tests assert
 * both the optimization (capacity > logical size after a small write) and that
 * all the externally observable semantics are unchanged: streaming-append
 * content, sparse-write zero-fill, and read EOF at the logical size.
 */

import { describe, it, expect } from 'vitest'
import {
  MemoryFileSystem,
  Descriptor,
  type FileNode,
} from '../../src/wasip2/plugins/filesystem/index.js'
import { PollableRegistry } from '../../src/wasip2/plugins/io/pollable.js'
import {
  globalStreamRegistry,
  type OutputStream,
} from '../../src/wasip2/plugins/io/streams.js'

function makeFile(fs: MemoryFileSystem, path: string): { desc: Descriptor; node: FileNode } {
  const created = fs.createFile(path, { create: true })
  if (created.tag !== 'ok') throw new Error(`createFile failed: ${String(created.val)}`)
  const node = created.val
  const desc = new Descriptor(
    fs,
    node,
    path,
    { read: true, write: true },
    new PollableRegistry()
  )
  return { desc, node }
}

function readAll(desc: Descriptor, size: number): Uint8Array {
  const r = desc.read(BigInt(size), 0n)
  if (r.tag !== 'ok') throw new Error(`read failed: ${String(r.val)}`)
  return r.val[0]
}

describe('memory FS capacity-doubling', () => {
  it('over-allocates the backing buffer but keeps content.length logical', () => {
    const fs = new MemoryFileSystem()
    const { desc, node } = makeFile(fs, '/f')
    desc.write(new Uint8Array([1, 2, 3]), 0n)

    expect(node.content.length).toBe(3) // logical size unchanged
    expect(node.content.buffer.byteLength).toBeGreaterThan(3) // capacity doubled
    expect(Array.from(node.content)).toEqual([1, 2, 3])
  })

  it('produces correct content across many streaming appends', () => {
    const fs = new MemoryFileSystem()
    const { desc, node } = makeFile(fs, '/big')

    const handle = desc.writeViaStream(0n)
    if (handle.tag !== 'ok') throw new Error('writeViaStream failed')
    const stream = globalStreamRegistry.get(handle.val) as unknown as OutputStream

    const chunks = 200
    const chunkSize = 100
    for (let i = 0; i < chunks; i++) {
      stream.write(new Uint8Array(chunkSize).fill(i & 0xff))
    }

    const total = chunks * chunkSize
    expect(node.content.length).toBe(total)
    // Spot-check a few chunks landed at the right offsets with the right value.
    expect(node.content[0]).toBe(0)
    expect(node.content[chunkSize]).toBe(1)
    expect(node.content[total - 1]).toBe((chunks - 1) & 0xff)

    const [data, eof] = (() => {
      const r = desc.read(BigInt(total + 10), 0n)
      if (r.tag !== 'ok') throw new Error('read failed')
      return r.val
    })()
    expect(data.length).toBe(total)
    expect(eof).toBe(true)
  })

  it('zero-fills the gap on a sparse write past EOF', () => {
    const fs = new MemoryFileSystem()
    const { desc, node } = makeFile(fs, '/sparse')
    desc.write(new Uint8Array([0xaa, 0xbb]), 0n)
    desc.write(new Uint8Array([0xcc, 0xdd]), 8n) // leaves a hole at [2, 8)

    expect(node.content.length).toBe(10)
    expect(Array.from(readAll(desc, 10))).toEqual([
      0xaa, 0xbb, 0, 0, 0, 0, 0, 0, 0xcc, 0xdd,
    ])
  })

  it('zero-fills reused capacity when a later write re-grows the file', () => {
    const fs = new MemoryFileSystem()
    const { desc, node } = makeFile(fs, '/regrow')
    // Grow to 100 bytes (capacity doubles well beyond 100).
    desc.write(new Uint8Array(100).fill(0xff), 0n)
    const capacity = node.content.buffer.byteLength
    expect(capacity).toBeGreaterThan(110)

    // Write within existing capacity but past the logical end: [100,110) is a
    // hole that must read back as zeros even though it reuses the buffer.
    desc.write(new Uint8Array([7]), 110n)
    expect(node.content.length).toBe(111)
    const bytes = readAll(desc, 111)
    expect(Array.from(bytes.slice(100, 110))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(bytes[110]).toBe(7)
  })

  it('reports the logical size from stat, not the buffer capacity', () => {
    const fs = new MemoryFileSystem()
    const { desc } = makeFile(fs, '/s')
    desc.write(new Uint8Array(5).fill(1), 0n)
    const st = desc.stat()
    if (st.tag !== 'ok') throw new Error('stat failed')
    expect(st.val.size).toBe(5n)
  })
})
