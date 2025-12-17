/**
 * Seeded random implementation for deterministic testing
 *
 * Uses the SeededRandom class from the runtime provider system
 * to generate reproducible random numbers from a seed.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { SeededRandom } from '../../runtime/provider.js'

/**
 * Configuration for seeded random
 */
export interface SeededRandomConfig extends PluginConfig {
  /**
   * Seed for the random number generator
   * If not provided, defaults to 0 for maximum determinism
   */
  seed?: bigint | number
}

/**
 * Seeded random plugin instance
 *
 * Provides deterministic random number generation using xorshift128+.
 * Same seed always produces the same sequence of random numbers.
 */
class SeededRandomInstance implements PluginInstance {
  private readonly rng: SeededRandom

  constructor(seed: bigint) {
    this.rng = new SeededRandom(seed)
  }

  getImports(): Record<string, unknown> {
    return {
      'get-random-bytes': this.getRandomBytes.bind(this),
      'get-random-u64': this.getRandomU64.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  /**
   * Get deterministic random bytes
   */
  private getRandomBytes(len: bigint): Uint8Array {
    const length = Number(len)
    if (length < 0 || length > 65536) {
      throw new Error(`Invalid length: ${length}`)
    }

    return this.rng.getRandomBytes(length)
  }

  /**
   * Get a deterministic random u64
   */
  private getRandomU64(): bigint {
    return this.rng.getRandomU64()
  }
}

/**
 * Seeded random implementation for wasi:random/random
 *
 * Provides deterministic random generation for:
 * - Reproducible tests
 * - Debugging
 * - Snapshot testing
 *
 * Usage:
 * ```typescript
 * const instance = seededRandomImplementation.create({
 *   seed: 12345n
 * })
 * ```
 */
export const seededRandomImplementation: Implementation = {
  name: 'seeded',
  description: 'Deterministic random using seeded xorshift128+',
  create(config: PluginConfig): PluginInstance {
    const seededConfig = config as SeededRandomConfig
    const seed = seededConfig.seed !== undefined
      ? BigInt(seededConfig.seed)
      : 0n
    return new SeededRandomInstance(seed)
  },
}

/**
 * Seeded insecure random plugin instance
 *
 * Provides the wasi:random/insecure interface with deterministic output.
 */
class SeededInsecureRandomInstance implements PluginInstance {
  private readonly rng: SeededRandom

  constructor(seed: bigint) {
    this.rng = new SeededRandom(seed)
  }

  getImports(): Record<string, unknown> {
    return {
      'get-insecure-random-bytes': this.getInsecureRandomBytes.bind(this),
      'get-insecure-random-u64': this.getInsecureRandomU64.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  private getInsecureRandomBytes(len: bigint): Uint8Array {
    const length = Number(len)
    if (length < 0 || length > 65536) {
      throw new Error(`Invalid length: ${length}`)
    }

    return this.rng.getRandomBytes(length)
  }

  private getInsecureRandomU64(): bigint {
    return this.rng.getRandomU64()
  }
}

/**
 * Seeded implementation for wasi:random/insecure
 */
export const seededInsecureRandomImplementation: Implementation = {
  name: 'seeded',
  description: 'Deterministic insecure random using seeded xorshift128+',
  create(config: PluginConfig): PluginInstance {
    const seededConfig = config as SeededRandomConfig
    const seed = seededConfig.seed !== undefined
      ? BigInt(seededConfig.seed)
      : 0n
    return new SeededInsecureRandomInstance(seed)
  },
}

/**
 * Seeded insecure seed plugin instance
 *
 * Returns a deterministic seed based on the initial seed.
 */
class SeededInsecureSeedInstance implements PluginInstance {
  private readonly seed: [bigint, bigint]

  constructor(seed: bigint) {
    // Generate two u64 values from the seed using splitmix64
    const rng = new SeededRandom(seed)
    this.seed = [rng.getRandomU64(), rng.getRandomU64()]
  }

  getImports(): Record<string, unknown> {
    return {
      'insecure-seed': this.insecureSeed.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  private insecureSeed(): [bigint, bigint] {
    return this.seed
  }
}

/**
 * Seeded implementation for wasi:random/insecure-seed
 */
export const seededInsecureSeedImplementation: Implementation = {
  name: 'seeded',
  description: 'Deterministic insecure seed from initial seed',
  create(config: PluginConfig): PluginInstance {
    const seededConfig = config as SeededRandomConfig
    const seed = seededConfig.seed !== undefined
      ? BigInt(seededConfig.seed)
      : 0n
    return new SeededInsecureSeedInstance(seed)
  },
}
