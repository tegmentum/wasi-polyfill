/**
 * Proxy Server Reference Implementation
 *
 * Node.js WebSocket server that handles multiplexed WASI operations
 * from browser clients. Provides actual network and filesystem access.
 *
 * Features:
 * - WebSocket server with multiple client support
 * - Protocol handshake and capability negotiation
 * - Pluggable adapters for TCP, UDP, DNS, HTTP, filesystem
 * - Connection and stream lifecycle management
 */

import type { IncomingMessage } from 'http'
import type { WebSocket as WsWebSocket, WebSocketServer as WsServer } from 'ws'

import {
  PROTOCOL_VERSION,
  DEFAULT_WINDOW_SIZE,
  MessageType,
  FrameFlags,
  ErrorCode,
  StreamType,
  StreamState,
  type Frame,
  createFrame,
  parseFrame,
  decodeHello,
  encodeError,
  decodeError,
  encodeString,
  ProtocolError,
} from './protocol.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Server configuration
 */
export interface ProxyServerConfig {
  /**
   * Port to listen on
   * @default 8080
   */
  port?: number

  /**
   * Host to bind to
   * @default '127.0.0.1'
   */
  host?: string

  /**
   * Path for WebSocket endpoint
   * @default '/proxy'
   */
  path?: string

  /**
   * Maximum clients
   * @default 100
   */
  maxClients?: number

  /**
   * Maximum streams per client
   * @default 100
   */
  maxStreamsPerClient?: number

  /**
   * Initial window size
   * @default 65536
   */
  initialWindowSize?: number

  /**
   * Ping interval in ms (0 = disabled)
   * @default 30000
   */
  pingInterval?: number

  /**
   * Client timeout in ms (0 = disabled)
   * @default 60000
   */
  clientTimeout?: number

  /**
   * Capabilities to advertise
   * @default ['tcp', 'udp', 'dns', 'http', 'fs']
   */
  capabilities?: string[]

  /**
   * Allowed origins (empty = all allowed)
   */
  allowedOrigins?: string[]

  /**
   * Authentication callback
   */
  authenticate?: (request: IncomingMessage) => boolean | Promise<boolean>
}

/**
 * Stream adapter interface
 */
export interface StreamAdapter {
  /**
   * Handle stream open
   */
  onOpen(stream: ServerStream, payload: Uint8Array): Promise<void>

  /**
   * Handle data from client
   */
  onData(stream: ServerStream, data: Uint8Array): Promise<void>

  /**
   * Handle stream close
   */
  onClose(stream: ServerStream): Promise<void>

  /**
   * Handle stream reset
   */
  onReset(stream: ServerStream, error: Error): Promise<void>
}

/**
 * Adapter registry
 */
export interface AdapterRegistry {
  tcp?: StreamAdapter
  udp?: StreamAdapter
  dns?: StreamAdapter
  http?: StreamAdapter
  fs?: StreamAdapter
}

/**
 * Server events
 */
export interface ServerEvents {
  onClientConnect?: (client: ClientConnection) => void
  onClientDisconnect?: (client: ClientConnection, reason?: string) => void
  onError?: (error: Error, client?: ClientConnection) => void
}

// =============================================================================
// Resolved Config
// =============================================================================

interface ResolvedConfig {
  port: number
  host: string
  path: string
  maxClients: number
  maxStreamsPerClient: number
  initialWindowSize: number
  pingInterval: number
  clientTimeout: number
  capabilities: string[]
  allowedOrigins: string[]
  authenticate?: (request: IncomingMessage) => boolean | Promise<boolean>
}

// =============================================================================
// Server Stream
// =============================================================================

/**
 * Server-side stream representation
 */
export class ServerStream {
  private _state: StreamState = StreamState.IDLE
  private sendWindow: number
  private receiveWindow: number
  private adapter: StreamAdapter | null = null

  constructor(
    public readonly id: number,
    public readonly type: StreamType,
    private readonly client: ClientConnection,
    initialWindow: number
  ) {
    this.sendWindow = initialWindow
    this.receiveWindow = initialWindow
  }

  get state(): StreamState {
    return this._state
  }

  /**
   * Send data to client
   */
  async write(data: Uint8Array, endStream: boolean = false): Promise<void> {
    if (this._state !== StreamState.OPEN && this._state !== StreamState.HALF_CLOSED_REMOTE) {
      throw new Error(`Cannot write to stream in state: ${this._state}`)
    }

    const flags = endStream ? FrameFlags.END_STREAM : FrameFlags.NONE
    await this.client.sendFrame(MessageType.DATA, this.id, data, flags)

    if (endStream) {
      if (this._state === StreamState.HALF_CLOSED_REMOTE) {
        this._state = StreamState.CLOSED
      } else {
        this._state = StreamState.HALF_CLOSED_LOCAL
      }
    }
  }

  /**
   * Close the stream for writing
   */
  async close(errorCode: ErrorCode = ErrorCode.OK): Promise<void> {
    if (this._state === StreamState.CLOSED) {
      return
    }

    const payload = new Uint8Array(4)
    const view = new DataView(payload.buffer)
    view.setUint32(0, errorCode, true)

    await this.client.sendFrame(MessageType.CLOSE, this.id, payload, FrameFlags.END_STREAM)

    if (this._state === StreamState.HALF_CLOSED_REMOTE) {
      this._state = StreamState.CLOSED
    } else {
      this._state = StreamState.HALF_CLOSED_LOCAL
    }
  }

  /**
   * Reset the stream with error
   */
  async reset(errorCode: ErrorCode, message: string): Promise<void> {
    const payload = encodeError({ errorCode, message })
    await this.client.sendFrame(MessageType.RESET, this.id, payload)
    this._state = StreamState.CLOSED
  }

  /**
   * Send window update
   */
  async sendWindowUpdate(increment: number): Promise<void> {
    const payload = new Uint8Array(4)
    const view = new DataView(payload.buffer)
    view.setUint32(0, increment, true)
    await this.client.sendFrame(MessageType.WINDOW_UPDATE, this.id, payload)
    this.receiveWindow += increment
  }

  // Internal methods

  /** @internal */
  setAdapter(adapter: StreamAdapter): void {
    this.adapter = adapter
  }

  /** @internal */
  getAdapter(): StreamAdapter | null {
    return this.adapter
  }

  /** @internal */
  setState(state: StreamState): void {
    this._state = state
  }

  /** @internal */
  handleWindowUpdate(increment: number): void {
    this.sendWindow += increment
  }

  /** @internal */
  consumeReceiveWindow(size: number): void {
    this.receiveWindow -= size
  }

  /** @internal */
  get needsWindowUpdate(): boolean {
    return this.receiveWindow < DEFAULT_WINDOW_SIZE / 2
  }
}

// =============================================================================
// Client Connection
// =============================================================================

/**
 * Represents a connected client
 */
export class ClientConnection {
  public readonly id: string
  private _state: 'handshaking' | 'connected' | 'closing' | 'closed' = 'handshaking'
  private readonly streams: Map<number, ServerStream> = new Map()
  private receiveBuffer: Uint8Array = new Uint8Array(0)
  private nextStreamId = 2 // Server-initiated streams are even
  private lastActivity: number = Date.now()
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private clientCapabilities: string[] = []

  // Connection-level flow control
  private connectionSendWindow: number
  private connectionReceiveWindow: number
  private connectionPendingData: Array<{
    type: MessageType
    streamId: number
    payload: Uint8Array
    flags: number
    resolve: () => void
    reject: (error: Error) => void
  }> = []

  constructor(
    private readonly ws: WsWebSocket,
    private readonly server: ProxyServer,
    private readonly config: ResolvedConfig
  ) {
    this.id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.connectionSendWindow = config.initialWindowSize
    this.connectionReceiveWindow = config.initialWindowSize
    this.setupWebSocket()
  }

  get state(): string {
    return this._state
  }

  get capabilities(): string[] {
    return [...this.clientCapabilities]
  }

  get streamCount(): number {
    return this.streams.size
  }

  /**
   * Send a frame to the client
   */
  async sendFrame(type: MessageType, streamId: number, payload: Uint8Array, flags: number = 0): Promise<void> {
    if (this.ws.readyState !== 1) {
      // WebSocket.OPEN = 1
      throw new Error('WebSocket not open')
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
    return new Promise((resolve, reject) => {
      this.ws.send(frame, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
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

        if (this.ws.readyState === 1) {
          const frame = createFrame(pending.type, pending.streamId, pending.payload, pending.flags)
          this.ws.send(frame, (err) => {
            if (err) pending.reject(err)
            else pending.resolve()
          })
        } else {
          pending.reject(new Error('WebSocket not open'))
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
    if (this.ws.readyState !== 1) {
      return
    }

    const payload = new Uint8Array(4)
    const view = new DataView(payload.buffer)
    view.setUint32(0, increment, true)

    // Connection-level window update uses streamId 0
    const frame = createFrame(MessageType.WINDOW_UPDATE, 0, payload)
    this.ws.send(frame, () => {
      // Ignore send errors for window updates
    })
  }

  /**
   * Close the connection
   */
  async close(_reason?: string): Promise<void> {
    if (this._state === 'closed') return

    this._state = 'closing'
    this.stopPingTimer()

    // Send GOAWAY
    try {
      const payload = new Uint8Array(8)
      const view = new DataView(payload.buffer)
      view.setUint32(0, this.nextStreamId - 2, true)
      view.setUint32(4, ErrorCode.OK, true)
      await this.sendFrame(MessageType.GOAWAY, 0, payload)
    } catch {
      // Ignore errors during close
    }

    // Close all streams
    for (const stream of this.streams.values()) {
      const adapter = stream.getAdapter()
      if (adapter) {
        try {
          await adapter.onClose(stream)
        } catch {
          // Ignore adapter errors during close
        }
      }
    }
    this.streams.clear()

    this.ws.close()
    this._state = 'closed'
  }

  /**
   * Get a stream by ID
   */
  getStream(streamId: number): ServerStream | undefined {
    return this.streams.get(streamId)
  }

  // Internal methods

  /** @internal */
  updateActivity(): void {
    this.lastActivity = Date.now()
  }

  /** @internal */
  isTimedOut(timeout: number): boolean {
    return timeout > 0 && Date.now() - this.lastActivity > timeout
  }

  private setupWebSocket(): void {
    this.ws.on('message', (data: Buffer) => {
      this.updateActivity()
      this.handleMessage(data)
    })

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.handleClose(code, reason.toString())
    })

    this.ws.on('error', (error: Error) => {
      this.server.handleClientError(this, error)
    })

    this.ws.on('pong', () => {
      this.updateActivity()
    })
  }

  private handleMessage(data: Buffer): void {
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

    try {
      switch (header.type) {
        case MessageType.HELLO:
          this.handleHello(payload)
          break

        case MessageType.PING:
          this.sendFrame(MessageType.PONG, 0, new Uint8Array(0))
          break

        case MessageType.GOAWAY:
          this.handleGoaway(payload)
          break

        case MessageType.OPEN:
          this.handleOpen(header.streamId, payload)
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

        // Operation requests - delegate to adapters
        case MessageType.TCP_CONNECT:
        case MessageType.TCP_LISTEN:
        case MessageType.TCP_SHUTDOWN:
        case MessageType.UDP_BIND:
        case MessageType.UDP_SENDTO:
        case MessageType.DNS_QUERY:
        case MessageType.HTTP_REQUEST:
        case MessageType.FS_OPEN:
        case MessageType.FS_READ:
        case MessageType.FS_WRITE:
        case MessageType.FS_STAT:
        case MessageType.FS_READDIR:
        case MessageType.FS_CLOSE:
        case MessageType.FS_UNLINK:
        case MessageType.FS_MKDIR:
        case MessageType.FS_RMDIR:
        case MessageType.FS_RENAME:
          this.handleOperationRequest(header.streamId, header.type, payload)
          break

        default:
          this.sendError(header.streamId, ErrorCode.PROTOCOL_ERROR, `Unknown message type: ${header.type}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.sendError(header.streamId, ErrorCode.INTERNAL_ERROR, message)
    }
  }

  private handleHello(payload: Uint8Array): void {
    const hello = decodeHello(payload)

    this.clientCapabilities = hello.capabilities

    // Initialize connection-level windows based on client's window size
    this.connectionSendWindow = hello.initialWindowSize
    this.connectionReceiveWindow = this.config.initialWindowSize

    // Send HELLO_ACK
    const ackPayload = this.encodeHelloAck({
      serverVersion: PROTOCOL_VERSION,
      maxStreams: this.config.maxStreamsPerClient,
      initialWindowSize: this.config.initialWindowSize,
      capabilities: this.config.capabilities,
    })

    this.sendFrame(MessageType.HELLO_ACK, 0, ackPayload)

    this._state = 'connected'
    this.startPingTimer()

    this.server.handleClientConnected(this)
  }

  private handleGoaway(_payload: Uint8Array): void {
    // Client is initiating graceful shutdown
    this.close('Client sent GOAWAY')
  }

  private handleOpen(streamId: number, payload: Uint8Array): void {
    if (this._state !== 'connected') {
      this.sendError(streamId, ErrorCode.PROTOCOL_ERROR, 'Not connected')
      return
    }

    if (this.streams.size >= this.config.maxStreamsPerClient) {
      this.sendError(streamId, ErrorCode.REFUSED_STREAM, 'Maximum streams exceeded')
      return
    }

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const streamType = view.getUint8(0) as StreamType
    const initialWindowSize = view.getUint32(1, true)

    const stream = new ServerStream(streamId, streamType, this, Math.min(initialWindowSize, this.config.initialWindowSize))

    // Get adapter for stream type
    const adapter = this.server.getAdapter(streamType)
    if (!adapter) {
      this.sendError(streamId, ErrorCode.REFUSED_STREAM, `Unsupported stream type: ${streamType}`)
      return
    }

    stream.setAdapter(adapter)
    this.streams.set(streamId, stream)

    // Send OPEN_ACK
    const ackPayload = new Uint8Array(4)
    const ackView = new DataView(ackPayload.buffer)
    ackView.setUint32(0, this.config.initialWindowSize, true)

    this.sendFrame(MessageType.OPEN_ACK, streamId, ackPayload)

    stream.setState(StreamState.OPEN)

    // Notify adapter
    adapter.onOpen(stream, payload).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      stream.reset(ErrorCode.INTERNAL_ERROR, message)
    })
  }

  private handleData(streamId: number, data: Uint8Array, endStream: boolean): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      this.sendError(streamId, ErrorCode.STREAM_CLOSED, 'Unknown stream')
      return
    }

    // Track connection-level receive window
    this.connectionReceiveWindow -= data.length

    // Send connection-level window update if needed
    if (this.connectionReceiveWindow < this.config.initialWindowSize / 2) {
      const increment = this.config.initialWindowSize - this.connectionReceiveWindow
      this.connectionReceiveWindow = this.config.initialWindowSize
      this.sendConnectionWindowUpdate(increment)
    }

    stream.consumeReceiveWindow(data.length)

    // Send stream-level window update if needed
    if (stream.needsWindowUpdate) {
      stream.sendWindowUpdate(DEFAULT_WINDOW_SIZE - stream['receiveWindow'])
    }

    const adapter = stream.getAdapter()
    if (adapter) {
      adapter.onData(stream, data).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        stream.reset(ErrorCode.INTERNAL_ERROR, message)
      })
    }

    if (endStream) {
      if (stream.state === StreamState.HALF_CLOSED_LOCAL) {
        stream.setState(StreamState.CLOSED)
        this.streams.delete(streamId)
      } else {
        stream.setState(StreamState.HALF_CLOSED_REMOTE)
      }

      if (adapter) {
        adapter.onClose(stream).catch(() => {
          // Ignore close errors
        })
      }
    }
  }

  private handleStreamClose(streamId: number): void {
    const stream = this.streams.get(streamId)
    if (!stream) return

    const adapter = stream.getAdapter()
    if (adapter) {
      adapter.onClose(stream).catch(() => {
        // Ignore close errors
      })
    }

    if (stream.state === StreamState.HALF_CLOSED_LOCAL) {
      stream.setState(StreamState.CLOSED)
      this.streams.delete(streamId)
    } else {
      stream.setState(StreamState.HALF_CLOSED_REMOTE)
    }
  }

  private handleStreamReset(streamId: number, payload: Uint8Array): void {
    const stream = this.streams.get(streamId)
    if (!stream) return

    const error = decodeError(payload)
    const adapter = stream.getAdapter()
    if (adapter) {
      adapter.onReset(stream, new ProtocolError(error.errorCode, error.message)).catch(() => {
        // Ignore reset errors
      })
    }

    stream.setState(StreamState.CLOSED)
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

  private handleOperationRequest(streamId: number, type: MessageType, payload: Uint8Array): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      this.sendError(streamId, ErrorCode.STREAM_CLOSED, 'Unknown stream')
      return
    }

    const adapter = stream.getAdapter()
    if (!adapter) {
      this.sendError(streamId, ErrorCode.INTERNAL_ERROR, 'No adapter for stream')
      return
    }

    // For operation requests, we pass the full payload including the message type
    // to the adapter's onData method, which will dispatch to the appropriate handler
    const requestPayload = new Uint8Array(1 + payload.length)
    requestPayload[0] = type
    requestPayload.set(payload, 1)

    adapter.onData(stream, requestPayload).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      this.sendError(streamId, ErrorCode.INTERNAL_ERROR, message)
    })
  }

  private handleClose(code: number, reason: string): void {
    this.stopPingTimer()
    this._state = 'closed'

    // Reject pending connection-level data
    for (const pending of this.connectionPendingData) {
      pending.reject(new Error('Connection closed'))
    }
    this.connectionPendingData = []

    // Reset connection windows
    this.connectionSendWindow = this.config.initialWindowSize
    this.connectionReceiveWindow = this.config.initialWindowSize

    // Close all streams
    for (const stream of this.streams.values()) {
      const adapter = stream.getAdapter()
      if (adapter) {
        adapter.onClose(stream).catch(() => {})
      }
    }
    this.streams.clear()

    this.server.handleClientDisconnected(this, reason || `Code: ${code}`)
  }

  private sendError(streamId: number, code: ErrorCode, message: string): void {
    const payload = encodeError({ errorCode: code, message })
    this.sendFrame(MessageType.ERROR, streamId, payload).catch(() => {
      // Ignore send errors
    })
  }

  private startPingTimer(): void {
    if (this.config.pingInterval <= 0) return

    this.pingTimer = setInterval(() => {
      if (this.ws.readyState === 1) {
        // WebSocket.OPEN
        this.ws.ping()
      }
    }, this.config.pingInterval)
  }

  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private encodeHelloAck(payload: {
    serverVersion: number
    maxStreams: number
    initialWindowSize: number
    capabilities: string[]
  }): Uint8Array {
    const capabilities = payload.capabilities.map(encodeString)
    const capLen = capabilities.reduce((sum, c) => sum + c.length, 0)

    const result = new Uint8Array(16 + capLen)
    const view = new DataView(result.buffer)

    view.setUint32(0, payload.serverVersion, true)
    view.setUint32(4, payload.maxStreams, true)
    view.setUint32(8, payload.initialWindowSize, true)
    view.setUint32(12, payload.capabilities.length, true)

    let offset = 16
    for (const cap of capabilities) {
      result.set(cap, offset)
      offset += cap.length
    }

    return result
  }
}

// =============================================================================
// Proxy Server
// =============================================================================

/**
 * WebSocket proxy server
 */
export class ProxyServer {
  private wss: WsServer | null = null
  private readonly config: ResolvedConfig
  private readonly events: ServerEvents
  private readonly clients: Map<string, ClientConnection> = new Map()
  private readonly adapters: AdapterRegistry = {}
  private timeoutTimer: ReturnType<typeof setInterval> | null = null
  private isRunning = false

  constructor(config: ProxyServerConfig = {}, events: ServerEvents = {}) {
    const resolvedConfig: ResolvedConfig = {
      port: config.port ?? 8080,
      host: config.host ?? '127.0.0.1',
      path: config.path ?? '/proxy',
      maxClients: config.maxClients ?? 100,
      maxStreamsPerClient: config.maxStreamsPerClient ?? 100,
      initialWindowSize: config.initialWindowSize ?? DEFAULT_WINDOW_SIZE,
      pingInterval: config.pingInterval ?? 30000,
      clientTimeout: config.clientTimeout ?? 60000,
      capabilities: config.capabilities ?? ['tcp', 'udp', 'dns', 'http', 'fs'],
      allowedOrigins: config.allowedOrigins ?? [],
    }
    if (config.authenticate) {
      resolvedConfig.authenticate = config.authenticate
    }
    this.config = resolvedConfig
    this.events = events
  }

  /**
   * Register an adapter for a stream type
   */
  registerAdapter(type: 'tcp' | 'udp' | 'dns' | 'http' | 'fs', adapter: StreamAdapter): void {
    this.adapters[type] = adapter
  }

  /**
   * Get adapter for stream type
   */
  getAdapter(type: StreamType): StreamAdapter | undefined {
    switch (type) {
      case StreamType.TCP:
        return this.adapters.tcp
      case StreamType.UDP:
        return this.adapters.udp
      case StreamType.HTTP:
        return this.adapters.http
      case StreamType.FILESYSTEM:
        return this.adapters.fs
      default:
        return undefined
    }
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Server already running')
    }

    // Dynamic import of ws module (Node.js only)
    const { WebSocketServer } = await import('ws')

    this.wss = new WebSocketServer({
      port: this.config.port,
      host: this.config.host,
      path: this.config.path,
      verifyClient: (info, callback) => {
        this.verifyClient(info, callback)
      },
    })

    this.wss.on('connection', (ws: WsWebSocket, request: IncomingMessage) => {
      this.handleConnection(ws, request)
    })

    this.wss.on('error', (error: Error) => {
      if (this.events.onError) {
        this.events.onError(error)
      }
    })

    // Start timeout checker
    if (this.config.clientTimeout > 0) {
      this.timeoutTimer = setInterval(() => {
        this.checkTimeouts()
      }, this.config.clientTimeout / 2)
    }

    this.isRunning = true
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return

    this.isRunning = false

    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer)
      this.timeoutTimer = null
    }

    // Close all clients
    const closePromises: Promise<void>[] = []
    for (const client of this.clients.values()) {
      closePromises.push(client.close('Server shutting down'))
    }
    await Promise.all(closePromises)
    this.clients.clear()

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve())
      })
      this.wss = null
    }
  }

  /**
   * Get connected client count
   */
  get clientCount(): number {
    return this.clients.size
  }

  /**
   * Get all connected clients
   */
  getClients(): ClientConnection[] {
    return Array.from(this.clients.values())
  }

  // Internal methods

  /** @internal */
  handleClientConnected(client: ClientConnection): void {
    if (this.events.onClientConnect) {
      this.events.onClientConnect(client)
    }
  }

  /** @internal */
  handleClientDisconnected(client: ClientConnection, reason?: string): void {
    this.clients.delete(client.id)

    if (this.events.onClientDisconnect) {
      this.events.onClientDisconnect(client, reason)
    }
  }

  /** @internal */
  handleClientError(client: ClientConnection, error: Error): void {
    if (this.events.onError) {
      this.events.onError(error, client)
    }
  }

  private verifyClient(
    info: { origin: string; secure: boolean; req: IncomingMessage },
    callback: (result: boolean, code?: number, message?: string) => void
  ): void {
    // Check max clients
    if (this.clients.size >= this.config.maxClients) {
      callback(false, 503, 'Server at capacity')
      return
    }

    // Check allowed origins
    if (this.config.allowedOrigins.length > 0) {
      const origin = info.origin
      if (!this.config.allowedOrigins.includes(origin)) {
        callback(false, 403, 'Origin not allowed')
        return
      }
    }

    // Check authentication
    if (this.config.authenticate) {
      const result = this.config.authenticate(info.req)
      if (result instanceof Promise) {
        result
          .then((allowed) => {
            callback(allowed, allowed ? undefined : 401, allowed ? undefined : 'Unauthorized')
          })
          .catch(() => {
            callback(false, 500, 'Authentication error')
          })
      } else {
        callback(result, result ? undefined : 401, result ? undefined : 'Unauthorized')
      }
    } else {
      callback(true)
    }
  }

  private handleConnection(ws: WsWebSocket, _request: IncomingMessage): void {
    const client = new ClientConnection(ws, this, this.config)
    this.clients.set(client.id, client)
  }

  private checkTimeouts(): void {
    for (const client of this.clients.values()) {
      if (client.isTimedOut(this.config.clientTimeout)) {
        client.close('Timeout')
      }
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new proxy server
 */
export function createProxyServer(config?: ProxyServerConfig, events?: ServerEvents): ProxyServer {
  return new ProxyServer(config, events)
}
