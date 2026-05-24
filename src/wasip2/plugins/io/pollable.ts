/**
 * Pollable resource implementation
 *
 * Pollables are handles that can be waited on until they become ready.
 * In the browser, we implement these using Promises.
 */

import type { PluginConfig } from '../../core/types.js'
import {
  contextFromConfig,
  globalResourceContext,
} from '../../core/resource-context.js'

/**
 * A Pollable is a resource that can be polled for readiness.
 *
 * In WASI Preview 2, pollables are used for async I/O operations.
 * We implement them as wrappers around Promises.
 */
export class Pollable {
  private readonly promise: Promise<void>
  private resolved = false

  constructor(promise: Promise<void>) {
    this.promise = promise

    // Track when the promise resolves
    this.promise.then(() => {
      this.resolved = true
    })
  }

  /**
   * Check if this pollable is ready (non-blocking)
   */
  ready(): boolean {
    return this.resolved
  }

  /**
   * Block until this pollable is ready
   */
  async block(): Promise<void> {
    await this.promise
  }

  /**
   * Get the underlying promise
   */
  getPromise(): Promise<void> {
    return this.promise
  }
}

/**
 * Resource handle manager for pollables
 *
 * Manages a mapping from integer handles to Pollable instances.
 */
export class PollableRegistry {
  private nextHandle = 1
  private readonly pollables: Map<number, Pollable> = new Map()

  /**
   * Create a new pollable and return its handle
   */
  create(promise: Promise<void>): number {
    const handle = this.nextHandle++
    const pollable = new Pollable(promise)
    this.pollables.set(handle, pollable)
    return handle
  }

  /**
   * Get a pollable by its handle
   */
  get(handle: number): Pollable | undefined {
    return this.pollables.get(handle)
  }

  /**
   * Drop (destroy) a pollable
   */
  drop(handle: number): boolean {
    return this.pollables.delete(handle)
  }

  /**
   * Check if a pollable is ready
   */
  ready(handle: number): boolean {
    const pollable = this.pollables.get(handle)
    return pollable?.ready() ?? false
  }

  /**
   * Block until a pollable is ready
   */
  async block(handle: number): Promise<void> {
    const pollable = this.pollables.get(handle)
    if (pollable) {
      await pollable.block()
    }
  }

  /**
   * Poll multiple pollables, returning the indices that are ready
   *
   * If none are ready and block is true, waits for at least one.
   */
  async poll(handles: number[], block = true): Promise<number[]> {
    // First check which are already ready
    const ready: number[] = []
    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i]!
      if (this.ready(handle)) {
        ready.push(i)
      }
    }

    // If any are ready, return immediately
    if (ready.length > 0) {
      return ready
    }

    // If not blocking, return empty array
    if (!block) {
      return []
    }

    // Wait for at least one to become ready
    const promises = handles.map((handle, index) => {
      const pollable = this.pollables.get(handle)
      if (!pollable) {
        // Invalid handle - resolve immediately to indicate error
        return Promise.resolve(index)
      }
      return pollable.block().then(() => index)
    })

    // Race to find the first ready
    const firstReady = await Promise.race(promises)

    // Now check all that are ready (more may have become ready)
    const nowReady: number[] = []
    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i]!
      if (this.ready(handle)) {
        nowReady.push(i)
      }
    }

    return nowReady.length > 0 ? nowReady : [firstReady]
  }

  /**
   * Clear all pollables
   */
  clear(): void {
    this.pollables.clear()
  }

  /**
   * Get the number of active pollables
   */
  get size(): number {
    return this.pollables.size
  }
}

/**
 * Global pollable registry (used for standalone plugin instantiation).
 */
export const globalPollableRegistry = new PollableRegistry()

/** ResourceContext key for the per-polyfill pollable registry. */
export const POLLABLE_REGISTRY_KEY = Symbol('wasi:io/pollable-registry')

// Seed the global context so standalone/global use keeps the global registry,
// while fresh per-polyfill contexts get isolated registries.
globalResourceContext.get(POLLABLE_REGISTRY_KEY, () => globalPollableRegistry)

/** Resolve the pollable registry for a plugin config (per-polyfill, else global). */
export function resolvePollableRegistry(config: PluginConfig): PollableRegistry {
  return contextFromConfig(config).get(
    POLLABLE_REGISTRY_KEY,
    () => new PollableRegistry()
  )
}

/**
 * Create a pollable that resolves after a delay
 */
export function createTimerPollable(
  registry: PollableRegistry,
  delayMs: number
): number {
  const promise = new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, delayMs))
  })
  return registry.create(promise)
}

/**
 * Create a pollable that is already ready
 */
export function createReadyPollable(registry: PollableRegistry): number {
  return registry.create(Promise.resolve())
}
