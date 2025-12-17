/**
 * wasi:random plugin definitions
 *
 * Includes:
 * - wasi:random/random - Cryptographic random
 * - wasi:random/insecure - Non-cryptographic random (Math.random)
 * - wasi:random/insecure-seed - Seed for non-cryptographic RNG
 *
 * Each interface supports multiple implementations:
 * - crypto/math/default: Standard implementations
 * - seeded: Deterministic implementations for testing
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { cryptoRandomImplementation } from './impl-crypto.js'
import {
  insecureRandomImplementation,
  insecureSeedImplementation,
} from './impl-insecure.js'
import {
  seededRandomImplementation,
  seededInsecureRandomImplementation,
  seededInsecureSeedImplementation,
} from './impl-seeded.js'

/**
 * WASI random interface definition
 */
export const RANDOM_INTERFACE: WasiInterface = {
  package: 'wasi:random',
  name: 'random',
  version: '0.2.0',
}

/**
 * WASI insecure random interface definition
 */
export const INSECURE_INTERFACE: WasiInterface = {
  package: 'wasi:random',
  name: 'insecure',
  version: '0.2.0',
}

/**
 * WASI insecure-seed interface definition
 */
export const INSECURE_SEED_INTERFACE: WasiInterface = {
  package: 'wasi:random',
  name: 'insecure-seed',
  version: '0.2.0',
}

/**
 * wasi:random/random plugin
 *
 * Provides cryptographic random number generation.
 *
 * Implementations:
 * - crypto: Web Crypto API (default, secure)
 * - seeded: Deterministic xorshift128+ (for testing)
 */
export const randomPlugin: WasiPlugin = createPlugin(
  RANDOM_INTERFACE,
  {
    crypto: cryptoRandomImplementation,
    seeded: seededRandomImplementation,
  },
  'crypto'
)

/**
 * wasi:random/insecure plugin
 *
 * Provides non-cryptographic random number generation.
 * WARNING: Not suitable for security-sensitive operations.
 *
 * Implementations:
 * - math: Math.random() (default)
 * - seeded: Deterministic xorshift128+ (for testing)
 */
export const insecureRandomPlugin: WasiPlugin = createPlugin(
  INSECURE_INTERFACE,
  {
    math: insecureRandomImplementation,
    seeded: seededInsecureRandomImplementation,
  },
  'math'
)

/**
 * wasi:random/insecure-seed plugin
 *
 * Provides a seed for non-cryptographic random number generators.
 *
 * Implementations:
 * - default: Random seed from Math.random()
 * - seeded: Deterministic seed from initial seed (for testing)
 */
export const insecureSeedPlugin: WasiPlugin = createPlugin(
  INSECURE_SEED_INTERFACE,
  {
    default: insecureSeedImplementation,
    seeded: seededInsecureSeedImplementation,
  },
  'default'
)

/**
 * All random plugins for convenient registration
 */
export const randomPlugins: WasiPlugin[] = [
  randomPlugin,
  insecureRandomPlugin,
  insecureSeedPlugin,
]
