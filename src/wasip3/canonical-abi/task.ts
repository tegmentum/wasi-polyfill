/**
 * WASI Preview 3 task management
 *
 * Tasks are the execution context for async component functions.
 * This module implements the task.* built-in functions.
 *
 * @packageDocumentation
 */

import type {
  TaskEvent,
  TaskEventType,
  Stream,
  StreamWriter,
  Future,
} from '../types.js'
import { SubtaskManager, type SubtaskHandle } from './subtask.js'

/**
 * Handle types for async operations.
 */
export type StreamReadHandle = number
export type StreamWriteHandle = number
export type FutureReadHandle = number

/**
 * Internal tracking for pending operations.
 */
interface PendingOperation<T> {
  handle: number
  type: TaskEventType
  promise: Promise<T>
  result?: T
  ready: boolean
}

/**
 * Task context for an executing async function.
 *
 * Each async export creates a Task that tracks:
 * - Pending stream reads/writes
 * - Pending future reads
 * - Subtasks (async import calls)
 */
export class Task {
  private nextHandle = 1
  private pendingOperations: Map<number, PendingOperation<unknown>> = new Map()
  private subtaskManager = new SubtaskManager()
  private started = false
  private returned = false
  private returnValues: unknown[] | undefined

  /**
   * Signal that the task has started processing.
   *
   * Called by callee at the start of an async export.
   * This transitions the task from 'starting' to 'started'.
   */
  start(): void {
    if (this.started) {
      throw new Error('Task already started')
    }
    this.started = true
  }

  /**
   * Signal task completion with return values.
   *
   * Called by callee to complete an async export.
   *
   * @param values - The return values
   */
  return(values: unknown[]): void {
    if (this.returned) {
      throw new Error('Task already returned')
    }
    if (!this.started) {
      throw new Error('Task not started')
    }
    this.returned = true
    this.returnValues = values
  }

  /**
   * Check if the task has started.
   */
  isStarted(): boolean {
    return this.started
  }

  /**
   * Check if the task has returned.
   */
  isReturned(): boolean {
    return this.returned
  }

  /**
   * Get the return values (if returned).
   */
  getReturnValues(): unknown[] | undefined {
    return this.returnValues
  }

  /**
   * Start reading from a stream.
   *
   * Returns a handle that can be polled/waited.
   *
   * @param stream - The stream to read from
   * @returns Handle for this read operation
   */
  streamRead<T>(stream: Stream<T>): StreamReadHandle {
    const handle = this.nextHandle++

    const promise = stream.read().then((result) => {
      const op = this.pendingOperations.get(handle)
      if (op) {
        op.result = result
        op.ready = true
      }
      return result
    })

    this.pendingOperations.set(handle, {
      handle,
      type: 'stream-read',
      promise,
      ready: false,
    })

    return handle
  }

  /**
   * Start writing to a stream.
   *
   * Returns a handle that can be polled/waited.
   *
   * @param writer - The stream writer
   * @param values - Values to write
   * @returns Handle for this write operation
   */
  streamWrite<T>(writer: StreamWriter<T>, values: T[]): StreamWriteHandle {
    const handle = this.nextHandle++

    const promise = writer.write(values).then((result) => {
      const op = this.pendingOperations.get(handle)
      if (op) {
        op.result = result
        op.ready = true
      }
      return result
    })

    this.pendingOperations.set(handle, {
      handle,
      type: 'stream-write',
      promise,
      ready: false,
    })

    return handle
  }

  /**
   * Start reading from a future.
   *
   * Returns a handle that can be polled/waited.
   *
   * @param future - The future to read
   * @returns Handle for this read operation
   */
  futureRead<T>(future: Future<T>): FutureReadHandle {
    const handle = this.nextHandle++

    const promise = future.read().then((result) => {
      const op = this.pendingOperations.get(handle)
      if (op) {
        op.result = result
        op.ready = true
      }
      return result
    })

    this.pendingOperations.set(handle, {
      handle,
      type: 'future-read',
      promise,
      ready: false,
    })

    return handle
  }

  /**
   * Start an async subtask (call an async import).
   *
   * @param call - The async function to call
   * @returns Subtask handle
   */
  subtaskStart(call: () => Promise<unknown[]>): SubtaskHandle {
    return this.subtaskManager.create(call)
  }

  /**
   * Poll for completion of a subtask.
   *
   * @param handle - The subtask handle
   * @returns Current state
   */
  subtaskPoll(handle: SubtaskHandle): string {
    return this.subtaskManager.poll(handle)
  }

  /**
   * Get return values from a completed subtask.
   *
   * @param handle - The subtask handle
   * @returns Return values or undefined
   */
  subtaskReturnValues(handle: SubtaskHandle): unknown[] | undefined {
    return this.subtaskManager.getReturnValues(handle)
  }

  /**
   * Drop a subtask handle.
   *
   * @param handle - The subtask handle
   */
  subtaskDrop(handle: SubtaskHandle): void {
    this.subtaskManager.drop(handle)
  }

  /**
   * Block until progress can be made on async operations.
   *
   * Returns events describing what became ready.
   *
   * @returns Promise that resolves with ready events
   */
  async wait(): Promise<TaskEvent[]> {
    // Collect all pending operations and subtasks
    const pendingPromises: Promise<TaskEvent>[] = []

    // Add pending operations
    for (const [handle, op] of this.pendingOperations) {
      if (!op.ready) {
        pendingPromises.push(
          op.promise.then(
            () =>
              ({
                type: op.type,
                handle,
                payload: op.result,
              }) as TaskEvent
          )
        )
      }
    }

    // Add pending subtasks
    const subtaskHandles = this.subtaskManager.getActiveHandles()
    for (const handle of subtaskHandles) {
      const state = this.subtaskManager.getState(handle)
      if (state && state !== 'returned' && state !== 'done') {
        pendingPromises.push(
          this.subtaskManager.wait(handle).then(
            () =>
              ({
                type: 'subtask-done',
                handle,
                payload: this.subtaskManager.getReturnValues(handle),
              }) as TaskEvent
          )
        )
      }
    }

    if (pendingPromises.length === 0) {
      return []
    }

    // Wait for at least one to complete
    const event = await Promise.race(pendingPromises)
    return [event]
  }

  /**
   * Non-blocking check for progress on async operations.
   *
   * @returns Events for operations that are ready
   */
  poll(): TaskEvent[] {
    const events: TaskEvent[] = []

    // Check pending operations
    for (const [handle, op] of this.pendingOperations) {
      if (op.ready) {
        events.push({
          type: op.type,
          handle,
          payload: op.result,
        })
      }
    }

    // Check subtasks
    const subtaskHandles = this.subtaskManager.getActiveHandles()
    for (const handle of subtaskHandles) {
      const state = this.subtaskManager.getState(handle)
      if (state === 'returned' || state === 'done') {
        events.push({
          type: 'subtask-done',
          handle,
          payload: this.subtaskManager.getReturnValues(handle),
        })
      }
    }

    return events
  }

  /**
   * Yield execution to other tasks.
   *
   * Allows the JavaScript event loop to process other work.
   */
  async yield(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  /**
   * Get the result of a completed operation.
   *
   * @param handle - The operation handle
   * @returns The result, or undefined if not ready
   */
  getResult(handle: number): unknown | undefined {
    const op = this.pendingOperations.get(handle)
    if (op?.ready) {
      return op.result
    }
    return undefined
  }

  /**
   * Drop an operation handle.
   *
   * @param handle - The operation handle
   */
  dropOperation(handle: number): void {
    this.pendingOperations.delete(handle)
  }

  /**
   * Cancel all pending operations.
   */
  cancelAll(): void {
    // Note: We can't actually cancel promises, but we mark them as done
    this.pendingOperations.clear()
  }
}

/**
 * Task built-ins interface for canonical ABI.
 */
export interface TaskBuiltins {
  /**
   * Signal that a task has started.
   */
  'task.start': () => void

  /**
   * Signal task completion with return values.
   */
  'task.return': (values: unknown[]) => void

  /**
   * Block until progress can be made.
   */
  'task.wait': () => Promise<TaskEvent[]>

  /**
   * Non-blocking check for progress.
   */
  'task.poll': () => TaskEvent[]

  /**
   * Yield execution to other tasks.
   */
  'task.yield': () => Promise<void>
}

/**
 * Create task built-ins bound to a specific task.
 *
 * @param task - The task to bind to
 * @returns Task built-in functions
 */
export function createTaskBuiltins(task: Task): TaskBuiltins {
  return {
    'task.start': () => task.start(),
    'task.return': (values: unknown[]) => task.return(values),
    'task.wait': () => task.wait(),
    'task.poll': () => task.poll(),
    'task.yield': () => task.yield(),
  }
}
