/**
 * WASI Random 0.3.0 Interface Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getRandomBytes,
  getRandomU64,
  getInsecureRandomBytes,
  getInsecureRandomU64,
  setInsecureSeed,
  getSeededU64,
  getRandomImports,
} from '../../src/wasip3/interfaces/random.js'

describe('WASIP3 Random Interface', () => {
  describe('getRandomBytes', () => {
    it('returns Uint8Array of requested length', () => {
      const bytes = getRandomBytes(16n)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBe(16)
    })

    it('returns empty array for zero length', () => {
      const bytes = getRandomBytes(0n)
      expect(bytes.length).toBe(0)
    })

    it('returns different values on each call', () => {
      const bytes1 = getRandomBytes(32n)
      const bytes2 = getRandomBytes(32n)

      // Extremely unlikely to be the same
      let same = true
      for (let i = 0; i < bytes1.length; i++) {
        if (bytes1[i] !== bytes2[i]) {
          same = false
          break
        }
      }
      expect(same).toBe(false)
    })

    it('fills all bytes', () => {
      // Generate many times and check distribution
      const counts = new Array(256).fill(0)
      for (let i = 0; i < 100; i++) {
        const bytes = getRandomBytes(256n)
        for (const b of bytes) {
          counts[b]++
        }
      }

      // All byte values should appear at least once in 25600 samples
      const allAppear = counts.every((c) => c > 0)
      expect(allAppear).toBe(true)
    })

    it('handles large requests', () => {
      const bytes = getRandomBytes(10000n)
      expect(bytes.length).toBe(10000)
    })
  })

  describe('getRandomU64', () => {
    it('returns a bigint', () => {
      const value = getRandomU64()
      expect(typeof value).toBe('bigint')
    })

    it('returns non-negative value', () => {
      for (let i = 0; i < 100; i++) {
        const value = getRandomU64()
        expect(value).toBeGreaterThanOrEqual(0n)
      }
    })

    it('returns values in u64 range', () => {
      for (let i = 0; i < 100; i++) {
        const value = getRandomU64()
        expect(value).toBeLessThanOrEqual(0xffffffffffffffffn)
      }
    })

    it('returns different values on each call', () => {
      const values = new Set<bigint>()
      for (let i = 0; i < 100; i++) {
        values.add(getRandomU64())
      }
      // Should have at least 99 unique values (collision is extremely unlikely)
      expect(values.size).toBeGreaterThanOrEqual(99)
    })

    it('generates values across full range', () => {
      let hasHigh = false
      let hasLow = false

      for (let i = 0; i < 1000; i++) {
        const value = getRandomU64()
        if (value > 0x8000000000000000n) hasHigh = true
        if (value < 0x8000000000000000n) hasLow = true
        if (hasHigh && hasLow) break
      }

      expect(hasHigh).toBe(true)
      expect(hasLow).toBe(true)
    })
  })

  describe('getInsecureRandomBytes', () => {
    it('returns Uint8Array of requested length', () => {
      const bytes = getInsecureRandomBytes(16n)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBe(16)
    })

    it('returns empty array for zero length', () => {
      const bytes = getInsecureRandomBytes(0n)
      expect(bytes.length).toBe(0)
    })

    it('returns different values on each call', () => {
      const bytes1 = getInsecureRandomBytes(32n)
      const bytes2 = getInsecureRandomBytes(32n)

      let same = true
      for (let i = 0; i < bytes1.length; i++) {
        if (bytes1[i] !== bytes2[i]) {
          same = false
          break
        }
      }
      expect(same).toBe(false)
    })

    it('handles large requests', () => {
      const bytes = getInsecureRandomBytes(10000n)
      expect(bytes.length).toBe(10000)
    })
  })

  describe('getInsecureRandomU64', () => {
    it('returns a bigint', () => {
      const value = getInsecureRandomU64()
      expect(typeof value).toBe('bigint')
    })

    it('returns non-negative value', () => {
      for (let i = 0; i < 100; i++) {
        const value = getInsecureRandomU64()
        expect(value).toBeGreaterThanOrEqual(0n)
      }
    })

    it('returns values in u64 range', () => {
      for (let i = 0; i < 100; i++) {
        const value = getInsecureRandomU64()
        expect(value).toBeLessThanOrEqual(0xffffffffffffffffn)
      }
    })

    it('returns different values on each call', () => {
      const values = new Set<bigint>()
      for (let i = 0; i < 100; i++) {
        values.add(getInsecureRandomU64())
      }
      expect(values.size).toBeGreaterThanOrEqual(95)
    })
  })

  describe('setInsecureSeed / getSeededU64', () => {
    beforeEach(() => {
      // Reset to known state
      setInsecureSeed([12345n, 67890n])
    })

    it('produces deterministic output for same seed', () => {
      setInsecureSeed([42n, 123n])
      const values1: bigint[] = []
      for (let i = 0; i < 10; i++) {
        values1.push(getSeededU64())
      }

      setInsecureSeed([42n, 123n])
      const values2: bigint[] = []
      for (let i = 0; i < 10; i++) {
        values2.push(getSeededU64())
      }

      expect(values1).toEqual(values2)
    })

    it('produces different output for different seeds', () => {
      setInsecureSeed([1n, 2n])
      const value1 = getSeededU64()

      setInsecureSeed([3n, 4n])
      const value2 = getSeededU64()

      expect(value1).not.toBe(value2)
    })

    it('returns bigint', () => {
      const value = getSeededU64()
      expect(typeof value).toBe('bigint')
    })

    it('returns values in u64 range', () => {
      for (let i = 0; i < 100; i++) {
        const value = getSeededU64()
        expect(value).toBeGreaterThanOrEqual(0n)
        expect(value).toBeLessThanOrEqual(0xffffffffffffffffn)
      }
    })

    it('produces varied sequence', () => {
      // Use a seed that produces varied output (avoid seeds that XOR to 0)
      setInsecureSeed([12345n, 67890n])
      const values = new Set<bigint>()
      for (let i = 0; i < 100; i++) {
        values.add(getSeededU64())
      }
      // Should have many unique values
      expect(values.size).toBeGreaterThanOrEqual(90)
    })
  })

  describe('getRandomImports', () => {
    it('returns import object with random', () => {
      const imports = getRandomImports()
      expect(imports).toHaveProperty('wasi:random/random@0.3.0')
    })

    it('returns import object with insecure', () => {
      const imports = getRandomImports()
      expect(imports).toHaveProperty('wasi:random/insecure@0.3.0')
    })

    it('returns import object with insecure-seed', () => {
      const imports = getRandomImports()
      expect(imports).toHaveProperty('wasi:random/insecure-seed@0.3.0')
    })

    describe('random imports', () => {
      it('provides get-random-bytes', () => {
        const imports = getRandomImports()
        const random = imports['wasi:random/random@0.3.0'] as Record<string, Function>

        const bytes = random['get-random-bytes'](16n)
        expect(bytes).toBeInstanceOf(Uint8Array)
        expect(bytes.length).toBe(16)
      })

      it('provides get-random-u64', () => {
        const imports = getRandomImports()
        const random = imports['wasi:random/random@0.3.0'] as Record<string, Function>

        const value = random['get-random-u64']()
        expect(typeof value).toBe('bigint')
      })
    })

    describe('insecure imports', () => {
      it('provides get-insecure-random-bytes', () => {
        const imports = getRandomImports()
        const insecure = imports['wasi:random/insecure@0.3.0'] as Record<string, Function>

        const bytes = insecure['get-insecure-random-bytes'](16n)
        expect(bytes).toBeInstanceOf(Uint8Array)
        expect(bytes.length).toBe(16)
      })

      it('provides get-insecure-random-u64', () => {
        const imports = getRandomImports()
        const insecure = imports['wasi:random/insecure@0.3.0'] as Record<string, Function>

        const value = insecure['get-insecure-random-u64']()
        expect(typeof value).toBe('bigint')
      })
    })

    describe('insecure-seed imports', () => {
      it('provides insecure-seed', () => {
        const imports = getRandomImports()
        const seed = imports['wasi:random/insecure-seed@0.3.0'] as Record<string, Function>

        const [a, b] = seed['insecure-seed']()
        expect(typeof a).toBe('bigint')
        expect(typeof b).toBe('bigint')
      })

      it('returns different seeds on each call', () => {
        const imports = getRandomImports()
        const seed = imports['wasi:random/insecure-seed@0.3.0'] as Record<string, Function>

        const [a1, b1] = seed['insecure-seed']()
        const [a2, b2] = seed['insecure-seed']()

        // At least one value should be different
        expect(a1 !== a2 || b1 !== b2).toBe(true)
      })
    })
  })
})
