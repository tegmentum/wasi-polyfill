/**
 * TCP Adapter for WASI sockets via WebSocket tunnel
 *
 * Adapts the WsTunnelManager to provide wasi:sockets/tcp compatible
 * socket operations. This allows existing WASI socket code to work
 * transparently through the WebSocket gateway.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { HandleRegistry } from '../../../shared/registry.js'
import {
  PollableRegistry,
  globalPollableRegistry,
  createReadyPollable,
} from '../io/pollable.js'
import { globalStreamRegistry, type InputStream, type OutputStream } from '../io/streams.js'
import { NetworkErrorCode } from '../sockets/types.js'
import {
  WsTunnelManager,
  TunnelRegistry,
  globalTunnelRegistry,
  buildTunnelConfig,
  type StreamInfo,
} from './tunnel-manager.js'

/**
 * TCP socket state (matches WASI spec)
 */
export enum TcpSocketState {
  /** Initial state */
  New = 'new',
  /** Bind has been called */
  Bound = 'bound',
  /** Listening for connections */
  Listening = 'listening',
  /** Connect initiated */
  Connecting = 'connecting',
  /** Connected */
  Connected = 'connected',
  /** Connection closed */
  Closed = 'closed',
}

/**
 * Tunneled TCP socket
 */
export interface TunneledTcpSocket {
  /** Socket handle */
  handle: number
  /** Socket state */
  state: TcpSocketState
  /** Tunnel manager */
  tunnel: WsTunnelManager
  /** Stream ID in the tunnel */
  streamId?: number
  /** Stream info from tunnel */
  streamInfo?: StreamInfo
  /** Address family */
  family: 'ipv4' | 'ipv6'
  /** Remote host */
  remoteHost?: string
  /** Remote port */
  remotePort?: number
  /** Input stream handle */
  inputStreamHandle?: number
  /** Output stream handle */
  outputStreamHandle?: number
  /** Last error */
  lastError?: NetworkErrorCode
  /**
   * Background work the call to `start-connect` kicked off. Resolves
   * once the WebSocket tunnel is open AND the TCP stream open has
   * been ack'd by the gateway. `connectResult` is populated when this
   * promise resolves.
   */
  connectPromise?: Promise<void>
  /**
   * Cached result of the connect attempt. Read by `finish-connect`.
   * Either an [inputStreamHandle, outputStreamHandle] tuple on success
   * or a NetworkErrorCode on failure.
   */
  connectResult?:
    | { tag: 'ok'; val: [number, number] }
    | { tag: 'err'; val: NetworkErrorCode }
}

/**
 * Registry for tunneled TCP sockets
 */
export class TunneledTcpSocketRegistry extends HandleRegistry<TunneledTcpSocket> {
  override register(socket: TunneledTcpSocket): number {
    const handle = super.register(socket)
    socket.handle = handle
    return handle
  }

  override drop(handle: number): boolean {
    this.closeSocketStream(this.get(handle))
    return super.drop(handle)
  }

  override clear(): void {
    this.forEach((socket) => this.closeSocketStream(socket))
    super.clear()
  }

  private closeSocketStream(socket: TunneledTcpSocket | undefined): void {
    if (socket?.streamId !== undefined && socket.tunnel) {
      socket.tunnel.closeStream(socket.streamId)
    }
  }
}

/**
 * Global tunneled socket registry
 */
export const globalTunneledTcpSocketRegistry = new TunneledTcpSocketRegistry()

/**
 * Tunneled input stream
 */
class TunneledInputStream implements InputStream {
  handle = 0
  private readonly socket: TunneledTcpSocket
  private closed = false

  constructor(socket: TunneledTcpSocket) {
    this.socket = socket
  }

  isClosed(): boolean {
    return this.closed || this.socket.state === TcpSocketState.Closed
  }

  close(): void {
    this.closed = true
  }

  read(len: bigint): Uint8Array | { tag: 'last-operation-failed'; val: Error } | { tag: 'closed' } {
    if (this.isClosed()) {
      return { tag: 'closed' }
    }

    if (this.socket.streamId === undefined) {
      return { tag: 'closed' }
    }

    const data = this.socket.tunnel.readData(this.socket.streamId, Number(len))
    if (data === null) {
      return { tag: 'closed' }
    }

    if (data.length === 0 && this.socket.streamInfo?.eofReceived) {
      return { tag: 'closed' }
    }

    return data
  }

  async blockingRead(
    len: bigint
  ): Promise<Uint8Array | { tag: 'last-operation-failed'; val: Error } | { tag: 'closed' }> {
    if (this.isClosed()) {
      return { tag: 'closed' }
    }

    if (this.socket.streamId === undefined) {
      return { tag: 'closed' }
    }

    const data = await this.socket.tunnel.readDataAsync(this.socket.streamId, Number(len))
    if (data === null) {
      return { tag: 'closed' }
    }

    if (data.length === 0 && this.socket.streamInfo?.eofReceived) {
      return { tag: 'closed' }
    }

    return data
  }

  skip(len: bigint): bigint | { tag: 'last-operation-failed'; val: Error } | { tag: 'closed' } {
    const data = this.read(len)
    if (data instanceof Uint8Array) {
      return BigInt(data.length)
    }
    return data
  }

  subscribe(registry: PollableRegistry): number {
    // For now, always ready (could be improved with proper async notification)
    return createReadyPollable(registry)
  }
}

/**
 * Tunneled output stream
 */
class TunneledOutputStream implements OutputStream {
  handle = 0
  private readonly socket: TunneledTcpSocket
  private closed = false

  constructor(socket: TunneledTcpSocket) {
    this.socket = socket
  }

  isClosed(): boolean {
    return this.closed || this.socket.state === TcpSocketState.Closed
  }

  close(): void {
    this.closed = true
  }

  checkWrite():
    | bigint
    | { tag: 'last-operation-failed'; val: Error }
    | { tag: 'closed' } {
    if (this.isClosed()) {
      return { tag: 'closed' }
    }
    // Allow up to 64KB at a time
    return 65536n
  }

  write(
    contents: Uint8Array
  ): { tag: 'last-operation-failed'; val: Error } | { tag: 'closed' } | undefined {
    if (this.isClosed()) {
      return { tag: 'closed' }
    }

    if (this.socket.streamId === undefined) {
      return { tag: 'closed' }
    }

    const success = this.socket.tunnel.sendData(this.socket.streamId, contents)
    if (!success) {
      return { tag: 'last-operation-failed', val: new Error('Send failed') }
    }

    return undefined
  }

  async blockingWriteAndFlush(
    contents: Uint8Array
  ): Promise<{ tag: 'last-operation-failed'; val: Error } | { tag: 'closed' } | undefined> {
    return this.write(contents)
  }

  flush(): { tag: 'last-operation-failed'; val: Error } | { tag: 'closed' } | undefined {
    if (this.isClosed()) {
      return { tag: 'closed' }
    }
    return undefined
  }

  async blockingFlush(): Promise<
    { tag: 'last-operation-failed'; val: Error } | { tag: 'closed' } | undefined
  > {
    return this.flush()
  }

  subscribe(registry: PollableRegistry): number {
    return createReadyPollable(registry)
  }

  writeZeroes(
    len: bigint
  ): { tag: 'last-operation-failed'; val: Error } | { tag: 'closed' } | undefined {
    const zeroes = new Uint8Array(Number(len))
    return this.write(zeroes)
  }

  splice(
    src: InputStream,
    len: bigint
  ): bigint | { tag: 'last-operation-failed'; val: Error } | { tag: 'closed' } {
    const data = src.read(len)
    if (!(data instanceof Uint8Array)) {
      return data
    }
    const error = this.write(data)
    if (error) return error
    return BigInt(data.length)
  }
}

/**
 * Configuration for tunneled TCP plugin
 */
export interface TunneledTcpConfig {
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
 * Tunneled TCP plugin instance
 *
 * Provides WASI TCP socket operations via WebSocket tunnel
 */
class TunneledTcpInstance implements PluginInstance {
  private readonly socketRegistry: TunneledTcpSocketRegistry
  private readonly tunnelRegistry: TunnelRegistry
  private readonly pollableRegistry: PollableRegistry
  private readonly config: TunneledTcpConfig
  private tunnel: WsTunnelManager | null = null

  constructor(
    socketRegistry: TunneledTcpSocketRegistry,
    tunnelRegistry: TunnelRegistry,
    pollableRegistry: PollableRegistry,
    config: TunneledTcpConfig
  ) {
    this.socketRegistry = socketRegistry
    this.tunnelRegistry = tunnelRegistry
    this.pollableRegistry = pollableRegistry
    this.config = config
  }

  getImports(): Record<string, unknown> {
    return {
      // Socket methods
      '[method]tcp-socket.start-bind': this.startBind.bind(this),
      '[method]tcp-socket.finish-bind': this.finishBind.bind(this),
      '[method]tcp-socket.start-connect': this.startConnect.bind(this),
      '[method]tcp-socket.finish-connect': this.finishConnect.bind(this),
      '[method]tcp-socket.start-listen': this.startListen.bind(this),
      '[method]tcp-socket.finish-listen': this.finishListen.bind(this),
      '[method]tcp-socket.accept': this.accept.bind(this),
      '[method]tcp-socket.local-address': this.localAddress.bind(this),
      '[method]tcp-socket.remote-address': this.remoteAddress.bind(this),
      '[method]tcp-socket.is-listening': this.isListening.bind(this),
      '[method]tcp-socket.address-family': this.addressFamily.bind(this),
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
      '[method]tcp-socket.subscribe': this.subscribe.bind(this),
      '[method]tcp-socket.shutdown': this.shutdown.bind(this),
      '[resource-drop]tcp-socket': this.dropSocket.bind(this),
    }
  }

  destroy(): void {
    this.socketRegistry.clear()
  }

  /**
   * Get or create the tunnel
   */
  private async getTunnel(): Promise<WsTunnelManager | null> {
    if (!this.tunnel) {
      this.tunnel = this.tunnelRegistry.getOrCreate(buildTunnelConfig(this.config))
    }

    if (!this.tunnel.isConnected) {
      const connected = await this.tunnel.connect()
      if (!connected) {
        return null
      }
    }

    return this.tunnel
  }

  // Socket methods

  private startBind(
    _handle: number,
    _network: number,
    _localAddress: unknown
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    // Binding is not supported through the tunnel
    return { tag: 'err', val: NetworkErrorCode.NotSupported }
  }

  private finishBind(_handle: number): { tag: 'err'; val: NetworkErrorCode } | undefined {
    return { tag: 'err', val: NetworkErrorCode.NotSupported }
  }

  private startConnect(
    handle: number,
    _network: number,
    remoteAddress: unknown
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.state !== TcpSocketState.New) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    // Parse remote address
    // Expected format: { tag: 'ipv4' | 'ipv6', val: { port, address } }
    const addr = remoteAddress as { tag: string; val: { port: number; address: number[] } }
    if (!addr || !addr.val) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // For tunnel, we need a hostname - we'll convert IP to string
    const ipBytes = addr.val.address
    let host: string
    if (addr.tag === 'ipv4' && ipBytes.length === 4) {
      host = ipBytes.join('.')
    } else if (addr.tag === 'ipv6' && ipBytes.length === 16) {
      // Convert to IPv6 string
      const parts: string[] = []
      for (let i = 0; i < 16; i += 2) {
        const val = (ipBytes[i]! << 8) | ipBytes[i + 1]!
        parts.push(val.toString(16))
      }
      host = parts.join(':')
    } else {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.remoteHost = host
    socket.remotePort = addr.val.port
    socket.state = TcpSocketState.Connecting

    // Per the canonical-ABI contract, `start-connect` returns
    // immediately and the actual blocking happens when the caller
    // pollable.block()s the subscribe() pollable. We kick the async
    // work off here and stash a Promise the subscribe pollable can
    // await; finish-connect just consults `connectResult`.
    socket.connectPromise = (async () => {
      try {
        const tunnel = await this.getTunnel()
        if (!tunnel) {
          socket.connectResult = { tag: 'err', val: NetworkErrorCode.ConnectionRefused }
          socket.state = TcpSocketState.Closed
          return
        }
        socket.tunnel = tunnel
        const streamId = await tunnel.openTcpStream(socket.remoteHost!, socket.remotePort!)
        if (streamId === null) {
          const streamInfo = socket.streamInfo
          const code = (streamInfo?.wasiError as NetworkErrorCode | undefined) ?? NetworkErrorCode.ConnectionRefused
          socket.connectResult = { tag: 'err', val: code }
          socket.state = TcpSocketState.Closed
          return
        }
        socket.streamId = streamId
        const streamInfo = tunnel.getStream(streamId)
        if (streamInfo !== undefined) socket.streamInfo = streamInfo

        const inputStream = new TunneledInputStream(socket)
        const outputStream = new TunneledOutputStream(socket)
        socket.inputStreamHandle = globalStreamRegistry.register(inputStream)
        socket.outputStreamHandle = globalStreamRegistry.register(outputStream)
        socket.state = TcpSocketState.Connected
        socket.connectResult = {
          tag: 'ok',
          val: [socket.inputStreamHandle, socket.outputStreamHandle],
        }
      } catch {
        socket.connectResult = { tag: 'err', val: NetworkErrorCode.ConnectionRefused }
        socket.state = TcpSocketState.Closed
      }
    })()

    return undefined
  }

  /**
   * Synchronous result collector. The wasi-sockets contract says
   * `finish-connect` is called AFTER the subscribe pollable signals
   * ready, so by then `connectPromise` has resolved and
   * `connectResult` is populated. If it isn't (caller didn't block),
   * surface `would-block`.
   */
  private finishConnect(
    handle: number
  ):
    | [number, number]
    | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }
    if (!socket.connectResult) {
      return { tag: 'err', val: NetworkErrorCode.WouldBlock }
    }
    if (socket.connectResult.tag === 'err') {
      return { tag: 'err', val: socket.connectResult.val }
    }
    return socket.connectResult.val
  }

  private startListen(
    _handle: number
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    // Server sockets not supported through tunnel
    return { tag: 'err', val: NetworkErrorCode.NotSupported }
  }

  private finishListen(_handle: number): { tag: 'err'; val: NetworkErrorCode } | undefined {
    return { tag: 'err', val: NetworkErrorCode.NotSupported }
  }

  private accept(
    _handle: number
  ): [number, number, number] | { tag: 'err'; val: NetworkErrorCode } {
    return { tag: 'err', val: NetworkErrorCode.NotSupported }
  }

  private localAddress(_handle: number): unknown | { tag: 'err'; val: NetworkErrorCode } {
    // We don't know our local address through the tunnel
    return { tag: 'err', val: NetworkErrorCode.InvalidState }
  }

  private remoteAddress(handle: number): unknown | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (!socket.remoteHost || !socket.remotePort) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }

    // Return as IPv4 address (simplified)
    const parts = socket.remoteHost.split('.').map(Number)
    if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
      return {
        tag: 'ipv4',
        val: {
          port: socket.remotePort,
          address: parts,
        },
      }
    }

    return { tag: 'err', val: NetworkErrorCode.InvalidState }
  }

  private isListening(_handle: number): boolean {
    return false // Never listening
  }

  private addressFamily(handle: number): string {
    const socket = this.socketRegistry.get(handle)
    return socket?.family ?? 'ipv4'
  }

  // Stub implementations for socket options

  private setListenBacklogSize(
    _handle: number,
    _size: bigint
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    return undefined // Ignored
  }

  private keepAliveEnabled(_handle: number): boolean {
    return false
  }

  private setKeepAliveEnabled(
    _handle: number,
    _enabled: boolean
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    return undefined // Ignored
  }

  private keepAliveIdleTime(_handle: number): bigint {
    return 7200_000_000_000n // 2 hours in nanoseconds
  }

  private setKeepAliveIdleTime(
    _handle: number,
    _time: bigint
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    return undefined // Ignored
  }

  private keepAliveInterval(_handle: number): bigint {
    return 75_000_000_000n // 75 seconds
  }

  private setKeepAliveInterval(
    _handle: number,
    _interval: bigint
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    return undefined // Ignored
  }

  private keepAliveCount(_handle: number): number {
    return 9
  }

  private setKeepAliveCount(
    _handle: number,
    _count: number
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    return undefined // Ignored
  }

  private hopLimit(_handle: number): number {
    return 64
  }

  private setHopLimit(
    _handle: number,
    _limit: number
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    return undefined // Ignored
  }

  private receiveBufferSize(_handle: number): bigint {
    return 65536n
  }

  private setReceiveBufferSize(
    _handle: number,
    _size: bigint
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    return undefined // Ignored
  }

  private sendBufferSize(_handle: number): bigint {
    return 65536n
  }

  private setSendBufferSize(
    _handle: number,
    _size: bigint
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    return undefined // Ignored
  }

  private subscribe(handle: number): number {
    const socket = this.socketRegistry.get(handle)
    // For a connecting socket, wire the Pollable to the connect
    // Promise — that's the suspending boundary the wasm caller's
    // pollable.block() needs to wait on. For an already-connected
    // socket (or no socket), return an immediately-ready pollable
    // so the caller doesn't spin.
    if (socket?.state === TcpSocketState.Connecting && socket.connectPromise) {
      // Wrap so the registry-side Promise<void> ignores connectResult
      // (which is populated as a side effect on socket).
      return this.pollableRegistry.create(socket.connectPromise.then(() => undefined))
    }
    return createReadyPollable(this.pollableRegistry)
  }

  private shutdown(
    handle: number,
    _shutdownType: unknown
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    const socket = this.socketRegistry.get(handle)
    if (!socket) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    if (socket.streamId !== undefined && socket.tunnel) {
      socket.tunnel.closeStream(socket.streamId)
    }

    socket.state = TcpSocketState.Closed
    return undefined
  }

  private dropSocket(handle: number): void {
    this.socketRegistry.drop(handle)
  }
}

/**
 * Tunneled TCP create-socket plugin instance
 */
class TunneledTcpCreateSocketInstance implements PluginInstance {
  private readonly socketRegistry: TunneledTcpSocketRegistry
  private readonly tunnelRegistry: TunnelRegistry
  private readonly config: TunneledTcpConfig

  constructor(
    socketRegistry: TunneledTcpSocketRegistry,
    tunnelRegistry: TunnelRegistry,
    config: TunneledTcpConfig
  ) {
    this.socketRegistry = socketRegistry
    this.tunnelRegistry = tunnelRegistry
    this.config = config
  }

  getImports(): Record<string, unknown> {
    return {
      'create-tcp-socket': this.createTcpSocket.bind(this),
    }
  }

  destroy(): void {
    // Cleanup handled by registry
  }

  private createTcpSocket(
    addressFamily: string
  ): number | { tag: 'err'; val: NetworkErrorCode } {
    // Note: the WIT signature is
    //   create-tcp-socket: func(address-family: ip-address-family) -> result<tcp-socket, error-code>
    // (single arg, no network handle) -- jco passes just the family. An
    // earlier implementation took `(_networkHandle, addressFamily)` which
    // shifted the family into the first slot and left the real family
    // undefined, breaking every tunneled-TCP path.
    if (addressFamily !== 'ipv4' && addressFamily !== 'ipv6') {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Create a placeholder tunnel (will be connected on first use)
    const tunnel = this.tunnelRegistry.getOrCreate(buildTunnelConfig(this.config))

    const socket: TunneledTcpSocket = {
      handle: 0,
      state: TcpSocketState.New,
      tunnel,
      family: addressFamily as 'ipv4' | 'ipv6',
    }

    return this.socketRegistry.register(socket)
  }
}

/**
 * Tunneled TCP implementation
 */
export const tunneledTcpImplementation: Implementation = {
  name: 'tunneled',
  description: 'TCP via WebSocket tunnel',
  create(config: PluginConfig): PluginInstance {
    const tcpConfig: TunneledTcpConfig = {
      gatewayUrl: (config.options?.['gatewayUrl'] as string) ?? 'ws://localhost:8080',
    }
    const authToken = config.options?.['authToken'] as string | undefined
    const maxStreams = config.options?.['maxStreams'] as number | undefined
    const connectTimeoutMs = config.options?.['connectTimeoutMs'] as number | undefined
    const flowControl = config.options?.['flowControl'] as boolean | undefined

    if (authToken !== undefined) {
      tcpConfig.authToken = authToken
    }
    if (maxStreams !== undefined) {
      tcpConfig.maxStreams = maxStreams
    }
    if (connectTimeoutMs !== undefined) {
      tcpConfig.connectTimeoutMs = connectTimeoutMs
    }
    if (flowControl !== undefined) {
      tcpConfig.flowControl = flowControl
    }

    return new TunneledTcpInstance(
      globalTunneledTcpSocketRegistry,
      globalTunnelRegistry,
      globalPollableRegistry,
      tcpConfig
    )
  },
}

/**
 * Tunneled TCP create-socket implementation
 */
export const tunneledTcpCreateSocketImplementation: Implementation = {
  name: 'tunneled',
  description: 'TCP socket creation via WebSocket tunnel',
  create(config: PluginConfig): PluginInstance {
    const tcpConfig: TunneledTcpConfig = {
      gatewayUrl: (config.options?.['gatewayUrl'] as string) ?? 'ws://localhost:8080',
    }
    const authToken = config.options?.['authToken'] as string | undefined
    const maxStreams = config.options?.['maxStreams'] as number | undefined
    const connectTimeoutMs = config.options?.['connectTimeoutMs'] as number | undefined
    const flowControl = config.options?.['flowControl'] as boolean | undefined

    if (authToken !== undefined) {
      tcpConfig.authToken = authToken
    }
    if (maxStreams !== undefined) {
      tcpConfig.maxStreams = maxStreams
    }
    if (connectTimeoutMs !== undefined) {
      tcpConfig.connectTimeoutMs = connectTimeoutMs
    }
    if (flowControl !== undefined) {
      tcpConfig.flowControl = flowControl
    }

    return new TunneledTcpCreateSocketInstance(
      globalTunneledTcpSocketRegistry,
      globalTunnelRegistry,
      tcpConfig
    )
  },
}
