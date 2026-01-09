/**
 * Shared Result Type
 *
 * A generic Result type for representing success/failure outcomes.
 * Replaces duplicate implementations across filesystem, config, keyvalue,
 * blobstore, and browser modules.
 *
 * @example
 * ```typescript
 * import { Result, ok, err, map, unwrapOr } from '@aspect/wasi-polyfill/shared'
 *
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return err('Division by zero')
 *   return ok(a / b)
 * }
 *
 * const result = divide(10, 2)
 * if (result.ok) {
 *   console.log(result.value) // 5
 * }
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Core Result Type
// =============================================================================

/**
 * A Result type representing either success (Ok) or failure (Err).
 *
 * @typeParam T - The success value type
 * @typeParam E - The error type
 */
export type Result<T, E> = Ok<T> | Err<E>

/**
 * Represents a successful result containing a value.
 */
export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

/**
 * Represents a failed result containing an error.
 */
export interface Err<E> {
  readonly ok: false
  readonly error: E
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Create a successful Result.
 *
 * @param value - The success value
 * @returns An Ok result containing the value
 *
 * @example
 * ```typescript
 * const result = ok(42)
 * // result.ok === true
 * // result.value === 42
 * ```
 */
export function ok<T, E = never>(value: T): Result<T, E> {
  return { ok: true, value }
}

/**
 * Create a failed Result.
 *
 * @param error - The error value
 * @returns An Err result containing the error
 *
 * @example
 * ```typescript
 * const result = err('Something went wrong')
 * // result.ok === false
 * // result.error === 'Something went wrong'
 * ```
 */
export function err<E, T = never>(error: E): Result<T, E> {
  return { ok: false, error }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a Result is Ok.
 *
 * @param result - The result to check
 * @returns True if the result is Ok
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok
}

/**
 * Check if a Result is Err.
 *
 * @param result - The result to check
 * @returns True if the result is Err
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok
}

// =============================================================================
// Transformations
// =============================================================================

/**
 * Map a function over the success value of a Result.
 *
 * @param result - The result to transform
 * @param fn - The transformation function
 * @returns A new Result with the transformed value, or the original error
 *
 * @example
 * ```typescript
 * const result = ok(5)
 * const doubled = map(result, x => x * 2)
 * // doubled.value === 10
 * ```
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value))
  }
  return result
}

/**
 * Map a function over the success value, where the function returns a Result.
 * Also known as flatMap, chain, or bind.
 *
 * @param result - The result to transform
 * @param fn - The transformation function that returns a Result
 * @returns The Result from the function, or the original error
 *
 * @example
 * ```typescript
 * const result = ok(10)
 * const divided = flatMap(result, x => x > 0 ? ok(100 / x) : err('Must be positive'))
 * // divided.value === 10
 * ```
 */
export function flatMap<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  if (result.ok) {
    return fn(result.value)
  }
  return result
}

/**
 * Map a function over the error value of a Result.
 *
 * @param result - The result to transform
 * @param fn - The error transformation function
 * @returns A new Result with the transformed error, or the original value
 *
 * @example
 * ```typescript
 * const result = err('not found')
 * const withCode = mapErr(result, msg => ({ code: 404, message: msg }))
 * // withCode.error === { code: 404, message: 'not found' }
 * ```
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (!result.ok) {
    return err(fn(result.error))
  }
  return result
}

// =============================================================================
// Unwrapping
// =============================================================================

/**
 * Get the value from a Result, or return a default value if it's an error.
 *
 * @param result - The result to unwrap
 * @param defaultValue - The default value to return if result is Err
 * @returns The success value or the default
 *
 * @example
 * ```typescript
 * const good = ok(42)
 * unwrapOr(good, 0) // 42
 *
 * const bad = err('error')
 * unwrapOr(bad, 0) // 0
 * ```
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.value
  }
  return defaultValue
}

/**
 * Get the value from a Result, or compute a default using a function.
 *
 * @param result - The result to unwrap
 * @param fn - Function to compute the default value from the error
 * @returns The success value or the computed default
 *
 * @example
 * ```typescript
 * const bad = err({ code: 404 })
 * unwrapOrElse(bad, e => `Error: ${e.code}`) // 'Error: 404'
 * ```
 */
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
  if (result.ok) {
    return result.value
  }
  return fn(result.error)
}

/**
 * Get the value from a Result, or throw an error if it's Err.
 *
 * @param result - The result to unwrap
 * @param message - Optional custom error message
 * @returns The success value
 * @throws Error if the result is Err
 *
 * @example
 * ```typescript
 * const good = ok(42)
 * unwrap(good) // 42
 *
 * const bad = err('failed')
 * unwrap(bad) // throws Error
 * ```
 */
export function unwrap<T, E>(result: Result<T, E>, message?: string): T {
  if (result.ok) {
    return result.value
  }
  throw new Error(message ?? `Unwrap called on Err: ${String(result.error)}`)
}

/**
 * Get the error from a Result, or throw if it's Ok.
 *
 * @param result - The result to unwrap
 * @param message - Optional custom error message
 * @returns The error value
 * @throws Error if the result is Ok
 */
export function unwrapErr<T, E>(result: Result<T, E>, message?: string): E {
  if (!result.ok) {
    return result.error
  }
  throw new Error(message ?? `UnwrapErr called on Ok: ${String(result.value)}`)
}

// =============================================================================
// Async Utilities
// =============================================================================

/**
 * Convert a Promise into a Result, catching any errors.
 *
 * @param promise - The promise to convert
 * @param errorMapper - Function to convert caught errors to the error type
 * @returns A Promise resolving to a Result
 *
 * @example
 * ```typescript
 * const result = await fromPromise(
 *   fetch('/api/data'),
 *   e => ({ code: 'fetch-failed', message: String(e) })
 * )
 * ```
 */
export async function fromPromise<T, E>(
  promise: Promise<T>,
  errorMapper: (error: unknown) => E
): Promise<Result<T, E>> {
  try {
    const value = await promise
    return ok(value)
  } catch (error) {
    return err(errorMapper(error))
  }
}

/**
 * Convert a function that might throw into a Result.
 *
 * @param fn - The function to execute
 * @param errorMapper - Function to convert caught errors to the error type
 * @returns A Result containing the return value or mapped error
 *
 * @example
 * ```typescript
 * const result = tryCatch(
 *   () => JSON.parse(input),
 *   e => `Parse error: ${e}`
 * )
 * ```
 */
export function tryCatch<T, E>(fn: () => T, errorMapper: (error: unknown) => E): Result<T, E> {
  try {
    return ok(fn())
  } catch (error) {
    return err(errorMapper(error))
  }
}

/**
 * Convert an async function that might throw into a Result.
 *
 * @param fn - The async function to execute
 * @param errorMapper - Function to convert caught errors to the error type
 * @returns A Promise resolving to a Result
 */
export async function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  errorMapper: (error: unknown) => E
): Promise<Result<T, E>> {
  try {
    return ok(await fn())
  } catch (error) {
    return err(errorMapper(error))
  }
}

// =============================================================================
// Combining Results
// =============================================================================

/**
 * Combine multiple Results into a single Result containing an array.
 * If any Result is Err, returns the first error.
 *
 * @param results - Array of Results to combine
 * @returns A Result containing all values, or the first error
 *
 * @example
 * ```typescript
 * const results = [ok(1), ok(2), ok(3)]
 * const combined = all(results)
 * // combined.value === [1, 2, 3]
 *
 * const withError = [ok(1), err('failed'), ok(3)]
 * const failed = all(withError)
 * // failed.error === 'failed'
 * ```
 */
export function all<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = []
  for (const result of results) {
    if (!result.ok) {
      return result
    }
    values.push(result.value)
  }
  return ok(values)
}

/**
 * Combine multiple Results, collecting all errors.
 * Returns Ok with all values if all succeed, or Err with all errors.
 *
 * @param results - Array of Results to combine
 * @returns A Result containing all values or all errors
 */
export function partition<T, E>(results: Result<T, E>[]): Result<T[], E[]> {
  const values: T[] = []
  const errors: E[] = []

  for (const result of results) {
    if (result.ok) {
      values.push(result.value)
    } else {
      errors.push(result.error)
    }
  }

  if (errors.length > 0) {
    return err(errors)
  }
  return ok(values)
}

// =============================================================================
// Matching
// =============================================================================

/**
 * Pattern match on a Result, handling both Ok and Err cases.
 *
 * @param result - The result to match
 * @param handlers - Object with onOk and onErr handlers
 * @returns The result of the matching handler
 *
 * @example
 * ```typescript
 * const result = ok(42)
 * const message = match(result, {
 *   onOk: value => `Got ${value}`,
 *   onErr: error => `Failed: ${error}`
 * })
 * // message === 'Got 42'
 * ```
 */
export function match<T, E, R>(
  result: Result<T, E>,
  handlers: {
    onOk: (value: T) => R
    onErr: (error: E) => R
  }
): R {
  if (result.ok) {
    return handlers.onOk(result.value)
  }
  return handlers.onErr(result.error)
}

// =============================================================================
// Void Result Utilities
// =============================================================================

/**
 * A successful Result with no value.
 */
export const okVoid: Result<void, never> = ok(undefined)

/**
 * Create a void Ok result. Useful for operations that succeed with no return value.
 */
export function okUnit<E = never>(): Result<void, E> {
  return ok(undefined)
}
