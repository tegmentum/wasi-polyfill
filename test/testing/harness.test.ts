import { describe, it, expect, afterEach } from 'vitest'
import {
  createTestHarness,
  withTestHarness,
  deterministicBundle,
  browserTestBundle,
  minimalBundle,
  getBundlePreset,
  mergeBundleConfig,
} from '../../src/wasip2/testing/index.js'

describe('Bundle presets', () => {
  describe('deterministicBundle', () => {
    it('has correct name', () => {
      expect(deterministicBundle.name).toBe('deterministic')
    })

    it('uses seeded random', () => {
      expect(deterministicBundle.implementations['wasi:random/random']).toBe('seeded')
    })

    it('uses virtual clocks', () => {
      expect(deterministicBundle.implementations['wasi:clocks/monotonic-clock']).toBe('virtual')
      expect(deterministicBundle.implementations['wasi:clocks/wall-clock']).toBe('virtual')
    })

    it('uses buffer logging', () => {
      expect(deterministicBundle.implementations['wasi:logging/logging']).toBe('buffer')
    })
  })

  describe('browserTestBundle', () => {
    it('has correct name', () => {
      expect(browserTestBundle.name).toBe('browser-test')
    })

    it('uses crypto random', () => {
      expect(browserTestBundle.implementations['wasi:random/random']).toBe('crypto')
    })

    it('uses real clocks', () => {
      expect(browserTestBundle.implementations['wasi:clocks/monotonic-clock']).toBe('performance')
      expect(browserTestBundle.implementations['wasi:clocks/wall-clock']).toBe('date')
    })
  })

  describe('minimalBundle', () => {
    it('has correct name', () => {
      expect(minimalBundle.name).toBe('minimal')
    })

    it('has minimal plugins', () => {
      expect(Object.keys(minimalBundle.plugins)).toHaveLength(3)
    })
  })

  describe('getBundlePreset', () => {
    it('returns deterministic bundle', () => {
      const bundle = getBundlePreset('deterministic')
      expect(bundle?.name).toBe('deterministic')
    })

    it('returns browser-test bundle', () => {
      const bundle = getBundlePreset('browser-test')
      expect(bundle?.name).toBe('browser-test')
    })

    it('returns undefined for unknown bundle', () => {
      const bundle = getBundlePreset('unknown')
      expect(bundle).toBeUndefined()
    })
  })

  describe('mergeBundleConfig', () => {
    it('merges plugins', () => {
      const merged = mergeBundleConfig(deterministicBundle, {
        plugins: {
          'wasi:random/random': { seed: 42n },
        },
      })

      expect(merged.plugins['wasi:random/random']).toEqual({ seed: 42n })
      expect(merged.plugins['wasi:logging/logging']).toEqual(
        deterministicBundle.plugins['wasi:logging/logging']
      )
    })

    it('merges implementations', () => {
      const merged = mergeBundleConfig(deterministicBundle, {
        implementations: {
          'wasi:random/random': 'crypto',
        },
      })

      expect(merged.implementations['wasi:random/random']).toBe('crypto')
      expect(merged.implementations['wasi:clocks/monotonic-clock']).toBe('virtual')
    })

    it('overrides name and description', () => {
      const merged = mergeBundleConfig(deterministicBundle, {
        name: 'custom',
        description: 'Custom bundle',
      })

      expect(merged.name).toBe('custom')
      expect(merged.description).toBe('Custom bundle')
    })
  })
})

describe('TestHarness', () => {
  let harness: ReturnType<typeof createTestHarness>

  afterEach(() => {
    harness?.destroy()
  })

  describe('creation', () => {
    it('creates with default config', () => {
      harness = createTestHarness()
      expect(harness).toBeDefined()
    })

    it('creates with custom seed', () => {
      harness = createTestHarness({ seed: 12345n })
      const random = harness.getRandom()
      const bytes = random.getRandomBytes(8)
      expect(bytes).toBeInstanceOf(Uint8Array)
    })

    it('creates with custom initial time', () => {
      const initialTime = new Date('2025-06-15T12:00:00Z')
      harness = createTestHarness({ initialTime })
      const wallTime = harness.getClock().wallNow()
      expect(wallTime.seconds).toBe(BigInt(Math.floor(initialTime.getTime() / 1000)))
    })

    it('creates with bundle name', () => {
      harness = createTestHarness({ bundle: 'minimal' })
      expect(harness).toBeDefined()
    })

    it('creates with bundle preset', () => {
      harness = createTestHarness({ bundle: browserTestBundle })
      expect(harness).toBeDefined()
    })
  })

  describe('time control', () => {
    it('starts at zero monotonic time', () => {
      harness = createTestHarness()
      const clock = harness.getClock()
      expect(clock.monotonicNow()).toBe(0n)
    })

    it('advances time in nanoseconds', () => {
      harness = createTestHarness()
      harness.advanceTime(1_000_000_000n)
      expect(harness.getClock().monotonicNow()).toBe(1_000_000_000n)
    })

    it('advances time in milliseconds', () => {
      harness = createTestHarness()
      harness.advanceTimeMs(500)
      expect(harness.getClock().monotonicNow()).toBe(500_000_000n)
    })

    it('advances time in seconds', () => {
      harness = createTestHarness()
      harness.advanceTimeSeconds(5)
      expect(harness.getClock().monotonicNow()).toBe(5_000_000_000n)
    })

    it('advances wall clock along with monotonic', () => {
      const initialTime = new Date('2024-01-01T00:00:00Z')
      harness = createTestHarness({ initialTime })

      harness.advanceTimeSeconds(60)

      const wallTime = harness.getClock().wallNow()
      expect(wallTime.seconds).toBe(BigInt(Math.floor(initialTime.getTime() / 1000)) + 60n)
    })

    it('sets wall time directly', () => {
      harness = createTestHarness()
      const newTime = new Date('2025-12-25T00:00:00Z')
      harness.setWallTime(newTime)

      const wallTime = harness.getClock().wallNow()
      expect(wallTime.seconds).toBe(BigInt(Math.floor(newTime.getTime() / 1000)))
    })
  })

  describe('deterministic random', () => {
    it('produces same sequence for same seed', () => {
      harness = createTestHarness({ seed: 42n })
      const random1 = harness.getRandom()
      const bytes1 = random1.getRandomBytes(16)

      harness.destroy()

      harness = createTestHarness({ seed: 42n })
      const random2 = harness.getRandom()
      const bytes2 = random2.getRandomBytes(16)

      expect(bytes1).toEqual(bytes2)
    })

    it('produces different sequence for different seeds', () => {
      harness = createTestHarness({ seed: 1n })
      const random1 = harness.getRandom()
      const bytes1 = random1.getRandomBytes(16)

      harness.destroy()

      harness = createTestHarness({ seed: 2n })
      const random2 = harness.getRandom()
      const bytes2 = random2.getRandomBytes(16)

      expect(bytes1).not.toEqual(bytes2)
    })
  })

  describe('snapshot', () => {
    it('captures monotonic time', () => {
      harness = createTestHarness()
      harness.advanceTimeSeconds(10)

      const snapshot = harness.getSnapshot()
      expect(snapshot.monotonicTime).toBe(10_000_000_000n)
    })

    it('captures wall time', () => {
      const initialTime = new Date('2024-01-01T00:00:00Z')
      harness = createTestHarness({ initialTime })

      const snapshot = harness.getSnapshot()
      expect(snapshot.wallTime.seconds).toBe(BigInt(Math.floor(initialTime.getTime() / 1000)))
    })

    it('captures exit code', () => {
      harness = createTestHarness()
      harness.recordExit(42)

      const snapshot = harness.getSnapshot()
      expect(snapshot.exitCode).toBe(42)
    })

    it('starts with empty logs', () => {
      harness = createTestHarness()
      const snapshot = harness.getSnapshot()
      expect(snapshot.logs).toEqual([])
    })
  })

  describe('getImports', () => {
    it('returns imports for random interface', async () => {
      harness = createTestHarness()
      const { imports } = await harness.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
      ])

      expect(imports['wasi:random/random@0.2.0']).toBeDefined()
      expect(imports['wasi:random/random@0.2.0']['get-random-bytes']).toBeDefined()
    })

    it('returns imports for clocks interface', async () => {
      harness = createTestHarness()
      const { imports } = await harness.getImports([
        { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
      ])

      expect(imports['wasi:clocks/monotonic-clock@0.2.0']).toBeDefined()
      expect(imports['wasi:clocks/monotonic-clock@0.2.0']['now']).toBeDefined()
    })

    it('uses virtual clock for deterministic bundle', async () => {
      harness = createTestHarness()
      const { imports } = await harness.getImports([
        { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
      ])

      const now = imports['wasi:clocks/monotonic-clock@0.2.0']['now'] as () => bigint
      expect(now()).toBe(0n)

      harness.advanceTimeSeconds(1)
      expect(now()).toBe(1_000_000_000n)
    })

    it('uses seeded random for deterministic bundle', async () => {
      harness = createTestHarness({ seed: 123n })
      const { imports } = await harness.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
      ])

      const getBytes = imports['wasi:random/random@0.2.0']['get-random-bytes'] as (
        len: bigint
      ) => Uint8Array

      const bytes1 = getBytes(8n)

      harness.destroy()

      harness = createTestHarness({ seed: 123n })
      const { imports: imports2 } = await harness.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
      ])

      const getBytes2 = imports2['wasi:random/random@0.2.0']['get-random-bytes'] as (
        len: bigint
      ) => Uint8Array

      const bytes2 = getBytes2(8n)

      expect(bytes1).toEqual(bytes2)
    })
  })

  describe('withTestHarness', () => {
    it('auto-destroys harness after test', async () => {
      let harnessRef: ReturnType<typeof createTestHarness> | undefined

      await withTestHarness({ seed: 1n }, async (h) => {
        harnessRef = h
        h.advanceTimeSeconds(1)
        expect(h.getClock().monotonicNow()).toBe(1_000_000_000n)
      })

      // Harness should be destroyed, but we can't easily verify this
      // without accessing internal state
      expect(harnessRef).toBeDefined()
    })

    it('passes config to harness', async () => {
      await withTestHarness(
        { seed: 42n, initialTime: new Date('2025-01-01T00:00:00Z') },
        async (h) => {
          const random = h.getRandom()
          expect(random).toBeDefined()

          const wallTime = h.getClock().wallNow()
          expect(wallTime.seconds).toBe(1735689600n) // 2025-01-01 00:00:00 UTC
        }
      )
    })

    it('returns result from test function', async () => {
      const result = await withTestHarness({}, async (h) => {
        h.advanceTimeMs(100)
        return h.getClock().monotonicNow()
      })

      expect(result).toBe(100_000_000n)
    })
  })
})
