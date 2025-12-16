/**
 * WebSocket Gateway Protocol
 *
 * Binary frame format for tunneling TCP/UDP over WebSocket.
 * Based on the KSW1 protocol specification.
 */

/**
 * Protocol magic bytes: "KSW1" (KeyStone WebSocket v1)
 */
export const PROTOCOL_MAGIC = 0x3157534b // 'KSW1' in little-endian

/**
 * Protocol version
 */
export const PROTOCOL_VERSION = 1

/**
 * Header size in bytes
 */
export const HEADER_SIZE = 16

/**
 * Message types
 */
export enum MessageType {
  /** Connection negotiation request */
  Hello = 0x01,
  /** Connection negotiation response */
  HelloAck = 0x02,

  /** Open a new stream */
  Open = 0x10,
  /** Stream opened successfully */
  OpenOk = 0x11,
  /** Stream open failed */
  OpenErr = 0x12,

  /** Data transfer */
  Data = 0x20,
  /** Data acknowledgment (flow control) */
  DataAck = 0x21,

  /** Close stream request */
  Close = 0x30,
  /** Close stream acknowledgment */
  CloseAck = 0x31,

  /** DNS query request */
  DnsQuery = 0x40,
  /** DNS query result */
  DnsResult = 0x41,
  /** DNS query error */
  DnsErr = 0x42,

  /** Ping/keepalive */
  Ping = 0xf0,
  /** Pong response */
  Pong = 0xf1,
}

/**
 * Message flags
 */
export enum MessageFlags {
  None = 0x00,
  /** End of stream (for half-close) */
  Eof = 0x01,
  /** More data follows */
  More = 0x02,
  /** Urgent/priority data */
  Urgent = 0x04,
}

/**
 * Protocol type (TCP or UDP)
 */
export enum Protocol {
  Tcp = 1,
  Udp = 2,
}

/**
 * Address kind
 */
export enum AddressKind {
  Hostname = 1,
  Ipv4 = 2,
  Ipv6 = 3,
}

/**
 * Open error codes
 */
export enum OpenError {
  /** Connection blocked by policy */
  Blocked = 1,
  /** DNS resolution failed */
  ResolveFail = 2,
  /** Connection refused */
  ConnRefused = 3,
  /** Connection timed out */
  Timeout = 4,
  /** Host unreachable */
  Unreachable = 5,
  /** Authentication required */
  AuthRequired = 6,
  /** Authentication failed */
  AuthFailed = 7,
  /** Too many streams */
  TooManyStreams = 8,
  /** Internal error */
  Internal = 9,
}

/**
 * Gateway features (negotiated in HELLO)
 */
export enum Features {
  None = 0x00,
  /** Flow control via DATA_ACK */
  FlowControl = 0x01,
  /** Half-close support */
  HalfClose = 0x02,
  /** DNS resolution support */
  Dns = 0x04,
  /** UDP support */
  Udp = 0x08,
  /** Auth token in OPEN */
  OpenToken = 0x10,
}

/**
 * Frame header structure
 */
export interface FrameHeader {
  /** Magic bytes (should be PROTOCOL_MAGIC) */
  magic: number
  /** Protocol version */
  version: number
  /** Message type */
  type: MessageType
  /** Message flags */
  flags: MessageFlags
  /** Stream ID (0 for control messages) */
  streamId: number
  /** Payload length */
  payloadLen: number
}

/**
 * HELLO payload
 */
export interface HelloPayload {
  /** Supported features */
  features: Features
  /** Maximum streams */
  maxStreams: number
  /** Auth token (optional) */
  token?: Uint8Array
}

/**
 * OPEN payload
 */
export interface OpenPayload {
  /** Protocol (TCP/UDP) */
  proto: Protocol
  /** Address kind */
  addrKind: AddressKind
  /** Port number */
  port: number
  /** Address (hostname or IP bytes) */
  addr: Uint8Array
  /** Auth token (optional) */
  token?: Uint8Array
}

/**
 * OPEN_OK payload
 */
export interface OpenOkPayload {
  /** Local address (from gateway's perspective) */
  localAddr?: Uint8Array
  /** Local port */
  localPort?: number
}

/**
 * OPEN_ERR payload
 */
export interface OpenErrPayload {
  /** Error code */
  error: OpenError
  /** Error message */
  message: string
}

/**
 * CLOSE payload
 */
export interface ClosePayload {
  /** Close reason code (0 = normal) */
  reason: number
}

/**
 * DNS_QUERY payload
 */
export interface DnsQueryPayload {
  /** Hostname to resolve */
  hostname: string
  /** Address family preference (0=any, 4=ipv4, 6=ipv6) */
  family: number
}

/**
 * DNS_RESULT payload
 */
export interface DnsResultPayload {
  /** Resolved addresses */
  addresses: Uint8Array[]
}

/**
 * DNS_ERR payload
 */
export interface DnsErrPayload {
  /** Error code */
  error: number
  /** Error message */
  message: string
}

/**
 * Encode a frame header to bytes
 */
export function encodeHeader(header: FrameHeader): Uint8Array {
  const buffer = new ArrayBuffer(HEADER_SIZE)
  const view = new DataView(buffer)

  view.setUint32(0, header.magic, true) // little-endian
  view.setUint8(4, header.version)
  view.setUint8(5, header.type)
  view.setUint8(6, header.flags)
  view.setUint8(7, 0) // reserved
  view.setUint32(8, header.streamId, true)
  view.setUint32(12, header.payloadLen, true)

  return new Uint8Array(buffer)
}

/**
 * Decode a frame header from bytes
 */
export function decodeHeader(data: Uint8Array): FrameHeader | null {
  if (data.length < HEADER_SIZE) {
    return null
  }

  const view = new DataView(data.buffer, data.byteOffset, HEADER_SIZE)

  const magic = view.getUint32(0, true)
  if (magic !== PROTOCOL_MAGIC) {
    return null
  }

  return {
    magic,
    version: view.getUint8(4),
    type: view.getUint8(5) as MessageType,
    flags: view.getUint8(6) as MessageFlags,
    streamId: view.getUint32(8, true),
    payloadLen: view.getUint32(12, true),
  }
}

/**
 * Encode an OPEN payload
 */
export function encodeOpenPayload(payload: OpenPayload): Uint8Array {
  const addrLen = payload.addr.length
  const tokenLen = payload.token?.length ?? 0
  const totalLen = 6 + addrLen + 2 + tokenLen

  const buffer = new ArrayBuffer(totalLen)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  view.setUint8(0, payload.proto)
  view.setUint8(1, payload.addrKind)
  view.setUint16(2, payload.port, true)
  view.setUint16(4, addrLen, true)
  bytes.set(payload.addr, 6)
  view.setUint16(6 + addrLen, tokenLen, true)
  if (payload.token) {
    bytes.set(payload.token, 8 + addrLen)
  }

  return bytes
}

/**
 * Decode an OPEN payload
 */
export function decodeOpenPayload(data: Uint8Array): OpenPayload | null {
  if (data.length < 8) {
    return null
  }

  const view = new DataView(data.buffer, data.byteOffset, data.length)

  const proto = view.getUint8(0) as Protocol
  const addrKind = view.getUint8(1) as AddressKind
  const port = view.getUint16(2, true)
  const addrLen = view.getUint16(4, true)

  if (data.length < 6 + addrLen + 2) {
    return null
  }

  const addr = data.slice(6, 6 + addrLen)
  const tokenLen = view.getUint16(6 + addrLen, true)

  const result: OpenPayload = {
    proto,
    addrKind,
    port,
    addr,
  }

  if (tokenLen > 0 && data.length >= 8 + addrLen + tokenLen) {
    result.token = data.slice(8 + addrLen, 8 + addrLen + tokenLen)
  }

  return result
}

/**
 * Encode an OPEN_ERR payload
 */
export function encodeOpenErrPayload(payload: OpenErrPayload): Uint8Array {
  const msgBytes = new TextEncoder().encode(payload.message)
  const buffer = new ArrayBuffer(3 + msgBytes.length)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  view.setUint8(0, payload.error)
  view.setUint16(1, msgBytes.length, true)
  bytes.set(msgBytes, 3)

  return bytes
}

/**
 * Decode an OPEN_ERR payload
 */
export function decodeOpenErrPayload(data: Uint8Array): OpenErrPayload | null {
  if (data.length < 3) {
    return null
  }

  const view = new DataView(data.buffer, data.byteOffset, data.length)

  const error = view.getUint8(0) as OpenError
  const msgLen = view.getUint16(1, true)

  if (data.length < 3 + msgLen) {
    return null
  }

  const message = new TextDecoder().decode(data.slice(3, 3 + msgLen))

  return { error, message }
}

/**
 * Create a complete frame (header + payload)
 */
export function createFrame(
  type: MessageType,
  streamId: number,
  payload: Uint8Array,
  flags: MessageFlags = MessageFlags.None
): Uint8Array {
  const header = encodeHeader({
    magic: PROTOCOL_MAGIC,
    version: PROTOCOL_VERSION,
    type,
    flags,
    streamId,
    payloadLen: payload.length,
  })

  const frame = new Uint8Array(HEADER_SIZE + payload.length)
  frame.set(header, 0)
  frame.set(payload, HEADER_SIZE)

  return frame
}

/**
 * Create a HELLO frame
 */
export function createHelloFrame(features: Features, maxStreams: number): Uint8Array {
  const payload = new ArrayBuffer(8)
  const view = new DataView(payload)
  view.setUint32(0, features, true)
  view.setUint32(4, maxStreams, true)

  return createFrame(MessageType.Hello, 0, new Uint8Array(payload))
}

/**
 * Create an OPEN frame
 */
export function createOpenFrame(streamId: number, payload: OpenPayload): Uint8Array {
  return createFrame(MessageType.Open, streamId, encodeOpenPayload(payload))
}

/**
 * Create a DATA frame
 */
export function createDataFrame(
  streamId: number,
  data: Uint8Array,
  eof: boolean = false
): Uint8Array {
  const flags = eof ? MessageFlags.Eof : MessageFlags.None
  return createFrame(MessageType.Data, streamId, data, flags)
}

/**
 * Create a CLOSE frame
 */
export function createCloseFrame(streamId: number, reason: number = 0): Uint8Array {
  const payload = new ArrayBuffer(4)
  const view = new DataView(payload)
  view.setUint32(0, reason, true)

  return createFrame(MessageType.Close, streamId, new Uint8Array(payload))
}

/**
 * Create a DATA_ACK frame (for flow control)
 */
export function createDataAckFrame(streamId: number, credit: number): Uint8Array {
  const payload = new ArrayBuffer(4)
  const view = new DataView(payload)
  view.setUint32(0, credit, true)

  return createFrame(MessageType.DataAck, streamId, new Uint8Array(payload))
}

/**
 * Encode a DNS_QUERY payload
 */
export function encodeDnsQueryPayload(payload: DnsQueryPayload): Uint8Array {
  const hostnameBytes = new TextEncoder().encode(payload.hostname)
  const buffer = new ArrayBuffer(3 + hostnameBytes.length)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  view.setUint8(0, payload.family)
  view.setUint16(1, hostnameBytes.length, true)
  bytes.set(hostnameBytes, 3)

  return bytes
}

/**
 * Decode a DNS_QUERY payload
 */
export function decodeDnsQueryPayload(data: Uint8Array): DnsQueryPayload | null {
  if (data.length < 3) {
    return null
  }

  const view = new DataView(data.buffer, data.byteOffset, data.length)
  const family = view.getUint8(0)
  const hostnameLen = view.getUint16(1, true)

  if (data.length < 3 + hostnameLen) {
    return null
  }

  const hostname = new TextDecoder().decode(data.slice(3, 3 + hostnameLen))

  return { hostname, family }
}

/**
 * Decode a DNS_RESULT payload
 */
export function decodeDnsResultPayload(data: Uint8Array): DnsResultPayload | null {
  if (data.length < 2) {
    return null
  }

  const view = new DataView(data.buffer, data.byteOffset, data.length)
  const addressCount = view.getUint16(0, true)

  const addresses: Uint8Array[] = []
  let offset = 2

  for (let i = 0; i < addressCount; i++) {
    if (offset + 2 > data.length) {
      return null
    }

    const addrLen = view.getUint16(offset, true)
    offset += 2

    if (offset + addrLen > data.length) {
      return null
    }

    addresses.push(data.slice(offset, offset + addrLen))
    offset += addrLen
  }

  return { addresses }
}

/**
 * Decode a DNS_ERR payload
 */
export function decodeDnsErrPayload(data: Uint8Array): DnsErrPayload | null {
  if (data.length < 3) {
    return null
  }

  const view = new DataView(data.buffer, data.byteOffset, data.length)
  const error = view.getUint8(0)
  const msgLen = view.getUint16(1, true)

  if (data.length < 3 + msgLen) {
    return null
  }

  const message = new TextDecoder().decode(data.slice(3, 3 + msgLen))

  return { error, message }
}

/**
 * Create a DNS_QUERY frame
 */
export function createDnsQueryFrame(queryId: number, payload: DnsQueryPayload): Uint8Array {
  return createFrame(MessageType.DnsQuery, queryId, encodeDnsQueryPayload(payload))
}

/**
 * Map OpenError to WASI socket error
 */
export function mapOpenErrorToWasi(error: OpenError): string {
  switch (error) {
    case OpenError.Blocked:
      return 'access-denied'
    case OpenError.ResolveFail:
      return 'name-unresolvable'
    case OpenError.ConnRefused:
      return 'connection-refused'
    case OpenError.Timeout:
      return 'timeout'
    case OpenError.Unreachable:
      return 'host-unreachable'
    case OpenError.AuthRequired:
    case OpenError.AuthFailed:
      return 'access-denied'
    case OpenError.TooManyStreams:
      return 'would-block'
    case OpenError.Internal:
    default:
      return 'unknown'
  }
}

/**
 * DNS error codes
 */
export enum DnsError {
  /** No error */
  NoError = 0,
  /** Format error */
  FormatError = 1,
  /** Server failure */
  ServerFailure = 2,
  /** Name does not exist */
  NxDomain = 3,
  /** Not implemented */
  NotImplemented = 4,
  /** Refused */
  Refused = 5,
  /** Timeout */
  Timeout = 6,
}
