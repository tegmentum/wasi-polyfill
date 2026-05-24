/**
 * Incoming HTTP handler for wasi:http/incoming-handler
 *
 * Implements incoming HTTP request handling for server-side use cases.
 * `createIncomingHandler(handler).dispatch(request)` runs a handler end-to-end
 * (Fetch `Request` -> `Response`), which is the integration point for a Service
 * Worker `fetch` event. The `stub` plugin implementation (501) and the
 * `callback` implementation remain for the plugin/registry path.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { HandleRegistry } from '../../../shared/registry.js'
import { PollableRegistry, globalPollableRegistry } from '../io/pollable.js'
import { globalStreamRegistry, MemoryInputStream, MemoryOutputStream } from '../io/streams.js'
import { Fields, FieldsRegistry, globalFieldsRegistry } from './fields.js'
import type { Method, Scheme, HttpError } from './types.js'

/**
 * Configuration for incoming handler
 */
export interface IncomingHandlerConfig {
  /**
   * Handler function to process incoming requests
   */
  handler?: IncomingRequestHandler
}

/**
 * Type for the incoming request handler callback
 */
export type IncomingRequestHandler = (
  request: IncomingRequestData,
  responseOut: ResponseOutparam
) => Promise<void>

/**
 * Incoming request data passed to handler
 */
export interface IncomingRequestData {
  method: Method
  scheme?: Scheme
  authority?: string
  pathWithQuery?: string
  headers: Headers
  body?: Uint8Array
}

/**
 * Response outparam for setting the response
 */
export interface ResponseOutparam {
  set(response: OutgoingResponseData): void
  setError(error: HttpError): void
}

/**
 * Outgoing response data from handler
 */
export interface OutgoingResponseData {
  status: number
  headers?: Headers
  body?: Uint8Array
}

/**
 * Incoming request resource
 */
export interface IncomingRequest {
  handle: number
  method: Method
  scheme?: Scheme
  authority?: string
  pathWithQuery?: string
  headers: number // Handle to Fields
  body?: number // Handle to InputStream
}

/**
 * Outgoing response resource
 */
export interface OutgoingResponse {
  handle: number
  status: number
  headers: number // Handle to Fields
  body?: number // Handle to OutputStream
}

/**
 * Response outparam resource
 */
export interface ResponseOutparamResource {
  handle: number
  response?: OutgoingResponse | HttpError
  set: boolean
}

/**
 * Registry for incoming requests
 */
export class IncomingRequestRegistry extends HandleRegistry<IncomingRequest> {
  override register(request: IncomingRequest): number {
    const handle = super.register(request)
    request.handle = handle
    return handle
  }
}

/**
 * Registry for outgoing responses
 */
export class OutgoingResponseRegistry extends HandleRegistry<OutgoingResponse> {
  override register(response: OutgoingResponse): number {
    const handle = super.register(response)
    response.handle = handle
    return handle
  }
}

/**
 * Registry for response outparams
 */
export class ResponseOutparamRegistry extends HandleRegistry<ResponseOutparamResource> {
  override register(outparam: ResponseOutparamResource): number {
    const handle = super.register(outparam)
    outparam.handle = handle
    return handle
  }
}

/**
 * Global registries
 */
export const globalIncomingRequestRegistry = new IncomingRequestRegistry()
export const globalOutgoingResponseRegistry = new OutgoingResponseRegistry()
export const globalResponseOutparamRegistry = new ResponseOutparamRegistry()

/**
 * Incoming handler plugin instance
 *
 * Provides the handle function that processes incoming requests.
 * In browsers, this would be called from a Service Worker's fetch event.
 */
class IncomingHandlerInstance implements PluginInstance {
  private readonly requestRegistry: IncomingRequestRegistry
  private readonly outparamRegistry: ResponseOutparamRegistry
  private readonly fieldsRegistry: FieldsRegistry
  private readonly handler: IncomingRequestHandler | undefined

  constructor(
    requestRegistry: IncomingRequestRegistry,
    _responseRegistry: OutgoingResponseRegistry,
    outparamRegistry: ResponseOutparamRegistry,
    fieldsRegistry: FieldsRegistry,
    _pollableRegistry: PollableRegistry,
    config: IncomingHandlerConfig = {}
  ) {
    this.requestRegistry = requestRegistry
    this.outparamRegistry = outparamRegistry
    this.fieldsRegistry = fieldsRegistry
    if (config.handler !== undefined) {
      this.handler = config.handler
    }
  }

  getImports(): Record<string, unknown> {
    return {
      // This would typically be an export, not an import
      // but we provide it for testing and manual invocation
      handle: this.handle.bind(this),
    }
  }

  destroy(): void {
    // Cleanup handled by registries
  }

  /**
   * Handle an incoming request
   *
   * Note: In WASI, this is typically an export, not an import.
   * Components export this function to handle requests.
   * We provide it here for testing and manual invocation.
   */
  private async handle(requestHandle: number, responseOutparamHandle: number): Promise<void> {
    const request = this.requestRegistry.get(requestHandle)
    if (!request) {
      return
    }

    const outparam = this.outparamRegistry.get(responseOutparamHandle)
    if (!outparam) {
      return
    }

    if (!this.handler) {
      // No handler configured, return 501 Not Implemented
      const headersHandle = this.fieldsRegistry.register(new Fields())
      const response: OutgoingResponse = {
        handle: 0,
        status: 501,
        headers: headersHandle,
      }
      outparam.response = response
      outparam.set = true
      return
    }

    // Convert request to handler format
    const fields = this.fieldsRegistry.get(request.headers)
    const headers = fields?.toHeaders() ?? new Headers()

    let body: Uint8Array | undefined
    if (request.body !== undefined) {
      const stream = globalStreamRegistry.getInput(request.body)
      if (stream && 'read' in stream) {
        const data = stream.read(BigInt(1024 * 1024 * 10)) // 10MB max
        if (data instanceof Uint8Array) {
          body = data
        }
      }
    }

    const requestData: IncomingRequestData = {
      method: request.method,
      headers,
    }
    if (request.scheme !== undefined) {
      requestData.scheme = request.scheme
    }
    if (request.authority !== undefined) {
      requestData.authority = request.authority
    }
    if (request.pathWithQuery !== undefined) {
      requestData.pathWithQuery = request.pathWithQuery
    }
    if (body !== undefined) {
      requestData.body = body
    }

    // Create response outparam wrapper
    const responseOut: ResponseOutparam = {
      set: (response: OutgoingResponseData) => {
        const responseFields = response.headers
          ? Fields.fromHeaders(response.headers)
          : new Fields()
        const headersHandle = this.fieldsRegistry.register(responseFields)

        const outgoingResponse: OutgoingResponse = {
          handle: 0,
          status: response.status,
          headers: headersHandle,
        }

        if (response.body) {
          const bodyStream = new MemoryOutputStream()
          bodyStream.write(response.body)
          outgoingResponse.body = globalStreamRegistry.register(bodyStream)
        }

        outparam.response = outgoingResponse
        outparam.set = true
      },
      setError: (error: HttpError) => {
        outparam.response = error
        outparam.set = true
      },
    }

    await this.handler(requestData, responseOut)
  }

  /**
   * Create an incoming request from a Fetch API Request
   * (for Service Worker integration)
   */
  createFromFetchRequest(fetchRequest: Request): number {
    const fields = Fields.fromHeaders(fetchRequest.headers)
    const headersHandle = this.fieldsRegistry.register(fields)

    const url = new URL(fetchRequest.url)
    const request: IncomingRequest = {
      handle: 0,
      method: this.parseMethod(fetchRequest.method),
      scheme: this.parseScheme(url.protocol.replace(':', '')),
      authority: url.host,
      pathWithQuery: url.pathname + url.search,
      headers: headersHandle,
    }

    return this.requestRegistry.register(request)
  }

  /**
   * Create a response outparam
   */
  createResponseOutparam(): number {
    const outparam: ResponseOutparamResource = {
      handle: 0,
      set: false,
    }
    return this.outparamRegistry.register(outparam)
  }

  /**
   * Run the configured handler for a Fetch API `Request` and produce a
   * Fetch API `Response`. This is the end-to-end Service Worker integration
   * point: `self.addEventListener('fetch', e => e.respondWith(instance.dispatch(e.request)))`.
   *
   * Returns 501 when no handler is configured, and 500 if the handler throws or
   * never sets a response. Request/outparam handles are cleaned up afterwards.
   */
  async dispatch(fetchRequest: Request): Promise<Response> {
    const requestHandle = this.createFromFetchRequest(fetchRequest)
    if (fetchRequest.body || fetchRequest.method !== 'GET') {
      // Attach the request body (if any) as an input stream.
      const buf = new Uint8Array(await fetchRequest.arrayBuffer())
      if (buf.length > 0) {
        const req = this.requestRegistry.get(requestHandle)
        if (req) req.body = globalStreamRegistry.register(new MemoryInputStream(buf))
      }
    }
    const outparamHandle = this.createResponseOutparam()

    try {
      await this.handle(requestHandle, outparamHandle)
      const outparam = this.outparamRegistry.get(outparamHandle)
      const response = outparam?.response

      if (!response || !('status' in response)) {
        // setError() or nothing set → 500.
        return new Response(null, { status: 500, statusText: 'Internal Server Error' })
      }

      const headers = this.fieldsRegistry.get(response.headers)?.toHeaders() ?? new Headers()
      let body: BodyInit | null = null
      if (response.body !== undefined) {
        const stream = globalStreamRegistry.getOutput(response.body)
        if (stream && 'getBuffer' in stream) {
          // Uint8Array is a valid BodyInit at runtime; the cast sidesteps the
          // ArrayBufferLike/ArrayBuffer generic mismatch in lib.dom.
          body = (stream as { getBuffer(): Uint8Array }).getBuffer() as unknown as BodyInit
        }
      }
      return new Response(body, { status: response.status, headers })
    } catch {
      return new Response(null, { status: 500, statusText: 'Internal Server Error' })
    } finally {
      this.requestRegistry.drop(requestHandle)
      this.outparamRegistry.drop(outparamHandle)
    }
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
 * A host-side incoming-handler server: turns Fetch `Request`s into `Response`s
 * by running `handler`. The intended use is a Service Worker `fetch` event:
 *
 * ```ts
 * const server = createIncomingHandler(async (req, out) => {
 *   out.set({ status: 200, body: new TextEncoder().encode('hi') })
 * })
 * self.addEventListener('fetch', (e) => e.respondWith(server.dispatch(e.request)))
 * ```
 *
 * Uses isolated request/response/fields registries so it doesn't share handle
 * space with the globally-registered plugin instances.
 */
export function createIncomingHandler(handler?: IncomingRequestHandler): {
  dispatch(request: Request): Promise<Response>
  destroy(): void
} {
  const config: IncomingHandlerConfig = {}
  if (handler) config.handler = handler
  const instance = new IncomingHandlerInstance(
    new IncomingRequestRegistry(),
    new OutgoingResponseRegistry(),
    new ResponseOutparamRegistry(),
    new FieldsRegistry(),
    new PollableRegistry(),
    config
  )
  return {
    dispatch: (request: Request) => instance.dispatch(request),
    destroy: () => instance.destroy(),
  }
}

/**
 * Incoming request types plugin instance
 *
 * Provides the resource operations for incoming requests and outgoing responses
 */
class IncomingRequestTypesInstance implements PluginInstance {
  private readonly requestRegistry: IncomingRequestRegistry
  private readonly responseRegistry: OutgoingResponseRegistry
  private readonly outparamRegistry: ResponseOutparamRegistry

  constructor(
    requestRegistry: IncomingRequestRegistry,
    responseRegistry: OutgoingResponseRegistry,
    outparamRegistry: ResponseOutparamRegistry,
    _fieldsRegistry: FieldsRegistry,
    _pollableRegistry: PollableRegistry
  ) {
    this.requestRegistry = requestRegistry
    this.responseRegistry = responseRegistry
    this.outparamRegistry = outparamRegistry
  }

  getImports(): Record<string, unknown> {
    return {
      // Incoming request methods
      '[method]incoming-request.method': this.incomingRequestMethod.bind(this),
      '[method]incoming-request.scheme': this.incomingRequestScheme.bind(this),
      '[method]incoming-request.authority': this.incomingRequestAuthority.bind(this),
      '[method]incoming-request.path-with-query': this.incomingRequestPathWithQuery.bind(this),
      '[method]incoming-request.headers': this.incomingRequestHeaders.bind(this),
      '[method]incoming-request.consume': this.incomingRequestConsume.bind(this),
      '[resource-drop]incoming-request': this.incomingRequestDrop.bind(this),

      // Outgoing response constructors and methods
      '[constructor]outgoing-response': this.outgoingResponseConstructor.bind(this),
      '[method]outgoing-response.status-code': this.outgoingResponseStatusCode.bind(this),
      '[method]outgoing-response.set-status-code': this.outgoingResponseSetStatusCode.bind(this),
      '[method]outgoing-response.headers': this.outgoingResponseHeaders.bind(this),
      '[method]outgoing-response.body': this.outgoingResponseBody.bind(this),
      '[resource-drop]outgoing-response': this.outgoingResponseDrop.bind(this),

      // Response outparam methods
      '[static]response-outparam.set': this.responseOutparamSet.bind(this),
      '[resource-drop]response-outparam': this.responseOutparamDrop.bind(this),
    }
  }

  destroy(): void {
    // Cleanup handled by registries
  }

  // Incoming request methods
  private incomingRequestMethod(handle: number): Method | undefined {
    return this.requestRegistry.get(handle)?.method
  }

  private incomingRequestScheme(handle: number): Scheme | undefined {
    return this.requestRegistry.get(handle)?.scheme
  }

  private incomingRequestAuthority(handle: number): string | undefined {
    return this.requestRegistry.get(handle)?.authority
  }

  private incomingRequestPathWithQuery(handle: number): string | undefined {
    return this.requestRegistry.get(handle)?.pathWithQuery
  }

  private incomingRequestHeaders(handle: number): number | undefined {
    return this.requestRegistry.get(handle)?.headers
  }

  private incomingRequestConsume(handle: number): number | { tag: 'err'; val: HttpError } {
    const request = this.requestRegistry.get(handle)
    if (!request) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid request handle' } }
    }

    if (request.body === undefined) {
      // Create empty body stream
      const stream = new MemoryInputStream(new Uint8Array(0))
      request.body = globalStreamRegistry.register(stream)
    }

    const bodyHandle = request.body
    delete request.body
    return bodyHandle
  }

  private incomingRequestDrop(handle: number): void {
    this.requestRegistry.drop(handle)
  }

  // Outgoing response methods
  private outgoingResponseConstructor(headersHandle: number): number {
    const response: OutgoingResponse = {
      handle: 0,
      status: 200,
      headers: headersHandle,
    }
    return this.responseRegistry.register(response)
  }

  private outgoingResponseStatusCode(handle: number): number | undefined {
    return this.responseRegistry.get(handle)?.status
  }

  private outgoingResponseSetStatusCode(
    handle: number,
    status: number
  ): { tag: 'err'; val: HttpError } | undefined {
    const response = this.responseRegistry.get(handle)
    if (!response) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid response handle' } }
    }
    if (status < 100 || status > 999) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid status code' } }
    }
    response.status = status
    return undefined
  }

  private outgoingResponseHeaders(handle: number): number | undefined {
    return this.responseRegistry.get(handle)?.headers
  }

  private outgoingResponseBody(handle: number): number | { tag: 'err'; val: HttpError } {
    const response = this.responseRegistry.get(handle)
    if (!response) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid response handle' } }
    }

    if (response.body !== undefined) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Body already taken' } }
    }

    const bodyStream = new MemoryOutputStream()
    const bodyHandle = globalStreamRegistry.register(bodyStream)
    response.body = bodyHandle
    return bodyHandle
  }

  private outgoingResponseDrop(handle: number): void {
    this.responseRegistry.drop(handle)
  }

  // Response outparam methods
  private responseOutparamSet(
    handle: number,
    response: OutgoingResponse | { tag: 'err'; val: HttpError }
  ): void {
    const outparam = this.outparamRegistry.get(handle)
    if (!outparam) {
      return
    }

    if ('tag' in response && response.tag === 'err') {
      outparam.response = response.val
    } else {
      outparam.response = response as OutgoingResponse
    }
    outparam.set = true
  }

  private responseOutparamDrop(handle: number): void {
    this.outparamRegistry.drop(handle)
  }
}

/**
 * Stub incoming handler implementation
 *
 * Returns 501 Not Implemented for all requests.
 */
export const stubIncomingHandlerImplementation: Implementation = {
  name: 'stub',
  description: 'Stub incoming handler (returns 501)',
  create(_config: PluginConfig): PluginInstance {
    return new IncomingHandlerInstance(
      globalIncomingRequestRegistry,
      globalOutgoingResponseRegistry,
      globalResponseOutparamRegistry,
      globalFieldsRegistry,
      globalPollableRegistry
    )
  },
}

/**
 * Callback-based incoming handler implementation
 *
 * Allows registering a callback to handle incoming requests.
 */
export const callbackIncomingHandlerImplementation: Implementation = {
  name: 'callback',
  description: 'Callback-based incoming handler',
  create(config: PluginConfig): PluginInstance {
    const handler = config.options?.['handler'] as IncomingRequestHandler | undefined
    const handlerConfig: IncomingHandlerConfig = {}
    if (handler !== undefined) {
      handlerConfig.handler = handler
    }

    return new IncomingHandlerInstance(
      globalIncomingRequestRegistry,
      globalOutgoingResponseRegistry,
      globalResponseOutparamRegistry,
      globalFieldsRegistry,
      globalPollableRegistry,
      handlerConfig
    )
  },
}

/**
 * Incoming request types implementation
 *
 * Provides resource operations for incoming requests/outgoing responses.
 */
export const incomingRequestTypesImplementation: Implementation = {
  name: 'default',
  description: 'Incoming request types',
  create(_config: PluginConfig): PluginInstance {
    return new IncomingRequestTypesInstance(
      globalIncomingRequestRegistry,
      globalOutgoingResponseRegistry,
      globalResponseOutparamRegistry,
      globalFieldsRegistry,
      globalPollableRegistry
    )
  },
}
