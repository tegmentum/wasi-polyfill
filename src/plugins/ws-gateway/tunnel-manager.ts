/**
 * WsTunnelManager - WebSocket tunnel management
 *
 * Manages a WebSocket connection to a gateway server and multiplexes
 * multiple logical streams over it.
 */

import { AsyncByteQueue } from './byte-queue.js'
import {
  type FrameHeader,
  type OpenPayload,
  type DnsQueryPayload,
  MessageType,
  MessageFlags,
  Features,
  Protocol,
  AddressKind,
  DnsError,
  HEADER_SIZE,
  decodeHeader,
  decodeOpenErrPayload,
  decodeDnsResultPayload,
  decodeDnsErrPayload,
  createHelloFrame,
  createOpenFrame,
  createDataFrame,
  createCloseFrame,
  createDataAckFrame,
  createDnsQueryFrame,
  mapOpenErrorToWasi,
} from './protocol.js'

/**
 * Stream state
 */
export enum StreamState {
  /** Stream is connecting */
  Connecting = 'connecting',
  /** Stream is connected and ready */
  Connected = 'connected',
  /** Stream is closing */
  Closing = 'closing',
  /** Stream is closed */
  Closed = 'closed',
  /** Stream encountered an error */
  Error = 'error',
}

/**
 * Stream information
 */
export interface StreamInfo {
  /** Stream ID */
  id: number
  /** Stream state */
  state: StreamState
  /** Protocol (TCP/UDP) */
  protocol: Protocol
  /** Remote host */
  host: string
  /** Remote port */
  port: number
  /** Receive buffer */
  rxQueue: AsyncByteQueue
  /** Error message if state is Error */
  error?: string
  /** WASI error code if state is Error */
  wasiError?: string
  /** Whether EOF has been received */
  eofReceived: boolean
  /** Whether EOF has been sent */
  eofSent: boolean
  /** Flow control credit */
  txCredit: number
  /** Pending resolve for connect */
  connectResolve?: (success: boolean) => void
}

/**
 * DNS query result
 */
export interface DnsQueryResult {
  /** Whether the query succeeded */
  success: boolean
  /** Resolved addresses (IPv4 as 4 bytes, IPv6 as 16 bytes) */
  addresses: Uint8Array[]
  /** Error code if failed */
  errorCode?: DnsError
  /** Error message if failed */
  errorMessage?: string
}

/**
 * Pending DNS query
 */
interface PendingDnsQuery {
  hostname: string
  family: number
  resolve: (result: DnsQueryResult) => void
}

/**
 * Tunnel configuration
 */
export interface TunnelConfig {
  /** Gateway WebSocket URL */
  gatewayUrl: string

  /** Authentication token */
  authToken?: string

  /** Maximum streams per connection */
  maxStreams?: number

  /** Receive buffer size per stream */
  rxBufferSize?: number

  /** Initial TX credit (flow control) */
  initialTxCredit?: number

  /** Connection timeout in milliseconds */
  connectTimeoutMs?: number

  /** Enable flow control */
  flowControl?: boolean

  /** Reconnect on disconnect */
  autoReconnect?: boolean

  /** Callback when tunnel connects */
  onConnect?: () => void

  /** Callback when tunnel disconnects */
  onDisconnect?: (error?: Error) => void

  /** Callback when a stream receives data */
  onStreamData?: (streamId: number, data: Uint8Array) => void
}

/**
 * Tunnel state
 */
export enum TunnelState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error',
}

/**
 * WebSocket tunnel manager
 *
 * Manages a WebSocket connection to a gateway and multiplexes streams.
 */
export class WsTunnelManager {
  private ws: WebSocket | null = null
  private state: TunnelState = TunnelState.Disconnected
  private readonly config: Required<TunnelConfig>
  private readonly streams: Map<number, StreamInfo> = new Map()
  private readonly pendingDnsQueries: Map<number, PendingDnsQuery> = new Map()
  private nextStreamId = 1
  private nextDnsQueryId = 1
  private negotiatedFeatures: Features = Features.None
  private connectPromise: Promise<boolean> | null = null
  private connectResolve: ((success: boolean) => void) | null = null
  private receiveBuffer: Uint8Array = new Uint8Array(0)

  constructor(config: TunnelConfig) {
    this.config = {
      gatewayUrl: config.gatewayUrl,
      authToken: config.authToken ?? '',
      maxStreams: config.maxStreams ?? 64,
      rxBufferSize: config.rxBufferSize ?? 8 * 1024 * 1024,
      initialTxCredit: config.initialTxCredit ?? 1024 * 1024,
      connectTimeoutMs: config.connectTimeoutMs ?? 30000,
      flowControl: config.flowControl ?? false,
      autoReconnect: config.autoReconnect ?? false,
      onConnect: config.onConnect ?? (() => {}),
      onDisconnect: config.onDisconnect ?? (() => {}),
      onStreamData: config.onStreamData ?? (() => {}),
    }
  }

  /**
   * Get current tunnel state
   */
  get tunnelState(): TunnelState {
    return this.state
  }

  /**
   * Check if tunnel is connected
   */
  get isConnected(): boolean {
    return this.state === TunnelState.Connected
  }

  /**
   * Get number of active streams
   */
  get streamCount(): number {
    return this.streams.size
  }

  /**
   * Get negotiated features
   */
  get features(): Features {
    return this.negotiatedFeatures
  }

  /**
   * Get stream info
   */
  getStream(streamId: number): StreamInfo | undefined {
    return this.streams.get(streamId)
  }

  /**
   * Connect to the gateway
   */
  async connect(): Promise<boolean> {
    if (this.state === TunnelState.Connected) {
      return true
    }

    if (this.connectPromise) {
      return this.connectPromise
    }

    this.state = TunnelState.Connecting

    this.connectPromise = new Promise((resolve) => {
      this.connectResolve = resolve

      try {
        // Create WebSocket with binary type
        const protocols = this.config.authToken ? [`auth-${this.config.authToken}`] : undefined
        this.ws = new WebSocket(this.config.gatewayUrl, protocols)
        this.ws.binaryType = 'arraybuffer'

        // Set up event handlers
        this.ws.onopen = this.handleOpen.bind(this)
        this.ws.onmessage = this.handleMessage.bind(this)
        this.ws.onclose = this.handleClose.bind(this)
        this.ws.onerror = this.handleError.bind(this)

        // Set up timeout
        setTimeout(() => {
          if (this.state === TunnelState.Connecting) {
            this.disconnect(new Error('Connection timeout'))
            resolve(false)
          }
        }, this.config.connectTimeoutMs)
      } catch (error) {
        this.state = TunnelState.Error
        resolve(false)
      }
    })

    return this.connectPromise
  }

  /**
   * Disconnect from the gateway
   */
  disconnect(error?: Error): void {
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close()
      }
      this.ws = null
    }

    // Close all streams
    for (const stream of this.streams.values()) {
      stream.state = StreamState.Closed
      stream.rxQueue.close(error)
    }
    this.streams.clear()

    // Cancel pending DNS queries
    for (const query of this.pendingDnsQueries.values()) {
      query.resolve({
        success: false,
        addresses: [],
        errorCode: DnsError.ServerFailure,
        errorMessage: 'Connection closed',
      })
    }
    this.pendingDnsQueries.clear()

    this.state = error ? TunnelState.Error : TunnelState.Disconnected
    this.connectPromise = null
    this.config.onDisconnect(error)
  }

  /**
   * Open a new TCP stream
   */
  async openTcpStream(host: string, port: number): Promise<number | null> {
    if (!this.isConnected) {
      return null
    }

    if (this.streams.size >= this.config.maxStreams) {
      return null
    }

    const streamId = this.nextStreamId++

    // Create stream info
    const stream: StreamInfo = {
      id: streamId,
      state: StreamState.Connecting,
      protocol: Protocol.Tcp,
      host,
      port,
      rxQueue: new AsyncByteQueue(this.config.rxBufferSize),
      eofReceived: false,
      eofSent: false,
      txCredit: this.config.initialTxCredit,
    }

    this.streams.set(streamId, stream)

    // Create OPEN payload
    const payload: OpenPayload = {
      proto: Protocol.Tcp,
      addrKind: AddressKind.Hostname,
      port,
      addr: new TextEncoder().encode(host),
    }

    if (this.config.authToken) {
      payload.token = new TextEncoder().encode(this.config.authToken)
    }

    // Send OPEN frame
    const frame = createOpenFrame(streamId, payload)
    this.send(frame)

    // Wait for OPEN_OK or OPEN_ERR
    return new Promise((resolve) => {
      stream.connectResolve = (success: boolean) => {
        if (success) {
          resolve(streamId)
        } else {
          this.streams.delete(streamId)
          resolve(null)
        }
      }

      // Timeout for connect
      setTimeout(() => {
        if (stream.state === StreamState.Connecting) {
          stream.state = StreamState.Error
          stream.error = 'Connection timeout'
          stream.wasiError = 'timeout'
          stream.connectResolve?.(false)
        }
      }, this.config.connectTimeoutMs)
    })
  }

  /**
   * Open a new UDP stream
   */
  async openUdpStream(host: string, port: number): Promise<number | null> {
    if (!this.isConnected) {
      return null
    }

    if (this.streams.size >= this.config.maxStreams) {
      return null
    }

    const streamId = this.nextStreamId++

    // Create stream info
    const stream: StreamInfo = {
      id: streamId,
      state: StreamState.Connecting,
      protocol: Protocol.Udp,
      host,
      port,
      rxQueue: new AsyncByteQueue(this.config.rxBufferSize),
      eofReceived: false,
      eofSent: false,
      txCredit: this.config.initialTxCredit,
    }

    this.streams.set(streamId, stream)

    // Create OPEN payload for UDP
    const payload: OpenPayload = {
      proto: Protocol.Udp,
      addrKind: AddressKind.Hostname,
      port,
      addr: new TextEncoder().encode(host),
    }

    if (this.config.authToken) {
      payload.token = new TextEncoder().encode(this.config.authToken)
    }

    // Send OPEN frame
    const frame = createOpenFrame(streamId, payload)
    this.send(frame)

    // Wait for OPEN_OK or OPEN_ERR
    return new Promise((resolve) => {
      stream.connectResolve = (success: boolean) => {
        if (success) {
          resolve(streamId)
        } else {
          this.streams.delete(streamId)
          resolve(null)
        }
      }

      // Timeout for connect
      setTimeout(() => {
        if (stream.state === StreamState.Connecting) {
          stream.state = StreamState.Error
          stream.error = 'Connection timeout'
          stream.wasiError = 'timeout'
          stream.connectResolve?.(false)
        }
      }, this.config.connectTimeoutMs)
    })
  }

  /**
   * Resolve a hostname to IP addresses via the gateway
   *
   * @param hostname - The hostname to resolve
   * @param family - Address family preference: 0=any, 4=IPv4 only, 6=IPv6 only
   * @param timeoutMs - Query timeout in milliseconds (default: connectTimeoutMs)
   * @returns DNS query result with addresses or error
   */
  async resolveDns(
    hostname: string,
    family: number = 0,
    timeoutMs?: number
  ): Promise<DnsQueryResult> {
    if (!this.isConnected) {
      return {
        success: false,
        addresses: [],
        errorCode: DnsError.ServerFailure,
        errorMessage: 'Not connected to gateway',
      }
    }

    // Check if gateway supports DNS
    if (!(this.negotiatedFeatures & Features.Dns)) {
      return {
        success: false,
        addresses: [],
        errorCode: DnsError.NotImplemented,
        errorMessage: 'Gateway does not support DNS resolution',
      }
    }

    const queryId = this.nextDnsQueryId++
    const timeout = timeoutMs ?? this.config.connectTimeoutMs

    return new Promise((resolve) => {
      const query: PendingDnsQuery = {
        hostname,
        family,
        resolve,
      }
      this.pendingDnsQueries.set(queryId, query)

      // Create and send DNS_QUERY frame
      const payload: DnsQueryPayload = { hostname, family }
      const frame = createDnsQueryFrame(queryId, payload)
      this.send(frame)

      // Set timeout
      setTimeout(() => {
        if (this.pendingDnsQueries.has(queryId)) {
          this.pendingDnsQueries.delete(queryId)
          resolve({
            success: false,
            addresses: [],
            errorCode: DnsError.Timeout,
            errorMessage: 'DNS query timeout',
          })
        }
      }, timeout)
    })
  }

  /**
   * Send data on a stream
   */
  sendData(streamId: number, data: Uint8Array): boolean {
    const stream = this.streams.get(streamId)
    if (!stream || stream.state !== StreamState.Connected) {
      return false
    }

    if (stream.eofSent) {
      return false
    }

    // Check flow control credit
    if (this.config.flowControl && stream.txCredit < data.length) {
      return false
    }

    const frame = createDataFrame(streamId, data)
    this.send(frame)

    if (this.config.flowControl) {
      stream.txCredit -= data.length
    }

    return true
  }

  /**
   * Read data from a stream
   */
  readData(streamId: number, maxLength: number): Uint8Array | null {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return null
    }

    const data = stream.rxQueue.read(maxLength)

    // Send DATA_ACK for flow control
    if (this.config.flowControl && data.length > 0) {
      const ackFrame = createDataAckFrame(streamId, data.length)
      this.send(ackFrame)
    }

    return data
  }

  /**
   * Read data from a stream asynchronously
   */
  async readDataAsync(
    streamId: number,
    maxLength: number,
    timeout: number = 0
  ): Promise<Uint8Array | null> {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return null
    }

    try {
      const data = await stream.rxQueue.readAsync(maxLength, timeout)

      // Send DATA_ACK for flow control
      if (this.config.flowControl && data.length > 0) {
        const ackFrame = createDataAckFrame(streamId, data.length)
        this.send(ackFrame)
      }

      return data
    } catch {
      return null
    }
  }

  /**
   * Close a stream
   */
  closeStream(streamId: number, reason: number = 0): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return
    }

    if (stream.state === StreamState.Closed) {
      return
    }

    stream.state = StreamState.Closing
    stream.eofSent = true

    const frame = createCloseFrame(streamId, reason)
    this.send(frame)

    // Mark as closed
    stream.state = StreamState.Closed
    stream.rxQueue.close()
  }

  /**
   * Send a raw frame
   */
  private send(frame: Uint8Array): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }

    this.ws.send(frame)
    return true
  }

  /**
   * Handle WebSocket open
   */
  private handleOpen(): void {
    // Send HELLO frame - request all features we support
    let features = Features.Dns | Features.Udp | Features.HalfClose
    if (this.config.flowControl) {
      features |= Features.FlowControl
    }
    const helloFrame = createHelloFrame(features, this.config.maxStreams)
    this.send(helloFrame)
  }

  /**
   * Handle WebSocket message
   */
  private handleMessage(event: MessageEvent): void {
    if (!(event.data instanceof ArrayBuffer)) {
      return // Ignore non-binary messages
    }

    // Append to receive buffer
    const newData = new Uint8Array(event.data)
    const combined = new Uint8Array(this.receiveBuffer.length + newData.length)
    combined.set(this.receiveBuffer, 0)
    combined.set(newData, this.receiveBuffer.length)
    this.receiveBuffer = combined

    // Process complete frames
    while (this.receiveBuffer.length >= HEADER_SIZE) {
      const header = decodeHeader(this.receiveBuffer)
      if (!header) {
        // Invalid frame - disconnect
        this.disconnect(new Error('Invalid frame header'))
        return
      }

      const frameSize = HEADER_SIZE + header.payloadLen
      if (this.receiveBuffer.length < frameSize) {
        break // Incomplete frame
      }

      const payload = this.receiveBuffer.slice(HEADER_SIZE, frameSize)
      this.receiveBuffer = this.receiveBuffer.slice(frameSize)

      this.handleFrame(header, payload)
    }
  }

  /**
   * Handle a complete frame
   */
  private handleFrame(header: FrameHeader, payload: Uint8Array): void {
    switch (header.type) {
      case MessageType.HelloAck:
        this.handleHelloAck(payload)
        break

      case MessageType.OpenOk:
        this.handleOpenOk(header.streamId)
        break

      case MessageType.OpenErr:
        this.handleOpenErr(header.streamId, payload)
        break

      case MessageType.Data:
        this.handleData(header.streamId, payload, header.flags)
        break

      case MessageType.DataAck:
        this.handleDataAck(header.streamId, payload)
        break

      case MessageType.Close:
      case MessageType.CloseAck:
        this.handleClose2(header.streamId)
        break

      case MessageType.DnsResult:
        this.handleDnsResult(header.streamId, payload)
        break

      case MessageType.DnsErr:
        this.handleDnsErr(header.streamId, payload)
        break

      case MessageType.Pong:
        // Ignore pong
        break
    }
  }

  /**
   * Handle HELLO_ACK
   */
  private handleHelloAck(payload: Uint8Array): void {
    if (payload.length >= 8) {
      const view = new DataView(payload.buffer, payload.byteOffset, payload.length)
      this.negotiatedFeatures = view.getUint32(0, true) as Features
    }

    this.state = TunnelState.Connected
    this.connectResolve?.(true)
    this.config.onConnect()
  }

  /**
   * Handle OPEN_OK
   */
  private handleOpenOk(streamId: number): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return
    }

    stream.state = StreamState.Connected
    stream.connectResolve?.(true)
  }

  /**
   * Handle OPEN_ERR
   */
  private handleOpenErr(streamId: number, payload: Uint8Array): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return
    }

    const errPayload = decodeOpenErrPayload(payload)
    if (errPayload) {
      stream.error = errPayload.message
      stream.wasiError = mapOpenErrorToWasi(errPayload.error)
    } else {
      stream.error = 'Unknown error'
      stream.wasiError = 'unknown'
    }

    stream.state = StreamState.Error
    stream.rxQueue.close(new Error(stream.error))
    stream.connectResolve?.(false)
  }

  /**
   * Handle DATA
   */
  private handleData(streamId: number, payload: Uint8Array, flags: MessageFlags): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return
    }

    if (payload.length > 0) {
      stream.rxQueue.push(payload)
      this.config.onStreamData(streamId, payload)
    }

    if (flags & MessageFlags.Eof) {
      stream.eofReceived = true
      stream.rxQueue.close()
    }
  }

  /**
   * Handle DATA_ACK (flow control credit)
   */
  private handleDataAck(streamId: number, payload: Uint8Array): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return
    }

    if (payload.length >= 4) {
      const view = new DataView(payload.buffer, payload.byteOffset, payload.length)
      const credit = view.getUint32(0, true)
      stream.txCredit += credit
    }
  }

  /**
   * Handle CLOSE/CLOSE_ACK
   */
  private handleClose2(streamId: number): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return
    }

    stream.state = StreamState.Closed
    stream.rxQueue.close()
  }

  /**
   * Handle DNS_RESULT
   */
  private handleDnsResult(queryId: number, payload: Uint8Array): void {
    const query = this.pendingDnsQueries.get(queryId)
    if (!query) {
      return
    }

    this.pendingDnsQueries.delete(queryId)

    const result = decodeDnsResultPayload(payload)
    if (result) {
      query.resolve({
        success: true,
        addresses: result.addresses,
      })
    } else {
      query.resolve({
        success: false,
        addresses: [],
        errorCode: DnsError.FormatError,
        errorMessage: 'Invalid DNS result payload',
      })
    }
  }

  /**
   * Handle DNS_ERR
   */
  private handleDnsErr(queryId: number, payload: Uint8Array): void {
    const query = this.pendingDnsQueries.get(queryId)
    if (!query) {
      return
    }

    this.pendingDnsQueries.delete(queryId)

    const errPayload = decodeDnsErrPayload(payload)
    if (errPayload) {
      query.resolve({
        success: false,
        addresses: [],
        errorCode: errPayload.error as DnsError,
        errorMessage: errPayload.message,
      })
    } else {
      query.resolve({
        success: false,
        addresses: [],
        errorCode: DnsError.ServerFailure,
        errorMessage: 'Unknown DNS error',
      })
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(): void {
    const wasConnected = this.state === TunnelState.Connected
    this.disconnect()

    if (wasConnected && this.config.autoReconnect) {
      setTimeout(() => this.connect(), 1000)
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleError(): void {
    this.disconnect(new Error('WebSocket error'))
    this.connectResolve?.(false)
  }
}

/**
 * Global tunnel manager registry
 */
export class TunnelRegistry {
  private readonly tunnels: Map<string, WsTunnelManager> = new Map()

  /**
   * Get or create a tunnel for a gateway URL
   */
  getOrCreate(config: TunnelConfig): WsTunnelManager {
    let tunnel = this.tunnels.get(config.gatewayUrl)
    if (!tunnel) {
      tunnel = new WsTunnelManager(config)
      this.tunnels.set(config.gatewayUrl, tunnel)
    }
    return tunnel
  }

  /**
   * Get a tunnel by URL
   */
  get(gatewayUrl: string): WsTunnelManager | undefined {
    return this.tunnels.get(gatewayUrl)
  }

  /**
   * Remove a tunnel
   */
  remove(gatewayUrl: string): void {
    const tunnel = this.tunnels.get(gatewayUrl)
    if (tunnel) {
      tunnel.disconnect()
      this.tunnels.delete(gatewayUrl)
    }
  }

  /**
   * Disconnect and remove all tunnels
   */
  clear(): void {
    for (const tunnel of this.tunnels.values()) {
      tunnel.disconnect()
    }
    this.tunnels.clear()
  }
}

/**
 * Global tunnel registry
 */
export const globalTunnelRegistry = new TunnelRegistry()
