/**
 * WASI Preview 3 subtask management
 *
 * Subtasks track the state of called async functions in the Component Model.
 * Each async call creates a subtask that progresses through states.
 *
 * @packageDocumentation
 */

import type { SubtaskState } from '../types.js'

/**
 * Handle to a subtask, used by callers to track async calls.
 */
export type SubtaskHandle = number

/**
 * Information about a subtask.
 */
export interface Subtask {
  /** Unique handle for this subtask */
  handle: SubtaskHandle
  /** Current state */
  state: SubtaskState
  /** Return values (set when state is 'returned' or 'done') */
  returnValues?: unknown[]
  /** Error if the subtask failed */
  error?: Error
  /** Callbacks to invoke on state change */
  onStateChange: Set<(state: SubtaskState, subtask: Subtask) => void>
}

/**
 * Manages subtasks for async function calls.
 *
 * When a component calls an async import, a subtask is created to
 * track the call's progress. The caller can poll or wait for completion.
 */
export class SubtaskManager {
  private nextHandle: SubtaskHandle = 1
  private subtasks: Map<SubtaskHandle, Subtask> = new Map()

  /**
   * Create a new subtask for an async call.
   *
   * @param call - The async function to execute
   * @returns Handle to track the subtask
   */
  create(call: () => Promise<unknown[]>): SubtaskHandle {
    const handle = this.nextHandle++

    const subtask: Subtask = {
      handle,
      state: 'starting',
      onStateChange: new Set(),
    }

    this.subtasks.set(handle, subtask)

    // Start the async call
    this.executeCall(subtask, call)

    return handle
  }

  /**
   * Execute the async call and update subtask state.
   */
  private async executeCall(
    subtask: Subtask,
    call: () => Promise<unknown[]>
  ): Promise<void> {
    try {
      // Transition to started (callee will call task.start)
      // For JavaScript async functions, we consider them "started" immediately
      this.transitionState(subtask, 'started')

      // Execute the call
      const returnValues = await call()

      // Store return values and transition to returned
      subtask.returnValues = returnValues
      this.transitionState(subtask, 'returned')
    } catch (error) {
      // Store error and transition to returned (with error)
      subtask.error = error instanceof Error ? error : new Error(String(error))
      subtask.returnValues = []
      this.transitionState(subtask, 'returned')
    }
  }

  /**
   * Transition a subtask to a new state.
   */
  private transitionState(subtask: Subtask, newState: SubtaskState): void {
    subtask.state = newState
    for (const callback of subtask.onStateChange) {
      callback(newState, subtask)
    }
  }

  /**
   * Get the current state of a subtask.
   *
   * @param handle - The subtask handle
   * @returns The current state, or undefined if handle is invalid
   */
  getState(handle: SubtaskHandle): SubtaskState | undefined {
    return this.subtasks.get(handle)?.state
  }

  /**
   * Poll a subtask for completion (non-blocking).
   *
   * @param handle - The subtask handle
   * @returns The current state
   * @throws Error if handle is invalid
   */
  poll(handle: SubtaskHandle): SubtaskState {
    const subtask = this.subtasks.get(handle)
    if (!subtask) {
      throw new Error(`Invalid subtask handle: ${handle}`)
    }
    return subtask.state
  }

  /**
   * Wait for a subtask to reach a terminal state (blocking).
   *
   * @param handle - The subtask handle
   * @returns Promise that resolves when subtask is 'returned' or 'done'
   * @throws Error if handle is invalid
   */
  wait(handle: SubtaskHandle): Promise<SubtaskState> {
    const subtask = this.subtasks.get(handle)
    if (!subtask) {
      return Promise.reject(new Error(`Invalid subtask handle: ${handle}`))
    }

    // If already returned, resolve immediately
    if (subtask.state === 'returned' || subtask.state === 'done') {
      return Promise.resolve(subtask.state)
    }

    // Wait for state change
    return new Promise((resolve) => {
      const callback = (state: SubtaskState) => {
        if (state === 'returned' || state === 'done') {
          subtask.onStateChange.delete(callback)
          resolve(state)
        }
      }
      subtask.onStateChange.add(callback)
    })
  }

  /**
   * Get the return values from a completed subtask.
   *
   * @param handle - The subtask handle
   * @returns The return values, or undefined if not yet returned
   * @throws Error if handle is invalid
   */
  getReturnValues(handle: SubtaskHandle): unknown[] | undefined {
    const subtask = this.subtasks.get(handle)
    if (!subtask) {
      throw new Error(`Invalid subtask handle: ${handle}`)
    }

    if (subtask.state !== 'returned' && subtask.state !== 'done') {
      return undefined
    }

    return subtask.returnValues
  }

  /**
   * Get any error from a failed subtask.
   *
   * @param handle - The subtask handle
   * @returns The error, or undefined if no error
   */
  getError(handle: SubtaskHandle): Error | undefined {
    return this.subtasks.get(handle)?.error
  }

  /**
   * Acknowledge subtask completion, transitioning to 'done'.
   *
   * This releases the subtask's resources.
   *
   * @param handle - The subtask handle
   * @throws Error if handle is invalid or subtask not in 'returned' state
   */
  acknowledge(handle: SubtaskHandle): void {
    const subtask = this.subtasks.get(handle)
    if (!subtask) {
      throw new Error(`Invalid subtask handle: ${handle}`)
    }

    if (subtask.state !== 'returned') {
      throw new Error(`Cannot acknowledge subtask in state: ${subtask.state}`)
    }

    this.transitionState(subtask, 'done')
  }

  /**
   * Drop a subtask, removing it from tracking.
   *
   * @param handle - The subtask handle
   */
  drop(handle: SubtaskHandle): void {
    this.subtasks.delete(handle)
  }

  /**
   * Get all active subtasks.
   *
   * @returns Array of subtask handles that haven't been dropped
   */
  getActiveHandles(): SubtaskHandle[] {
    return Array.from(this.subtasks.keys())
  }

  /**
   * Get subtasks in a specific state.
   *
   * @param state - The state to filter by
   * @returns Array of subtask handles in that state
   */
  getHandlesInState(state: SubtaskState): SubtaskHandle[] {
    return Array.from(this.subtasks.entries())
      .filter(([, subtask]) => subtask.state === state)
      .map(([handle]) => handle)
  }

  /**
   * Wait for any of the given subtasks to make progress.
   *
   * @param handles - Subtask handles to wait on
   * @returns Promise that resolves with the handle that made progress
   */
  waitAny(handles: SubtaskHandle[]): Promise<SubtaskHandle> {
    return new Promise((resolve, reject) => {
      const callbacks: Array<{
        subtask: Subtask
        callback: (state: SubtaskState, subtask: Subtask) => void
      }> = []

      // Check if any are already returned
      for (const handle of handles) {
        const subtask = this.subtasks.get(handle)
        if (!subtask) {
          reject(new Error(`Invalid subtask handle: ${handle}`))
          return
        }
        if (subtask.state === 'returned' || subtask.state === 'done') {
          resolve(handle)
          return
        }
      }

      // Register callbacks for all handles
      for (const handle of handles) {
        const subtask = this.subtasks.get(handle)!
        const callback = (state: SubtaskState) => {
          if (state === 'returned' || state === 'done') {
            // Remove all callbacks
            for (const { subtask: s, callback: c } of callbacks) {
              s.onStateChange.delete(c)
            }
            resolve(handle)
          }
        }
        subtask.onStateChange.add(callback)
        callbacks.push({ subtask, callback })
      }
    })
  }
}
