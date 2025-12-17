/**
 * Manifest configuration implementation
 *
 * Parses configuration from host-provided manifest files (JSON/TOML).
 * The manifest is typically embedded in the HTML page or provided
 * as a sidecar file alongside the WASM component.
 *
 * Supported formats:
 * - JSON (recommended)
 * - TOML (via simple parser)
 *
 * Features:
 * - Nested key flattening (e.g., { db: { host: "..." } } → "db.host")
 * - Environment variable interpolation
 * - Schema validation (optional)
 * - Multiple manifest sources
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type { ConfigResult, ConfigSource } from './types.js'
import { configOk, configErr, configErrorIo } from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Manifest configuration format
 */
export type ManifestFormat = 'json' | 'toml' | 'auto'

/**
 * Manifest source options
 */
export interface ManifestSourceOptions {
  /**
   * Manifest content (string or parsed object)
   */
  content?: string | Record<string, unknown>

  /**
   * URL to fetch manifest from
   */
  url?: string

  /**
   * DOM element ID containing manifest (browser-only)
   */
  elementId?: string

  /**
   * Manifest format
   * @default 'auto'
   */
  format?: ManifestFormat

  /**
   * Prefix to add to all keys from this manifest
   */
  keyPrefix?: string

  /**
   * Key separator for flattening nested objects
   * @default '.'
   */
  keySeparator?: string
}

/**
 * Environment variable interpolation options
 */
export interface InterpolationOptions {
  /**
   * Enable environment variable interpolation
   * @default false
   */
  enabled?: boolean

  /**
   * Pattern for env var references
   * @default /\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g
   */
  pattern?: RegExp

  /**
   * Environment variables to use for interpolation
   */
  env?: Record<string, string>

  /**
   * Whether to throw on missing env vars
   * @default false
   */
  throwOnMissing?: boolean

  /**
   * Default value for missing env vars
   * @default ''
   */
  defaultValue?: string
}

/**
 * Manifest config plugin configuration
 */
export interface ManifestConfigPluginConfig extends PluginConfig {
  /**
   * Manifest source(s) - can be multiple for composition
   */
  manifests: ManifestSourceOptions | ManifestSourceOptions[]

  /**
   * Environment variable interpolation
   */
  interpolation?: InterpolationOptions

  /**
   * Whether to merge arrays by concatenation (vs replacement)
   * @default false
   */
  mergeArrays?: boolean
}

// =============================================================================
// Parsers
// =============================================================================

/**
 * Flatten a nested object into dot-notation keys
 */
function flattenObject(
  obj: Record<string, unknown>,
  prefix: string = '',
  separator: string = '.'
): Map<string, string> {
  const result = new Map<string, string>()

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}${separator}${key}` : key

    if (value === null || value === undefined) {
      continue
    } else if (typeof value === 'string') {
      result.set(fullKey, value)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result.set(fullKey, String(value))
    } else if (Array.isArray(value)) {
      // Arrays become JSON strings
      result.set(fullKey, JSON.stringify(value))
    } else if (typeof value === 'object') {
      // Recursively flatten nested objects
      const nested = flattenObject(value as Record<string, unknown>, fullKey, separator)
      for (const [nestedKey, nestedValue] of nested) {
        result.set(nestedKey, nestedValue)
      }
    }
  }

  return result
}

/**
 * Parse JSON manifest
 */
function parseJsonManifest(content: string): Record<string, unknown> {
  return JSON.parse(content)
}

/**
 * Simple TOML parser for basic key-value pairs and sections
 * Note: This is a minimal parser; for full TOML support use a dedicated library
 */
function parseTomlManifest(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let currentSection: Record<string, unknown> = result

  const lines = content.split('\n')

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const rawLine = lines[lineNum]!
    const line = rawLine.trim()

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue
    }

    // Section header [section.name]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      const sectionPath = sectionMatch[1]!.split('.')

      // Navigate/create nested structure
      currentSection = result
      for (const part of sectionPath) {
        if (!(part in currentSection)) {
          currentSection[part] = {}
        }
        currentSection = currentSection[part] as Record<string, unknown>
      }
      continue
    }

    // Key = Value
    const kvMatch = line.match(/^([^=]+)=(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1]!.trim()
      let value: unknown = kvMatch[2]!.trim()

      // Parse value type
      if (value === 'true') {
        value = true
      } else if (value === 'false') {
        value = false
      } else if (/^-?\d+$/.test(value as string)) {
        value = parseInt(value as string, 10)
      } else if (/^-?\d+\.\d+$/.test(value as string)) {
        value = parseFloat(value as string)
      } else if (
        ((value as string).startsWith('"') && (value as string).endsWith('"')) ||
        ((value as string).startsWith("'") && (value as string).endsWith("'"))
      ) {
        value = (value as string).slice(1, -1)
      } else if ((value as string).startsWith('[') && (value as string).endsWith(']')) {
        // Simple array parsing
        try {
          value = JSON.parse((value as string).replace(/'/g, '"'))
        } catch {
          // Keep as string if parsing fails
        }
      }

      currentSection[key] = value
      continue
    }
  }

  return result
}

/**
 * Detect manifest format from content
 */
function detectFormat(content: string): ManifestFormat {
  const trimmed = content.trim()

  // JSON object starts with {
  if (trimmed.startsWith('{')) {
    return 'json'
  }

  // JSON array starts with [ followed by JSON value
  // TOML sections start with [ followed by identifier, then ]
  if (trimmed.startsWith('[')) {
    // Check if it looks like a TOML section: [identifier] at start of line
    if (/^\[[a-zA-Z_][a-zA-Z0-9_.-]*\]\s*$/m.test(trimmed.split('\n')[0]!)) {
      return 'toml'
    }
    return 'json'
  }

  // TOML has key = value at start of line
  if (/^[a-z_][a-z0-9_]*\s*=/im.test(trimmed)) {
    return 'toml'
  }

  // Default to JSON
  return 'json'
}

/**
 * Parse manifest content
 */
function parseManifest(content: string, format: ManifestFormat): Record<string, unknown> {
  const actualFormat = format === 'auto' ? detectFormat(content) : format

  if (actualFormat === 'toml') {
    return parseTomlManifest(content)
  } else {
    return parseJsonManifest(content)
  }
}

/**
 * Interpolate environment variables in a string
 */
function interpolateEnvVars(
  value: string,
  options: Required<InterpolationOptions>
): string {
  return value.replace(options.pattern, (_match, braced, unbraced) => {
    const varName = braced || unbraced
    const envValue = options.env[varName]

    if (envValue === undefined) {
      if (options.throwOnMissing) {
        throw new Error(`Missing environment variable: ${varName}`)
      }
      return options.defaultValue
    }

    return envValue
  })
}

// =============================================================================
// Manifest Config Source
// =============================================================================

/**
 * Manifest configuration source
 */
export class ManifestConfigSource implements ConfigSource {
  private readonly options: ManifestSourceOptions
  private cached: Map<string, string> | null = null

  constructor(options: ManifestSourceOptions) {
    this.options = options
  }

  async fetch(): Promise<Map<string, string>> {
    if (this.cached) {
      return new Map(this.cached)
    }

    let parsed: Record<string, unknown>

    if (this.options.content) {
      // Use provided content
      if (typeof this.options.content === 'string') {
        parsed = parseManifest(this.options.content, this.options.format ?? 'auto')
      } else {
        parsed = this.options.content
      }
    } else if (this.options.url) {
      // Fetch from URL
      const response = await fetch(this.options.url)
      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.status}`)
      }
      const text = await response.text()
      parsed = parseManifest(text, this.options.format ?? 'auto')
    } else if (this.options.elementId && typeof document !== 'undefined') {
      // Get from DOM element
      const element = document.getElementById(this.options.elementId)
      if (!element) {
        throw new Error(`Manifest element not found: ${this.options.elementId}`)
      }
      const text = element.textContent ?? ''
      parsed = parseManifest(text, this.options.format ?? 'auto')
    } else {
      throw new Error('No manifest source provided')
    }

    // Flatten and apply prefix
    const flattened = flattenObject(
      parsed,
      this.options.keyPrefix ?? '',
      this.options.keySeparator ?? '.'
    )

    this.cached = flattened
    return new Map(flattened)
  }
}

// =============================================================================
// Manifest Config Instance
// =============================================================================

/**
 * Manifest config plugin instance
 */
class ManifestConfigInstance implements PluginInstance {
  private config: Map<string, string> = new Map()
  private readonly sources: ManifestConfigSource[]
  private readonly interpolation: Required<InterpolationOptions>
  private initialized = false

  constructor(pluginConfig: ManifestConfigPluginConfig) {
    // Normalize manifests to array
    const manifests = Array.isArray(pluginConfig.manifests)
      ? pluginConfig.manifests
      : [pluginConfig.manifests]

    this.sources = manifests.map(m => new ManifestConfigSource(m))

    this.interpolation = {
      enabled: pluginConfig.interpolation?.enabled ?? false,
      pattern: pluginConfig.interpolation?.pattern ?? /\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g,
      env: pluginConfig.interpolation?.env ?? {},
      throwOnMissing: pluginConfig.interpolation?.throwOnMissing ?? false,
      defaultValue: pluginConfig.interpolation?.defaultValue ?? '',
    }

    // Initialize synchronously if we have inline content
    this.initializeSync(manifests)
  }

  private initializeSync(manifests: ManifestSourceOptions[]): void {
    for (const manifest of manifests) {
      if (manifest.content && typeof manifest.content !== 'string') {
        // Already parsed object
        const flattened = flattenObject(
          manifest.content,
          manifest.keyPrefix ?? '',
          manifest.keySeparator ?? '.'
        )
        for (const [key, value] of flattened) {
          this.config.set(key, this.maybeInterpolate(value))
        }
      } else if (manifest.content && typeof manifest.content === 'string') {
        // Parse string content
        const parsed = parseManifest(manifest.content, manifest.format ?? 'auto')
        const flattened = flattenObject(
          parsed,
          manifest.keyPrefix ?? '',
          manifest.keySeparator ?? '.'
        )
        for (const [key, value] of flattened) {
          this.config.set(key, this.maybeInterpolate(value))
        }
      }
    }
    this.initialized = true
  }

  private maybeInterpolate(value: string): string {
    if (this.interpolation.enabled) {
      return interpolateEnvVars(value, this.interpolation)
    }
    return value
  }

  getImports(): Record<string, unknown> {
    return {
      get: this.get.bind(this),
      'get-all': this.getAll.bind(this),
    }
  }

  destroy(): void {
    this.config.clear()
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
      const entries: Array<[string, string]> = []
      for (const [key, value] of this.config) {
        entries.push([key, value])
      }
      return configOk(entries)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return configErr(configErrorIo(message))
    }
  }

  /**
   * Refresh configuration from all sources
   */
  async refresh(): Promise<void> {
    const newConfig = new Map<string, string>()

    for (const source of this.sources) {
      const data = await source.fetch()
      for (const [key, value] of data) {
        newConfig.set(key, this.maybeInterpolate(value))
      }
    }

    this.config = newConfig
  }

  /**
   * Check if initialization is complete
   */
  get isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Get the number of configuration entries
   */
  get size(): number {
    return this.config.size
  }
}

// =============================================================================
// Implementation Export
// =============================================================================

/**
 * Manifest configuration implementation
 *
 * Parses configuration from JSON/TOML manifest files.
 * Supports nested object flattening and env var interpolation.
 */
export const manifestConfigImplementation: Implementation = {
  name: 'manifest',
  description: 'Configuration from JSON/TOML manifest files',
  create(config: PluginConfig): PluginInstance {
    const manifestConfig = config as ManifestConfigPluginConfig
    if (!manifestConfig.manifests) {
      throw new Error('Manifest config requires manifest source(s)')
    }
    return new ManifestConfigInstance(manifestConfig)
  },
}

/**
 * Parse a manifest string into a config map
 */
export function parseManifestConfig(
  content: string,
  options?: {
    format?: ManifestFormat
    keyPrefix?: string
    keySeparator?: string
  }
): Map<string, string> {
  const parsed = parseManifest(content, options?.format ?? 'auto')
  return flattenObject(
    parsed,
    options?.keyPrefix ?? '',
    options?.keySeparator ?? '.'
  )
}

/**
 * Create a manifest config source for use with layered config
 */
export function createManifestSource(options: ManifestSourceOptions): ManifestConfigSource {
  return new ManifestConfigSource(options)
}
