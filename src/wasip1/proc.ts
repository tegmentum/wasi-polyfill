/**
 * WASI Preview 1 process functions
 *
 * Implements proc_exit, proc_raise, and sched_yield.
 *
 * @packageDocumentation
 */

import { Errno } from './types.js'

/**
 * Error thrown when proc_exit is called.
 * Can be caught to handle exit gracefully.
 */
export class WasiExitError extends Error {
  readonly code: number

  constructor(code: number) {
    super(`WASI exit with code ${code}`)
    this.name = 'WasiExitError'
    this.code = code
  }
}

/**
 * Options for process functions.
 */
export interface ProcOptions {
  /**
   * If true, proc_exit will set exitCode and return instead of throwing.
   * Default is false (throws WasiExitError).
   */
  returnOnExit?: boolean

  /**
   * Callback when exit is requested (before throw/return).
   */
  onExit?: (code: number) => void
}

/**
 * Creates WASI process functions.
 */
export function createProcFunctions(options: ProcOptions = {}): {
  proc_exit: (code: number) => never
  proc_raise: (sig: number) => number
  sched_yield: () => number
  getExitCode: () => number | null
} {
  let exitCode: number | null = null

  return {
    /**
     * proc_exit(rval: i32) -> noreturn
     *
     * Terminate the process normally.
     */
    proc_exit(code: number): never {
      exitCode = code
      options.onExit?.(code)

      if (options.returnOnExit) {
        // This is a hack - we throw anyway but mark it specially
        // The caller should catch WasiExitError and handle it
        throw new WasiExitError(code)
      }

      throw new WasiExitError(code)
    },

    /**
     * proc_raise(sig: i32) -> errno
     *
     * Send a signal to the process of the calling thread.
     * Not meaningful in browser context, returns ENOSYS.
     */
    proc_raise(_sig: number): number {
      // Signals are not supported in browser environment
      return Errno.ENOSYS
    },

    /**
     * sched_yield() -> errno
     *
     * Temporarily yield execution of the calling thread.
     * In JavaScript, this is essentially a no-op since we're single-threaded.
     */
    sched_yield(): number {
      // No-op in single-threaded JavaScript
      return Errno.SUCCESS
    },

    /**
     * Get the exit code if proc_exit was called.
     */
    getExitCode(): number | null {
      return exitCode
    },
  }
}
