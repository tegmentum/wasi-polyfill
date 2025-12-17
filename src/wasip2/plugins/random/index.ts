/**
 * wasi:random plugin
 *
 * Provides cryptographic and non-cryptographic random number generation.
 *
 * Interfaces:
 * - wasi:random/random - Cryptographic random (crypto.getRandomValues)
 * - wasi:random/insecure - Non-cryptographic random (Math.random)
 * - wasi:random/insecure-seed - Seed for non-cryptographic RNG
 *
 * Implementations:
 * - crypto/math/default: Standard implementations
 * - seeded: Deterministic implementations for testing
 */

// Plugin definitions and interfaces
export {
  randomPlugin,
  insecureRandomPlugin,
  insecureSeedPlugin,
  randomPlugins,
  RANDOM_INTERFACE,
  INSECURE_INTERFACE,
  INSECURE_SEED_INTERFACE,
} from './plugin.js'

// Standard implementations
export { cryptoRandomImplementation } from './impl-crypto.js'
export {
  insecureRandomImplementation,
  insecureSeedImplementation,
} from './impl-insecure.js'

// Seeded implementations (for deterministic testing)
export {
  seededRandomImplementation,
  seededInsecureRandomImplementation,
  seededInsecureSeedImplementation,
  type SeededRandomConfig,
} from './impl-seeded.js'
