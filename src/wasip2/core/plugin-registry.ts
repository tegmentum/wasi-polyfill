/**
 * Plugin registry for managing WASI interface implementations
 */

import type { WasiInterface, WasiPlugin } from './types.js'
import { formatInterfaceString, interfaceMatches, interfaceKey } from './types.js'
import { PluginNotFoundError } from '../../shared/errors.js'

/**
 * Registry for WASI plugins
 *
 * Manages registration and lookup of plugins that implement WASI interfaces.
 * Supports lazy loading of plugins via factory functions.
 *
 * Performance optimizations:
 * - Version-agnostic lookup cache to avoid O(n) iteration
 * - Direct key lookups for registered plugins
 */
export class PluginRegistry {
  private plugins: Map<string, WasiPlugin> = new Map()
  private lazyLoaders: Map<string, () => Promise<WasiPlugin>> = new Map()
  /** Cache for version-agnostic lookups (key without version -> plugin) */
  private lookupCache: Map<string, WasiPlugin> = new Map()

  /**
   * Register a plugin for a WASI interface
   */
  register(plugin: WasiPlugin): void {
    const key = this.makeKey(plugin.witInterface)
    this.plugins.set(key, plugin)
    // Remove any lazy loader if we have the real plugin
    this.lazyLoaders.delete(key)
    // Clear lookup cache since registration changed
    this.lookupCache.clear()
  }

  /**
   * Register a lazy loader for a plugin
   *
   * The loader will be called when the plugin is first requested.
   * This enables tree-shaking of unused plugins.
   */
  registerLazy(
    iface: WasiInterface,
    loader: () => Promise<WasiPlugin>
  ): void {
    const key = this.makeKey(iface)
    if (!this.plugins.has(key)) {
      this.lazyLoaders.set(key, loader)
    }
  }

  /**
   * Get a plugin for a WASI interface
   *
   * Returns undefined if no plugin is registered for the interface.
   * Will load lazy plugins if a loader is registered.
   *
   * Uses a lookup cache to avoid O(n) iteration for repeated lookups.
   */
  async get(iface: WasiInterface): Promise<WasiPlugin | undefined> {
    const key = this.makeKey(iface)

    // Check for directly registered plugin
    const plugin = this.plugins.get(key)
    if (plugin) {
      return plugin
    }

    // Check for lazy loader
    const loader = this.lazyLoaders.get(key)
    if (loader) {
      const loadedPlugin = await loader()
      this.plugins.set(key, loadedPlugin)
      this.lazyLoaders.delete(key)
      // Clear cache since we added a new plugin
      this.lookupCache.clear()
      return loadedPlugin
    }

    return this.resolveVersionAgnostic(iface)
  }

  /**
   * Get a plugin synchronously (only works for already-loaded plugins)
   *
   * Uses a lookup cache to avoid O(n) iteration for repeated lookups.
   */
  getSync(iface: WasiInterface): WasiPlugin | undefined {
    // Direct lookup first (most common case)
    const plugin = this.plugins.get(this.makeKey(iface))
    if (plugin) {
      return plugin
    }
    return this.resolveVersionAgnostic(iface)
  }

  /**
   * Resolve a plugin ignoring the version suffix, using (and populating) the
   * lookup cache to avoid repeated O(n) scans. Shared by get and getSync.
   */
  private resolveVersionAgnostic(
    iface: WasiInterface
  ): WasiPlugin | undefined {
    const cacheKey = interfaceKey(iface)
    const cached = this.lookupCache.get(cacheKey)
    if (cached) {
      return cached
    }

    for (const [, registeredPlugin] of this.plugins) {
      if (interfaceMatches(iface, registeredPlugin.witInterface, false)) {
        this.lookupCache.set(cacheKey, registeredPlugin)
        return registeredPlugin
      }
    }

    return undefined
  }

  /**
   * Get a plugin or throw if not found
   */
  async getOrThrow(iface: WasiInterface): Promise<WasiPlugin> {
    const plugin = await this.get(iface)
    if (!plugin) {
      throw new PluginNotFoundError(formatInterfaceString(iface))
    }
    return plugin
  }

  /**
   * Check if a plugin is registered for an interface
   */
  has(iface: WasiInterface): boolean {
    const key = this.makeKey(iface)
    return this.plugins.has(key) || this.lazyLoaders.has(key)
  }

  /**
   * List all registered plugins
   */
  list(): WasiPlugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * List all registered interface keys (including lazy loaders)
   */
  listInterfaces(): WasiInterface[] {
    const interfaces: WasiInterface[] = []

    for (const plugin of this.plugins.values()) {
      interfaces.push(plugin.witInterface)
    }

    // Note: We can't list lazy loader interfaces without the full plugin
    // But we stored the interface in the key

    return interfaces
  }

  /**
   * Remove a plugin
   */
  unregister(iface: WasiInterface): boolean {
    const key = this.makeKey(iface)
    const hadPlugin = this.plugins.delete(key)
    const hadLoader = this.lazyLoaders.delete(key)
    // Invalidate cache since plugin list changed
    if (hadPlugin || hadLoader) {
      this.lookupCache.clear()
    }
    return hadPlugin || hadLoader
  }

  /**
   * Clear all registered plugins
   */
  clear(): void {
    this.plugins.clear()
    this.lazyLoaders.clear()
    this.lookupCache.clear()
  }

  /**
   * Get the number of registered plugins
   */
  get size(): number {
    return this.plugins.size + this.lazyLoaders.size
  }

  private makeKey(iface: WasiInterface): string {
    // Key by package/name without version to allow version flexibility
    return interfaceKey(iface)
  }
}

/**
 * Global plugin registry singleton
 *
 * This is the default registry used by the Polyfill class.
 * Plugins can register themselves here on import.
 */
export const globalRegistry = new PluginRegistry()

/**
 * Register a plugin in the global registry
 */
export function registerPlugin(plugin: WasiPlugin): void {
  globalRegistry.register(plugin)
}

/**
 * Register a lazy plugin loader in the global registry
 */
export function registerLazyPlugin(
  iface: WasiInterface,
  loader: () => Promise<WasiPlugin>
): void {
  globalRegistry.registerLazy(iface, loader)
}
