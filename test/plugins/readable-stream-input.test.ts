/**
 * Tests for ReadableStreamInputStream (REMEDIATION-PLAN 3.3 streaming HTTP).
 */

import { describe, it, expect } from 'vitest'
import { ReadableStreamInputStream } from '../../src/wasip2/plugins/io/index.js'

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]!)
      } else {
        controller.close()
      }
    },
  })
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

async function readAll(s: ReadableStreamInputStream): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for (;;) {
    const r = await s.blockingRead(1000n)
    if (!(r instanceof Uint8Array)) {
      expect(r).toEqual({ tag: 'closed' })
      break
    }
    if (r.length > 0) parts.push(r)
  }
  return concat(parts)
}

describe('ReadableStreamInputStream', () => {
  it('reassembles a chunked stream in order', async () => {
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5]),
      new Uint8Array([6, 7, 8, 9]),
    ]
    const s = new ReadableStreamInputStream(streamOf(chunks))
    const all = await readAll(s)
    expect(Array.from(all)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('honors the requested length on blockingRead', async () => {
    const s = new ReadableStreamInputStream(
      streamOf([new Uint8Array([10, 20, 30, 40, 50])])
    )
    const first = await s.blockingRead(2n)
    expect(first).toBeInstanceOf(Uint8Array)
    expect((first as Uint8Array).length).toBeLessThanOrEqual(2)
  })

  it('reports closed at end of stream', async () => {
    const s = new ReadableStreamInputStream(streamOf([new Uint8Array([1])]))
    await s.blockingRead(100n) // the one chunk
    const end = await s.blockingRead(100n)
    expect(end).toEqual({ tag: 'closed' })
  })

  it('non-blocking read returns empty before data is buffered, then data', async () => {
    const s = new ReadableStreamInputStream(streamOf([new Uint8Array([7, 7, 7])]))
    // Immediately, the pump has not delivered anything yet.
    const immediate = s.read(100n)
    expect(immediate).toBeInstanceOf(Uint8Array)
    expect((immediate as Uint8Array).length).toBe(0)

    // After the chunk arrives, a blocking read returns it.
    const data = await s.blockingRead(100n)
    expect(Array.from(data as Uint8Array)).toEqual([7, 7, 7])
  })

  it('close() stops the stream and reports closed', async () => {
    const s = new ReadableStreamInputStream(streamOf([new Uint8Array([1, 2])]))
    s.close()
    expect(s.isClosed()).toBe(true)
    expect(s.read(10n)).toEqual({ tag: 'closed' })
  })
})
