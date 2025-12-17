/**
 * Fixed configuration implementation
 *
 * Provides deterministic, immutable configuration for testing.
 * Configuration values are fixed at creation time and never change.
 *
 * Use cases:
 * - Deterministic test fixtures
 * - Golden snapshot testing
 * - Reproducible test environments
 * - CI/CD pipeline testing
 *
 * Features:
 * - Immutable configuration (no runtime changes)
 * - Snapshot serialization/deserialization
 * - Deterministic ordering
 * - Comparison utilities for testing
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type { ConfigResult } from './types.js'
import { configOk, configErr, configErrorIo } from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Fixed config snapshot format
 */
export interface ConfigSnapshot {
  /**
   * Snapshot version for compatibility
   */
  version: 1

  /**
   * Snapshot name/identifier
   */
  name?: string

  /**
   * Creation timestamp (ISO 8601)
   */
  createdAt?: string

  /**
   * Configuration entries (sorted by key for determinism)
   */
  entries: Array<[string, string]>

  /**
   * Optional metadata
   */
  metadata?: Record<string, unknown>
}

/**
 * Fixed config plugin configuration
 */
export interface FixedConfigPluginConfig extends PluginConfig {
  /**
   * Configuration values (record or entries array)
   */
  values?: Record<string, string> | Array<[string, string]>

  /**
   * Load from snapshot
   */
  snapshot?: ConfigSnapshot

  /**
   * Snapshot name for this configuration
   */
  name?: string
}

// =============================================================================
// Fixed Config Instance
// =============================================================================

/**
 * Fixed config plugin instance
 *
 * Provides completely immutable configuration for deterministic testing.
 */
class FixedConfigInstance implements PluginInstance {
  private readonly config: Map<string, string>
  private readonly sortedKeys: string[]
  private readonly name: string
  private readonly createdAt: string

  constructor(pluginConfig: FixedConfigPluginConfig) {
    this.config = new Map()
    this.createdAt = new Date().toISOString()
    this.name = pluginConfig.name ?? 'unnamed'

    // Load from snapshot if provided
    if (pluginConfig.snapshot) {
      this.loadSnapshot(pluginConfig.snapshot)
    } else if (pluginConfig.values) {
      // Load from values
      if (Array.isArray(pluginConfig.values)) {
        for (const [key, value] of pluginConfig.values) {
          this.config.set(key, value)
        }
      } else {
        for (const [key, value] of Object.entries(pluginConfig.values)) {
          this.config.set(key, value)
        }
      }
    }

    // Pre-sort keys for deterministic iteration
    this.sortedKeys = [...this.config.keys()].sort()
  }

  private loadSnapshot(snapshot: ConfigSnapshot): void {
    if (snapshot.version !== 1) {
      throw new Error(`Unsupported snapshot version: ${snapshot.version}`)
    }

    for (const [key, value] of snapshot.entries) {
      this.config.set(key, value)
    }
  }

  getImports(): Record<string, unknown> {
    return {
      get: this.get.bind(this),
      'get-all': this.getAll.bind(this),
    }
  }

  destroy(): void {
    // Fixed config is immutable, nothing to clean up
  }

  private get(key: string): ConfigResult<string | undefined> {
    try {
      const value = this.config.get(key)
      return configOk(value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return configErr(configErrorIo(message))
    }
  }

  private getAll(): ConfigResult<Array<[string, string]>> {
    try {
      // Return in sorted order for determinism
      const entries: Array<[string, string]> = []
      for (const key of this.sortedKeys) {
        const value = this.config.get(key)
        if (value !== undefined) {
          entries.push([key, value])
        }
      }
      return configOk(entries)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return configErr(configErrorIo(message))
    }
  }

  /**
   * Export configuration as a snapshot
   */
  toSnapshot(metadata?: Record<string, unknown>): ConfigSnapshot {
    const entries: Array<[string, string]> = []
    for (const key of this.sortedKeys) {
      const value = this.config.get(key)
      if (value !== undefined) {
        entries.push([key, value])
      }
    }

    const snapshot: ConfigSnapshot = {
      version: 1,
      name: this.name,
      createdAt: this.createdAt,
      entries,
    }

    if (metadata) {
      snapshot.metadata = metadata
    }

    return snapshot
  }

  /**
   * Export as JSON string (for file storage)
   */
  toJSON(pretty: boolean = true): string {
    return JSON.stringify(this.toSnapshot(), null, pretty ? 2 : undefined)
  }

  /**
   * Compare with another fixed config instance
   */
  equals(other: FixedConfigInstance): boolean {
    if (this.config.size !== other.config.size) {
      return false
    }

    for (const [key, value] of this.config) {
      if (other.config.get(key) !== value) {
        return false
      }
    }

    return true
  }

  /**
   * Get differences from another config
   */
  diff(other: FixedConfigInstance): {
    added: Array<[string, string]>
    removed: Array<[string, string]>
    changed: Array<[string, { from: string; to: string }]>
  } {
    const added: Array<[string, string]> = []
    const removed: Array<[string, string]> = []
    const changed: Array<[string, { from: string; to: string }]> = []

    // Find removed and changed
    for (const [key, value] of this.config) {
      const otherValue = other.config.get(key)
      if (otherValue === undefined) {
        removed.push([key, value])
      } else if (otherValue !== value) {
        changed.push([key, { from: value, to: otherValue }])
      }
    }

    // Find added
    for (const [key, value] of other.config) {
      if (!this.config.has(key)) {
        added.push([key, value])
      }
    }

    return { added, removed, changed }
  }

  /**
   * Get the number of configuration entries
   */
  get size(): number {
    return this.config.size
  }

  /**
   * Get all keys (sorted)
   */
  keys(): string[] {
    return [...this.sortedKeys]
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    return this.config.has(key)
  }
}

// =============================================================================
// Implementation Export
// =============================================================================

/**
 * Fixed configuration implementation
 *
 * Provides immutable, deterministic configuration for testing.
 * Supports snapshot serialization for golden testing.
 */
export const fixedConfigImplementation: Implementation = {
  name: 'fixed',
  description: 'Immutable configuration for deterministic testing',
  create(config: PluginConfig): PluginInstance {
    const fixedConfig = config as FixedConfigPluginConfig
    return new FixedConfigInstance(fixedConfig)
  },
}

/**
 * Create a fixed config instance for standalone use
 */
export function createFixedConfig(
  values: Record<string, string> | Array<[string, string]>,
  name?: string
): FixedConfigInstance {
  const config: FixedConfigPluginConfig = { values }
  if (name !== undefined) {
    config.name = name
  }
  return new FixedConfigInstance(config)
}

/**
 * Load a fixed config from a snapshot
 */
export function loadFixedConfig(snapshot: ConfigSnapshot): FixedConfigInstance {
  return new FixedConfigInstance({ snapshot })
}

/**
 * Load a fixed config from JSON string
 */
export function parseFixedConfig(json: string): FixedConfigInstance {
  const snapshot = JSON.parse(json) as ConfigSnapshot
  return loadFixedConfig(snapshot)
}

/**
 * Create an empty fixed config (for testing "no config" scenarios)
 */
export function emptyFixedConfig(name?: string): FixedConfigInstance {
  return new FixedConfigInstance({ values: {}, name: name ?? 'empty' })
}

/**
 * Merge multiple fixed configs into one (later configs override earlier)
 */
export function mergeFixedConfigs(
  ...configs: FixedConfigInstance[]
): FixedConfigInstance {
  const merged: Record<string, string> = {}

  for (const config of configs) {
    const result = config['getAll']() as ConfigResult<Array<[string, string]>>
    if (result.tag === 'ok') {
      for (const [key, value] of result.val) {
        merged[key] = value
      }
    }
  }

  return createFixedConfig(merged, 'merged')
}

/**
 * Assert two configs are equal (for testing)
 */
export function assertConfigsEqual(
  actual: FixedConfigInstance,
  expected: FixedConfigInstance
): void {
  if (!actual.equals(expected)) {
    const diff = expected.diff(actual)
    const messages: string[] = []

    if (diff.added.length > 0) {
      messages.push(`Missing keys: ${diff.added.map(([k]) => k).join(', ')}`)
    }
    if (diff.removed.length > 0) {
      messages.push(`Extra keys: ${diff.removed.map(([k]) => k).join(', ')}`)
    }
    if (diff.changed.length > 0) {
      messages.push(
        `Changed keys: ${diff.changed.map(([k, v]) => `${k}: "${v.from}" → "${v.to}"`).join(', ')}`
      )
    }

    throw new Error(`Config mismatch:\n${messages.join('\n')}`)
  }
}
