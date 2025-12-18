/**
 * WASI Preview 1 clock functions
 *
 * Implements clock_res_get and clock_time_get.
 *
 * @packageDocumentation
 */

import { Errno, ClockId } from './types.js'
import { WasiMemory } from './memory.js'

/**
 * Creates WASI clock functions.
 */
export function createClockFunctions(memory: WasiMemory): {
  clock_res_get: (clockId: number, resolutionPtr: number) => number
  clock_time_get: (clockId: number, precision: bigint, timePtr: number) => number
} {
  // Track start time for monotonic clock
  const monotonicStart = performance.now()

  return {
    /**
     * clock_res_get(id: clockid, resolution: i32) -> errno
     *
     * Return the resolution of a clock.
     * Resolution is in nanoseconds.
     */
    clock_res_get(clockId: number, resolutionPtr: number): number {
      let resolution: bigint

      switch (clockId) {
        case ClockId.REALTIME:
          // Wall clock resolution - typically 1ms in browsers
          resolution = 1_000_000n // 1ms in nanoseconds
          break

        case ClockId.MONOTONIC:
          // Monotonic clock resolution - performance.now() varies by browser
          // Most browsers provide microsecond precision when available
          resolution = 1_000n // 1 microsecond in nanoseconds
          break

        case ClockId.PROCESS_CPUTIME_ID:
        case ClockId.THREAD_CPUTIME_ID:
          // CPU time clocks - not available in browsers, use monotonic approximation
          resolution = 1_000n // 1 microsecond in nanoseconds
          break

        default:
          return Errno.EINVAL
      }

      memory.writeU64(resolutionPtr, resolution)
      return Errno.SUCCESS
    },

    /**
     * clock_time_get(id: clockid, precision: timestamp, time: i32) -> errno
     *
     * Return the time value of a clock.
     * Time is in nanoseconds.
     */
    clock_time_get(clockId: number, _precision: bigint, timePtr: number): number {
      let timeNs: bigint

      switch (clockId) {
        case ClockId.REALTIME: {
          // Wall clock time since Unix epoch
          const nowMs = Date.now()
          timeNs = BigInt(nowMs) * 1_000_000n
          break
        }

        case ClockId.MONOTONIC: {
          // Monotonic time since arbitrary point (using start of this runtime)
          const elapsedMs = performance.now() - monotonicStart
          // Convert to nanoseconds (performance.now() returns milliseconds with sub-ms precision)
          timeNs = BigInt(Math.floor(elapsedMs * 1_000_000))
          break
        }

        case ClockId.PROCESS_CPUTIME_ID:
        case ClockId.THREAD_CPUTIME_ID: {
          // CPU time - approximate with monotonic since we can't measure actual CPU time in browsers
          const elapsedMs = performance.now() - monotonicStart
          timeNs = BigInt(Math.floor(elapsedMs * 1_000_000))
          break
        }

        default:
          return Errno.EINVAL
      }

      memory.writeU64(timePtr, timeNs)
      return Errno.SUCCESS
    },
  }
}
