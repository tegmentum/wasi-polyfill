/**
 * WASI Clocks 0.3.0 interface
 *
 * P3 clocks are similar to P2 but with async sleep instead of pollables.
 *
 * @packageDocumentation
 */

import type { Future } from '../types.js'
import { createFuture, delay } from '../canonical-abi/future.js'

/**
 * Instant in nanoseconds (monotonic clock).
 */
export type Instant = bigint

/**
 * Duration in nanoseconds.
 */
export type Duration = bigint

/**
 * Wall clock datetime.
 */
export interface Datetime {
  seconds: bigint
  nanoseconds: number
}

/**
 * Monotonic clock start time (for calculating relative instants).
 */
const monotonicStart = performance.now()

/**
 * Get the current monotonic clock instant.
 *
 * @returns Current instant in nanoseconds
 */
export function monotonicNow(): Instant {
  const ms = performance.now() - monotonicStart
  return BigInt(Math.floor(ms * 1_000_000))
}

/**
 * Get the monotonic clock resolution.
 *
 * @returns Resolution in nanoseconds
 */
export function monotonicResolution(): Duration {
  // Most browsers have 1ms resolution, some have better
  return 1_000n // 1 microsecond
}

/**
 * Sleep until a specific instant (async).
 *
 * @param when - Target instant in nanoseconds
 * @returns Future that resolves when time is reached
 */
export function sleepUntil(when: Instant): Future<void> {
  const now = monotonicNow()
  if (when <= now) {
    // Already past, resolve immediately
    const [future, resolver] = createFuture<void>()
    resolver.resolve(undefined)
    return future
  }

  // Calculate milliseconds to wait
  const nanosToWait = when - now
  const msToWait = Number(nanosToWait / 1_000_000n)

  return delay(msToWait)
}

/**
 * Sleep for a specific duration (async).
 *
 * @param duration - Duration in nanoseconds
 * @returns Future that resolves after duration
 */
export function sleepFor(duration: Duration): Future<void> {
  const msToWait = Number(duration / 1_000_000n)
  return delay(Math.max(0, msToWait))
}

/**
 * Get the current wall clock time.
 *
 * @returns Current datetime
 */
export function wallClockNow(): Datetime {
  const now = Date.now()
  return {
    seconds: BigInt(Math.floor(now / 1000)),
    nanoseconds: (now % 1000) * 1_000_000,
  }
}

/**
 * Get the wall clock resolution.
 *
 * @returns Resolution as datetime
 */
export function wallClockResolution(): Datetime {
  return {
    seconds: 0n,
    nanoseconds: 1_000_000, // 1 millisecond
  }
}

/**
 * Get the wasi:clocks@0.3.0 imports.
 *
 * @returns Import object for wasi:clocks@0.3.0
 */
export function getClocksImports(): Record<string, unknown> {
  return {
    'wasi:clocks/monotonic-clock@0.3.0': {
      now: monotonicNow,
      resolution: monotonicResolution,

      // P3 async sleep (replaces pollable subscribe)
      'sleep-until': async (when: Instant): Promise<void> => {
        const future = sleepUntil(when)
        await future.read()
      },

      'sleep-for': async (duration: Duration): Promise<void> => {
        const future = sleepFor(duration)
        await future.read()
      },
    },

    'wasi:clocks/wall-clock@0.3.0': {
      now: wallClockNow,
      resolution: wallClockResolution,
    },

    // Timezone support (simplified)
    'wasi:clocks/timezone@0.3.0': {
      'display': (datetime: Datetime): { utcOffset: number; name: string; inDst: boolean } => {
        const date = new Date(Number(datetime.seconds) * 1000)
        const offsetMinutes = -date.getTimezoneOffset()
        return {
          utcOffset: offsetMinutes * 60, // seconds
          name: Intl.DateTimeFormat().resolvedOptions().timeZone,
          inDst: false, // Simplified - would need more logic to detect DST
        }
      },

      'utc-offset': (datetime: Datetime): number => {
        const date = new Date(Number(datetime.seconds) * 1000)
        return -date.getTimezoneOffset() * 60 // seconds
      },
    },
  }
}
