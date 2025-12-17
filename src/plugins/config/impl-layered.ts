/**
 * Layered configuration implementation
 *
 * Provides configuration from multiple sources with precedence rules.
 * Later sources override earlier sources for the same key.
 *
 * Precedence order (highest to lowest):
 * 1. Override values (runtime overrides)
 * 2. Component-specific config
 * 3. Host config
 * 4. Bundle defaults
 *
 * Features:
 * - Multiple source composition
 * - Policy enforcement (allowlist/denylist)
 * - Key redaction for sensitive values
 * - Caching with TTL
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type { ConfigResult, ConfigSource } from './types.js'
import { configOk, configErr, configErrorIo } from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration layer definition
 */
export interface ConfigLayer {
  /**
   * Layer name for debugging
   */
  name: string

  /**
   * Layer priority (higher = more important)
   * @default 0
   */
  priority?: number

  /**
   * Static key-value pairs
   */
  values?: Record<string, string>

  /**
   * Dynamic configuration source
   */
  source?: ConfigSource

  /**
   * Whether this layer is enabled
   * @default true
   */
  enabled?: boolean
}

/**
 * Policy configuration for config access control
 */
export interface ConfigPolicy {
  /**
   * Allowed key patterns (empty = all allowed)
   * Supports glob patterns: 'db.*', '*.host', 'feature.flags.*'
   */
  allowedKeys?: string[]

  /**
   * Denied key patterns (takes precedence over allowed)
   */
  deniedKeys?: string[]

  /**
   * Keys to redact in logs/debug output
   * Values are still accessible but marked as sensitive
   */
  redactKeys?: string[]

  /**
   * Whether to throw on denied key access (vs returning undefined)
   * @default false
   */
  throwOnDenied?: boolean
}

/**
 * Layered config plugin configuration
 */
export interface LayeredConfigPluginConfig extends PluginConfig {
  /**
   * Configuration layers (processed in order, later overrides earlier)
   */
  layers: ConfigLayer[]

  /**
   * Access policy
   */
  policy?: ConfigPolicy

  /**
   * Cache configuration values
   * @default true
   */
  enableCache?: boolean

  /**
   * Cache TTL in milliseconds (0 = forever)
   * @default 0
   */
  cacheTtl?: number

  /**
   * Refresh dynamic sources on access if stale
   * @default false
   */
  refreshOnAccess?: boolean
}

/**
 * Resolved layer with all properties
 */
interface ResolvedLayer {
  name: string
  priority: number
  values: Map<string, string>
  source: ConfigSource | undefined
  enabled: boolean
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Match a key against a glob pattern
 */
function matchPattern(key: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
    .replace(/\*/g, '.*') // * becomes .*
    .replace(/\?/g, '.') // ? becomes .

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(key)
}

/**
 * Check if a key matches any pattern in a list
 */
function matchesAny(key: string, patterns: string[]): boolean {
  return patterns.some(pattern => matchPattern(key, pattern))
}

// =============================================================================
// Layered Config Instance
// =============================================================================

/**
 * Layered config plugin instance
 */
class LayeredConfigInstance implements PluginInstance {
  private layers: ResolvedLayer[]
  private readonly policy: Required<ConfigPolicy>
  private readonly enableCache: boolean
  private readonly cacheTtl: number
  private readonly refreshOnAccess: boolean

  private cache: Map<string, string> | null = null
  private cacheTimestamp: number = 0
  private refreshPromise: Promise<void> | null = null

  constructor(config: LayeredConfigPluginConfig) {
    this.policy = {
      allowedKeys: config.policy?.allowedKeys ?? [],
      deniedKeys: config.policy?.deniedKeys ?? [],
      redactKeys: config.policy?.redactKeys ?? [],
      throwOnDenied: config.policy?.throwOnDenied ?? false,
    }

    this.enableCache = config.enableCache ?? true
    this.cacheTtl = config.cacheTtl ?? 0
    this.refreshOnAccess = config.refreshOnAccess ?? false

    // Initialize layers
    this.layers = config.layers
      .filter(layer => layer.enabled !== false)
      .map((layer, index) => ({
        name: layer.name,
        priority: layer.priority ?? index,
        values: new Map(Object.entries(layer.values ?? {})),
        source: layer.source,
        enabled: true,
      }))
      .sort((a, b) => a.priority - b.priority)

    // Build initial cache from static values
    this.rebuildCache()
  }

  getImports(): Record<string, unknown> {
    return {
      get: this.get.bind(this),
      'get-all': this.getAll.bind(this),
    }
  }

  destroy(): void {
    this.cache = null
    this.layers = []
  }

  /**
   * Get a configuration value by key
   */
  private get(key: string): ConfigResult<string | undefined> {
    try {
      // Check policy
      if (!this.isKeyAllowed(key)) {
        if (this.policy.throwOnDenied) {
          return configErr(configErrorIo(`Access denied to config key: ${key}`))
        }
        return configOk(undefined)
      }

      // Refresh cache if needed
      if (this.refreshOnAccess && this.isCacheStale()) {
        this.refreshAsync()
      }

      // Get from cache
      const value = this.cache?.get(key)
      return configOk(value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return configErr(configErrorIo(message))
    }
  }

  /**
   * Get all configuration key-value pairs
   */
  private getAll(): ConfigResult<Array<[string, string]>> {
    try {
      // Refresh cache if needed
      if (this.refreshOnAccess && this.isCacheStale()) {
        this.refreshAsync()
      }

      const entries: Array<[string, string]> = []
      if (this.cache) {
        for (const [key, value] of this.cache) {
          if (this.isKeyAllowed(key)) {
            entries.push([key, value])
          }
        }
      }
      return configOk(entries)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return configErr(configErrorIo(message))
    }
  }

  /**
   * Check if a key is allowed by policy
   */
  private isKeyAllowed(key: string): boolean {
    // Check denied first (takes precedence)
    if (this.policy.deniedKeys.length > 0 && matchesAny(key, this.policy.deniedKeys)) {
      return false
    }

    // Check allowed (empty = all allowed)
    if (this.policy.allowedKeys.length > 0 && !matchesAny(key, this.policy.allowedKeys)) {
      return false
    }

    return true
  }

  /**
   * Check if a key should be redacted
   */
  isKeyRedacted(key: string): boolean {
    return this.policy.redactKeys.length > 0 && matchesAny(key, this.policy.redactKeys)
  }

  /**
   * Check if cache is stale
   */
  private isCacheStale(): boolean {
    if (!this.enableCache || this.cacheTtl === 0) {
      return false
    }
    return Date.now() - this.cacheTimestamp > this.cacheTtl
  }

  /**
   * Rebuild cache from all layers
   */
  private rebuildCache(): void {
    const merged = new Map<string, string>()

    // Apply layers in priority order (later overrides earlier)
    for (const layer of this.layers) {
      for (const [key, value] of layer.values) {
        merged.set(key, value)
      }
    }

    this.cache = merged
    this.cacheTimestamp = Date.now()
  }

  /**
   * Refresh dynamic sources asynchronously
   */
  private refreshAsync(): void {
    if (this.refreshPromise) {
      return // Already refreshing
    }

    this.refreshPromise = this.refresh().finally(() => {
      this.refreshPromise = null
    })
  }

  /**
   * Refresh configuration from all dynamic sources
   */
  async refresh(): Promise<void> {
    const updates: Array<{ layer: ResolvedLayer; data: Map<string, string> }> = []

    // Fetch from all sources in parallel
    const fetchPromises = this.layers
      .filter(layer => layer.source)
      .map(async layer => {
        try {
          const data = await layer.source!.fetch()
          updates.push({ layer, data })
        } catch {
          // Keep existing values on error
        }
      })

    await Promise.all(fetchPromises)

    // Apply updates
    for (const { layer, data } of updates) {
      layer.values = data
    }

    // Rebuild cache
    this.rebuildCache()
  }

  /**
   * Add a new layer at runtime
   */
  addLayer(layer: ConfigLayer): void {
    const resolved: ResolvedLayer = {
      name: layer.name,
      priority: layer.priority ?? this.layers.length,
      values: new Map(Object.entries(layer.values ?? {})),
      source: layer.source,
      enabled: layer.enabled !== false,
    }

    this.layers.push(resolved)
    this.layers.sort((a, b) => a.priority - b.priority)
    this.rebuildCache()
  }

  /**
   * Remove a layer by name
   */
  removeLayer(name: string): boolean {
    const index = this.layers.findIndex(l => l.name === name)
    if (index === -1) {
      return false
    }

    this.layers.splice(index, 1)
    this.rebuildCache()
    return true
  }

  /**
   * Set override values (highest priority)
   */
  setOverrides(values: Record<string, string>): void {
    // Find or create override layer
    let overrideLayer = this.layers.find(l => l.name === '__overrides__')
    if (overrideLayer === undefined) {
      const newLayer: ResolvedLayer = {
        name: '__overrides__',
        priority: Number.MAX_SAFE_INTEGER,
        values: new Map(),
        source: undefined,
        enabled: true,
      }
      this.layers.push(newLayer)
      this.layers.sort((a, b) => a.priority - b.priority)
      overrideLayer = newLayer
    }

    overrideLayer.values = new Map(Object.entries(values))
    this.rebuildCache()
  }

  /**
   * Clear override values
   */
  clearOverrides(): void {
    this.removeLayer('__overrides__')
  }

  /**
   * Get layer names for debugging
   */
  getLayerNames(): string[] {
    return this.layers.map(l => l.name)
  }

  /**
   * Get the number of configuration entries
   */
  get size(): number {
    return this.cache?.size ?? 0
  }
}

// =============================================================================
// Implementation Export
// =============================================================================

/**
 * Layered configuration implementation
 *
 * Composes multiple configuration sources with precedence rules.
 * Supports policy enforcement and caching.
 */
export const layeredConfigImplementation: Implementation = {
  name: 'layered',
  description: 'Layered configuration with multiple sources and policy enforcement',
  create(config: PluginConfig): PluginInstance {
    const layeredConfig = config as LayeredConfigPluginConfig
    if (!layeredConfig.layers || layeredConfig.layers.length === 0) {
      throw new Error('Layered config requires at least one layer')
    }
    return new LayeredConfigInstance(layeredConfig)
  },
}

/**
 * Create a layered config instance for standalone use
 */
export function createLayeredConfig(config: LayeredConfigPluginConfig): LayeredConfigInstance {
  return new LayeredConfigInstance(config)
}

/**
 * Helper to create a simple layered config with defaults
 */
export function createSimpleLayeredConfig(
  defaults: Record<string, string>,
  overrides?: Record<string, string>
): LayeredConfigInstance {
  const layers: ConfigLayer[] = [
    { name: 'defaults', priority: 0, values: defaults },
  ]

  if (overrides) {
    layers.push({ name: 'overrides', priority: 100, values: overrides })
  }

  return new LayeredConfigInstance({ layers })
}
