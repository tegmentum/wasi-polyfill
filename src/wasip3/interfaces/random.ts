/**
 * WASI Random 0.3.0 interface
 *
 * Mostly unchanged from P2 - provides cryptographically secure randomness.
 *
 * @packageDocumentation
 */

/**
 * Get cryptographically secure random bytes.
 *
 * @param len - Number of bytes to generate
 * @returns Random bytes
 */
export function getRandomBytes(len: bigint): Uint8Array {
  const bytes = new Uint8Array(Number(len))
  crypto.getRandomValues(bytes)
  return bytes
}

/**
 * Get a cryptographically secure random u64.
 *
 * @returns Random 64-bit unsigned integer
 */
export function getRandomU64(): bigint {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  const view = new DataView(bytes.buffer)
  return view.getBigUint64(0, true)
}

/**
 * Get a non-cryptographic random u64 (faster).
 *
 * Uses Math.random() which is faster but not cryptographically secure.
 *
 * @returns Random 64-bit unsigned integer
 */
export function getInsecureRandomU64(): bigint {
  // Generate two 32-bit random numbers and combine
  const high = Math.floor(Math.random() * 0xffffffff)
  const low = Math.floor(Math.random() * 0xffffffff)
  return (BigInt(high) << 32n) | BigInt(low)
}

/**
 * Get non-cryptographic random bytes (faster).
 *
 * @param len - Number of bytes to generate
 * @returns Random bytes
 */
export function getInsecureRandomBytes(len: bigint): Uint8Array {
  const bytes = new Uint8Array(Number(len))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

/**
 * Seed for a simple seeded PRNG.
 */
let seededState = 12345n

/**
 * Set the seed for the insecure seeded random generator.
 *
 * @param seed - Seed values
 */
export function setInsecureSeed(seed: [bigint, bigint]): void {
  seededState = seed[0] ^ seed[1]
}

/**
 * Get the next value from the seeded PRNG.
 *
 * Uses a simple xorshift algorithm.
 *
 * @returns Next random u64
 */
export function getSeededU64(): bigint {
  // xorshift64
  seededState ^= seededState >> 12n
  seededState ^= seededState << 25n
  seededState ^= seededState >> 27n
  return (seededState * 2685821657736338717n) & 0xffffffffffffffffn
}

/**
 * Get the wasi:random@0.3.0 imports.
 *
 * @returns Import object for wasi:random@0.3.0
 */
export function getRandomImports(): Record<string, unknown> {
  return {
    'wasi:random/random@0.3.0': {
      'get-random-bytes': getRandomBytes,
      'get-random-u64': getRandomU64,
    },

    'wasi:random/insecure@0.3.0': {
      'get-insecure-random-bytes': getInsecureRandomBytes,
      'get-insecure-random-u64': getInsecureRandomU64,
    },

    'wasi:random/insecure-seed@0.3.0': {
      'insecure-seed': (): [bigint, bigint] => {
        // Return a seed based on current time
        const now = BigInt(Date.now())
        const random = getRandomU64()
        return [now, random]
      },
    },
  }
}
