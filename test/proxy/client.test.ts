/**
 * Proxy Client Unit Tests
 *
 * Tests for the WebSocket proxy client multiplexer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConnectionState,
  ProxyClient,
  ProxyStream,
  type ProxyClientConfig,
  type StreamConfig,
  type ConnectionEvents,
} from '../../src/proxy/client.js'
import {
  MessageType,
  StreamType,
  StreamState,
  ErrorCode,
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  DEFAULT_WINDOW_SIZE,
  createFrame,
  encodeHeader,
} from '../../src/proxy/protocol.js'

// =============================================================================
// Mock WebSocket
// =============================================================================

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  binaryType: string = 'arraybuffer'
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private sentMessages: ArrayBuffer[] = []

  constructor(public url: string) {
    // Don't auto-connect; let tests control timing
  }

  send(data: ArrayBuffer | Uint8Array): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    if (data instanceof ArrayBuffer) {
      this.sentMessages.push(data)
    } else {
      this.sentMessages.push(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    }
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSING
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED
      if (this.onclose) {
        this.onclose(new CloseEvent('close'))
      }
    }, 10)
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    if (this.onopen) {
      this.onopen(new Event('open'))
    }
  }

  simulateMessage(data: ArrayBuffer): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }))
    }
  }

  simulateError(message: string): void {
    if (this.onerror) {
      this.onerror(new ErrorEvent('error', { message }))
    }
  }

  simulateClose(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason }))
    }
  }

  getSentMessages(): ArrayBuffer[] {
    return this.sentMessages
  }

  clearSentMessages(): void {
    this.sentMessages = []
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function createHelloAckFrame(): Uint8Array {
  // Create HELLO_ACK payload
  const capabilities = ['tcp', 'dns', 'http', 'fs']
  const capData: Uint8Array[] = []

  for (const cap of capabilities) {
    const bytes = new TextEncoder().encode(cap)
    const lenBytes = new Uint8Array(4)
    new DataView(lenBytes.buffer).setUint32(0, bytes.length, true)
    capData.push(lenBytes)
    capData.push(bytes)
  }

  const capLen = capData.reduce((sum, arr) => sum + arr.length, 0)
  const payload = new Uint8Array(16 + capLen)
  const view = new DataView(payload.buffer)

  view.setUint32(0, PROTOCOL_VERSION, true) // serverVersion
  view.setUint32(4, 100, true) // maxStreams
  view.setUint32(8, DEFAULT_WINDOW_SIZE, true) // initialWindowSize
  view.setUint32(12, capabilities.length, true) // cap count

  let offset = 16
  for (const data of capData) {
    payload.set(data, offset)
    offset += data.length
  }

  return createFrame(MessageType.HELLO_ACK, 0, payload)
}

function createOpenAckFrame(streamId: number): Uint8Array {
  const payload = new Uint8Array(4)
  const view = new DataView(payload.buffer)
  view.setUint32(0, DEFAULT_WINDOW_SIZE, true)
  return createFrame(MessageType.OPEN_ACK, streamId, payload)
}

function createDataFrame(streamId: number, data: Uint8Array, endStream: boolean = false): Uint8Array {
  const flags = endStream ? 0x01 : 0x00 // END_STREAM flag
  return createFrame(MessageType.DATA, streamId, data, flags)
}

// =============================================================================
// Connection State Tests
// =============================================================================

describe('ConnectionState', () => {
  it('should have expected states', () => {
    expect(ConnectionState.DISCONNECTED).toBe('disconnected')
    expect(ConnectionState.CONNECTING).toBe('connecting')
    expect(ConnectionState.HANDSHAKING).toBe('handshaking')
    expect(ConnectionState.CONNECTED).toBe('connected')
    expect(ConnectionState.CLOSING).toBe('closing')
    expect(ConnectionState.CLOSED).toBe('closed')
  })
})

// =============================================================================
// ProxyClient Configuration Tests
// =============================================================================

describe('ProxyClient Configuration', () => {
  let originalWebSocket: typeof globalThis.WebSocket

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error - Mock WebSocket
    globalThis.WebSocket = MockWebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('should use default configuration values', () => {
    const client = new ProxyClient({ url: 'ws://localhost:8080' })

    expect(client.state).toBe(ConnectionState.DISCONNECTED)
    expect(client.capabilities).toEqual([])
  })

  it('should accept custom configuration', () => {
    const config: ProxyClientConfig = {
      url: 'wss://proxy.example.com',
      autoReconnect: false,
      maxReconnectAttempts: 5,
      reconnectDelay: 2000,
      maxReconnectDelay: 60000,
      connectTimeout: 5000,
      pingInterval: 15000,
      maxStreams: 50,
      initialWindowSize: 32768,
      capabilities: ['tcp', 'dns'],
    }

    const client = new ProxyClient(config)
    expect(client.state).toBe(ConnectionState.DISCONNECTED)
  })
})

// =============================================================================
// ProxyClient State Tests
// =============================================================================

describe('ProxyClient State Management', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let mockWs: MockWebSocket | null = null

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error - Mock WebSocket
    globalThis.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        mockWs = this
      }
    }
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    mockWs = null
  })

  it('should start in DISCONNECTED state', () => {
    const client = new ProxyClient({ url: 'ws://localhost:8080' })
    expect(client.state).toBe(ConnectionState.DISCONNECTED)
  })

  it('should transition to CONNECTING on connect', async () => {
    const client = new ProxyClient({ url: 'ws://localhost:8080' })
    const connectPromise = client.connect()

    // State should be CONNECTING immediately
    expect(client.state).toBe(ConnectionState.CONNECTING)

    // Don't wait for full connection, just check state
    client.disconnect()
  })

  it('should throw when connecting from non-DISCONNECTED state', async () => {
    const client = new ProxyClient({ url: 'ws://localhost:8080' })

    // Start connecting
    const connectPromise = client.connect()
    expect(client.state).toBe(ConnectionState.CONNECTING)

    // Try to connect again should throw
    await expect(client.connect()).rejects.toThrow(/Cannot connect in state/)

    client.disconnect()
  })

  it('should handle disconnect gracefully when already disconnected', async () => {
    const client = new ProxyClient({ url: 'ws://localhost:8080' })

    // Should not throw
    await client.disconnect()
    expect(client.state).toBe(ConnectionState.DISCONNECTED)
  })
})

// =============================================================================
// ProxyClient Events Tests
// =============================================================================

describe('ProxyClient Events', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let mockWs: MockWebSocket | null = null

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error - Mock WebSocket
    globalThis.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        mockWs = this
        // Don't auto-open, let test control timing
      }
    }
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    mockWs = null
  })

  it('should call onConnect when connected', async () => {
    const onConnect = vi.fn()
    const client = new ProxyClient({ url: 'ws://localhost:8080' }, { onConnect })

    const connectPromise = client.connect()

    // Wait for WebSocket to be created
    await new Promise((r) => setTimeout(r, 5))

    // Simulate successful connection
    mockWs!.simulateOpen()

    // Simulate HELLO_ACK response
    await new Promise((r) => setTimeout(r, 5))
    mockWs!.simulateMessage(createHelloAckFrame().buffer)

    await connectPromise
    expect(onConnect).toHaveBeenCalledTimes(1)

    await client.disconnect()
  })

  it('should call onDisconnect when disconnected', async () => {
    const onDisconnect = vi.fn()
    const onConnect = vi.fn()
    const client = new ProxyClient({ url: 'ws://localhost:8080' }, { onConnect, onDisconnect })

    const connectPromise = client.connect()

    await new Promise((r) => setTimeout(r, 5))
    mockWs!.simulateOpen()
    await new Promise((r) => setTimeout(r, 5))
    mockWs!.simulateMessage(createHelloAckFrame().buffer)
    await connectPromise

    await client.disconnect()
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('should call onError on WebSocket error', async () => {
    const onError = vi.fn()
    const client = new ProxyClient(
      { url: 'ws://localhost:8080', autoReconnect: false },
      { onError }
    )

    const connectPromise = client.connect().catch(() => {
      /* expected */
    })

    await new Promise((r) => setTimeout(r, 5))
    mockWs!.simulateError('Connection failed')
    mockWs!.simulateClose(1006)

    await new Promise((r) => setTimeout(r, 20))
    expect(onError).toHaveBeenCalled()
  })
})

// =============================================================================
// ProxyStream Tests
// =============================================================================

describe('ProxyStream', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let mockWs: MockWebSocket | null = null
  let client: ProxyClient

  beforeEach(async () => {
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error - Mock WebSocket
    globalThis.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        mockWs = this
      }
    }

    client = new ProxyClient({ url: 'ws://localhost:8080' })
    const connectPromise = client.connect()

    await new Promise((r) => setTimeout(r, 5))
    mockWs!.simulateOpen()
    await new Promise((r) => setTimeout(r, 5))
    mockWs!.simulateMessage(createHelloAckFrame().buffer)
    await connectPromise
  })

  afterEach(async () => {
    await client.disconnect()
    globalThis.WebSocket = originalWebSocket
    mockWs = null
  })

  it('should open a TCP stream', async () => {
    const streamConfig: StreamConfig = {
      streamType: StreamType.TCP,
    }

    // Clear any previous messages
    mockWs!.clearSentMessages()

    const openPromise = client.openStream(streamConfig)

    // Wait for OPEN to be sent
    await new Promise((r) => setTimeout(r, 5))

    // Find the stream ID from the OPEN frame
    const messages = mockWs!.getSentMessages()
    expect(messages.length).toBeGreaterThan(0)

    const lastMsg = new Uint8Array(messages[messages.length - 1]!)
    const view = new DataView(lastMsg.buffer)
    const streamId = view.getUint32(8, true) // streamId is at offset 8

    // Simulate OPEN_ACK
    mockWs!.simulateMessage(createOpenAckFrame(streamId).buffer)

    const stream = await openPromise
    expect(stream).toBeInstanceOf(ProxyStream)
    expect(stream.id).toBe(streamId)
    expect(stream.type).toBe(StreamType.TCP)
    expect(stream.state).toBe(StreamState.OPEN)
  })

  it('should throw when opening stream while not connected', async () => {
    await client.disconnect()

    await expect(
      client.openStream({ streamType: StreamType.TCP })
    ).rejects.toThrow(/Cannot open stream in state/)
  })
})

// =============================================================================
// ProxyStream Data Handling Tests
// =============================================================================

describe('ProxyStream Data Handling', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let mockWs: MockWebSocket | null = null
  let client: ProxyClient
  let stream: ProxyStream

  beforeEach(async () => {
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error - Mock WebSocket
    globalThis.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        mockWs = this
      }
    }

    client = new ProxyClient({ url: 'ws://localhost:8080' })
    const connectPromise = client.connect()

    await new Promise((r) => setTimeout(r, 5))
    mockWs!.simulateOpen()
    await new Promise((r) => setTimeout(r, 5))
    mockWs!.simulateMessage(createHelloAckFrame().buffer)
    await connectPromise

    mockWs!.clearSentMessages()

    const openPromise = client.openStream({ streamType: StreamType.TCP })
    await new Promise((r) => setTimeout(r, 5))

    const messages = mockWs!.getSentMessages()
    const lastMsg = new Uint8Array(messages[messages.length - 1]!)
    const view = new DataView(lastMsg.buffer)
    const streamId = view.getUint32(8, true)

    mockWs!.simulateMessage(createOpenAckFrame(streamId).buffer)
    stream = await openPromise
  })

  afterEach(async () => {
    await client.disconnect()
    globalThis.WebSocket = originalWebSocket
    mockWs = null
  })

  it('should write data to stream', async () => {
    mockWs!.clearSentMessages()

    const testData = new TextEncoder().encode('Hello, World!')
    await stream.write(testData)

    const messages = mockWs!.getSentMessages()
    expect(messages.length).toBe(1)

    // Verify DATA frame was sent
    const frame = new Uint8Array(messages[0]!)
    const view = new DataView(frame.buffer)
    expect(view.getUint8(5)).toBe(MessageType.DATA)
    expect(view.getUint32(8, true)).toBe(stream.id)
  })

  it('should receive data with onData callback', async () => {
    const receivedData: Uint8Array[] = []
    const streamWithCallback = await (async () => {
      mockWs!.clearSentMessages()
      const openPromise = client.openStream({
        streamType: StreamType.TCP,
        onData: (data) => receivedData.push(data),
      })
      await new Promise((r) => setTimeout(r, 5))

      const messages = mockWs!.getSentMessages()
      const lastMsg = new Uint8Array(messages[messages.length - 1]!)
      const view = new DataView(lastMsg.buffer)
      const streamId = view.getUint32(8, true)

      mockWs!.simulateMessage(createOpenAckFrame(streamId).buffer)
      return openPromise
    })()

    // Simulate incoming data
    const testData = new TextEncoder().encode('Received data')
    mockWs!.simulateMessage(createDataFrame(streamWithCallback.id, testData).buffer)

    await new Promise((r) => setTimeout(r, 5))
    expect(receivedData.length).toBe(1)
    expect(new TextDecoder().decode(receivedData[0])).toBe('Received data')
  })

  it('should close stream', async () => {
    mockWs!.clearSentMessages()

    await stream.close()

    const messages = mockWs!.getSentMessages()
    expect(messages.length).toBe(1)

    const frame = new Uint8Array(messages[0]!)
    const view = new DataView(frame.buffer)
    expect(view.getUint8(5)).toBe(MessageType.CLOSE)
    expect(stream.state).toBe(StreamState.HALF_CLOSED_LOCAL)
  })

  it('should throw when writing to closed stream', async () => {
    await stream.close()

    // Simulate remote close
    stream['handleRemoteClose']()

    await expect(stream.write(new Uint8Array([1, 2, 3]))).rejects.toThrow(/Cannot write to stream/)
  })
})

// =============================================================================
// Stream State Transitions
// =============================================================================

describe('Stream State Transitions', () => {
  it('should start in IDLE state', () => {
    const mockClient = {} as ProxyClient
    const stream = new ProxyStream(1, StreamType.TCP, mockClient, { streamType: StreamType.TCP }, DEFAULT_WINDOW_SIZE)

    expect(stream.state).toBe(StreamState.IDLE)
  })

  it('should transition to HALF_CLOSED_REMOTE on remote close', () => {
    const mockClient = {
      sendFrame: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProxyClient
    const stream = new ProxyStream(1, StreamType.TCP, mockClient, { streamType: StreamType.TCP }, DEFAULT_WINDOW_SIZE)

    stream.setState(StreamState.OPEN)
    stream.handleRemoteClose()

    expect(stream.state).toBe(StreamState.HALF_CLOSED_REMOTE)
  })

  it('should transition to CLOSED when both sides close', async () => {
    const mockClient = {
      sendFrame: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProxyClient
    const stream = new ProxyStream(1, StreamType.TCP, mockClient, { streamType: StreamType.TCP }, DEFAULT_WINDOW_SIZE)

    stream.setState(StreamState.OPEN)

    // Local close first (async operation)
    await stream.close()
    expect(stream.state).toBe(StreamState.HALF_CLOSED_LOCAL)

    // Then remote close
    stream.handleRemoteClose()
    expect(stream.state).toBe(StreamState.CLOSED)
  })

  it('should transition to CLOSED on reset', () => {
    const mockClient = {
      sendFrame: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProxyClient
    const stream = new ProxyStream(1, StreamType.TCP, mockClient, { streamType: StreamType.TCP }, DEFAULT_WINDOW_SIZE)

    stream.setState(StreamState.OPEN)
    stream.handleReset(new Error('Test error'))

    expect(stream.state).toBe(StreamState.CLOSED)
  })
})

// =============================================================================
// Flow Control Tests
// =============================================================================

describe('Flow Control', () => {
  it('should track send window', () => {
    const mockClient = {
      sendFrame: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProxyClient
    const initialWindow = 1000
    const stream = new ProxyStream(1, StreamType.TCP, mockClient, { streamType: StreamType.TCP }, initialWindow)

    stream.setState(StreamState.OPEN)

    // Write some data
    const data = new Uint8Array(100)
    stream.write(data)

    // sendFrame should have been called
    expect(mockClient.sendFrame).toHaveBeenCalled()
  })

  it('should update window on handleWindowUpdate', () => {
    const mockClient = {
      sendFrame: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProxyClient
    const initialWindow = 1000
    const stream = new ProxyStream(1, StreamType.TCP, mockClient, { streamType: StreamType.TCP }, initialWindow)

    stream.setState(StreamState.OPEN)

    // Consume window
    stream.write(new Uint8Array(500))

    // Receive window update
    stream.handleWindowUpdate(500)

    // Should be able to write more
    stream.write(new Uint8Array(500))
    expect(mockClient.sendFrame).toHaveBeenCalledTimes(2)
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling', () => {
  it('should call onError callback on stream reset', () => {
    const onError = vi.fn()
    const mockClient = {
      sendFrame: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProxyClient
    const stream = new ProxyStream(
      1,
      StreamType.TCP,
      mockClient,
      { streamType: StreamType.TCP, onError },
      DEFAULT_WINDOW_SIZE
    )

    stream.setState(StreamState.OPEN)
    const testError = new Error('Test error')
    stream.handleReset(testError)

    expect(onError).toHaveBeenCalledWith(testError)
  })

  it('should call onEnd callback on remote close', () => {
    const onEnd = vi.fn()
    const mockClient = {
      sendFrame: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProxyClient
    const stream = new ProxyStream(
      1,
      StreamType.TCP,
      mockClient,
      { streamType: StreamType.TCP, onEnd },
      DEFAULT_WINDOW_SIZE
    )

    stream.setState(StreamState.OPEN)
    stream.handleRemoteClose()

    expect(onEnd).toHaveBeenCalledTimes(1)
  })
})
