/**
 * UDP Adapter for WASI sockets via WebSocket tunnel
 *
 * Adapts the WsTunnelManager to provide wasi:sockets/udp compatible
 * datagram operations. This allows existing WASI UDP code to work
 * transparently through the WebSocket gateway.
 *
 * Note: Unlike TCP, UDP is connectionless. Each datagram is sent
 * independently and may include destination address information.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  PollableRegistry,
  globalPollableRegistry,
  createReadyPollable,
} from '../io/pollable.js'
import {
  type IpSocketAddress,
  type IpAddressFamily,
  type IncomingDatagram,
  type OutgoingDatagram,
  NetworkErrorCode,
  UdpState,
} from '../sockets/types.js'
import {
  WsTunnelManager,
  TunnelRegistry,
  globalTunnelRegistry,
  type TunnelConfig,
} from './tunnel-manager.js'

/**
 * Tunneled UDP socket
 */
export interface TunneledUdpSocket {
  /** Socket handle */
  handle: number
  /** Socket state */
  state: UdpState
  /** Tunnel manager */
  tunnel: WsTunnelManager
  /** Stream ID in the tunnel (for connected mode) */
  streamId?: number
  /** Address family */
  family: IpAddressFamily
  /** Local address (bound) */
  localAddress?: IpSocketAddress
  /** Remote address (connected mode) */
  remoteAddress?: IpSocketAddress
  /** Unicast hop limit */
  unicastHopLimit: number
  /** Receive buffer size */
  receiveBufferSize: bigint
  /** Send buffer size */
  sendBufferSize: bigint
  /** Last error */
  lastError?: NetworkErrorCode
  /** Incoming datagram queue */
  incomingQueue: DatagramQueue
}

/**
 * Datagram with address information
 */
interface QueuedDatagram {
  data: Uint8Array
  remoteAddress: IpSocketAddress
}

/**
 * Queue for incoming datagrams
 */
class DatagramQueue {
  private readonly datagrams: QueuedDatagram[] = []
  private readonly maxSize: number
  private closed = false

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize
  }

  get length(): number {
    return this.datagrams.length
  }

  get isEmpty(): boolean {
    return this.datagrams.length === 0
  }

  get isClosed(): boolean {
    return this.closed
  }

  push(datagram: QueuedDatagram): boolean {
    if (this.closed || this.datagrams.length >= this.maxSize) {
      return false
    }
    this.datagrams.push(datagram)
    return true
  }

  receive(maxResults: number): QueuedDatagram[] {
    const count = Math.min(maxResults, this.datagrams.length)
    return this.datagrams.splice(0, count)
  }

  close(): void {
    this.closed = true
    this.datagrams.length = 0
  }

  clear(): void {
    this.datagrams.length = 0
  }
}

/**
 * Tunneled incoming datagram stream
 */
export interface TunneledIncomingDatagramStream {
  handle: number
  socketHandle: number
}

/**
 * Tunneled outgoing datagram stream
 */
export interface TunneledOutgoingDatagramStream {
  handle: number
  socketHandle: number
}

/**
 * Registry for tunneled UDP sockets
 */
export class TunneledUdpSocketRegistry {
  private nextHandle = 1
  private readonly sockets: Map<number, TunneledUdpSocket> = new Map()

  register(socket: TunneledUdpSocket): number {
    const handle = this.nextHandle++
    socket.handle = handle
    this.sockets.set(handle, socket)
    return handle
  }

  get(handle: number): TunneledUdpSocket | undefined {
    return this.sockets.get(handle)
  }

  drop(handle: number): boolean {
    const socket = this.sockets.get(handle)
    if (socket) {
      // Close the stream if connected
      if (socket.streamId !== undefined && socket.tunnel) {
        socket.tunnel.closeStream(socket.streamId)
      }
      socket.incomingQueue.close()
      return this.sockets.delete(handle)
    }
    return false
  }

  clear(): void {
    for (const socket of this.sockets.values()) {
      if (socket.streamId !== undefined && socket.tunnel) {
        socket.tunnel.closeStream(socket.streamId)
      }
      socket.incomingQueue.close()
    }
    this.sockets.clear()
  }
}

/**
 * Registry for datagram streams
 */
export class TunneledDatagramStreamRegistry {
  private nextHandle = 1
  private readonly incomingStreams: Map<number, TunneledIncomingDatagramStream> = new Map()
  private readonly outgoingStreams: Map<number, TunneledOutgoingDatagramStream> = new Map()

  registerIncoming(stream: TunneledIncomingDatagramStream): number {
    const handle = this.nextHandle++
    stream.handle = handle
    this.incomingStreams.set(handle, stream)
    return handle
  }

  registerOutgoing(stream: TunneledOutgoingDatagramStream): number {
    const handle = this.nextHandle++
    stream.handle = handle
    this.outgoingStreams.set(handle, stream)
    return handle
  }

  getIncoming(handle: number): TunneledIncomingDatagramStream | undefined {
    return this.incomingStreams.get(handle)
  }

  getOutgoing(handle: number): TunneledOutgoingDatagramStream | undefined {
    return this.outgoingStreams.get(handle)
  }

  dropIncoming(handle: number): void {
    this.incomingStreams.delete(handle)
  }

  dropOutgoing(handle: number): void {
    this.outgoingStreams.delete(handle)
  }

  clear(): void {
    this.incomingStreams.clear()
    this.outgoingStreams.clear()
  }
}

/**
 * Global tunneled UDP socket registry
 */
export const globalTunneledUdpSocketRegistry = new TunneledUdpSocketRegistry()

/**
 * Global tunneled datagram stream registry
 */
export const globalTunneledDatagramStreamRegistry = new TunneledDatagramStreamRegistry()

/**
 * Configuration for tunneled UDP plugin
 */
export interface TunneledUdpConfig {
  /** Gateway WebSocket URL */
  gatewayUrl: string

  /** Authentication token */
  authToken?: string

  /** Maximum streams per connection */
  maxStreams?: number

  /** Connection timeout in milliseconds */
  connectTimeoutMs?: number

  /** Enable flow control */
  flowControl?: boolean
}

/**
 * Convert IpSocketAddress to host string and port
 */
function ipSocketAddressToHostPort(addr: IpSocketAddress): { host: string; port: number } {
  if (addr.tag === 'ipv4') {
    return {
      host: addr.val.address.join('.'),
      port: addr.val.port,
    }
  } else {
    const parts: string[] = []
    for (const n of addr.val.address) {
      parts.push(n.toString(16))
    }
    return {
      host: parts.join(':'),
      port: addr.val.port,
    }
  }
}

/**
 * Tunneled UDP socket plugin instance
 */
class TunneledUdpInstance implements PluginInstance {
  private readonly socketRegistry: TunneledUdpSocketRegistry
  private readonly streamRegistry: TunneledDatagramStreamRegistry
  private readonly tunnelRegistry: TunnelRegistry
  private readonly pollableRegistry: PollableRegistry
  private readonly config: TunneledUdpConfig
  private tunnel: WsTunnelManager | null = null

  constructor(
    socketRegistry: TunneledUdpSocketRegistry,
    streamRegistry: TunneledDatagramStreamRegistry,
    tunnelRegistry: TunnelRegistry,
    pollableRegistry: PollableRegistry,
    config: TunneledUdpConfig
  ) {
    this.socketRegistry = socketRegistry
    this.streamRegistry = streamRegistry
    this.tunnelRegistry = tunnelRegistry
    this.pollableRegistry = pollableRegistry
    this.config = config
  }

  getImports(): Record<string, unknown> {
    return {
      // Socket lifecycle
      '[resource-drop]udp-socket': this.dropSocket.bind(this),

      // Binding and connecting
      '[method]udp-socket.start-bind': this.startBind.bind(this),
      '[method]udp-socket.finish-bind': this.finishBind.bind(this),
      '[method]udp-socket.stream': this.stream.bind(this),

      // Address queries
      '[method]udp-socket.local-address': this.localAddress.bind(this),
      '[method]udp-socket.remote-address': this.remoteAddress.bind(this),
      '[method]udp-socket.address-family': this.addressFamily.bind(this),

      // Socket options
      '[method]udp-socket.unicast-hop-limit': this.unicastHopLimit.bind(this),
      '[method]udp-socket.set-unicast-hop-limit': this.setUnicastHopLimit.bind(this),
      '[method]udp-socket.receive-buffer-size': this.receiveBufferSize.bind(this),
      '[method]udp-socket.set-receive-buffer-size': this.setReceiveBufferSize.bind(this),
      '[method]udp-socket.send-buffer-size': this.sendBufferSize.bind(this),
      '[method]udp-socket.set-send-buffer-size': this.setSendBufferSize.bind(this),

      // Subscription
      '[method]udp-socket.subscribe': this.subscribe.bind(this),

      // Incoming datagram stream
      '[resource-drop]incoming-datagram-stream': this.dropIncomingStream.bind(this),
      '[method]incoming-datagram-stream.receive': this.receive.bind(this),
      '[method]incoming-datagram-stream.subscribe': this.subscribeIncoming.bind(this),

      // Outgoing datagram stream
      '[resource-drop]outgoing-datagram-stream': this.dropOutgoingStream.bind(this),
      '[method]outgoing-datagram-stream.check-send': this.checkSend.bind(this),
      '[method]outgoing-datagram-stream.send': this.send.bind(this),
      '[method]outgoing-datagram-stream.subscribe': this.subscribeOutgoing.bind(this),
    }
  }

  destroy(): void {
    this.socketRegistry.clear()
    this.streamRegistry.clear()
  }

  /**
   * Get or create the tunnel
   */
  private async getTunnel(): Promise<WsTunnelManager | null> {
    if (!this.tunnel) {
      const tunnelConfig: TunnelConfig = {
        gatewayUrl: this.config.gatewayUrl,
      }
      if (this.config.authToken !== undefined) {
        tunnelConfig.authToken = this.config.authToken
      }
      if (this.config.maxStreams !== undefined) {
        tunnelConfig.maxStreams = this.config.maxStreams
      }
      if (this.config.connectTimeoutMs !== undefined) {
        tunnelConfig.connectTimeoutMs = this.config.connectTimeoutMs
      }
      if (this.config.flowControl !== undefined) {
        tunnelConfig.flowControl = this.config.flowControl
      }
      this.tunnel = this.tunnelRegistry.getOrCreate(tunnelConfig)
    }

    if (!this.tunnel.isConnected) {
      const connected = await this.tunnel.connect()
      if (!connected) {
        return null
      }
    }

    return this.tunnel
  }

  // Socket lifecycle

  private dropSocket(handle: number): void {
    this.socketRegistry.drop(handle)
  }

  // Binding (for UDP, bind is more of a "prepare to receive" operation)

  private startBind(
    handle: number,
    _networkHandle: number,
    localAddress: IpSocketAddress
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.state !== UdpState.Unbound) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    // Check address family matches
    if (localAddress.tag !== socket.family) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Store the local address
    socket.localAddress = localAddress
    socket.state = UdpState.Bound

    return undefined
  }

  private finishBind(handle: number): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.state !== UdpState.Bound) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    return undefined
  }

  // Stream creation

  private stream(
    handle: number,
    remoteAddress: IpSocketAddress | undefined
  ):
    | [number, number] // [incoming-datagram-stream, outgoing-datagram-stream]
    | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.state !== UdpState.Bound && socket.state !== UdpState.Connected) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    // Store remote address if provided (connected mode)
    if (remoteAddress !== undefined) {
      if (remoteAddress.tag !== socket.family) {
        return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
      }
      socket.remoteAddress = remoteAddress
      socket.state = UdpState.Connected
    }

    // Create datagram streams
    const incoming: TunneledIncomingDatagramStream = {
      handle: 0,
      socketHandle: handle,
    }
    const outgoing: TunneledOutgoingDatagramStream = {
      handle: 0,
      socketHandle: handle,
    }

    const incomingHandle = this.streamRegistry.registerIncoming(incoming)
    const outgoingHandle = this.streamRegistry.registerOutgoing(outgoing)

    return [incomingHandle, outgoingHandle]
  }

  // Address queries

  private localAddress(handle: number): IpSocketAddress | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (!socket.localAddress) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    return socket.localAddress
  }

  private remoteAddress(handle: number): IpSocketAddress | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (!socket.remoteAddress) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    return socket.remoteAddress
  }

  private addressFamily(handle: number): IpAddressFamily | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.family
  }

  // Socket options

  private unicastHopLimit(handle: number): number | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.unicastHopLimit
  }

  private setUnicastHopLimit(
    handle: number,
    value: number
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.unicastHopLimit = value
    return undefined
  }

  private receiveBufferSize(handle: number): bigint | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.receiveBufferSize
  }

  private setReceiveBufferSize(
    handle: number,
    value: bigint
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.receiveBufferSize = value
    return undefined
  }

  private sendBufferSize(handle: number): bigint | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.sendBufferSize
  }

  private setSendBufferSize(
    handle: number,
    value: bigint
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.sendBufferSize = value
    return undefined
  }

  private subscribe(_handle: number): number {
    return createReadyPollable(this.pollableRegistry)
  }

  // Incoming datagram stream methods

  private dropIncomingStream(handle: number): void {
    this.streamRegistry.dropIncoming(handle)
  }

  private receive(
    handle: number,
    maxResults: bigint
  ): IncomingDatagram[] | { tag: 'err'; val: NetworkErrorCode } {
    const stream = this.streamRegistry.getIncoming(handle)
    if (!stream) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    const socket = this.socketRegistry.get(stream.socketHandle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Get queued datagrams
    const queued = socket.incomingQueue.receive(Number(maxResults))
    return queued.map((d) => ({
      data: d.data,
      remoteAddress: d.remoteAddress,
    }))
  }

  private subscribeIncoming(_handle: number): number {
    return createReadyPollable(this.pollableRegistry)
  }

  // Outgoing datagram stream methods

  private dropOutgoingStream(handle: number): void {
    this.streamRegistry.dropOutgoing(handle)
  }

  private checkSend(handle: number): bigint | { tag: 'err'; val: NetworkErrorCode } {
    const stream = this.streamRegistry.getOutgoing(handle)
    if (!stream) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    const socket = this.socketRegistry.get(stream.socketHandle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Return max datagrams we can accept at once
    // For UDP, this is typically 1 to N datagrams
    return 64n
  }

  private async send(
    handle: number,
    datagrams: OutgoingDatagram[]
  ): Promise<bigint | { tag: 'err'; val: NetworkErrorCode }> {
    const stream = this.streamRegistry.getOutgoing(handle)
    if (!stream) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    const socket = this.socketRegistry.get(stream.socketHandle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    const tunnel = await this.getTunnel()
    if (!tunnel) {
      return { tag: 'err', val: NetworkErrorCode.ConnectionRefused }
    }

    socket.tunnel = tunnel

    let sentCount = 0n

    for (const datagram of datagrams) {
      // Determine destination
      let destAddr: IpSocketAddress | undefined = datagram.remoteAddress
      if (!destAddr && socket.remoteAddress) {
        destAddr = socket.remoteAddress
      }

      if (!destAddr) {
        // No destination specified and not connected
        return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
      }

      const { host, port } = ipSocketAddressToHostPort(destAddr)

      // For UDP, we open a stream for each unique destination or use existing
      // In a real implementation, we'd need to track UDP "associations"
      // For now, we'll send each datagram through the tunnel's UDP support
      // Note: This requires the gateway to support UDP

      // Open a UDP stream if needed
      if (socket.streamId === undefined) {
        const streamId = await tunnel.openUdpStream?.(host, port)
        if (streamId === null || streamId === undefined) {
          // UDP not supported or connection failed
          return { tag: 'err', val: NetworkErrorCode.NotSupported }
        }
        socket.streamId = streamId
      }

      // Send the datagram
      const success = tunnel.sendData(socket.streamId, datagram.data)
      if (!success) {
        break
      }

      sentCount++
    }

    return sentCount
  }

  private subscribeOutgoing(_handle: number): number {
    return createReadyPollable(this.pollableRegistry)
  }
}

/**
 * Tunneled UDP create socket plugin instance
 */
class TunneledUdpCreateSocketInstance implements PluginInstance {
  private readonly socketRegistry: TunneledUdpSocketRegistry
  private readonly tunnelRegistry: TunnelRegistry
  private readonly config: TunneledUdpConfig

  constructor(
    socketRegistry: TunneledUdpSocketRegistry,
    tunnelRegistry: TunnelRegistry,
    config: TunneledUdpConfig
  ) {
    this.socketRegistry = socketRegistry
    this.tunnelRegistry = tunnelRegistry
    this.config = config
  }

  getImports(): Record<string, unknown> {
    return {
      'create-udp-socket': this.createUdpSocket.bind(this),
    }
  }

  destroy(): void {
    // Cleanup handled by registry
  }

  private createUdpSocket(
    _networkHandle: number,
    addressFamily: IpAddressFamily
  ): number | { tag: 'err'; val: NetworkErrorCode } {
    // Validate address family
    if (addressFamily !== 'ipv4' && addressFamily !== 'ipv6') {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Create a placeholder tunnel (will be connected on first use)
    const tunnelConfig: TunnelConfig = {
      gatewayUrl: this.config.gatewayUrl,
    }
    if (this.config.authToken !== undefined) {
      tunnelConfig.authToken = this.config.authToken
    }
    if (this.config.maxStreams !== undefined) {
      tunnelConfig.maxStreams = this.config.maxStreams
    }
    if (this.config.connectTimeoutMs !== undefined) {
      tunnelConfig.connectTimeoutMs = this.config.connectTimeoutMs
    }
    if (this.config.flowControl !== undefined) {
      tunnelConfig.flowControl = this.config.flowControl
    }
    const tunnel = this.tunnelRegistry.getOrCreate(tunnelConfig)

    const socket: TunneledUdpSocket = {
      handle: 0,
      state: UdpState.Unbound,
      tunnel,
      family: addressFamily,
      unicastHopLimit: 64,
      receiveBufferSize: 65536n,
      sendBufferSize: 65536n,
      incomingQueue: new DatagramQueue(),
    }

    return this.socketRegistry.register(socket)
  }
}

/**
 * Tunneled UDP implementation
 */
export const tunneledUdpImplementation: Implementation = {
  name: 'tunneled',
  description: 'UDP via WebSocket tunnel',
  create(config: PluginConfig): PluginInstance {
    const udpConfig: TunneledUdpConfig = {
      gatewayUrl: (config.options?.['gatewayUrl'] as string) ?? 'ws://localhost:8080',
    }
    const authToken = config.options?.['authToken'] as string | undefined
    const maxStreams = config.options?.['maxStreams'] as number | undefined
    const connectTimeoutMs = config.options?.['connectTimeoutMs'] as number | undefined
    const flowControl = config.options?.['flowControl'] as boolean | undefined

    if (authToken !== undefined) {
      udpConfig.authToken = authToken
    }
    if (maxStreams !== undefined) {
      udpConfig.maxStreams = maxStreams
    }
    if (connectTimeoutMs !== undefined) {
      udpConfig.connectTimeoutMs = connectTimeoutMs
    }
    if (flowControl !== undefined) {
      udpConfig.flowControl = flowControl
    }

    return new TunneledUdpInstance(
      globalTunneledUdpSocketRegistry,
      globalTunneledDatagramStreamRegistry,
      globalTunnelRegistry,
      globalPollableRegistry,
      udpConfig
    )
  },
}

/**
 * Tunneled UDP create-socket implementation
 */
export const tunneledUdpCreateSocketImplementation: Implementation = {
  name: 'tunneled',
  description: 'UDP socket creation via WebSocket tunnel',
  create(config: PluginConfig): PluginInstance {
    const udpConfig: TunneledUdpConfig = {
      gatewayUrl: (config.options?.['gatewayUrl'] as string) ?? 'ws://localhost:8080',
    }
    const authToken = config.options?.['authToken'] as string | undefined
    const maxStreams = config.options?.['maxStreams'] as number | undefined
    const connectTimeoutMs = config.options?.['connectTimeoutMs'] as number | undefined
    const flowControl = config.options?.['flowControl'] as boolean | undefined

    if (authToken !== undefined) {
      udpConfig.authToken = authToken
    }
    if (maxStreams !== undefined) {
      udpConfig.maxStreams = maxStreams
    }
    if (connectTimeoutMs !== undefined) {
      udpConfig.connectTimeoutMs = connectTimeoutMs
    }
    if (flowControl !== undefined) {
      udpConfig.flowControl = flowControl
    }

    return new TunneledUdpCreateSocketInstance(
      globalTunneledUdpSocketRegistry,
      globalTunnelRegistry,
      udpConfig
    )
  },
}
