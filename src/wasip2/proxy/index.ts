/**
 * Proxy Protocol and Implementation
 *
 * Provides WebSocket-based proxying for WASI operations from browsers
 * to a server that has actual network/filesystem access.
 *
 * @module proxy
 *
 * @example Browser client usage
 * ```typescript
 * import { createProxyClient, StreamType } from '@tegmentum/wasip2-polyfill/proxy'
 *
 * const client = createProxyClient({
 *   url: 'wss://proxy.example.com/proxy'
 * })
 *
 * await client.connect()
 *
 * // Open a TCP stream
 * const stream = await client.openStream({
 *   streamType: StreamType.TCP
 * })
 *
 * // Send TCP connect request
 * await stream.write(encodeTcpConnect({ host: 'example.com', port: 80 }))
 * ```
 *
 * @example Server usage (Node.js)
 * ```typescript
 * import { createProxyServer, createTcpAdapter, createDnsAdapter } from '@tegmentum/wasip2-polyfill/proxy'
 *
 * const server = createProxyServer({
 *   port: 8080,
 *   host: '0.0.0.0'
 * })
 *
 * server.registerAdapter('tcp', createTcpAdapter({
 *   allowedHosts: ['*.example.com']
 * }))
 *
 * server.registerAdapter('dns', createDnsAdapter())
 *
 * await server.start()
 * ```
 */

// Protocol types and constants
export {
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

  // Types
  type FrameHeader,
  type Frame,
  type HelloPayload,
  type HelloAckPayload,
  type GoawayPayload,
  type OpenPayload,
  type OpenAckPayload,
  type ClosePayload,
  type WindowUpdatePayload,
  type TcpConnectPayload,
  type TcpConnectAckPayload,
  type TcpListenPayload,
  type TcpAcceptPayload,
  type TcpShutdownPayload,
  type UdpBindPayload,
  type UdpBindAckPayload,
  type UdpSendtoPayload,
  type UdpRecvfromPayload,
  type DnsQueryPayload,
  type DnsResponsePayload,
  type HttpRequestPayload,
  type HttpResponseHeadPayload,
  type HttpResponseTrailersPayload,
  type FsOpenPayload,
  type FsOpenAckPayload,
  type FsReadPayload,
  type FsReadAckPayload,
  type FsWritePayload,
  type FsWriteAckPayload,
  type FsStatPayload,
  type FsStatAckPayload,
  type FsReaddirPayload,
  type FsReaddirAckPayload,
  type FsClosePayload,
  type FsUnlinkPayload,
  type FsMkdirPayload,
  type FsRmdirPayload,
  type FsRenamePayload,
  type ErrorPayload,

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
} from './protocol.js'

// Client (browser-side)
export {
  ProxyClient,
  ProxyStream,
  createProxyClient,
  ConnectionState,
  type ProxyClientConfig,
  type StreamConfig,
  type ConnectionEvents,
} from './client.js'

// Server (Node.js-side)
export {
  ProxyServer,
  ClientConnection,
  ServerStream,
  createProxyServer,
  type ProxyServerConfig,
  type StreamAdapter,
  type AdapterRegistry,
  type ServerEvents,
} from './server.js'

// Adapters
export {
  TcpAdapter,
  createTcpAdapter,
  type TcpAdapterConfig,
  DnsAdapter,
  createDnsAdapter,
  type DnsAdapterConfig,
  HttpAdapter,
  createHttpAdapter,
  type HttpAdapterConfig,
  FsAdapter,
  createFsAdapter,
  type FsAdapterConfig,
} from './adapters/index.js'
