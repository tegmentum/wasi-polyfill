/**
 * Outgoing HTTP handler for wasi:http/outgoing-handler
 *
 * Implements outgoing HTTP requests using the browser Fetch API.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  PollableRegistry,
  globalPollableRegistry,
  createReadyPollable,
} from '../io/pollable.js'
import {
  globalStreamRegistry,
  MemoryInputStream,
  MemoryOutputStream,
  type StreamError,
} from '../io/streams.js'
import { Fields, FieldsRegistry, globalFieldsRegistry } from './fields.js'
import {
  type Method,
  type Scheme,
  type HttpError,
  type RequestOptions,
  methodToString,
  schemeToString,
  mapFetchError,
} from './types.js'

/**
 * Configuration for outgoing handler
 */
export interface OutgoingHandlerConfig {
  /**
   * Allowed origins for requests (for policy enforcement)
   * If empty or undefined, all origins are allowed (subject to CORS)
   */
  allowedOrigins?: string[]

  /**
   * Default request timeout in milliseconds
   */
  defaultTimeoutMs?: number

  /**
   * User-Agent header to use for requests
   */
  userAgent?: string
}

/**
 * Outgoing request resource
 */
export interface OutgoingRequest {
  handle: number
  method: Method
  scheme?: Scheme
  authority?: string
  pathWithQuery?: string
  headers: number // Handle to Fields
  body?: number // Handle to OutputStream
}

/**
 * Outgoing response (result of request)
 */
export interface IncomingResponse {
  handle: number
  status: number
  headers: number // Handle to Fields
  body?: number // Handle to InputStream
}

/**
 * Future incoming response (pending request)
 */
export interface FutureIncomingResponse {
  handle: number
  promise: Promise<IncomingResponse | HttpError>
  result?: IncomingResponse | HttpError
  abortController?: AbortController
}

/**
 * Request options resource
 */
export interface RequestOptionsResource {
  handle: number
  options: RequestOptions
}

/**
 * Registry for outgoing requests
 */
export class OutgoingRequestRegistry {
  private nextHandle = 1
  private readonly requests: Map<number, OutgoingRequest> = new Map()

  register(request: OutgoingRequest): number {
    const handle = this.nextHandle++
    request.handle = handle
    this.requests.set(handle, request)
    return handle
  }

  get(handle: number): OutgoingRequest | undefined {
    return this.requests.get(handle)
  }

  drop(handle: number): boolean {
    return this.requests.delete(handle)
  }

  clear(): void {
    this.requests.clear()
  }
}

/**
 * Registry for incoming responses
 */
export class IncomingResponseRegistry {
  private nextHandle = 1
  private readonly responses: Map<number, IncomingResponse> = new Map()

  register(response: IncomingResponse): number {
    const handle = this.nextHandle++
    response.handle = handle
    this.responses.set(handle, response)
    return handle
  }

  get(handle: number): IncomingResponse | undefined {
    return this.responses.get(handle)
  }

  drop(handle: number): boolean {
    return this.responses.delete(handle)
  }

  clear(): void {
    this.responses.clear()
  }
}

/**
 * Registry for future incoming responses
 */
export class FutureIncomingResponseRegistry {
  private nextHandle = 1
  private readonly futures: Map<number, FutureIncomingResponse> = new Map()

  register(future: FutureIncomingResponse): number {
    const handle = this.nextHandle++
    future.handle = handle
    this.futures.set(handle, future)
    return handle
  }

  get(handle: number): FutureIncomingResponse | undefined {
    return this.futures.get(handle)
  }

  drop(handle: number): boolean {
    const future = this.futures.get(handle)
    if (future?.abortController) {
      future.abortController.abort()
    }
    return this.futures.delete(handle)
  }

  clear(): void {
    for (const future of this.futures.values()) {
      if (future.abortController) {
        future.abortController.abort()
      }
    }
    this.futures.clear()
  }
}

/**
 * Registry for request options
 */
export class RequestOptionsRegistry {
  private nextHandle = 1
  private readonly options: Map<number, RequestOptionsResource> = new Map()

  register(opts: RequestOptionsResource): number {
    const handle = this.nextHandle++
    opts.handle = handle
    this.options.set(handle, opts)
    return handle
  }

  get(handle: number): RequestOptionsResource | undefined {
    return this.options.get(handle)
  }

  drop(handle: number): boolean {
    return this.options.delete(handle)
  }

  clear(): void {
    this.options.clear()
  }
}

/**
 * Global registries
 */
export const globalOutgoingRequestRegistry = new OutgoingRequestRegistry()
export const globalIncomingResponseRegistry = new IncomingResponseRegistry()
export const globalFutureIncomingResponseRegistry = new FutureIncomingResponseRegistry()
export const globalRequestOptionsRegistry = new RequestOptionsRegistry()

/**
 * Outgoing handler plugin instance
 */
class OutgoingHandlerInstance implements PluginInstance {
  private readonly requestRegistry: OutgoingRequestRegistry
  private readonly responseRegistry: IncomingResponseRegistry
  private readonly futureRegistry: FutureIncomingResponseRegistry
  private readonly optionsRegistry: RequestOptionsRegistry
  private readonly fieldsRegistry: FieldsRegistry
  private readonly config: OutgoingHandlerConfig

  constructor(
    requestRegistry: OutgoingRequestRegistry,
    responseRegistry: IncomingResponseRegistry,
    futureRegistry: FutureIncomingResponseRegistry,
    optionsRegistry: RequestOptionsRegistry,
    fieldsRegistry: FieldsRegistry,
    _pollableRegistry: PollableRegistry,
    config: OutgoingHandlerConfig = {}
  ) {
    this.requestRegistry = requestRegistry
    this.responseRegistry = responseRegistry
    this.futureRegistry = futureRegistry
    this.optionsRegistry = optionsRegistry
    this.fieldsRegistry = fieldsRegistry
    this.config = config
  }

  getImports(): Record<string, unknown> {
    return {
      handle: this.handle.bind(this),
    }
  }

  destroy(): void {
    // Cleanup handled by registries
  }

  /**
   * Handle an outgoing request
   */
  private handle(
    requestHandle: number,
    optionsHandle?: number
  ): number | { tag: 'err'; val: HttpError } {
    const request = this.requestRegistry.get(requestHandle)
    if (!request) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid request handle' } }
    }

    const fields = this.fieldsRegistry.get(request.headers)
    if (!fields) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid headers handle' } }
    }

    // Build URL
    const scheme = request.scheme ? schemeToString(request.scheme) : 'https'
    const authority = request.authority ?? ''
    const pathWithQuery = request.pathWithQuery ?? '/'
    const url = `${scheme}://${authority}${pathWithQuery}`

    // Check origin policy
    if (!this.isOriginAllowed(url)) {
      return { tag: 'err', val: { tag: 'HTTP-request-denied' } }
    }

    // Get timeout from options
    let timeoutMs = this.config.defaultTimeoutMs ?? 30000
    if (optionsHandle !== undefined) {
      const opts = this.optionsRegistry.get(optionsHandle)
      if (opts?.options.connectTimeout) {
        timeoutMs = Number(opts.options.connectTimeout / 1_000_000n) // ns to ms
      }
    }

    // Create abort controller for timeout
    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs)

    // Build request headers
    const headers = fields.toHeaders()
    if (this.config.userAgent && !headers.has('User-Agent')) {
      headers.set('User-Agent', this.config.userAgent)
    }

    // Get request body if any
    let body: BodyInit | null = null
    if (request.body !== undefined) {
      const outputStream = globalStreamRegistry.getOutput(request.body)
      if (outputStream && 'getBuffer' in outputStream) {
        const buffer = (outputStream as { getBuffer(): Uint8Array }).getBuffer()
        // Create a copy as an ArrayBuffer (slice() could return SharedArrayBuffer)
        const copy = new Uint8Array(buffer).buffer
        body = copy
      }
    }

    // Execute fetch
    const promise: Promise<IncomingResponse | HttpError> = fetch(url, {
      method: methodToString(request.method),
      headers,
      body,
      signal: abortController.signal,
    })
      .then(async (response) => {
        clearTimeout(timeoutId)

        // Create response headers
        const responseFields = Fields.fromHeaders(response.headers)
        const headersHandle = this.fieldsRegistry.register(responseFields)

        // Read response body
        const bodyData = await response.arrayBuffer()
        const bodyStream = new MemoryInputStream(new Uint8Array(bodyData))
        const bodyHandle = globalStreamRegistry.register(bodyStream)

        const incomingResponse: IncomingResponse = {
          handle: 0,
          status: response.status,
          headers: headersHandle,
          body: bodyHandle,
        }

        // Register and update handle
        const registeredHandle = this.responseRegistry.register(incomingResponse)
        incomingResponse.handle = registeredHandle
        return incomingResponse
      })
      .catch((error: Error) => {
        clearTimeout(timeoutId)
        return mapFetchError(error)
      })

    // Create future
    const future: FutureIncomingResponse = {
      handle: 0,
      promise,
      abortController,
    }

    // Track when promise resolves
    promise.then((result) => {
      future.result = result
    })

    return this.futureRegistry.register(future)
  }

  /**
   * Check if an origin is allowed by policy
   */
  private isOriginAllowed(url: string): boolean {
    if (!this.config.allowedOrigins || this.config.allowedOrigins.length === 0) {
      return true // No restrictions
    }

    try {
      const parsed = new URL(url)
      const origin = parsed.origin
      return this.config.allowedOrigins.some((allowed) => {
        if (allowed === '*') {
          return true
        }
        if (allowed.startsWith('*.')) {
          const domain = allowed.slice(2)
          return parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
        }
        return origin === allowed
      })
    } catch {
      return false
    }
  }
}

/**
 * HTTP types plugin instance
 *
 * Provides the core HTTP types and resource operations
 */
class HttpTypesInstance implements PluginInstance {
  private readonly requestRegistry: OutgoingRequestRegistry
  private readonly responseRegistry: IncomingResponseRegistry
  private readonly futureRegistry: FutureIncomingResponseRegistry
  private readonly optionsRegistry: RequestOptionsRegistry
  private readonly fieldsRegistry: FieldsRegistry
  private readonly pollableRegistry: PollableRegistry

  constructor(
    requestRegistry: OutgoingRequestRegistry,
    responseRegistry: IncomingResponseRegistry,
    futureRegistry: FutureIncomingResponseRegistry,
    optionsRegistry: RequestOptionsRegistry,
    fieldsRegistry: FieldsRegistry,
    pollableRegistry: PollableRegistry
  ) {
    this.requestRegistry = requestRegistry
    this.responseRegistry = responseRegistry
    this.futureRegistry = futureRegistry
    this.optionsRegistry = optionsRegistry
    this.fieldsRegistry = fieldsRegistry
    this.pollableRegistry = pollableRegistry
  }

  getImports(): Record<string, unknown> {
    return {
      // Fields constructors
      '[constructor]fields': this.fieldsConstructor.bind(this),
      '[static]fields.from-list': this.fieldsFromList.bind(this),

      // Fields methods
      '[method]fields.get': this.fieldsGet.bind(this),
      '[method]fields.has': this.fieldsHas.bind(this),
      '[method]fields.set': this.fieldsSet.bind(this),
      '[method]fields.delete': this.fieldsDelete.bind(this),
      '[method]fields.append': this.fieldsAppend.bind(this),
      '[method]fields.entries': this.fieldsEntries.bind(this),
      '[method]fields.clone': this.fieldsClone.bind(this),
      '[resource-drop]fields': this.fieldsDrop.bind(this),

      // Outgoing request constructors and methods
      '[constructor]outgoing-request': this.outgoingRequestConstructor.bind(this),
      '[method]outgoing-request.method': this.outgoingRequestMethod.bind(this),
      '[method]outgoing-request.set-method': this.outgoingRequestSetMethod.bind(this),
      '[method]outgoing-request.scheme': this.outgoingRequestScheme.bind(this),
      '[method]outgoing-request.set-scheme': this.outgoingRequestSetScheme.bind(this),
      '[method]outgoing-request.authority': this.outgoingRequestAuthority.bind(this),
      '[method]outgoing-request.set-authority': this.outgoingRequestSetAuthority.bind(this),
      '[method]outgoing-request.path-with-query': this.outgoingRequestPathWithQuery.bind(this),
      '[method]outgoing-request.set-path-with-query':
        this.outgoingRequestSetPathWithQuery.bind(this),
      '[method]outgoing-request.headers': this.outgoingRequestHeaders.bind(this),
      '[method]outgoing-request.body': this.outgoingRequestBody.bind(this),
      '[resource-drop]outgoing-request': this.outgoingRequestDrop.bind(this),

      // Incoming response methods
      '[method]incoming-response.status': this.incomingResponseStatus.bind(this),
      '[method]incoming-response.headers': this.incomingResponseHeaders.bind(this),
      '[method]incoming-response.consume': this.incomingResponseConsume.bind(this),
      '[resource-drop]incoming-response': this.incomingResponseDrop.bind(this),

      // Incoming body methods
      '[method]incoming-body.stream': this.incomingBodyStream.bind(this),
      '[static]incoming-body.finish': this.incomingBodyFinish.bind(this),
      '[resource-drop]incoming-body': this.incomingBodyDrop.bind(this),

      // Outgoing body methods
      '[method]outgoing-body.write': this.outgoingBodyWrite.bind(this),
      '[static]outgoing-body.finish': this.outgoingBodyFinish.bind(this),
      '[resource-drop]outgoing-body': this.outgoingBodyDrop.bind(this),

      // Future incoming response methods
      '[method]future-incoming-response.subscribe': this.futureSubscribe.bind(this),
      '[method]future-incoming-response.get': this.futureGet.bind(this),
      '[resource-drop]future-incoming-response': this.futureDrop.bind(this),

      // Request options
      '[constructor]request-options': this.requestOptionsConstructor.bind(this),
      '[method]request-options.connect-timeout': this.requestOptionsConnectTimeout.bind(this),
      '[method]request-options.set-connect-timeout':
        this.requestOptionsSetConnectTimeout.bind(this),
      '[method]request-options.first-byte-timeout': this.requestOptionsFirstByteTimeout.bind(this),
      '[method]request-options.set-first-byte-timeout':
        this.requestOptionsSetFirstByteTimeout.bind(this),
      '[method]request-options.between-bytes-timeout':
        this.requestOptionsBetweenBytesTimeout.bind(this),
      '[method]request-options.set-between-bytes-timeout':
        this.requestOptionsSetBetweenBytesTimeout.bind(this),
      '[resource-drop]request-options': this.requestOptionsDrop.bind(this),

      // Utility functions
      'http-error-code': this.httpErrorCode.bind(this),
    }
  }

  destroy(): void {
    // Cleanup handled by registries
  }

  // Fields operations
  private fieldsConstructor(): number {
    return this.fieldsRegistry.register(new Fields())
  }

  private fieldsFromList(
    entries: [string, Uint8Array][]
  ): number | { tag: 'err'; val: HttpError } {
    try {
      const fields = new Fields(entries)
      return this.fieldsRegistry.register(fields)
    } catch {
      return { tag: 'err', val: { tag: 'HTTP-request-header-size' } }
    }
  }

  private fieldsGet(handle: number, name: string): Uint8Array[] {
    const fields = this.fieldsRegistry.get(handle)
    return fields?.get(name) ?? []
  }

  private fieldsHas(handle: number, name: string): boolean {
    const fields = this.fieldsRegistry.get(handle)
    return fields?.has(name) ?? false
  }

  private fieldsSet(handle: number, name: string, values: Uint8Array[]): HttpError | undefined {
    const fields = this.fieldsRegistry.get(handle)
    if (!fields) {
      return { tag: 'internal-error', val: 'Invalid fields handle' }
    }
    fields.delete(name)
    for (const value of values) {
      const error = fields.append(name, value)
      if (error) return error
    }
    return undefined
  }

  private fieldsDelete(handle: number, name: string): HttpError | undefined {
    const fields = this.fieldsRegistry.get(handle)
    if (!fields) {
      return { tag: 'internal-error', val: 'Invalid fields handle' }
    }
    return fields.delete(name)
  }

  private fieldsAppend(handle: number, name: string, value: Uint8Array): HttpError | undefined {
    const fields = this.fieldsRegistry.get(handle)
    if (!fields) {
      return { tag: 'internal-error', val: 'Invalid fields handle' }
    }
    return fields.append(name, value)
  }

  private fieldsEntries(handle: number): [string, Uint8Array][] {
    const fields = this.fieldsRegistry.get(handle)
    return fields?.getEntries() ?? []
  }

  private fieldsClone(handle: number): number {
    const fields = this.fieldsRegistry.get(handle)
    if (!fields) {
      return this.fieldsRegistry.register(new Fields())
    }
    return this.fieldsRegistry.register(fields.clone())
  }

  private fieldsDrop(handle: number): void {
    this.fieldsRegistry.drop(handle)
  }

  // Outgoing request operations
  private outgoingRequestConstructor(headersHandle: number): number {
    const request: OutgoingRequest = {
      handle: 0,
      method: { tag: 'get' },
      headers: headersHandle,
    }
    return this.requestRegistry.register(request)
  }

  private outgoingRequestMethod(handle: number): Method | undefined {
    return this.requestRegistry.get(handle)?.method
  }

  private outgoingRequestSetMethod(handle: number, method: Method): HttpError | undefined {
    const request = this.requestRegistry.get(handle)
    if (!request) {
      return { tag: 'internal-error', val: 'Invalid request handle' }
    }
    request.method = method
    return undefined
  }

  private outgoingRequestScheme(handle: number): Scheme | undefined {
    return this.requestRegistry.get(handle)?.scheme
  }

  private outgoingRequestSetScheme(handle: number, scheme?: Scheme): HttpError | undefined {
    const request = this.requestRegistry.get(handle)
    if (!request) {
      return { tag: 'internal-error', val: 'Invalid request handle' }
    }
    if (scheme !== undefined) {
      request.scheme = scheme
    } else {
      delete request.scheme
    }
    return undefined
  }

  private outgoingRequestAuthority(handle: number): string | undefined {
    return this.requestRegistry.get(handle)?.authority
  }

  private outgoingRequestSetAuthority(handle: number, authority?: string): HttpError | undefined {
    const request = this.requestRegistry.get(handle)
    if (!request) {
      return { tag: 'internal-error', val: 'Invalid request handle' }
    }
    if (authority !== undefined) {
      request.authority = authority
    } else {
      delete request.authority
    }
    return undefined
  }

  private outgoingRequestPathWithQuery(handle: number): string | undefined {
    return this.requestRegistry.get(handle)?.pathWithQuery
  }

  private outgoingRequestSetPathWithQuery(handle: number, path?: string): HttpError | undefined {
    const request = this.requestRegistry.get(handle)
    if (!request) {
      return { tag: 'internal-error', val: 'Invalid request handle' }
    }
    if (path !== undefined) {
      request.pathWithQuery = path
    } else {
      delete request.pathWithQuery
    }
    return undefined
  }

  private outgoingRequestHeaders(handle: number): number | undefined {
    return this.requestRegistry.get(handle)?.headers
  }

  private outgoingRequestBody(handle: number): number | { tag: 'err'; val: HttpError } {
    const request = this.requestRegistry.get(handle)
    if (!request) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid request handle' } }
    }

    if (request.body !== undefined) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Body already taken' } }
    }

    const bodyStream = new MemoryOutputStream()
    const bodyHandle = globalStreamRegistry.register(bodyStream)
    request.body = bodyHandle
    return bodyHandle
  }

  private outgoingRequestDrop(handle: number): void {
    this.requestRegistry.drop(handle)
  }

  // Incoming response operations
  private incomingResponseStatus(handle: number): number | undefined {
    return this.responseRegistry.get(handle)?.status
  }

  private incomingResponseHeaders(handle: number): number | undefined {
    return this.responseRegistry.get(handle)?.headers
  }

  private incomingResponseConsume(handle: number): number | { tag: 'err'; val: HttpError } {
    const response = this.responseRegistry.get(handle)
    if (!response) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid response handle' } }
    }

    if (response.body === undefined) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Body already consumed' } }
    }

    const bodyHandle = response.body
    delete response.body
    return bodyHandle
  }

  private incomingResponseDrop(handle: number): void {
    this.responseRegistry.drop(handle)
  }

  // Incoming body operations
  private incomingBodyStream(handle: number): number | { tag: 'err'; val: StreamError } {
    const stream = globalStreamRegistry.getInput(handle)
    if (!stream) {
      return { tag: 'err', val: { tag: 'closed' } }
    }
    return handle
  }

  private incomingBodyFinish(_handle: number): number {
    // Returns a future-trailers handle - we don't support trailers yet
    // Return a pollable that's immediately ready with no trailers
    return createReadyPollable(this.pollableRegistry)
  }

  private incomingBodyDrop(handle: number): void {
    globalStreamRegistry.drop(handle)
  }

  // Outgoing body operations
  private outgoingBodyWrite(handle: number): number | { tag: 'err'; val: StreamError } {
    const stream = globalStreamRegistry.getOutput(handle)
    if (!stream) {
      return { tag: 'err', val: { tag: 'closed' } }
    }
    return handle
  }

  private outgoingBodyFinish(
    handle: number,
    _trailers?: number
  ): { tag: 'err'; val: HttpError } | undefined {
    const stream = globalStreamRegistry.getOutput(handle)
    if (!stream) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid body handle' } }
    }
    stream.close()
    return undefined
  }

  private outgoingBodyDrop(handle: number): void {
    globalStreamRegistry.drop(handle)
  }

  // Future operations
  private futureSubscribe(handle: number): number {
    const future = this.futureRegistry.get(handle)
    if (!future) {
      return createReadyPollable(this.pollableRegistry)
    }

    if (future.result !== undefined) {
      return createReadyPollable(this.pollableRegistry)
    }

    return this.pollableRegistry.create(
      future.promise.then(() => {
        /* completed */
      })
    )
  }

  private futureGet(
    handle: number
  ): IncomingResponse | HttpError | undefined | { tag: 'err'; val: HttpError } {
    const future = this.futureRegistry.get(handle)
    if (!future) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid future handle' } }
    }

    if (future.result === undefined) {
      return undefined // Not ready yet
    }

    return future.result
  }

  private futureDrop(handle: number): void {
    this.futureRegistry.drop(handle)
  }

  // Request options operations
  private requestOptionsConstructor(): number {
    const opts: RequestOptionsResource = {
      handle: 0,
      options: {},
    }
    return this.optionsRegistry.register(opts)
  }

  private requestOptionsConnectTimeout(handle: number): bigint | undefined {
    return this.optionsRegistry.get(handle)?.options.connectTimeout
  }

  private requestOptionsSetConnectTimeout(
    handle: number,
    timeout?: bigint
  ): { tag: 'err'; val: HttpError } | undefined {
    const opts = this.optionsRegistry.get(handle)
    if (!opts) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid options handle' } }
    }
    if (timeout !== undefined) {
      opts.options.connectTimeout = timeout
    } else {
      delete opts.options.connectTimeout
    }
    return undefined
  }

  private requestOptionsFirstByteTimeout(handle: number): bigint | undefined {
    return this.optionsRegistry.get(handle)?.options.firstByteTimeout
  }

  private requestOptionsSetFirstByteTimeout(
    handle: number,
    timeout?: bigint
  ): { tag: 'err'; val: HttpError } | undefined {
    const opts = this.optionsRegistry.get(handle)
    if (!opts) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid options handle' } }
    }
    if (timeout !== undefined) {
      opts.options.firstByteTimeout = timeout
    } else {
      delete opts.options.firstByteTimeout
    }
    return undefined
  }

  private requestOptionsBetweenBytesTimeout(handle: number): bigint | undefined {
    return this.optionsRegistry.get(handle)?.options.betweenBytesTimeout
  }

  private requestOptionsSetBetweenBytesTimeout(
    handle: number,
    timeout?: bigint
  ): { tag: 'err'; val: HttpError } | undefined {
    const opts = this.optionsRegistry.get(handle)
    if (!opts) {
      return { tag: 'err', val: { tag: 'internal-error', val: 'Invalid options handle' } }
    }
    if (timeout !== undefined) {
      opts.options.betweenBytesTimeout = timeout
    } else {
      delete opts.options.betweenBytesTimeout
    }
    return undefined
  }

  private requestOptionsDrop(handle: number): void {
    this.optionsRegistry.drop(handle)
  }

  // Utility functions
  private httpErrorCode(error: HttpError): string | undefined {
    // Return the error code as a string
    return error.tag
  }
}

/**
 * Fetch-based outgoing handler implementation
 */
export const fetchOutgoingHandlerImplementation: Implementation = {
  name: 'fetch',
  description: 'Outgoing HTTP handler using browser Fetch API',
  create(config: PluginConfig): PluginInstance {
    const handlerConfig: OutgoingHandlerConfig = {}
    const allowedOrigins = config.options?.['allowedOrigins'] as string[] | undefined
    const defaultTimeoutMs = config.options?.['defaultTimeoutMs'] as number | undefined
    const userAgent = config.options?.['userAgent'] as string | undefined

    if (allowedOrigins !== undefined) {
      handlerConfig.allowedOrigins = allowedOrigins
    }
    if (defaultTimeoutMs !== undefined) {
      handlerConfig.defaultTimeoutMs = defaultTimeoutMs
    }
    if (userAgent !== undefined) {
      handlerConfig.userAgent = userAgent
    }

    return new OutgoingHandlerInstance(
      globalOutgoingRequestRegistry,
      globalIncomingResponseRegistry,
      globalFutureIncomingResponseRegistry,
      globalRequestOptionsRegistry,
      globalFieldsRegistry,
      globalPollableRegistry,
      handlerConfig
    )
  },
}

/**
 * Fetch-based HTTP types implementation
 */
export const fetchHttpTypesImplementation: Implementation = {
  name: 'fetch',
  description: 'HTTP types using browser Fetch API',
  create(_config: PluginConfig): PluginInstance {
    return new HttpTypesInstance(
      globalOutgoingRequestRegistry,
      globalIncomingResponseRegistry,
      globalFutureIncomingResponseRegistry,
      globalRequestOptionsRegistry,
      globalFieldsRegistry,
      globalPollableRegistry
    )
  },
}
