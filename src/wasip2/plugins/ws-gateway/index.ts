/**
 * WebSocket Gateway Plugin
 *
 * Provides TCP and UDP socket access through a WebSocket
 * proxy gateway, enabling real network connectivity in browser
 * environments where direct socket access is unavailable.
 *
 * The plugin implements the KSW1 (KeyStone WebSocket v1) protocol
 * for multiplexing multiple socket streams over a single WebSocket.
 *
 * ## Usage
 *
 * ```typescript
 * import { Polyfill } from '@tegmentum/wasi-polyfill'
 * import { wsGatewayTcpPlugin, wsGatewayTcpCreateSocketPlugin } from '@tegmentum/wasi-polyfill/plugins/ws-gateway'
 *
 * const polyfill = new Polyfill()
 *
 * // Register the gateway TCP plugins
 * polyfill.register(wsGatewayTcpPlugin, {
 *   options: {
 *     gatewayUrl: 'wss://gateway.example.com/ws',
 *     authToken: 'your-auth-token',
 *   }
 * })
 * polyfill.register(wsGatewayTcpCreateSocketPlugin, {
 *   options: {
 *     gatewayUrl: 'wss://gateway.example.com/ws',
 *   }
 * })
 *
 * // Get imports for WASM component
 * const imports = polyfill.getImports([
 *   { package: 'wasi:sockets', name: 'tcp', version: '0.2.0' },
 * ])
 * ```
 *
 * ## Direct Tunnel Usage
 *
 * For lower-level control, use the WsTunnelManager directly:
 *
 * ```typescript
 * import { WsTunnelManager } from '@tegmentum/wasi-polyfill/plugins/ws-gateway'
 *
 * const tunnel = new WsTunnelManager({
 *   gatewayUrl: 'wss://gateway.example.com/ws',
 * })
 *
 * await tunnel.connect()
 * const streamId = await tunnel.openTcpStream('example.com', 80)
 * tunnel.sendData(streamId, new TextEncoder().encode('GET / HTTP/1.0\r\n\r\n'))
 * const response = await tunnel.readDataAsync(streamId, 65536)
 * ```
 *
 * @module
 */

// Protocol types and utilities
export {
  // Constants
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  HEADER_SIZE,

  // Enums
  MessageType,
  MessageFlags,
  Protocol,
  AddressKind,
  OpenError,
  Features,

  // Frame types
  type FrameHeader,
  type HelloPayload,
  type OpenPayload,
  type OpenOkPayload,
  type OpenErrPayload,
  type ClosePayload,
  type DnsQueryPayload,
  type DnsResultPayload,
  type DnsErrPayload,

  // Encoding/decoding functions
  encodeHeader,
  decodeHeader,
  encodeOpenPayload,
  decodeOpenPayload,
  encodeOpenErrPayload,
  decodeOpenErrPayload,

  // Frame creation helpers
  createFrame,
  createHelloFrame,
  createOpenFrame,
  createDataFrame,
  createCloseFrame,
  createDataAckFrame,

  // DNS functions
  encodeDnsQueryPayload,
  decodeDnsQueryPayload,
  decodeDnsResultPayload,
  decodeDnsErrPayload,
  createDnsQueryFrame,
  DnsError,

  // Error mapping
  mapOpenErrorToWasi,
} from './protocol.js'

// Byte queue for buffering
export { ByteQueue, AsyncByteQueue } from './byte-queue.js'

// Tunnel management
export {
  WsTunnelManager,
  TunnelRegistry,
  globalTunnelRegistry,
  TunnelState,
  StreamState,
  type TunnelConfig,
  type StreamInfo,
  type DnsQueryResult,
} from './tunnel-manager.js'

// TCP adapter
export {
  TcpSocketState,
  TunneledTcpSocketRegistry,
  globalTunneledTcpSocketRegistry,
  tunneledTcpImplementation,
  tunneledTcpCreateSocketImplementation,
  type TunneledTcpSocket,
  type TunneledTcpConfig,
} from './tcp-adapter.js'

// UDP adapter
export {
  TunneledUdpSocketRegistry,
  TunneledDatagramStreamRegistry,
  globalTunneledUdpSocketRegistry,
  globalTunneledDatagramStreamRegistry,
  tunneledUdpImplementation,
  tunneledUdpCreateSocketImplementation,
  type TunneledUdpSocket,
  type TunneledIncomingDatagramStream,
  type TunneledOutgoingDatagramStream,
  type TunneledUdpConfig,
} from './udp-adapter.js'

// DNS adapter
export {
  TunneledResolveAddressStreamRegistry,
  globalTunneledResolveAddressStreamRegistry,
  tunneledDnsLookupImplementation,
  type TunneledResolveAddressStream,
  type TunneledDnsConfig,
} from './dns-adapter.js'

// Plugin definitions
export {
  wsGatewayTcpPlugin,
  wsGatewayTcpCreateSocketPlugin,
  wsGatewayUdpPlugin,
  wsGatewayUdpCreateSocketPlugin,
  wsGatewayDnsPlugin,
  wsGatewayPlugins,
  EXTENDED_TCP_INTERFACE,
  EXTENDED_TCP_CREATE_SOCKET_INTERFACE,
  EXTENDED_UDP_INTERFACE,
  EXTENDED_UDP_CREATE_SOCKET_INTERFACE,
  EXTENDED_IP_NAME_LOOKUP_INTERFACE,
} from './plugin.js'
