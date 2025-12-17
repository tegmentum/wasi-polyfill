/**
 * Bundle presets for testing
 *
 * Predefined configurations for different testing scenarios.
 */

import type { PluginConfig } from '../core/types.js'

/**
 * Bundle preset configuration
 */
export interface BundlePreset {
  /** Bundle name */
  name: string

  /** Description */
  description: string

  /**
   * Plugin configurations by interface
   * Key format: 'package/name' (e.g., 'wasi:random/random')
   */
  plugins: Record<string, PluginConfig>

  /**
   * Default implementations to use
   * Key format: 'package/name' -> implementation name
   */
  implementations: Record<string, string>
}

/**
 * Deterministic test bundle
 *
 * Uses virtual clocks, seeded random, and captured I/O
 * for fully reproducible tests.
 */
export const deterministicBundle: BundlePreset = {
  name: 'deterministic',
  description: 'Fully deterministic environment for reproducible tests',
  plugins: {
    'wasi:random/random': {
      implementation: 'seeded',
      seed: 0n,
    },
    'wasi:random/insecure': {
      implementation: 'seeded',
      seed: 0n,
    },
    'wasi:random/insecure-seed': {
      implementation: 'seeded',
      seed: 0n,
    },
    'wasi:clocks/monotonic-clock': {
      implementation: 'virtual',
    },
    'wasi:clocks/wall-clock': {
      implementation: 'virtual',
      initialTime: new Date('2024-01-01T00:00:00Z'),
    },
    'wasi:logging/logging': {
      implementation: 'buffer',
      maxEntries: 10000,
    },
    'wasi:keyvalue/store': {
      implementation: 'memory',
    },
    'wasi:blobstore/blobstore': {
      implementation: 'memory',
    },
    'wasi:config/store': {
      implementation: 'runtime',
      values: {},
    },
  },
  implementations: {
    'wasi:random/random': 'seeded',
    'wasi:random/insecure': 'seeded',
    'wasi:random/insecure-seed': 'seeded',
    'wasi:clocks/monotonic-clock': 'virtual',
    'wasi:clocks/wall-clock': 'virtual',
    'wasi:logging/logging': 'buffer',
    'wasi:keyvalue/store': 'memory',
    'wasi:blobstore/blobstore': 'memory',
    'wasi:config/store': 'runtime',
  },
}

/**
 * Browser test bundle
 *
 * Uses real browser APIs where safe, with captured logging.
 */
export const browserTestBundle: BundlePreset = {
  name: 'browser-test',
  description: 'Browser environment with captured logging for testing',
  plugins: {
    'wasi:random/random': {
      implementation: 'crypto',
    },
    'wasi:random/insecure': {
      implementation: 'math',
    },
    'wasi:clocks/monotonic-clock': {
      implementation: 'performance',
    },
    'wasi:clocks/wall-clock': {
      implementation: 'date',
    },
    'wasi:logging/logging': {
      implementation: 'buffer',
      maxEntries: 1000,
    },
    'wasi:keyvalue/store': {
      implementation: 'memory',
    },
    'wasi:blobstore/blobstore': {
      implementation: 'memory',
    },
  },
  implementations: {
    'wasi:random/random': 'crypto',
    'wasi:random/insecure': 'math',
    'wasi:clocks/monotonic-clock': 'performance',
    'wasi:clocks/wall-clock': 'date',
    'wasi:logging/logging': 'buffer',
    'wasi:keyvalue/store': 'memory',
    'wasi:blobstore/blobstore': 'memory',
  },
}

/**
 * Minimal bundle
 *
 * Only essential plugins with default implementations.
 */
export const minimalBundle: BundlePreset = {
  name: 'minimal',
  description: 'Minimal plugin set with defaults',
  plugins: {
    'wasi:random/random': {},
    'wasi:clocks/monotonic-clock': {},
    'wasi:clocks/wall-clock': {},
  },
  implementations: {
    'wasi:random/random': 'crypto',
    'wasi:clocks/monotonic-clock': 'performance',
    'wasi:clocks/wall-clock': 'date',
  },
}

/**
 * Get a bundle preset by name
 */
export function getBundlePreset(name: string): BundlePreset | undefined {
  const presets: Record<string, BundlePreset> = {
    deterministic: deterministicBundle,
    'browser-test': browserTestBundle,
    minimal: minimalBundle,
  }
  return presets[name]
}

/**
 * Merge bundle presets with overrides
 */
export function mergeBundleConfig(
  base: BundlePreset,
  overrides: Partial<BundlePreset>
): BundlePreset {
  return {
    name: overrides.name ?? base.name,
    description: overrides.description ?? base.description,
    plugins: {
      ...base.plugins,
      ...overrides.plugins,
    },
    implementations: {
      ...base.implementations,
      ...overrides.implementations,
    },
  }
}
