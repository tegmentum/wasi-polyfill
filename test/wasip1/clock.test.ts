/**
 * WASI Preview 1 Clock Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createClockFunctions } from '../../src/wasip1/clock.js'
import { WasiMemory } from '../../src/wasip1/memory.js'
import { Errno, ClockId } from '../../src/wasip1/types.js'

describe('WASIP1 Clock', () => {
  let memory: WasiMemory
  let wasmMemory: WebAssembly.Memory

  beforeEach(() => {
    wasmMemory = new WebAssembly.Memory({ initial: 1 })
    memory = new WasiMemory()
    memory.attach(wasmMemory)
  })

  describe('clock_res_get', () => {
    it('returns resolution for REALTIME clock', () => {
      const fns = createClockFunctions(memory)

      const result = fns.clock_res_get(ClockId.REALTIME, 0)

      expect(result).toBe(Errno.SUCCESS)
      const resolution = memory.readU64(0)
      expect(resolution).toBe(1_000_000n) // 1ms in nanoseconds
    })

    it('returns resolution for MONOTONIC clock', () => {
      const fns = createClockFunctions(memory)

      const result = fns.clock_res_get(ClockId.MONOTONIC, 0)

      expect(result).toBe(Errno.SUCCESS)
      const resolution = memory.readU64(0)
      expect(resolution).toBe(1_000n) // 1 microsecond in nanoseconds
    })

    it('returns resolution for PROCESS_CPUTIME_ID clock', () => {
      const fns = createClockFunctions(memory)

      const result = fns.clock_res_get(ClockId.PROCESS_CPUTIME_ID, 0)

      expect(result).toBe(Errno.SUCCESS)
      const resolution = memory.readU64(0)
      expect(resolution).toBe(1_000n)
    })

    it('returns resolution for THREAD_CPUTIME_ID clock', () => {
      const fns = createClockFunctions(memory)

      const result = fns.clock_res_get(ClockId.THREAD_CPUTIME_ID, 0)

      expect(result).toBe(Errno.SUCCESS)
      const resolution = memory.readU64(0)
      expect(resolution).toBe(1_000n)
    })

    it('returns EINVAL for invalid clock id', () => {
      const fns = createClockFunctions(memory)

      const result = fns.clock_res_get(999, 0)

      expect(result).toBe(Errno.EINVAL)
    })
  })

  describe('clock_time_get', () => {
    it('returns current time for REALTIME clock', () => {
      const fns = createClockFunctions(memory)
      const beforeMs = Date.now()

      const result = fns.clock_time_get(ClockId.REALTIME, 0n, 0)

      const afterMs = Date.now()
      expect(result).toBe(Errno.SUCCESS)

      const timeNs = memory.readU64(0)
      const timeMs = Number(timeNs / 1_000_000n)

      // Time should be between before and after
      expect(timeMs).toBeGreaterThanOrEqual(beforeMs)
      expect(timeMs).toBeLessThanOrEqual(afterMs)
    })

    it('returns monotonic time starting from 0', () => {
      const fns = createClockFunctions(memory)

      const result = fns.clock_time_get(ClockId.MONOTONIC, 0n, 0)

      expect(result).toBe(Errno.SUCCESS)
      const timeNs = memory.readU64(0)

      // Should be non-negative and reasonably small
      expect(timeNs).toBeGreaterThanOrEqual(0n)
    })

    it('monotonic time increases', async () => {
      const fns = createClockFunctions(memory)

      fns.clock_time_get(ClockId.MONOTONIC, 0n, 0)
      const time1 = memory.readU64(0)

      // Small delay
      await new Promise((r) => setTimeout(r, 10))

      fns.clock_time_get(ClockId.MONOTONIC, 0n, 0)
      const time2 = memory.readU64(0)

      expect(time2).toBeGreaterThan(time1)
    })

    it('returns time for PROCESS_CPUTIME_ID', () => {
      const fns = createClockFunctions(memory)

      const result = fns.clock_time_get(ClockId.PROCESS_CPUTIME_ID, 0n, 0)

      expect(result).toBe(Errno.SUCCESS)
      const timeNs = memory.readU64(0)
      expect(timeNs).toBeGreaterThanOrEqual(0n)
    })

    it('returns time for THREAD_CPUTIME_ID', () => {
      const fns = createClockFunctions(memory)

      const result = fns.clock_time_get(ClockId.THREAD_CPUTIME_ID, 0n, 0)

      expect(result).toBe(Errno.SUCCESS)
      const timeNs = memory.readU64(0)
      expect(timeNs).toBeGreaterThanOrEqual(0n)
    })

    it('returns EINVAL for invalid clock id', () => {
      const fns = createClockFunctions(memory)

      const result = fns.clock_time_get(999, 0n, 0)

      expect(result).toBe(Errno.EINVAL)
    })

    it('ignores precision parameter', () => {
      const fns = createClockFunctions(memory)

      // Different precision values should still work
      const result1 = fns.clock_time_get(ClockId.REALTIME, 1n, 0)
      const result2 = fns.clock_time_get(ClockId.REALTIME, 1_000_000n, 0)
      const result3 = fns.clock_time_get(ClockId.REALTIME, 1_000_000_000n, 0)

      expect(result1).toBe(Errno.SUCCESS)
      expect(result2).toBe(Errno.SUCCESS)
      expect(result3).toBe(Errno.SUCCESS)
    })

    it('writes time as 64-bit value', () => {
      const fns = createClockFunctions(memory)

      fns.clock_time_get(ClockId.REALTIME, 0n, 0)

      const timeNs = memory.readU64(0)
      // Current Unix time in nanoseconds is > 1e18
      expect(timeNs).toBeGreaterThan(1_000_000_000_000_000_000n)
    })
  })

  describe('integration', () => {
    it('can use both res_get and time_get', () => {
      const fns = createClockFunctions(memory)

      // Get resolution
      fns.clock_res_get(ClockId.MONOTONIC, 0)
      const resolution = memory.readU64(0)

      // Get time
      fns.clock_time_get(ClockId.MONOTONIC, 0n, 8)
      const time = memory.readU64(8)

      expect(resolution).toBeGreaterThan(0n)
      expect(time).toBeGreaterThanOrEqual(0n)
    })

    it('realtime and monotonic are independent', () => {
      const fns = createClockFunctions(memory)

      fns.clock_time_get(ClockId.REALTIME, 0n, 0)
      const realtimeNs = memory.readU64(0)

      fns.clock_time_get(ClockId.MONOTONIC, 0n, 0)
      const monotonicNs = memory.readU64(0)

      // Realtime should be Unix epoch based (very large)
      // Monotonic should be runtime based (small)
      expect(realtimeNs).toBeGreaterThan(monotonicNs)
    })

    it('multiple time_get calls work', () => {
      const fns = createClockFunctions(memory)

      for (let i = 0; i < 10; i++) {
        const result = fns.clock_time_get(ClockId.REALTIME, 0n, 0)
        expect(result).toBe(Errno.SUCCESS)
        const timeNs = memory.readU64(0)
        expect(timeNs).toBeGreaterThan(0n)
      }
    })
  })
})
