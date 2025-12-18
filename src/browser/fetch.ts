/**
 * browser:fetch - HTTP client interface
 *
 * Provides a capability-scoped interface to the Fetch API
 * for making HTTP requests from WebAssembly components.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  mapErrorToBrowserError,
  type Result,
  ok,
  browserErr,
  type Headers,
  type Bytes,
  nativeHeadersToHeaders,
  headersToNativeHeaders,
  validateUrl,
  type Url,
} from './types.js'

// =============================================================================
// Request/Response Types
// =============================================================================

/**
 * HTTP method.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'

/**
 * Fetch request configuration.
 */
export interface FetchRequest {
  /** URL to fetch */
  url: Url
  /** HTTP method (default: GET) */
  method?: HttpMethod
  /** Request headers */
  headers?: Headers
  /** Request body */
  body?: Bytes
  /** Request timeout in milliseconds */
  timeout?: number
  /** Credentials mode */
  credentials?: 'omit' | 'same-origin' | 'include'
  /** Cache mode */
  cache?: 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache'
  /** Redirect mode */
  redirect?: 'follow' | 'error' | 'manual'
  /** Referrer policy */
  referrerPolicy?: ReferrerPolicy
}

/**
 * Fetch response.
 */
export interface FetchResponse {
  /** Response status code */
  status: number
  /** Response status text */
  statusText: string
  /** Response headers */
  headers: Headers
  /** Response URL (may differ from request due to redirects) */
  url: string
  /** Whether the response was redirected */
  redirected: boolean
  /** Whether the response indicates success (2xx) */
  ok: boolean
  /** Response body as bytes */
  body: Bytes
}

/**
 * Fetch options for the BrowserFetch class.
 */
export interface FetchOptions {
  /** Custom fetch function (for testing or polyfills) */
  fetch?: typeof globalThis.fetch
  /** Default timeout in milliseconds */
  defaultTimeout?: number
  /** Allowed URL patterns (security) */
  allowedOrigins?: string[]
  /** Maximum response size in bytes */
  maxResponseSize?: number
}

// =============================================================================
// Browser Fetch
// =============================================================================

/**
 * Browser fetch implementation.
 */
export class BrowserFetch {
  private fetchFn: typeof globalThis.fetch
  private defaultTimeout: number
  private allowedOrigins: string[] | null
  private maxResponseSize: number

  constructor(options: FetchOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.defaultTimeout = options.defaultTimeout ?? 30000 // 30 seconds
    this.allowedOrigins = options.allowedOrigins ?? null
    this.maxResponseSize = options.maxResponseSize ?? 50 * 1024 * 1024 // 50MB
  }

  /**
   * Check if a URL is allowed by the origin policy.
   */
  private isOriginAllowed(url: URL): boolean {
    if (this.allowedOrigins === null) {
      return true // No restrictions
    }

    const origin = url.origin
    return this.allowedOrigins.some(allowed => {
      if (allowed === '*') return true
      if (allowed.startsWith('*.')) {
        // Wildcard subdomain match
        const domain = allowed.slice(2)
        return origin.endsWith(domain) || origin.endsWith('.' + domain)
      }
      return origin === allowed
    })
  }

  /**
   * Perform a fetch request.
   */
  async fetch(request: FetchRequest): Promise<Result<FetchResponse, BrowserError>> {
    // Validate URL
    const urlResult = validateUrl(request.url)
    if (!urlResult.ok) {
      return urlResult
    }
    const url = urlResult.value

    // Check origin policy
    if (!this.isOriginAllowed(url)) {
      return browserErr(
        BrowserErrorCode.DENIED,
        `Origin '${url.origin}' is not in the allowed origins list`
      )
    }

    // Build fetch options
    const init: RequestInit = {
      method: request.method ?? 'GET',
      credentials: request.credentials ?? 'same-origin',
      cache: request.cache ?? 'default',
      redirect: request.redirect ?? 'follow',
      referrerPolicy: request.referrerPolicy ?? 'strict-origin-when-cross-origin',
    }

    if (request.headers) {
      init.headers = headersToNativeHeaders(request.headers)
    }

    if (request.body) {
      // Convert Uint8Array to ArrayBuffer for fetch API compatibility
      const bodyBuffer = new ArrayBuffer(request.body.byteLength)
      new Uint8Array(bodyBuffer).set(request.body)
      init.body = bodyBuffer
    }

    // Set up timeout
    const timeout = request.timeout ?? this.defaultTimeout
    const controller = new AbortController()
    init.signal = controller.signal

    const timeoutId = setTimeout(() => {
      controller.abort()
    }, timeout)

    try {
      const response = await this.fetchFn(url.href, init)
      clearTimeout(timeoutId)

      // Check response size via Content-Length header
      const contentLength = response.headers.get('content-length')
      if (contentLength && parseInt(contentLength, 10) > this.maxResponseSize) {
        return browserErr(
          BrowserErrorCode.INVALID_ARGUMENT,
          `Response size ${contentLength} exceeds maximum allowed size ${this.maxResponseSize}`
        )
      }

      // Read body
      const arrayBuffer = await response.arrayBuffer()

      // Check actual response size
      if (arrayBuffer.byteLength > this.maxResponseSize) {
        return browserErr(
          BrowserErrorCode.INVALID_ARGUMENT,
          `Response size ${arrayBuffer.byteLength} exceeds maximum allowed size ${this.maxResponseSize}`
        )
      }

      const body = new Uint8Array(arrayBuffer)

      return ok({
        status: response.status,
        statusText: response.statusText,
        headers: nativeHeadersToHeaders(response.headers),
        url: response.url,
        redirected: response.redirected,
        ok: response.ok,
        body,
      })
    } catch (error) {
      clearTimeout(timeoutId)

      // Handle abort/timeout
      if (error instanceof DOMException && error.name === 'AbortError') {
        return browserErr(
          BrowserErrorCode.TIMEOUT,
          `Request timed out after ${timeout}ms`
        )
      }

      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Convenience method for GET requests.
   */
  async get(url: Url, headers?: Headers): Promise<Result<FetchResponse, BrowserError>> {
    const request: FetchRequest = { url, method: 'GET' }
    if (headers !== undefined) request.headers = headers
    return this.fetch(request)
  }

  /**
   * Convenience method for POST requests.
   */
  async post(url: Url, body: Bytes, headers?: Headers): Promise<Result<FetchResponse, BrowserError>> {
    const request: FetchRequest = { url, method: 'POST', body }
    if (headers !== undefined) request.headers = headers
    return this.fetch(request)
  }

  /**
   * Convenience method for PUT requests.
   */
  async put(url: Url, body: Bytes, headers?: Headers): Promise<Result<FetchResponse, BrowserError>> {
    const request: FetchRequest = { url, method: 'PUT', body }
    if (headers !== undefined) request.headers = headers
    return this.fetch(request)
  }

  /**
   * Convenience method for DELETE requests.
   */
  async delete(url: Url, headers?: Headers): Promise<Result<FetchResponse, BrowserError>> {
    const request: FetchRequest = { url, method: 'DELETE' }
    if (headers !== undefined) request.headers = headers
    return this.fetch(request)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultFetch: BrowserFetch | null = null

/**
 * Get the default fetch instance.
 */
function getDefaultFetch(): BrowserFetch {
  if (!defaultFetch) {
    defaultFetch = new BrowserFetch()
  }
  return defaultFetch
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Perform a fetch request.
 */
export async function fetch(request: FetchRequest): Promise<Result<FetchResponse, BrowserError>> {
  return getDefaultFetch().fetch(request)
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:fetch imports object.
 */
export function getBrowserFetchImports(fetchFn?: typeof globalThis.fetch): Record<string, unknown> {
  const browserFetch = fetchFn ? new BrowserFetch({ fetch: fetchFn }) : getDefaultFetch()

  return {
    'browser:fetch/fetch': {
      // Core fetch
      fetch: (request: FetchRequest) => browserFetch.fetch(request),

      // Convenience methods
      get: (url: Url, headers?: Headers) => browserFetch.get(url, headers),
      post: (url: Url, body: Bytes, headers?: Headers) => browserFetch.post(url, body, headers),
      put: (url: Url, body: Bytes, headers?: Headers) => browserFetch.put(url, body, headers),
      delete: (url: Url, headers?: Headers) => browserFetch.delete(url, headers),
    },
  }
}
