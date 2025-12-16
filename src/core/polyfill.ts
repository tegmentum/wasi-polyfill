/**
 * Main Polyfill orchestrator class
 *
 * This is the primary entry point for using the WASIP2 polyfill.
 * It manages plugin loading, policy enforcement, and import generation.
 */

import type {
  Policy,
  PluginInstance,
  PolyfillConfig,
  WasiInterface,
  WasiPlugin,
} from './types.js'
import { formatInterfaceString, parseInterfaceString } from './types.js'
import { PluginRegistry, globalRegistry } from './plugin-registry.js'
import { AllowAllPolicy, createSafePolicy } from './policy.js'
import type { ComponentManifest } from './manifest.js'
import { loadManifestForComponent } from './manifest.js'
import { PluginNotFoundError, PolicyDeniedError } from '../util/errors.js'

/**
 * Options for getting imports
 */
export interface GetImportsOptions {
  /** Whether to throw on missing plugins (default: true) */
  throwOnMissing?: boolean
  /** Whether to throw on policy denial (default: true) */
  throwOnDenied?: boolean
}

/**
 * Result of getting imports for a component
 */
export interface ImportResult {
  /** The imports object for WebAssembly instantiation */
  imports: Record<string, Record<string, unknown>>
  /** Interfaces that were loaded */
  loaded: WasiInterface[]
  /** Interfaces that were denied by policy */
  denied: WasiInterface[]
  /** Interfaces that had no plugin available */
  missing: WasiInterface[]
}

/**
 * WASIP2 Polyfill orchestrator
 *
 * Usage:
 * ```typescript
 * const polyfill = new Polyfill({
 *   policy: createCliPolicy({ env: { FOO: 'bar' } })
 * })
 *
 * // Get imports for a list of interfaces
 * const { imports } = await polyfill.getImports([
 *   { package: 'wasi:random', name: 'random', version: '0.2.0' }
 * ])
 *
 * // Or from a manifest
 * const result = await polyfill.forManifest(manifest)
 *
 * // Use imports with WebAssembly instantiation
 * const instance = await WebAssembly.instantiate(wasmBytes, result.imports)
 * ```
 */
export class Polyfill {
  private readonly registry: PluginRegistry
  private readonly policy: Policy
  private readonly instances: Map<string, PluginInstance> = new Map()
  private destroyed = false

  constructor(config?: PolyfillConfig) {
    this.registry = globalRegistry
    this.policy = config?.policy ?? createSafePolicy()

    // Plugin overrides are handled by the policy
    // The policy.configure() method returns per-interface configuration
  }

  /**
   * Get imports for a list of required interfaces
   */
  async getImports(
    required: WasiInterface[],
    options?: GetImportsOptions
  ): Promise<ImportResult> {
    this.checkDestroyed()

    const throwOnMissing = options?.throwOnMissing ?? true
    const throwOnDenied = options?.throwOnDenied ?? true

    const imports: Record<string, Record<string, unknown>> = {}
    const loaded: WasiInterface[] = []
    const denied: WasiInterface[] = []
    const missing: WasiInterface[] = []

    for (const iface of required) {
      // Check policy
      if (!this.policy.allow(iface)) {
        denied.push(iface)
        if (throwOnDenied) {
          throw new PolicyDeniedError(formatInterfaceString(iface))
        }
        continue
      }

      // Get plugin
      const plugin = await this.registry.get(iface)
      if (!plugin) {
        missing.push(iface)
        if (throwOnMissing) {
          throw new PluginNotFoundError(formatInterfaceString(iface))
        }
        continue
      }

      // Get or create instance
      const instance = await this.getOrCreateInstance(iface, plugin)

      // Merge imports
      const pluginImports = instance.getImports()
      const importKey = this.makeImportKey(iface)

      if (!imports[importKey]) {
        imports[importKey] = {}
      }

      Object.assign(imports[importKey], pluginImports)
      loaded.push(iface)
    }

    return { imports, loaded, denied, missing }
  }

  /**
   * Get imports for a component manifest
   */
  async forManifest(
    manifest: ComponentManifest,
    options?: GetImportsOptions
  ): Promise<ImportResult> {
    return this.getImports(manifest.imports, options)
  }

  /**
   * Get imports for a component by loading its manifest
   *
   * Expects a .manifest.json file alongside the .wasm file.
   */
  async forComponent(
    componentUrl: string,
    options?: GetImportsOptions
  ): Promise<ImportResult> {
    const manifest = await loadManifestForComponent(componentUrl)
    return this.forManifest(manifest, options)
  }

  /**
   * Get imports for a list of interface strings
   */
  async forInterfaces(
    interfaces: string[],
    options?: GetImportsOptions
  ): Promise<ImportResult> {
    const parsed = interfaces.map(parseInterfaceString)
    return this.getImports(parsed, options)
  }

  /**
   * Check if an interface is allowed by the current policy
   */
  isAllowed(iface: WasiInterface | string): boolean {
    const parsed =
      typeof iface === 'string' ? parseInterfaceString(iface) : iface
    return this.policy.allow(parsed)
  }

  /**
   * Check if a plugin is available for an interface
   */
  hasPlugin(iface: WasiInterface | string): boolean {
    const parsed =
      typeof iface === 'string' ? parseInterfaceString(iface) : iface
    return this.registry.has(parsed)
  }

  /**
   * Register a plugin
   */
  registerPlugin(plugin: WasiPlugin): void {
    this.registry.register(plugin)
  }

  /**
   * Clean up all plugin instances
   */
  destroy(): void {
    if (this.destroyed) {
      return
    }

    for (const instance of this.instances.values()) {
      try {
        instance.destroy()
      } catch {
        // Ignore cleanup errors
      }
    }

    this.instances.clear()
    this.destroyed = true
  }

  /**
   * Get the current policy
   */
  getPolicy(): Policy {
    return this.policy
  }

  /**
   * Get the plugin registry
   */
  getRegistry(): PluginRegistry {
    return this.registry
  }

  private async getOrCreateInstance(
    iface: WasiInterface,
    plugin: WasiPlugin
  ): Promise<PluginInstance> {
    const key = `${iface.package}/${iface.name}`

    let instance = this.instances.get(key)
    if (instance) {
      return instance
    }

    // Get configuration from policy
    const config = this.policy.configure(iface)

    // Create instance
    instance = plugin.create(config)
    this.instances.set(key, instance)

    return instance
  }

  private makeImportKey(iface: WasiInterface): string {
    // Format: "wasi:package/interface@version"
    return formatInterfaceString(iface)
  }

  private checkDestroyed(): void {
    if (this.destroyed) {
      throw new Error('Polyfill has been destroyed')
    }
  }
}

/**
 * Create a new Polyfill instance with default configuration
 */
export function createPolyfill(config?: PolyfillConfig): Polyfill {
  return new Polyfill(config)
}

/**
 * Create a Polyfill that allows all interfaces (for development/testing)
 */
export function createDevPolyfill(): Polyfill {
  return new Polyfill({
    policy: new AllowAllPolicy(),
  })
}
