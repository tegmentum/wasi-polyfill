/**
 * WASI HTTP 0.3.0 interface
 *
 * P3 HTTP is dramatically simplified compared to P2:
 * - Single async handler function replaces complex polling
 * - 5 resource types instead of 11
 * - Native async for request/response handling
 *
 * @packageDocumentation
 */

import type { Stream, StreamWriter } from '../types.js'
import { createStream } from '../canonical-abi/stream.js'

/**
 * HTTP method.
 */
export type Method =
  | { tag: 'get' }
  | { tag: 'head' }
  | { tag: 'post' }
  | { tag: 'put' }
  | { tag: 'delete' }
  | { tag: 'connect' }
  | { tag: 'options' }
  | { tag: 'trace' }
  | { tag: 'patch' }
  | { tag: 'other'; val: string }

/**
 * HTTP scheme.
 */
export type Scheme =
  | { tag: 'HTTP' }
  | { tag: 'HTTPS' }
  | { tag: 'other'; val: string }

/**
 * HTTP error codes.
 */
export enum HttpErrorCode {
  DNS_TIMEOUT = 0,
  DNS_ERROR = 1,
  DESTINATION_NOT_FOUND = 2,
  DESTINATION_UNAVAILABLE = 3,
  DESTINATION_IP_PROHIBITED = 4,
  DESTINATION_IP_UNROUTABLE = 5,
  CONNECTION_REFUSED = 6,
  CONNECTION_TERMINATED = 7,
  CONNECTION_TIMEOUT = 8,
  CONNECTION_READ_TIMEOUT = 9,
  CONNECTION_WRITE_TIMEOUT = 10,
  CONNECTION_LIMIT_REACHED = 11,
  TLS_PROTOCOL_ERROR = 12,
  TLS_CERTIFICATE_ERROR = 13,
  TLS_ALERT_RECEIVED = 14,
  HTTP_REQUEST_DENIED = 15,
  HTTP_REQUEST_LENGTH_REQUIRED = 16,
  HTTP_REQUEST_BODY_SIZE = 17,
  HTTP_REQUEST_METHOD_INVALID = 18,
  HTTP_REQUEST_URI_INVALID = 19,
  HTTP_REQUEST_URI_TOO_LONG = 20,
  HTTP_REQUEST_HEADER_SECTION_SIZE = 21,
  HTTP_REQUEST_HEADER_SIZE = 22,
  HTTP_REQUEST_TRAILER_SECTION_SIZE = 23,
  HTTP_REQUEST_TRAILER_SIZE = 24,
  HTTP_RESPONSE_INCOMPLETE = 25,
  HTTP_RESPONSE_HEADER_SECTION_SIZE = 26,
  HTTP_RESPONSE_HEADER_SIZE = 27,
  HTTP_RESPONSE_BODY_SIZE = 28,
  HTTP_RESPONSE_TRAILER_SECTION_SIZE = 29,
  HTTP_RESPONSE_TRAILER_SIZE = 30,
  HTTP_RESPONSE_TRANSFER_CODING = 31,
  HTTP_RESPONSE_CONTENT_CODING = 32,
  HTTP_RESPONSE_TIMEOUT = 33,
  HTTP_UPGRADE_FAILED = 34,
  HTTP_PROTOCOL_ERROR = 35,
  LOOP_DETECTED = 36,
  CONFIGURATION_ERROR = 37,
  INTERNAL_ERROR = 38,
}

/**
 * HTTP headers (fields).
 */
export class Fields {
  private entries: Map<string, string[]> = new Map()

  constructor(init?: Array<[string, Uint8Array]>) {
    if (init) {
      const decoder = new TextDecoder()
      for (const [name, value] of init) {
        this.append(name, decoder.decode(value))
      }
    }
  }

  /**
   * Get all values for a header.
   */
  get(name: string): string[] {
    return this.entries.get(name.toLowerCase()) ?? []
  }

  /**
   * Check if a header exists.
   */
  has(name: string): boolean {
    return this.entries.has(name.toLowerCase())
  }

  /**
   * Set a header (replaces existing values).
   */
  set(name: string, value: string): void {
    this.entries.set(name.toLowerCase(), [value])
  }

  /**
   * Append a value to a header.
   */
  append(name: string, value: string): void {
    const key = name.toLowerCase()
    const existing = this.entries.get(key) ?? []
    existing.push(value)
    this.entries.set(key, existing)
  }

  /**
   * Delete a header.
   */
  delete(name: string): void {
    this.entries.delete(name.toLowerCase())
  }

  /**
   * Get all entries.
   */
  getEntries(): Array<[string, Uint8Array]> {
    const encoder = new TextEncoder()
    const result: Array<[string, Uint8Array]> = []
    for (const [name, values] of this.entries) {
      for (const value of values) {
        result.push([name, encoder.encode(value)])
      }
    }
    return result
  }

  /**
   * Clone the fields.
   */
  clone(): Fields {
    const cloned = new Fields()
    for (const [name, values] of this.entries) {
      cloned.entries.set(name, [...values])
    }
    return cloned
  }

  /**
   * Convert to native Headers object.
   */
  toHeaders(): Headers {
    const headers = new Headers()
    for (const [name, values] of this.entries) {
      for (const value of values) {
        headers.append(name, value)
      }
    }
    return headers
  }

  /**
   * Create from native Headers object.
   */
  static fromHeaders(headers: Headers): Fields {
    const fields = new Fields()
    headers.forEach((value, name) => {
      fields.append(name, value)
    })
    return fields
  }
}

/**
 * HTTP request body.
 */
export class Body {
  private stream: Stream<Uint8Array>
  private writer: StreamWriter<Uint8Array>

  constructor() {
    const [reader, writer] = createStream<Uint8Array>()
    this.stream = reader
    this.writer = writer
  }

  /**
   * Get the body as a stream.
   */
  getStream(): Stream<Uint8Array> {
    return this.stream
  }

  /**
   * Write data to the body.
   */
  async write(data: Uint8Array): Promise<void> {
    await this.writer.write([data])
  }

  /**
   * Finish writing the body.
   */
  finish(_trailers?: Fields): void {
    // Note: trailers are not fully supported yet
    this.writer.close()
  }

  /**
   * Create a body from a Uint8Array.
   */
  static fromBytes(data: Uint8Array): Body {
    const body = new Body()
    body.write(data).then(() => body.finish())
    return body
  }

  /**
   * Create a body from a string.
   */
  static fromString(text: string): Body {
    return Body.fromBytes(new TextEncoder().encode(text))
  }
}

/**
 * HTTP request.
 */
export class Request {
  method: Method = { tag: 'get' }
  scheme?: Scheme
  authority?: string
  pathWithQuery?: string
  headers: Fields = new Fields()
  body?: Body

  /**
   * Create a request from a URL.
   */
  static fromUrl(url: string, method: Method = { tag: 'get' }): Request {
    const req = new Request()
    req.method = method

    try {
      const parsed = new URL(url)
      req.scheme = parsed.protocol === 'https:' ? { tag: 'HTTPS' } : { tag: 'HTTP' }
      req.authority = parsed.host
      req.pathWithQuery = parsed.pathname + parsed.search
    } catch {
      req.pathWithQuery = url
    }

    return req
  }

  /**
   * Convert to native fetch Request.
   */
  toFetchRequest(): globalThis.Request {
    const scheme = this.scheme?.tag === 'HTTPS' ? 'https' : 'http'
    const url = `${scheme}://${this.authority ?? 'localhost'}${this.pathWithQuery ?? '/'}`

    let method = 'GET'
    switch (this.method.tag) {
      case 'get': method = 'GET'; break
      case 'head': method = 'HEAD'; break
      case 'post': method = 'POST'; break
      case 'put': method = 'PUT'; break
      case 'delete': method = 'DELETE'; break
      case 'connect': method = 'CONNECT'; break
      case 'options': method = 'OPTIONS'; break
      case 'trace': method = 'TRACE'; break
      case 'patch': method = 'PATCH'; break
      case 'other': method = this.method.val; break
    }

    return new globalThis.Request(url, {
      method,
      headers: this.headers.toHeaders(),
    })
  }
}

/**
 * HTTP response.
 */
export class Response {
  status: number = 200
  headers: Fields = new Fields()
  body?: Body

  /**
   * Create a response with a status code.
   */
  static withStatus(status: number): Response {
    const resp = new Response()
    resp.status = status
    return resp
  }

  /**
   * Create a response from a native fetch Response.
   */
  static async fromFetchResponse(fetchResp: globalThis.Response): Promise<Response> {
    const resp = new Response()
    resp.status = fetchResp.status
    resp.headers = Fields.fromHeaders(fetchResp.headers)

    if (fetchResp.body) {
      resp.body = new Body()
      const reader = fetchResp.body.getReader()

      // Pipe the fetch body to our body
      const pipeBody = async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) await resp.body!.write(value)
        }
        resp.body!.finish()
      }
      pipeBody().catch(() => resp.body?.finish())
    }

    return resp
  }
}

/**
 * HTTP handler function type (P3 simplified async handler).
 */
export type HttpHandler = (request: Request) => Promise<Response>

/**
 * Outgoing HTTP handler - makes outbound requests.
 */
export class OutgoingHandler {
  private fetchFn: typeof fetch

  constructor(fetchFn: typeof fetch = globalThis.fetch) {
    this.fetchFn = fetchFn.bind(globalThis)
  }

  /**
   * Handle an outgoing request (async).
   */
  async handle(request: Request): Promise<Response> {
    try {
      const fetchReq = request.toFetchRequest()
      const fetchResp = await this.fetchFn(fetchReq)
      return Response.fromFetchResponse(fetchResp)
    } catch (error) {
      // Return an error response
      const resp = Response.withStatus(0)
      resp.headers.set('x-error', error instanceof Error ? error.message : 'Unknown error')
      return resp
    }
  }
}

/**
 * Incoming HTTP handler - handles inbound requests.
 */
export class IncomingHandler {
  private handler: HttpHandler

  constructor(handler: HttpHandler) {
    this.handler = handler
  }

  /**
   * Handle an incoming request (async).
   */
  async handle(request: Request): Promise<Response> {
    return this.handler(request)
  }
}

/**
 * Get the wasi:http@0.3.0 imports.
 *
 * @param outgoingHandler - Handler for outgoing requests
 * @returns Import object for wasi:http@0.3.0
 */
export function getHttpImports(
  outgoingHandler: OutgoingHandler = new OutgoingHandler()
): Record<string, unknown> {
  // Resource handles
  let nextHandle = 1
  const fields = new Map<number, Fields>()
  const bodies = new Map<number, Body>()
  const requests = new Map<number, Request>()
  const responses = new Map<number, Response>()

  return {
    'wasi:http/types@0.3.0': {
      // Fields resource
      '[constructor]fields': (): number => {
        const handle = nextHandle++
        fields.set(handle, new Fields())
        return handle
      },

      '[static]fields.from-list': (entries: Array<[string, Uint8Array]>): number => {
        const handle = nextHandle++
        fields.set(handle, new Fields(entries))
        return handle
      },

      '[method]fields.get': (handle: number, name: string): Uint8Array[] => {
        const f = fields.get(handle)
        if (!f) return []
        const encoder = new TextEncoder()
        return f.get(name).map(v => encoder.encode(v))
      },

      '[method]fields.set': (handle: number, name: string, values: Uint8Array[]): void => {
        const f = fields.get(handle)
        if (!f) return
        const decoder = new TextDecoder()
        f.delete(name)
        for (const v of values) {
          f.append(name, decoder.decode(v))
        }
      },

      '[method]fields.append': (handle: number, name: string, value: Uint8Array): void => {
        const f = fields.get(handle)
        if (!f) return
        f.append(name, new TextDecoder().decode(value))
      },

      '[method]fields.delete': (handle: number, name: string): void => {
        fields.get(handle)?.delete(name)
      },

      '[method]fields.entries': (handle: number): Array<[string, Uint8Array]> => {
        return fields.get(handle)?.getEntries() ?? []
      },

      '[method]fields.clone': (handle: number): number => {
        const f = fields.get(handle)
        if (!f) return 0
        const newHandle = nextHandle++
        fields.set(newHandle, f.clone())
        return newHandle
      },

      '[resource-drop]fields': (handle: number): void => {
        fields.delete(handle)
      },

      // Body resource
      '[constructor]body': (): number => {
        const handle = nextHandle++
        bodies.set(handle, new Body())
        return handle
      },

      '[method]body.stream': (handle: number): Stream<Uint8Array> | undefined => {
        return bodies.get(handle)?.getStream()
      },

      '[static]body.finish': (handle: number, trailers?: number): void => {
        const b = bodies.get(handle)
        const t = trailers !== undefined ? fields.get(trailers) : undefined
        b?.finish(t)
      },

      '[resource-drop]body': (handle: number): void => {
        bodies.delete(handle)
      },

      // Request resource
      '[constructor]request': (headersHandle: number): number => {
        const handle = nextHandle++
        const req = new Request()
        const h = fields.get(headersHandle)
        if (h) req.headers = h
        requests.set(handle, req)
        return handle
      },

      '[method]request.method': (handle: number): Method => {
        return requests.get(handle)?.method ?? { tag: 'get' }
      },

      '[method]request.set-method': (handle: number, method: Method): void => {
        const req = requests.get(handle)
        if (req) req.method = method
      },

      '[method]request.scheme': (handle: number): Scheme | undefined => {
        return requests.get(handle)?.scheme
      },

      '[method]request.set-scheme': (handle: number, scheme: Scheme): void => {
        const req = requests.get(handle)
        if (req) req.scheme = scheme
      },

      '[method]request.authority': (handle: number): string | undefined => {
        return requests.get(handle)?.authority
      },

      '[method]request.set-authority': (handle: number, authority: string): void => {
        const req = requests.get(handle)
        if (req) req.authority = authority
      },

      '[method]request.path-with-query': (handle: number): string | undefined => {
        return requests.get(handle)?.pathWithQuery
      },

      '[method]request.set-path-with-query': (handle: number, path: string): void => {
        const req = requests.get(handle)
        if (req) req.pathWithQuery = path
      },

      '[method]request.headers': (handle: number): number => {
        const req = requests.get(handle)
        if (!req) return 0
        const h = nextHandle++
        fields.set(h, req.headers)
        return h
      },

      '[method]request.body': (handle: number): number | undefined => {
        const req = requests.get(handle)
        if (!req?.body) return undefined
        const h = nextHandle++
        bodies.set(h, req.body)
        return h
      },

      '[method]request.set-body': (handle: number, bodyHandle: number): void => {
        const req = requests.get(handle)
        const body = bodies.get(bodyHandle)
        if (req && body) req.body = body
      },

      '[resource-drop]request': (handle: number): void => {
        requests.delete(handle)
      },

      // Response resource
      '[constructor]response': (headersHandle: number): number => {
        const handle = nextHandle++
        const resp = new Response()
        const h = fields.get(headersHandle)
        if (h) resp.headers = h
        responses.set(handle, resp)
        return handle
      },

      '[method]response.status': (handle: number): number => {
        return responses.get(handle)?.status ?? 0
      },

      '[method]response.set-status': (handle: number, status: number): void => {
        const resp = responses.get(handle)
        if (resp) resp.status = status
      },

      '[method]response.headers': (handle: number): number => {
        const resp = responses.get(handle)
        if (!resp) return 0
        const h = nextHandle++
        fields.set(h, resp.headers)
        return h
      },

      '[method]response.body': (handle: number): number | undefined => {
        const resp = responses.get(handle)
        if (!resp?.body) return undefined
        const h = nextHandle++
        bodies.set(h, resp.body)
        return h
      },

      '[method]response.set-body': (handle: number, bodyHandle: number): void => {
        const resp = responses.get(handle)
        const body = bodies.get(bodyHandle)
        if (resp && body) resp.body = body
      },

      '[resource-drop]response': (handle: number): void => {
        responses.delete(handle)
      },
    },

    'wasi:http/outgoing-handler@0.3.0': {
      // P3 async handle function
      handle: async (requestHandle: number): Promise<number> => {
        const req = requests.get(requestHandle)
        if (!req) throw new Error('Invalid request handle')

        const resp = await outgoingHandler.handle(req)
        const respHandle = nextHandle++
        responses.set(respHandle, resp)
        return respHandle
      },
    },
  }
}
