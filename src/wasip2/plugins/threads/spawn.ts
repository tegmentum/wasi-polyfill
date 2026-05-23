/**
 * Thread spawn implementation for wasi:thread-spawn/thread-spawn
 *
 * Provides thread spawning capability using Web Workers in browsers.
 * Threads share memory via SharedArrayBuffer.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  type ThreadId,
  type SpawnResult,
  type ThreadInfo,
  type ThreadCapabilities,
  ThreadSpawnError,
  ThreadState,
  checkThreadCapabilities,
  spawnError,
  spawnSuccess,
} from './types.js'

/**
 * Configuration for thread spawn plugin
 */
export interface ThreadSpawnConfig {
  /**
   * Maximum number of threads that can be spawned
   * Default: navigator.hardwareConcurrency or 4
   */
  maxThreads?: number

  /**
   * Whether to allow thread spawning
   * Default: true (if environment supports it)
   */
  enabled?: boolean

  /**
   * Worker script URL for browser environments
   * If not provided, threads will not work in browsers
   */
  workerUrl?: string

  /**
   * Callback when a thread completes
   */
  onThreadComplete?: (threadId: ThreadId, exitCode: number) => void

  /**
   * Callback when a thread encounters an error
   */
  onThreadError?: (threadId: ThreadId, error: Error) => void
}

/**
 * Thread registry for tracking spawned threads
 */
export class ThreadRegistry {
  private nextId: ThreadId = 1
  private readonly threads: Map<ThreadId, ThreadInfo> = new Map()
  private readonly workers: Map<ThreadId, Worker> = new Map()
  private readonly maxThreads: number

  constructor(maxThreads = 16) {
    this.maxThreads = maxThreads
  }

  /**
   * Register a new thread
   */
  register(startArg: number, worker?: Worker): ThreadId {
    const id = this.nextId++
    const info: ThreadInfo = {
      id,
      state: ThreadState.Running,
      startArg,
    }
    this.threads.set(id, info)
    if (worker) {
      this.workers.set(id, worker)
    }
    return id
  }

  /**
   * Get thread info
   */
  get(id: ThreadId): ThreadInfo | undefined {
    return this.threads.get(id)
  }

  /**
   * Get the worker for a thread
   */
  getWorker(id: ThreadId): Worker | undefined {
    return this.workers.get(id)
  }

  /**
   * Update thread state
   */
  setState(id: ThreadId, state: ThreadState, error?: string): void {
    const info = this.threads.get(id)
    if (info) {
      info.state = state
      if (error !== undefined) {
        info.error = error
      }
    }
  }

  /**
   * Remove a thread from registry
   */
  remove(id: ThreadId): void {
    const worker = this.workers.get(id)
    if (worker) {
      worker.terminate()
      this.workers.delete(id)
    }
    this.threads.delete(id)
  }

  /**
   * Get active thread count
   */
  get activeCount(): number {
    let count = 0
    for (const info of this.threads.values()) {
      if (info.state === ThreadState.Running) {
        count++
      }
    }
    return count
  }

  /**
   * Check if more threads can be spawned
   */
  canSpawn(): boolean {
    return this.activeCount < this.maxThreads
  }

  /**
   * Get all thread IDs
   */
  getAll(): ThreadId[] {
    return Array.from(this.threads.keys())
  }

  /**
   * Terminate all threads
   */
  terminateAll(): void {
    for (const [id, worker] of this.workers) {
      worker.terminate()
      this.setState(id, ThreadState.Terminated)
    }
    this.workers.clear()
  }

  /**
   * Clear all threads
   */
  clear(): void {
    this.terminateAll()
    this.threads.clear()
  }
}

/**
 * Global thread registry
 */
export const globalThreadRegistry = new ThreadRegistry()

/**
 * Thread spawn plugin instance
 */
class ThreadSpawnInstance implements PluginInstance {
  private readonly registry: ThreadRegistry
  private readonly config: ThreadSpawnConfig
  private readonly capabilities: ThreadCapabilities

  constructor(registry: ThreadRegistry, config: ThreadSpawnConfig = {}) {
    this.registry = registry
    this.config = config
    this.capabilities = checkThreadCapabilities()
  }

  getImports(): Record<string, unknown> {
    return {
      spawn: this.spawn.bind(this),
    }
  }

  destroy(): void {
    this.registry.terminateAll()
  }

  /**
   * Spawn a new thread
   *
   * The start_arg is passed to the thread's start function.
   * In WASI, this is typically a pointer to thread-local data.
   */
  private spawn(startArg: number): SpawnResult {
    // Check if threading is enabled
    if (this.config.enabled === false) {
      return spawnError(ThreadSpawnError.AccessDenied)
    }

    // Check environment capabilities
    if (!this.capabilities.canSpawn) {
      return spawnError(ThreadSpawnError.NotSupported)
    }

    // Check thread limit
    if (!this.registry.canSpawn()) {
      return spawnError(ThreadSpawnError.ResourceExhausted)
    }

    // Check for worker URL
    if (!this.config.workerUrl) {
      return spawnError(ThreadSpawnError.NotSupported)
    }

    try {
      // Create a new Web Worker
      const worker = new Worker(this.config.workerUrl, {
        type: 'module',
      })

      // Register the thread
      const threadId = this.registry.register(startArg, worker)

      // Set up message handlers
      worker.onmessage = (event: MessageEvent) => {
        const { type, exitCode } = event.data as { type: string; exitCode?: number }
        if (type === 'exit') {
          this.registry.setState(threadId, ThreadState.Completed)
          this.config.onThreadComplete?.(threadId, exitCode ?? 0)
        }
      }

      worker.onerror = (event: ErrorEvent) => {
        const error = new Error(event.message)
        this.registry.setState(threadId, ThreadState.Error, event.message)
        this.config.onThreadError?.(threadId, error)
      }

      // Send start message to worker
      worker.postMessage({
        type: 'start',
        threadId,
        startArg,
      })

      return spawnSuccess(threadId)
    } catch {
      return spawnError(ThreadSpawnError.InternalError)
    }
  }
}

/**
 * Stub thread spawn implementation
 *
 * Returns NotSupported for all spawn attempts.
 * Use this when threading is not available or desired.
 */
class StubThreadSpawnInstance implements PluginInstance {
  getImports(): Record<string, unknown> {
    return {
      spawn: this.spawn.bind(this),
    }
  }

  destroy(): void {
    // No cleanup needed
  }

  private spawn(_startArg: number): SpawnResult {
    return spawnError(ThreadSpawnError.NotSupported)
  }
}

/**
 * Stub thread spawn implementation
 *
 * Always returns NotSupported error.
 */
export const stubThreadSpawnImplementation: Implementation = {
  name: 'stub',
  description: 'Stub thread spawn (returns NotSupported)',
  create(_config: PluginConfig): PluginInstance {
    return new StubThreadSpawnInstance()
  },
}

/**
 * Web Worker-based thread spawn implementation
 *
 * Uses Web Workers for thread spawning in browsers.
 * Requires SharedArrayBuffer support.
 */
export const workerThreadSpawnImplementation: Implementation = {
  name: 'worker',
  description: 'Web Worker-based thread spawn',
  create(config: PluginConfig): PluginInstance {
    const spawnConfig: ThreadSpawnConfig = {}
    const maxThreads = config.options?.['maxThreads'] as number | undefined
    const enabled = config.options?.['enabled'] as boolean | undefined
    const workerUrl = config.options?.['workerUrl'] as string | undefined
    const onThreadComplete = config.options?.['onThreadComplete'] as
      | ((threadId: ThreadId, exitCode: number) => void)
      | undefined
    const onThreadError = config.options?.['onThreadError'] as
      | ((threadId: ThreadId, error: Error) => void)
      | undefined

    if (maxThreads !== undefined) {
      spawnConfig.maxThreads = maxThreads
    }
    if (enabled !== undefined) {
      spawnConfig.enabled = enabled
    }
    if (workerUrl !== undefined) {
      spawnConfig.workerUrl = workerUrl
    }
    if (onThreadComplete !== undefined) {
      spawnConfig.onThreadComplete = onThreadComplete
    }
    if (onThreadError !== undefined) {
      spawnConfig.onThreadError = onThreadError
    }

    return new ThreadSpawnInstance(globalThreadRegistry, spawnConfig)
  },
}
