/**
 * Remote configuration implementation
 *
 * Fetches configuration from remote URLs (HTTP/HTTPS endpoints).
 * Supports JSON and environment file formats with caching and polling.
 *
 * Use cases:
 * - Loading config from configuration services (Consul, etcd)
 * - Feature flags from remote endpoints
 * - Environment-specific configuration from CDN
 * - Runtime configuration updates via polling
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type { ConfigResult, ConfigSource } from './types.js'
import { configOk, configErr, configErrorIo } from './types.js'

/**
 * Supported configuration formats
 */
export type ConfigFormat = 'json' | 'env' | 'auto'

/**
 * Remote config source configuration
 */
export interface RemoteConfigOptions {
  /**
   * URL to fetch configuration from
   */
  url: string

  /**
   * Configuration format (auto-detected from Content-Type if 'auto')
   * @default 'auto'
   */
  format?: ConfigFormat

  /**
   * Request headers to include
   */
  headers?: Record<string, string>

  /**
   * Request timeout in milliseconds
   * @default 5000
   */
  timeout?: number

  /**
   * Cache duration in milliseconds (0 = no cache)
   * @default 0
   */
  cacheDuration?: number

  /**
   * Poll interval in milliseconds (0 = no polling)
   * @default 0
   */
  pollInterval?: number

  /**
   * Retry configuration
   */
  retry?: {
    /**
     * Number of retries
     * @default 3
     */
    attempts?: number

    /**
     * Base delay between retries in milliseconds
     * @default 1000
     */
    delay?: number

    /**
     * Whether to use exponential backoff
     * @default true
     */
    exponential?: boolean
  }

  /**
   * Fallback values if remote fetch fails
   */
  fallback?: Record<string, string>

  /**
   * Custom fetch function (for testing or custom transports)
   */
  fetchFn?: typeof fetch
}

/**
 * Resolved retry options with defaults applied
 */
interface ResolvedRetryOptions {
  attempts: number
  delay: number
  exponential: boolean
}

/**
 * Resolved remote config options with defaults applied
 */
interface ResolvedRemoteConfigOptions {
  url: string
  format: ConfigFormat
  headers: Record<string, string>
  timeout: number
  cacheDuration: number
  pollInterval: number
  retry: ResolvedRetryOptions
  fallback: Record<string, string>
  fetchFn: typeof fetch
}

/**
 * Remote configuration plugin config
 */
export interface RemoteConfigPluginConfig extends PluginConfig {
  /**
   * Remote source configuration
   */
  remote: RemoteConfigOptions

  /**
   * Initial values to use before first fetch completes
   */
  initialValues?: Record<string, string>
}

/**
 * Parse JSON configuration
 */
function parseJsonConfig(text: string): Map<string, string> {
  const data = JSON.parse(text)
  const result = new Map<string, string>()

  // Handle flat key-value object
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        result.set(key, value)
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        result.set(key, String(value))
      } else if (value !== null && value !== undefined) {
        // Nested objects become JSON strings
        result.set(key, JSON.stringify(value))
      }
    }
  }

  return result
}

/**
 * Parse environment file format
 * Supports KEY=VALUE format with # comments
 */
function parseEnvConfig(text: string): Map<string, string> {
  const result = new Map<string, string>()
  const lines = text.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // Find first = sign
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, equalsIndex).trim()
    let value = trimmed.slice(equalsIndex + 1).trim()

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (key) {
      result.set(key, value)
    }
  }

  return result
}

/**
 * Detect format from Content-Type header
 */
function detectFormat(contentType: string | null): ConfigFormat {
  if (!contentType) return 'json'

  const lower = contentType.toLowerCase()
  if (lower.includes('application/json')) return 'json'
  if (lower.includes('text/plain')) return 'env'
  if (lower.includes('application/x-env')) return 'env'

  return 'json'
}

/**
 * Sleep for a duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Remote configuration source
 */
export class RemoteConfigSource implements ConfigSource {
  private readonly options: ResolvedRemoteConfigOptions
  private cache: { data: Map<string, string>; timestamp: number } | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watchers: Set<(config: Map<string, string>) => void> = new Set()

  constructor(options: RemoteConfigOptions) {
    this.options = {
      url: options.url,
      format: options.format ?? 'auto',
      headers: options.headers ?? {},
      timeout: options.timeout ?? 5000,
      cacheDuration: options.cacheDuration ?? 0,
      pollInterval: options.pollInterval ?? 0,
      retry: {
        attempts: options.retry?.attempts ?? 3,
        delay: options.retry?.delay ?? 1000,
        exponential: options.retry?.exponential ?? true,
      },
      fallback: options.fallback ?? {},
      fetchFn: options.fetchFn ?? fetch,
    }
  }

  /**
   * Fetch configuration from remote source
   */
  async fetch(): Promise<Map<string, string>> {
    // Check cache
    if (this.cache && this.options.cacheDuration > 0) {
      const age = Date.now() - this.cache.timestamp
      if (age < this.options.cacheDuration) {
        return new Map(this.cache.data)
      }
    }

    // Fetch with retries
    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.options.retry.attempts; attempt++) {
      try {
        const data = await this.fetchOnce()

        // Update cache
        this.cache = { data, timestamp: Date.now() }

        // Notify watchers
        for (const watcher of this.watchers) {
          try {
            watcher(new Map(data))
          } catch {
            // Ignore watcher errors
          }
        }

        return data
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Calculate delay with exponential backoff
        if (attempt < this.options.retry.attempts - 1) {
          let delay = this.options.retry.delay
          if (this.options.retry.exponential) {
            delay *= Math.pow(2, attempt)
          }
          await sleep(delay)
        }
      }
    }

    // All retries failed, use fallback if available
    if (Object.keys(this.options.fallback).length > 0) {
      return new Map(Object.entries(this.options.fallback))
    }

    throw lastError ?? new Error('Failed to fetch configuration')
  }

  /**
   * Watch for configuration changes
   */
  watch(callback: (config: Map<string, string>) => void): () => void {
    this.watchers.add(callback)

    // Start polling if not already started
    if (this.options.pollInterval > 0 && !this.pollTimer) {
      this.pollTimer = setInterval(() => {
        this.fetch().catch(() => {
          // Ignore polling errors (watchers will receive cached data)
        })
      }, this.options.pollInterval)
    }

    // Return unsubscribe function
    return () => {
      this.watchers.delete(callback)

      // Stop polling if no more watchers
      if (this.watchers.size === 0 && this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
    }
  }

  /**
   * Stop all polling and clear watchers
   */
  destroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.watchers.clear()
    this.cache = null
  }

  private async fetchOnce(): Promise<Map<string, string>> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout)

    try {
      const response = await this.options.fetchFn(this.options.url, {
        method: 'GET',
        headers: this.options.headers,
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const text = await response.text()
      const format = this.options.format === 'auto'
        ? detectFormat(response.headers.get('Content-Type'))
        : this.options.format

      if (format === 'env') {
        return parseEnvConfig(text)
      } else {
        return parseJsonConfig(text)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * Remote config plugin instance
 */
class RemoteConfigInstance implements PluginInstance {
  private config: Map<string, string>
  private readonly source: RemoteConfigSource
  private unsubscribe: (() => void) | null = null
  private initialized = false

  constructor(pluginConfig: RemoteConfigPluginConfig) {
    // Start with initial values
    this.config = new Map()
    if (pluginConfig.initialValues) {
      for (const [key, value] of Object.entries(pluginConfig.initialValues)) {
        this.config.set(key, value)
      }
    }

    // Create remote source
    this.source = new RemoteConfigSource(pluginConfig.remote)

    // Start watching if polling is enabled
    if (pluginConfig.remote.pollInterval && pluginConfig.remote.pollInterval > 0) {
      this.unsubscribe = this.source.watch((newConfig) => {
        this.config = newConfig
      })
    }

    // Fetch initial config (async, but we don't block on it)
    this.initialize()
  }

  private async initialize(): Promise<void> {
    try {
      const data = await this.source.fetch()
      this.config = data
      this.initialized = true
    } catch {
      // Keep using initial values on failure
      this.initialized = true
    }
  }

  getImports(): Record<string, unknown> {
    return {
      get: this.get.bind(this),
      'get-all': this.getAll.bind(this),
    }
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    this.source.destroy()
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
   * Force refresh configuration from remote source
   */
  async refresh(): Promise<void> {
    const data = await this.source.fetch()
    this.config = data
  }

  /**
   * Check if initial fetch has completed
   */
  get isInitialized(): boolean {
    return this.initialized
  }
}

/**
 * Remote configuration implementation
 *
 * Fetches configuration from remote HTTP endpoints.
 * Supports JSON and environment file formats.
 */
export const remoteConfigImplementation: Implementation = {
  name: 'remote',
  description: 'Remote HTTP configuration source with caching and polling',
  create(config: PluginConfig): PluginInstance {
    const remoteConfig = config as RemoteConfigPluginConfig
    if (!remoteConfig.remote?.url) {
      throw new Error('Remote config requires a URL')
    }
    return new RemoteConfigInstance(remoteConfig)
  },
}

/**
 * Create a remote config source for standalone use
 */
export function createRemoteConfigSource(options: RemoteConfigOptions): RemoteConfigSource {
  return new RemoteConfigSource(options)
}

/**
 * Fetch configuration once from a URL (convenience function)
 */
export async function fetchConfig(
  url: string,
  options?: Omit<RemoteConfigOptions, 'url'>
): Promise<Map<string, string>> {
  const source = new RemoteConfigSource({ url, ...options })
  try {
    return await source.fetch()
  } finally {
    source.destroy()
  }
}
