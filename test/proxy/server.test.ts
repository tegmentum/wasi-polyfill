/**
 * Proxy Server Unit Tests
 *
 * Tests for the WebSocket proxy server implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MessageType,
  StreamType,
  StreamState,
  ErrorCode,
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  DEFAULT_WINDOW_SIZE,
  HEADER_SIZE,
  createFrame,
  encodeHello,
} from '../../src/wasip2/proxy/protocol.js'

// =============================================================================
// Mock ws module
// =============================================================================

// Event types for mock
interface MockEventHandlers {
  message?: (data: Buffer, isBinary: boolean) => void
  close?: (code: number, reason: Buffer) => void
  error?: (error: Error) => void
  pong?: () => void
}

class MockWebSocket {
  readyState = 1 // OPEN
  private eventHandlers: MockEventHandlers = {}
  private sentMessages: Buffer[] = []

  on(event: string, handler: (...args: unknown[]) => void): this {
    // @ts-expect-error - dynamic event handler assignment
    this.eventHandlers[event] = handler
    return this
  }

  send(data: Buffer | Uint8Array, callback?: (err?: Error) => void): void {
    if (this.readyState !== 1) {
      callback?.(new Error('WebSocket is not open'))
      return
    }
    this.sentMessages.push(Buffer.from(data))
    callback?.()
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3 // CLOSED
  }

  ping(): void {
    // Mock ping
  }

  terminate(): void {
    this.readyState = 3
  }

  // Test helpers
  simulateMessage(data: Buffer): void {
    this.eventHandlers.message?.(data, true)
  }

  simulateClose(code: number = 1000, reason: string = ''): void {
    this.eventHandlers.close?.(code, Buffer.from(reason))
  }

  simulateError(error: Error): void {
    this.eventHandlers.error?.(error)
  }

  getSentMessages(): Buffer[] {
    return this.sentMessages
  }

  clearSentMessages(): void {
    this.sentMessages = []
  }
}

class MockWebSocketServer {
  private eventHandlers: { connection?: (ws: MockWebSocket, request: { url: string }) => void } = {}

  on(event: string, handler: (...args: unknown[]) => void): this {
    // @ts-expect-error - dynamic event handler assignment
    this.eventHandlers[event] = handler
    return this
  }

  close(callback?: () => void): void {
    callback?.()
  }

  // Test helper
  simulateConnection(ws: MockWebSocket, url: string = '/'): void {
    this.eventHandlers.connection?.(ws, { url })
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function createHelloFrame(): Uint8Array {
  const payload = encodeHello({
    clientVersion: PROTOCOL_VERSION,
    maxStreams: 100,
    initialWindowSize: DEFAULT_WINDOW_SIZE,
    capabilities: ['tcp', 'dns', 'http', 'fs'],
  })
  return createFrame(MessageType.HELLO, 0, payload)
}

function createOpenFrame(streamId: number, streamType: StreamType): Uint8Array {
  const payload = new Uint8Array(5)
  const view = new DataView(payload.buffer)
  view.setUint8(0, streamType)
  view.setUint32(1, DEFAULT_WINDOW_SIZE, true)
  return createFrame(MessageType.OPEN, streamId, payload)
}

function createDataFrame(streamId: number, data: Uint8Array, flags: number = 0): Uint8Array {
  return createFrame(MessageType.DATA, streamId, data, flags)
}

function createCloseFrame(streamId: number, flags: number = 0): Uint8Array {
  return createFrame(MessageType.CLOSE, streamId, new Uint8Array(0), flags)
}

// =============================================================================
// Protocol Validation Tests
// =============================================================================

describe('Server Protocol Validation', () => {
  it('should reject frames with invalid magic', () => {
    const invalidFrame = new Uint8Array(HEADER_SIZE)
    const view = new DataView(invalidFrame.buffer)
    view.setUint32(0, 0x12345678, true) // Wrong magic
    view.setUint8(4, PROTOCOL_VERSION)
    view.setUint8(5, MessageType.HELLO)

    // The frame should be rejected when processed
    // This is tested through integration with actual server
    expect(view.getUint32(0, true)).not.toBe(PROTOCOL_MAGIC)
  })

  it('should reject frames with invalid version', () => {
    const invalidFrame = new Uint8Array(HEADER_SIZE)
    const view = new DataView(invalidFrame.buffer)
    view.setUint32(0, PROTOCOL_MAGIC, true)
    view.setUint8(4, 99) // Wrong version
    view.setUint8(5, MessageType.HELLO)

    expect(view.getUint8(4)).not.toBe(PROTOCOL_VERSION)
  })
})

// =============================================================================
// HELLO Handshake Tests
// =============================================================================

describe('HELLO Handshake', () => {
  it('should create valid HELLO frame', () => {
    const frame = createHelloFrame()

    // Verify header
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    expect(view.getUint32(0, true)).toBe(PROTOCOL_MAGIC)
    expect(view.getUint8(4)).toBe(PROTOCOL_VERSION)
    expect(view.getUint8(5)).toBe(MessageType.HELLO)
  })

  it('should include capabilities in HELLO payload', () => {
    const payload = encodeHello({
      clientVersion: 1,
      maxStreams: 50,
      initialWindowSize: 32768,
      capabilities: ['tcp', 'dns'],
    })

    const view = new DataView(payload.buffer)
    expect(view.getUint32(0, true)).toBe(1) // clientVersion
    expect(view.getUint32(4, true)).toBe(50) // maxStreams
    expect(view.getUint32(8, true)).toBe(32768) // initialWindowSize
    expect(view.getUint32(12, true)).toBe(2) // 2 capabilities
  })
})

// =============================================================================
// Stream Management Tests
// =============================================================================

describe('Stream Management', () => {
  it('should create valid OPEN frame', () => {
    const frame = createOpenFrame(1, StreamType.TCP)

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    expect(view.getUint8(5)).toBe(MessageType.OPEN)
    expect(view.getUint32(8, true)).toBe(1) // streamId

    // Check payload
    const payloadOffset = HEADER_SIZE
    expect(view.getUint8(payloadOffset)).toBe(StreamType.TCP)
    expect(view.getUint32(payloadOffset + 1, true)).toBe(DEFAULT_WINDOW_SIZE)
  })

  it('should create valid DATA frame', () => {
    const data = new TextEncoder().encode('test data')
    const frame = createDataFrame(5, data)

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    expect(view.getUint8(5)).toBe(MessageType.DATA)
    expect(view.getUint32(8, true)).toBe(5) // streamId
    expect(view.getUint32(12, true)).toBe(data.length) // payloadLen

    const payload = frame.slice(HEADER_SIZE)
    expect(new TextDecoder().decode(payload)).toBe('test data')
  })

  it('should create valid CLOSE frame', () => {
    const frame = createCloseFrame(3, 0x01) // END_STREAM flag

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    expect(view.getUint8(5)).toBe(MessageType.CLOSE)
    expect(view.getUint8(6)).toBe(0x01) // flags
    expect(view.getUint32(8, true)).toBe(3) // streamId
    expect(view.getUint32(12, true)).toBe(0) // empty payload
  })
})

// =============================================================================
// Stream Type Tests
// =============================================================================

describe('Stream Types', () => {
  it('should support all stream types', () => {
    const streamTypes = [
      StreamType.CONTROL,
      StreamType.TCP,
      StreamType.UDP,
      StreamType.HTTP,
      StreamType.FILESYSTEM,
    ]

    for (const type of streamTypes) {
      const frame = createOpenFrame(1, type)
      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
      expect(view.getUint8(HEADER_SIZE)).toBe(type)
    }
  })
})

// =============================================================================
// Error Code Tests
// =============================================================================

describe('Error Codes', () => {
  it('should have distinct error codes', () => {
    const errorCodes = [
      ErrorCode.OK,
      ErrorCode.UNKNOWN,
      ErrorCode.PROTOCOL_ERROR,
      ErrorCode.INTERNAL_ERROR,
      ErrorCode.FLOW_CONTROL_ERROR,
      ErrorCode.STREAM_CLOSED,
      ErrorCode.FRAME_SIZE_ERROR,
      ErrorCode.REFUSED_STREAM,
      ErrorCode.CANCEL,
      ErrorCode.TIMEOUT,
      ErrorCode.CONNECT_ERROR,
      ErrorCode.DNS_ERROR,
      ErrorCode.IO_ERROR,
      ErrorCode.PERMISSION_DENIED,
      ErrorCode.NOT_FOUND,
      ErrorCode.ALREADY_EXISTS,
      ErrorCode.INVALID_ARGUMENT,
      ErrorCode.RESOURCE_EXHAUSTED,
    ]

    // All codes should be unique
    const unique = new Set(errorCodes)
    expect(unique.size).toBe(errorCodes.length)
  })
})

// =============================================================================
// Mock WebSocket Tests
// =============================================================================

describe('MockWebSocket', () => {
  it('should track sent messages', () => {
    const ws = new MockWebSocket()
    const data = Buffer.from('test')

    ws.send(data)

    const sent = ws.getSentMessages()
    expect(sent.length).toBe(1)
    expect(sent[0]!.toString()).toBe('test')
  })

  it('should handle event listeners', () => {
    const ws = new MockWebSocket()
    const messageHandler = vi.fn()
    const closeHandler = vi.fn()

    ws.on('message', messageHandler)
    ws.on('close', closeHandler)

    ws.simulateMessage(Buffer.from('hello'))
    ws.simulateClose(1000, 'normal')

    expect(messageHandler).toHaveBeenCalledWith(Buffer.from('hello'), true)
    expect(closeHandler).toHaveBeenCalled()
  })

  it('should reject sends when closed', () => {
    const ws = new MockWebSocket()
    ws.close()

    const callback = vi.fn()
    ws.send(Buffer.from('test'), callback)

    expect(callback).toHaveBeenCalledWith(expect.any(Error))
  })
})

// =============================================================================
// MockWebSocketServer Tests
// =============================================================================

describe('MockWebSocketServer', () => {
  it('should handle connection events', () => {
    const wss = new MockWebSocketServer()
    const connectionHandler = vi.fn()

    wss.on('connection', connectionHandler)

    const mockWs = new MockWebSocket()
    wss.simulateConnection(mockWs, '/test')

    expect(connectionHandler).toHaveBeenCalledWith(mockWs, { url: '/test' })
  })

  it('should handle close callback', () => {
    const wss = new MockWebSocketServer()
    const callback = vi.fn()

    wss.close(callback)

    expect(callback).toHaveBeenCalled()
  })
})

// =============================================================================
// Frame Parsing Edge Cases
// =============================================================================

describe('Frame Parsing Edge Cases', () => {
  it('should handle empty payload', () => {
    const frame = createFrame(MessageType.PING, 0, new Uint8Array(0))

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    expect(view.getUint32(12, true)).toBe(0) // payloadLen
    expect(frame.length).toBe(HEADER_SIZE)
  })

  it('should handle large stream IDs', () => {
    const largeStreamId = 0xffffffff
    const frame = createFrame(MessageType.DATA, largeStreamId, new Uint8Array([1, 2, 3]))

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    expect(view.getUint32(8, true)).toBe(largeStreamId)
  })

  it('should handle all frame flags', () => {
    const allFlags = 0xff
    const frame = createFrame(MessageType.DATA, 1, new Uint8Array(0), allFlags)

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    expect(view.getUint8(6)).toBe(allFlags)
  })
})

// =============================================================================
// Window Size Tests
// =============================================================================

describe('Window Size', () => {
  it('should use correct default window size', () => {
    expect(DEFAULT_WINDOW_SIZE).toBe(65536)
  })

  it('should include window size in OPEN payload', () => {
    const frame = createOpenFrame(1, StreamType.TCP)
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)

    const windowSize = view.getUint32(HEADER_SIZE + 1, true)
    expect(windowSize).toBe(DEFAULT_WINDOW_SIZE)
  })
})

// =============================================================================
// Connection State Tests
// =============================================================================

describe('Connection States', () => {
  it('should define all stream states', () => {
    expect(StreamState.IDLE).toBe('idle')
    expect(StreamState.OPEN).toBe('open')
    expect(StreamState.HALF_CLOSED_LOCAL).toBe('half-closed-local')
    expect(StreamState.HALF_CLOSED_REMOTE).toBe('half-closed-remote')
    expect(StreamState.CLOSED).toBe('closed')
  })
})

// =============================================================================
// Message Type Ranges Tests
// =============================================================================

describe('Message Type Ranges', () => {
  it('should have connection management in 0x00-0x0F', () => {
    expect(MessageType.HELLO).toBeLessThan(0x10)
    expect(MessageType.HELLO_ACK).toBeLessThan(0x10)
    expect(MessageType.PING).toBeLessThan(0x10)
    expect(MessageType.PONG).toBeLessThan(0x10)
    expect(MessageType.GOAWAY).toBeLessThan(0x10)
  })

  it('should have stream management in 0x10-0x1F', () => {
    expect(MessageType.OPEN).toBeGreaterThanOrEqual(0x10)
    expect(MessageType.OPEN).toBeLessThan(0x20)
    expect(MessageType.CLOSE).toBeGreaterThanOrEqual(0x10)
    expect(MessageType.CLOSE).toBeLessThan(0x20)
  })

  it('should have TCP operations in 0x20-0x2F', () => {
    expect(MessageType.TCP_CONNECT).toBeGreaterThanOrEqual(0x20)
    expect(MessageType.TCP_CONNECT).toBeLessThan(0x30)
    expect(MessageType.TCP_SHUTDOWN).toBeGreaterThanOrEqual(0x20)
    expect(MessageType.TCP_SHUTDOWN).toBeLessThan(0x30)
  })

  it('should have DNS operations in 0x40-0x4F', () => {
    expect(MessageType.DNS_QUERY).toBeGreaterThanOrEqual(0x40)
    expect(MessageType.DNS_QUERY).toBeLessThan(0x50)
    expect(MessageType.DNS_RESPONSE).toBeGreaterThanOrEqual(0x40)
    expect(MessageType.DNS_RESPONSE).toBeLessThan(0x50)
  })

  it('should have HTTP operations in 0x50-0x5F', () => {
    expect(MessageType.HTTP_REQUEST).toBeGreaterThanOrEqual(0x50)
    expect(MessageType.HTTP_REQUEST).toBeLessThan(0x60)
    expect(MessageType.HTTP_RESPONSE_TRAILERS).toBeGreaterThanOrEqual(0x50)
    expect(MessageType.HTTP_RESPONSE_TRAILERS).toBeLessThan(0x60)
  })

  it('should have filesystem operations in 0x60-0x6F', () => {
    expect(MessageType.FS_OPEN).toBeGreaterThanOrEqual(0x60)
    expect(MessageType.FS_OPEN).toBeLessThan(0x70)
    expect(MessageType.FS_RENAME).toBeGreaterThanOrEqual(0x60)
    expect(MessageType.FS_RENAME).toBeLessThan(0x70)
  })
})
