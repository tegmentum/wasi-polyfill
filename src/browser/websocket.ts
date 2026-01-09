/**
 * browser:websocket - WebSocket client interface
 *
 * Provides a capability-scoped interface to the WebSocket API
 * for bidirectional communication from WebAssembly components.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  type Result,
  ok,
  browserErr,
  type Bytes,
} from './types.js'

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle to an open WebSocket connection.
 */
export type WebSocketHandle = number

// =============================================================================
// State and Message Types
// =============================================================================

/**
 * WebSocket connection state.
 */
export enum WebSocketState {
  /** Connection is being established */
  CONNECTING = 0,
  /** Connection is open and ready */
  OPEN = 1,
  /** Connection is being closed */
  CLOSING = 2,
  /** Connection is closed */
  CLOSED = 3,
}

/**
 * Type of WebSocket message.
 */
export enum WebSocketMessageType {
  /** Text message (UTF-8 string) */
  TEXT = 'text',
  /** Binary message (Uint8Array) */
  BINARY = 'binary',
}

/**
 * WebSocket message received from the server.
 */
export interface WebSocketMessage {
  /** Message type */
  type: WebSocketMessageType
  /** Message data - string for TEXT, Uint8Array for BINARY */
  data: string | Bytes
  /** Timestamp when message was received */
  timestamp: number
}

/**
 * WebSocket error event data.
 */
export interface WebSocketError {
  /** Error code if available */
  code?: number
  /** Error message */
  message: string
  /** Timestamp when error occurred */
  timestamp: number
}

/**
 * WebSocket close event data.
 */
export interface WebSocketClose {
  /** Close code */
  code: number
  /** Close reason */
  reason: string
  /** Whether the close was clean */
  wasClean: boolean
  /** Timestamp when connection was closed */
  timestamp: number
}

/**
 * WebSocket connection info.
 */
export interface WebSocketInfo {
  /** The handle for this connection */
  handle: WebSocketHandle
  /** The URL connected to */
  url: string
  /** Current connection state */
  state: WebSocketState
  /** Protocol negotiated with server */
  protocol: string
  /** Binary type (blob or arraybuffer) */
  binaryType: 'blob' | 'arraybuffer'
  /** Number of bytes queued for transmission */
  bufferedAmount: number
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * WebSocket connection options.
 */
export interface WebSocketConnectOptions {
  /** URL to connect to (ws:// or wss://) */
  url: string
  /** Subprotocols to negotiate */
  protocols?: string[]
  /** Connection timeout in milliseconds */
  timeout?: number
}

/**
 * Configuration for the WebSocket manager.
 */
export interface WebSocketOptions {
  /** Maximum concurrent connections (default: 10) */
  maxConnections?: number
  /** Maximum messages to queue per connection (default: 1000) */
  messageQueueSize?: number
  /** Allowed WebSocket origins (security) */
  allowedOrigins?: string[]
  /** Default connection timeout in milliseconds */
  defaultTimeout?: number
}

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Internal connection entry.
 */
interface ConnectionEntry {
  socket: WebSocket
  url: string
  messages: WebSocketMessage[]
  errors: WebSocketError[]
  closeEvent: WebSocketClose | null
  openPromise: Promise<void>
  openResolve: (() => void) | null
  openReject: ((error: Error) => void) | null
}

// =============================================================================
// Browser WebSocket Manager
// =============================================================================

/**
 * Browser WebSocket implementation.
 *
 * Manages WebSocket connections with handle-based access suitable
 * for use across the WASM boundary.
 */
export class BrowserWebSocket {
  private nextHandle = 1
  private connections = new Map<WebSocketHandle, ConnectionEntry>()
  private maxConnections: number
  private messageQueueSize: number
  private allowedOrigins: string[] | null
  private defaultTimeout: number

  constructor(options: WebSocketOptions = {}) {
    this.maxConnections = options.maxConnections ?? 10
    this.messageQueueSize = options.messageQueueSize ?? 1000
    this.allowedOrigins = options.allowedOrigins ?? null
    this.defaultTimeout = options.defaultTimeout ?? 30000
  }

  /**
   * Check if WebSocket is supported in this environment.
   */
  isSupported(): boolean {
    return typeof WebSocket !== 'undefined'
  }

  /**
   * Check if a URL origin is allowed.
   */
  private isOriginAllowed(url: URL): boolean {
    if (this.allowedOrigins === null) {
      return true
    }

    const origin = url.origin
    return this.allowedOrigins.some(allowed => {
      if (allowed === '*') return true
      if (allowed.startsWith('*.')) {
        const domain = allowed.slice(2)
        return origin.endsWith(domain) || origin.endsWith('.' + domain)
      }
      return origin === allowed
    })
  }

  /**
   * Connect to a WebSocket server.
   *
   * @param options - Connection options
   * @returns Handle to the connection or error
   */
  connect(options: WebSocketConnectOptions): Result<WebSocketHandle, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'WebSocket is not supported')
    }

    if (this.connections.size >= this.maxConnections) {
      return browserErr(
        BrowserErrorCode.BUSY,
        `Maximum connections (${this.maxConnections}) reached`
      )
    }

    // Validate URL
    let url: URL
    try {
      url = new URL(options.url)
    } catch {
      return browserErr(BrowserErrorCode.INVALID_ARGUMENT, `Invalid WebSocket URL: ${options.url}`)
    }

    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Invalid WebSocket protocol: ${url.protocol}`
      )
    }

    // Check origin policy
    if (!this.isOriginAllowed(url)) {
      return browserErr(
        BrowserErrorCode.DENIED,
        `Origin '${url.origin}' is not in the allowed origins list`
      )
    }

    const handle = this.nextHandle++
    let openResolve: (() => void) | null = null
    let openReject: ((error: Error) => void) | null = null

    const openPromise = new Promise<void>((resolve, reject) => {
      openResolve = resolve
      openReject = reject
    })

    let socket: WebSocket
    try {
      socket = options.protocols
        ? new WebSocket(options.url, options.protocols)
        : new WebSocket(options.url)
      socket.binaryType = 'arraybuffer'
    } catch (e) {
      return browserErr(
        BrowserErrorCode.NETWORK,
        `Failed to create WebSocket: ${e instanceof Error ? e.message : String(e)}`
      )
    }

    const entry: ConnectionEntry = {
      socket,
      url: options.url,
      messages: [],
      errors: [],
      closeEvent: null,
      openPromise,
      openResolve,
      openReject,
    }

    this.connections.set(handle, entry)
    this.setupEventListeners(handle, entry)

    return ok(handle)
  }

  /**
   * Set up event listeners for a WebSocket connection.
   */
  private setupEventListeners(_handle: WebSocketHandle, entry: ConnectionEntry): void {
    const { socket } = entry

    socket.onopen = () => {
      if (entry.openResolve) {
        entry.openResolve()
        entry.openResolve = null
        entry.openReject = null
      }
    }

    socket.onmessage = (event) => {
      if (entry.messages.length >= this.messageQueueSize) {
        entry.messages.shift() // Drop oldest message
      }

      const message: WebSocketMessage = {
        type: typeof event.data === 'string'
          ? WebSocketMessageType.TEXT
          : WebSocketMessageType.BINARY,
        data: typeof event.data === 'string'
          ? event.data
          : new Uint8Array(event.data as ArrayBuffer),
        timestamp: Date.now(),
      }

      entry.messages.push(message)
    }

    socket.onerror = () => {
      const error: WebSocketError = {
        message: 'WebSocket error occurred',
        timestamp: Date.now(),
      }
      entry.errors.push(error)

      if (entry.openReject) {
        entry.openReject(new Error('WebSocket connection failed'))
        entry.openResolve = null
        entry.openReject = null
      }
    }

    socket.onclose = (event) => {
      entry.closeEvent = {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        timestamp: Date.now(),
      }

      if (entry.openReject) {
        entry.openReject(new Error(`WebSocket closed during connection: ${event.code}`))
        entry.openResolve = null
        entry.openReject = null
      }
    }
  }

  /**
   * Wait for a connection to be ready.
   *
   * @param handle - The connection handle
   * @param timeout - Optional timeout in milliseconds
   * @returns Success or error
   */
  async waitForOpen(
    handle: WebSocketHandle,
    timeout?: number
  ): Promise<Result<void, BrowserError>> {
    const entry = this.connections.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `WebSocket ${handle} not found`)
    }

    if (entry.socket.readyState === WebSocket.OPEN) {
      return ok(undefined)
    }

    if (entry.socket.readyState === WebSocket.CLOSED || entry.socket.readyState === WebSocket.CLOSING) {
      return browserErr(BrowserErrorCode.NETWORK, 'WebSocket is closed')
    }

    const timeoutMs = timeout ?? this.defaultTimeout

    try {
      await Promise.race([
        entry.openPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
        }),
      ])
      return ok(undefined)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.TIMEOUT,
        e instanceof Error ? e.message : 'Connection timeout'
      )
    }
  }

  /**
   * Send data through a WebSocket connection.
   *
   * @param handle - The connection handle
   * @param data - Data to send (string or bytes)
   * @returns Success or error
   */
  send(handle: WebSocketHandle, data: string | Bytes): Result<void, BrowserError> {
    const entry = this.connections.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `WebSocket ${handle} not found`)
    }

    if (entry.socket.readyState !== WebSocket.OPEN) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `WebSocket is not open (state: ${this.getStateName(entry.socket.readyState)})`
      )
    }

    try {
      entry.socket.send(data)
      return ok(undefined)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.NETWORK,
        `Failed to send: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Send text data through a WebSocket connection.
   */
  sendText(handle: WebSocketHandle, text: string): Result<void, BrowserError> {
    return this.send(handle, text)
  }

  /**
   * Send binary data through a WebSocket connection.
   */
  sendBinary(handle: WebSocketHandle, data: Bytes): Result<void, BrowserError> {
    return this.send(handle, data)
  }

  /**
   * Read received messages from a connection.
   *
   * @param handle - The connection handle
   * @param maxCount - Maximum messages to return (default: all)
   * @returns Array of messages or error
   */
  readMessages(
    handle: WebSocketHandle,
    maxCount?: number
  ): Result<WebSocketMessage[], BrowserError> {
    const entry = this.connections.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `WebSocket ${handle} not found`)
    }

    const count = maxCount !== undefined
      ? Math.min(maxCount, entry.messages.length)
      : entry.messages.length

    const messages = entry.messages.splice(0, count)
    return ok(messages)
  }

  /**
   * Read any errors that occurred on a connection.
   *
   * @param handle - The connection handle
   * @returns Array of errors or error
   */
  readErrors(handle: WebSocketHandle): Result<WebSocketError[], BrowserError> {
    const entry = this.connections.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `WebSocket ${handle} not found`)
    }

    const errors = entry.errors.splice(0, entry.errors.length)
    return ok(errors)
  }

  /**
   * Get the current state of a connection.
   *
   * @param handle - The connection handle
   * @returns Connection state or error
   */
  getState(handle: WebSocketHandle): Result<WebSocketState, BrowserError> {
    const entry = this.connections.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `WebSocket ${handle} not found`)
    }

    return ok(entry.socket.readyState as WebSocketState)
  }

  /**
   * Get information about a connection.
   *
   * @param handle - The connection handle
   * @returns Connection info or error
   */
  getInfo(handle: WebSocketHandle): Result<WebSocketInfo, BrowserError> {
    const entry = this.connections.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `WebSocket ${handle} not found`)
    }

    const { socket, url } = entry
    return ok({
      handle,
      url,
      state: socket.readyState as WebSocketState,
      protocol: socket.protocol,
      binaryType: socket.binaryType,
      bufferedAmount: socket.bufferedAmount,
    })
  }

  /**
   * Get the close event if the connection was closed.
   *
   * @param handle - The connection handle
   * @returns Close event or null, or error
   */
  getCloseEvent(handle: WebSocketHandle): Result<WebSocketClose | null, BrowserError> {
    const entry = this.connections.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `WebSocket ${handle} not found`)
    }

    return ok(entry.closeEvent)
  }

  /**
   * Close a WebSocket connection.
   *
   * @param handle - The connection handle
   * @param code - Optional close code (default: 1000)
   * @param reason - Optional close reason
   * @returns Success or error
   */
  close(
    handle: WebSocketHandle,
    code?: number,
    reason?: string
  ): Result<void, BrowserError> {
    const entry = this.connections.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `WebSocket ${handle} not found`)
    }

    if (entry.socket.readyState === WebSocket.CLOSED) {
      return ok(undefined) // Already closed
    }

    try {
      entry.socket.close(code ?? 1000, reason)
      return ok(undefined)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.NETWORK,
        `Failed to close: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Close a connection and remove it from management.
   *
   * @param handle - The connection handle
   * @returns Success or error
   */
  drop(handle: WebSocketHandle): Result<void, BrowserError> {
    const entry = this.connections.get(handle)
    if (!entry) {
      return ok(undefined) // Already dropped
    }

    // Close if not already closed
    if (entry.socket.readyState !== WebSocket.CLOSED) {
      try {
        entry.socket.close(1000)
      } catch {
        // Ignore close errors during drop
      }
    }

    this.connections.delete(handle)
    return ok(undefined)
  }

  /**
   * Get all active connection handles.
   */
  getConnections(): WebSocketHandle[] {
    return Array.from(this.connections.keys())
  }

  /**
   * Get the number of active connections.
   */
  getConnectionCount(): number {
    return this.connections.size
  }

  /**
   * Close all connections and clean up.
   */
  destroy(): void {
    for (const [handle] of this.connections) {
      this.drop(handle)
    }
  }

  /**
   * Get a human-readable state name.
   */
  private getStateName(state: number): string {
    switch (state) {
      case WebSocket.CONNECTING: return 'CONNECTING'
      case WebSocket.OPEN: return 'OPEN'
      case WebSocket.CLOSING: return 'CLOSING'
      case WebSocket.CLOSED: return 'CLOSED'
      default: return 'UNKNOWN'
    }
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultWebSocket: BrowserWebSocket | null = null

/**
 * Get the default WebSocket manager instance.
 */
export function getDefaultWebSocket(options?: WebSocketOptions): BrowserWebSocket {
  if (!defaultWebSocket) {
    defaultWebSocket = new BrowserWebSocket(options)
  }
  return defaultWebSocket
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Check if WebSocket is supported.
 */
export function isWebSocketSupported(): boolean {
  return getDefaultWebSocket().isSupported()
}

/**
 * Connect to a WebSocket server.
 */
export function connect(options: WebSocketConnectOptions): Result<WebSocketHandle, BrowserError> {
  return getDefaultWebSocket().connect(options)
}

/**
 * Send data through a WebSocket.
 */
export function send(handle: WebSocketHandle, data: string | Bytes): Result<void, BrowserError> {
  return getDefaultWebSocket().send(handle, data)
}

/**
 * Read messages from a WebSocket.
 */
export function readMessages(
  handle: WebSocketHandle,
  maxCount?: number
): Result<WebSocketMessage[], BrowserError> {
  return getDefaultWebSocket().readMessages(handle, maxCount)
}

/**
 * Close a WebSocket connection.
 */
export function close(
  handle: WebSocketHandle,
  code?: number,
  reason?: string
): Result<void, BrowserError> {
  return getDefaultWebSocket().close(handle, code, reason)
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:websocket imports object.
 */
export function getBrowserWebSocketImports(options?: WebSocketOptions): Record<string, unknown> {
  const ws = options ? new BrowserWebSocket(options) : getDefaultWebSocket()

  return {
    'browser:websocket/websocket': {
      // Support check
      'is-supported': () => ws.isSupported(),

      // Connection management
      connect: (opts: WebSocketConnectOptions) => ws.connect(opts),
      'wait-for-open': (handle: WebSocketHandle, timeout?: number) =>
        ws.waitForOpen(handle, timeout),
      close: (handle: WebSocketHandle, code?: number, reason?: string) =>
        ws.close(handle, code, reason),
      drop: (handle: WebSocketHandle) => ws.drop(handle),

      // Sending
      send: (handle: WebSocketHandle, data: string | Bytes) => ws.send(handle, data),
      'send-text': (handle: WebSocketHandle, text: string) => ws.sendText(handle, text),
      'send-binary': (handle: WebSocketHandle, data: Bytes) => ws.sendBinary(handle, data),

      // Receiving
      'read-messages': (handle: WebSocketHandle, maxCount?: number) =>
        ws.readMessages(handle, maxCount),
      'read-errors': (handle: WebSocketHandle) => ws.readErrors(handle),

      // State and info
      'get-state': (handle: WebSocketHandle) => ws.getState(handle),
      'get-info': (handle: WebSocketHandle) => ws.getInfo(handle),
      'get-close-event': (handle: WebSocketHandle) => ws.getCloseEvent(handle),
      'get-connections': () => ws.getConnections(),
      'get-connection-count': () => ws.getConnectionCount(),
    },
  }
}
