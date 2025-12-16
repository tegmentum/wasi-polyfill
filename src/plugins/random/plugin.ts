/**
 * wasi:random plugin definitions
 *
 * Includes:
 * - wasi:random/random - Cryptographic random
 * - wasi:random/insecure - Non-cryptographic random (Math.random)
 * - wasi:random/insecure-seed - Seed for non-cryptographic RNG
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { cryptoRandomImplementation } from './impl-crypto.js'
import {
  insecureRandomImplementation,
  insecureSeedImplementation,
} from './impl-insecure.js'

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
 * Provides cryptographic random number generation using the Web Crypto API.
 */
export const randomPlugin: WasiPlugin = createPlugin(
  RANDOM_INTERFACE,
  {
    crypto: cryptoRandomImplementation,
  },
  'crypto'
)

/**
 * wasi:random/insecure plugin
 *
 * Provides non-cryptographic random using Math.random().
 * WARNING: Not suitable for security-sensitive operations.
 */
export const insecureRandomPlugin: WasiPlugin = createPlugin(
  INSECURE_INTERFACE,
  {
    math: insecureRandomImplementation,
  },
  'math'
)

/**
 * wasi:random/insecure-seed plugin
 *
 * Provides a seed for non-cryptographic random number generators.
 */
export const insecureSeedPlugin: WasiPlugin = createPlugin(
  INSECURE_SEED_INTERFACE,
  {
    default: insecureSeedImplementation,
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
