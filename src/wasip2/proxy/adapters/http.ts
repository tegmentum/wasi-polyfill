/**
 * HTTP Adapter for Proxy Server
 *
 * Handles HTTP request proxying from browser clients,
 * performing actual HTTP requests on the server side.
 */

import * as http from 'node:http'
import * as https from 'node:https'
import { URL } from 'node:url'
import {
  MessageType,
  ErrorCode,
  type HttpRequestPayload,
  type HttpResponseHeadPayload,
  type HttpResponseTrailersPayload,
  encodeString,
  decodeString,
  decodeBytes,
} from '../protocol.js'
import type { StreamAdapter, ServerStream } from '../server.js'

// =============================================================================
// Types
// =============================================================================

/**
 * HTTP adapter configuration
 */
export interface HttpAdapterConfig {
  /**
   * Allowed origins/hosts (empty = all allowed)
   */
  allowedHosts?: string[]

  /**
   * Blocked origins/hosts
   */
  blockedHosts?: string[]

  /**
   * Allowed HTTP methods (empty = all allowed)
   */
  allowedMethods?: string[]

  /**
   * Maximum request body size in bytes
   * @default 10MB
   */
  maxRequestBodySize?: number

  /**
   * Maximum response body size in bytes (0 = unlimited)
   * @default 0
   */
  maxResponseBodySize?: number

  /**
   * Request timeout in ms
   * @default 30000
   */
  timeout?: number

  /**
   * Follow redirects
   * @default true
   */
  followRedirects?: boolean

  /**
   * Maximum redirects to follow
   * @default 10
   */
  maxRedirects?: number

  /**
   * Headers to strip from requests
   */
  stripRequestHeaders?: string[]

  /**
   * Headers to strip from responses
   */
  stripResponseHeaders?: string[]

  /**
   * Headers to add to all requests
   */
  addRequestHeaders?: Record<string, string>

  /**
   * User agent override (null = use client's)
   */
  userAgent?: string | null
}

// =============================================================================
// Stream State
// =============================================================================

interface HttpStreamState {
  request: http.ClientRequest | null
  response: http.IncomingMessage | null
  requestBody: Uint8Array[]
  requestComplete: boolean
  responseStarted: boolean
  responseSent: boolean
  method?: string
  uri?: string
  redirectCount: number
}

// =============================================================================
// HTTP Adapter
// =============================================================================

/**
 * HTTP adapter for proxy server
 */
export class HttpAdapter implements StreamAdapter {
  private readonly config: Required<Omit<HttpAdapterConfig, 'userAgent'>> & { userAgent: string | null }
  private readonly streamStates: Map<number, HttpStreamState> = new Map()

  constructor(config: HttpAdapterConfig = {}) {
    this.config = {
      allowedHosts: config.allowedHosts ?? [],
      blockedHosts: config.blockedHosts ?? [],
      allowedMethods: config.allowedMethods ?? [],
      maxRequestBodySize: config.maxRequestBodySize ?? 10 * 1024 * 1024,
      maxResponseBodySize: config.maxResponseBodySize ?? 0,
      timeout: config.timeout ?? 30000,
      followRedirects: config.followRedirects ?? true,
      maxRedirects: config.maxRedirects ?? 10,
      stripRequestHeaders: config.stripRequestHeaders ?? ['host', 'connection', 'upgrade'],
      stripResponseHeaders: config.stripResponseHeaders ?? ['transfer-encoding', 'connection'],
      addRequestHeaders: config.addRequestHeaders ?? {},
      userAgent: config.userAgent ?? null,
    }
  }

  async onOpen(stream: ServerStream, _payload: Uint8Array): Promise<void> {
    this.streamStates.set(stream.id, {
      request: null,
      response: null,
      requestBody: [],
      requestComplete: false,
      responseStarted: false,
      responseSent: false,
      redirectCount: 0,
    })
  }

  async onData(stream: ServerStream, data: Uint8Array): Promise<void> {
    const state = this.streamStates.get(stream.id)
    if (!state) {
      throw new Error('Unknown stream')
    }

    // Check if this is a command or request body data
    const firstByte = data[0]
    if (data.length > 0 && firstByte !== undefined && firstByte >= 0x50 && firstByte <= 0x5f) {
      const messageType = firstByte as MessageType
      const payload = data.slice(1)

      switch (messageType) {
        case MessageType.HTTP_REQUEST:
          await this.handleRequest(stream, state, payload)
          break

        default:
          throw new Error(`Unknown HTTP operation: ${messageType}`)
      }
    } else if (!state.requestComplete) {
      // Request body data
      state.requestBody.push(data)

      // Check body size limit
      const totalSize = state.requestBody.reduce((sum, chunk) => sum + chunk.length, 0)
      if (totalSize > this.config.maxRequestBodySize) {
        await stream.reset(ErrorCode.FRAME_SIZE_ERROR, 'Request body too large')
        return
      }

      // If request has been initiated and we're receiving body, pipe it
      if (state.request) {
        state.request.write(data)
      }
    }
  }

  async onClose(stream: ServerStream): Promise<void> {
    const state = this.streamStates.get(stream.id)
    if (state) {
      if (state.request) {
        state.request.destroy()
      }
      this.streamStates.delete(stream.id)
    }
  }

  async onReset(stream: ServerStream, _error: Error): Promise<void> {
    const state = this.streamStates.get(stream.id)
    if (state) {
      if (state.request) {
        state.request.destroy()
      }
      this.streamStates.delete(stream.id)
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async handleRequest(stream: ServerStream, state: HttpStreamState, payload: Uint8Array): Promise<void> {
    const requestPayload = this.decodeHttpRequest(payload)
    state.method = requestPayload.method
    state.uri = requestPayload.uri

    // Validate method
    if (this.config.allowedMethods.length > 0 && !this.config.allowedMethods.includes(requestPayload.method)) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Method not allowed: ${requestPayload.method}`)
      return
    }

    // Parse URL and validate host
    let url: URL
    try {
      url = new URL(requestPayload.uri)
    } catch {
      await stream.reset(ErrorCode.INVALID_ARGUMENT, `Invalid URI: ${requestPayload.uri}`)
      return
    }

    if (!this.isHostAllowed(url.hostname)) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Host not allowed: ${url.hostname}`)
      return
    }

    await this.executeRequest(stream, state, requestPayload, url)
  }

  private async executeRequest(
    stream: ServerStream,
    state: HttpStreamState,
    requestPayload: HttpRequestPayload,
    url: URL
  ): Promise<void> {
    // Build headers
    const headers: Record<string, string | string[]> = {}

    for (const [name, value] of requestPayload.headers) {
      const headerName = new TextDecoder().decode(new Uint8Array([...name].map((c) => c.charCodeAt(0))))
      const headerValue = new TextDecoder().decode(value)

      // Skip stripped headers
      if (this.config.stripRequestHeaders.map((h) => h.toLowerCase()).includes(headerName.toLowerCase())) {
        continue
      }

      const existing = headers[headerName]
      if (existing) {
        if (Array.isArray(existing)) {
          existing.push(headerValue)
        } else {
          headers[headerName] = [existing, headerValue]
        }
      } else {
        headers[headerName] = headerValue
      }
    }

    // Add configured headers
    for (const [name, value] of Object.entries(this.config.addRequestHeaders)) {
      headers[name] = value
    }

    // Set host header
    headers['host'] = url.host

    // Set user agent if configured
    if (this.config.userAgent) {
      headers['user-agent'] = this.config.userAgent
    }

    // Select http or https module
    const httpModule = url.protocol === 'https:' ? https : http

    const options: http.RequestOptions = {
      method: requestPayload.method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers,
      timeout: this.config.timeout,
    }

    state.request = httpModule.request(options, (response) => {
      this.handleResponse(stream, state, response, requestPayload, url)
    })

    state.request.on('error', (error) => {
      if (!state.responseStarted) {
        stream.reset(ErrorCode.CONNECT_ERROR, error.message)
      }
    })

    state.request.on('timeout', () => {
      state.request?.destroy()
      if (!state.responseStarted) {
        stream.reset(ErrorCode.TIMEOUT, 'Request timeout')
      }
    })

    // Send any accumulated request body
    for (const chunk of state.requestBody) {
      state.request.write(chunk)
    }
    state.requestBody = []

    // End request if no body expected
    if (!requestPayload.hasBody) {
      state.request.end()
      state.requestComplete = true
    }
  }

  private handleResponse(
    stream: ServerStream,
    state: HttpStreamState,
    response: http.IncomingMessage,
    requestPayload: HttpRequestPayload,
    url: URL
  ): void {
    state.response = response
    state.responseStarted = true

    // Handle redirects
    if (
      this.config.followRedirects &&
      response.statusCode &&
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      response.headers.location
    ) {
      if (state.redirectCount >= this.config.maxRedirects) {
        stream.reset(ErrorCode.RESOURCE_EXHAUSTED, 'Too many redirects')
        return
      }

      state.redirectCount++

      // Parse redirect URL
      let redirectUrl: URL
      try {
        redirectUrl = new URL(response.headers.location, url)
      } catch {
        stream.reset(ErrorCode.INVALID_ARGUMENT, `Invalid redirect URL: ${response.headers.location}`)
        return
      }

      // Validate redirect host
      if (!this.isHostAllowed(redirectUrl.hostname)) {
        stream.reset(ErrorCode.PERMISSION_DENIED, `Redirect host not allowed: ${redirectUrl.hostname}`)
        return
      }

      // Execute redirected request
      this.executeRequest(stream, state, requestPayload, redirectUrl)
      return
    }

    // Send response head
    const responseHeaders: Array<[string, Uint8Array]> = []
    for (const [name, value] of Object.entries(response.headers)) {
      if (this.config.stripResponseHeaders.map((h) => h.toLowerCase()).includes(name.toLowerCase())) {
        continue
      }

      if (Array.isArray(value)) {
        for (const v of value) {
          responseHeaders.push([name, new TextEncoder().encode(v)])
        }
      } else if (value) {
        responseHeaders.push([name, new TextEncoder().encode(value)])
      }
    }

    const responseHead: HttpResponseHeadPayload = {
      status: response.statusCode ?? 200,
      headers: responseHeaders,
      hasBody: response.statusCode !== 204 && response.statusCode !== 304,
    }

    const headPayload = this.encodeHttpResponseHead(responseHead)
    stream['client'].sendFrame(MessageType.HTTP_RESPONSE_HEAD, stream.id, headPayload)

    // Stream response body
    let totalSize = 0

    response.on('data', (chunk: Buffer) => {
      totalSize += chunk.length

      if (this.config.maxResponseBodySize > 0 && totalSize > this.config.maxResponseBodySize) {
        response.destroy()
        stream.reset(ErrorCode.FRAME_SIZE_ERROR, 'Response body too large')
        return
      }

      stream.write(new Uint8Array(chunk)).catch(() => {
        response.destroy()
      })
    })

    response.on('end', () => {
      // Send trailers if present
      if (response.trailers && Object.keys(response.trailers).length > 0) {
        const trailers: Array<[string, Uint8Array]> = []
        for (const [name, value] of Object.entries(response.trailers)) {
          if (value) {
            trailers.push([name, new TextEncoder().encode(value)])
          }
        }

        const trailersPayload = this.encodeHttpTrailers({ trailers })
        stream['client'].sendFrame(MessageType.HTTP_RESPONSE_TRAILERS, stream.id, trailersPayload)
      }

      stream.close().catch(() => {})
      state.responseSent = true
    })

    response.on('error', (error) => {
      stream.reset(ErrorCode.IO_ERROR, error.message)
    })
  }

  private isHostAllowed(host: string): boolean {
    // Check blocked hosts first
    if (this.config.blockedHosts.length > 0) {
      for (const blocked of this.config.blockedHosts) {
        if (this.matchHost(host, blocked)) {
          return false
        }
      }
    }

    // Check allowed hosts
    if (this.config.allowedHosts.length > 0) {
      for (const allowed of this.config.allowedHosts) {
        if (this.matchHost(host, allowed)) {
          return true
        }
      }
      return false
    }

    return true
  }

  private matchHost(host: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1)
      return host.endsWith(suffix) || host === pattern.slice(2)
    }
    return host === pattern
  }

  private decodeHttpRequest(payload: Uint8Array): HttpRequestPayload {
    let offset = 0

    const { value: method, bytesRead: methodLen } = decodeString(payload, offset)
    offset += methodLen

    const { value: uri, bytesRead: uriLen } = decodeString(payload, offset)
    offset += uriLen

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const headerCount = view.getUint32(offset, true)
    offset += 4

    const headers: Array<[string, Uint8Array]> = []
    for (let i = 0; i < headerCount; i++) {
      const { value: name, bytesRead: nameLen } = decodeString(payload, offset)
      offset += nameLen

      const { value: value, bytesRead: valueLen } = decodeBytes(payload, offset)
      offset += valueLen

      headers.push([name, value])
    }

    const hasBody = view.getUint8(offset) !== 0

    return { method, uri, headers, hasBody }
  }

  private encodeHttpResponseHead(payload: HttpResponseHeadPayload): Uint8Array {
    // Calculate size
    let size = 2 + 4 + 1 // status + header count + hasBody

    const encodedHeaders: Array<{ name: Uint8Array; value: Uint8Array }> = []
    for (const [name, value] of payload.headers) {
      const nameBytes = encodeString(name)
      const valueBytes = new Uint8Array(4 + value.length)
      const view = new DataView(valueBytes.buffer)
      view.setUint32(0, value.length, true)
      valueBytes.set(value, 4)

      encodedHeaders.push({ name: nameBytes, value: valueBytes })
      size += nameBytes.length + valueBytes.length
    }

    const result = new Uint8Array(size)
    const view = new DataView(result.buffer)

    let offset = 0
    view.setUint16(offset, payload.status, true)
    offset += 2

    view.setUint32(offset, payload.headers.length, true)
    offset += 4

    for (const { name, value } of encodedHeaders) {
      result.set(name, offset)
      offset += name.length
      result.set(value, offset)
      offset += value.length
    }

    view.setUint8(offset, payload.hasBody ? 1 : 0)

    return result
  }

  private encodeHttpTrailers(payload: HttpResponseTrailersPayload): Uint8Array {
    let size = 4 // trailer count

    const encodedTrailers: Array<{ name: Uint8Array; value: Uint8Array }> = []
    for (const [name, value] of payload.trailers) {
      const nameBytes = encodeString(name)
      const valueBytes = new Uint8Array(4 + value.length)
      const view = new DataView(valueBytes.buffer)
      view.setUint32(0, value.length, true)
      valueBytes.set(value, 4)

      encodedTrailers.push({ name: nameBytes, value: valueBytes })
      size += nameBytes.length + valueBytes.length
    }

    const result = new Uint8Array(size)
    const view = new DataView(result.buffer)

    let offset = 0
    view.setUint32(offset, payload.trailers.length, true)
    offset += 4

    for (const { name, value } of encodedTrailers) {
      result.set(name, offset)
      offset += name.length
      result.set(value, offset)
      offset += value.length
    }

    return result
  }
}

/**
 * Create an HTTP adapter
 */
export function createHttpAdapter(config?: HttpAdapterConfig): HttpAdapter {
  return new HttpAdapter(config)
}
