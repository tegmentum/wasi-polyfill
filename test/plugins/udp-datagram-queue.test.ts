/**
 * Tests for the ws-gateway UDP inbound datagram queue (REMEDIATION-PLAN 2.7).
 *
 * Connected / per-destination UDP receive now routes each inbound DATA frame
 * (one datagram) into this queue tagged with the stream's bound remote address.
 * The queue must preserve datagram boundaries and source tagging — which a
 * byte-stream buffer would not. The full tunnel path needs a live gateway
 * (Playwright); this covers the queue semantics the receive path relies on.
 */

import { describe, it, expect } from 'vitest'
import {
  DatagramQueue,
  type QueuedDatagram,
} from '../../src/wasip2/plugins/ws-gateway/udp-adapter.js'
import type { IpSocketAddress } from '../../src/wasip2/plugins/sockets/types.js'

const addr = (port: number): IpSocketAddress => ({
  tag: 'ipv4',
  val: { port, address: [127, 0, 0, 1] },
})

const dgram = (bytes: number[], port: number): QueuedDatagram => ({
  data: new Uint8Array(bytes),
  remoteAddress: addr(port),
})

describe('UDP DatagramQueue', () => {
  it('preserves datagram boundaries and order', () => {
    const q = new DatagramQueue()
    q.push(dgram([1, 2], 5000))
    q.push(dgram([3, 4, 5], 5001))

    const out = q.receive(10)
    expect(out).toHaveLength(2)
    expect(Array.from(out[0]!.data)).toEqual([1, 2])
    expect(Array.from(out[1]!.data)).toEqual([3, 4, 5])
    expect(q.isEmpty).toBe(true)
  })

  it('tags each datagram with its source address', () => {
    const q = new DatagramQueue()
    q.push(dgram([9], 1234))
    const [d] = q.receive(1)
    expect(d!.remoteAddress).toEqual(addr(1234))
  })

  it('honors maxResults and leaves the rest queued', () => {
    const q = new DatagramQueue()
    q.push(dgram([1], 1))
    q.push(dgram([2], 2))
    q.push(dgram([3], 3))

    expect(q.receive(2)).toHaveLength(2)
    expect(q.length).toBe(1)
    expect(Array.from(q.receive(10)[0]!.data)).toEqual([3])
  })

  it('drops pushes past maxSize and after close', () => {
    const q = new DatagramQueue(2)
    expect(q.push(dgram([1], 1))).toBe(true)
    expect(q.push(dgram([2], 2))).toBe(true)
    expect(q.push(dgram([3], 3))).toBe(false) // full

    q.close()
    expect(q.push(dgram([4], 4))).toBe(false) // closed
    expect(q.isClosed).toBe(true)
    expect(q.isEmpty).toBe(true)
  })
})
