/**
 * Environment Variable Bridge configuration implementation
 *
 * Maps environment variables to configuration keys with explicit mapping.
 * Unlike reading all env vars, this requires explicit declaration of which
 * env vars should be exposed and under what config keys.
 *
 * Security benefits:
 * - No accidental exposure of sensitive env vars
 * - Clear audit trail of what config comes from env
 * - Support for key transformation and validation
 *
 * Features:
 * - Explicit env var → config key mapping
 * - Key transformation (prefix stripping, case conversion)
 * - Default values for missing env vars
 * - Validation rules (required, pattern matching)
 * - Type coercion hints
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type { ConfigResult, ConfigSource } from './types.js'
import { configOk, configErr, configErrorIo } from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Single environment variable mapping
 */
export interface EnvVarMapping {
  /**
   * Environment variable name
   */
  envVar: string

  /**
   * Configuration key to map to (defaults to envVar if not specified)
   */
  configKey?: string

  /**
   * Default value if env var is not set
   */
  default?: string

  /**
   * Whether this mapping is required (throws if missing)
   * @default false
   */
  required?: boolean

  /**
   * Validation pattern (regex)
   */
  pattern?: RegExp | string

  /**
   * Description for documentation/error messages
   */
  description?: string

  /**
   * Transform function for the value
   */
  transform?: (value: string) => string

  /**
   * Type hint for consumers (informational only)
   */
  type?: 'string' | 'number' | 'boolean' | 'json'
}

/**
 * Prefix-based mapping configuration
 */
export interface EnvPrefixMapping {
  /**
   * Prefix to match (e.g., "APP_")
   */
  prefix: string

  /**
   * Whether to strip the prefix from config keys
   * @default true
   */
  stripPrefix?: boolean

  /**
   * Key transformation
   */
  keyTransform?: 'lowercase' | 'uppercase' | 'camelCase' | 'snakeCase' | 'none'

  /**
   * Config key prefix to add
   */
  configPrefix?: string

  /**
   * Env vars to exclude even if they match prefix
   */
  exclude?: string[]
}

/**
 * Env bridge plugin configuration
 */
export interface EnvBridgeConfigPluginConfig extends PluginConfig {
  /**
   * Explicit env var mappings
   */
  mappings?: EnvVarMapping[]

  /**
   * Prefix-based mappings
   */
  prefixes?: EnvPrefixMapping[]

  /**
   * Environment variables to read from
   * (defaults to process.env in Node, or empty in browser)
   */
  env?: Record<string, string | undefined>

  /**
   * Whether to throw on validation errors
   * @default true
   */
  throwOnValidationError?: boolean

  /**
   * Whether to throw on missing required vars
   * @default true
   */
  throwOnMissingRequired?: boolean
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert string to camelCase
 */
function toCamelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Convert string to snake_case
 */
function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
}

/**
 * Apply key transformation
 */
function transformKey(key: string, transform: EnvPrefixMapping['keyTransform']): string {
  switch (transform) {
    case 'lowercase':
      return key.toLowerCase()
    case 'uppercase':
      return key.toUpperCase()
    case 'camelCase':
      return toCamelCase(key)
    case 'snakeCase':
      return toSnakeCase(key)
    case 'none':
    default:
      return key
  }
}

/**
 * Validate a value against a pattern
 */
function validatePattern(value: string, pattern: RegExp | string): boolean {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return regex.test(value)
}

// =============================================================================
// Env Bridge Config Source
// =============================================================================

/**
 * Environment variable bridge source
 */
export class EnvBridgeConfigSource implements ConfigSource {
  private readonly config: EnvBridgeConfigPluginConfig
  private readonly env: Record<string, string | undefined>

  constructor(config: EnvBridgeConfigPluginConfig) {
    this.config = config

    // Get environment - in browser this will typically be provided explicitly
    this.env = config.env ?? this.getDefaultEnv()
  }

  private getDefaultEnv(): Record<string, string | undefined> {
    // Try to get process.env in Node.js
    if (typeof process !== 'undefined' && process.env) {
      return process.env
    }
    return {}
  }

  async fetch(): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    const errors: string[] = []

    // Process explicit mappings
    if (this.config.mappings) {
      for (const mapping of this.config.mappings) {
        const envValue = this.env[mapping.envVar]
        const configKey = mapping.configKey ?? mapping.envVar

        if (envValue === undefined) {
          if (mapping.required) {
            if (this.config.throwOnMissingRequired !== false) {
              errors.push(`Required env var missing: ${mapping.envVar}`)
            }
            continue
          }

          if (mapping.default !== undefined) {
            result.set(configKey, mapping.default)
          }
          continue
        }

        // Validate pattern
        if (mapping.pattern && !validatePattern(envValue, mapping.pattern)) {
          if (this.config.throwOnValidationError !== false) {
            errors.push(
              `Env var ${mapping.envVar} failed validation: ` +
              `value "${envValue}" doesn't match pattern ${mapping.pattern}`
            )
          }
          continue
        }

        // Apply transform
        const value = mapping.transform ? mapping.transform(envValue) : envValue
        result.set(configKey, value)
      }
    }

    // Process prefix-based mappings
    if (this.config.prefixes) {
      for (const prefixConfig of this.config.prefixes) {
        const prefix = prefixConfig.prefix
        const stripPrefix = prefixConfig.stripPrefix !== false
        const keyTransform = prefixConfig.keyTransform ?? 'none'
        const configPrefix = prefixConfig.configPrefix ?? ''
        const exclude = new Set(prefixConfig.exclude ?? [])

        for (const [envVar, envValue] of Object.entries(this.env)) {
          if (!envVar.startsWith(prefix)) {
            continue
          }

          if (exclude.has(envVar)) {
            continue
          }

          if (envValue === undefined) {
            continue
          }

          // Build config key
          let key = stripPrefix ? envVar.slice(prefix.length) : envVar
          key = transformKey(key, keyTransform)
          if (configPrefix) {
            key = configPrefix + key
          }

          result.set(key, envValue)
        }
      }
    }

    // Throw collected errors
    if (errors.length > 0) {
      throw new Error(`Env bridge validation errors:\n${errors.join('\n')}`)
    }

    return result
  }
}

// =============================================================================
// Env Bridge Config Instance
// =============================================================================

/**
 * Env bridge config plugin instance
 */
class EnvBridgeConfigInstance implements PluginInstance {
  private config: Map<string, string> = new Map()
  private readonly source: EnvBridgeConfigSource
  private initError: Error | null = null

  constructor(pluginConfig: EnvBridgeConfigPluginConfig) {
    this.source = new EnvBridgeConfigSource(pluginConfig)

    // Initialize synchronously
    this.initializeSync()
  }

  private initializeSync(): void {
    try {
      // EnvBridgeConfigSource.fetch is actually sync despite returning Promise
      // because it just reads from in-memory env object
      const env = this.source['env']
      const mappings = this.source['config'].mappings ?? []
      const prefixes = this.source['config'].prefixes ?? []

      // Process explicit mappings
      for (const mapping of mappings) {
        const envValue = env[mapping.envVar]
        const configKey = mapping.configKey ?? mapping.envVar

        if (envValue === undefined) {
          if (mapping.default !== undefined) {
            this.config.set(configKey, mapping.default)
          }
          continue
        }

        const value = mapping.transform ? mapping.transform(envValue) : envValue
        this.config.set(configKey, value)
      }

      // Process prefix-based mappings
      for (const prefixConfig of prefixes) {
        const prefix = prefixConfig.prefix
        const stripPrefix = prefixConfig.stripPrefix !== false
        const keyTransform = prefixConfig.keyTransform ?? 'none'
        const configPrefix = prefixConfig.configPrefix ?? ''
        const exclude = new Set(prefixConfig.exclude ?? [])

        for (const [envVar, envValue] of Object.entries(env)) {
          if (!envVar.startsWith(prefix)) continue
          if (exclude.has(envVar)) continue
          if (envValue === undefined) continue

          let key = stripPrefix ? envVar.slice(prefix.length) : envVar
          key = transformKey(key, keyTransform)
          if (configPrefix) {
            key = configPrefix + key
          }

          this.config.set(key, envValue)
        }
      }
    } catch (error) {
      this.initError = error instanceof Error ? error : new Error(String(error))
    }
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
      if (this.initError) {
        return configErr(configErrorIo(this.initError.message))
      }
      const value = this.config.get(key)
      return configOk(value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return configErr(configErrorIo(message))
    }
  }

  private getAll(): ConfigResult<Array<[string, string]>> {
    try {
      if (this.initError) {
        return configErr(configErrorIo(this.initError.message))
      }
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
   * Refresh configuration from environment
   */
  async refresh(): Promise<void> {
    this.config = await this.source.fetch()
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
 * Environment variable bridge implementation
 *
 * Maps environment variables to configuration with explicit mappings.
 * Supports validation, transformation, and prefix-based discovery.
 */
export const envBridgeConfigImplementation: Implementation = {
  name: 'env-bridge',
  description: 'Configuration from environment variables with explicit mapping',
  create(config: PluginConfig): PluginInstance {
    const envConfig = config as EnvBridgeConfigPluginConfig
    if (!envConfig.mappings && !envConfig.prefixes) {
      throw new Error('Env bridge config requires mappings or prefixes')
    }
    return new EnvBridgeConfigInstance(envConfig)
  },
}

/**
 * Create an env bridge config source for use with layered config
 */
export function createEnvBridgeSource(
  config: EnvBridgeConfigPluginConfig
): EnvBridgeConfigSource {
  return new EnvBridgeConfigSource(config)
}

/**
 * Quick helper to create a simple env var mapping
 */
export function envMapping(
  envVar: string,
  configKey?: string,
  defaultValue?: string
): EnvVarMapping {
  const mapping: EnvVarMapping = { envVar }
  if (configKey) mapping.configKey = configKey
  if (defaultValue !== undefined) mapping.default = defaultValue
  return mapping
}

/**
 * Quick helper to create a prefix mapping
 */
export function envPrefix(
  prefix: string,
  options?: Omit<EnvPrefixMapping, 'prefix'>
): EnvPrefixMapping {
  return { prefix, ...options }
}
