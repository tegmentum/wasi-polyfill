/**
 * Date-based wall clock implementation
 *
 * Uses Date.now() for wall clock time.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'

/**
 * Wall clock datetime structure
 */
interface WallClockDatetime {
  seconds: bigint
  nanoseconds: number
}

/**
 * Wall clock instance using Date API
 */
class DateClockInstance implements PluginInstance {
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
   *
   * Returns seconds since Unix epoch and nanoseconds within the second.
   */
  private now(): WallClockDatetime {
    const ms = Date.now()
    const seconds = BigInt(Math.floor(ms / 1000))
    const nanoseconds = (ms % 1000) * 1_000_000

    return {
      seconds,
      nanoseconds,
    }
  }

  /**
   * Get the resolution of the wall clock
   *
   * Date.now() has millisecond precision.
   */
  private resolution(): WallClockDatetime {
    return {
      seconds: 0n,
      nanoseconds: 1_000_000, // 1 millisecond in nanoseconds
    }
  }
}

/**
 * Date API wall clock implementation
 */
export const dateClockImplementation: Implementation = {
  name: 'date',
  description: 'Wall clock using Date.now()',
  create(_config: PluginConfig): PluginInstance {
    return new DateClockInstance()
  },
}
