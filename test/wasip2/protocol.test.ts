/**
 * WASIP2 Protocol Tests
 *
 * Tests for the binary WebSocket protocol encoding/decoding functions.
 */

import { describe, it, expect } from 'vitest'
import {
  // Constants
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
  DEFAULT_WINDOW_SIZE,

  // Enums
  MessageType,
  FrameFlags,
  ErrorCode,
  StreamType,
  StreamState,
  DnsRecordType,
  FsOpenFlags,
  FsFileType,

  // Encoding/Decoding
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

  // Error
  ProtocolError,
} from '../../src/wasip2/proxy/index.js'

describe('WASIP2 Protocol', () => {
  describe('constants', () => {
    it('defines correct protocol magic', () => {
      expect(PROTOCOL_MAGIC).toBe(0x3157534b) // 'KSW1'
    })

    it('defines correct protocol version', () => {
      expect(PROTOCOL_VERSION).toBe(1)
    })

    it('defines correct header size', () => {
      expect(HEADER_SIZE).toBe(16)
    })

    it('defines correct max payload size', () => {
      expect(MAX_PAYLOAD_SIZE).toBe(16 * 1024 * 1024) // 16 MB
    })

    it('defines correct default window size', () => {
      expect(DEFAULT_WINDOW_SIZE).toBe(64 * 1024) // 64 KB
    })
  })

  describe('MessageType enum', () => {
    it('defines connection management types', () => {
      expect(MessageType.HELLO).toBe(0x00)
      expect(MessageType.HELLO_ACK).toBe(0x01)
      expect(MessageType.PING).toBe(0x02)
      expect(MessageType.PONG).toBe(0x03)
      expect(MessageType.GOAWAY).toBe(0x04)
    })

    it('defines stream management types', () => {
      expect(MessageType.OPEN).toBe(0x10)
      expect(MessageType.OPEN_ACK).toBe(0x11)
      expect(MessageType.DATA).toBe(0x12)
      expect(MessageType.DATA_ACK).toBe(0x13)
      expect(MessageType.CLOSE).toBe(0x14)
      expect(MessageType.RESET).toBe(0x15)
      expect(MessageType.WINDOW_UPDATE).toBe(0x16)
    })

    it('defines TCP operation types', () => {
      expect(MessageType.TCP_CONNECT).toBe(0x20)
      expect(MessageType.TCP_CONNECT_ACK).toBe(0x21)
      expect(MessageType.TCP_LISTEN).toBe(0x22)
      expect(MessageType.TCP_ACCEPT).toBe(0x23)
      expect(MessageType.TCP_SHUTDOWN).toBe(0x24)
    })

    it('defines UDP operation types', () => {
      expect(MessageType.UDP_BIND).toBe(0x30)
      expect(MessageType.UDP_BIND_ACK).toBe(0x31)
      expect(MessageType.UDP_SENDTO).toBe(0x32)
      expect(MessageType.UDP_RECVFROM).toBe(0x33)
    })

    it('defines DNS operation types', () => {
      expect(MessageType.DNS_QUERY).toBe(0x40)
      expect(MessageType.DNS_RESPONSE).toBe(0x41)
    })

    it('defines HTTP operation types', () => {
      expect(MessageType.HTTP_REQUEST).toBe(0x50)
      expect(MessageType.HTTP_RESPONSE_HEAD).toBe(0x51)
      expect(MessageType.HTTP_RESPONSE_BODY).toBe(0x52)
      expect(MessageType.HTTP_RESPONSE_TRAILERS).toBe(0x53)
    })

    it('defines filesystem operation types', () => {
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

    it('defines error type', () => {
      expect(MessageType.ERROR).toBe(0xff)
    })
  })

  describe('FrameFlags enum', () => {
    it('defines flag values', () => {
      expect(FrameFlags.NONE).toBe(0x00)
      expect(FrameFlags.END_STREAM).toBe(0x01)
      expect(FrameFlags.ACK).toBe(0x02)
      expect(FrameFlags.COMPRESSED).toBe(0x04)
      expect(FrameFlags.PRIORITY).toBe(0x08)
    })

    it('allows combining flags with bitwise OR', () => {
      const combined = FrameFlags.END_STREAM | FrameFlags.ACK
      expect(combined).toBe(0x03)
    })
  })

  describe('ErrorCode enum', () => {
    it('defines error codes', () => {
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

  describe('StreamType enum', () => {
    it('defines stream types', () => {
      expect(StreamType.CONTROL).toBe(0)
      expect(StreamType.TCP).toBe(1)
      expect(StreamType.UDP).toBe(2)
      expect(StreamType.HTTP).toBe(3)
      expect(StreamType.FILESYSTEM).toBe(4)
    })
  })

  describe('StreamState enum', () => {
    it('defines stream states', () => {
      expect(StreamState.IDLE).toBe('idle')
      expect(StreamState.OPEN).toBe('open')
      expect(StreamState.HALF_CLOSED_LOCAL).toBe('half-closed-local')
      expect(StreamState.HALF_CLOSED_REMOTE).toBe('half-closed-remote')
      expect(StreamState.CLOSED).toBe('closed')
    })
  })

  describe('DnsRecordType enum', () => {
    it('defines DNS record types', () => {
      expect(DnsRecordType.A).toBe(1)
      expect(DnsRecordType.AAAA).toBe(28)
      expect(DnsRecordType.CNAME).toBe(5)
      expect(DnsRecordType.MX).toBe(15)
      expect(DnsRecordType.TXT).toBe(16)
      expect(DnsRecordType.SRV).toBe(33)
    })
  })

  describe('FsOpenFlags enum', () => {
    it('defines filesystem open flags', () => {
      expect(FsOpenFlags.READ).toBe(0x01)
      expect(FsOpenFlags.WRITE).toBe(0x02)
      expect(FsOpenFlags.CREATE).toBe(0x04)
      expect(FsOpenFlags.TRUNCATE).toBe(0x08)
      expect(FsOpenFlags.APPEND).toBe(0x10)
      expect(FsOpenFlags.EXCLUSIVE).toBe(0x20)
    })

    it('allows combining flags', () => {
      const readWrite = FsOpenFlags.READ | FsOpenFlags.WRITE
      expect(readWrite).toBe(0x03)

      const createTruncate = FsOpenFlags.CREATE | FsOpenFlags.TRUNCATE | FsOpenFlags.WRITE
      expect(createTruncate).toBe(0x0e)
    })
  })

  describe('FsFileType enum', () => {
    it('defines file types', () => {
      expect(FsFileType.FILE).toBe(0)
      expect(FsFileType.DIRECTORY).toBe(1)
      expect(FsFileType.SYMLINK).toBe(2)
      expect(FsFileType.OTHER).toBe(3)
    })
  })

  describe('encodeHeader/decodeHeader', () => {
    it('encodes and decodes header correctly', () => {
      const header = {
        magic: PROTOCOL_MAGIC,
        version: PROTOCOL_VERSION,
        type: MessageType.DATA,
        flags: FrameFlags.END_STREAM,
        reserved: 0,
        streamId: 42,
        payloadLen: 1024,
      }

      const encoded = encodeHeader(header)
      expect(encoded.length).toBe(HEADER_SIZE)

      const decoded = decodeHeader(encoded)
      expect(decoded).toEqual(header)
    })

    it('uses little-endian byte order', () => {
      const header = {
        magic: PROTOCOL_MAGIC,
        version: PROTOCOL_VERSION,
        type: MessageType.HELLO,
        flags: 0,
        reserved: 0,
        streamId: 0x12345678,
        payloadLen: 0xabcdef12,
      }

      const encoded = encodeHeader(header)

      // Check stream ID in little-endian
      expect(encoded[8]).toBe(0x78)
      expect(encoded[9]).toBe(0x56)
      expect(encoded[10]).toBe(0x34)
      expect(encoded[11]).toBe(0x12)

      // Check payload length in little-endian
      expect(encoded[12]).toBe(0x12)
      expect(encoded[13]).toBe(0xef)
      expect(encoded[14]).toBe(0xcd)
      expect(encoded[15]).toBe(0xab)
    })

    it('throws on invalid magic', () => {
      const buffer = new Uint8Array(HEADER_SIZE)
      buffer[0] = 0xff // Invalid magic

      expect(() => decodeHeader(buffer)).toThrow(ProtocolError)
      expect(() => decodeHeader(buffer)).toThrow(/Invalid magic/)
    })

    it('throws on unsupported version', () => {
      const header = {
        magic: PROTOCOL_MAGIC,
        version: PROTOCOL_VERSION,
        type: MessageType.HELLO,
        flags: 0,
        reserved: 0,
        streamId: 0,
        payloadLen: 0,
      }

      const encoded = encodeHeader(header)
      encoded[4] = 99 // Unsupported version

      expect(() => decodeHeader(encoded)).toThrow(ProtocolError)
      expect(() => decodeHeader(encoded)).toThrow(/Unsupported version/)
    })

    it('throws on buffer too small', () => {
      const buffer = new Uint8Array(8) // Too small
      expect(() => decodeHeader(buffer)).toThrow(ProtocolError)
      expect(() => decodeHeader(buffer)).toThrow(/Buffer too small/)
    })
  })

  describe('createFrame/parseFrame', () => {
    it('creates a complete frame', () => {
      const payload = new Uint8Array([1, 2, 3, 4, 5])
      const frame = createFrame(MessageType.DATA, 1, payload, FrameFlags.END_STREAM)

      expect(frame.length).toBe(HEADER_SIZE + payload.length)
    })

    it('parses a complete frame', () => {
      const payload = new Uint8Array([1, 2, 3, 4, 5])
      const frame = createFrame(MessageType.DATA, 1, payload, FrameFlags.END_STREAM)

      const result = parseFrame(frame)
      expect(result).not.toBeNull()
      expect(result!.frame.header.type).toBe(MessageType.DATA)
      expect(result!.frame.header.streamId).toBe(1)
      expect(result!.frame.header.flags).toBe(FrameFlags.END_STREAM)
      expect(result!.frame.payload).toEqual(payload)
      expect(result!.bytesConsumed).toBe(frame.length)
    })

    it('returns null for incomplete frame', () => {
      const payload = new Uint8Array([1, 2, 3, 4, 5])
      const frame = createFrame(MessageType.DATA, 1, payload)

      // Provide only partial frame
      const partial = frame.slice(0, HEADER_SIZE + 2)
      const result = parseFrame(partial)
      expect(result).toBeNull()
    })

    it('returns null for buffer smaller than header', () => {
      const result = parseFrame(new Uint8Array(8))
      expect(result).toBeNull()
    })

    it('throws on payload too large', () => {
      const header = {
        magic: PROTOCOL_MAGIC,
        version: PROTOCOL_VERSION,
        type: MessageType.DATA,
        flags: 0,
        reserved: 0,
        streamId: 1,
        payloadLen: MAX_PAYLOAD_SIZE + 1, // Too large
      }

      const encoded = encodeHeader(header)
      expect(() => parseFrame(encoded)).toThrow(ProtocolError)
      expect(() => parseFrame(encoded)).toThrow(/Payload too large/)
    })

    it('handles empty payload', () => {
      const frame = createFrame(MessageType.PING, 0, new Uint8Array(0))
      const result = parseFrame(frame)

      expect(result).not.toBeNull()
      expect(result!.frame.payload.length).toBe(0)
    })

    it('parses multiple frames from buffer', () => {
      const payload1 = new Uint8Array([1, 2, 3])
      const payload2 = new Uint8Array([4, 5, 6, 7])

      const frame1 = createFrame(MessageType.DATA, 1, payload1)
      const frame2 = createFrame(MessageType.DATA, 2, payload2)

      // Combine frames
      const combined = new Uint8Array(frame1.length + frame2.length)
      combined.set(frame1, 0)
      combined.set(frame2, frame1.length)

      // Parse first frame
      const result1 = parseFrame(combined)
      expect(result1).not.toBeNull()
      expect(result1!.frame.header.streamId).toBe(1)
      expect(result1!.bytesConsumed).toBe(frame1.length)

      // Parse second frame from remainder
      const remainder = combined.slice(result1!.bytesConsumed)
      const result2 = parseFrame(remainder)
      expect(result2).not.toBeNull()
      expect(result2!.frame.header.streamId).toBe(2)
    })
  })

  describe('encodeString/decodeString', () => {
    it('encodes and decodes string correctly', () => {
      const str = 'Hello, World!'
      const encoded = encodeString(str)

      // First 4 bytes are length
      const view = new DataView(encoded.buffer)
      expect(view.getUint32(0, true)).toBe(str.length)

      const { value, bytesRead } = decodeString(encoded)
      expect(value).toBe(str)
      expect(bytesRead).toBe(4 + str.length)
    })

    it('handles empty string', () => {
      const encoded = encodeString('')
      const { value, bytesRead } = decodeString(encoded)
      expect(value).toBe('')
      expect(bytesRead).toBe(4)
    })

    it('handles unicode characters', () => {
      const str = '你好世界🌍'
      const encoded = encodeString(str)
      const { value } = decodeString(encoded)
      expect(value).toBe(str)
    })

    it('decodes with offset', () => {
      const prefix = new Uint8Array([0, 0, 0, 0, 0]) // 5 byte prefix
      const str = 'test'
      const strEncoded = encodeString(str)

      const combined = new Uint8Array(prefix.length + strEncoded.length)
      combined.set(prefix, 0)
      combined.set(strEncoded, prefix.length)

      const { value } = decodeString(combined, 5)
      expect(value).toBe(str)
    })

    it('throws on buffer too small for length', () => {
      expect(() => decodeString(new Uint8Array(2))).toThrow(ProtocolError)
    })

    it('throws on buffer too small for data', () => {
      const buffer = new Uint8Array(8)
      const view = new DataView(buffer.buffer)
      view.setUint32(0, 100, true) // Claim 100 bytes but only provide 4

      expect(() => decodeString(buffer)).toThrow(ProtocolError)
    })
  })

  describe('encodeBytes/decodeBytes', () => {
    it('encodes and decodes bytes correctly', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5])
      const encoded = encodeBytes(bytes)

      const view = new DataView(encoded.buffer)
      expect(view.getUint32(0, true)).toBe(bytes.length)

      const { value, bytesRead } = decodeBytes(encoded)
      expect(value).toEqual(bytes)
      expect(bytesRead).toBe(4 + bytes.length)
    })

    it('handles empty bytes', () => {
      const encoded = encodeBytes(new Uint8Array(0))
      const { value, bytesRead } = decodeBytes(encoded)
      expect(value.length).toBe(0)
      expect(bytesRead).toBe(4)
    })

    it('decodes with offset', () => {
      const prefix = new Uint8Array([0xff, 0xff])
      const bytes = new Uint8Array([10, 20, 30])
      const bytesEncoded = encodeBytes(bytes)

      const combined = new Uint8Array(prefix.length + bytesEncoded.length)
      combined.set(prefix, 0)
      combined.set(bytesEncoded, prefix.length)

      const { value } = decodeBytes(combined, 2)
      expect(value).toEqual(bytes)
    })
  })

  describe('encodeHello/decodeHello', () => {
    it('encodes and decodes hello payload', () => {
      const hello = {
        clientVersion: PROTOCOL_VERSION,
        maxStreams: 100,
        initialWindowSize: 65536,
        capabilities: ['tcp', 'udp', 'dns'],
      }

      const encoded = encodeHello(hello)
      const decoded = decodeHello(encoded)

      expect(decoded.clientVersion).toBe(hello.clientVersion)
      expect(decoded.maxStreams).toBe(hello.maxStreams)
      expect(decoded.initialWindowSize).toBe(hello.initialWindowSize)
      expect(decoded.capabilities).toEqual(hello.capabilities)
    })

    it('handles empty capabilities', () => {
      const hello = {
        clientVersion: 1,
        maxStreams: 50,
        initialWindowSize: 32768,
        capabilities: [],
      }

      const encoded = encodeHello(hello)
      const decoded = decodeHello(encoded)

      expect(decoded.capabilities).toEqual([])
    })

    it('handles many capabilities', () => {
      const capabilities = Array.from({ length: 20 }, (_, i) => `cap-${i}`)
      const hello = {
        clientVersion: 1,
        maxStreams: 100,
        initialWindowSize: 65536,
        capabilities,
      }

      const encoded = encodeHello(hello)
      const decoded = decodeHello(encoded)

      expect(decoded.capabilities).toEqual(capabilities)
    })
  })

  describe('encodeTcpConnect', () => {
    it('encodes basic TCP connect', () => {
      const payload = encodeTcpConnect({
        host: 'example.com',
        port: 80,
      })

      expect(payload.length).toBeGreaterThan(0)

      // Port should be at start (2 bytes)
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
      expect(view.getUint16(0, true)).toBe(80)
    })

    it('encodes with local address', () => {
      const payload = encodeTcpConnect({
        host: 'example.com',
        port: 443,
        localAddress: '192.168.1.1',
        localPort: 12345,
      })

      expect(payload.length).toBeGreaterThan(0)
    })

    it('encodes with keepAlive and noDelay', () => {
      const payload = encodeTcpConnect({
        host: 'localhost',
        port: 8080,
        keepAlive: true,
        noDelay: true,
      })

      // Last byte contains flags
      const flags = payload[payload.length - 1]
      expect(flags! & 0x02).toBe(0x02) // keepAlive
      expect(flags! & 0x04).toBe(0x04) // noDelay
    })
  })

  describe('encodeDnsQuery/decodeDnsQuery', () => {
    it('encodes and decodes DNS query', () => {
      const query = {
        hostname: 'example.com',
        recordType: DnsRecordType.A,
      }

      const encoded = encodeDnsQuery(query)
      const decoded = decodeDnsQuery(encoded)

      expect(decoded.hostname).toBe(query.hostname)
      expect(decoded.recordType).toBe(query.recordType)
    })

    it('handles AAAA record type', () => {
      const query = {
        hostname: 'ipv6.example.com',
        recordType: DnsRecordType.AAAA,
      }

      const encoded = encodeDnsQuery(query)
      const decoded = decodeDnsQuery(encoded)

      expect(decoded.recordType).toBe(DnsRecordType.AAAA)
    })
  })

  describe('encodeDnsResponse/decodeDnsResponse', () => {
    it('encodes and decodes DNS response', () => {
      const response = {
        hostname: 'example.com',
        recordType: DnsRecordType.A,
        addresses: ['93.184.216.34'],
        ttl: 3600,
      }

      const encoded = encodeDnsResponse(response)
      const decoded = decodeDnsResponse(encoded)

      expect(decoded.hostname).toBe(response.hostname)
      expect(decoded.recordType).toBe(response.recordType)
      expect(decoded.addresses).toEqual(response.addresses)
      expect(decoded.ttl).toBe(response.ttl)
    })

    it('handles multiple addresses', () => {
      const response = {
        hostname: 'google.com',
        recordType: DnsRecordType.A,
        addresses: ['142.250.80.46', '142.250.80.47', '142.250.80.78'],
        ttl: 300,
      }

      const encoded = encodeDnsResponse(response)
      const decoded = decodeDnsResponse(encoded)

      expect(decoded.addresses).toEqual(response.addresses)
    })

    it('handles AAAA responses', () => {
      const response = {
        hostname: 'ipv6.example.com',
        recordType: DnsRecordType.AAAA,
        addresses: ['2606:2800:220:1:248:1893:25c8:1946'],
        ttl: 1800,
      }

      const encoded = encodeDnsResponse(response)
      const decoded = decodeDnsResponse(encoded)

      expect(decoded.recordType).toBe(DnsRecordType.AAAA)
      expect(decoded.addresses).toEqual(response.addresses)
    })

    it('handles empty addresses', () => {
      const response = {
        hostname: 'nonexistent.example.com',
        recordType: DnsRecordType.A,
        addresses: [],
        ttl: 0,
      }

      const encoded = encodeDnsResponse(response)
      const decoded = decodeDnsResponse(encoded)

      expect(decoded.addresses).toEqual([])
    })
  })

  describe('encodeError/decodeError', () => {
    it('encodes and decodes error payload', () => {
      const error = {
        errorCode: ErrorCode.CONNECT_ERROR,
        message: 'Connection refused',
      }

      const encoded = encodeError(error)
      const decoded = decodeError(encoded)

      expect(decoded.errorCode).toBe(error.errorCode)
      expect(decoded.message).toBe(error.message)
      expect(decoded.details).toBeUndefined()
    })

    it('handles error with details', () => {
      const error = {
        errorCode: ErrorCode.PERMISSION_DENIED,
        message: 'Access denied',
        details: { path: '/secret/file', uid: 1000 },
      }

      const encoded = encodeError(error)
      const decoded = decodeError(encoded)

      expect(decoded.errorCode).toBe(error.errorCode)
      expect(decoded.message).toBe(error.message)
      expect(decoded.details).toEqual(error.details)
    })

    it('handles all error codes', () => {
      for (const code of Object.values(ErrorCode).filter((v) => typeof v === 'number')) {
        const error = {
          errorCode: code as ErrorCode,
          message: `Error ${code}`,
        }

        const encoded = encodeError(error)
        const decoded = decodeError(encoded)

        expect(decoded.errorCode).toBe(code)
      }
    })
  })

  describe('ProtocolError', () => {
    it('creates error with code and message', () => {
      const error = new ProtocolError(ErrorCode.TIMEOUT, 'Operation timed out')

      expect(error.code).toBe(ErrorCode.TIMEOUT)
      expect(error.message).toBe('Operation timed out')
      expect(error.name).toBe('ProtocolError')
    })

    it('is instanceof Error', () => {
      const error = new ProtocolError(ErrorCode.UNKNOWN, 'Unknown error')
      expect(error instanceof Error).toBe(true)
      expect(error instanceof ProtocolError).toBe(true)
    })
  })

  describe('round-trip encoding', () => {
    it('preserves data through frame round-trip', () => {
      const originalPayload = new Uint8Array([0, 1, 2, 255, 254, 253])
      const frame = createFrame(MessageType.DATA, 12345, originalPayload, FrameFlags.END_STREAM)

      const parsed = parseFrame(frame)
      expect(parsed).not.toBeNull()
      expect(parsed!.frame.header.streamId).toBe(12345)
      expect(parsed!.frame.header.flags).toBe(FrameFlags.END_STREAM)
      expect(parsed!.frame.payload).toEqual(originalPayload)
    })

    it('handles maximum stream ID', () => {
      const frame = createFrame(MessageType.PING, 0xffffffff, new Uint8Array(0))
      const parsed = parseFrame(frame)
      expect(parsed!.frame.header.streamId).toBe(0xffffffff)
    })

    it('handles all message types in frames', () => {
      const messageTypes = [
        MessageType.HELLO,
        MessageType.PING,
        MessageType.DATA,
        MessageType.CLOSE,
        MessageType.TCP_CONNECT,
        MessageType.DNS_QUERY,
        MessageType.HTTP_REQUEST,
        MessageType.FS_OPEN,
        MessageType.ERROR,
      ]

      for (const type of messageTypes) {
        const frame = createFrame(type, 1, new Uint8Array([1, 2, 3]))
        const parsed = parseFrame(frame)
        expect(parsed!.frame.header.type).toBe(type)
      }
    })
  })
})
