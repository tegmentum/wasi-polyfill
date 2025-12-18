/**
 * browser:types - Shared types for browser:* interfaces
 *
 * Provides common types used across all browser interfaces including
 * error handling, headers, URLs, and byte buffers.
 *
 * @packageDocumentation
 */

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for browser:* interfaces.
 *
 * These codes provide a stable, enumerable set of error categories
 * that components can handle programmatically.
 */
export enum BrowserErrorCode {
  /** Permission or policy denial */
  DENIED = 'denied',
  /** API not available in this environment */
  NOT_SUPPORTED = 'not-supported',
  /** Invalid argument provided */
  INVALID_ARGUMENT = 'invalid-argument',
  /** Requested resource not found */
  NOT_FOUND = 'not-found',
  /** Operation timed out */
  TIMEOUT = 'timeout',
  /** Operation was aborted */
  ABORTED = 'aborted',
  /** Network error occurred */
  NETWORK = 'network',
  /** Security violation (CSP, mixed content, cross-origin) */
  SECURITY = 'security',
  /** Resource is busy or locked */
  BUSY = 'busy',
  /** Operation requires main thread */
  WRONG_THREAD = 'wrong-thread',
  /** Operation requires secure context (HTTPS) */
  INSECURE_CONTEXT = 'insecure-context',
  /** Operation requires user gesture */
  NO_USER_GESTURE = 'no-user-gesture',
  /** Unknown error */
  UNKNOWN = 'unknown',
}

/**
 * Browser error with code and message.
 */
export interface BrowserError {
  /** Error code for programmatic handling */
  code: BrowserErrorCode
  /** Human-readable error message */
  message: string
  /** Optional additional details */
  details?: unknown
}

/**
 * Create a BrowserError instance.
 */
export function createBrowserError(
  code: BrowserErrorCode,
  message: string,
  details?: unknown
): BrowserError {
  return { code, message, details }
}

/**
 * Error class for browser:* interfaces.
 */
export class BrowserException extends Error {
  readonly code: BrowserErrorCode
  readonly details?: unknown

  constructor(error: BrowserError) {
    super(error.message)
    this.name = 'BrowserException'
    this.code = error.code
    this.details = error.details
  }

  toBrowserError(): BrowserError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    }
  }
}

/**
 * Map a JavaScript error to a BrowserError.
 */
export function mapErrorToBrowserError(error: unknown): BrowserError {
  if (error instanceof BrowserException) {
    return error.toBrowserError()
  }

  if (error instanceof DOMException) {
    return mapDOMExceptionToBrowserError(error)
  }

  if (error instanceof TypeError) {
    return createBrowserError(
      BrowserErrorCode.INVALID_ARGUMENT,
      error.message
    )
  }

  if (error instanceof Error) {
    // Check for common error patterns
    const message = error.message.toLowerCase()

    if (message.includes('permission') || message.includes('denied')) {
      return createBrowserError(BrowserErrorCode.DENIED, error.message)
    }
    if (message.includes('network') || message.includes('fetch')) {
      return createBrowserError(BrowserErrorCode.NETWORK, error.message)
    }
    if (message.includes('timeout')) {
      return createBrowserError(BrowserErrorCode.TIMEOUT, error.message)
    }
    if (message.includes('abort')) {
      return createBrowserError(BrowserErrorCode.ABORTED, error.message)
    }
    if (message.includes('security') || message.includes('cors') || message.includes('cross-origin')) {
      return createBrowserError(BrowserErrorCode.SECURITY, error.message)
    }

    return createBrowserError(BrowserErrorCode.UNKNOWN, error.message)
  }

  return createBrowserError(
    BrowserErrorCode.UNKNOWN,
    String(error)
  )
}

/**
 * Map a DOMException to a BrowserError.
 */
function mapDOMExceptionToBrowserError(error: DOMException): BrowserError {
  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return createBrowserError(BrowserErrorCode.DENIED, error.message)

    case 'NotSupportedError':
      return createBrowserError(BrowserErrorCode.NOT_SUPPORTED, error.message)

    case 'NotFoundError':
      return createBrowserError(BrowserErrorCode.NOT_FOUND, error.message)

    case 'TimeoutError':
      return createBrowserError(BrowserErrorCode.TIMEOUT, error.message)

    case 'AbortError':
      return createBrowserError(BrowserErrorCode.ABORTED, error.message)

    case 'NetworkError':
      return createBrowserError(BrowserErrorCode.NETWORK, error.message)

    case 'SecurityError':
      return createBrowserError(BrowserErrorCode.SECURITY, error.message)

    case 'InvalidStateError':
      return createBrowserError(BrowserErrorCode.BUSY, error.message)

    case 'InvalidAccessError':
    case 'TypeMismatchError':
    case 'SyntaxError':
      return createBrowserError(BrowserErrorCode.INVALID_ARGUMENT, error.message)

    default:
      return createBrowserError(BrowserErrorCode.UNKNOWN, error.message)
  }
}

// =============================================================================
// Result Type
// =============================================================================

/**
 * Result type for fallible operations.
 */
export type Result<T, E = BrowserError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

/**
 * Create a successful result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

/**
 * Create an error result.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

/**
 * Create a BrowserError result.
 */
export function browserErr(
  code: BrowserErrorCode,
  message: string,
  details?: unknown
): Result<never, BrowserError> {
  return err(createBrowserError(code, message, details))
}

// =============================================================================
// HTTP Types
// =============================================================================

/**
 * HTTP header as name-value pair.
 */
export interface Header {
  name: string
  value: string
}

/**
 * HTTP headers as a list of name-value pairs.
 */
export type Headers = Header[]

/**
 * Convert Headers to a plain object.
 */
export function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const { name, value } of headers) {
    result[name.toLowerCase()] = value
  }
  return result
}

/**
 * Convert a plain object to Headers.
 */
export function objectToHeaders(obj: Record<string, string>): Headers {
  return Object.entries(obj).map(([name, value]) => ({ name, value }))
}

/**
 * Convert native Headers to our Headers type.
 */
export function nativeHeadersToHeaders(native: globalThis.Headers): Headers {
  const result: Headers = []
  native.forEach((value, name) => {
    result.push({ name, value })
  })
  return result
}

/**
 * Convert our Headers type to native Headers.
 */
export function headersToNativeHeaders(headers: Headers): globalThis.Headers {
  const native = new globalThis.Headers()
  for (const { name, value } of headers) {
    native.append(name, value)
  }
  return native
}

// =============================================================================
// URL Type
// =============================================================================

/**
 * URL as a string (validated on use).
 */
export type Url = string

/**
 * Validate and normalize a URL.
 */
export function validateUrl(url: Url): Result<URL, BrowserError> {
  try {
    return ok(new URL(url))
  } catch {
    return browserErr(
      BrowserErrorCode.INVALID_ARGUMENT,
      `Invalid URL: ${url}`
    )
  }
}

// =============================================================================
// Byte Types
// =============================================================================

/**
 * Bytes as a Uint8Array.
 */
export type Bytes = Uint8Array

/**
 * Encode a string to bytes (UTF-8).
 */
export function stringToBytes(str: string): Bytes {
  return new TextEncoder().encode(str)
}

/**
 * Decode bytes to a string (UTF-8).
 */
export function bytesToString(bytes: Bytes): string {
  return new TextDecoder().decode(bytes)
}

/**
 * Concatenate multiple byte arrays.
 */
export function concatBytes(...arrays: Bytes[]): Bytes {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// =============================================================================
// Permission Types
// =============================================================================

/**
 * Permission state.
 */
export enum PermissionState {
  /** Permission has been granted */
  GRANTED = 'granted',
  /** Permission has been denied */
  DENIED = 'denied',
  /** Permission must be requested (user prompt) */
  PROMPT = 'prompt',
}

/**
 * Convert native PermissionState to our enum.
 */
export function mapPermissionState(state: globalThis.PermissionState): PermissionState {
  switch (state) {
    case 'granted':
      return PermissionState.GRANTED
    case 'denied':
      return PermissionState.DENIED
    case 'prompt':
    default:
      return PermissionState.PROMPT
  }
}

// =============================================================================
// Async Types (aligned with WASIP3)
// =============================================================================

/**
 * Future result status.
 */
export type FutureResult<T> =
  | { status: 'pending' }
  | { status: 'ok'; value: T }
  | { status: 'error'; error: BrowserError }
  | { status: 'cancelled' }

/**
 * Stream read result.
 */
export type StreamResult<T> =
  | { status: 'values'; values: T[] }
  | { status: 'end' }
  | { status: 'error'; error: BrowserError }
  | { status: 'cancelled' }

/**
 * Simple future interface (compatible with WASIP3).
 */
export interface Future<T> {
  /** Read the future value (may block/await) */
  read(): Promise<FutureResult<T>>
  /** Cancel the future */
  cancel(): void
}

/**
 * Simple stream interface (compatible with WASIP3).
 */
export interface Stream<T> {
  /** Read next values from the stream */
  read(): Promise<StreamResult<T>>
  /** Close the stream */
  close(): void
  /** Cancel the stream */
  cancel(): void
}

/**
 * Stream writer interface.
 */
export interface StreamWriter<T> {
  /** Write values to the stream */
  write(values: T[]): Promise<{ status: 'ok'; count: number } | { status: 'error'; error: BrowserError }>
  /** Close the writer */
  close(): void
  /** Cancel the writer */
  cancel(): void
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Base event type for browser events.
 */
export interface BrowserEvent {
  /** Event type name */
  type: string
  /** Timestamp (milliseconds since epoch) */
  timeStamp: number
  /** Whether the event bubbles */
  bubbles: boolean
  /** Whether the event is cancelable */
  cancelable: boolean
  /** Number of events dropped due to backpressure (0 if none) */
  droppedCount?: number
}

/**
 * Mouse event data.
 */
export interface MouseEventData extends BrowserEvent {
  /** X coordinate relative to viewport */
  clientX: number
  /** Y coordinate relative to viewport */
  clientY: number
  /** X coordinate relative to page */
  pageX: number
  /** Y coordinate relative to page */
  pageY: number
  /** Mouse button (0=left, 1=middle, 2=right) */
  button: number
  /** Buttons currently pressed (bitmask) */
  buttons: number
  /** Alt key pressed */
  altKey: boolean
  /** Ctrl key pressed */
  ctrlKey: boolean
  /** Meta key pressed (Cmd on Mac) */
  metaKey: boolean
  /** Shift key pressed */
  shiftKey: boolean
}

/**
 * Keyboard event data.
 */
export interface KeyboardEventData extends BrowserEvent {
  /** Key value (e.g., "a", "Enter", "ArrowUp") */
  key: string
  /** Physical key code (e.g., "KeyA", "Enter") */
  code: string
  /** Alt key pressed */
  altKey: boolean
  /** Ctrl key pressed */
  ctrlKey: boolean
  /** Meta key pressed (Cmd on Mac) */
  metaKey: boolean
  /** Shift key pressed */
  shiftKey: boolean
  /** Whether this is a repeat event */
  repeat: boolean
}

/**
 * Map native MouseEvent to our type.
 */
export function mapMouseEvent(event: MouseEvent, droppedCount = 0): MouseEventData {
  return {
    type: event.type,
    timeStamp: event.timeStamp,
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    droppedCount,
    clientX: event.clientX,
    clientY: event.clientY,
    pageX: event.pageX,
    pageY: event.pageY,
    button: event.button,
    buttons: event.buttons,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  }
}

/**
 * Map native KeyboardEvent to our type.
 */
export function mapKeyboardEvent(event: KeyboardEvent, droppedCount = 0): KeyboardEventData {
  return {
    type: event.type,
    timeStamp: event.timeStamp,
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    droppedCount,
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
  }
}

// =============================================================================
// Geometry Types
// =============================================================================

/**
 * Rectangle with position and dimensions.
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Point with x and y coordinates.
 */
export interface Point {
  x: number
  y: number
}

/**
 * Size with width and height.
 */
export interface Size {
  width: number
  height: number
}

// =============================================================================
// Color Types
// =============================================================================

/**
 * RGBA color.
 */
export interface Color {
  r: number  // 0-255
  g: number  // 0-255
  b: number  // 0-255
  a: number  // 0-1
}

/**
 * Convert Color to CSS string.
 */
export function colorToCss(color: Color): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`
}

/**
 * Parse a CSS color string to Color (simplified).
 */
export function cssToColor(css: string): Color | null {
  // Handle common formats
  if (css.startsWith('#')) {
    const hex = css.slice(1)
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
        a: 1,
      }
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      }
    }
  }

  const rgbaMatch = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]!, 10),
      g: parseInt(rgbaMatch[2]!, 10),
      b: parseInt(rgbaMatch[3]!, 10),
      a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
    }
  }

  return null
}

// =============================================================================
// Export WIT-compatible imports object
// =============================================================================

/**
 * Get the browser:types imports object.
 */
export function getBrowserTypesImports(): Record<string, unknown> {
  return {
    'browser:types/types': {
      // Error utilities
      'create-error': createBrowserError,
      'map-error': mapErrorToBrowserError,

      // Result utilities
      ok,
      err,

      // Header utilities
      'headers-to-object': headersToObject,
      'object-to-headers': objectToHeaders,

      // URL utilities
      'validate-url': validateUrl,

      // Byte utilities
      'string-to-bytes': stringToBytes,
      'bytes-to-string': bytesToString,
      'concat-bytes': concatBytes,

      // Color utilities
      'color-to-css': colorToCss,
      'css-to-color': cssToColor,
    },
  }
}
