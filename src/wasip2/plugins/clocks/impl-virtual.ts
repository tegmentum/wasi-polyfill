/**
 * Virtual clock implementation for deterministic testing
 *
 * Uses the VirtualClock class from the runtime provider system
 * to provide fully controllable time for testing.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { VirtualClock } from '../../runtime/provider.js'
import {
  PollableRegistry,
  globalPollableRegistry,
  createReadyPollable,
} from '../io/pollable.js'

/**
 * Configuration for virtual clock
 */
export interface VirtualClockConfig extends PluginConfig {
  /**
   * Initial wall time (defaults to Unix epoch)
   */
  initialTime?: Date

  /**
   * Initial monotonic time in nanoseconds (defaults to 0)
   */
  initialMonotonic?: bigint

  /**
   * Shared VirtualClock instance (for coordinating multiple plugins)
   */
  clock?: VirtualClock
}

/**
 * Virtual monotonic clock instance
 *
 * Provides deterministic monotonic time that can be controlled externally.
 */
class VirtualMonotonicClockInstance implements PluginInstance {
  readonly clock: VirtualClock
  private readonly pollableRegistry: PollableRegistry

  constructor(clock: VirtualClock, pollableRegistry: PollableRegistry) {
    this.clock = clock
    this.pollableRegistry = pollableRegistry
  }

  getImports(): Record<string, unknown> {
    return {
      now: this.now.bind(this),
      resolution: this.resolution.bind(this),
      'subscribe-instant': this.subscribeInstant.bind(this),
      'subscribe-duration': this.subscribeDuration.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  /**
   * Get the current monotonic clock time in nanoseconds
   */
  private now(): bigint {
    return this.clock.monotonicNow()
  }

  /**
   * Get the resolution (report 1 nanosecond since we're virtual)
   */
  private resolution(): bigint {
    return 1n
  }

  /**
   * Subscribe to a specific instant
   *
   * In virtual mode, this creates a pollable that resolves when
   * the virtual clock is advanced past the instant.
   */
  private subscribeInstant(when: bigint): number {
    const now = this.now()
    if (when <= now) {
      // Already past this instant, create immediately ready pollable
      return createReadyPollable(this.pollableRegistry)
    }

    // Create a pollable that resolves when clock advances
    return this.createVirtualTimerPollable(when)
  }

  /**
   * Subscribe to a duration from now
   */
  private subscribeDuration(duration: bigint): number {
    const when = this.now() + duration
    return this.subscribeInstant(when)
  }

  /**
   * Create a pollable for a virtual timer
   */
  private createVirtualTimerPollable(when: bigint): number {
    // For virtual time, we create a promise that resolves when
    // the virtual clock is advanced past the target time.
    // This polls until the clock is advanced externally.
    const clock = this.clock

    const promise = new Promise<void>((resolve) => {
      const checkTime = () => {
        const now = clock.monotonicNow()
        if (now >= when) {
          resolve()
        } else {
          // Check again on next tick
          setTimeout(checkTime, 0)
        }
      }
      checkTime()
    })

    return this.pollableRegistry.create(promise)
  }

  /**
   * Advance the virtual clock
   *
   * This is exposed for external control in tests.
   */
  advance(nanoseconds: bigint): void {
    this.clock.advance(nanoseconds)
  }
}

/**
 * Virtual wall clock instance
 */
class VirtualWallClockInstance implements PluginInstance {
  readonly clock: VirtualClock

  constructor(clock: VirtualClock) {
    this.clock = clock
  }

  getImports(): Record<string, unknown> {
    return {
      now: this.now.bind(this),
      resolution: this.resolution.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  /**
   * Get the current wall clock time
   */
  private now(): { seconds: bigint; nanoseconds: number } {
    return this.clock.wallNow()
  }

  /**
   * Get the resolution (report 1 nanosecond since we're virtual)
   */
  private resolution(): { seconds: bigint; nanoseconds: number } {
    return {
      seconds: 0n,
      nanoseconds: 1,
    }
  }

  /**
   * Set the wall time externally
   */
  setTime(date: Date): void {
    this.clock.setWallTime(date)
  }

  /**
   * Advance the virtual clock
   */
  advance(nanoseconds: bigint): void {
    this.clock.advance(nanoseconds)
  }
}

/**
 * Virtual monotonic clock implementation
 *
 * Provides deterministic, controllable monotonic time for:
 * - Unit testing
 * - Snapshot testing
 * - Debugging time-sensitive code
 *
 * Usage:
 * ```typescript
 * const clock = new VirtualClock()
 * const instance = virtualMonotonicClockImplementation.create({ clock })
 *
 * // In tests:
 * clock.advance(1_000_000_000n) // Advance 1 second
 * ```
 */
export const virtualMonotonicClockImplementation: Implementation = {
  name: 'virtual',
  description: 'Deterministic monotonic clock for testing',
  create(config: PluginConfig): PluginInstance {
    const virtualConfig = config as VirtualClockConfig
    const clock = virtualConfig.clock ?? new VirtualClock(virtualConfig.initialTime)
    return new VirtualMonotonicClockInstance(clock, globalPollableRegistry)
  },
}

/**
 * Virtual wall clock implementation
 */
export const virtualWallClockImplementation: Implementation = {
  name: 'virtual',
  description: 'Deterministic wall clock for testing',
  create(config: PluginConfig): PluginInstance {
    const virtualConfig = config as VirtualClockConfig
    const clock = virtualConfig.clock ?? new VirtualClock(virtualConfig.initialTime)
    return new VirtualWallClockInstance(clock)
  },
}

/**
 * Controllable virtual clock store
 *
 * Provides a shared VirtualClock instance and WASI imports
 * for both monotonic and wall clocks.
 */
export class ControllableClockStore {
  readonly clock: VirtualClock
  private monotonicInstance: VirtualMonotonicClockInstance
  private wallInstance: VirtualWallClockInstance

  constructor(initialTime?: Date) {
    this.clock = new VirtualClock(initialTime)
    this.monotonicInstance = new VirtualMonotonicClockInstance(this.clock, globalPollableRegistry)
    this.wallInstance = new VirtualWallClockInstance(this.clock)
  }

  /**
   * Get monotonic clock imports
   */
  getMonotonicImports(): Record<string, unknown> {
    return this.monotonicInstance.getImports()
  }

  /**
   * Get wall clock imports
   */
  getWallImports(): Record<string, unknown> {
    return this.wallInstance.getImports()
  }

  /**
   * Advance time by nanoseconds
   */
  advance(nanoseconds: bigint): void {
    this.clock.advance(nanoseconds)
  }

  /**
   * Advance time by milliseconds (convenience)
   */
  advanceMs(milliseconds: number): void {
    this.advance(BigInt(milliseconds) * 1_000_000n)
  }

  /**
   * Advance time by seconds (convenience)
   */
  advanceSeconds(seconds: number): void {
    this.advance(BigInt(seconds) * 1_000_000_000n)
  }

  /**
   * Set wall time
   */
  setWallTime(date: Date): void {
    this.clock.setWallTime(date)
  }

  /**
   * Get current monotonic time in nanoseconds
   */
  get monotonicNow(): bigint {
    return this.clock.monotonicNow()
  }

  /**
   * Get current wall time
   */
  get wallNow(): { seconds: bigint; nanoseconds: number } {
    return this.clock.wallNow()
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.monotonicInstance.destroy()
    this.wallInstance.destroy()
  }
}
