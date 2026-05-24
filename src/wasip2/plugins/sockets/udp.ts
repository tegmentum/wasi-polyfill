/**
 * UDP socket implementation for wasi:sockets/udp and wasi:sockets/udp-create-socket
 *
 * Provides UDP socket operations. In browsers, raw UDP sockets are not available,
 * so this provides a stub implementation that returns appropriate errors.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { HandleRegistry } from '../../../shared/registry.js'
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
} from './types.js'
import { globalNetworkRegistry } from './network.js'

/**
 * UDP socket resource
 */
export interface UdpSocket {
  handle: number
  state: UdpState
  family: IpAddressFamily
  localAddress?: IpSocketAddress
  remoteAddress?: IpSocketAddress
  unicastHopLimit: number
  receiveBufferSize: bigint
  sendBufferSize: bigint
}

/**
 * Incoming datagram stream resource
 */
export interface IncomingDatagramStream {
  handle: number
  socketHandle: number
}

/**
 * Outgoing datagram stream resource
 */
export interface OutgoingDatagramStream {
  handle: number
  socketHandle: number
}

/**
 * Registry for UDP sockets
 */
export class UdpSocketRegistry extends HandleRegistry<UdpSocket> {
  override register(socket: UdpSocket): number {
    const handle = super.register(socket)
    socket.handle = handle
    return handle
  }

  override drop(handle: number): boolean {
    const socket = this.get(handle)
    if (socket) {
      socket.state = UdpState.Closed
    }
    return super.drop(handle)
  }
}

/**
 * Registry for datagram streams
 */
export class DatagramStreamRegistry {
  private nextHandle = 1
  private incomingStreams = new Map<number, IncomingDatagramStream>()
  private outgoingStreams = new Map<number, OutgoingDatagramStream>()

  registerIncoming(stream: IncomingDatagramStream): number {
    const handle = this.nextHandle++
    stream.handle = handle
    this.incomingStreams.set(handle, stream)
    return handle
  }

  registerOutgoing(stream: OutgoingDatagramStream): number {
    const handle = this.nextHandle++
    stream.handle = handle
    this.outgoingStreams.set(handle, stream)
    return handle
  }

  getIncoming(handle: number): IncomingDatagramStream | undefined {
    return this.incomingStreams.get(handle)
  }

  getOutgoing(handle: number): OutgoingDatagramStream | undefined {
    return this.outgoingStreams.get(handle)
  }

  dropIncoming(handle: number): void {
    this.incomingStreams.delete(handle)
  }

  dropOutgoing(handle: number): void {
    this.outgoingStreams.delete(handle)
  }
}

/**
 * Global UDP socket registry
 */
export const globalUdpSocketRegistry = new UdpSocketRegistry()

/**
 * Global datagram stream registry
 */
export const globalDatagramStreamRegistry = new DatagramStreamRegistry()

/**
 * Create a new UDP socket with default settings
 */
function createUdpSocket(family: IpAddressFamily): UdpSocket {
  return {
    handle: 0,
    state: UdpState.Unbound,
    family,
    unicastHopLimit: 64,
    receiveBufferSize: 65536n,
    sendBufferSize: 65536n,
  }
}

/**
 * UDP socket plugin instance
 */
class UdpSocketInstance implements PluginInstance {
  private readonly socketRegistry: UdpSocketRegistry
  private readonly streamRegistry: DatagramStreamRegistry
  private readonly pollableRegistry: PollableRegistry

  constructor(
    socketRegistry: UdpSocketRegistry,
    streamRegistry: DatagramStreamRegistry,
    pollableRegistry: PollableRegistry
  ) {
    this.socketRegistry = socketRegistry
    this.streamRegistry = streamRegistry
    this.pollableRegistry = pollableRegistry
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
    // No cleanup needed
  }

  private dropSocket(handle: number): void {
    this.socketRegistry.drop(handle)
  }

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

    // In browser, we can't actually bind - store the address and pretend
    socket.localAddress = localAddress
    socket.state = UdpState.Bound

    return undefined
  }

  private finishBind(handle: number): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Bind is synchronous in our implementation
    if (socket.state !== UdpState.Bound) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    return undefined
  }

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
    if (remoteAddress) {
      if (remoteAddress.tag !== socket.family) {
        return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
      }
      socket.remoteAddress = remoteAddress
      socket.state = UdpState.Connected
    }

    // Create datagram streams
    const incoming: IncomingDatagramStream = {
      handle: 0,
      socketHandle: handle,
    }
    const outgoing: OutgoingDatagramStream = {
      handle: 0,
      socketHandle: handle,
    }

    const incomingHandle = this.streamRegistry.registerIncoming(incoming)
    const outgoingHandle = this.streamRegistry.registerOutgoing(outgoing)

    return [incomingHandle, outgoingHandle]
  }

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
    // Return a ready pollable since we can't do async operations
    return createReadyPollable(this.pollableRegistry)
  }

  // Incoming datagram stream methods

  private dropIncomingStream(handle: number): void {
    this.streamRegistry.dropIncoming(handle)
  }

  private receive(
    handle: number,
    _maxResults: bigint
  ): IncomingDatagram[] | { tag: 'err'; val: NetworkErrorCode } {
    const stream = this.streamRegistry.getIncoming(handle)
    if (!stream) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // UDP receive is not supported in browser - return empty
    return []
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

    // Return 0 to indicate no capacity (not supported)
    return 0n
  }

  private send(
    handle: number,
    _datagrams: OutgoingDatagram[]
  ): bigint | { tag: 'err'; val: NetworkErrorCode } {
    const stream = this.streamRegistry.getOutgoing(handle)
    if (!stream) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // UDP send is not supported in browser
    return { tag: 'err', val: NetworkErrorCode.NotSupported }
  }

  private subscribeOutgoing(_handle: number): number {
    return createReadyPollable(this.pollableRegistry)
  }
}

/**
 * UDP create socket plugin instance
 */
class UdpCreateSocketInstance implements PluginInstance {
  private readonly registry: UdpSocketRegistry

  constructor(registry: UdpSocketRegistry) {
    this.registry = registry
  }

  getImports(): Record<string, unknown> {
    return {
      'create-udp-socket': this.createUdpSocket.bind(this),
    }
  }

  destroy(): void {
    // No cleanup needed
  }

  private createUdpSocket(
    _networkHandle: number,
    addressFamily: IpAddressFamily
  ): number | { tag: 'err'; val: NetworkErrorCode } {
    // Validate network handle
    const network = globalNetworkRegistry.get(_networkHandle)
    if (!network) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Create the socket
    const socket = createUdpSocket(addressFamily)
    return this.registry.register(socket)
  }
}

/**
 * Virtual UDP socket implementation
 *
 * Provides UDP socket API but returns NotSupported for actual operations.
 * Socket options can be get/set for compatibility.
 */
export const virtualUdpImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual UDP sockets (no actual networking)',
  create(_config: PluginConfig): PluginInstance {
    return new UdpSocketInstance(
      globalUdpSocketRegistry,
      globalDatagramStreamRegistry,
      globalPollableRegistry
    )
  },
}

/**
 * Virtual UDP create socket implementation
 */
export const virtualUdpCreateSocketImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual UDP socket creation',
  create(_config: PluginConfig): PluginInstance {
    return new UdpCreateSocketInstance(globalUdpSocketRegistry)
  },
}
