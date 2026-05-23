/**
 * Crypto-based random implementation
 *
 * Uses the Web Crypto API (crypto.getRandomValues) for secure random generation.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'

/**
 * Random plugin instance using Web Crypto API
 */
class CryptoRandomInstance implements PluginInstance {
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
   * Get cryptographically secure random bytes
   */
  private getRandomBytes(len: bigint): Uint8Array {
    const length = Number(len)
    if (length < 0) {
      throw new Error(`Invalid length: ${length}`)
    }

    const bytes = new Uint8Array(length)
    // crypto.getRandomValues rejects requests larger than 65536 bytes per call,
    // so fill the buffer in chunks (writing directly into subarray views, no
    // extra copies). WASI get-random-bytes itself permits arbitrary lengths.
    const MAX_CHUNK = 65536
    for (let offset = 0; offset < length; offset += MAX_CHUNK) {
      const end = Math.min(offset + MAX_CHUNK, length)
      crypto.getRandomValues(bytes.subarray(offset, end))
    }
    return bytes
  }

  /**
   * Get a cryptographically secure random u64
   */
  private getRandomU64(): bigint {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)

    // Convert 8 bytes to bigint (little-endian)
    let result = 0n
    for (let i = 0; i < 8; i++) {
      result |= BigInt(bytes[i]!) << BigInt(i * 8)
    }
    return result
  }
}

/**
 * Web Crypto random implementation
 */
export const cryptoRandomImplementation: Implementation = {
  name: 'crypto',
  description: 'Secure random using Web Crypto API (crypto.getRandomValues)',
  create(_config: PluginConfig): PluginInstance {
    return new CryptoRandomInstance()
  },
}
