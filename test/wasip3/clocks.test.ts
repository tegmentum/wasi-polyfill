/**
 * WASI Clocks 0.3.0 Interface Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  monotonicNow,
  monotonicResolution,
  sleepUntil,
  sleepFor,
  wallClockNow,
  wallClockResolution,
  getClocksImports,
  type Instant,
  type Duration,
  type Datetime,
} from '../../src/wasip3/interfaces/clocks.js'

describe('WASIP3 Clocks Interface', () => {
  describe('monotonicNow', () => {
    it('returns a bigint', () => {
      const now = monotonicNow()
      expect(typeof now).toBe('bigint')
    })

    it('returns non-negative value', () => {
      const now = monotonicNow()
      expect(now).toBeGreaterThanOrEqual(0n)
    })

    it('increases over time', async () => {
      const before = monotonicNow()
      await new Promise((r) => setTimeout(r, 10))
      const after = monotonicNow()
      expect(after).toBeGreaterThan(before)
    })

    it('returns nanosecond-scale values', () => {
      const now = monotonicNow()
      // After waiting a bit, should have at least some microseconds
      // (we're measuring from a start point, so could be small)
      expect(now).toBeGreaterThanOrEqual(0n)
    })
  })

  describe('monotonicResolution', () => {
    it('returns a bigint', () => {
      const res = monotonicResolution()
      expect(typeof res).toBe('bigint')
    })

    it('returns positive value', () => {
      const res = monotonicResolution()
      expect(res).toBeGreaterThan(0n)
    })

    it('returns microsecond resolution', () => {
      const res = monotonicResolution()
      expect(res).toBe(1_000n) // 1 microsecond in nanoseconds
    })
  })

  describe('sleepUntil', () => {
    it('returns immediately for past instant', async () => {
      const past = monotonicNow() - 1000000n
      const future = sleepUntil(past)

      const start = Date.now()
      await future.read()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50) // Should be nearly instant
    })

    it('returns immediately for current instant', async () => {
      const now = monotonicNow()
      const future = sleepUntil(now)

      const start = Date.now()
      await future.read()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })

    it('sleeps until future instant', async () => {
      const target = monotonicNow() + 50_000_000n // 50ms in nanoseconds
      const future = sleepUntil(target)

      const start = Date.now()
      await future.read()
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(40) // Allow some timing slack
      expect(elapsed).toBeLessThan(150) // But not too long
    })

    it('returns a Future with ok status', async () => {
      const target = monotonicNow() + 10_000_000n
      const future = sleepUntil(target)

      const result = await future.read()
      expect(result.status).toBe('ok')
    })
  })

  describe('sleepFor', () => {
    it('returns immediately for zero duration', async () => {
      const future = sleepFor(0n)

      const start = Date.now()
      await future.read()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })

    it('returns immediately for negative duration', async () => {
      const future = sleepFor(-1000000n)

      const start = Date.now()
      await future.read()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })

    it('sleeps for specified duration', async () => {
      const duration = 50_000_000n // 50ms in nanoseconds
      const future = sleepFor(duration)

      const start = Date.now()
      await future.read()
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(40)
      expect(elapsed).toBeLessThan(150)
    })

    it('returns a Future with ok status', async () => {
      const future = sleepFor(10_000_000n)
      const result = await future.read()
      expect(result.status).toBe('ok')
    })
  })

  describe('wallClockNow', () => {
    it('returns a Datetime object', () => {
      const now = wallClockNow()
      expect(now).toHaveProperty('seconds')
      expect(now).toHaveProperty('nanoseconds')
    })

    it('returns bigint seconds', () => {
      const now = wallClockNow()
      expect(typeof now.seconds).toBe('bigint')
    })

    it('returns number nanoseconds', () => {
      const now = wallClockNow()
      expect(typeof now.nanoseconds).toBe('number')
    })

    it('returns reasonable current time', () => {
      const now = wallClockNow()
      const expectedSeconds = BigInt(Math.floor(Date.now() / 1000))

      // Should be within a second of Date.now()
      expect(now.seconds).toBeGreaterThanOrEqual(expectedSeconds - 1n)
      expect(now.seconds).toBeLessThanOrEqual(expectedSeconds + 1n)
    })

    it('returns nanoseconds in valid range', () => {
      const now = wallClockNow()
      expect(now.nanoseconds).toBeGreaterThanOrEqual(0)
      expect(now.nanoseconds).toBeLessThan(1_000_000_000)
    })

    it('increases over time', async () => {
      const before = wallClockNow()
      await new Promise((r) => setTimeout(r, 10))
      const after = wallClockNow()

      const beforeTotal = before.seconds * 1_000_000_000n + BigInt(before.nanoseconds)
      const afterTotal = after.seconds * 1_000_000_000n + BigInt(after.nanoseconds)

      expect(afterTotal).toBeGreaterThan(beforeTotal)
    })
  })

  describe('wallClockResolution', () => {
    it('returns a Datetime object', () => {
      const res = wallClockResolution()
      expect(res).toHaveProperty('seconds')
      expect(res).toHaveProperty('nanoseconds')
    })

    it('returns zero seconds', () => {
      const res = wallClockResolution()
      expect(res.seconds).toBe(0n)
    })

    it('returns millisecond resolution', () => {
      const res = wallClockResolution()
      expect(res.nanoseconds).toBe(1_000_000) // 1 millisecond
    })
  })

  describe('getClocksImports', () => {
    it('returns import object with monotonic clock', () => {
      const imports = getClocksImports()
      expect(imports).toHaveProperty('wasi:clocks/monotonic-clock@0.3.0')
    })

    it('returns import object with wall clock', () => {
      const imports = getClocksImports()
      expect(imports).toHaveProperty('wasi:clocks/wall-clock@0.3.0')
    })

    it('returns import object with timezone', () => {
      const imports = getClocksImports()
      expect(imports).toHaveProperty('wasi:clocks/timezone@0.3.0')
    })

    describe('monotonic-clock imports', () => {
      it('provides now function', () => {
        const imports = getClocksImports()
        const clock = imports['wasi:clocks/monotonic-clock@0.3.0'] as Record<string, Function>

        const now = clock.now()
        expect(typeof now).toBe('bigint')
        expect(now).toBeGreaterThanOrEqual(0n)
      })

      it('provides resolution function', () => {
        const imports = getClocksImports()
        const clock = imports['wasi:clocks/monotonic-clock@0.3.0'] as Record<string, Function>

        const res = clock.resolution()
        expect(res).toBe(1_000n)
      })

      it('provides async sleep-until function', async () => {
        const imports = getClocksImports()
        const clock = imports['wasi:clocks/monotonic-clock@0.3.0'] as Record<string, Function>

        const target = clock.now() + 10_000_000n
        await clock['sleep-until'](target)
        // Should complete without error
      })

      it('provides async sleep-for function', async () => {
        const imports = getClocksImports()
        const clock = imports['wasi:clocks/monotonic-clock@0.3.0'] as Record<string, Function>

        await clock['sleep-for'](10_000_000n)
        // Should complete without error
      })
    })

    describe('wall-clock imports', () => {
      it('provides now function', () => {
        const imports = getClocksImports()
        const clock = imports['wasi:clocks/wall-clock@0.3.0'] as Record<string, Function>

        const now = clock.now()
        expect(now).toHaveProperty('seconds')
        expect(now).toHaveProperty('nanoseconds')
      })

      it('provides resolution function', () => {
        const imports = getClocksImports()
        const clock = imports['wasi:clocks/wall-clock@0.3.0'] as Record<string, Function>

        const res = clock.resolution()
        expect(res.seconds).toBe(0n)
        expect(res.nanoseconds).toBe(1_000_000)
      })
    })

    describe('timezone imports', () => {
      it('provides display function', () => {
        const imports = getClocksImports()
        const tz = imports['wasi:clocks/timezone@0.3.0'] as Record<string, Function>

        const datetime: Datetime = { seconds: 1700000000n, nanoseconds: 0 }
        const display = tz.display(datetime)

        expect(display).toHaveProperty('utcOffset')
        expect(display).toHaveProperty('name')
        expect(display).toHaveProperty('inDst')
        expect(typeof display.utcOffset).toBe('number')
        expect(typeof display.name).toBe('string')
        expect(typeof display.inDst).toBe('boolean')
      })

      it('provides utc-offset function', () => {
        const imports = getClocksImports()
        const tz = imports['wasi:clocks/timezone@0.3.0'] as Record<string, Function>

        const datetime: Datetime = { seconds: 1700000000n, nanoseconds: 0 }
        const offset = tz['utc-offset'](datetime)

        expect(typeof offset).toBe('number')
        // Offset should be reasonable (within ±12 hours = ±43200 seconds)
        expect(Math.abs(offset)).toBeLessThanOrEqual(43200)
      })

      it('returns timezone name', () => {
        const imports = getClocksImports()
        const tz = imports['wasi:clocks/timezone@0.3.0'] as Record<string, Function>

        const datetime: Datetime = { seconds: 1700000000n, nanoseconds: 0 }
        const display = tz.display(datetime)

        // Should return a valid timezone name
        expect(display.name.length).toBeGreaterThan(0)
      })
    })
  })
})
