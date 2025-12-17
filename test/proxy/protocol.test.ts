/**
 * Proxy Protocol Unit Tests
 *
 * Tests for the binary WebSocket protocol encoding/decoding
 */

import { describe, it, expect } from 'vitest'
import {
  // Constants
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
  DEFAULT_WINDOW_SIZE,
  // Types
  MessageType,
  FrameFlags,
  ErrorCode,
  StreamType,
  StreamState,
  DnsRecordType,
  FsOpenFlags,
  FsFileType,
  // Functions
  encodeHeader,
  decodeHeader,
  createFrame,
  parseFrame,
  encodeString,
  decodeString,
  encodeBytes,
  decodeBytes,
  encodeHello,
  decodeHello,
  encodeTcpConnect,
  encodeDnsQuery,
  decodeDnsQuery,
  encodeDnsResponse,
  decodeDnsResponse,
  encodeError,
  decodeError,
  ProtocolError,
} from '../../src/wasip2/proxy/protocol.js'

// =============================================================================
// Constants Tests
// =============================================================================

describe('Protocol Constants', () => {
  it('should have correct magic bytes (KSW1)', () => {
    // "KSW1" in little-endian is 0x3157534b
    expect(PROTOCOL_MAGIC).toBe(0x3157534b)

    // Verify it spells "KSW1"
    const buffer = new ArrayBuffer(4)
    const view = new DataView(buffer)
    view.setUint32(0, PROTOCOL_MAGIC, true)
    const bytes = new Uint8Array(buffer)
    const str = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
    expect(str).toBe('KSW1')
  })

  it('should have version 1', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })

  it('should have 16-byte header size', () => {
    expect(HEADER_SIZE).toBe(16)
  })

  it('should have 16 MB max payload size', () => {
    expect(MAX_PAYLOAD_SIZE).toBe(16 * 1024 * 1024)
  })

  it('should have 64 KB default window size', () => {
    expect(DEFAULT_WINDOW_SIZE).toBe(64 * 1024)
  })
})

// =============================================================================
// Message Type Tests
// =============================================================================

describe('MessageType', () => {
  it('should have connection management types in 0x00-0x0F range', () => {
    expect(MessageType.HELLO).toBe(0x00)
    expect(MessageType.HELLO_ACK).toBe(0x01)
    expect(MessageType.PING).toBe(0x02)
    expect(MessageType.PONG).toBe(0x03)
    expect(MessageType.GOAWAY).toBe(0x04)
  })

  it('should have stream management types in 0x10-0x1F range', () => {
    expect(MessageType.OPEN).toBe(0x10)
    expect(MessageType.OPEN_ACK).toBe(0x11)
    expect(MessageType.DATA).toBe(0x12)
    expect(MessageType.DATA_ACK).toBe(0x13)
    expect(MessageType.CLOSE).toBe(0x14)
    expect(MessageType.RESET).toBe(0x15)
    expect(MessageType.WINDOW_UPDATE).toBe(0x16)
  })

  it('should have TCP types in 0x20-0x2F range', () => {
    expect(MessageType.TCP_CONNECT).toBe(0x20)
    expect(MessageType.TCP_CONNECT_ACK).toBe(0x21)
    expect(MessageType.TCP_LISTEN).toBe(0x22)
    expect(MessageType.TCP_ACCEPT).toBe(0x23)
    expect(MessageType.TCP_SHUTDOWN).toBe(0x24)
  })

  it('should have UDP types in 0x30-0x3F range', () => {
    expect(MessageType.UDP_BIND).toBe(0x30)
    expect(MessageType.UDP_BIND_ACK).toBe(0x31)
    expect(MessageType.UDP_SENDTO).toBe(0x32)
    expect(MessageType.UDP_RECVFROM).toBe(0x33)
  })

  it('should have DNS types in 0x40-0x4F range', () => {
    expect(MessageType.DNS_QUERY).toBe(0x40)
    expect(MessageType.DNS_RESPONSE).toBe(0x41)
  })

  it('should have HTTP types in 0x50-0x5F range', () => {
    expect(MessageType.HTTP_REQUEST).toBe(0x50)
    expect(MessageType.HTTP_RESPONSE_HEAD).toBe(0x51)
    expect(MessageType.HTTP_RESPONSE_BODY).toBe(0x52)
    expect(MessageType.HTTP_RESPONSE_TRAILERS).toBe(0x53)
  })

  it('should have filesystem types in 0x60-0x6F range', () => {
    expect(MessageType.FS_OPEN).toBe(0x60)
    expect(MessageType.FS_OPEN_ACK).toBe(0x61)
    expect(MessageType.FS_READ).toBe(0x62)
    expect(MessageType.FS_READ_ACK).toBe(0x63)
    expect(MessageType.FS_WRITE).toBe(0x64)
    expect(MessageType.FS_WRITE_ACK).toBe(0x65)
    expect(MessageType.FS_STAT).toBe(0x66)
    expect(MessageType.FS_STAT_ACK).toBe(0x67)
    expect(MessageType.FS_READDIR).toBe(0x68)
    expect(MessageType.FS_READDIR_ACK).toBe(0x69)
    expect(MessageType.FS_CLOSE).toBe(0x6a)
    expect(MessageType.FS_UNLINK).toBe(0x6b)
    expect(MessageType.FS_MKDIR).toBe(0x6c)
    expect(MessageType.FS_RMDIR).toBe(0x6d)
    expect(MessageType.FS_RENAME).toBe(0x6e)
  })

  it('should have ERROR type at 0xFF', () => {
    expect(MessageType.ERROR).toBe(0xff)
  })
})

// =============================================================================
// Frame Flags Tests
// =============================================================================

describe('FrameFlags', () => {
  it('should have correct flag values', () => {
    expect(FrameFlags.NONE).toBe(0x00)
    expect(FrameFlags.END_STREAM).toBe(0x01)
    expect(FrameFlags.ACK).toBe(0x02)
    expect(FrameFlags.COMPRESSED).toBe(0x04)
    expect(FrameFlags.PRIORITY).toBe(0x08)
  })

  it('should allow flag combinations', () => {
    const combined = FrameFlags.END_STREAM | FrameFlags.ACK
    expect(combined).toBe(0x03)
    expect(combined & FrameFlags.END_STREAM).toBe(FrameFlags.END_STREAM)
    expect(combined & FrameFlags.ACK).toBe(FrameFlags.ACK)
    expect(combined & FrameFlags.COMPRESSED).toBe(0)
  })
})

// =============================================================================
// Error Code Tests
// =============================================================================

describe('ErrorCode', () => {
  it('should have expected error codes', () => {
    expect(ErrorCode.OK).toBe(0)
    expect(ErrorCode.UNKNOWN).toBe(1)
    expect(ErrorCode.PROTOCOL_ERROR).toBe(2)
    expect(ErrorCode.INTERNAL_ERROR).toBe(3)
    expect(ErrorCode.FLOW_CONTROL_ERROR).toBe(4)
    expect(ErrorCode.STREAM_CLOSED).toBe(5)
    expect(ErrorCode.FRAME_SIZE_ERROR).toBe(6)
    expect(ErrorCode.REFUSED_STREAM).toBe(7)
    expect(ErrorCode.CANCEL).toBe(8)
    expect(ErrorCode.TIMEOUT).toBe(9)
    expect(ErrorCode.CONNECT_ERROR).toBe(10)
    expect(ErrorCode.DNS_ERROR).toBe(11)
    expect(ErrorCode.IO_ERROR).toBe(12)
    expect(ErrorCode.PERMISSION_DENIED).toBe(13)
    expect(ErrorCode.NOT_FOUND).toBe(14)
    expect(ErrorCode.ALREADY_EXISTS).toBe(15)
    expect(ErrorCode.INVALID_ARGUMENT).toBe(16)
    expect(ErrorCode.RESOURCE_EXHAUSTED).toBe(17)
  })
})

// =============================================================================
// Header Encoding/Decoding Tests
// =============================================================================

describe('Header Encoding/Decoding', () => {
  it('should encode a valid header', () => {
    const header = {
      magic: PROTOCOL_MAGIC,
      version: PROTOCOL_VERSION,
      type: MessageType.HELLO,
      flags: FrameFlags.NONE,
      reserved: 0,
      streamId: 0,
      payloadLen: 100,
    }

    const encoded = encodeHeader(header)
    expect(encoded.length).toBe(HEADER_SIZE)

    // Verify magic
    const view = new DataView(encoded.buffer)
    expect(view.getUint32(0, true)).toBe(PROTOCOL_MAGIC)
    expect(view.getUint8(4)).toBe(PROTOCOL_VERSION)
    expect(view.getUint8(5)).toBe(MessageType.HELLO)
    expect(view.getUint8(6)).toBe(FrameFlags.NONE)
    expect(view.getUint8(7)).toBe(0) // reserved
    expect(view.getUint32(8, true)).toBe(0) // streamId
    expect(view.getUint32(12, true)).toBe(100) // payloadLen
  })

  it('should decode a valid header', () => {
    const buffer = new Uint8Array(16)
    const view = new DataView(buffer.buffer)
    view.setUint32(0, PROTOCOL_MAGIC, true)
    view.setUint8(4, PROTOCOL_VERSION)
    view.setUint8(5, MessageType.DATA)
    view.setUint8(6, FrameFlags.END_STREAM)
    view.setUint8(7, 0)
    view.setUint32(8, 42, true) // streamId
    view.setUint32(12, 256, true) // payloadLen

    const decoded = decodeHeader(buffer)
    expect(decoded.magic).toBe(PROTOCOL_MAGIC)
    expect(decoded.version).toBe(PROTOCOL_VERSION)
    expect(decoded.type).toBe(MessageType.DATA)
    expect(decoded.flags).toBe(FrameFlags.END_STREAM)
    expect(decoded.reserved).toBe(0)
    expect(decoded.streamId).toBe(42)
    expect(decoded.payloadLen).toBe(256)
  })

  it('should roundtrip encode/decode', () => {
    const original = {
      magic: PROTOCOL_MAGIC,
      version: PROTOCOL_VERSION,
      type: MessageType.OPEN,
      flags: FrameFlags.PRIORITY,
      reserved: 0,
      streamId: 12345,
      payloadLen: 999,
    }

    const encoded = encodeHeader(original)
    const decoded = decodeHeader(encoded)

    expect(decoded).toEqual(original)
  })

  it('should throw on invalid magic', () => {
    const buffer = new Uint8Array(16)
    const view = new DataView(buffer.buffer)
    view.setUint32(0, 0x12345678, true) // wrong magic
    view.setUint8(4, PROTOCOL_VERSION)

    expect(() => decodeHeader(buffer)).toThrow(ProtocolError)
    expect(() => decodeHeader(buffer)).toThrow(/Invalid magic/)
  })

  it('should throw on invalid version', () => {
    const buffer = new Uint8Array(16)
    const view = new DataView(buffer.buffer)
    view.setUint32(0, PROTOCOL_MAGIC, true)
    view.setUint8(4, 99) // wrong version

    expect(() => decodeHeader(buffer)).toThrow(ProtocolError)
    expect(() => decodeHeader(buffer)).toThrow(/Unsupported version/)
  })

  it('should throw on buffer too small', () => {
    const buffer = new Uint8Array(10) // too small
    expect(() => decodeHeader(buffer)).toThrow(ProtocolError)
    expect(() => decodeHeader(buffer)).toThrow(/Buffer too small/)
  })
})

// =============================================================================
// Frame Creation and Parsing Tests
// =============================================================================

describe('Frame Creation and Parsing', () => {
  it('should create a frame with header and payload', () => {
    const payload = new TextEncoder().encode('hello')
    const frame = createFrame(MessageType.DATA, 1, payload)

    expect(frame.length).toBe(HEADER_SIZE + payload.length)

    // Verify header
    const header = decodeHeader(frame)
    expect(header.type).toBe(MessageType.DATA)
    expect(header.streamId).toBe(1)
    expect(header.payloadLen).toBe(payload.length)

    // Verify payload
    const extractedPayload = frame.slice(HEADER_SIZE)
    expect(extractedPayload).toEqual(payload)
  })

  it('should create a frame with flags', () => {
    const payload = new Uint8Array(0)
    const frame = createFrame(MessageType.CLOSE, 5, payload, FrameFlags.END_STREAM)

    const header = decodeHeader(frame)
    expect(header.type).toBe(MessageType.CLOSE)
    expect(header.flags).toBe(FrameFlags.END_STREAM)
  })

  it('should parse a complete frame', () => {
    const payload = new TextEncoder().encode('test data')
    const frame = createFrame(MessageType.DATA, 10, payload)

    const result = parseFrame(frame)
    expect(result).not.toBeNull()
    expect(result!.frame.header.type).toBe(MessageType.DATA)
    expect(result!.frame.header.streamId).toBe(10)
    expect(result!.frame.payload).toEqual(payload)
    expect(result!.bytesConsumed).toBe(frame.length)
  })

  it('should return null for incomplete header', () => {
    const buffer = new Uint8Array(10) // less than HEADER_SIZE
    const result = parseFrame(buffer)
    expect(result).toBeNull()
  })

  it('should return null for incomplete payload', () => {
    // Create header indicating 100 bytes payload
    const buffer = new Uint8Array(HEADER_SIZE + 50) // only 50 bytes of payload
    const view = new DataView(buffer.buffer)
    view.setUint32(0, PROTOCOL_MAGIC, true)
    view.setUint8(4, PROTOCOL_VERSION)
    view.setUint8(5, MessageType.DATA)
    view.setUint32(12, 100, true) // payload len = 100

    const result = parseFrame(buffer)
    expect(result).toBeNull()
  })

  it('should throw on oversized payload', () => {
    const buffer = new Uint8Array(HEADER_SIZE)
    const view = new DataView(buffer.buffer)
    view.setUint32(0, PROTOCOL_MAGIC, true)
    view.setUint8(4, PROTOCOL_VERSION)
    view.setUint8(5, MessageType.DATA)
    view.setUint32(12, MAX_PAYLOAD_SIZE + 1, true) // too large

    expect(() => parseFrame(buffer)).toThrow(ProtocolError)
    expect(() => parseFrame(buffer)).toThrow(/Payload too large/)
  })
})

// =============================================================================
// String Encoding/Decoding Tests
// =============================================================================

describe('String Encoding/Decoding', () => {
  it('should encode a string with length prefix', () => {
    const encoded = encodeString('hello')
    const view = new DataView(encoded.buffer)

    expect(view.getUint32(0, true)).toBe(5) // length
    expect(new TextDecoder().decode(encoded.slice(4))).toBe('hello')
  })

  it('should decode a length-prefixed string', () => {
    const encoded = encodeString('world')
    const { value, bytesRead } = decodeString(encoded)

    expect(value).toBe('world')
    expect(bytesRead).toBe(4 + 5) // length prefix + string
  })

  it('should handle empty strings', () => {
    const encoded = encodeString('')
    const { value, bytesRead } = decodeString(encoded)

    expect(value).toBe('')
    expect(bytesRead).toBe(4)
  })

  it('should handle unicode strings', () => {
    const original = '你好世界🌍'
    const encoded = encodeString(original)
    const { value } = decodeString(encoded)

    expect(value).toBe(original)
  })

  it('should decode with offset', () => {
    const prefix = new Uint8Array([1, 2, 3])
    const stringBytes = encodeString('test')
    const combined = new Uint8Array(prefix.length + stringBytes.length)
    combined.set(prefix)
    combined.set(stringBytes, prefix.length)

    const { value, bytesRead } = decodeString(combined, 3)
    expect(value).toBe('test')
    expect(bytesRead).toBe(4 + 4)
  })

  it('should throw on insufficient buffer for length', () => {
    const buffer = new Uint8Array(2) // too small for length prefix
    expect(() => decodeString(buffer)).toThrow(ProtocolError)
  })

  it('should throw on insufficient buffer for data', () => {
    const buffer = new Uint8Array(8)
    const view = new DataView(buffer.buffer)
    view.setUint32(0, 100, true) // says 100 bytes but only 4 available

    expect(() => decodeString(buffer)).toThrow(ProtocolError)
  })
})

// =============================================================================
// Bytes Encoding/Decoding Tests
// =============================================================================

describe('Bytes Encoding/Decoding', () => {
  it('should encode bytes with length prefix', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const encoded = encodeBytes(data)
    const view = new DataView(encoded.buffer)

    expect(view.getUint32(0, true)).toBe(5)
    expect(encoded.slice(4)).toEqual(data)
  })

  it('should decode length-prefixed bytes', () => {
    const original = new Uint8Array([0xff, 0x00, 0xab, 0xcd])
    const encoded = encodeBytes(original)
    const { value, bytesRead } = decodeBytes(encoded)

    expect(value).toEqual(original)
    expect(bytesRead).toBe(4 + 4)
  })

  it('should handle empty bytes', () => {
    const encoded = encodeBytes(new Uint8Array(0))
    const { value, bytesRead } = decodeBytes(encoded)

    expect(value.length).toBe(0)
    expect(bytesRead).toBe(4)
  })

  it('should roundtrip large byte arrays', () => {
    const original = new Uint8Array(1000)
    for (let i = 0; i < original.length; i++) {
      original[i] = i % 256
    }

    const encoded = encodeBytes(original)
    const { value } = decodeBytes(encoded)

    expect(value).toEqual(original)
  })
})

// =============================================================================
// HELLO Payload Tests
// =============================================================================

describe('HELLO Payload Encoding/Decoding', () => {
  it('should encode/decode HELLO payload', () => {
    const original = {
      clientVersion: 1,
      maxStreams: 100,
      initialWindowSize: 65536,
      capabilities: ['tcp', 'udp', 'dns', 'http', 'filesystem'],
    }

    const encoded = encodeHello(original)
    const decoded = decodeHello(encoded)

    expect(decoded.clientVersion).toBe(original.clientVersion)
    expect(decoded.maxStreams).toBe(original.maxStreams)
    expect(decoded.initialWindowSize).toBe(original.initialWindowSize)
    expect(decoded.capabilities).toEqual(original.capabilities)
  })

  it('should handle empty capabilities', () => {
    const original = {
      clientVersion: 1,
      maxStreams: 50,
      initialWindowSize: 32768,
      capabilities: [],
    }

    const encoded = encodeHello(original)
    const decoded = decodeHello(encoded)

    expect(decoded.capabilities).toEqual([])
  })
})

// =============================================================================
// DNS Payload Tests
// =============================================================================

describe('DNS Payload Encoding/Decoding', () => {
  it('should encode/decode DNS query', () => {
    const query = {
      hostname: 'example.com',
      recordType: DnsRecordType.A,
    }

    const encoded = encodeDnsQuery(query)
    const decoded = decodeDnsQuery(encoded)

    expect(decoded.hostname).toBe(query.hostname)
    expect(decoded.recordType).toBe(query.recordType)
  })

  it('should encode/decode DNS response', () => {
    const response = {
      hostname: 'example.com',
      recordType: DnsRecordType.A,
      addresses: ['93.184.216.34', '93.184.216.35'],
      ttl: 300,
    }

    const encoded = encodeDnsResponse(response)
    const decoded = decodeDnsResponse(encoded)

    expect(decoded.hostname).toBe(response.hostname)
    expect(decoded.recordType).toBe(response.recordType)
    expect(decoded.addresses).toEqual(response.addresses)
    expect(decoded.ttl).toBe(response.ttl)
  })

  it('should handle AAAA record type', () => {
    const response = {
      hostname: 'ipv6.example.com',
      recordType: DnsRecordType.AAAA,
      addresses: ['2001:db8::1', '2001:db8::2'],
      ttl: 600,
    }

    const encoded = encodeDnsResponse(response)
    const decoded = decodeDnsResponse(encoded)

    expect(decoded.recordType).toBe(DnsRecordType.AAAA)
    expect(decoded.addresses).toEqual(response.addresses)
  })

  it('should handle empty addresses', () => {
    const response = {
      hostname: 'notfound.example.com',
      recordType: DnsRecordType.A,
      addresses: [],
      ttl: 0,
    }

    const encoded = encodeDnsResponse(response)
    const decoded = decodeDnsResponse(encoded)

    expect(decoded.addresses).toEqual([])
  })
})

// =============================================================================
// Error Payload Tests
// =============================================================================

describe('Error Payload Encoding/Decoding', () => {
  it('should encode/decode error without details', () => {
    const error = {
      errorCode: ErrorCode.PERMISSION_DENIED,
      message: 'Access denied to resource',
    }

    const encoded = encodeError(error)
    const decoded = decodeError(encoded)

    expect(decoded.errorCode).toBe(error.errorCode)
    expect(decoded.message).toBe(error.message)
    expect(decoded.details).toBeUndefined()
  })

  it('should encode/decode error with details', () => {
    const error = {
      errorCode: ErrorCode.NOT_FOUND,
      message: 'File not found',
      details: {
        path: '/etc/config',
        attemptedAt: 1234567890,
      },
    }

    const encoded = encodeError(error)
    const decoded = decodeError(encoded)

    expect(decoded.errorCode).toBe(error.errorCode)
    expect(decoded.message).toBe(error.message)
    expect(decoded.details).toEqual(error.details)
  })

  it('should handle all error codes', () => {
    const errorCodes = [
      ErrorCode.OK,
      ErrorCode.UNKNOWN,
      ErrorCode.PROTOCOL_ERROR,
      ErrorCode.INTERNAL_ERROR,
      ErrorCode.TIMEOUT,
      ErrorCode.DNS_ERROR,
      ErrorCode.IO_ERROR,
      ErrorCode.PERMISSION_DENIED,
      ErrorCode.NOT_FOUND,
      ErrorCode.RESOURCE_EXHAUSTED,
    ]

    for (const code of errorCodes) {
      const error = { errorCode: code, message: `Error ${code}` }
      const encoded = encodeError(error)
      const decoded = decodeError(encoded)
      expect(decoded.errorCode).toBe(code)
    }
  })
})

// =============================================================================
// ProtocolError Class Tests
// =============================================================================

describe('ProtocolError', () => {
  it('should create error with code and message', () => {
    const error = new ProtocolError(ErrorCode.TIMEOUT, 'Connection timed out')

    expect(error.code).toBe(ErrorCode.TIMEOUT)
    expect(error.message).toBe('Connection timed out')
    expect(error.name).toBe('ProtocolError')
    expect(error instanceof Error).toBe(true)
  })
})

// =============================================================================
// Stream Type and State Tests
// =============================================================================

describe('StreamType', () => {
  it('should have expected stream types', () => {
    expect(StreamType.CONTROL).toBe(0)
    expect(StreamType.TCP).toBe(1)
    expect(StreamType.UDP).toBe(2)
    expect(StreamType.HTTP).toBe(3)
    expect(StreamType.FILESYSTEM).toBe(4)
  })
})

describe('StreamState', () => {
  it('should have expected stream states', () => {
    expect(StreamState.IDLE).toBe('idle')
    expect(StreamState.OPEN).toBe('open')
    expect(StreamState.HALF_CLOSED_LOCAL).toBe('half-closed-local')
    expect(StreamState.HALF_CLOSED_REMOTE).toBe('half-closed-remote')
    expect(StreamState.CLOSED).toBe('closed')
  })
})

// =============================================================================
// Filesystem Types Tests
// =============================================================================

describe('FsOpenFlags', () => {
  it('should have correct flag values', () => {
    expect(FsOpenFlags.READ).toBe(0x01)
    expect(FsOpenFlags.WRITE).toBe(0x02)
    expect(FsOpenFlags.CREATE).toBe(0x04)
    expect(FsOpenFlags.TRUNCATE).toBe(0x08)
    expect(FsOpenFlags.APPEND).toBe(0x10)
    expect(FsOpenFlags.EXCLUSIVE).toBe(0x20)
  })

  it('should allow flag combinations', () => {
    const readWrite = FsOpenFlags.READ | FsOpenFlags.WRITE
    expect(readWrite).toBe(0x03)

    const createTruncate = FsOpenFlags.WRITE | FsOpenFlags.CREATE | FsOpenFlags.TRUNCATE
    expect(createTruncate).toBe(0x0e)
  })
})

describe('FsFileType', () => {
  it('should have expected file types', () => {
    expect(FsFileType.FILE).toBe(0)
    expect(FsFileType.DIRECTORY).toBe(1)
    expect(FsFileType.SYMLINK).toBe(2)
    expect(FsFileType.OTHER).toBe(3)
  })
})

// =============================================================================
// DNS Record Type Tests
// =============================================================================

describe('DnsRecordType', () => {
  it('should have standard DNS record type values', () => {
    expect(DnsRecordType.A).toBe(1)
    expect(DnsRecordType.AAAA).toBe(28)
    expect(DnsRecordType.CNAME).toBe(5)
    expect(DnsRecordType.MX).toBe(15)
    expect(DnsRecordType.TXT).toBe(16)
    expect(DnsRecordType.SRV).toBe(33)
  })
})
