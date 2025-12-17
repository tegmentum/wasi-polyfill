/**
 * Types for wasi:config interface
 *
 * Based on wasi:config/store@0.2.0-draft
 */

/**
 * Configuration error types
 *
 * WIT definition:
 * ```wit
 * variant error {
 *   upstream(string),
 *   io(string),
 * }
 * ```
 */
export type ConfigError =
  | { tag: 'upstream'; val: string }
  | { tag: 'io'; val: string }

/**
 * Create an upstream error (from external config source like Vault, K8s ConfigMaps)
 */
export function configErrorUpstream(message: string): ConfigError {
  return { tag: 'upstream', val: message }
}

/**
 * Create an I/O error (from file reads, network operations)
 */
export function configErrorIo(message: string): ConfigError {
  return { tag: 'io', val: message }
}

/**
 * Result type for config operations
 */
export type ConfigResult<T> = { tag: 'ok'; val: T } | { tag: 'err'; val: ConfigError }

/**
 * Create a successful result
 */
export function configOk<T>(val: T): ConfigResult<T> {
  return { tag: 'ok', val }
}

/**
 * Create an error result
 */
export function configErr<T>(error: ConfigError): ConfigResult<T> {
  return { tag: 'err', val: error }
}

/**
 * Configuration store interface
 *
 * Provides read-only access to configuration key-value pairs.
 */
export interface ConfigStore {
  /**
   * Get a configuration value by key
   *
   * Returns undefined if the key doesn't exist.
   * Throws on error conditions.
   */
  get(key: string): string | undefined

  /**
   * Get all configuration key-value pairs
   */
  getAll(): Array<[string, string]>
}

/**
 * Configuration source interface for providers that fetch config from external sources
 */
export interface ConfigSource {
  /**
   * Fetch configuration from the source
   */
  fetch(): Promise<Map<string, string>>

  /**
   * Watch for configuration changes (optional)
   */
  watch?(callback: (config: Map<string, string>) => void): () => void
}

/**
 * Plugin configuration for wasi:config
 */
export interface ConfigPluginConfig {
  /**
   * Initial configuration values
   */
  values?: Record<string, string>

  /**
   * Configuration source for dynamic loading
   */
  source?: ConfigSource

  /**
   * Whether to allow updates to config at runtime
   */
  mutable?: boolean
}
