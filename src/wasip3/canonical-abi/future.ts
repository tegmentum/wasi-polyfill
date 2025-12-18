/**
 * WASI Preview 3 future implementation
 *
 * Implements the built-in `future<T>` type from the async Component Model.
 * Futures are similar to Promises but support cancellation.
 *
 * @packageDocumentation
 */

import type { Future, FutureReadResult, FutureResolver } from '../types.js'

/**
 * Internal state for a future.
 */
interface FutureState<T> {
  /** Whether the future has been resolved */
  resolved: boolean
  /** The resolved value */
  value: T | undefined
  /** The rejection error */
  error: Error | undefined
  /** Whether the future has been cancelled */
  cancelled: boolean
  /** Pending read resolvers */
  pendingReads: Array<(result: FutureReadResult<T>) => void>
}

/**
 * Creates a future and its resolver.
 *
 * Unlike Promise, a future can be cancelled. When cancelled,
 * all pending reads resolve with { status: 'cancelled' }.
 *
 * @typeParam T - The type of the future's value
 * @returns A tuple of [Future<T>, FutureResolver<T>]
 *
 * @example
 * ```typescript
 * const [future, resolver] = createFuture<string>()
 *
 * // Consumer
 * const result = await future.read()
 * if (result.status === 'ok') {
 *   console.log('Got:', result.value)
 * }
 *
 * // Producer (later)
 * resolver.resolve('hello')
 * ```
 */
export function createFuture<T>(): [Future<T>, FutureResolver<T>] {
  const state: FutureState<T> = {
    resolved: false,
    value: undefined,
    error: undefined,
    cancelled: false,
    pendingReads: [],
  }

  const future: Future<T> = {
    read(): Promise<FutureReadResult<T>> {
      return new Promise((resolve) => {
        // Check if cancelled
        if (state.cancelled) {
          resolve({ status: 'cancelled' })
          return
        }

        // Check if already resolved
        if (state.resolved) {
          if (state.error) {
            // Re-throw errors as cancelled for now
            // In a full implementation, we might have an error status
            resolve({ status: 'cancelled' })
          } else {
            resolve({ status: 'ok', value: state.value! })
          }
          return
        }

        // Wait for resolution
        state.pendingReads.push(resolve)
      })
    },

    cancel(): void {
      if (state.resolved || state.cancelled) {
        return
      }

      state.cancelled = true

      // Resolve all pending reads with cancelled
      for (const resolve of state.pendingReads) {
        resolve({ status: 'cancelled' })
      }
      state.pendingReads = []
    },
  }

  const resolver: FutureResolver<T> = {
    resolve(value: T): void {
      if (state.resolved || state.cancelled) {
        return
      }

      state.resolved = true
      state.value = value

      // Resolve all pending reads
      for (const resolve of state.pendingReads) {
        resolve({ status: 'ok', value })
      }
      state.pendingReads = []
    },

    reject(error: Error): void {
      if (state.resolved || state.cancelled) {
        return
      }

      state.resolved = true
      state.error = error

      // Resolve all pending reads with cancelled (error case)
      for (const resolve of state.pendingReads) {
        resolve({ status: 'cancelled' })
      }
      state.pendingReads = []
    },
  }

  return [future, resolver]
}

/**
 * Creates a future from a Promise.
 *
 * Note: The resulting future cannot truly cancel the underlying Promise,
 * but it will return 'cancelled' status if cancelled.
 *
 * @typeParam T - The type of the promise's value
 * @param promise - The promise to wrap
 * @returns A Future<T> that resolves with the promise's value
 */
export function futureFromPromise<T>(promise: Promise<T>): Future<T> {
  const [future, resolver] = createFuture<T>()

  promise
    .then((value) => resolver.resolve(value))
    .catch((error) =>
      resolver.reject(error instanceof Error ? error : new Error(String(error)))
    )

  return future
}

/**
 * Creates a future that resolves after a delay.
 *
 * @param ms - The delay in milliseconds
 * @returns A Future<void> that resolves after the delay
 */
export function delay(ms: number): Future<void> {
  const [future, resolver] = createFuture<void>()

  const timeoutId = setTimeout(() => {
    resolver.resolve(undefined)
  }, ms)

  // Wrap to add cleanup on cancel
  const originalCancel = future.cancel.bind(future)
  future.cancel = () => {
    clearTimeout(timeoutId)
    originalCancel()
  }

  return future
}

/**
 * Creates a future that is already resolved with a value.
 *
 * @typeParam T - The type of the value
 * @param value - The value to resolve with
 * @returns A Future<T> that is already resolved
 */
export function resolvedFuture<T>(value: T): Future<T> {
  return {
    read(): Promise<FutureReadResult<T>> {
      return Promise.resolve({ status: 'ok', value })
    },
    cancel(): void {
      // Already resolved, nothing to cancel
    },
  }
}

/**
 * Creates a future that is already cancelled.
 *
 * @typeParam T - The type of the future
 * @returns A Future<T> that is already cancelled
 */
export function cancelledFuture<T>(): Future<T> {
  return {
    read(): Promise<FutureReadResult<T>> {
      return Promise.resolve({ status: 'cancelled' })
    },
    cancel(): void {
      // Already cancelled
    },
  }
}

/**
 * Race multiple futures, returning the first to complete.
 *
 * When one future completes, all others are cancelled.
 *
 * @typeParam T - The type of the futures' values
 * @param futures - The futures to race
 * @returns A Future<T> that resolves with the first result
 */
export function raceFutures<T>(futures: Future<T>[]): Future<T> {
  const [result, resolver] = createFuture<T>()
  let settled = false

  for (const future of futures) {
    future.read().then((readResult) => {
      if (settled) return
      settled = true

      // Cancel all other futures
      for (const f of futures) {
        if (f !== future) {
          f.cancel()
        }
      }

      if (readResult.status === 'ok') {
        resolver.resolve(readResult.value)
      } else {
        resolver.reject(new Error('All futures cancelled'))
      }
    })
  }

  // If result future is cancelled, cancel all input futures
  const originalCancel = result.cancel.bind(result)
  result.cancel = () => {
    for (const f of futures) {
      f.cancel()
    }
    originalCancel()
  }

  return result
}

/**
 * Wait for all futures to complete.
 *
 * If any future is cancelled, the result future is cancelled.
 *
 * @typeParam T - The type of the futures' values
 * @param futures - The futures to wait for
 * @returns A Future<T[]> that resolves with all values
 */
export function allFutures<T>(futures: Future<T>[]): Future<T[]> {
  const [result, resolver] = createFuture<T[]>()
  const values: T[] = new Array(futures.length)
  let remaining = futures.length
  let cancelled = false

  if (futures.length === 0) {
    resolver.resolve([])
    return result
  }

  futures.forEach((future, index) => {
    future.read().then((readResult) => {
      if (cancelled) return

      if (readResult.status === 'cancelled') {
        cancelled = true
        resolver.reject(new Error('A future was cancelled'))
        return
      }

      values[index] = readResult.value
      remaining--

      if (remaining === 0) {
        resolver.resolve(values)
      }
    })
  })

  // If result future is cancelled, cancel all input futures
  const originalCancel = result.cancel.bind(result)
  result.cancel = () => {
    cancelled = true
    for (const f of futures) {
      f.cancel()
    }
    originalCancel()
  }

  return result
}
