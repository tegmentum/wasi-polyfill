/**
 * WASIP2 Proxy Client Tests
 *
 * Tests for the browser-side WebSocket proxy client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ProxyClient,
  createProxyClient,
  ConnectionState,
  StreamType,
  MessageType,
  FrameFlags,
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  HEADER_SIZE,
  createFrame,
  encodeString,
  parseFrame,
  type ProxyClientConfig,
} from '../../src/wasip2/proxy/index.js'

// Mock WebSocket for testing
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  binaryType: string = 'blob'

  onopen: (() => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null

  private sentData: Uint8Array[] = []

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      if (this.onopen) this.onopen()
    }, 10)
  }

  send(data: Uint8Array): void {
    this.sentData.push(data)
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ code: 1000, reason: 'Normal closure' })
    }
  }

  // Test helpers
  getSentData(): Uint8Array[] {
    return this.sentData
  }

  simulateMessage(data: ArrayBuffer): void {
    if (this.onmessage) {
      this.onmessage({ data })
    }
  }

  simulateError(): void {
    if (this.onerror) this.onerror()
  }

  simulateClose(code: number = 1000, reason: string = ''): void {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ code, reason })
    }
  }
}

// Store reference to mock for test access
let currentMockWs: MockWebSocket | null = null

describe('WASIP2 ProxyClient', () => {
  beforeEach(() => {
    currentMockWs = null
    // @ts-ignore - Mocking global WebSocket
    global.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        currentMockWs = this
      }
    }
  })

  afterEach(() => {
    currentMockWs = null
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('creates client with default config', () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })
      expect(client).toBeInstanceOf(ProxyClient)
      expect(client.state).toBe(ConnectionState.DISCONNECTED)
    })

    it('accepts custom configuration', () => {
      const config: ProxyClientConfig = {
        url: 'wss://example.com/proxy',
        autoReconnect: false,
        maxReconnectAttempts: 5,
        reconnectDelay: 500,
        maxReconnectDelay: 10000,
        connectTimeout: 5000,
        pingInterval: 15000,
        maxStreams: 50,
        initialWindowSize: 32768,
        capabilities: ['tcp', 'dns'],
      }

      const client = createProxyClient(config)
      expect(client).toBeInstanceOf(ProxyClient)
    })
  })

  describe('connect', () => {
    it('transitions to CONNECTING state', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      // Start connect (don't await yet)
      const connectPromise = client.connect()

      // Should be connecting immediately
      expect(client.state).toBe(ConnectionState.CONNECTING)

      // Cancel by closing
      await currentMockWs?.simulateClose()
      await connectPromise.catch(() => {})
    })

    it('transitions through HANDSHAKING to CONNECTED', async () => {
      const onConnect = vi.fn()
      const client = createProxyClient({ url: 'wss://example.com/proxy' }, { onConnect })

      const connectPromise = client.connect()

      // Wait for WebSocket to open
      await new Promise((r) => setTimeout(r, 20))

      // Should be handshaking after open
      expect(client.state).toBe(ConnectionState.HANDSHAKING)

      // Send HELLO_ACK response
      const helloAck = createHelloAckFrame()
      currentMockWs!.simulateMessage(helloAck.buffer)

      await connectPromise

      expect(client.state).toBe(ConnectionState.CONNECTED)
      expect(onConnect).toHaveBeenCalled()
    })

    it('sends HELLO message on WebSocket open', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()

      // Wait for WebSocket to open and HELLO to be sent
      await new Promise((r) => setTimeout(r, 20))

      // Check sent data
      const sentData = currentMockWs!.getSentData()
      expect(sentData.length).toBe(1)

      // Parse the HELLO frame
      const frame = parseFrame(sentData[0]!)
      expect(frame).not.toBeNull()
      expect(frame!.frame.header.type).toBe(MessageType.HELLO)

      // Clean up
      currentMockWs?.simulateClose()
      await connectPromise.catch(() => {})
    })

    it('throws when already connected', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))

      // Simulate successful connection
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      // Try to connect again
      await expect(client.connect()).rejects.toThrow(/Cannot connect/)
    })

    it('handles connection timeout', async () => {
      // Replace WebSocket to never open and properly handle close
      // @ts-ignore
      global.WebSocket = class {
        readyState = 0
        binaryType = 'blob'
        onopen: (() => void) | null = null
        onmessage: (() => void) | null = null
        onerror: (() => void) | null = null
        onclose: ((event: { code: number; reason: string }) => void) | null = null
        send() {}
        close() {
          this.readyState = 3
          if (this.onclose) this.onclose({ code: 1000, reason: '' })
        }
      }

      const client = createProxyClient({
        url: 'wss://example.com/proxy',
        connectTimeout: 50,
      })

      await expect(client.connect()).rejects.toThrow(/timeout/i)
    }, 10000)
  })

  describe('disconnect', () => {
    it('closes WebSocket and transitions to CLOSED', async () => {
      const onDisconnect = vi.fn()
      const client = createProxyClient({ url: 'wss://example.com/proxy' }, { onDisconnect })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      await client.disconnect()

      expect(client.state).toBe(ConnectionState.CLOSED)
      expect(onDisconnect).toHaveBeenCalled()
    })

    it('does nothing when already disconnected', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })
      await client.disconnect() // Should not throw
      expect(client.state).toBe(ConnectionState.DISCONNECTED)
    })

    it('sends GOAWAY frame before closing', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      const initialSentCount = currentMockWs!.getSentData().length

      await client.disconnect()

      // Check that GOAWAY was sent
      const sentData = currentMockWs!.getSentData()
      expect(sentData.length).toBeGreaterThan(initialSentCount)

      const lastFrame = parseFrame(sentData[sentData.length - 1]!)
      expect(lastFrame!.frame.header.type).toBe(MessageType.GOAWAY)
    })
  })

  describe('openStream', () => {
    it('opens a TCP stream', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      // Start opening stream
      const streamPromise = client.openStream({ streamType: StreamType.TCP })

      // Wait for OPEN frame to be sent
      await new Promise((r) => setTimeout(r, 10))

      // Send OPEN_ACK
      const openAck = createOpenAckFrame(1) // Stream ID 1
      currentMockWs!.simulateMessage(openAck.buffer)

      const stream = await streamPromise
      expect(stream.id).toBe(1)
      expect(stream.type).toBe(StreamType.TCP)
    })

    it('throws when not connected', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      await expect(client.openStream({ streamType: StreamType.TCP })).rejects.toThrow(/Cannot open stream/)
    })

    it('increments stream IDs', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      // Open first stream
      const streamPromise1 = client.openStream({ streamType: StreamType.TCP })
      await new Promise((r) => setTimeout(r, 10))
      currentMockWs!.simulateMessage(createOpenAckFrame(1).buffer)
      const stream1 = await streamPromise1

      // Open second stream
      const streamPromise2 = client.openStream({ streamType: StreamType.HTTP })
      await new Promise((r) => setTimeout(r, 10))
      currentMockWs!.simulateMessage(createOpenAckFrame(3).buffer)
      const stream2 = await streamPromise2

      // Client-initiated streams are odd
      expect(stream1.id).toBe(1)
      expect(stream2.id).toBe(3)
    })
  })

  describe('ProxyStream', () => {
    it('writes data to stream', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      const streamPromise = client.openStream({ streamType: StreamType.TCP })
      await new Promise((r) => setTimeout(r, 10))
      currentMockWs!.simulateMessage(createOpenAckFrame(1).buffer)
      const stream = await streamPromise

      const data = new TextEncoder().encode('Hello, World!')
      await stream.write(data)

      // Find the DATA frame
      const sentData = currentMockWs!.getSentData()
      const dataFrames = sentData
        .map((d) => parseFrame(d))
        .filter((f) => f && f.frame.header.type === MessageType.DATA)

      expect(dataFrames.length).toBeGreaterThan(0)
      const dataFrame = dataFrames[dataFrames.length - 1]!
      expect(dataFrame.frame.payload).toEqual(data)
    })

    it('closes stream with END_STREAM flag', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      const streamPromise = client.openStream({ streamType: StreamType.TCP })
      await new Promise((r) => setTimeout(r, 10))
      currentMockWs!.simulateMessage(createOpenAckFrame(1).buffer)
      const stream = await streamPromise

      await stream.close()

      // Find the CLOSE frame
      const sentData = currentMockWs!.getSentData()
      const closeFrames = sentData
        .map((d) => parseFrame(d))
        .filter((f) => f && f.frame.header.type === MessageType.CLOSE)

      expect(closeFrames.length).toBe(1)
      expect(closeFrames[0]!.frame.header.flags & FrameFlags.END_STREAM).toBeTruthy()
    })

    it('receives data via callback', async () => {
      const onData = vi.fn()
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      const streamPromise = client.openStream({
        streamType: StreamType.TCP,
        onData,
      })
      await new Promise((r) => setTimeout(r, 10))
      currentMockWs!.simulateMessage(createOpenAckFrame(1).buffer)
      await streamPromise

      // Simulate receiving data
      const data = new TextEncoder().encode('Response data')
      const dataFrame = createFrame(MessageType.DATA, 1, data)
      currentMockWs!.simulateMessage(dataFrame.buffer)

      expect(onData).toHaveBeenCalledWith(data)
    })

    it('receives data via read()', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      const streamPromise = client.openStream({ streamType: StreamType.TCP })
      await new Promise((r) => setTimeout(r, 10))
      currentMockWs!.simulateMessage(createOpenAckFrame(1).buffer)
      const stream = await streamPromise

      // Start read before data arrives
      const readPromise = stream.read()

      // Simulate receiving data
      const data = new TextEncoder().encode('Response data')
      const dataFrame = createFrame(MessageType.DATA, 1, data)
      currentMockWs!.simulateMessage(dataFrame.buffer)

      const receivedData = await readPromise
      expect(receivedData).toEqual(data)
    })

    it('returns null from read() when stream ends', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      const streamPromise = client.openStream({ streamType: StreamType.TCP })
      await new Promise((r) => setTimeout(r, 10))
      currentMockWs!.simulateMessage(createOpenAckFrame(1).buffer)
      const stream = await streamPromise

      const readPromise = stream.read()

      // Simulate stream end
      const closeFrame = createFrame(MessageType.CLOSE, 1, new Uint8Array(0), FrameFlags.END_STREAM)
      currentMockWs!.simulateMessage(closeFrame.buffer)

      const result = await readPromise
      expect(result).toBeNull()
    })
  })

  describe('connection events', () => {
    it('calls onConnect on successful connection', async () => {
      const onConnect = vi.fn()
      const client = createProxyClient({ url: 'wss://example.com/proxy' }, { onConnect })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      expect(onConnect).toHaveBeenCalled()
    })

    it('calls onDisconnect on connection close', async () => {
      const onDisconnect = vi.fn()
      const client = createProxyClient({ url: 'wss://example.com/proxy' }, { onDisconnect })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame().buffer)
      await connectPromise

      currentMockWs!.simulateClose(1001, 'Going away')

      expect(onDisconnect).toHaveBeenCalledWith('Going away')
    })

    it('calls onError on WebSocket error', async () => {
      const onError = vi.fn()
      const client = createProxyClient({ url: 'wss://example.com/proxy' }, { onError })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))

      currentMockWs!.simulateError()

      expect(onError).toHaveBeenCalled()

      currentMockWs!.simulateClose()
      await connectPromise.catch(() => {})
    })
  })

  describe('capabilities', () => {
    it('returns server capabilities after connect', async () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })

      const connectPromise = client.connect()
      await new Promise((r) => setTimeout(r, 20))
      currentMockWs!.simulateMessage(createHelloAckFrame(['tcp', 'dns', 'http']).buffer)
      await connectPromise

      expect(client.capabilities).toEqual(['tcp', 'dns', 'http'])
    })

    it('returns empty capabilities before connect', () => {
      const client = createProxyClient({ url: 'wss://example.com/proxy' })
      expect(client.capabilities).toEqual([])
    })
  })
})

// Helper functions

function createHelloAckFrame(capabilities: string[] = ['tcp', 'udp', 'dns', 'http', 'fs']): Uint8Array {
  const capBytes = capabilities.map(encodeString)
  const capLen = capBytes.reduce((sum, c) => sum + c.length, 0)

  const payload = new Uint8Array(16 + capLen)
  const view = new DataView(payload.buffer)

  view.setUint32(0, PROTOCOL_VERSION, true) // serverVersion
  view.setUint32(4, 100, true) // maxStreams
  view.setUint32(8, 65536, true) // initialWindowSize
  view.setUint32(12, capabilities.length, true) // capability count

  let offset = 16
  for (const cap of capBytes) {
    payload.set(cap, offset)
    offset += cap.length
  }

  return createFrame(MessageType.HELLO_ACK, 0, payload)
}

function createOpenAckFrame(streamId: number): Uint8Array {
  const payload = new Uint8Array(4)
  const view = new DataView(payload.buffer)
  view.setUint32(0, 65536, true) // windowSize

  return createFrame(MessageType.OPEN_ACK, streamId, payload)
}
