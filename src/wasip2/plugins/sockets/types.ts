/**
 * Socket types for wasi:sockets interfaces
 *
 * Defines types, error codes, and utilities for socket operations.
 * Based on WASI P2 sockets specification.
 */

/**
 * Network error codes as defined in WASI sockets
 */
export enum NetworkErrorCode {
  /** Unknown error */
  Unknown = 'unknown',
  /** Access denied */
  AccessDenied = 'access-denied',
  /** Operation not supported */
  NotSupported = 'not-supported',
  /** Invalid argument */
  InvalidArgument = 'invalid-argument',
  /** Out of memory */
  OutOfMemory = 'out-of-memory',
  /** Operation timed out */
  Timeout = 'timeout',
  /** Concurrency conflict */
  ConcurrencyConflict = 'concurrency-conflict',
  /** Not in progress */
  NotInProgress = 'not-in-progress',
  /** Would block */
  WouldBlock = 'would-block',
  /** Invalid state */
  InvalidState = 'invalid-state',
  /** New socket limit reached */
  NewSocketLimit = 'new-socket-limit',
  /** Address not bindable */
  AddressNotBindable = 'address-not-bindable',
  /** Address in use */
  AddressInUse = 'address-in-use',
  /** Remote unreachable */
  RemoteUnreachable = 'remote-unreachable',
  /** Connection refused */
  ConnectionRefused = 'connection-refused',
  /** Connection reset */
  ConnectionReset = 'connection-reset',
  /** Connection aborted */
  ConnectionAborted = 'connection-aborted',
  /** Datagram too large */
  DatagramTooLarge = 'datagram-too-large',
  /** Name unresolvable */
  NameUnresolvable = 'name-unresolvable',
  /** Temporary resolver failure */
  TemporaryResolverFailure = 'temporary-resolver-failure',
  /** Permanent resolver failure */
  PermanentResolverFailure = 'permanent-resolver-failure',
}

/**
 * IP address family
 */
export enum IpAddressFamily {
  /** IPv4 */
  Ipv4 = 'ipv4',
  /** IPv6 */
  Ipv6 = 'ipv6',
}

/**
 * IPv4 address (4 bytes)
 */
export type Ipv4Address = [number, number, number, number]

/**
 * IPv6 address (8 x 16-bit values)
 */
export type Ipv6Address = [number, number, number, number, number, number, number, number]

/**
 * IP address (either v4 or v6)
 */
export type IpAddress =
  | { tag: 'ipv4'; val: Ipv4Address }
  | { tag: 'ipv6'; val: Ipv6Address }

/**
 * IPv4 socket address
 */
export interface Ipv4SocketAddress {
  /** Port number */
  port: number
  /** IPv4 address */
  address: Ipv4Address
}

/**
 * IPv6 socket address
 */
export interface Ipv6SocketAddress {
  /** Port number */
  port: number
  /** Flow info */
  flowInfo: number
  /** IPv6 address */
  address: Ipv6Address
  /** Scope ID */
  scopeId: number
}

/**
 * IP socket address (either v4 or v6)
 */
export type IpSocketAddress =
  | { tag: 'ipv4'; val: Ipv4SocketAddress }
  | { tag: 'ipv6'; val: Ipv6SocketAddress }

/**
 * Shutdown type for sockets
 */
export enum ShutdownType {
  /** Stop receiving */
  Receive = 'receive',
  /** Stop sending */
  Send = 'send',
  /** Stop both */
  Both = 'both',
}

/**
 * Socket error with code
 */
export class SocketError extends Error {
  constructor(
    public readonly code: NetworkErrorCode,
    message?: string
  ) {
    super(message ?? `Socket error: ${code}`)
    this.name = 'SocketError'
  }
}

/**
 * Network resource handle
 */
export interface Network {
  handle: number
}

/**
 * TCP socket state
 */
export enum TcpState {
  /** Socket created but not bound or connected */
  Unbound = 'unbound',
  /** Socket bound to local address */
  Bound = 'bound',
  /** Socket is listening for connections */
  Listening = 'listening',
  /** Connection in progress */
  Connecting = 'connecting',
  /** Socket is connected */
  Connected = 'connected',
  /** Socket has been closed */
  Closed = 'closed',
}

/**
 * UDP socket state
 */
export enum UdpState {
  /** Socket created but not bound */
  Unbound = 'unbound',
  /** Socket bound to local address */
  Bound = 'bound',
  /** Socket is connected (for send/receive) */
  Connected = 'connected',
  /** Socket has been closed */
  Closed = 'closed',
}

/**
 * Incoming datagram with source address
 */
export interface IncomingDatagram {
  /** Datagram data */
  data: Uint8Array
  /** Remote address */
  remoteAddress: IpSocketAddress
}

/**
 * Outgoing datagram with optional destination
 */
export interface OutgoingDatagram {
  /** Datagram data */
  data: Uint8Array
  /** Remote address (optional if socket is connected) */
  remoteAddress?: IpSocketAddress
}

/**
 * Resolve address result entry
 */
export interface ResolveAddressEntry {
  /** Resolved IP address */
  address: IpAddress
}

/**
 * Parse IPv4 address string
 */
export function parseIpv4(str: string): Ipv4Address | null {
  const parts = str.split('.')
  if (parts.length !== 4) return null

  const bytes: number[] = []
  for (const part of parts) {
    const num = parseInt(part, 10)
    if (isNaN(num) || num < 0 || num > 255) return null
    bytes.push(num)
  }

  return bytes as Ipv4Address
}

/**
 * Format IPv4 address to string
 */
export function formatIpv4(addr: Ipv4Address): string {
  return addr.join('.')
}

/**
 * Parse IPv6 address string (simplified, handles common formats)
 */
export function parseIpv6(str: string): Ipv6Address | null {
  // Handle :: expansion
  let parts: string[]

  if (str.includes('::')) {
    const [left, right] = str.split('::')
    const leftParts = left ? left.split(':') : []
    const rightParts = right ? right.split(':') : []
    const missing = 8 - leftParts.length - rightParts.length
    if (missing < 0) return null

    parts = [...leftParts, ...Array(missing).fill('0'), ...rightParts]
  } else {
    parts = str.split(':')
  }

  if (parts.length !== 8) return null

  const values: number[] = []
  for (const part of parts) {
    const num = parseInt(part || '0', 16)
    if (isNaN(num) || num < 0 || num > 0xffff) return null
    values.push(num)
  }

  return values as Ipv6Address
}

/**
 * Format IPv6 address to string
 */
export function formatIpv6(addr: Ipv6Address): string {
  return addr.map((v) => v.toString(16)).join(':')
}

/**
 * Format IP address to string
 */
export function formatIpAddress(addr: IpAddress): string {
  if (addr.tag === 'ipv4') {
    return formatIpv4(addr.val)
  } else {
    return formatIpv6(addr.val)
  }
}

/**
 * Format socket address to string
 */
export function formatSocketAddress(addr: IpSocketAddress): string {
  if (addr.tag === 'ipv4') {
    return `${formatIpv4(addr.val.address)}:${addr.val.port}`
  } else {
    return `[${formatIpv6(addr.val.address)}]:${addr.val.port}`
  }
}

/**
 * Check if address is loopback
 */
export function isLoopback(addr: IpAddress): boolean {
  if (addr.tag === 'ipv4') {
    return addr.val[0] === 127
  } else {
    // ::1
    return (
      addr.val[0] === 0 &&
      addr.val[1] === 0 &&
      addr.val[2] === 0 &&
      addr.val[3] === 0 &&
      addr.val[4] === 0 &&
      addr.val[5] === 0 &&
      addr.val[6] === 0 &&
      addr.val[7] === 1
    )
  }
}

/**
 * Check if address is any (0.0.0.0 or ::)
 */
export function isAny(addr: IpAddress): boolean {
  if (addr.tag === 'ipv4') {
    return addr.val.every((b) => b === 0)
  } else {
    return addr.val.every((b) => b === 0)
  }
}

/**
 * Create any address for the given family
 */
export function anyAddress(family: IpAddressFamily): IpAddress {
  if (family === IpAddressFamily.Ipv4) {
    return { tag: 'ipv4', val: [0, 0, 0, 0] }
  } else {
    return { tag: 'ipv6', val: [0, 0, 0, 0, 0, 0, 0, 0] }
  }
}

/**
 * Create loopback address for the given family
 */
export function loopbackAddress(family: IpAddressFamily): IpAddress {
  if (family === IpAddressFamily.Ipv4) {
    return { tag: 'ipv4', val: [127, 0, 0, 1] }
  } else {
    return { tag: 'ipv6', val: [0, 0, 0, 0, 0, 0, 0, 1] }
  }
}
