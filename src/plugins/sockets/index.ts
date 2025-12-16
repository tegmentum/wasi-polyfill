/**
 * wasi:sockets plugin
 *
 * Provides networking functionality including:
 * - Network resource management
 * - DNS resolution
 * - TCP sockets
 * - UDP sockets
 *
 * Note: In browser environments, raw TCP/UDP sockets are not available.
 * The virtual implementations provide the API surface but return
 * NotSupported errors for actual network operations. For real networking,
 * a WebSocket proxy would be needed.
 *
 * Interfaces:
 * - wasi:sockets/network - Network resource type
 * - wasi:sockets/instance-network - instance-network() -> network
 * - wasi:sockets/ip-name-lookup - resolve-addresses(network, name) -> stream
 * - wasi:sockets/tcp - TCP socket operations
 * - wasi:sockets/tcp-create-socket - create-tcp-socket(network, family) -> socket
 * - wasi:sockets/udp - UDP socket operations
 * - wasi:sockets/udp-create-socket - create-udp-socket(network, family) -> socket
 */

// Plugin exports
export {
  networkPlugin,
  instanceNetworkPlugin,
  ipNameLookupPlugin,
  tcpPlugin,
  tcpCreateSocketPlugin,
  udpPlugin,
  udpCreateSocketPlugin,
  socketPlugins,
  NETWORK_INTERFACE,
  INSTANCE_NETWORK_INTERFACE,
  IP_NAME_LOOKUP_INTERFACE,
  TCP_INTERFACE,
  TCP_CREATE_SOCKET_INTERFACE,
  UDP_INTERFACE,
  UDP_CREATE_SOCKET_INTERFACE,
} from './plugin.js'

// Types
export {
  NetworkErrorCode,
  IpAddressFamily,
  ShutdownType,
  TcpState,
  UdpState,
  SocketError,
  parseIpv4,
  parseIpv6,
  formatIpv4,
  formatIpv6,
  formatIpAddress,
  formatSocketAddress,
  isLoopback,
  isAny,
  anyAddress,
  loopbackAddress,
} from './types.js'
export type {
  Ipv4Address,
  Ipv6Address,
  IpAddress,
  Ipv4SocketAddress,
  Ipv6SocketAddress,
  IpSocketAddress,
  Network,
  IncomingDatagram,
  OutgoingDatagram,
  ResolveAddressEntry,
} from './types.js'

// Network
export type { NetworkConfig } from './network.js'
export {
  NetworkRegistry,
  NetworkInstance,
  globalNetworkRegistry,
  virtualNetworkImplementation,
  virtualInstanceNetworkImplementation,
} from './network.js'

// IP Name Lookup
export type { IpNameLookupConfig, ResolveAddressStream } from './ip-name-lookup.js'
export {
  ResolveAddressStreamRegistry,
  globalResolveAddressStreamRegistry,
  virtualIpNameLookupImplementation,
  dohIpNameLookupImplementation,
  stubIpNameLookupImplementation,
  // DoH providers and defaults
  DOH_PROVIDERS,
  DEFAULT_DOH_RESOLVER,
  DnsRecordType,
} from './ip-name-lookup.js'

// TCP
export type { TcpSocket } from './tcp.js'
export {
  TcpSocketRegistry,
  globalTcpSocketRegistry,
  virtualTcpImplementation,
  virtualTcpCreateSocketImplementation,
} from './tcp.js'

// UDP
export type { UdpSocket, IncomingDatagramStream, OutgoingDatagramStream } from './udp.js'
export {
  UdpSocketRegistry,
  DatagramStreamRegistry,
  globalUdpSocketRegistry,
  globalDatagramStreamRegistry,
  virtualUdpImplementation,
  virtualUdpCreateSocketImplementation,
} from './udp.js'
