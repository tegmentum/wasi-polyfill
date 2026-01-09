/**
 * Proxy Client Multiplexer
 *
 * Browser-side WebSocket client that multiplexes multiple streams
 * over a single WebSocket connection to the proxy server.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Stream multiplexing with flow control
 * - Request/response correlation
 * - Graceful connection shutdown
 */

import {
  PROTOCOL_VERSION,
  DEFAULT_WINDOW_SIZE,
  MessageType,
  FrameFlags,
  ErrorCode,
  StreamType,
  StreamState,
  type Frame,
  type HelloAckPayload,
  type OpenAckPayload,
  createFrame,
  parseFrame,
  encodeHello,
  encodeError,
  decodeError,
  decodeString,
  ProtocolError,
} from './protocol.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Connection state
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  HANDSHAKING = 'handshaking',
  CONNECTED = 'connected',
  CLOSING = 'closing',
  CLOSED = 'closed',
}

/**
 * Client configuration
 */
export interface ProxyClientConfig {
  /**
   * WebSocket URL of the proxy server
   */
  url: string

  /**
   * Reconnect on connection loss
   * @default true
   */
  autoReconnect?: boolean

  /**
   * Maximum reconnect attempts (0 = unlimited)
   * @default 10
   */
  maxReconnectAttempts?: number

  /**
   * Initial reconnect delay in milliseconds
   * @default 1000
   */
  reconnectDelay?: number

  /**
   * Maximum reconnect delay in milliseconds
   * @default 30000
   */
  maxReconnectDelay?: number

  /**
   * Connection timeout in milliseconds
   * @default 10000
   */
  connectTimeout?: number

  /**
   * Ping interval in milliseconds (0 = disabled)
   * @default 30000
   */
  pingInterval?: number

  /**
   * Maximum concurrent streams
   * @default 100
   */
  maxStreams?: number

  /**
   * Initial window size for flow control
   * @default 65536
   */
  initialWindowSize?: number

  /**
   * Capabilities to advertise
   * @default ['tcp', 'udp', 'dns', 'http', 'fs']
   */
  capabilities?: string[]
}

/**
 * Stream configuration
 */
export interface StreamConfig {
  streamType: StreamType
  onData?: (data: Uint8Array) => void
  onEnd?: () => void
  onError?: (error: Error) => void
}

/**
 * Connection event handlers
 */
export interface ConnectionEvents {
  onConnect?: () => void
  onDisconnect?: (reason?: string) => void
  onError?: (error: Error) => void
  onReconnecting?: (attempt: number) => void
}

// =============================================================================
// Resolved Config
// =============================================================================

interface ResolvedConfig {
  url: string
  autoReconnect: boolean
  maxReconnectAttempts: number
  reconnectDelay: number
  maxReconnectDelay: number
  connectTimeout: number
  pingInterval: number
  maxStreams: number
  initialWindowSize: number
  capabilities: string[]
}

// =============================================================================
// Stream
// =============================================================================

/**
 * Multiplexed stream
 */
export class ProxyStream {
  private _state: StreamState = StreamState.IDLE
  private sendWindow: number
  private receiveWindow: number
  private pendingData: Uint8Array[] = []
  private dataQueue: Uint8Array[] = []
  private readResolvers: Array<{
    resolve: (data: Uint8Array | null) => void
    reject: (error: Error) => void
  }> = []

  constructor(
    public readonly id: number,
    public readonly type: StreamType,
    private readonly client: ProxyClient,
    private readonly config: StreamConfig,
    initialWindow: number
  ) {
    this.sendWindow = initialWindow
    this.receiveWindow = initialWindow
  }

  get state(): StreamState {
    return this._state
  }

  /**
   * Write data to the stream
   */
  async write(data: Uint8Array): Promise<void> {
    if (this._state !== StreamState.OPEN && this._state !== StreamState.HALF_CLOSED_REMOTE) {
      throw new Error(`Cannot write to stream in state: ${this._state}`)
    }

    // Queue data if send window is exhausted
    if (data.length > this.sendWindow) {
      this.pendingData.push(data)
      return
    }

    this.sendWindow -= data.length
    await this.client.sendFrame(MessageType.DATA, this.id, data)
  }

  /**
   * Read data from the stream
   */
  async read(): Promise<Uint8Array | null> {
    // Return queued data first
    if (this.dataQueue.length > 0) {
      return this.dataQueue.shift()!
    }

    // Check if stream is closed
    if (this._state === StreamState.HALF_CLOSED_REMOTE || this._state === StreamState.CLOSED) {
      return null
    }

    // Wait for data
    return new Promise((resolve, reject) => {
      this.readResolvers.push({ resolve, reject })
    })
  }

  /**
   * Close the stream for writing
   */
  async close(): Promise<void> {
    if (this._state === StreamState.CLOSED) {
      return
    }

    await this.client.sendFrame(MessageType.CLOSE, this.id, new Uint8Array(0), FrameFlags.END_STREAM)

    if (this._state === StreamState.HALF_CLOSED_REMOTE) {
      this._state = StreamState.CLOSED
    } else {
      this._state = StreamState.HALF_CLOSED_LOCAL
    }
  }

  /**
   * Reset the stream with an error
   */
  async reset(errorCode: ErrorCode = ErrorCode.CANCEL): Promise<void> {
    const payload = encodeError({ errorCode, message: 'Stream reset' })
    await this.client.sendFrame(MessageType.RESET, this.id, payload)
    this._state = StreamState.CLOSED
    this.cleanup(new Error(`Stream reset: ${ErrorCode[errorCode]}`))
  }

  // Internal methods used by client

  /** @internal */
  handleData(data: Uint8Array, endStream: boolean): void {
    // Update receive window
    this.receiveWindow -= data.length

    // Send window update if needed
    if (this.receiveWindow < DEFAULT_WINDOW_SIZE / 2) {
      const increment = DEFAULT_WINDOW_SIZE - this.receiveWindow
      this.receiveWindow = DEFAULT_WINDOW_SIZE
      this.sendWindowUpdate(increment)
    }

    // Deliver to callback or queue
    if (this.config.onData) {
      this.config.onData(data)
    } else if (this.readResolvers.length > 0) {
      const resolver = this.readResolvers.shift()!
      resolver.resolve(data)
    } else {
      this.dataQueue.push(data)
    }

    if (endStream) {
      this.handleRemoteClose()
    }
  }

  /** @internal */
  handleRemoteClose(): void {
    if (this._state === StreamState.HALF_CLOSED_LOCAL) {
      this._state = StreamState.CLOSED
    } else {
      this._state = StreamState.HALF_CLOSED_REMOTE
    }

    if (this.config.onEnd) {
      this.config.onEnd()
    }

    // Resolve pending reads with null
    for (const resolver of this.readResolvers) {
      resolver.resolve(null)
    }
    this.readResolvers = []
  }

  /** @internal */
  handleReset(error: Error): void {
    this._state = StreamState.CLOSED
    this.cleanup(error)
  }

  /** @internal */
  handleWindowUpdate(increment: number): void {
    this.sendWindow += increment

    // Flush pending data
    this.flushPendingData()
  }

  /** @internal */
  setState(state: StreamState): void {
    this._state = state
  }

  private async sendWindowUpdate(increment: number): Promise<void> {
    const payload = new Uint8Array(4)
    const view = new DataView(payload.buffer)
    view.setUint32(0, increment, true)
    await this.client.sendFrame(MessageType.WINDOW_UPDATE, this.id, payload)
  }

  private flushPendingData(): void {
    while (this.pendingData.length > 0 && this.sendWindow > 0) {
      const data = this.pendingData[0]!
      if (data.length <= this.sendWindow) {
        this.pendingData.shift()
        this.sendWindow -= data.length
        this.client.sendFrame(MessageType.DATA, this.id, data)
      } else {
        break
      }
    }
  }

  private cleanup(error?: Error): void {
    if (this.config.onError && error) {
      this.config.onError(error)
    }

    // Reject pending reads
    for (const resolver of this.readResolvers) {
      resolver.reject(error ?? new Error('Stream closed'))
    }
    this.readResolvers = []
    this.pendingData = []
    this.dataQueue = []
  }
}

// =============================================================================
// Proxy Client
// =============================================================================

/**
 * WebSocket proxy client with stream multiplexing
 */
export class ProxyClient {
  private ws: WebSocket | null = null
  private _state: ConnectionState = ConnectionState.DISCONNECTED
  private readonly config: ResolvedConfig
  private readonly events: ConnectionEvents

  private nextStreamId = 1
  private readonly streams: Map<number, ProxyStream> = new Map()
  private receiveBuffer: Uint8Array = new Uint8Array(0)

  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null

  private pendingRequests: Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  > = new Map()

  private serverCapabilities: string[] = []
  private serverMaxStreams = 100
  private serverWindowSize = DEFAULT_WINDOW_SIZE

  // Connection-level flow control
  private connectionSendWindow = DEFAULT_WINDOW_SIZE
  private connectionReceiveWindow = DEFAULT_WINDOW_SIZE
  private connectionPendingData: Array<{
    type: MessageType
    streamId: number
    payload: Uint8Array
    flags: number
    resolve: () => void
    reject: (error: Error) => void
  }> = []

  constructor(config: ProxyClientConfig, events: ConnectionEvents = {}) {
    this.config = {
      url: config.url,
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      reconnectDelay: config.reconnectDelay ?? 1000,
      maxReconnectDelay: config.maxReconnectDelay ?? 30000,
      connectTimeout: config.connectTimeout ?? 10000,
      pingInterval: config.pingInterval ?? 30000,
      maxStreams: config.maxStreams ?? 100,
      initialWindowSize: config.initialWindowSize ?? DEFAULT_WINDOW_SIZE,
      capabilities: config.capabilities ?? ['tcp', 'udp', 'dns', 'http', 'fs'],
    }
    this.events = events
  }

  get state(): ConnectionState {
    return this._state
  }

  get capabilities(): string[] {
    return [...this.serverCapabilities]
  }

  /**
   * Connect to the proxy server
   */
  async connect(): Promise<void> {
    if (this._state !== ConnectionState.DISCONNECTED && this._state !== ConnectionState.CLOSED) {
      throw new Error(`Cannot connect in state: ${this._state}`)
    }

    this._state = ConnectionState.CONNECTING
    this.reconnectAttempts = 0

    return this.doConnect()
  }

  /**
   * Disconnect from the proxy server
   */
  async disconnect(): Promise<void> {
    if (this._state === ConnectionState.DISCONNECTED || this._state === ConnectionState.CLOSED) {
      return
    }

    this._state = ConnectionState.CLOSING
    this.cancelReconnect()
    this.stopPingTimer()
    this.clearConnectTimeout()

    if (this.ws) {
      // Send GOAWAY if connected
      if (this.ws.readyState === WebSocket.OPEN) {
        try {
          const payload = new Uint8Array(8)
          const view = new DataView(payload.buffer)
          view.setUint32(0, this.nextStreamId - 2, true) // last stream id
          view.setUint32(4, ErrorCode.OK, true)
          await this.sendFrame(MessageType.GOAWAY, 0, payload)
        } catch {
          // Ignore errors during shutdown
        }
      }

      this.ws.close()
      this.ws = null
    }

    this._state = ConnectionState.CLOSED
    this.cleanupStreams()

    if (this.events.onDisconnect) {
      this.events.onDisconnect()
    }
  }

  /**
   * Open a new stream
   */
  async openStream(config: StreamConfig): Promise<ProxyStream> {
    if (this._state !== ConnectionState.CONNECTED) {
      throw new Error(`Cannot open stream in state: ${this._state}`)
    }

    if (this.streams.size >= Math.min(this.config.maxStreams, this.serverMaxStreams)) {
      throw new Error('Maximum streams exceeded')
    }

    const streamId = this.nextStreamId
    this.nextStreamId += 2 // Client-initiated streams are odd

    const stream = new ProxyStream(streamId, config.streamType, this, config, this.serverWindowSize)

    this.streams.set(streamId, stream)

    // Send OPEN frame
    const payload = new Uint8Array(5)
    const view = new DataView(payload.buffer)
    view.setUint8(0, config.streamType)
    view.setUint32(1, this.config.initialWindowSize, true)

    await this.sendFrame(MessageType.OPEN, streamId, payload)

    // Wait for OPEN_ACK
    await this.waitForResponse(streamId, MessageType.OPEN_ACK)

    stream.setState(StreamState.OPEN)
    return stream
  }

  /**
   * Send a frame over the WebSocket
   * @internal
   */
  async sendFrame(type: MessageType, streamId: number, payload: Uint8Array, flags: number = 0): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }

    // DATA frames are subject to connection-level flow control
    if (type === MessageType.DATA && payload.length > 0) {
      // Check if we have enough connection window
      if (payload.length > this.connectionSendWindow) {
        // Queue the frame until window is available
        return new Promise((resolve, reject) => {
          this.connectionPendingData.push({
            type,
            streamId,
            payload,
            flags,
            resolve,
            reject,
          })
        })
      }

      // Decrement connection window
      this.connectionSendWindow -= payload.length
    }

    const frame = createFrame(type, streamId, payload, flags)
    this.ws.send(frame)
  }

  /**
   * Flush pending data when connection window becomes available
   * @internal
   */
  private flushConnectionPendingData(): void {
    while (this.connectionPendingData.length > 0 && this.connectionSendWindow > 0) {
      const pending = this.connectionPendingData[0]!
      if (pending.payload.length <= this.connectionSendWindow) {
        this.connectionPendingData.shift()
        this.connectionSendWindow -= pending.payload.length

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const frame = createFrame(pending.type, pending.streamId, pending.payload, pending.flags)
          this.ws.send(frame)
          pending.resolve()
        } else {
          pending.reject(new Error('WebSocket not connected'))
        }
      } else {
        break
      }
    }
  }

  /**
   * Send connection-level window update
   * @internal
   */
  private sendConnectionWindowUpdate(increment: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    const payload = new Uint8Array(4)
    const view = new DataView(payload.buffer)
    view.setUint32(0, increment, true)

    // Connection-level window update uses streamId 0
    const frame = createFrame(MessageType.WINDOW_UPDATE, 0, payload)
    this.ws.send(frame)
  }

  /**
   * Send a request and wait for response
   */
  async request<T>(type: MessageType, streamId: number, payload: Uint8Array, timeoutMs: number = 30000): Promise<T> {
    await this.sendFrame(type, streamId, payload)
    return this.waitForResponse<T>(streamId, type + 1, timeoutMs) // Assumes ACK is type + 1
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url)
        this.ws.binaryType = 'arraybuffer'

        // Set connection timeout
        this.connectTimeoutTimer = setTimeout(() => {
          if (this._state === ConnectionState.CONNECTING || this._state === ConnectionState.HANDSHAKING) {
            this.ws?.close()
            reject(new Error('Connection timeout'))
          }
        }, this.config.connectTimeout)

        this.ws.onopen = () => {
          this._state = ConnectionState.HANDSHAKING
          this.sendHello()
            .then(() => {
              this.clearConnectTimeout()
              this._state = ConnectionState.CONNECTED
              this.reconnectAttempts = 0
              this.startPingTimer()

              if (this.events.onConnect) {
                this.events.onConnect()
              }

              resolve()
            })
            .catch((err) => {
              this.clearConnectTimeout()
              reject(err)
            })
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data as ArrayBuffer)
        }

        this.ws.onerror = () => {
          const error = new Error('WebSocket error')
          if (this.events.onError) {
            this.events.onError(error)
          }
        }

        this.ws.onclose = (event) => {
          this.handleClose(event.code, event.reason)
        }
      } catch (error) {
        this.clearConnectTimeout()
        reject(error)
      }
    })
  }

  private async sendHello(): Promise<void> {
    const payload = encodeHello({
      clientVersion: PROTOCOL_VERSION,
      maxStreams: this.config.maxStreams,
      initialWindowSize: this.config.initialWindowSize,
      capabilities: this.config.capabilities,
    })

    await this.sendFrame(MessageType.HELLO, 0, payload)

    // Wait for HELLO_ACK
    const response = await this.waitForResponse<HelloAckPayload>(0, MessageType.HELLO_ACK, this.config.connectTimeout)

    this.serverCapabilities = response.capabilities
    this.serverMaxStreams = response.maxStreams
    this.serverWindowSize = response.initialWindowSize

    // Initialize connection-level windows based on server's window size
    this.connectionSendWindow = response.initialWindowSize
    this.connectionReceiveWindow = this.config.initialWindowSize
  }

  private handleMessage(data: ArrayBuffer): void {
    // Append to receive buffer
    const newData = new Uint8Array(data)
    const combined = new Uint8Array(this.receiveBuffer.length + newData.length)
    combined.set(this.receiveBuffer, 0)
    combined.set(newData, this.receiveBuffer.length)
    this.receiveBuffer = combined

    // Parse complete frames
    while (true) {
      const result = parseFrame(this.receiveBuffer)
      if (!result) break

      const { frame, bytesConsumed } = result
      this.receiveBuffer = this.receiveBuffer.slice(bytesConsumed)

      this.handleFrame(frame)
    }
  }

  private handleFrame(frame: Frame): void {
    const { header, payload } = frame

    switch (header.type) {
      case MessageType.HELLO_ACK:
        this.resolveRequest(header.streamId, MessageType.HELLO_ACK, this.decodeHelloAck(payload))
        break

      case MessageType.PONG:
        // Ping response, reset timeout
        break

      case MessageType.GOAWAY:
        this.handleGoaway(payload)
        break

      case MessageType.OPEN_ACK:
        this.resolveRequest(header.streamId, MessageType.OPEN_ACK, this.decodeOpenAck(payload))
        break

      case MessageType.DATA:
        this.handleData(header.streamId, payload, (header.flags & FrameFlags.END_STREAM) !== 0)
        break

      case MessageType.CLOSE:
        this.handleStreamClose(header.streamId)
        break

      case MessageType.RESET:
        this.handleStreamReset(header.streamId, payload)
        break

      case MessageType.WINDOW_UPDATE:
        this.handleWindowUpdate(header.streamId, payload)
        break

      case MessageType.ERROR:
        this.handleError(header.streamId, payload)
        break

      // Response messages resolve pending requests
      case MessageType.TCP_CONNECT_ACK:
      case MessageType.UDP_BIND_ACK:
      case MessageType.DNS_RESPONSE:
      case MessageType.HTTP_RESPONSE_HEAD:
      case MessageType.HTTP_RESPONSE_BODY:
      case MessageType.HTTP_RESPONSE_TRAILERS:
      case MessageType.FS_OPEN_ACK:
      case MessageType.FS_READ_ACK:
      case MessageType.FS_WRITE_ACK:
      case MessageType.FS_STAT_ACK:
      case MessageType.FS_READDIR_ACK:
        this.resolveRequest(header.streamId, header.type, payload)
        break

      default:
        console.warn(`Unknown message type: ${header.type}`)
    }
  }

  private handleData(streamId: number, data: Uint8Array, endStream: boolean): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      // Unknown stream, send reset
      this.sendFrame(MessageType.RESET, streamId, encodeError({ errorCode: ErrorCode.STREAM_CLOSED, message: 'Unknown stream' }))
      return
    }

    // Track connection-level receive window
    this.connectionReceiveWindow -= data.length

    // Send connection-level window update if needed
    if (this.connectionReceiveWindow < DEFAULT_WINDOW_SIZE / 2) {
      const increment = DEFAULT_WINDOW_SIZE - this.connectionReceiveWindow
      this.connectionReceiveWindow = DEFAULT_WINDOW_SIZE
      this.sendConnectionWindowUpdate(increment)
    }

    stream.handleData(data, endStream)
  }

  private handleStreamClose(streamId: number): void {
    const stream = this.streams.get(streamId)
    if (!stream) return

    stream.handleRemoteClose()
  }

  private handleStreamReset(streamId: number, payload: Uint8Array): void {
    const stream = this.streams.get(streamId)
    if (!stream) return

    const error = decodeError(payload)
    stream.handleReset(new ProtocolError(error.errorCode, error.message))
    this.streams.delete(streamId)
  }

  private handleWindowUpdate(streamId: number, payload: Uint8Array): void {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const increment = view.getUint32(0, true)

    if (streamId === 0) {
      // Connection-level window update
      this.connectionSendWindow += increment
      // Flush any pending data that was blocked on connection window
      this.flushConnectionPendingData()
    } else {
      const stream = this.streams.get(streamId)
      if (stream) {
        stream.handleWindowUpdate(increment)
      }
    }
  }

  private handleGoaway(payload: Uint8Array): void {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const lastStreamId = view.getUint32(0, true)
    const errorCode = view.getUint32(4, true) as ErrorCode

    // Close all streams with ID > lastStreamId
    for (const [id, stream] of this.streams) {
      if (id > lastStreamId) {
        stream.handleReset(new ProtocolError(errorCode, 'Server sent GOAWAY'))
        this.streams.delete(id)
      }
    }

    // Initiate graceful shutdown
    this.disconnect()
  }

  private handleError(streamId: number, payload: Uint8Array): void {
    const error = decodeError(payload)

    if (streamId === 0) {
      // Connection-level error
      if (this.events.onError) {
        this.events.onError(new ProtocolError(error.errorCode, error.message))
      }
    } else {
      // Stream-level error
      const stream = this.streams.get(streamId)
      if (stream) {
        stream.handleReset(new ProtocolError(error.errorCode, error.message))
        this.streams.delete(streamId)
      }

      // Reject pending request if any
      this.rejectRequest(streamId, new ProtocolError(error.errorCode, error.message))
    }
  }

  private handleClose(code: number, reason: string): void {
    this.clearConnectTimeout()
    this.stopPingTimer()

    const wasConnected = this._state === ConnectionState.CONNECTED

    this._state = ConnectionState.DISCONNECTED
    this.ws = null

    this.cleanupStreams()
    this.rejectAllRequests(new Error(`WebSocket closed: ${code} ${reason}`))

    if (this.events.onDisconnect) {
      this.events.onDisconnect(reason || `Code: ${code}`)
    }

    // Attempt reconnection if enabled and was connected
    if (this.config.autoReconnect && wasConnected) {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.config.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      if (this.events.onError) {
        this.events.onError(new Error('Max reconnect attempts exceeded'))
      }
      return
    }

    this.reconnectAttempts++

    // Exponential backoff
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.maxReconnectDelay
    )

    if (this.events.onReconnecting) {
      this.events.onReconnecting(this.reconnectAttempts)
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._state = ConnectionState.CONNECTING
      this.doConnect().catch((error) => {
        if (this.events.onError) {
          this.events.onError(error)
        }
        this.scheduleReconnect()
      })
    }, delay)
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private startPingTimer(): void {
    if (this.config.pingInterval <= 0) return

    this.pingTimer = setInterval(() => {
      if (this._state === ConnectionState.CONNECTED) {
        this.sendFrame(MessageType.PING, 0, new Uint8Array(0)).catch(() => {
          // Ignore ping errors
        })
      }
    }, this.config.pingInterval)
  }

  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer)
      this.connectTimeoutTimer = null
    }
  }

  private waitForResponse<T>(streamId: number, expectedType: MessageType, timeoutMs: number = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      const key = this.getRequestKey(streamId, expectedType)
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(key)
        reject(new Error(`Request timeout waiting for ${MessageType[expectedType]}`))
      }, timeoutMs)

      this.pendingRequests.set(key, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      })
    })
  }

  private resolveRequest(streamId: number, type: MessageType, value: unknown): void {
    const key = this.getRequestKey(streamId, type)
    const pending = this.pendingRequests.get(key)
    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(key)
      pending.resolve(value)
    }
  }

  private rejectRequest(streamId: number, error: Error): void {
    // Reject any pending request for this stream
    for (const [key, pending] of this.pendingRequests) {
      if (key.startsWith(`${streamId}:`)) {
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(key)
        pending.reject(error)
      }
    }
  }

  private rejectAllRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private getRequestKey(streamId: number, type: MessageType): string {
    return `${streamId}:${type}`
  }

  private cleanupStreams(): void {
    for (const stream of this.streams.values()) {
      stream.handleReset(new Error('Connection closed'))
    }
    this.streams.clear()

    // Reject pending connection-level data
    for (const pending of this.connectionPendingData) {
      pending.reject(new Error('Connection closed'))
    }
    this.connectionPendingData = []

    // Reset connection windows
    this.connectionSendWindow = DEFAULT_WINDOW_SIZE
    this.connectionReceiveWindow = DEFAULT_WINDOW_SIZE
  }

  private decodeHelloAck(payload: Uint8Array): HelloAckPayload {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)

    const serverVersion = view.getUint32(0, true)
    const maxStreams = view.getUint32(4, true)
    const initialWindowSize = view.getUint32(8, true)
    const capCount = view.getUint32(12, true)

    const capabilities: string[] = []
    let offset = 16
    for (let i = 0; i < capCount; i++) {
      const { value, bytesRead } = decodeString(payload, offset)
      capabilities.push(value)
      offset += bytesRead
    }

    return { serverVersion, maxStreams, initialWindowSize, capabilities }
  }

  private decodeOpenAck(payload: Uint8Array): OpenAckPayload {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    return { windowSize: view.getUint32(0, true) }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new proxy client
 */
export function createProxyClient(config: ProxyClientConfig, events?: ConnectionEvents): ProxyClient {
  return new ProxyClient(config, events)
}
