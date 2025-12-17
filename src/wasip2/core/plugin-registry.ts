/**
 * Plugin registry for managing WASI interface implementations
 */

import type { WasiInterface, WasiPlugin } from './types.js'
import { formatInterfaceString, interfaceMatches } from './types.js'
import { PluginNotFoundError } from '../../shared/errors.js'

/**
 * Registry for WASI plugins
 *
 * Manages registration and lookup of plugins that implement WASI interfaces.
 * Supports lazy loading of plugins via factory functions.
 */
export class PluginRegistry {
  private plugins: Map<string, WasiPlugin> = new Map()
  private lazyLoaders: Map<string, () => Promise<WasiPlugin>> = new Map()

  /**
   * Register a plugin for a WASI interface
   */
  register(plugin: WasiPlugin): void {
    const key = this.makeKey(plugin.witInterface)
    this.plugins.set(key, plugin)
    // Remove any lazy loader if we have the real plugin
    this.lazyLoaders.delete(key)
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
      return loadedPlugin
    }

    // Try without version (find any version)
    for (const [, registeredPlugin] of this.plugins) {
      if (interfaceMatches(iface, registeredPlugin.witInterface, false)) {
        return registeredPlugin
      }
    }

    return undefined
  }

  /**
   * Get a plugin synchronously (only works for already-loaded plugins)
   */
  getSync(iface: WasiInterface): WasiPlugin | undefined {
    const key = this.makeKey(iface)
    const plugin = this.plugins.get(key)
    if (plugin) {
      return plugin
    }

    // Try without version
    for (const [, registeredPlugin] of this.plugins) {
      if (interfaceMatches(iface, registeredPlugin.witInterface, false)) {
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
    return hadPlugin || hadLoader
  }

  /**
   * Clear all registered plugins
   */
  clear(): void {
    this.plugins.clear()
    this.lazyLoaders.clear()
  }

  /**
   * Get the number of registered plugins
   */
  get size(): number {
    return this.plugins.size + this.lazyLoaders.size
  }

  private makeKey(iface: WasiInterface): string {
    // Key by package/name without version to allow version flexibility
    return `${iface.package}/${iface.name}`
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
