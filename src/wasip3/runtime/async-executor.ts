/**
 * WASI Preview 3 async executor
 *
 * Maps P3's async model to JavaScript Promises.
 * Executes async component functions and manages their lifecycle.
 *
 * @packageDocumentation
 */

import { Task, createTaskBuiltins, type TaskBuiltins } from '../canonical-abi/task.js'
import type { TaskEvent } from '../types.js'

/**
 * Result of executing an async component function.
 */
export type ExecuteResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; error: Error }
  | { status: 'blocked' }

/**
 * Configuration for the async executor.
 */
export interface AsyncExecutorConfig {
  /**
   * Maximum number of concurrent tasks.
   * @default 100
   */
  maxConcurrentTasks?: number

  /**
   * Timeout for task.wait operations in milliseconds.
   * @default 30000
   */
  waitTimeout?: number
}

/**
 * Async executor for P3 component functions.
 *
 * Bridges Component Model async semantics with JavaScript Promises.
 */
export class AsyncExecutor {
  private config: Required<AsyncExecutorConfig>
  private activeTasks: Map<number, Task> = new Map()
  private nextTaskId = 1

  constructor(config: AsyncExecutorConfig = {}) {
    this.config = {
      maxConcurrentTasks: config.maxConcurrentTasks ?? 100,
      waitTimeout: config.waitTimeout ?? 30000,
    }
  }

  /**
   * Execute an async component function.
   *
   * @param fn - The function that implements the async export
   * @returns Promise that resolves with the return values
   *
   * @example
   * ```typescript
   * const executor = new AsyncExecutor()
   *
   * const result = await executor.execute(async (task) => {
   *   task.start()
   *   // ... do async work ...
   *   task.return([42])
   * })
   *
   * console.log(result) // [42]
   * ```
   */
  async execute<T extends unknown[]>(
    fn: (builtins: TaskBuiltins, task: Task) => Promise<void>
  ): Promise<T> {
    if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
      throw new Error('Maximum concurrent tasks exceeded')
    }

    const taskId = this.nextTaskId++
    const task = new Task()
    this.activeTasks.set(taskId, task)

    try {
      const builtins = createTaskBuiltins(task)

      // Execute the function
      await fn(builtins, task)

      // Check if task returned properly
      if (!task.isReturned()) {
        throw new Error('Async function did not call task.return')
      }

      return task.getReturnValues() as T
    } finally {
      this.activeTasks.delete(taskId)
    }
  }

  /**
   * Execute a sync function that may call async imports.
   *
   * This handles the case where a sync export calls an async import.
   * The executor blocks (via task.wait) until the async call completes.
   *
   * @param fn - The sync function to execute
   * @param asyncCaller - Function to make async calls and get subtask handles
   * @returns The sync function's return value
   */
  async executeSync<T>(
    fn: (caller: AsyncCaller) => T
  ): Promise<T> {
    const task = new Task()
    const taskId = this.nextTaskId++
    this.activeTasks.set(taskId, task)

    try {
      const caller: AsyncCaller = {
        callAsync: async <R extends unknown[]>(
          asyncFn: () => Promise<R>
        ): Promise<R> => {
          // Start the async call as a subtask
          const handle = task.subtaskStart(asyncFn as () => Promise<unknown[]>)

          // Wait for completion
          while (true) {
            const state = task.subtaskPoll(handle)
            if (state === 'returned' || state === 'done') {
              const values = task.subtaskReturnValues(handle)
              task.subtaskDrop(handle)
              return values as R
            }

            // Wait for progress
            await task.wait()
          }
        },
      }

      return fn(caller)
    } finally {
      this.activeTasks.delete(taskId)
    }
  }

  /**
   * Get the number of active tasks.
   */
  get activeTaskCount(): number {
    return this.activeTasks.size
  }

  /**
   * Wait for all active tasks to complete.
   *
   * @param timeout - Maximum wait time in milliseconds
   * @returns Promise that resolves when all tasks complete
   */
  async waitAll(timeout = this.config.waitTimeout): Promise<void> {
    const startTime = Date.now()

    while (this.activeTasks.size > 0) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for tasks to complete')
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  /**
   * Cancel all active tasks.
   */
  cancelAll(): void {
    for (const task of this.activeTasks.values()) {
      task.cancelAll()
    }
    this.activeTasks.clear()
  }
}

/**
 * Interface for making async calls from sync code.
 */
export interface AsyncCaller {
  /**
   * Call an async function and wait for its result.
   *
   * @param asyncFn - The async function to call
   * @returns Promise with the result
   */
  callAsync<R extends unknown[]>(asyncFn: () => Promise<R>): Promise<R>
}

/**
 * Helper to run an async component in a blocking manner.
 *
 * This is useful for CLI tools that need to run P3 components.
 *
 * @param fn - The async function to run
 * @returns Promise that resolves with the return values
 */
export async function runAsync<T extends unknown[]>(
  fn: (builtins: TaskBuiltins, task: Task) => Promise<void>
): Promise<T> {
  const executor = new AsyncExecutor()
  return executor.execute<T>(fn)
}

/**
 * Create a simple event loop for processing async operations.
 *
 * @param operations - Functions that may produce events
 * @param handler - Handler for events
 */
export async function eventLoop(
  operations: Array<() => Promise<TaskEvent[]>>,
  handler: (event: TaskEvent) => void | Promise<void>
): Promise<void> {
  while (true) {
    let anyEvents = false

    for (const operation of operations) {
      const events = await operation()
      for (const event of events) {
        anyEvents = true
        await handler(event)
      }
    }

    if (!anyEvents) {
      // Yield to allow other operations
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
}
