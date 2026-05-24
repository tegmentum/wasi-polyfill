/**
 * Error Utilities
 *
 * Shared utilities for safe error handling across the codebase.
 * Provides type-safe error extraction, wrapping, and assertion utilities.
 *
 * @example
 * ```typescript
 * import { extractErrorMessage, wrapError, assertNever } from '@aspect/wasi-polyfill/shared'
 *
 * try {
 *   riskyOperation()
 * } catch (e) {
 *   const message = extractErrorMessage(e)
 *   console.error('Operation failed:', message)
 * }
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Error Extraction
// =============================================================================

/**
 * Safely extract an error message from an unknown value.
 *
 * This is the preferred way to handle caught errors, as catch blocks
 * receive `unknown` type values.
 *
 * @param error - The caught error value
 * @returns A string error message
 *
 * @example
 * ```typescript
 * try {
 *   JSON.parse(invalid)
 * } catch (e) {
 *   return err(extractErrorMessage(e))
 * }
 * ```
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (error === null) {
    return 'null'
  }
  if (error === undefined) {
    return 'undefined'
  }
  if (typeof error === 'object') {
    // Check for objects with message property
    if ('message' in error && typeof (error as { message: unknown }).message === 'string') {
      return (error as { message: string }).message
    }
    // Try toString
    const str = String(error)
    if (str !== '[object Object]') {
      return str
    }
    // Last resort: JSON stringify
    try {
      return JSON.stringify(error)
    } catch {
      return '[object Object]'
    }
  }
  return String(error)
}

/**
 * Safely extract a full error with stack trace information.
 *
 * @param error - The caught error value
 * @returns An object with message and optional stack
 */
export function extractErrorDetails(error: unknown): { message: string; stack?: string | undefined; name?: string | undefined } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
    }
  }
  return {
    message: extractErrorMessage(error),
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is an Error instance.
 *
 * @param value - The value to check
 * @returns True if the value is an Error
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error
}

/**
 * Check if a value is an error-like object (has message property).
 *
 * @param value - The value to check
 * @returns True if the value has a message property
 */
export function isErrorLike(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  )
}

/**
 * Check if an error is an instance of a specific error type.
 *
 * @param error - The error to check
 * @param errorTypes - Error constructor(s) to check against
 * @returns True if the error is an instance of any of the types
 *
 * @example
 * ```typescript
 * if (isErrorType(error, TypeError, RangeError)) {
 *   // Handle type or range errors
 * }
 * ```
 */
export function isErrorType<T extends Error>(
  error: unknown,
  ...errorTypes: (new (...args: unknown[]) => T)[]
): error is T {
  return errorTypes.some((ErrorType) => error instanceof ErrorType)
}

// =============================================================================
// Error Wrapping
// =============================================================================

/**
 * Wrap an unknown error into a typed error using a mapper function.
 *
 * @param error - The error to wrap
 * @param mapper - Function to create the typed error from the message
 * @returns The mapped error
 *
 * @example
 * ```typescript
 * catch (e) {
 *   return wrapError(e, msg => ({ code: 'io-error', message: msg }))
 * }
 * ```
 */
export function wrapError<E>(error: unknown, mapper: (message: string) => E): E {
  return mapper(extractErrorMessage(error))
}

/**
 * Wrap an unknown error with additional context.
 *
 * @param error - The original error
 * @param context - Context message to prepend
 * @returns A new Error with context
 *
 * @example
 * ```typescript
 * catch (e) {
 *   throw wrapWithContext(e, 'Failed to read config file')
 * }
 * ```
 */
export function wrapWithContext(error: unknown, context: string): Error {
  const originalMessage = extractErrorMessage(error)
  const newError = new Error(`${context}: ${originalMessage}`)
  if (error instanceof Error) {
    newError.cause = error
    if (error.stack) {
      newError.stack = `${newError.stack}\nCaused by: ${error.stack}`
    }
  }
  return newError
}

/**
 * Create a new error with a cause chain.
 *
 * @param message - The new error message
 * @param cause - The underlying cause
 * @returns A new Error with cause set
 */
export function errorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message)
  error.cause = cause
  return error
}

// =============================================================================
// Error Creation
// =============================================================================

/**
 * Base interface for plugin errors.
 */
export interface PluginError {
  readonly code: string
  readonly message: string
  readonly cause?: unknown
}

/**
 * Create a plugin error object.
 *
 * @param code - Error code
 * @param message - Error message
 * @param cause - Optional underlying cause
 * @returns A PluginError object
 */
export function createPluginError(code: string, message: string, cause?: unknown): PluginError {
  return { code, message, cause }
}

/**
 * Create a typed error factory function.
 *
 * @param code - The error code for all errors from this factory
 * @returns A function that creates errors with the given code
 *
 * @example
 * ```typescript
 * const ioError = createErrorFactory('io-error')
 * const err = ioError('Failed to write file')
 * // { code: 'io-error', message: 'Failed to write file' }
 * ```
 */
export function createErrorFactory(code: string): (message: string, cause?: unknown) => PluginError {
  return (message: string, cause?: unknown) => createPluginError(code, message, cause)
}

// =============================================================================
// Assertions
// =============================================================================

/**
 * Assert that a value is not null or undefined.
 *
 * @param value - The value to check
 * @param message - Optional error message
 * @throws Error if value is null or undefined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Expected value to be defined')
  }
}

/**
 * Assert that a condition is true.
 *
 * @param condition - The condition to check
 * @param message - Error message if condition is false
 * @throws Error if condition is false
 */
export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? 'Assertion failed')
  }
}

/**
 * Assert that a code path should never be reached.
 * Useful for exhaustive switch statements.
 *
 * @param value - The value that should be `never`
 * @param message - Optional error message
 * @throws Error always
 *
 * @example
 * ```typescript
 * switch (status) {
 *   case 'pending': return handlePending()
 *   case 'done': return handleDone()
 *   default: assertNever(status)
 * }
 * ```
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${value}`)
}

// =============================================================================
// Error Recovery
// =============================================================================

/**
 * Attempt an operation with automatic retry on failure.
 *
 * @param fn - The async function to attempt
 * @param options - Retry configuration
 * @returns The result of the successful attempt
 * @throws The last error if all attempts fail
 *
 * @example
 * ```typescript
 * const data = await retry(
 *   () => fetch('/api/data'),
 *   { maxAttempts: 3, delayMs: 1000 }
 * )
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    delayMs?: number
    backoffMultiplier?: number
    shouldRetry?: (error: unknown, attempt: number) => boolean
    onRetry?: (error: unknown, attempt: number) => void
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry,
  } = options

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt === maxAttempts || !shouldRetry(error, attempt)) {
        throw error
      }

      onRetry?.(error, attempt)

      const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Execute a function with a timeout.
 *
 * @param fn - The async function to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param timeoutError - Optional custom timeout error
 * @returns The result of the function
 * @throws TimeoutError if the operation times out
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutError?: Error
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(timeoutError ?? new Error(`Operation timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([fn(), timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}

// =============================================================================
// Error Aggregation
// =============================================================================

/**
 * An aggregate error containing multiple errors.
 *
 * Named `MultiError` rather than `AggregateError` to avoid shadowing the
 * ES2021 global `AggregateError` (which has different constructor semantics);
 * shadowing it would make `instanceof AggregateError` checks unreliable.
 */
export class MultiError extends Error {
  readonly errors: readonly Error[]

  constructor(errors: readonly Error[], message?: string) {
    super(message ?? `Multiple errors occurred (${errors.length})`)
    this.name = 'MultiError'
    this.errors = errors
  }
}

/**
 * Collect all errors from multiple operations.
 *
 * @param operations - Array of async operations
 * @returns Array of results, with errors collected
 */
export async function collectErrors<T>(
  operations: Array<() => Promise<T>>
): Promise<{ results: T[]; errors: Error[] }> {
  const results: T[] = []
  const errors: Error[] = []

  await Promise.all(
    operations.map(async (op) => {
      try {
        results.push(await op())
      } catch (e) {
        errors.push(isError(e) ? e : new Error(extractErrorMessage(e)))
      }
    })
  )

  return { results, errors }
}
