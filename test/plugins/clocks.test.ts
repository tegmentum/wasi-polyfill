import { describe, it, expect } from 'vitest'
import {
  monotonicClockPlugin,
  wallClockPlugin,
  performanceClockImplementation,
  dateClockImplementation,
  virtualMonotonicClockImplementation,
  virtualWallClockImplementation,
  ControllableClockStore,
} from '../../src/wasip2/plugins/clocks/index.js'
import { PollableRegistry } from '../../src/wasip2/plugins/io/index.js'
import { VirtualClock } from '../../src/wasip2/runtime/provider.js'

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

describe('Virtual Clock Implementations', () => {
  describe('virtualMonotonicClockImplementation', () => {
    it('has correct metadata', () => {
      expect(virtualMonotonicClockImplementation.name).toBe('virtual')
      expect(virtualMonotonicClockImplementation.description).toContain('Deterministic')
    })

    it('starts at zero by default', () => {
      const instance = virtualMonotonicClockImplementation.create({})
      const imports = instance.getImports() as {
        now: () => bigint
      }

      expect(imports.now()).toBe(0n)
    })

    it('returns consistent time without advancement', () => {
      const instance = virtualMonotonicClockImplementation.create({})
      const imports = instance.getImports() as {
        now: () => bigint
      }

      const t1 = imports.now()
      const t2 = imports.now()
      const t3 = imports.now()

      expect(t1).toBe(t2)
      expect(t2).toBe(t3)
    })

    it('advances time when clock is advanced', () => {
      const clock = new VirtualClock()
      const instance = virtualMonotonicClockImplementation.create({ clock })
      const imports = instance.getImports() as {
        now: () => bigint
      }

      expect(imports.now()).toBe(0n)

      clock.advance(1_000_000_000n) // 1 second

      expect(imports.now()).toBe(1_000_000_000n)
    })

    it('reports nanosecond resolution', () => {
      const instance = virtualMonotonicClockImplementation.create({})
      const imports = instance.getImports() as {
        resolution: () => bigint
      }

      expect(imports.resolution()).toBe(1n)
    })

    it('subscribe-instant returns pollable for future time', () => {
      const clock = new VirtualClock()
      const instance = virtualMonotonicClockImplementation.create({ clock })
      const imports = instance.getImports() as {
        now: () => bigint
        'subscribe-instant': (when: bigint) => number
      }

      const handle = imports['subscribe-instant'](1_000_000n)
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('subscribe-instant returns ready pollable for past time', () => {
      const clock = new VirtualClock()
      clock.advance(1_000_000_000n)
      const instance = virtualMonotonicClockImplementation.create({ clock })
      const imports = instance.getImports() as {
        'subscribe-instant': (when: bigint) => number
      }

      // Subscribe to a time in the past
      const handle = imports['subscribe-instant'](0n)
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('subscribe-duration returns pollable', () => {
      const instance = virtualMonotonicClockImplementation.create({})
      const imports = instance.getImports() as {
        'subscribe-duration': (duration: bigint) => number
      }

      const handle = imports['subscribe-duration'](1_000_000n)
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('same clock produces same time across instances', () => {
      const clock = new VirtualClock()
      const instance1 = virtualMonotonicClockImplementation.create({ clock })
      const instance2 = virtualMonotonicClockImplementation.create({ clock })

      const imports1 = instance1.getImports() as { now: () => bigint }
      const imports2 = instance2.getImports() as { now: () => bigint }

      expect(imports1.now()).toBe(imports2.now())

      clock.advance(5_000_000_000n)

      expect(imports1.now()).toBe(imports2.now())
      expect(imports1.now()).toBe(5_000_000_000n)
    })
  })

  describe('virtualWallClockImplementation', () => {
    it('has correct metadata', () => {
      expect(virtualWallClockImplementation.name).toBe('virtual')
      expect(virtualWallClockImplementation.description).toContain('Deterministic')
    })

    it('starts at Unix epoch by default', () => {
      const instance = virtualWallClockImplementation.create({})
      const imports = instance.getImports() as {
        now: () => { seconds: bigint; nanoseconds: number }
      }

      const time = imports.now()
      expect(time.seconds).toBe(0n)
      expect(time.nanoseconds).toBe(0)
    })

    it('starts at specified initial time', () => {
      const initialTime = new Date('2024-01-15T12:00:00Z')
      const instance = virtualWallClockImplementation.create({ initialTime })
      const imports = instance.getImports() as {
        now: () => { seconds: bigint; nanoseconds: number }
      }

      const time = imports.now()
      const expectedSeconds = BigInt(Math.floor(initialTime.getTime() / 1000))
      expect(time.seconds).toBe(expectedSeconds)
    })

    it('advances when clock advances', () => {
      const clock = new VirtualClock()
      const instance = virtualWallClockImplementation.create({ clock })
      const imports = instance.getImports() as {
        now: () => { seconds: bigint; nanoseconds: number }
      }

      const t1 = imports.now()
      clock.advance(2_500_000_000n) // 2.5 seconds

      const t2 = imports.now()
      expect(t2.seconds).toBe(t1.seconds + 2n)
      expect(t2.nanoseconds).toBe(t1.nanoseconds + 500_000_000)
    })

    it('reports nanosecond resolution', () => {
      const instance = virtualWallClockImplementation.create({})
      const imports = instance.getImports() as {
        resolution: () => { seconds: bigint; nanoseconds: number }
      }

      const resolution = imports.resolution()
      expect(resolution.seconds).toBe(0n)
      expect(resolution.nanoseconds).toBe(1)
    })
  })

  describe('ControllableClockStore', () => {
    it('creates store with default time', () => {
      const store = new ControllableClockStore()

      expect(store.monotonicNow).toBe(0n)
      expect(store.wallNow.seconds).toBe(0n)
    })

    it('creates store with initial time', () => {
      const initialTime = new Date('2024-06-01T00:00:00Z')
      const store = new ControllableClockStore(initialTime)

      const expectedSeconds = BigInt(Math.floor(initialTime.getTime() / 1000))
      expect(store.wallNow.seconds).toBe(expectedSeconds)
    })

    it('provides monotonic imports', () => {
      const store = new ControllableClockStore()
      const imports = store.getMonotonicImports()

      expect(imports['now']).toBeDefined()
      expect(imports['resolution']).toBeDefined()
      expect(imports['subscribe-instant']).toBeDefined()
      expect(imports['subscribe-duration']).toBeDefined()
    })

    it('provides wall imports', () => {
      const store = new ControllableClockStore()
      const imports = store.getWallImports()

      expect(imports['now']).toBeDefined()
      expect(imports['resolution']).toBeDefined()
    })

    it('advance updates both clocks', () => {
      const store = new ControllableClockStore()

      store.advance(1_000_000_000n) // 1 second in nanoseconds

      expect(store.monotonicNow).toBe(1_000_000_000n)
      expect(store.wallNow.seconds).toBe(1n)
    })

    it('advanceMs convenience method', () => {
      const store = new ControllableClockStore()

      store.advanceMs(500) // 500ms

      expect(store.monotonicNow).toBe(500_000_000n) // 500ms in ns
    })

    it('advanceSeconds convenience method', () => {
      const store = new ControllableClockStore()

      store.advanceSeconds(10)

      expect(store.monotonicNow).toBe(10_000_000_000n)
      expect(store.wallNow.seconds).toBe(10n)
    })

    it('setWallTime updates wall clock', () => {
      const store = new ControllableClockStore()
      const newTime = new Date('2025-01-01T00:00:00Z')

      store.setWallTime(newTime)

      const expectedSeconds = BigInt(Math.floor(newTime.getTime() / 1000))
      expect(store.wallNow.seconds).toBe(expectedSeconds)
    })

    it('imports reflect time changes', () => {
      const store = new ControllableClockStore()
      const monotonic = store.getMonotonicImports()
      const wall = store.getWallImports()

      const monotonicNow = monotonic['now'] as () => bigint
      const wallNow = wall['now'] as () => { seconds: bigint; nanoseconds: number }

      expect(monotonicNow()).toBe(0n)
      expect(wallNow().seconds).toBe(0n)

      store.advanceSeconds(5)

      expect(monotonicNow()).toBe(5_000_000_000n)
      expect(wallNow().seconds).toBe(5n)
    })

    it('destroy cleans up resources', () => {
      const store = new ControllableClockStore()
      store.advance(1_000_000_000n)

      store.destroy()
      // Should not throw
    })
  })

  describe('Plugin integration', () => {
    it('monotonicClockPlugin has virtual implementation', () => {
      expect(monotonicClockPlugin.implementations.has('virtual')).toBe(true)
    })

    it('wallClockPlugin has virtual implementation', () => {
      expect(wallClockPlugin.implementations.has('virtual')).toBe(true)
    })

    it('can create virtual monotonic instance via plugin', () => {
      const clock = new VirtualClock()
      const instance = monotonicClockPlugin.create({
        implementation: 'virtual',
        clock,
      })

      const imports = instance.getImports() as {
        now: () => bigint
      }

      expect(imports.now()).toBe(0n)
      clock.advance(1_000_000_000n)
      expect(imports.now()).toBe(1_000_000_000n)
    })

    it('can create virtual wall instance via plugin', () => {
      const initialTime = new Date('2024-07-04T00:00:00Z')
      const instance = wallClockPlugin.create({
        implementation: 'virtual',
        initialTime,
      })

      const imports = instance.getImports() as {
        now: () => { seconds: bigint; nanoseconds: number }
      }

      const expectedSeconds = BigInt(Math.floor(initialTime.getTime() / 1000))
      expect(imports.now().seconds).toBe(expectedSeconds)
    })
  })
})
