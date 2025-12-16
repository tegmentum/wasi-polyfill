/**
 * Insecure random implementation
 *
 * Uses Math.random() for non-cryptographic random generation.
 * WARNING: Do not use for security-sensitive operations.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'

/**
 * Insecure random plugin instance using Math.random
 */
class InsecureRandomInstance implements PluginInstance {
  getImports(): Record<string, unknown> {
    return {
      'get-insecure-random-bytes': this.getInsecureRandomBytes.bind(this),
      'get-insecure-random-u64': this.getInsecureRandomU64.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  /**
   * Get non-cryptographic random bytes
   */
  private getInsecureRandomBytes(len: bigint): Uint8Array {
    const length = Number(len)
    if (length < 0 || length > 65536) {
      throw new Error(`Invalid length: ${length}`)
    }

    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
    return bytes
  }

  /**
   * Get a non-cryptographic random u64
   */
  private getInsecureRandomU64(): bigint {
    // Generate two 32-bit values and combine them
    const high = Math.floor(Math.random() * 0x100000000)
    const low = Math.floor(Math.random() * 0x100000000)
    return (BigInt(high) << 32n) | BigInt(low)
  }
}

/**
 * Insecure random implementation using Math.random
 */
export const insecureRandomImplementation: Implementation = {
  name: 'math',
  description: 'Non-cryptographic random using Math.random()',
  create(_config: PluginConfig): PluginInstance {
    return new InsecureRandomInstance()
  },
}

/**
 * Insecure seed plugin instance
 */
class InsecureSeedInstance implements PluginInstance {
  private seed: [bigint, bigint]

  constructor() {
    // Initialize with random seed
    const high1 = Math.floor(Math.random() * 0x100000000)
    const low1 = Math.floor(Math.random() * 0x100000000)
    const high2 = Math.floor(Math.random() * 0x100000000)
    const low2 = Math.floor(Math.random() * 0x100000000)

    this.seed = [
      (BigInt(high1) << 32n) | BigInt(low1),
      (BigInt(high2) << 32n) | BigInt(low2),
    ]
  }

  getImports(): Record<string, unknown> {
    return {
      'insecure-seed': this.insecureSeed.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  /**
   * Get an insecure seed for the random number generator
   *
   * Returns a tuple of two u64 values that can be used to seed an RNG.
   */
  private insecureSeed(): [bigint, bigint] {
    return this.seed
  }
}

/**
 * Insecure seed implementation
 */
export const insecureSeedImplementation: Implementation = {
  name: 'default',
  description: 'Insecure seed generator',
  create(_config: PluginConfig): PluginInstance {
    return new InsecureSeedInstance()
  },
}
