/**
 * Regression test for the ws-gateway frame-size bound (REMEDIATION-PLAN 2.9).
 *
 * The frame payload length is a 32-bit field (up to ~4 GiB). The tunnel used to
 * buffer until it had `HEADER_SIZE + payloadLen` bytes, so a hostile/buggy
 * gateway could advertise a huge payload and force unbounded memory growth.
 * The tunnel now rejects frames whose payload exceeds `maxFrameSize`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  MessageType,
  encodeHeader,
} from '../../src/wasip2/plugins/ws-gateway/protocol.js'
import { WsTunnelManager } from '../../src/wasip2/plugins/ws-gateway/tunnel-manager.js'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  binaryType = ''
  onopen: ((e?: unknown) => void) | null = null
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null
  onclose: ((e?: unknown) => void) | null = null
  onerror: ((e?: unknown) => void) | null = null
  readyState = 1
  constructor(
    public url: string,
    public protocols?: string | string[]
  ) {
    MockWebSocket.instances.push(this)
  }
  send(): void {}
  close(): void {
    this.readyState = 3
  }
}

function headerFrame(payloadLen: number): ArrayBuffer {
  const bytes = encodeHeader({
    magic: PROTOCOL_MAGIC,
    version: PROTOCOL_VERSION,
    type: MessageType.Data,
    flags: 0,
    streamId: 1,
    payloadLen,
  })
  return bytes.buffer as ArrayBuffer
}

describe('ws-gateway frame-size bound', () => {
  const originalWebSocket = globalThis.WebSocket

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    MockWebSocket.instances = []
  })

  async function connectTunnel(maxFrameSize: number, onDisconnect: () => void) {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
    const tunnel = new WsTunnelManager({
      gatewayUrl: 'ws://test',
      maxFrameSize,
      connectTimeoutMs: 50,
      onDisconnect,
    })
    void tunnel.connect()
    // tunnel.connect() awaits getWebSocketImpl() before invoking the
    // WebSocket constructor — yield a microtask so MockWebSocket has
    // a chance to register itself on .instances. Without this, .at(-1)
    // returns undefined and the onmessage assignment below crashes.
    await Promise.resolve()
    const ws = MockWebSocket.instances.at(-1)!
    return { tunnel, ws }
  }

  it('disconnects on a frame whose payload exceeds maxFrameSize', async () => {
    const onDisconnect = vi.fn()
    const { tunnel, ws } = await connectTunnel(1024, onDisconnect)

    // Advertise a 4096-byte payload against a 1024 cap.
    ws.onmessage!({ data: headerFrame(4096) })

    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(tunnel.isConnected).toBe(false)
  })

  it('does not disconnect on a within-bound frame awaiting its payload', async () => {
    const onDisconnect = vi.fn()
    const { ws } = await connectTunnel(1024, onDisconnect)

    // payloadLen 10 (<= cap) but no payload yet -> just buffered, no disconnect.
    ws.onmessage!({ data: headerFrame(10) })

    expect(onDisconnect).not.toHaveBeenCalled()
  })
})
