/**
 * TCP socket implementation for wasi:sockets/tcp and wasi:sockets/tcp-create-socket
 *
 * Provides TCP socket operations. In browsers, raw TCP sockets are not available,
 * so this provides a stub implementation that returns appropriate errors.
 * For actual TCP connectivity, a WebSocket proxy would be needed.
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
  NetworkErrorCode,
  TcpState,
} from './types.js'
import { globalNetworkRegistry } from './network.js'

/**
 * TCP socket resource
 */
export interface TcpSocket {
  handle: number
  state: TcpState
  family: IpAddressFamily
  localAddress?: IpSocketAddress
  remoteAddress?: IpSocketAddress
  keepAlive: boolean
  keepAliveIdleTime: bigint
  keepAliveInterval: bigint
  keepAliveCount: number
  hopLimit: number
  receiveBufferSize: bigint
  sendBufferSize: bigint
}

/**
 * Registry for TCP sockets
 */
export class TcpSocketRegistry {
  private nextHandle = 1
  private sockets = new Map<number, TcpSocket>()

  register(socket: TcpSocket): number {
    const handle = this.nextHandle++
    socket.handle = handle
    this.sockets.set(handle, socket)
    return handle
  }

  get(handle: number): TcpSocket | undefined {
    return this.sockets.get(handle)
  }

  drop(handle: number): void {
    const socket = this.sockets.get(handle)
    if (socket) {
      socket.state = TcpState.Closed
      this.sockets.delete(handle)
    }
  }
}

/**
 * Global TCP socket registry
 */
export const globalTcpSocketRegistry = new TcpSocketRegistry()

/**
 * Create a new TCP socket with default settings
 */
function createTcpSocket(family: IpAddressFamily): TcpSocket {
  return {
    handle: 0,
    state: TcpState.Unbound,
    family,
    keepAlive: false,
    keepAliveIdleTime: 7200n, // 2 hours in seconds
    keepAliveInterval: 75n, // 75 seconds
    keepAliveCount: 9,
    hopLimit: 64,
    receiveBufferSize: 65536n,
    sendBufferSize: 65536n,
  }
}

/**
 * TCP socket plugin instance
 */
class TcpSocketInstance implements PluginInstance {
  private readonly registry: TcpSocketRegistry
  private readonly pollableRegistry: PollableRegistry

  constructor(registry: TcpSocketRegistry, pollableRegistry: PollableRegistry) {
    this.registry = registry
    this.pollableRegistry = pollableRegistry
  }

  getImports(): Record<string, unknown> {
    return {
      // Socket lifecycle
      '[resource-drop]tcp-socket': this.dropSocket.bind(this),

      // Binding and connecting
      '[method]tcp-socket.start-bind': this.startBind.bind(this),
      '[method]tcp-socket.finish-bind': this.finishBind.bind(this),
      '[method]tcp-socket.start-connect': this.startConnect.bind(this),
      '[method]tcp-socket.finish-connect': this.finishConnect.bind(this),

      // Listening and accepting
      '[method]tcp-socket.start-listen': this.startListen.bind(this),
      '[method]tcp-socket.finish-listen': this.finishListen.bind(this),
      '[method]tcp-socket.accept': this.accept.bind(this),

      // Address queries
      '[method]tcp-socket.local-address': this.localAddress.bind(this),
      '[method]tcp-socket.remote-address': this.remoteAddress.bind(this),
      '[method]tcp-socket.is-listening': this.isListening.bind(this),
      '[method]tcp-socket.address-family': this.addressFamily.bind(this),

      // Socket options
      '[method]tcp-socket.set-listen-backlog-size': this.setListenBacklogSize.bind(this),
      '[method]tcp-socket.keep-alive-enabled': this.keepAliveEnabled.bind(this),
      '[method]tcp-socket.set-keep-alive-enabled': this.setKeepAliveEnabled.bind(this),
      '[method]tcp-socket.keep-alive-idle-time': this.keepAliveIdleTime.bind(this),
      '[method]tcp-socket.set-keep-alive-idle-time': this.setKeepAliveIdleTime.bind(this),
      '[method]tcp-socket.keep-alive-interval': this.keepAliveInterval.bind(this),
      '[method]tcp-socket.set-keep-alive-interval': this.setKeepAliveInterval.bind(this),
      '[method]tcp-socket.keep-alive-count': this.keepAliveCount.bind(this),
      '[method]tcp-socket.set-keep-alive-count': this.setKeepAliveCount.bind(this),
      '[method]tcp-socket.hop-limit': this.hopLimit.bind(this),
      '[method]tcp-socket.set-hop-limit': this.setHopLimit.bind(this),
      '[method]tcp-socket.receive-buffer-size': this.receiveBufferSize.bind(this),
      '[method]tcp-socket.set-receive-buffer-size': this.setReceiveBufferSize.bind(this),
      '[method]tcp-socket.send-buffer-size': this.sendBufferSize.bind(this),
      '[method]tcp-socket.set-send-buffer-size': this.setSendBufferSize.bind(this),

      // Subscription
      '[method]tcp-socket.subscribe': this.subscribe.bind(this),

      // Shutdown
      '[method]tcp-socket.shutdown': this.shutdown.bind(this),
    }
  }

  destroy(): void {
    // No cleanup needed
  }

  private dropSocket(handle: number): void {
    this.registry.drop(handle)
  }

  private startBind(
    handle: number,
    _networkHandle: number,
    localAddress: IpSocketAddress
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.state !== TcpState.Unbound) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    // Check address family matches
    if (localAddress.tag !== socket.family) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // In browser, we can't actually bind - store the address and pretend
    socket.localAddress = localAddress
    socket.state = TcpState.Bound

    return undefined
  }

  private finishBind(handle: number): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Bind is synchronous in our implementation
    if (socket.state !== TcpState.Bound) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    return undefined
  }

  private startConnect(
    handle: number,
    _networkHandle: number,
    remoteAddress: IpSocketAddress
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.state !== TcpState.Unbound && socket.state !== TcpState.Bound) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    // Check address family matches
    if (remoteAddress.tag !== socket.family) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Check network policy
    const network = globalNetworkRegistry.get(_networkHandle)
    if (network) {
      const port = remoteAddress.tag === 'ipv4' ? remoteAddress.val.port : remoteAddress.val.port
      if (!network.isPortAllowed(port)) {
        return { tag: 'err', val: NetworkErrorCode.AccessDenied }
      }
    }

    // In browser, we can't actually connect to TCP - return not supported
    socket.state = TcpState.Connecting
    socket.remoteAddress = remoteAddress

    return undefined
  }

  private finishConnect(
    handle: number
  ):
    | [number, number] // [input-stream, output-stream]
    | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.state !== TcpState.Connecting) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    // TCP is not supported in browser - return error
    socket.state = TcpState.Closed
    return { tag: 'err', val: NetworkErrorCode.NotSupported }
  }

  private startListen(handle: number): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.state !== TcpState.Bound) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    // TCP listening is not supported in browser
    return { tag: 'err', val: NetworkErrorCode.NotSupported }
  }

  private finishListen(handle: number): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Listen is not supported
    return { tag: 'err', val: NetworkErrorCode.NotSupported }
  }

  private accept(
    handle: number
  ):
    | [number, number, number] // [socket, input-stream, output-stream]
    | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.state !== TcpState.Listening) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    // Accept is not supported in browser
    return { tag: 'err', val: NetworkErrorCode.NotSupported }
  }

  private localAddress(handle: number): IpSocketAddress | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (!socket.localAddress) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    return socket.localAddress
  }

  private remoteAddress(handle: number): IpSocketAddress | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (!socket.remoteAddress) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    return socket.remoteAddress
  }

  private isListening(handle: number): boolean | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.state === TcpState.Listening
  }

  private addressFamily(handle: number): IpAddressFamily | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.family
  }

  private setListenBacklogSize(
    handle: number,
    _value: bigint
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // No-op in browser
    return undefined
  }

  private keepAliveEnabled(handle: number): boolean | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.keepAlive
  }

  private setKeepAliveEnabled(
    handle: number,
    value: boolean
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.keepAlive = value
    return undefined
  }

  private keepAliveIdleTime(handle: number): bigint | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.keepAliveIdleTime
  }

  private setKeepAliveIdleTime(
    handle: number,
    value: bigint
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.keepAliveIdleTime = value
    return undefined
  }

  private keepAliveInterval(handle: number): bigint | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.keepAliveInterval
  }

  private setKeepAliveInterval(
    handle: number,
    value: bigint
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.keepAliveInterval = value
    return undefined
  }

  private keepAliveCount(handle: number): number | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.keepAliveCount
  }

  private setKeepAliveCount(
    handle: number,
    value: number
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.keepAliveCount = value
    return undefined
  }

  private hopLimit(handle: number): number | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.hopLimit
  }

  private setHopLimit(
    handle: number,
    value: number
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.hopLimit = value
    return undefined
  }

  private receiveBufferSize(handle: number): bigint | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.receiveBufferSize
  }

  private setReceiveBufferSize(
    handle: number,
    value: bigint
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.receiveBufferSize = value
    return undefined
  }

  private sendBufferSize(handle: number): bigint | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    return socket.sendBufferSize
  }

  private setSendBufferSize(
    handle: number,
    value: bigint
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
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

  private shutdown(
    handle: number,
    _shutdownType: string
  ): undefined | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.state !== TcpState.Connected) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    socket.state = TcpState.Closed
    return undefined
  }
}

/**
 * TCP create socket plugin instance
 */
class TcpCreateSocketInstance implements PluginInstance {
  private readonly registry: TcpSocketRegistry

  constructor(registry: TcpSocketRegistry) {
    this.registry = registry
  }

  getImports(): Record<string, unknown> {
    return {
      'create-tcp-socket': this.createTcpSocket.bind(this),
    }
  }

  destroy(): void {
    // No cleanup needed
  }

  private createTcpSocket(
    _networkHandle: number,
    addressFamily: IpAddressFamily
  ): number | { tag: 'err'; val: NetworkErrorCode } {
    // Validate network handle
    const network = globalNetworkRegistry.get(_networkHandle)
    if (!network) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Create the socket
    const socket = createTcpSocket(addressFamily)
    return this.registry.register(socket)
  }
}

/**
 * Virtual TCP socket implementation
 *
 * Provides TCP socket API but returns NotSupported for actual operations.
 * Socket options can be get/set for compatibility.
 */
export const virtualTcpImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual TCP sockets (no actual networking)',
  create(_config: PluginConfig): PluginInstance {
    return new TcpSocketInstance(globalTcpSocketRegistry, globalPollableRegistry)
  },
}

/**
 * Virtual TCP create socket implementation
 */
export const virtualTcpCreateSocketImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual TCP socket creation',
  create(_config: PluginConfig): PluginInstance {
    return new TcpCreateSocketInstance(globalTcpSocketRegistry)
  },
}
