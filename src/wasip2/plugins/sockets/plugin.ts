/**
 * wasi:sockets plugin definitions
 *
 * Includes:
 * - wasi:sockets/network - Network resource type
 * - wasi:sockets/instance-network - Get instance network
 * - wasi:sockets/ip-name-lookup - DNS resolution
 * - wasi:sockets/tcp - TCP socket operations
 * - wasi:sockets/tcp-create-socket - Create TCP sockets
 * - wasi:sockets/udp - UDP socket operations
 * - wasi:sockets/udp-create-socket - Create UDP sockets
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import {
  virtualNetworkImplementation,
  virtualInstanceNetworkImplementation,
} from './network.js'
import {
  virtualIpNameLookupImplementation,
  dohIpNameLookupImplementation,
  stubIpNameLookupImplementation,
} from './ip-name-lookup.js'
import {
  virtualTcpImplementation,
  virtualTcpCreateSocketImplementation,
} from './tcp.js'
import {
  virtualUdpImplementation,
  virtualUdpCreateSocketImplementation,
} from './udp.js'
// ws-gateway tunnel adapters, registered here as the opt-in `tunneled`
// implementation so the real TCP/UDP/DNS path is selectable on the standard
// sockets plugins (it relays through a WebSocket gateway; see ws-gateway). The
// adapters import only sockets/types, so this does not create an import cycle.
import {
  tunneledTcpImplementation,
  tunneledTcpCreateSocketImplementation,
} from '../ws-gateway/tcp-adapter.js'
import {
  tunneledUdpImplementation,
  tunneledUdpCreateSocketImplementation,
} from '../ws-gateway/udp-adapter.js'
import { tunneledDnsLookupImplementation } from '../ws-gateway/dns-adapter.js'

/**
 * WASI network interface definition
 */
export const NETWORK_INTERFACE: WasiInterface = {
  package: 'wasi:sockets',
  name: 'network',
  version: '0.2.6',
}

/**
 * WASI instance-network interface definition
 */
export const INSTANCE_NETWORK_INTERFACE: WasiInterface = {
  package: 'wasi:sockets',
  name: 'instance-network',
  version: '0.2.6',
}

/**
 * WASI ip-name-lookup interface definition
 */
export const IP_NAME_LOOKUP_INTERFACE: WasiInterface = {
  package: 'wasi:sockets',
  name: 'ip-name-lookup',
  version: '0.2.6',
}

/**
 * WASI tcp interface definition
 */
export const TCP_INTERFACE: WasiInterface = {
  package: 'wasi:sockets',
  name: 'tcp',
  version: '0.2.6',
}

/**
 * WASI tcp-create-socket interface definition
 */
export const TCP_CREATE_SOCKET_INTERFACE: WasiInterface = {
  package: 'wasi:sockets',
  name: 'tcp-create-socket',
  version: '0.2.6',
}

/**
 * WASI udp interface definition
 */
export const UDP_INTERFACE: WasiInterface = {
  package: 'wasi:sockets',
  name: 'udp',
  version: '0.2.6',
}

/**
 * WASI udp-create-socket interface definition
 */
export const UDP_CREATE_SOCKET_INTERFACE: WasiInterface = {
  package: 'wasi:sockets',
  name: 'udp-create-socket',
  version: '0.2.6',
}

/**
 * wasi:sockets/network plugin
 *
 * Provides the network resource type.
 */
export const networkPlugin: WasiPlugin = createPlugin(
  NETWORK_INTERFACE,
  {
    virtual: virtualNetworkImplementation,
  },
  'virtual'
)

/**
 * wasi:sockets/instance-network plugin
 *
 * Provides access to the instance's network capability.
 */
export const instanceNetworkPlugin: WasiPlugin = createPlugin(
  INSTANCE_NETWORK_INTERFACE,
  {
    virtual: virtualInstanceNetworkImplementation,
  },
  'virtual'
)

/**
 * wasi:sockets/ip-name-lookup plugin
 *
 * Provides DNS resolution capabilities.
 */
export const ipNameLookupPlugin: WasiPlugin = createPlugin(
  IP_NAME_LOOKUP_INTERFACE,
  {
    virtual: virtualIpNameLookupImplementation,
    doh: dohIpNameLookupImplementation,
    stub: stubIpNameLookupImplementation,
    tunneled: tunneledDnsLookupImplementation,
  },
  'virtual'
)

/**
 * wasi:sockets/tcp plugin
 *
 * Provides TCP socket operations.
 *
 * Implementations:
 * - virtual: in-process loopback (default; no real network egress)
 * - tunneled: real TCP relayed through a WebSocket gateway (ws-gateway)
 */
export const tcpPlugin: WasiPlugin = createPlugin(
  TCP_INTERFACE,
  {
    virtual: virtualTcpImplementation,
    tunneled: tunneledTcpImplementation,
  },
  'virtual'
)

/**
 * wasi:sockets/tcp-create-socket plugin
 *
 * Provides TCP socket creation.
 *
 * Implementations: `virtual` (default) and `tunneled` (ws-gateway).
 */
export const tcpCreateSocketPlugin: WasiPlugin = createPlugin(
  TCP_CREATE_SOCKET_INTERFACE,
  {
    virtual: virtualTcpCreateSocketImplementation,
    tunneled: tunneledTcpCreateSocketImplementation,
  },
  'virtual'
)

/**
 * wasi:sockets/udp plugin
 *
 * Provides UDP socket operations.
 *
 * Implementations:
 * - virtual: in-process loopback (default; no real network egress)
 * - tunneled: real UDP send relayed through a WebSocket gateway (ws-gateway).
 *   Note: inbound datagram *receive* over the tunnel is not yet delivered
 *   (protocol limitation — see REMEDIATION-PLAN 2.7); send works.
 */
export const udpPlugin: WasiPlugin = createPlugin(
  UDP_INTERFACE,
  {
    virtual: virtualUdpImplementation,
    tunneled: tunneledUdpImplementation,
  },
  'virtual'
)

/**
 * wasi:sockets/udp-create-socket plugin
 *
 * Provides UDP socket creation.
 *
 * Implementations: `virtual` (default) and `tunneled` (ws-gateway).
 */
export const udpCreateSocketPlugin: WasiPlugin = createPlugin(
  UDP_CREATE_SOCKET_INTERFACE,
  {
    virtual: virtualUdpCreateSocketImplementation,
    tunneled: tunneledUdpCreateSocketImplementation,
  },
  'virtual'
)

/**
 * All socket plugins for convenient registration
 */
export const socketPlugins: WasiPlugin[] = [
  networkPlugin,
  instanceNetworkPlugin,
  ipNameLookupPlugin,
  tcpPlugin,
  tcpCreateSocketPlugin,
  udpPlugin,
  udpCreateSocketPlugin,
]
