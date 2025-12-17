/**
 * Integration tests for WASM instantiation with polyfill imports
 *
 * These tests verify that the polyfill provides correctly structured
 * imports that can be used with WebAssembly.instantiate.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createDevPolyfill, Polyfill } from '../../src/wasip2/core/polyfill.js'
import { randomPlugin } from '../../src/wasip2/plugins/random/index.js'
import { monotonicClockPlugin, wallClockPlugin } from '../../src/wasip2/plugins/clocks/index.js'
import { environmentPlugin, stdoutPlugin, stderrPlugin } from '../../src/wasip2/plugins/cli/index.js'
import { streamsPlugin, pollPlugin } from '../../src/wasip2/plugins/io/index.js'

describe('WASM Instantiation Integration', () => {
  let polyfill: Polyfill

  beforeEach(() => {
    // Use dev polyfill that allows all interfaces
    polyfill = createDevPolyfill()
  })

  describe('Import Structure', () => {
    it('should provide random imports with correct function signatures', async () => {
      polyfill.registerPlugin(randomPlugin)

      const result = await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
      ])

      // Check the import namespace exists (format: wasi:random@0.2.0 when name=base)
      expect(result.imports['wasi:random@0.2.0']).toBeDefined()

      const randomImports = result.imports['wasi:random@0.2.0']

      // Check functions exist
      expect(typeof randomImports['get-random-bytes']).toBe('function')
      expect(typeof randomImports['get-random-u64']).toBe('function')

      // Call get-random-bytes and verify it returns Uint8Array
      const bytes = (randomImports['get-random-bytes'] as (len: bigint) => Uint8Array)(10n)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBe(10)

      // Call get-random-u64 and verify it returns bigint
      const u64 = (randomImports['get-random-u64'] as () => bigint)()
      expect(typeof u64).toBe('bigint')
    })

    it('should provide clock imports with correct function signatures', async () => {
      polyfill.registerPlugin(monotonicClockPlugin)
      polyfill.registerPlugin(wallClockPlugin)

      const result = await polyfill.getImports([
        { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
        { package: 'wasi:clocks', name: 'wall-clock', version: '0.2.0' },
      ])

      // Check monotonic clock (name != base, so includes name)
      const monotonicImports = result.imports['wasi:clocks/monotonic-clock@0.2.0']
      expect(monotonicImports).toBeDefined()
      expect(typeof monotonicImports['now']).toBe('function')
      expect(typeof monotonicImports['resolution']).toBe('function')

      // Call now() and verify it returns bigint
      const now = (monotonicImports['now'] as () => bigint)()
      expect(typeof now).toBe('bigint')
      expect(now).toBeGreaterThan(0n)

      // Check wall clock
      const wallImports = result.imports['wasi:clocks/wall-clock@0.2.0']
      expect(wallImports).toBeDefined()
      expect(typeof wallImports['now']).toBe('function')
      expect(typeof wallImports['resolution']).toBe('function')

      // Call wall clock now() and verify structure
      const wallNow = (wallImports['now'] as () => { seconds: bigint; nanoseconds: number })()
      expect(wallNow).toHaveProperty('seconds')
      expect(wallNow).toHaveProperty('nanoseconds')
      expect(typeof wallNow.seconds).toBe('bigint')
    })

    it('should provide CLI environment imports', async () => {
      polyfill.registerPlugin(environmentPlugin)

      const result = await polyfill.getImports([
        { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
      ])

      // Format: wasi:cli/environment@0.2.0 (name != base)
      const envImports = result.imports['wasi:cli/environment@0.2.0']
      expect(envImports).toBeDefined()
      expect(typeof envImports['get-environment']).toBe('function')
      expect(typeof envImports['get-arguments']).toBe('function')

      // Check environment returns array
      const env = (envImports['get-environment'] as () => [string, string][])()
      expect(Array.isArray(env)).toBe(true)

      // Check arguments returns array
      const args = (envImports['get-arguments'] as () => string[])()
      expect(Array.isArray(args)).toBe(true)
    })

    it('should provide IO stream imports', async () => {
      polyfill.registerPlugin(streamsPlugin)
      polyfill.registerPlugin(pollPlugin)

      const result = await polyfill.getImports([
        { package: 'wasi:io', name: 'streams', version: '0.2.0' },
        { package: 'wasi:io', name: 'poll', version: '0.2.0' },
      ])

      // Check streams interface (name != base)
      const streamsImports = result.imports['wasi:io/streams@0.2.0']
      expect(streamsImports).toBeDefined()

      // Check for stream resource methods
      expect(streamsImports['[method]input-stream.read']).toBeDefined()
      expect(streamsImports['[method]output-stream.write']).toBeDefined()
      expect(streamsImports['[resource-drop]input-stream']).toBeDefined()
      expect(streamsImports['[resource-drop]output-stream']).toBeDefined()

      // Check poll interface (name != base)
      const pollImports = result.imports['wasi:io/poll@0.2.0']
      expect(pollImports).toBeDefined()
      expect(pollImports['poll']).toBeDefined()
      expect(pollImports['[resource-drop]pollable']).toBeDefined()
    })
  })

  describe('Multiple Interfaces', () => {
    it('should combine imports from multiple interfaces', async () => {
      polyfill.registerPlugin(randomPlugin)
      polyfill.registerPlugin(monotonicClockPlugin)
      polyfill.registerPlugin(environmentPlugin)

      const result = await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
        { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
        { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
      ])

      // All three namespaces should be present
      expect(result.imports['wasi:random@0.2.0']).toBeDefined()
      expect(result.imports['wasi:clocks/monotonic-clock@0.2.0']).toBeDefined()
      expect(result.imports['wasi:cli/environment@0.2.0']).toBeDefined()

      // Each should have their functions
      expect(result.imports['wasi:random@0.2.0']['get-random-bytes']).toBeDefined()
      expect(result.imports['wasi:clocks/monotonic-clock@0.2.0']['now']).toBeDefined()
      expect(result.imports['wasi:cli/environment@0.2.0']['get-environment']).toBeDefined()

      // Track loaded interfaces
      expect(result.loaded.length).toBe(3)
    })
  })

  describe('Functional Verification', () => {
    it('should provide working random bytes', async () => {
      polyfill.registerPlugin(randomPlugin)

      const result = await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
      ])

      const getRandomBytes = result.imports['wasi:random@0.2.0'][
        'get-random-bytes'
      ] as (len: bigint) => Uint8Array

      // Get multiple batches of random bytes
      const batch1 = getRandomBytes(32n)
      const batch2 = getRandomBytes(32n)

      // Both should be Uint8Arrays of correct length
      expect(batch1.length).toBe(32)
      expect(batch2.length).toBe(32)

      // They should be different (statistically very unlikely to be same)
      const same = batch1.every((b: number, i: number) => b === batch2[i])
      expect(same).toBe(false)
    })

    it('should provide monotonically increasing time', async () => {
      polyfill.registerPlugin(monotonicClockPlugin)

      const result = await polyfill.getImports([
        { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
      ])

      const now = result.imports['wasi:clocks/monotonic-clock@0.2.0']['now'] as () => bigint

      const t1 = now()

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10))

      const t2 = now()

      // t2 should be greater than t1
      expect(t2).toBeGreaterThan(t1)
    })

    it('should provide wall clock with reasonable time', async () => {
      polyfill.registerPlugin(wallClockPlugin)

      const result = await polyfill.getImports([
        { package: 'wasi:clocks', name: 'wall-clock', version: '0.2.0' },
      ])

      const now = result.imports['wasi:clocks/wall-clock@0.2.0']['now'] as () => {
        seconds: bigint
        nanoseconds: number
      }

      const datetime = now()

      // Time should be after year 2020 (in seconds since epoch)
      const year2020 = 1577836800n
      // Time should be before year 2100
      const year2100 = 4102444800n

      expect(datetime.seconds).toBeGreaterThan(year2020)
      expect(datetime.seconds).toBeLessThan(year2100)
    })
  })

  describe('Error Handling', () => {
    it('should handle empty interface list', async () => {
      const result = await polyfill.getImports([])

      expect(result.imports).toEqual({})
      expect(result.loaded.length).toBe(0)
      expect(result.missing.length).toBe(0)
      expect(result.denied.length).toBe(0)
    })
  })

  describe('Resource Cleanup', () => {
    it('should allow polyfill destruction', async () => {
      polyfill.registerPlugin(randomPlugin)
      polyfill.registerPlugin(monotonicClockPlugin)

      // Use the polyfill
      const result = await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
      ])

      expect(result.imports['wasi:random@0.2.0']).toBeDefined()

      // Destroy should not throw
      expect(() => polyfill.destroy()).not.toThrow()

      // After destruction, getImports should throw
      await expect(
        polyfill.getImports([{ package: 'wasi:random', name: 'random', version: '0.2.0' }])
      ).rejects.toThrow('destroyed')
    })

    it('should allow multiple destroy calls', () => {
      polyfill.destroy()
      expect(() => polyfill.destroy()).not.toThrow()
    })
  })

  describe('Policy Integration', () => {
    it('should use isAllowed check', () => {
      expect(polyfill.isAllowed({ package: 'wasi:random', name: 'random', version: '0.2.0' })).toBe(
        true
      )

      // Also works with string format
      expect(polyfill.isAllowed('wasi:random@0.2.0')).toBe(true)
    })

    it('should use hasPlugin check', () => {
      polyfill.registerPlugin(randomPlugin)

      expect(
        polyfill.hasPlugin({ package: 'wasi:random', name: 'random', version: '0.2.0' })
      ).toBe(true)

      expect(
        polyfill.hasPlugin({ package: 'wasi:unknown', name: 'unknown', version: '0.2.0' })
      ).toBe(false)

      // Also works with string format
      expect(polyfill.hasPlugin('wasi:random@0.2.0')).toBe(true)
    })
  })

  describe('Interface String Parsing', () => {
    it('should accept string interface specifications via forInterfaces', async () => {
      polyfill.registerPlugin(randomPlugin)
      polyfill.registerPlugin(monotonicClockPlugin)

      const result = await polyfill.forInterfaces([
        'wasi:random@0.2.0',
        'wasi:clocks/monotonic-clock@0.2.0',
      ])

      expect(result.imports['wasi:random@0.2.0']).toBeDefined()
      expect(result.imports['wasi:clocks/monotonic-clock@0.2.0']).toBeDefined()
    })
  })
})
