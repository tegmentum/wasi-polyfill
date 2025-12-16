/**
 * WebSocket Gateway plugin definitions
 *
 * Provides alternative TCP/UDP implementations that route through a
 * WebSocket proxy gateway. This enables real network access from
 * browser environments where direct socket access is not available.
 *
 * The gateway plugins can be registered alongside or instead of the
 * virtual socket implementations from wasi:sockets.
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import {
  tunneledTcpImplementation,
  tunneledTcpCreateSocketImplementation,
} from './tcp-adapter.js'
import {
  tunneledUdpImplementation,
  tunneledUdpCreateSocketImplementation,
} from './udp-adapter.js'
import { tunneledDnsLookupImplementation } from './dns-adapter.js'
import {
  TCP_INTERFACE,
  TCP_CREATE_SOCKET_INTERFACE,
  UDP_INTERFACE,
  UDP_CREATE_SOCKET_INTERFACE,
  IP_NAME_LOOKUP_INTERFACE,
} from '../sockets/plugin.js'

/**
 * WebSocket Gateway TCP plugin
 *
 * Provides TCP socket operations via WebSocket tunnel.
 * Use this instead of the virtual TCP plugin when real
 * network access is required.
 *
 * Configuration options:
 * - gatewayUrl: WebSocket URL of the gateway server (required)
 * - authToken: Authentication token for the gateway
 * - maxStreams: Maximum concurrent streams per connection
 * - connectTimeoutMs: Connection timeout in milliseconds
 * - flowControl: Enable flow control (DATA_ACK messages)
 *
 * Example:
 * ```typescript
 * polyfill.register(wsGatewayTcpPlugin, {
 *   implementation: 'tunneled',
 *   options: {
 *     gatewayUrl: 'wss://gateway.example.com/ws',
 *     authToken: 'secret-token',
 *     maxStreams: 100,
 *     connectTimeoutMs: 30000,
 *   }
 * })
 * ```
 */
export const wsGatewayTcpPlugin: WasiPlugin = createPlugin(
  TCP_INTERFACE,
  {
    tunneled: tunneledTcpImplementation,
  },
  'tunneled'
)

/**
 * WebSocket Gateway TCP create-socket plugin
 *
 * Provides TCP socket creation via WebSocket tunnel.
 * Pair this with wsGatewayTcpPlugin for full TCP support.
 */
export const wsGatewayTcpCreateSocketPlugin: WasiPlugin = createPlugin(
  TCP_CREATE_SOCKET_INTERFACE,
  {
    tunneled: tunneledTcpCreateSocketImplementation,
  },
  'tunneled'
)

/**
 * Extended TCP plugin with both virtual and tunneled implementations
 *
 * Use this when you want to dynamically switch between local (virtual)
 * and remote (tunneled) socket implementations.
 *
 * Set implementation: 'virtual' for in-process testing
 * Set implementation: 'tunneled' for real network access
 */
export const EXTENDED_TCP_INTERFACE: WasiInterface = TCP_INTERFACE

/**
 * Extended TCP create-socket interface
 */
export const EXTENDED_TCP_CREATE_SOCKET_INTERFACE: WasiInterface = TCP_CREATE_SOCKET_INTERFACE

/**
 * WebSocket Gateway UDP plugin
 *
 * Provides UDP datagram operations via WebSocket tunnel.
 * Use this instead of the virtual UDP plugin when real
 * network access is required.
 *
 * Configuration options are the same as TCP:
 * - gatewayUrl: WebSocket URL of the gateway server (required)
 * - authToken: Authentication token for the gateway
 * - maxStreams: Maximum concurrent streams per connection
 * - connectTimeoutMs: Connection timeout in milliseconds
 * - flowControl: Enable flow control (DATA_ACK messages)
 */
export const wsGatewayUdpPlugin: WasiPlugin = createPlugin(
  UDP_INTERFACE,
  {
    tunneled: tunneledUdpImplementation,
  },
  'tunneled'
)

/**
 * WebSocket Gateway UDP create-socket plugin
 *
 * Provides UDP socket creation via WebSocket tunnel.
 * Pair this with wsGatewayUdpPlugin for full UDP support.
 */
export const wsGatewayUdpCreateSocketPlugin: WasiPlugin = createPlugin(
  UDP_CREATE_SOCKET_INTERFACE,
  {
    tunneled: tunneledUdpCreateSocketImplementation,
  },
  'tunneled'
)

/**
 * Extended UDP interface
 */
export const EXTENDED_UDP_INTERFACE: WasiInterface = UDP_INTERFACE

/**
 * Extended UDP create-socket interface
 */
export const EXTENDED_UDP_CREATE_SOCKET_INTERFACE: WasiInterface = UDP_CREATE_SOCKET_INTERFACE

/**
 * WebSocket Gateway DNS lookup plugin
 *
 * Provides DNS resolution via WebSocket tunnel.
 * Use this instead of the virtual ip-name-lookup plugin when real
 * DNS resolution is required.
 *
 * Configuration options:
 * - gatewayUrl: WebSocket URL of the gateway server (required)
 * - authToken: Authentication token for the gateway
 * - queryTimeoutMs: DNS query timeout in milliseconds (default: 30000)
 * - staticMappings: Static hostname->IP mappings (override gateway lookups)
 */
export const wsGatewayDnsPlugin: WasiPlugin = createPlugin(
  IP_NAME_LOOKUP_INTERFACE,
  {
    tunneled: tunneledDnsLookupImplementation,
  },
  'tunneled'
)

/**
 * Extended IP name lookup interface
 */
export const EXTENDED_IP_NAME_LOOKUP_INTERFACE: WasiInterface = IP_NAME_LOOKUP_INTERFACE

/**
 * All WebSocket Gateway plugins for convenient registration
 *
 * Includes plugins for TCP, UDP, and DNS.
 */
export const wsGatewayPlugins: WasiPlugin[] = [
  wsGatewayTcpPlugin,
  wsGatewayTcpCreateSocketPlugin,
  wsGatewayUdpPlugin,
  wsGatewayUdpCreateSocketPlugin,
  wsGatewayDnsPlugin,
]
