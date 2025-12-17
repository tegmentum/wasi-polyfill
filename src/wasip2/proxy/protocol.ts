/**
 * Proxy Protocol Specification v1
 *
 * Binary WebSocket protocol for multiplexing WASI operations from browser
 * to a proxy server that has actual network/filesystem access.
 *
 * Features:
 * - Stream multiplexing over single WebSocket connection
 * - Support for TCP, UDP, DNS, HTTP, and filesystem operations
 * - Binary framing with 16-byte headers
 * - Flow control via window updates
 * - Graceful and abrupt stream closure
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Protocol magic bytes: "KSW1" (KASM WebSocket v1)
 */
export const PROTOCOL_MAGIC = 0x3157534b // 'KSW1' in little-endian

/**
 * Current protocol version
 */
export const PROTOCOL_VERSION = 1

/**
 * Frame header size in bytes
 */
export const HEADER_SIZE = 16

/**
 * Maximum payload size (16 MB)
 */
export const MAX_PAYLOAD_SIZE = 16 * 1024 * 1024

/**
 * Default window size for flow control (64 KB)
 */
export const DEFAULT_WINDOW_SIZE = 64 * 1024

// =============================================================================
// Message Types
// =============================================================================

/**
 * Message type identifiers
 */
export enum MessageType {
  // Connection management (0x00-0x0F)
  HELLO = 0x00,
  HELLO_ACK = 0x01,
  PING = 0x02,
  PONG = 0x03,
  GOAWAY = 0x04,

  // Stream management (0x10-0x1F)
  OPEN = 0x10,
  OPEN_ACK = 0x11,
  DATA = 0x12,
  DATA_ACK = 0x13,
  CLOSE = 0x14,
  RESET = 0x15,
  WINDOW_UPDATE = 0x16,

  // TCP operations (0x20-0x2F)
  TCP_CONNECT = 0x20,
  TCP_CONNECT_ACK = 0x21,
  TCP_LISTEN = 0x22,
  TCP_ACCEPT = 0x23,
  TCP_SHUTDOWN = 0x24,

  // UDP operations (0x30-0x3F)
  UDP_BIND = 0x30,
  UDP_BIND_ACK = 0x31,
  UDP_SENDTO = 0x32,
  UDP_RECVFROM = 0x33,

  // DNS operations (0x40-0x4F)
  DNS_QUERY = 0x40,
  DNS_RESPONSE = 0x41,

  // HTTP operations (0x50-0x5F)
  HTTP_REQUEST = 0x50,
  HTTP_RESPONSE_HEAD = 0x51,
  HTTP_RESPONSE_BODY = 0x52,
  HTTP_RESPONSE_TRAILERS = 0x53,

  // Filesystem operations (0x60-0x6F)
  FS_OPEN = 0x60,
  FS_OPEN_ACK = 0x61,
  FS_READ = 0x62,
  FS_READ_ACK = 0x63,
  FS_WRITE = 0x64,
  FS_WRITE_ACK = 0x65,
  FS_STAT = 0x66,
  FS_STAT_ACK = 0x67,
  FS_READDIR = 0x68,
  FS_READDIR_ACK = 0x69,
  FS_CLOSE = 0x6a,
  FS_UNLINK = 0x6b,
  FS_MKDIR = 0x6c,
  FS_RMDIR = 0x6d,
  FS_RENAME = 0x6e,

  // Error (0xFF)
  ERROR = 0xff,
}

// =============================================================================
// Flags
// =============================================================================

/**
 * Frame flags (bit field)
 */
export enum FrameFlags {
  NONE = 0x00,
  END_STREAM = 0x01, // Final frame for this stream
  ACK = 0x02, // Acknowledgment
  COMPRESSED = 0x04, // Payload is compressed
  PRIORITY = 0x08, // Priority frame
}

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Protocol error codes
 */
export enum ErrorCode {
  OK = 0,
  UNKNOWN = 1,
  PROTOCOL_ERROR = 2,
  INTERNAL_ERROR = 3,
  FLOW_CONTROL_ERROR = 4,
  STREAM_CLOSED = 5,
  FRAME_SIZE_ERROR = 6,
  REFUSED_STREAM = 7,
  CANCEL = 8,
  TIMEOUT = 9,
  CONNECT_ERROR = 10,
  DNS_ERROR = 11,
  IO_ERROR = 12,
  PERMISSION_DENIED = 13,
  NOT_FOUND = 14,
  ALREADY_EXISTS = 15,
  INVALID_ARGUMENT = 16,
  RESOURCE_EXHAUSTED = 17,
}

// =============================================================================
// Frame Header
// =============================================================================

/**
 * Frame header structure (16 bytes)
 *
 * | Offset | Size | Field       | Type  |
 * |--------|------|-------------|-------|
 * | 0      | 4    | magic       | u32   |
 * | 4      | 1    | version     | u8    |
 * | 5      | 1    | type        | u8    |
 * | 6      | 1    | flags       | u8    |
 * | 7      | 1    | reserved    | u8    |
 * | 8      | 4    | stream_id   | u32   |
 * | 12     | 4    | payload_len | u32   |
 */
export interface FrameHeader {
  magic: number
  version: number
  type: MessageType
  flags: number
  reserved: number
  streamId: number
  payloadLen: number
}

/**
 * Complete frame with header and payload
 */
export interface Frame {
  header: FrameHeader
  payload: Uint8Array
}

// =============================================================================
// Message Payloads
// =============================================================================

// Connection Management

export interface HelloPayload {
  clientVersion: number
  maxStreams: number
  initialWindowSize: number
  capabilities: string[]
}

export interface HelloAckPayload {
  serverVersion: number
  maxStreams: number
  initialWindowSize: number
  capabilities: string[]
}

export interface GoawayPayload {
  lastStreamId: number
  errorCode: ErrorCode
  debugData?: string
}

// Stream Management

export interface OpenPayload {
  streamType: StreamType
  initialWindowSize: number
}

export interface OpenAckPayload {
  windowSize: number
}

export interface ClosePayload {
  errorCode: ErrorCode
  reason?: string
}

export interface WindowUpdatePayload {
  windowIncrement: number
}

// TCP Operations

export interface TcpConnectPayload {
  host: string
  port: number
  localAddress?: string
  localPort?: number
  keepAlive?: boolean
  noDelay?: boolean
}

export interface TcpConnectAckPayload {
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
}

export interface TcpListenPayload {
  address: string
  port: number
  backlog?: number
}

export interface TcpAcceptPayload {
  remoteAddress: string
  remotePort: number
  newStreamId: number
}

export interface TcpShutdownPayload {
  read: boolean
  write: boolean
}

// UDP Operations

export interface UdpBindPayload {
  address: string
  port: number
}

export interface UdpBindAckPayload {
  localAddress: string
  localPort: number
}

export interface UdpSendtoPayload {
  remoteAddress: string
  remotePort: number
  data: Uint8Array
}

export interface UdpRecvfromPayload {
  remoteAddress: string
  remotePort: number
  data: Uint8Array
}

// DNS Operations

export interface DnsQueryPayload {
  hostname: string
  recordType: DnsRecordType
}

export interface DnsResponsePayload {
  hostname: string
  recordType: DnsRecordType
  addresses: string[]
  ttl: number
}

export enum DnsRecordType {
  A = 1,
  AAAA = 28,
  CNAME = 5,
  MX = 15,
  TXT = 16,
  SRV = 33,
}

// HTTP Operations

export interface HttpRequestPayload {
  method: string
  uri: string
  headers: Array<[string, Uint8Array]>
  hasBody: boolean
}

export interface HttpResponseHeadPayload {
  status: number
  headers: Array<[string, Uint8Array]>
  hasBody: boolean
}

export interface HttpResponseTrailersPayload {
  trailers: Array<[string, Uint8Array]>
}

// Filesystem Operations

export interface FsOpenPayload {
  path: string
  flags: FsOpenFlags
  mode?: number
}

export interface FsOpenAckPayload {
  fd: number
  fileType: FsFileType
}

export interface FsReadPayload {
  fd: number
  offset: bigint
  length: number
}

export interface FsReadAckPayload {
  data: Uint8Array
  eof: boolean
}

export interface FsWritePayload {
  fd: number
  offset: bigint
  data: Uint8Array
}

export interface FsWriteAckPayload {
  bytesWritten: number
}

export interface FsStatPayload {
  path: string
  followSymlinks: boolean
}

export interface FsStatAckPayload {
  fileType: FsFileType
  size: bigint
  mtime: bigint
  atime: bigint
  ctime: bigint
  mode: number
}

export interface FsReaddirPayload {
  path: string
}

export interface FsReaddirAckPayload {
  entries: Array<{
    name: string
    fileType: FsFileType
  }>
}

export interface FsClosePayload {
  fd: number
}

export interface FsUnlinkPayload {
  path: string
}

export interface FsMkdirPayload {
  path: string
  mode?: number
}

export interface FsRmdirPayload {
  path: string
}

export interface FsRenamePayload {
  oldPath: string
  newPath: string
}

export enum FsOpenFlags {
  READ = 0x01,
  WRITE = 0x02,
  CREATE = 0x04,
  TRUNCATE = 0x08,
  APPEND = 0x10,
  EXCLUSIVE = 0x20,
}

export enum FsFileType {
  FILE = 0,
  DIRECTORY = 1,
  SYMLINK = 2,
  OTHER = 3,
}

// Error Message

export interface ErrorPayload {
  errorCode: ErrorCode
  message: string
  details?: Record<string, unknown>
}

// =============================================================================
// Stream Types
// =============================================================================

export enum StreamType {
  CONTROL = 0,
  TCP = 1,
  UDP = 2,
  HTTP = 3,
  FILESYSTEM = 4,
}

// =============================================================================
// Encoding/Decoding
// =============================================================================

/**
 * Encode a frame header into a 16-byte buffer
 */
export function encodeHeader(header: FrameHeader): Uint8Array {
  const buffer = new Uint8Array(HEADER_SIZE)
  const view = new DataView(buffer.buffer)

  view.setUint32(0, header.magic, true) // little-endian
  view.setUint8(4, header.version)
  view.setUint8(5, header.type)
  view.setUint8(6, header.flags)
  view.setUint8(7, header.reserved)
  view.setUint32(8, header.streamId, true)
  view.setUint32(12, header.payloadLen, true)

  return buffer
}

/**
 * Decode a frame header from a 16-byte buffer
 */
export function decodeHeader(buffer: Uint8Array): FrameHeader {
  if (buffer.length < HEADER_SIZE) {
    throw new ProtocolError(ErrorCode.FRAME_SIZE_ERROR, 'Buffer too small for header')
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const magic = view.getUint32(0, true)
  if (magic !== PROTOCOL_MAGIC) {
    throw new ProtocolError(ErrorCode.PROTOCOL_ERROR, `Invalid magic: 0x${magic.toString(16)}`)
  }

  const version = view.getUint8(4)
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError(ErrorCode.PROTOCOL_ERROR, `Unsupported version: ${version}`)
  }

  return {
    magic,
    version,
    type: view.getUint8(5) as MessageType,
    flags: view.getUint8(6),
    reserved: view.getUint8(7),
    streamId: view.getUint32(8, true),
    payloadLen: view.getUint32(12, true),
  }
}

/**
 * Create a frame with header and payload
 */
export function createFrame(
  type: MessageType,
  streamId: number,
  payload: Uint8Array,
  flags: number = FrameFlags.NONE
): Uint8Array {
  const header = encodeHeader({
    magic: PROTOCOL_MAGIC,
    version: PROTOCOL_VERSION,
    type,
    flags,
    reserved: 0,
    streamId,
    payloadLen: payload.length,
  })

  const frame = new Uint8Array(HEADER_SIZE + payload.length)
  frame.set(header, 0)
  frame.set(payload, HEADER_SIZE)

  return frame
}

/**
 * Parse a complete frame from a buffer
 * Returns the frame and the number of bytes consumed
 */
export function parseFrame(buffer: Uint8Array): { frame: Frame; bytesConsumed: number } | null {
  if (buffer.length < HEADER_SIZE) {
    return null // Need more data
  }

  const header = decodeHeader(buffer)

  if (header.payloadLen > MAX_PAYLOAD_SIZE) {
    throw new ProtocolError(ErrorCode.FRAME_SIZE_ERROR, `Payload too large: ${header.payloadLen}`)
  }

  const totalSize = HEADER_SIZE + header.payloadLen
  if (buffer.length < totalSize) {
    return null // Need more data
  }

  const payload = buffer.slice(HEADER_SIZE, totalSize)

  return {
    frame: { header, payload },
    bytesConsumed: totalSize,
  }
}

// =============================================================================
// Payload Encoding/Decoding Helpers
// =============================================================================

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/**
 * Encode a string with length prefix (u32)
 */
export function encodeString(str: string): Uint8Array {
  const bytes = textEncoder.encode(str)
  const result = new Uint8Array(4 + bytes.length)
  const view = new DataView(result.buffer)
  view.setUint32(0, bytes.length, true)
  result.set(bytes, 4)
  return result
}

/**
 * Decode a length-prefixed string
 * Returns the string and bytes consumed
 */
export function decodeString(buffer: Uint8Array, offset: number = 0): { value: string; bytesRead: number } {
  if (buffer.length < offset + 4) {
    throw new ProtocolError(ErrorCode.FRAME_SIZE_ERROR, 'Buffer too small for string length')
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const length = view.getUint32(offset, true)

  if (buffer.length < offset + 4 + length) {
    throw new ProtocolError(ErrorCode.FRAME_SIZE_ERROR, 'Buffer too small for string data')
  }

  const value = textDecoder.decode(buffer.slice(offset + 4, offset + 4 + length))
  return { value, bytesRead: 4 + length }
}

/**
 * Encode bytes with length prefix (u32)
 */
export function encodeBytes(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(4 + bytes.length)
  const view = new DataView(result.buffer)
  view.setUint32(0, bytes.length, true)
  result.set(bytes, 4)
  return result
}

/**
 * Decode length-prefixed bytes
 */
export function decodeBytes(buffer: Uint8Array, offset: number = 0): { value: Uint8Array; bytesRead: number } {
  if (buffer.length < offset + 4) {
    throw new ProtocolError(ErrorCode.FRAME_SIZE_ERROR, 'Buffer too small for bytes length')
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const length = view.getUint32(offset, true)

  if (buffer.length < offset + 4 + length) {
    throw new ProtocolError(ErrorCode.FRAME_SIZE_ERROR, 'Buffer too small for bytes data')
  }

  const value = buffer.slice(offset + 4, offset + 4 + length)
  return { value, bytesRead: 4 + length }
}

// =============================================================================
// Message Payload Encoders
// =============================================================================

/**
 * Encode HELLO payload
 */
export function encodeHello(payload: HelloPayload): Uint8Array {
  const capabilities = payload.capabilities.map(encodeString)
  const capLen = capabilities.reduce((sum, c) => sum + c.length, 0)

  const result = new Uint8Array(12 + 4 + capLen)
  const view = new DataView(result.buffer)

  view.setUint32(0, payload.clientVersion, true)
  view.setUint32(4, payload.maxStreams, true)
  view.setUint32(8, payload.initialWindowSize, true)
  view.setUint32(12, payload.capabilities.length, true)

  let offset = 16
  for (const cap of capabilities) {
    result.set(cap, offset)
    offset += cap.length
  }

  return result
}

/**
 * Decode HELLO payload
 */
export function decodeHello(buffer: Uint8Array): HelloPayload {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const clientVersion = view.getUint32(0, true)
  const maxStreams = view.getUint32(4, true)
  const initialWindowSize = view.getUint32(8, true)
  const capCount = view.getUint32(12, true)

  const capabilities: string[] = []
  let offset = 16
  for (let i = 0; i < capCount; i++) {
    const { value, bytesRead } = decodeString(buffer, offset)
    capabilities.push(value)
    offset += bytesRead
  }

  return { clientVersion, maxStreams, initialWindowSize, capabilities }
}

/**
 * Encode TCP_CONNECT payload
 */
export function encodeTcpConnect(payload: TcpConnectPayload): Uint8Array {
  const hostBytes = encodeString(payload.host)
  const localAddrBytes = payload.localAddress ? encodeString(payload.localAddress) : new Uint8Array(0)

  // Flags: bit 0 = has local address, bit 1 = keepAlive, bit 2 = noDelay
  let flags = 0
  if (payload.localAddress) flags |= 0x01
  if (payload.keepAlive) flags |= 0x02
  if (payload.noDelay) flags |= 0x04

  const size = 2 + hostBytes.length + (payload.localAddress ? 2 + localAddrBytes.length : 0) + 1
  const result = new Uint8Array(size)
  const view = new DataView(result.buffer)

  let offset = 0
  view.setUint16(offset, payload.port, true)
  offset += 2
  result.set(hostBytes, offset)
  offset += hostBytes.length

  if (payload.localAddress) {
    view.setUint16(offset, payload.localPort ?? 0, true)
    offset += 2
    result.set(localAddrBytes, offset)
    offset += localAddrBytes.length
  }

  view.setUint8(offset, flags)

  return result
}

/**
 * Encode DNS_QUERY payload
 */
export function encodeDnsQuery(payload: DnsQueryPayload): Uint8Array {
  const hostnameBytes = encodeString(payload.hostname)
  const result = new Uint8Array(1 + hostnameBytes.length)
  result[0] = payload.recordType
  result.set(hostnameBytes, 1)
  return result
}

/**
 * Decode DNS_QUERY payload
 */
export function decodeDnsQuery(buffer: Uint8Array): DnsQueryPayload {
  const recordType = buffer[0] as DnsRecordType
  const { value: hostname } = decodeString(buffer, 1)
  return { hostname, recordType }
}

/**
 * Encode DNS_RESPONSE payload
 */
export function encodeDnsResponse(payload: DnsResponsePayload): Uint8Array {
  const hostnameBytes = encodeString(payload.hostname)
  const addressBytes = payload.addresses.map(encodeString)
  const addrLen = addressBytes.reduce((sum, a) => sum + a.length, 0)

  const result = new Uint8Array(1 + hostnameBytes.length + 4 + 4 + addrLen)
  const view = new DataView(result.buffer)

  let offset = 0
  result[offset] = payload.recordType
  offset += 1

  result.set(hostnameBytes, offset)
  offset += hostnameBytes.length

  view.setUint32(offset, payload.ttl, true)
  offset += 4

  view.setUint32(offset, payload.addresses.length, true)
  offset += 4

  for (const addr of addressBytes) {
    result.set(addr, offset)
    offset += addr.length
  }

  return result
}

/**
 * Decode DNS_RESPONSE payload
 */
export function decodeDnsResponse(buffer: Uint8Array): DnsResponsePayload {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  let offset = 0
  const recordType = buffer[offset] as DnsRecordType
  offset += 1

  const { value: hostname, bytesRead: hostnameLen } = decodeString(buffer, offset)
  offset += hostnameLen

  const ttl = view.getUint32(offset, true)
  offset += 4

  const addrCount = view.getUint32(offset, true)
  offset += 4

  const addresses: string[] = []
  for (let i = 0; i < addrCount; i++) {
    const { value, bytesRead } = decodeString(buffer, offset)
    addresses.push(value)
    offset += bytesRead
  }

  return { hostname, recordType, addresses, ttl }
}

/**
 * Encode ERROR payload
 */
export function encodeError(payload: ErrorPayload): Uint8Array {
  const messageBytes = encodeString(payload.message)
  const detailsStr = payload.details ? JSON.stringify(payload.details) : ''
  const detailsBytes = detailsStr ? encodeString(detailsStr) : new Uint8Array(0)

  const result = new Uint8Array(4 + messageBytes.length + detailsBytes.length)
  const view = new DataView(result.buffer)

  view.setUint32(0, payload.errorCode, true)
  result.set(messageBytes, 4)
  if (detailsBytes.length > 0) {
    result.set(detailsBytes, 4 + messageBytes.length)
  }

  return result
}

/**
 * Decode ERROR payload
 */
export function decodeError(buffer: Uint8Array): ErrorPayload {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const errorCode = view.getUint32(0, true) as ErrorCode
  const { value: message, bytesRead } = decodeString(buffer, 4)

  const result: ErrorPayload = { errorCode, message }

  if (buffer.length > 4 + bytesRead) {
    const { value: detailsStr } = decodeString(buffer, 4 + bytesRead)
    if (detailsStr) {
      result.details = JSON.parse(detailsStr)
    }
  }

  return result
}

// =============================================================================
// Protocol Error
// =============================================================================

/**
 * Protocol-specific error
 */
export class ProtocolError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ProtocolError'
  }
}

// =============================================================================
// Stream State
// =============================================================================

export enum StreamState {
  IDLE = 'idle',
  OPEN = 'open',
  HALF_CLOSED_LOCAL = 'half-closed-local',
  HALF_CLOSED_REMOTE = 'half-closed-remote',
  CLOSED = 'closed',
}
