/**
 * WASI Preview 3 Async/Sync Bridge
 *
 * Provides seamless interop between sync and async functions
 * across component boundaries.
 *
 * @packageDocumentation
 */

import { Task } from '../canonical-abi/task.js'
import { SubtaskManager, type SubtaskHandle } from '../canonical-abi/subtask.js'
import type { Future, Stream, StreamWriter, TaskEvent } from '../types.js'
import { createFuture } from '../canonical-abi/future.js'

/**
 * Context for async/sync boundary crossings.
 */
export interface BridgeContext {
  /** The current task (if in async context) */
  task?: Task
  /** Subtask manager for tracking calls */
  subtaskManager: SubtaskManager
  /** Whether currently in async context */
  isAsync: boolean
}

/**
 * Creates a new bridge context.
 *
 * @param isAsync - Whether this context is async
 * @returns A new bridge context
 */
export function createBridgeContext(isAsync: boolean = false): BridgeContext {
  return {
    subtaskManager: new SubtaskManager(),
    isAsync,
  }
}

/**
 * Async/Sync bridge for P3 component interop.
 *
 * Handles four cases:
 * 1. Sync export calling sync import → direct call
 * 2. Sync export calling async import → block with task.wait
 * 3. Async export calling sync import → direct call
 * 4. Async export calling async import → subtask handle
 */
export class AsyncSyncBridge {
  private context: BridgeContext

  constructor(context?: BridgeContext) {
    this.context = context ?? createBridgeContext()
  }

  /**
   * Call a sync function from sync context.
   *
   * Direct call, returns immediately.
   *
   * @param syncFn - The sync function to call
   * @returns The function's return value
   */
  callSyncFromSync<T>(syncFn: () => T): T {
    return syncFn()
  }

  /**
   * Call an async function from sync context.
   *
   * This is the tricky case - we need to "block" until the async
   * operation completes. In JavaScript, we can't truly block,
   * so we return a Promise that the caller must await.
   *
   * In a WebAssembly context, this would use stack switching or
   * other techniques to truly block the sync caller.
   *
   * @param asyncFn - The async function to call
   * @returns Promise with the result (caller must handle async)
   */
  async callAsyncFromSync<T>(asyncFn: () => Promise<T>): Promise<T> {
    // Create a subtask to track this call
    const handle = this.context.subtaskManager.create(async () => {
      const result = await asyncFn()
      return [result]
    })

    // Wait for completion
    await this.context.subtaskManager.wait(handle)

    // Get return value
    const values = this.context.subtaskManager.getReturnValues(handle)
    this.context.subtaskManager.drop(handle)

    if (values && values.length > 0) {
      return values[0] as T
    }

    throw new Error('Async call returned no value')
  }

  /**
   * Call a sync function from async context.
   *
   * Direct call - sync functions execute immediately within
   * async context.
   *
   * @param syncFn - The sync function to call
   * @returns The function's return value
   */
  callSyncFromAsync<T>(syncFn: () => T): T {
    return syncFn()
  }

  /**
   * Start an async call from async context.
   *
   * Returns a subtask handle that the caller can poll/wait on.
   * This enables concurrent async operations.
   *
   * @param asyncFn - The async function to call
   * @returns Subtask handle for tracking
   */
  startAsyncCall(asyncFn: () => Promise<unknown[]>): SubtaskHandle {
    return this.context.subtaskManager.create(asyncFn)
  }

  /**
   * Poll a subtask for completion.
   *
   * @param handle - The subtask handle
   * @returns The subtask's current state
   */
  pollSubtask(handle: SubtaskHandle): string {
    return this.context.subtaskManager.poll(handle)
  }

  /**
   * Wait for a subtask to complete.
   *
   * @param handle - The subtask handle
   * @returns Promise that resolves when subtask completes
   */
  waitSubtask(handle: SubtaskHandle): Promise<string> {
    return this.context.subtaskManager.wait(handle)
  }

  /**
   * Get return values from a completed subtask.
   *
   * @param handle - The subtask handle
   * @returns The return values, or undefined if not complete
   */
  getSubtaskReturnValues(handle: SubtaskHandle): unknown[] | undefined {
    return this.context.subtaskManager.getReturnValues(handle)
  }

  /**
   * Drop a subtask handle, releasing resources.
   *
   * @param handle - The subtask handle
   */
  dropSubtask(handle: SubtaskHandle): void {
    this.context.subtaskManager.drop(handle)
  }

  /**
   * Wait for any of the given subtasks to complete.
   *
   * @param handles - Subtask handles to wait on
   * @returns Handle of the first to complete
   */
  waitAnySubtask(handles: SubtaskHandle[]): Promise<SubtaskHandle> {
    return this.context.subtaskManager.waitAny(handles)
  }

  /**
   * Get subtask handles in a specific state.
   *
   * @param state - The state to filter by
   * @returns Array of handles in that state
   */
  getSubtasksInState(state: string): SubtaskHandle[] {
    return this.context.subtaskManager.getHandlesInState(
      state as 'starting' | 'started' | 'returned' | 'done'
    )
  }

  /**
   * Get all active subtask handles.
   */
  getActiveSubtasks(): SubtaskHandle[] {
    return this.context.subtaskManager.getActiveHandles()
  }
}

/**
 * Blocking call helper for sync contexts.
 *
 * This wraps an async function and "blocks" until it completes.
 * In browser JavaScript, this still returns a Promise, but the
 * API is designed to match the Component Model's sync-calling-async
 * semantics.
 *
 * @param asyncFn - The async function to call
 * @returns Promise with the result
 */
export async function blockingCall<T>(asyncFn: () => Promise<T>): Promise<T> {
  const bridge = new AsyncSyncBridge()
  return bridge.callAsyncFromSync(asyncFn)
}

/**
 * Convert a callback-based API to an async API.
 *
 * @param fn - Function that takes a callback
 * @returns Promise that resolves when callback is called
 */
export function promisify<T>(
  fn: (callback: (error: Error | null, result?: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((error, result) => {
      if (error) {
        reject(error)
      } else {
        resolve(result as T)
      }
    })
  })
}

/**
 * Wrap a sync function to be callable from async context.
 *
 * The wrapped function can be called as if it were async,
 * but executes synchronously.
 *
 * @param syncFn - The sync function to wrap
 * @returns An async-compatible wrapper
 */
export function wrapSyncAsAsync<T extends unknown[], R>(
  syncFn: (...args: T) => R
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    return syncFn(...args)
  }
}

/**
 * Wrap an async function to handle errors gracefully.
 *
 * @param asyncFn - The async function to wrap
 * @param defaultValue - Value to return on error
 * @returns Wrapped function that returns default on error
 */
export function wrapAsyncWithDefault<T extends unknown[], R>(
  asyncFn: (...args: T) => Promise<R>,
  defaultValue: R
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await asyncFn(...args)
    } catch {
      return defaultValue
    }
  }
}

/**
 * Event dispatcher for async operations.
 *
 * Collects events from multiple sources and dispatches them
 * to registered handlers.
 */
export class EventDispatcher {
  private handlers: Map<string, Array<(event: TaskEvent) => void | Promise<void>>> = new Map()

  /**
   * Register a handler for an event type.
   *
   * @param type - Event type to handle
   * @param handler - Handler function
   */
  on(
    type: string,
    handler: (event: TaskEvent) => void | Promise<void>
  ): void {
    const handlers = this.handlers.get(type) ?? []
    handlers.push(handler)
    this.handlers.set(type, handlers)
  }

  /**
   * Remove a handler for an event type.
   *
   * @param type - Event type
   * @param handler - Handler to remove
   */
  off(
    type: string,
    handler: (event: TaskEvent) => void | Promise<void>
  ): void {
    const handlers = this.handlers.get(type)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index >= 0) {
        handlers.splice(index, 1)
      }
    }
  }

  /**
   * Dispatch an event to registered handlers.
   *
   * @param event - Event to dispatch
   */
  async dispatch(event: TaskEvent): Promise<void> {
    const handlers = this.handlers.get(event.type)
    if (handlers) {
      for (const handler of handlers) {
        await handler(event)
      }
    }

    // Also dispatch to wildcard handlers
    const wildcardHandlers = this.handlers.get('*')
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        await handler(event)
      }
    }
  }

  /**
   * Dispatch multiple events.
   *
   * @param events - Events to dispatch
   */
  async dispatchAll(events: TaskEvent[]): Promise<void> {
    for (const event of events) {
      await this.dispatch(event)
    }
  }
}

/**
 * Convert a stream to a future that resolves with all values.
 *
 * @param stream - Stream to collect
 * @returns Future that resolves with all values
 */
export function streamToFuture<T>(stream: Stream<T>): Future<T[]> {
  const [future, resolver] = createFuture<T[]>()

  const values: T[] = []

  const read = async (): Promise<void> => {
    const result = await stream.read()
    if (result.status === 'values') {
      values.push(...result.values)
      // Continue reading
      await read()
    } else if (result.status === 'end') {
      resolver.resolve(values)
    } else {
      // Cancelled
      resolver.reject(new Error('Stream cancelled'))
    }
  }

  read().catch((error) => resolver.reject(error))

  return future
}

/**
 * Convert a future to a single-value stream.
 *
 * @param future - Future to convert
 * @returns Stream that yields the future's value then closes
 */
export function futureToStream<T>(future: Future<T>): Stream<T> {
  let consumed = false

  return {
    async read() {
      if (consumed) {
        return { status: 'end' as const }
      }

      const result = await future.read()
      consumed = true

      if (result.status === 'ok') {
        return { status: 'values' as const, values: [result.value] }
      } else {
        return { status: 'cancelled' as const }
      }
    },

    close() {
      consumed = true
    },

    cancel() {
      consumed = true
      future.cancel()
    },
  }
}

/**
 * Pipe a stream to a stream writer.
 *
 * @param source - Source stream
 * @param dest - Destination writer
 * @returns Promise that resolves when pipe completes
 */
export async function pipeStream<T>(
  source: Stream<T>,
  dest: StreamWriter<T>
): Promise<void> {
  while (true) {
    const readResult = await source.read()

    if (readResult.status === 'values') {
      const writeResult = await dest.write(readResult.values)
      if (writeResult.status !== 'ok') {
        source.cancel()
        break
      }
    } else {
      // End or cancelled
      dest.close()
      break
    }
  }
}

/**
 * Merge multiple streams into one.
 *
 * Values are yielded as they become available from any source.
 *
 * @param streams - Streams to merge
 * @returns Merged stream
 */
export function mergeStreams<T>(streams: Stream<T>[]): Stream<T> {
  const buffer: T[] = []
  let closed = false
  let cancelled = false
  const activeStreams = new Set(streams)
  let pendingResolve: ((result: { status: 'values'; values: T[] } | { status: 'end' } | { status: 'cancelled' }) => void) | null = null

  // Start reading from all streams
  for (const stream of streams) {
    readFromStream(stream)
  }

  async function readFromStream(stream: Stream<T>): Promise<void> {
    while (activeStreams.has(stream) && !cancelled) {
      const result = await stream.read()

      if (result.status === 'values') {
        if (pendingResolve) {
          const resolve = pendingResolve
          pendingResolve = null
          resolve({ status: 'values', values: result.values })
        } else {
          buffer.push(...result.values)
        }
      } else {
        activeStreams.delete(stream)
        if (activeStreams.size === 0) {
          closed = true
          if (pendingResolve) {
            pendingResolve({ status: 'end' })
          }
        }
        break
      }
    }
  }

  return {
    read(): Promise<{ status: 'values'; values: T[] } | { status: 'end' } | { status: 'cancelled' }> {
      return new Promise((resolve) => {
        if (cancelled) {
          resolve({ status: 'cancelled' })
          return
        }

        if (buffer.length > 0) {
          const values = buffer.splice(0)
          resolve({ status: 'values', values })
          return
        }

        if (closed) {
          resolve({ status: 'end' })
          return
        }

        pendingResolve = resolve
      })
    },

    close() {
      closed = true
      for (const stream of streams) {
        stream.close()
      }
    },

    cancel() {
      cancelled = true
      for (const stream of streams) {
        stream.cancel()
      }
    },
  }
}
