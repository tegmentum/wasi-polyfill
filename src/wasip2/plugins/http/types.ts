/**
 * HTTP types for wasi:http/types
 *
 * Core HTTP types used by the HTTP plugin, including methods, schemes,
 * headers, and error codes.
 */

/**
 * HTTP method type
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
 * HTTP scheme type
 */
export type Scheme =
  | { tag: 'http' }
  | { tag: 'https' }
  | { tag: 'other'; val: string }

/**
 * HTTP error code enumeration
 */
export enum HttpErrorCode {
  /** DNS resolution failed */
  DnsTimeout = 'DNS-timeout',
  DnsError = 'DNS-error',

  /** Connection errors */
  DestinationNotFound = 'destination-not-found',
  DestinationUnavailable = 'destination-unavailable',
  DestinationIpProhibited = 'destination-IP-prohibited',
  DestinationIpUnroutable = 'destination-IP-unroutable',
  ConnectionRefused = 'connection-refused',
  ConnectionTerminated = 'connection-terminated',
  ConnectionTimeout = 'connection-timeout',
  ConnectionReadTimeout = 'connection-read-timeout',
  ConnectionWriteTimeout = 'connection-write-timeout',
  ConnectionLimitReached = 'connection-limit-reached',

  /** TLS errors */
  TlsProtocolError = 'TLS-protocol-error',
  TlsCertificateError = 'TLS-certificate-error',
  TlsAlertReceived = 'TLS-alert-received',

  /** HTTP protocol errors */
  HttpRequestDenied = 'HTTP-request-denied',
  HttpRequestLengthRequired = 'HTTP-request-length-required',
  HttpRequestBodySize = 'HTTP-request-body-size',
  HttpRequestMethodInvalid = 'HTTP-request-method-invalid',
  HttpRequestUriInvalid = 'HTTP-request-URI-invalid',
  HttpRequestUriTooLong = 'HTTP-request-URI-too-long',
  HttpRequestHeaderSectionSize = 'HTTP-request-header-section-size',
  HttpRequestHeaderSize = 'HTTP-request-header-size',
  HttpRequestTrailerSectionSize = 'HTTP-request-trailer-section-size',
  HttpRequestTrailerSize = 'HTTP-request-trailer-size',
  HttpResponseIncomplete = 'HTTP-response-incomplete',
  HttpResponseHeaderSectionSize = 'HTTP-response-header-section-size',
  HttpResponseHeaderSize = 'HTTP-response-header-size',
  HttpResponseBodySize = 'HTTP-response-body-size',
  HttpResponseTrailerSectionSize = 'HTTP-response-trailer-section-size',
  HttpResponseTrailerSize = 'HTTP-response-trailer-size',
  HttpResponseTransferCoding = 'HTTP-response-transfer-coding',
  HttpResponseContentCoding = 'HTTP-response-content-coding',
  HttpResponseTimeout = 'HTTP-response-timeout',
  HttpUpgradeFailed = 'HTTP-upgrade-failed',
  HttpProtocolError = 'HTTP-protocol-error',
  LoopDetected = 'loop-detected',
  ConfigurationError = 'configuration-error',

  /** Internal errors */
  InternalError = 'internal-error',
}

/**
 * HTTP error type with optional context
 */
export type HttpError =
  | { tag: 'DNS-timeout' }
  | { tag: 'DNS-error'; val?: DnsErrorPayload }
  | { tag: 'destination-not-found' }
  | { tag: 'destination-unavailable' }
  | { tag: 'destination-IP-prohibited' }
  | { tag: 'destination-IP-unroutable' }
  | { tag: 'connection-refused' }
  | { tag: 'connection-terminated' }
  | { tag: 'connection-timeout' }
  | { tag: 'connection-read-timeout' }
  | { tag: 'connection-write-timeout' }
  | { tag: 'connection-limit-reached' }
  | { tag: 'TLS-protocol-error' }
  | { tag: 'TLS-certificate-error' }
  | { tag: 'TLS-alert-received'; val?: TlsAlertReceivedPayload }
  | { tag: 'HTTP-request-denied' }
  | { tag: 'HTTP-request-length-required' }
  | { tag: 'HTTP-request-body-size'; val?: bigint }
  | { tag: 'HTTP-request-method-invalid' }
  | { tag: 'HTTP-request-URI-invalid' }
  | { tag: 'HTTP-request-URI-too-long' }
  | { tag: 'HTTP-request-header-section-size'; val?: number }
  | { tag: 'HTTP-request-header-size'; val?: FieldSizePayload }
  | { tag: 'HTTP-request-trailer-section-size'; val?: number }
  | { tag: 'HTTP-request-trailer-size'; val?: FieldSizePayload }
  | { tag: 'HTTP-response-incomplete' }
  | { tag: 'HTTP-response-header-section-size'; val?: number }
  | { tag: 'HTTP-response-header-size'; val?: FieldSizePayload }
  | { tag: 'HTTP-response-body-size'; val?: bigint }
  | { tag: 'HTTP-response-trailer-section-size'; val?: number }
  | { tag: 'HTTP-response-trailer-size'; val?: FieldSizePayload }
  | { tag: 'HTTP-response-transfer-coding'; val?: string }
  | { tag: 'HTTP-response-content-coding'; val?: string }
  | { tag: 'HTTP-response-timeout' }
  | { tag: 'HTTP-upgrade-failed' }
  | { tag: 'HTTP-protocol-error' }
  | { tag: 'loop-detected' }
  | { tag: 'configuration-error' }
  | { tag: 'internal-error'; val?: string }

/**
 * DNS error payload
 */
export interface DnsErrorPayload {
  rcode?: string
  infoCode?: number
}

/**
 * TLS alert received payload
 */
export interface TlsAlertReceivedPayload {
  alertId?: number
  alertMessage?: string
}

/**
 * Field size payload for header/trailer size errors
 */
export interface FieldSizePayload {
  fieldName?: string
  fieldSize?: number
}

/**
 * Request options for outgoing requests
 */
export interface RequestOptions {
  /** Connect timeout in nanoseconds */
  connectTimeout?: bigint
  /** First byte timeout in nanoseconds */
  firstByteTimeout?: bigint
  /** Between bytes timeout in nanoseconds */
  betweenBytesTimeout?: bigint
}

/**
 * Convert a Method variant to a string
 */
export function methodToString(method: Method): string {
  switch (method.tag) {
    case 'get':
      return 'GET'
    case 'head':
      return 'HEAD'
    case 'post':
      return 'POST'
    case 'put':
      return 'PUT'
    case 'delete':
      return 'DELETE'
    case 'connect':
      return 'CONNECT'
    case 'options':
      return 'OPTIONS'
    case 'trace':
      return 'TRACE'
    case 'patch':
      return 'PATCH'
    case 'other':
      return method.val
  }
}

/**
 * Parse a string into a Method variant
 */
export function stringToMethod(str: string): Method {
  const upper = str.toUpperCase()
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
      return { tag: 'other', val: str }
  }
}

/**
 * Convert a Scheme variant to a string
 */
export function schemeToString(scheme: Scheme): string {
  switch (scheme.tag) {
    case 'http':
      return 'http'
    case 'https':
      return 'https'
    case 'other':
      return scheme.val
  }
}

/**
 * Parse a string into a Scheme variant
 */
export function stringToScheme(str: string): Scheme {
  const lower = str.toLowerCase()
  switch (lower) {
    case 'http':
      return { tag: 'http' }
    case 'https':
      return { tag: 'https' }
    default:
      return { tag: 'other', val: str }
  }
}

/**
 * Map a JavaScript fetch error to an HttpError
 */
export function mapFetchError(error: Error): HttpError {
  const message = error.message.toLowerCase()

  // Network/DNS errors
  if (message.includes('dns') || message.includes('resolve')) {
    return { tag: 'DNS-error' }
  }
  if (message.includes('network') || message.includes('failed to fetch')) {
    return { tag: 'destination-unavailable' }
  }
  if (message.includes('refused')) {
    return { tag: 'connection-refused' }
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return { tag: 'connection-timeout' }
  }
  if (message.includes('abort')) {
    return { tag: 'connection-terminated' }
  }

  // TLS errors
  if (message.includes('certificate') || message.includes('ssl') || message.includes('tls')) {
    return { tag: 'TLS-certificate-error' }
  }

  // CORS errors (browser-specific)
  if (message.includes('cors') || message.includes('cross-origin')) {
    return { tag: 'HTTP-request-denied' }
  }

  // Default to internal error
  return { tag: 'internal-error', val: error.message }
}
