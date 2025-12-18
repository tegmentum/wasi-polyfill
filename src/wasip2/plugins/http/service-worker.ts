/**
 * Service Worker integration for wasi:http/incoming-handler
 *
 * Provides utilities for handling HTTP requests in Service Workers,
 * converting between Fetch API and WASI types.
 *
 * Usage in a Service Worker:
 * ```typescript
 * import { createServiceWorkerHandler } from '@tegmentum/wasi-polyfill/plugins/http'
 *
 * const handler = createServiceWorkerHandler({
 *   wasmInstance: myWasmInstance,
 *   handleExport: 'wasi:http/incoming-handler#handle',
 * })
 *
 * self.addEventListener('fetch', (event) => {
 *   event.respondWith(handler(event.request))
 * })
 * ```
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { globalStreamRegistry, MemoryInputStream, MemoryOutputStream } from '../io/streams.js'
import { Fields, globalFieldsRegistry } from './fields.js'
import type { Method, Scheme, HttpError } from './types.js'
import {
  globalIncomingRequestRegistry,
  globalResponseOutparamRegistry,
  type IncomingRequest,
  type OutgoingResponse,
  type ResponseOutparamResource,
} from './incoming-handler.js'

// Type declarations for Service Worker APIs (browser-only)
// These are declared here to avoid needing additional type packages

/* eslint-disable @typescript-eslint/no-explicit-any */
type URLPatternLike = {
  test(input: string): boolean
}

interface FetchEventLike extends Event {
  readonly request: Request
  respondWith(response: Response | Promise<Response>): void
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Configuration for Service Worker handler
 */
export interface ServiceWorkerHandlerConfig {
  /**
   * The WASM instance with the exported handle function
   */
  wasmInstance?: WebAssembly.Instance

  /**
   * The name of the exported handle function
   * Default: 'wasi:http/incoming-handler#handle'
   */
  handleExport?: string

  /**
   * Custom handle function (alternative to wasmInstance)
   */
  handleFunction?: (requestHandle: number, responseOutparamHandle: number) => Promise<void>

  /**
   * URL patterns to handle (optional)
   * If not specified, handles all requests
   */
  urlPatterns?: URLPatternLike[]

  /**
   * Whether to fall through to network for unhandled requests
   * Default: true
   */
  fallthrough?: boolean
}

/**
 * Service Worker fetch event handler type
 */
export type ServiceWorkerFetchHandler = (request: Request) => Promise<Response>

/**
 * Service Worker handler instance
 *
 * Manages the conversion between Fetch API and WASI types,
 * and invokes the WASM component's handle function.
 */
export class ServiceWorkerHandler {
  private readonly handleFunction: (
    requestHandle: number,
    responseOutparamHandle: number
  ) => Promise<void>
  private readonly urlPatterns: URLPatternLike[] | undefined
  private readonly fallthrough: boolean

  constructor(config: ServiceWorkerHandlerConfig) {
    this.urlPatterns = config.urlPatterns
    this.fallthrough = config.fallthrough ?? true

    // Set up handle function
    if (config.handleFunction) {
      this.handleFunction = config.handleFunction
    } else if (config.wasmInstance) {
      const exportName = config.handleExport ?? 'wasi:http/incoming-handler#handle'
      const exported = config.wasmInstance.exports[exportName]
      if (typeof exported !== 'function') {
        throw new Error(`Export '${exportName}' not found or not a function`)
      }
      this.handleFunction = exported as (
        requestHandle: number,
        responseOutparamHandle: number
      ) => Promise<void>
    } else {
      throw new Error('Either wasmInstance or handleFunction must be provided')
    }
  }

  /**
   * Check if this handler should handle the given request
   */
  shouldHandle(request: Request): boolean {
    if (!this.urlPatterns || this.urlPatterns.length === 0) {
      return true
    }

    return this.urlPatterns.some((pattern) => pattern.test(request.url))
  }

  /**
   * Handle a Fetch API Request and return a Response
   */
  async handle(request: Request): Promise<Response> {
    // Check URL patterns
    if (!this.shouldHandle(request)) {
      if (this.fallthrough) {
        return fetch(request)
      }
      return new Response('Not Found', { status: 404 })
    }

    // Create WASI request from Fetch API request
    const requestHandle = await this.createIncomingRequest(request)

    // Create response outparam
    const outparamHandle = this.createResponseOutparam()

    try {
      // Call the WASM handle function
      await this.handleFunction(requestHandle, outparamHandle)

      // Convert WASI response back to Fetch API response
      return this.convertToFetchResponse(outparamHandle)
    } catch (error) {
      // Handle errors by returning 500
      console.error('Service Worker handler error:', error)
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } finally {
      // Cleanup
      globalIncomingRequestRegistry.drop(requestHandle)
      globalResponseOutparamRegistry.drop(outparamHandle)
    }
  }

  /**
   * Create a WASI IncomingRequest from a Fetch API Request
   */
  private async createIncomingRequest(fetchRequest: Request): Promise<number> {
    // Parse URL
    const url = new URL(fetchRequest.url)

    // Convert headers to Fields
    const fields = Fields.fromHeaders(fetchRequest.headers)
    const headersHandle = globalFieldsRegistry.register(fields)

    // Create body stream if present
    let bodyHandle: number | undefined
    if (fetchRequest.body) {
      const bodyData = await fetchRequest.arrayBuffer()
      const bodyStream = new MemoryInputStream(new Uint8Array(bodyData))
      bodyHandle = globalStreamRegistry.register(bodyStream)
    }

    // Create the incoming request
    const request: IncomingRequest = {
      handle: 0,
      method: this.parseMethod(fetchRequest.method),
      scheme: this.parseScheme(url.protocol.replace(':', '')),
      authority: url.host,
      pathWithQuery: url.pathname + url.search,
      headers: headersHandle,
    }

    // Only set body if we have one
    if (bodyHandle !== undefined) {
      request.body = bodyHandle
    }

    return globalIncomingRequestRegistry.register(request)
  }

  /**
   * Create a response outparam
   */
  private createResponseOutparam(): number {
    const outparam: ResponseOutparamResource = {
      handle: 0,
      set: false,
    }
    return globalResponseOutparamRegistry.register(outparam)
  }

  /**
   * Convert WASI response to Fetch API Response
   */
  private convertToFetchResponse(outparamHandle: number): Response {
    const outparam = globalResponseOutparamRegistry.get(outparamHandle)
    if (!outparam || !outparam.set) {
      return new Response('No response set', { status: 500 })
    }

    // Check for error response
    if (outparam.response && 'tag' in outparam.response) {
      const error = outparam.response as HttpError
      const errorMessage =
        'val' in error ? String((error as { tag: string; val: unknown }).val) : error.tag
      return new Response(JSON.stringify({ error: error.tag, details: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const response = outparam.response as OutgoingResponse
    if (!response) {
      return new Response('No response set', { status: 500 })
    }

    // Get headers
    const fields = globalFieldsRegistry.get(response.headers)
    const headers = fields?.toHeaders() ?? new Headers()

    // Get body from output stream
    let body: ArrayBuffer | null = null
    if (response.body !== undefined) {
      const stream = globalStreamRegistry.getOutput(response.body)
      if (stream && stream instanceof MemoryOutputStream) {
        // Access the internal chunks - need to get all written data
        // Use a trick to access the private chunks array
        const chunks = (stream as unknown as { chunks: Uint8Array[] }).chunks
        if (chunks && chunks.length > 0) {
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
          const combined = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            combined.set(chunk, offset)
            offset += chunk.length
          }
          body = combined.buffer
        }
      }
    }

    return new Response(body, {
      status: response.status,
      headers,
    })
  }

  private parseMethod(method: string): Method {
    const upper = method.toUpperCase()
    switch (upper) {
      case 'GET':
        return { tag: 'get' }
      case 'HEAD':
        return { tag: 'head' }
      case 'POST':
        return { tag: 'post' }
      case 'PUT':
        return { tag: 'put' }
      case 'DELETE':
        return { tag: 'delete' }
      case 'CONNECT':
        return { tag: 'connect' }
      case 'OPTIONS':
        return { tag: 'options' }
      case 'TRACE':
        return { tag: 'trace' }
      case 'PATCH':
        return { tag: 'patch' }
      default:
        return { tag: 'other', val: method }
    }
  }

  private parseScheme(scheme: string): Scheme {
    const lower = scheme.toLowerCase()
    switch (lower) {
      case 'http':
        return { tag: 'http' }
      case 'https':
        return { tag: 'https' }
      default:
        return { tag: 'other', val: scheme }
    }
  }
}

/**
 * Create a Service Worker fetch event handler
 *
 * @example
 * ```typescript
 * const handler = createServiceWorkerHandler({
 *   wasmInstance: myWasmInstance,
 * })
 *
 * self.addEventListener('fetch', (event) => {
 *   event.respondWith(handler(event.request))
 * })
 * ```
 */
export function createServiceWorkerHandler(
  config: ServiceWorkerHandlerConfig
): ServiceWorkerFetchHandler {
  const handler = new ServiceWorkerHandler(config)
  return (request: Request) => handler.handle(request)
}

/**
 * Service Worker incoming handler implementation
 *
 * For use when the polyfill is running inside a Service Worker
 * and needs to handle incoming fetch events.
 */
class ServiceWorkerIncomingHandlerInstance implements PluginInstance {
  private handler: ServiceWorkerHandler | null = null
  private readonly config: Partial<ServiceWorkerHandlerConfig>

  constructor(config: Partial<ServiceWorkerHandlerConfig>) {
    this.config = config
  }

  getImports(): Record<string, unknown> {
    return {
      // Service Worker specific methods
      'create-handler': this.createHandler.bind(this),
      handle: this.handleRequest.bind(this),
    }
  }

  destroy(): void {
    this.handler = null
  }

  /**
   * Create the handler instance
   */
  private createHandler(
    wasmInstance: WebAssembly.Instance,
    handleExport?: string
  ): ServiceWorkerHandler {
    const fullConfig: ServiceWorkerHandlerConfig = {
      ...this.config,
      wasmInstance,
    }
    if (handleExport !== undefined) {
      fullConfig.handleExport = handleExport
    }
    this.handler = new ServiceWorkerHandler(fullConfig)
    return this.handler
  }

  /**
   * Handle a request (delegates to the handler)
   */
  private async handleRequest(request: Request): Promise<Response> {
    if (!this.handler) {
      return new Response('Handler not initialized', { status: 500 })
    }
    return this.handler.handle(request)
  }
}

/**
 * Service Worker implementation for wasi:http/incoming-handler
 */
export const serviceWorkerIncomingHandlerImplementation: Implementation = {
  name: 'service-worker',
  description: 'Service Worker incoming handler for browser fetch events',
  create(config: PluginConfig): PluginInstance {
    const swConfig: Partial<ServiceWorkerHandlerConfig> = {}

    const fallthrough = config.options?.['fallthrough']
    if (typeof fallthrough === 'boolean') {
      swConfig.fallthrough = fallthrough
    }

    const urlPatterns = config.options?.['urlPatterns']
    if (Array.isArray(urlPatterns)) {
      swConfig.urlPatterns = urlPatterns as URLPatternLike[]
    }

    return new ServiceWorkerIncomingHandlerInstance(swConfig)
  },
}

/**
 * Service Worker adapter for the incoming handler
 *
 * This class provides a higher-level API for integrating
 * WASI HTTP components with Service Workers.
 */
export class ServiceWorkerAdapter {
  private handler: ServiceWorkerHandler | null = null

  /**
   * Initialize the adapter with a WASM instance
   */
  initialize(config: ServiceWorkerHandlerConfig): void {
    this.handler = new ServiceWorkerHandler(config)
  }

  /**
   * Handle a FetchEvent
   *
   * @example
   * ```typescript
   * const adapter = new ServiceWorkerAdapter()
   * adapter.initialize({ wasmInstance: myInstance })
   *
   * self.addEventListener('fetch', (event) => {
   *   event.respondWith(adapter.handleFetchEvent(event))
   * })
   * ```
   */
  async handleFetchEvent(event: FetchEventLike): Promise<Response> {
    if (!this.handler) {
      throw new Error('Adapter not initialized')
    }
    return this.handler.handle(event.request)
  }

  /**
   * Handle a Request directly
   */
  async handleRequest(request: Request): Promise<Response> {
    if (!this.handler) {
      throw new Error('Adapter not initialized')
    }
    return this.handler.handle(request)
  }

  /**
   * Check if the adapter can handle a request
   */
  canHandle(request: Request): boolean {
    if (!this.handler) {
      return false
    }
    return this.handler.shouldHandle(request)
  }
}

/**
 * Helper to check if running in a Service Worker context
 */
export function isServiceWorkerContext(): boolean {
  return (
    typeof self !== 'undefined' &&
    'ServiceWorkerGlobalScope' in self &&
    self instanceof (self as { ServiceWorkerGlobalScope: { new (): unknown } }).ServiceWorkerGlobalScope
  )
}

/**
 * Helper to register the Service Worker handler with the global scope
 *
 * @example
 * ```typescript
 * registerServiceWorkerHandler({
 *   wasmInstance: myInstance,
 *   urlPatterns: [{ test: (url) => url.includes('/api/') }],
 * })
 * ```
 */
export function registerServiceWorkerHandler(config: ServiceWorkerHandlerConfig): void {
  if (!isServiceWorkerContext()) {
    throw new Error('Not running in a Service Worker context')
  }

  const handler = createServiceWorkerHandler(config)

  self.addEventListener('fetch', ((event: Event) => {
    const fetchEvent = event as FetchEventLike
    // Check if we should handle this request
    const swHandler = new ServiceWorkerHandler(config)
    if (swHandler.shouldHandle(fetchEvent.request)) {
      fetchEvent.respondWith(handler(fetchEvent.request))
    }
  }) as EventListener)
}
