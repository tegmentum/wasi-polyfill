/**
 * Thread types for wasi:thread-spawn
 *
 * Provides types for thread spawning and management in WASI Preview 2.
 * In browsers, this maps to Web Workers with SharedArrayBuffer.
 */

/**
 * Thread ID type
 *
 * A unique identifier for a spawned thread.
 * Value 0 is reserved for the main thread.
 */
export type ThreadId = number

/**
 * Thread spawn error codes
 */
export enum ThreadSpawnError {
  /** Threading is not supported in this environment */
  NotSupported = 'not-supported',

  /** Failed to spawn thread due to resource constraints */
  ResourceExhausted = 'resource-exhausted',

  /** Invalid start argument provided */
  InvalidArgument = 'invalid-argument',

  /** Thread spawn was denied by policy */
  AccessDenied = 'access-denied',

  /** Internal error during thread spawn */
  InternalError = 'internal-error',
}

/**
 * Thread spawn result
 */
export type SpawnResult =
  | { tag: 'ok'; val: ThreadId }
  | { tag: 'err'; val: ThreadSpawnError }

/**
 * Thread state
 */
export enum ThreadState {
  /** Thread is running */
  Running = 'running',

  /** Thread has completed successfully */
  Completed = 'completed',

  /** Thread was terminated */
  Terminated = 'terminated',

  /** Thread encountered an error */
  Error = 'error',
}

/**
 * Thread info
 */
export interface ThreadInfo {
  /** Thread ID */
  id: ThreadId

  /** Current thread state */
  state: ThreadState

  /** Start argument passed to the thread */
  startArg: number

  /** Error message if state is Error */
  error?: string
}

/**
 * Thread capabilities
 *
 * Describes what threading features are available in the current environment.
 */
export interface ThreadCapabilities {
  /** Whether thread spawning is supported */
  canSpawn: boolean

  /** Whether SharedArrayBuffer is available */
  hasSharedMemory: boolean

  /** Whether Atomics are available */
  hasAtomics: boolean

  /** Maximum number of threads that can be spawned (0 = unlimited) */
  maxThreads: number
}

/**
 * Check if the current environment supports threading
 */
export function checkThreadCapabilities(): ThreadCapabilities {
  // Check for SharedArrayBuffer (required for threads)
  const hasSharedMemory =
    typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined'

  // Check for Atomics
  const hasAtomics = typeof Atomics !== 'undefined'

  // Check for Web Workers (browser) or worker_threads (Node.js)
  let canSpawn = false
  if (typeof Worker !== 'undefined') {
    canSpawn = hasSharedMemory // Browser with SharedArrayBuffer
  }

  return {
    canSpawn,
    hasSharedMemory,
    hasAtomics,
    maxThreads: canSpawn ? navigator?.hardwareConcurrency ?? 4 : 0,
  }
}

/**
 * Create a thread spawn error result
 */
export function spawnError(error: ThreadSpawnError): SpawnResult {
  return { tag: 'err', val: error }
}

/**
 * Create a successful thread spawn result
 */
export function spawnSuccess(threadId: ThreadId): SpawnResult {
  return { tag: 'ok', val: threadId }
}
