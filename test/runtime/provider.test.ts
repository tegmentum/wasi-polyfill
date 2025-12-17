/**
 * Tests for the provider system
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  BaseProvider,
  VirtualClock,
  SeededRandom,
  noopLogger,
  createConsoleLogger,
  realClock,
  cryptoRandomSource,
  noopMetrics,
  noopTracer,
  type ProviderContext,
  type Capabilities,
  type Provider,
} from '../../src/wasip2/runtime/provider.js'
import type { WasiInterface } from '../../src/wasip2/core/types.js'
import { AllowAllPolicy } from '../../src/wasip2/core/policy.js'

// Create a mock provider context for testing
function createMockContext(): ProviderContext {
  return {
    policy: new AllowAllPolicy(),
    logger: noopLogger,
    clock: realClock,
    random: cryptoRandomSource,
    httpClient: { fetch: globalThis.fetch },
    env: { env: {}, args: [] },
    metrics: noopMetrics,
    tracer: noopTracer,
    devMode: true,
    child: (name: string) => createMockContext(),
  }
}

describe('Provider Base Types', () => {
  describe('BaseProvider', () => {
    class TestProvider extends BaseProvider {
      readonly id = 'test.provider'
      readonly witInterface: WasiInterface = {
        package: 'test:test',
        name: 'test',
        version: '0.1.0',
      }

      private initialized = false

      capabilities(): Capabilities {
        return { streaming: true, async: true }
      }

      getImports(): Record<string, unknown> {
        return {
          testMethod: () => 'test result',
        }
      }

      protected async onInit(): Promise<void> {
        this.initialized = true
      }

      protected async onClose(): Promise<void> {
        this.initialized = false
      }

      isInitialized(): boolean {
        return this.initialized
      }
    }

    it('should start in created state', () => {
      const provider = new TestProvider()
      expect(provider.state).toBe('created')
    })

    it('should transition to ready state after init', async () => {
      const provider = new TestProvider()
      const ctx = createMockContext()

      await provider.init(ctx)

      expect(provider.state).toBe('ready')
      expect(provider.isInitialized()).toBe(true)
    })

    it('should transition to closed state after close', async () => {
      const provider = new TestProvider()
      const ctx = createMockContext()

      await provider.init(ctx)
      await provider.close()

      expect(provider.state).toBe('closed')
      expect(provider.isInitialized()).toBe(false)
    })

    it('should throw when initializing twice', async () => {
      const provider = new TestProvider()
      const ctx = createMockContext()

      await provider.init(ctx)

      await expect(provider.init(ctx)).rejects.toThrow('Cannot initialize')
    })

    it('should be safe to close multiple times', async () => {
      const provider = new TestProvider()
      const ctx = createMockContext()

      await provider.init(ctx)
      await provider.close()
      await provider.close() // Should not throw

      expect(provider.state).toBe('closed')
    })

    it('should return correct capabilities', () => {
      const provider = new TestProvider()
      const caps = provider.capabilities()

      expect(caps.streaming).toBe(true)
      expect(caps.async).toBe(true)
    })

    it('should return imports object', () => {
      const provider = new TestProvider()
      const imports = provider.getImports()

      expect(imports.testMethod).toBeDefined()
      expect((imports.testMethod as () => string)()).toBe('test result')
    })
  })

  describe('VirtualClock', () => {
    it('should start at zero for monotonic time', () => {
      const clock = new VirtualClock()
      expect(clock.monotonicNow()).toBe(0n)
    })

    it('should advance monotonic time', () => {
      const clock = new VirtualClock()

      clock.advance(1000000n) // 1ms

      expect(clock.monotonicNow()).toBe(1000000n)
    })

    it('should start at epoch for wall time by default', () => {
      const clock = new VirtualClock()
      const wall = clock.wallNow()

      expect(wall.seconds).toBe(0n)
      expect(wall.nanoseconds).toBe(0)
    })

    it('should allow setting initial wall time', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const clock = new VirtualClock(date)
      const wall = clock.wallNow()

      expect(wall.seconds).toBe(BigInt(Math.floor(date.getTime() / 1000)))
    })

    it('should advance wall time with monotonic', () => {
      const clock = new VirtualClock()

      clock.advance(2_000_000_000n) // 2 seconds

      const wall = clock.wallNow()
      expect(wall.seconds).toBe(2n)
    })

    it('should allow setting wall time directly', () => {
      const clock = new VirtualClock()
      const date = new Date('2024-06-01T00:00:00Z')

      clock.setWallTime(date)
      const wall = clock.wallNow()

      expect(wall.seconds).toBe(BigInt(Math.floor(date.getTime() / 1000)))
    })
  })

  describe('SeededRandom', () => {
    it('should produce deterministic bytes with same seed', () => {
      const rng1 = new SeededRandom(12345n)
      const rng2 = new SeededRandom(12345n)

      const bytes1 = rng1.getRandomBytes(16)
      const bytes2 = rng2.getRandomBytes(16)

      expect(bytes1).toEqual(bytes2)
    })

    it('should produce different bytes with different seeds', () => {
      const rng1 = new SeededRandom(12345n)
      const rng2 = new SeededRandom(54321n)

      const bytes1 = rng1.getRandomBytes(16)
      const bytes2 = rng2.getRandomBytes(16)

      expect(bytes1).not.toEqual(bytes2)
    })

    it('should produce deterministic u64 with same seed', () => {
      const rng1 = new SeededRandom(99999n)
      const rng2 = new SeededRandom(99999n)

      const val1 = rng1.getRandomU64()
      const val2 = rng2.getRandomU64()

      expect(val1).toBe(val2)
    })

    it('should produce correct length bytes', () => {
      const rng = new SeededRandom(1n)

      expect(rng.getRandomBytes(0).length).toBe(0)
      expect(rng.getRandomBytes(1).length).toBe(1)
      expect(rng.getRandomBytes(7).length).toBe(7)
      expect(rng.getRandomBytes(8).length).toBe(8)
      expect(rng.getRandomBytes(9).length).toBe(9)
      expect(rng.getRandomBytes(100).length).toBe(100)
    })
  })

  describe('realClock', () => {
    it('should return monotonically increasing time', () => {
      const t1 = realClock.monotonicNow()
      const t2 = realClock.monotonicNow()

      expect(t2).toBeGreaterThanOrEqual(t1)
    })

    it('should return current wall time', () => {
      const before = Date.now()
      const wall = realClock.wallNow()
      const after = Date.now()

      const wallMs = Number(wall.seconds) * 1000 + wall.nanoseconds / 1_000_000

      expect(wallMs).toBeGreaterThanOrEqual(before)
      expect(wallMs).toBeLessThanOrEqual(after + 1) // Allow 1ms tolerance
    })
  })

  describe('cryptoRandomSource', () => {
    it('should produce bytes of requested length', () => {
      const bytes = cryptoRandomSource.getRandomBytes(32)
      expect(bytes.length).toBe(32)
    })

    it('should produce non-zero bytes', () => {
      const bytes = cryptoRandomSource.getRandomBytes(32)
      const hasNonZero = bytes.some((b) => b !== 0)
      expect(hasNonZero).toBe(true)
    })

    it('should produce different bytes each time', () => {
      const bytes1 = cryptoRandomSource.getRandomBytes(32)
      const bytes2 = cryptoRandomSource.getRandomBytes(32)

      // Extremely unlikely to be equal
      const equal = bytes1.every((b, i) => b === bytes2[i])
      expect(equal).toBe(false)
    })

    it('should produce u64 values', () => {
      const val = cryptoRandomSource.getRandomU64()
      expect(typeof val).toBe('bigint')
      expect(val).toBeGreaterThanOrEqual(0n)
    })
  })

  describe('Logger', () => {
    it('noopLogger should not throw', () => {
      expect(() => {
        noopLogger.trace('test')
        noopLogger.debug('test')
        noopLogger.info('test')
        noopLogger.warn('test')
        noopLogger.error('test')
      }).not.toThrow()
    })

    it('createConsoleLogger should create a logger', () => {
      const logger = createConsoleLogger('test')

      expect(logger.trace).toBeDefined()
      expect(logger.debug).toBeDefined()
      expect(logger.info).toBeDefined()
      expect(logger.warn).toBeDefined()
      expect(logger.error).toBeDefined()
    })
  })
})
