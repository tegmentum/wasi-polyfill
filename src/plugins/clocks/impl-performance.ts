/**
 * Performance-based monotonic clock implementation
 *
 * Uses performance.now() for high-resolution time measurement.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  PollableRegistry,
  globalPollableRegistry,
  createTimerPollable,
} from '../io/pollable.js'

/**
 * Monotonic clock instance using Performance API
 */
class PerformanceClockInstance implements PluginInstance {
  private readonly pollableRegistry: PollableRegistry

  constructor(pollableRegistry: PollableRegistry) {
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
    // performance.now() returns milliseconds with sub-millisecond precision
    // Convert to nanoseconds
    const ms = performance.now()
    return BigInt(Math.floor(ms * 1_000_000))
  }

  /**
   * Get the resolution of the monotonic clock in nanoseconds
   *
   * Performance.now() typically has microsecond precision,
   * but this varies by browser and security settings.
   */
  private resolution(): bigint {
    // Report 1 microsecond as the resolution
    // Actual resolution may vary due to timing attacks mitigations
    return 1000n
  }

  /**
   * Subscribe to a specific instant
   *
   * Returns a pollable that resolves when the instant is reached.
   */
  private subscribeInstant(when: bigint): number {
    const now = this.now()
    const delayNs = when - now
    const delayMs = Math.max(0, Number(delayNs) / 1_000_000)
    return createTimerPollable(this.pollableRegistry, delayMs)
  }

  /**
   * Subscribe to a duration from now
   */
  private subscribeDuration(duration: bigint): number {
    const delayMs = Math.max(0, Number(duration) / 1_000_000)
    return createTimerPollable(this.pollableRegistry, delayMs)
  }
}

/**
 * Performance API monotonic clock implementation
 */
export const performanceClockImplementation: Implementation = {
  name: 'performance',
  description: 'Monotonic clock using performance.now()',
  create(_config: PluginConfig): PluginInstance {
    return new PerformanceClockInstance(globalPollableRegistry)
  },
}
