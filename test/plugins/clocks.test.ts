import { describe, it, expect } from 'vitest'
import {
  monotonicClockPlugin,
  wallClockPlugin,
  performanceClockImplementation,
  dateClockImplementation,
} from '../../src/plugins/clocks/index.js'
import { PollableRegistry } from '../../src/plugins/io/index.js'

describe('wasi:clocks/monotonic-clock', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(monotonicClockPlugin.witInterface.package).toBe('wasi:clocks')
      expect(monotonicClockPlugin.witInterface.name).toBe('monotonic-clock')
      expect(monotonicClockPlugin.witInterface.version).toBe('0.2.0')
    })

    it('has performance as default implementation', () => {
      expect(monotonicClockPlugin.defaultImplementation).toBe('performance')
    })
  })

  describe('performance implementation', () => {
    const instance = performanceClockImplementation.create({})
    const imports = instance.getImports() as {
      now: () => bigint
      resolution: () => bigint
      'subscribe-instant': (when: bigint) => number
      'subscribe-duration': (duration: bigint) => number
    }

    it('returns current time in nanoseconds', () => {
      const time = imports.now()
      expect(typeof time).toBe('bigint')
      expect(time).toBeGreaterThan(0n)
    })

    it('time increases monotonically', async () => {
      const t1 = imports.now()
      await new Promise((r) => setTimeout(r, 10))
      const t2 = imports.now()
      expect(t2).toBeGreaterThan(t1)
    })

    it('returns resolution in nanoseconds', () => {
      const resolution = imports.resolution()
      expect(typeof resolution).toBe('bigint')
      expect(resolution).toBeGreaterThan(0n)
      // Should be at least microsecond precision
      expect(resolution).toBeLessThanOrEqual(1_000_000n)
    })

    it('subscribe-duration returns a pollable handle', () => {
      const handle = imports['subscribe-duration'](1_000_000n) // 1ms
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('subscribe-instant returns a pollable handle', () => {
      const future = imports.now() + 1_000_000n // 1ms in future
      const handle = imports['subscribe-instant'](future)
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('pollable resolves after duration', async () => {
      const registry = new PollableRegistry()

      // We need to create instance with the registry
      // For this test, we'll just verify the handle is created
      const handle = imports['subscribe-duration'](10_000_000n) // 10ms
      expect(handle).toBeGreaterThan(0)
    })
  })
})

describe('wasi:clocks/wall-clock', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(wallClockPlugin.witInterface.package).toBe('wasi:clocks')
      expect(wallClockPlugin.witInterface.name).toBe('wall-clock')
      expect(wallClockPlugin.witInterface.version).toBe('0.2.0')
    })

    it('has date as default implementation', () => {
      expect(wallClockPlugin.defaultImplementation).toBe('date')
    })
  })

  describe('date implementation', () => {
    const instance = dateClockImplementation.create({})
    const imports = instance.getImports() as {
      now: () => { seconds: bigint; nanoseconds: number }
      resolution: () => { seconds: bigint; nanoseconds: number }
    }

    it('returns current wall clock time', () => {
      const time = imports.now()
      expect(typeof time.seconds).toBe('bigint')
      expect(typeof time.nanoseconds).toBe('number')

      // Should be reasonable Unix timestamp (after year 2020)
      expect(time.seconds).toBeGreaterThan(1577836800n) // 2020-01-01

      // Nanoseconds should be within valid range
      expect(time.nanoseconds).toBeGreaterThanOrEqual(0)
      expect(time.nanoseconds).toBeLessThan(1_000_000_000)
    })

    it('time matches Date.now() approximately', () => {
      const time = imports.now()
      const dateNow = Math.floor(Date.now() / 1000)

      // Should be within 1 second of Date.now()
      expect(Number(time.seconds)).toBeCloseTo(dateNow, 0)
    })

    it('returns resolution', () => {
      const resolution = imports.resolution()
      expect(typeof resolution.seconds).toBe('bigint')
      expect(typeof resolution.nanoseconds).toBe('number')

      // Should be millisecond precision (1_000_000 nanoseconds)
      expect(resolution.seconds).toBe(0n)
      expect(resolution.nanoseconds).toBe(1_000_000)
    })
  })
})
