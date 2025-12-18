/**
 * In-process test handler for wasi:http/incoming-handler
 *
 * Provides a test harness for HTTP handlers that doesn't require
 * a real HTTP server. Useful for:
 * - Unit testing WASM HTTP handlers
 * - Integration testing without network
 * - Deterministic request/response testing
 *
 * Usage:
 * ```typescript
 * import { createTestHttpHandler } from '@tegmentum/wasi-polyfill/plugins/http'
 *
 * const handler = createTestHttpHandler({
 *   wasmHandler: myHandlerFunction,
 * })
 *
 * // Inject a test request
 * const response = await handler.handleRequest({
 *   method: 'GET',
 *   path: '/api/test',
 *   headers: { 'Accept': 'application/json' },
 * })
 *
 * expect(response.status).toBe(200)
 * expect(response.body).toContain('success')
 * ```
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { globalStreamRegistry, MemoryInputStream, MemoryOutputStream } from '../io/streams.js'
import { Fields, globalFieldsRegistry } from './fields.js'
import type { Method, Scheme, HttpError } from './types.js'
import {
  globalIncomingRequestRegistry,
  globalResponseOutparamRegistry,
  globalOutgoingResponseRegistry,
  type IncomingRequest,
  type OutgoingResponse,
  type ResponseOutparamResource,
} from './incoming-handler.js'

/**
 * Test request to inject
 */
export interface TestRequest {
  /**
   * HTTP method
   */
  method: Method | string

  /**
   * Request path (with query string if applicable)
   */
  path: string

  /**
   * Request headers
   */
  headers?: Record<string, string | string[]>

  /**
   * Request body (string or bytes)
   */
  body?: string | Uint8Array

  /**
   * URL scheme
   */
  scheme?: Scheme | string

  /**
   * Host/authority header
   */
  authority?: string
}

/**
 * Test response received
 */
export interface TestResponse {
  /**
   * HTTP status code
   */
  status: number

  /**
   * Response headers
   */
  headers: Map<string, string[]>

  /**
   * Response body as bytes
   */
  body: Uint8Array

  /**
   * Response body as string (UTF-8 decoded)
   */
  bodyText: string

  /**
   * Error if the handler failed
   */
  error?: HttpError
}

/**
 * Configuration for test HTTP handler
 */
export interface TestHttpHandlerConfig extends PluginConfig {
  /**
   * WASM handler function to call
   * Signature: (requestHandle: number, responseOutparamHandle: number) => Promise<void>
   */
  wasmHandler?: (requestHandle: number, responseOutparamHandle: number) => Promise<void>

  /**
   * WASM instance with exported handle function
   */
  wasmInstance?: WebAssembly.Instance

  /**
   * Export name for the handle function
   * Default: 'wasi:http/incoming-handler#handle'
   */
  handleExport?: string
}

/**
 * Test HTTP handler for in-process testing
 */
export class TestHttpHandler {
  private readonly wasmHandler: (
    requestHandle: number,
    responseOutparamHandle: number
  ) => Promise<void>
  private readonly requestHistory: TestRequest[] = []
  private readonly responseHistory: TestResponse[] = []

  constructor(config: TestHttpHandlerConfig) {
    if (config.wasmHandler) {
      this.wasmHandler = config.wasmHandler
    } else if (config.wasmInstance) {
      const exportName = config.handleExport ?? 'wasi:http/incoming-handler#handle'
      const exports = config.wasmInstance.exports as Record<string, unknown>
      const handler = exports[exportName] as
        | ((req: number, resp: number) => Promise<void>)
        | undefined

      if (!handler) {
        throw new Error(`Export '${exportName}' not found in WASM instance`)
      }

      this.wasmHandler = handler
    } else {
      // Default no-op handler for testing without WASM
      this.wasmHandler = async (_reqHandle, respHandle) => {
        const outparam = globalResponseOutparamRegistry.get(respHandle)
        if (outparam) {
          // Set a default 200 OK response
          const responseFields = new Fields()
          responseFields.set('content-type', new TextEncoder().encode('text/plain'))
          const headersHandle = globalFieldsRegistry.register(responseFields)

          const bodyStream = new MemoryOutputStream()
          bodyStream.write(new TextEncoder().encode('OK'))
          const bodyHandle = globalStreamRegistry.register(bodyStream)

          const response: OutgoingResponse = {
            handle: 0,
            status: 200,
            headers: headersHandle,
            body: bodyHandle,
          }
          globalOutgoingResponseRegistry.register(response)

          outparam.response = response
          outparam.set = true
        }
      }
    }
  }

  /**
   * Handle a test request and return the response
   */
  async handleRequest(request: TestRequest): Promise<TestResponse> {
    // Record request
    this.requestHistory.push(request)

    // Convert method string to Method type if needed
    const method = typeof request.method === 'string'
      ? this.parseMethod(request.method)
      : request.method

    // Create incoming request resource
    const requestFields = new Fields()
    if (request.headers) {
      for (const [key, value] of Object.entries(request.headers)) {
        const values = Array.isArray(value) ? value : [value]
        // Encode each header value and append
        for (const v of values) {
          requestFields.append(key, new TextEncoder().encode(v))
        }
      }
    }
    const headersHandle = globalFieldsRegistry.register(requestFields)

    // Create body stream if provided
    let bodyHandle: number | undefined
    if (request.body) {
      const bodyBytes = typeof request.body === 'string'
        ? new TextEncoder().encode(request.body)
        : request.body
      const bodyStream = new MemoryInputStream(bodyBytes)
      bodyHandle = globalStreamRegistry.register(bodyStream)
    }

    // Register incoming request
    const incomingRequest: IncomingRequest = {
      handle: 0,
      method,
      pathWithQuery: request.path,
      headers: headersHandle,
    }

    // Add optional properties only if defined
    if (request.scheme !== undefined) {
      incomingRequest.scheme = request.scheme as Scheme
    }
    if (request.authority !== undefined) {
      incomingRequest.authority = request.authority
    }
    if (bodyHandle !== undefined) {
      incomingRequest.body = bodyHandle
    }

    const requestHandle = globalIncomingRequestRegistry.register(incomingRequest)

    // Create response outparam
    const responseOutparam: ResponseOutparamResource = {
      handle: 0,
      set: false,
    }
    const responseOutparamHandle = globalResponseOutparamRegistry.register(responseOutparam)

    // Call WASM handler
    try {
      await this.wasmHandler(requestHandle, responseOutparamHandle)
    } catch (error) {
      // Handler threw an error
      const response: TestResponse = {
        status: 500,
        headers: new Map(),
        body: new Uint8Array(0),
        bodyText: '',
        error: {
          tag: 'internal-error',
          val: error instanceof Error ? error.message : String(error),
        },
      }
      this.responseHistory.push(response)
      return response
    }

    // Extract response
    const outparam = globalResponseOutparamRegistry.get(responseOutparamHandle)
    if (!outparam || !outparam.set) {
      const response: TestResponse = {
        status: 500,
        headers: new Map(),
        body: new Uint8Array(0),
        bodyText: '',
        error: { tag: 'internal-error', val: 'No response set' },
      }
      this.responseHistory.push(response)
      return response
    }

    // Check for error response
    if ('tag' in (outparam.response as HttpError)) {
      const error = outparam.response as HttpError
      const response: TestResponse = {
        status: this.errorToStatus(error),
        headers: new Map(),
        body: new Uint8Array(0),
        bodyText: '',
        error,
      }
      this.responseHistory.push(response)
      return response
    }

    // Extract successful response
    const outgoingResponse = outparam.response as {
      handle: number
      status: number
      headers: number
      body?: number
    }

    const responseHeaders = new Map<string, string[]>()
    const fieldsResource = globalFieldsRegistry.get(outgoingResponse.headers)
    if (fieldsResource) {
      const entries = fieldsResource.getEntries()
      for (const [key, value] of entries) {
        const decoded = new TextDecoder().decode(value)
        const existing = responseHeaders.get(key)
        if (existing) {
          existing.push(decoded)
        } else {
          responseHeaders.set(key, [decoded])
        }
      }
    }

    let responseBody: Uint8Array = new Uint8Array(0)
    if (outgoingResponse.body !== undefined) {
      const outputStream = globalStreamRegistry.getOutput(outgoingResponse.body)
      if (outputStream && 'getBuffer' in outputStream) {
        const buffer = (outputStream as MemoryOutputStream).getBuffer()
        // Copy the buffer to ensure it's a plain ArrayBuffer-backed Uint8Array
        responseBody = buffer.slice()
      }
    }

    const response: TestResponse = {
      status: outgoingResponse.status,
      headers: responseHeaders,
      body: responseBody,
      bodyText: new TextDecoder().decode(responseBody),
    }

    this.responseHistory.push(response)
    return response
  }

  /**
   * Get all requests that have been handled
   */
  getRequestHistory(): readonly TestRequest[] {
    return this.requestHistory
  }

  /**
   * Get all responses that have been returned
   */
  getResponseHistory(): readonly TestResponse[] {
    return this.responseHistory
  }

  /**
   * Clear request/response history
   */
  clearHistory(): void {
    this.requestHistory.length = 0
    this.responseHistory.length = 0
  }

  /**
   * Get the last request
   */
  getLastRequest(): TestRequest | undefined {
    return this.requestHistory[this.requestHistory.length - 1]
  }

  /**
   * Get the last response
   */
  getLastResponse(): TestResponse | undefined {
    return this.responseHistory[this.responseHistory.length - 1]
  }

  private parseMethod(method: string): Method {
    const upper = method.toUpperCase()
    switch (upper) {
      case 'GET': return { tag: 'get' }
      case 'HEAD': return { tag: 'head' }
      case 'POST': return { tag: 'post' }
      case 'PUT': return { tag: 'put' }
      case 'DELETE': return { tag: 'delete' }
      case 'CONNECT': return { tag: 'connect' }
      case 'OPTIONS': return { tag: 'options' }
      case 'TRACE': return { tag: 'trace' }
      case 'PATCH': return { tag: 'patch' }
      default: return { tag: 'other', val: method }
    }
  }

  private errorToStatus(error: HttpError): number {
    switch (error.tag) {
      case 'DNS-timeout':
      case 'DNS-error':
        return 502
      case 'connection-timeout':
      case 'connection-refused':
        return 503
      case 'TLS-protocol-error':
      case 'TLS-certificate-error':
        return 495 // SSL Certificate Error
      case 'HTTP-request-denied':
        return 403
      case 'HTTP-request-body-size':
      case 'HTTP-request-header-size':
        return 413
      case 'HTTP-response-header-size':
      case 'HTTP-response-body-size':
        return 502
      case 'HTTP-response-incomplete':
      case 'HTTP-response-transfer-coding':
      case 'HTTP-response-content-coding':
        return 502
      case 'loop-detected':
        return 508
      case 'internal-error':
      default:
        return 500
    }
  }
}

/**
 * Create a test HTTP handler
 */
export function createTestHttpHandler(config?: TestHttpHandlerConfig): TestHttpHandler {
  return new TestHttpHandler(config ?? {})
}

/**
 * In-process test handler implementation
 *
 * This implementation provides a way to test HTTP handlers
 * without network I/O.
 */
export const testIncomingHandlerImplementation: Implementation = {
  name: 'test',
  description: 'In-process test handler for deterministic HTTP testing',
  create(config: PluginConfig): PluginInstance {
    const handler = new TestHttpHandler(config as TestHttpHandlerConfig)

    return {
      getImports(): Record<string, unknown> {
        return {
          // The handle function is called by the component
          handle: async (_requestHandle: number, _responseOutparamHandle: number) => {
            // This would be called when a component wants to handle an incoming request
            // In test mode, we don't need to do anything here since we inject requests
          },
        }
      },
      destroy(): void {
        handler.clearHistory()
      },
    }
  },
}
