/**
 * Runtime configuration implementation
 *
 * Provides in-memory configuration storage for wasi:config/store.
 * Configuration values are set at instantiation time and can optionally
 * be updated at runtime.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type { ConfigResult, ConfigPluginConfig } from './types.js'
import { configOk, configErr, configErrorIo } from './types.js'

/**
 * Runtime config plugin instance
 *
 * Stores configuration in memory and provides the wasi:config/store interface.
 */
class RuntimeConfigInstance implements PluginInstance {
  private config: Map<string, string>
  private readonly mutable: boolean

  constructor(config: ConfigPluginConfig) {
    this.config = new Map()
    this.mutable = config.mutable ?? false

    // Initialize with provided values
    if (config.values) {
      for (const [key, value] of Object.entries(config.values)) {
        this.config.set(key, value)
      }
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

  /**
   * Get a configuration value by key
   *
   * WIT: get: func(key: string) -> result<option<string>, error>
   *
   * Returns ok(some(value)) if key exists
   * Returns ok(none) if key doesn't exist
   * Returns err(error) on failure
   */
  private get(key: string): ConfigResult<string | undefined> {
    try {
      const value = this.config.get(key)
      return configOk(value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return configErr(configErrorIo(message))
    }
  }

  /**
   * Get all configuration key-value pairs
   *
   * WIT: get-all: func() -> result<list<tuple<string, string>>, error>
   */
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
   * Set a configuration value (for runtime updates)
   *
   * This is not part of the WASI interface but allows the host
   * to update configuration at runtime.
   */
  set(key: string, value: string): void {
    if (!this.mutable) {
      throw new Error('Configuration is immutable')
    }
    this.config.set(key, value)
  }

  /**
   * Delete a configuration value (for runtime updates)
   */
  delete(key: string): boolean {
    if (!this.mutable) {
      throw new Error('Configuration is immutable')
    }
    return this.config.delete(key)
  }

  /**
   * Replace all configuration values (for runtime updates)
   */
  setAll(values: Record<string, string>): void {
    if (!this.mutable) {
      throw new Error('Configuration is immutable')
    }
    this.config.clear()
    for (const [key, value] of Object.entries(values)) {
      this.config.set(key, value)
    }
  }

  /**
   * Get the number of configuration entries
   */
  get size(): number {
    return this.config.size
  }
}

/**
 * Runtime configuration implementation
 *
 * Stores configuration in-memory. Suitable for:
 * - Static configuration passed at component instantiation
 * - Testing with controlled configuration
 * - Simple applications without external config sources
 */
export const runtimeConfigImplementation: Implementation = {
  name: 'runtime',
  description: 'In-memory runtime configuration store',
  create(config: PluginConfig): PluginInstance {
    return new RuntimeConfigInstance(config as ConfigPluginConfig)
  },
}

/**
 * Extended runtime config instance with update methods
 *
 * This class is exported separately to allow host code to update
 * configuration at runtime while still providing the standard
 * WASI interface to components.
 */
export class MutableConfigStore {
  private instance: RuntimeConfigInstance

  constructor(initialValues?: Record<string, string>) {
    const config: ConfigPluginConfig = { mutable: true }
    if (initialValues !== undefined) {
      config.values = initialValues
    }
    this.instance = new RuntimeConfigInstance(config)
  }

  /**
   * Get the WASI imports object
   */
  getImports(): Record<string, unknown> {
    return this.instance.getImports()
  }

  /**
   * Set a configuration value
   */
  set(key: string, value: string): void {
    this.instance.set(key, value)
  }

  /**
   * Delete a configuration value
   */
  delete(key: string): boolean {
    return this.instance.delete(key)
  }

  /**
   * Replace all configuration values
   */
  setAll(values: Record<string, string>): void {
    this.instance.setAll(values)
  }

  /**
   * Get a configuration value (host-side, not WASI interface)
   */
  get(key: string): string | undefined {
    const result = this.instance.getImports()['get'] as (key: string) => ConfigResult<string | undefined>
    const res = result(key)
    if (res.tag === 'ok') {
      return res.val
    }
    throw new Error(res.val.val)
  }

  /**
   * Get all configuration values (host-side)
   */
  getAll(): Map<string, string> {
    const result = this.instance.getImports()['get-all'] as () => ConfigResult<Array<[string, string]>>
    const res = result()
    if (res.tag === 'ok') {
      return new Map(res.val)
    }
    throw new Error(res.val.val)
  }

  /**
   * Get the number of configuration entries
   */
  get size(): number {
    return this.instance.size
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.instance.destroy()
  }
}
