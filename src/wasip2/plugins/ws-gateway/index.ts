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
 *   { package: 'wasi:sockets', name: 'tcp', version: '0.2.6' },
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

  // PKCS#11 frame payloads (RPC over the gateway)
  type Pkcs11RequestPayload,
  type Pkcs11ResponsePayload,
  encodePkcs11RequestPayload,
  decodePkcs11RequestPayload,
  encodePkcs11ResponsePayload,
  decodePkcs11ResponsePayload,
  createPkcs11RequestFrame,
  createPkcs11ResponseFrame,

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

// PKCS#11 RPC codec for Pkcs11Request / Pkcs11Response frames.
// Re-exported so both the browser-side pkcs11-gateway-adapter consumers
// and the gateway server can speak the same wire format.
export * as Pkcs11Codec from './pkcs11-codec.js'
export {
  Pkcs11Fn,
  HandleKind,
  Pkcs11Status,
  AttrTag,
  type Attribute as Pkcs11Attribute,
  type AttrValue as Pkcs11AttrValue,
  type Mechanism as Pkcs11Mechanism,
  Pkcs11Writer,
  Pkcs11Reader,
  writeAttribute,
  readAttribute,
  writeMechanism,
  readMechanism,
} from './pkcs11-codec.js'

// Plugin definitions
export {
  wsGatewayTcpPlugin,
  wsGatewayTcpCreateSocketPlugin,
  wsGatewayUdpPlugin,
  wsGatewayUdpCreateSocketPlugin,
  wsGatewayDnsPlugin,
  wsGatewayPkcs11TunnelPlugin,
  wsGatewayPlugins,
  EXTENDED_TCP_INTERFACE,
  EXTENDED_TCP_CREATE_SOCKET_INTERFACE,
  EXTENDED_UDP_INTERFACE,
  EXTENDED_UDP_CREATE_SOCKET_INTERFACE,
  EXTENDED_IP_NAME_LOOKUP_INTERFACE,
  PKCS11_TUNNEL_INTERFACE,
} from './plugin.js'
