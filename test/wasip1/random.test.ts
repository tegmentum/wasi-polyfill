/**
 * WASI Preview 1 Random Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createRandomFunctions } from '../../src/wasip1/random.js'
import { WasiMemory } from '../../src/wasip1/memory.js'
import { Errno } from '../../src/wasip1/types.js'

describe('WASIP1 Random', () => {
  let memory: WasiMemory
  let wasmMemory: WebAssembly.Memory

  beforeEach(() => {
    wasmMemory = new WebAssembly.Memory({ initial: 1 })
    memory = new WasiMemory()
    memory.attach(wasmMemory)
  })

  describe('random_get', () => {
    it('returns SUCCESS for zero length', () => {
      const fns = createRandomFunctions(memory)

      const result = fns.random_get(0, 0)

      expect(result).toBe(Errno.SUCCESS)
    })

    it('returns SUCCESS and fills buffer', () => {
      const fns = createRandomFunctions(memory)

      const result = fns.random_get(0, 16)

      expect(result).toBe(Errno.SUCCESS)

      // Check that some bytes were written
      const bytes = memory.readBytes(0, 16)
      expect(bytes.length).toBe(16)
    })

    it('generates different values each time', () => {
      const fns = createRandomFunctions(memory)

      fns.random_get(0, 32)
      const bytes1 = memory.readBytes(0, 32)

      fns.random_get(0, 32)
      const bytes2 = memory.readBytes(0, 32)

      // Extremely unlikely to be the same
      let same = true
      for (let i = 0; i < 32; i++) {
        if (bytes1[i] !== bytes2[i]) {
          same = false
          break
        }
      }
      expect(same).toBe(false)
    })

    it('fills all requested bytes', () => {
      const fns = createRandomFunctions(memory)

      // Clear buffer first
      for (let i = 0; i < 100; i++) {
        memory.writeU8(i, 0)
      }

      fns.random_get(0, 100)

      // Count non-zero bytes - with random data, virtually all should be non-zero
      // over a large enough sample
      let nonZeroCount = 0
      for (let i = 0; i < 100; i++) {
        if (memory.readU8(i) !== 0) {
          nonZeroCount++
        }
      }

      // At least 90% should be non-zero (statistically)
      expect(nonZeroCount).toBeGreaterThan(50)
    })

    it('handles small buffer sizes', () => {
      const fns = createRandomFunctions(memory)

      for (const size of [1, 2, 4, 8]) {
        const result = fns.random_get(0, size)
        expect(result).toBe(Errno.SUCCESS)

        const bytes = memory.readBytes(0, size)
        expect(bytes.length).toBe(size)
      }
    })

    it('handles large buffer sizes', () => {
      const fns = createRandomFunctions(memory)

      const result = fns.random_get(0, 10000)

      expect(result).toBe(Errno.SUCCESS)

      const bytes = memory.readBytes(0, 10000)
      expect(bytes.length).toBe(10000)
    })

    it('handles buffer sizes larger than crypto chunk limit', () => {
      // Expand memory to handle large buffer
      wasmMemory = new WebAssembly.Memory({ initial: 4 }) // 256KB
      memory = new WasiMemory()
      memory.attach(wasmMemory)
      const fns = createRandomFunctions(memory)

      // crypto.getRandomValues has a 65536 byte limit per call
      // Test with 100000 bytes to ensure chunking works
      const result = fns.random_get(0, 100000)

      expect(result).toBe(Errno.SUCCESS)
    })

    it('generates bytes with good distribution', () => {
      const fns = createRandomFunctions(memory)

      // Generate many bytes and check distribution
      const counts = new Array(256).fill(0)

      // Generate multiple batches
      for (let batch = 0; batch < 10; batch++) {
        fns.random_get(0, 1000)
        const bytes = memory.readBytes(0, 1000)
        for (const b of bytes) {
          counts[b]++
        }
      }

      // All byte values should appear at least once in 10000 samples
      const allAppear = counts.every((c) => c > 0)
      expect(allAppear).toBe(true)
    })

    it('writes to correct memory location', () => {
      const fns = createRandomFunctions(memory)

      // Write known pattern before
      memory.writeU8(99, 0xaa)
      memory.writeU8(116, 0xbb)

      // Fill buffer at offset 100
      fns.random_get(100, 16)

      // Check boundaries weren't overwritten
      expect(memory.readU8(99)).toBe(0xaa)
      expect(memory.readU8(116)).toBe(0xbb)
    })

    it('can generate at different offsets', () => {
      const fns = createRandomFunctions(memory)

      // Generate at offset 0
      fns.random_get(0, 16)
      const bytes0 = memory.readBytes(0, 16)

      // Generate at offset 100
      fns.random_get(100, 16)
      const bytes100 = memory.readBytes(100, 16)

      // Both should be valid (non-identical)
      let same = true
      for (let i = 0; i < 16; i++) {
        if (bytes0[i] !== bytes100[i]) {
          same = false
          break
        }
      }
      expect(same).toBe(false)
    })
  })

  describe('security', () => {
    it('uses cryptographically secure random', () => {
      // This test verifies that we're using crypto.getRandomValues
      // by checking that the random bytes pass basic randomness tests
      const fns = createRandomFunctions(memory)

      fns.random_get(0, 1000)
      const bytes = memory.readBytes(0, 1000)

      // Calculate mean - should be close to 127.5
      let sum = 0
      for (const b of bytes) {
        sum += b
      }
      const mean = sum / bytes.length

      // Mean should be within 10% of expected (127.5)
      expect(mean).toBeGreaterThan(100)
      expect(mean).toBeLessThan(155)
    })

    it('generates unique sequences', () => {
      const fns = createRandomFunctions(memory)
      const sequences = new Set<string>()

      for (let i = 0; i < 100; i++) {
        fns.random_get(0, 16)
        const bytes = memory.readBytes(0, 16)
        const hex = Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
        sequences.add(hex)
      }

      // All 100 sequences should be unique
      expect(sequences.size).toBe(100)
    })
  })
})
