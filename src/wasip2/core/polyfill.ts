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
import { PluginNotFoundError, PolicyDeniedError } from '../../shared/errors.js'

/**
 * Options for getting imports
 */
export interface GetImportsOptions {
  /** Whether to throw on missing plugins (default: true) */
  throwOnMissing?: boolean
  /** Whether to throw on policy denial (default: true) */
  throwOnDenied?: boolean
  /**
   * Enable jco compatibility mode (default: false)
   * When true:
   * - Import keys omit version suffix ("wasi:cli/environment" not "wasi:cli/environment@0.2.0")
   * - Function names are converted to camelCase ("getEnvironment" not "get-environment")
   * This is required when using components transpiled with jco.
   */
  jcoCompat?: boolean
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
    const jcoCompat = options?.jcoCompat ?? false

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
      let pluginImports = instance.getImports()

      // In jco compatibility mode, convert function names to camelCase
      if (jcoCompat) {
        pluginImports = transformImportsForJco(pluginImports)
      }

      // Use import key without version in jco mode
      const importKey = this.makeImportKey(iface, !jcoCompat)

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

  private makeImportKey(iface: WasiInterface, includeVersion = true): string {
    // Format: "wasi:package/interface" or "wasi:package/interface@version"
    // jco transpilation expects keys WITHOUT version suffix
    if (includeVersion) {
      return formatInterfaceString(iface)
    }
    return `${iface.package}/${iface.name}`
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

/**
 * Create a Polyfill pre-configured for jco-transpiled components
 *
 * This is a convenience function that:
 * - Creates a polyfill with the AllowAllPolicy (for development)
 * - Sets up jcoCompat mode by default
 *
 * Usage:
 * ```typescript
 * import { createJcoPolyfill, registerCorePlugins } from '@tegmentum/wasi-polyfill'
 *
 * // Register plugins first
 * registerCorePlugins()
 *
 * const polyfill = createJcoPolyfill()
 * const { imports } = await polyfill.getImports(interfaces)
 * ```
 */
export function createJcoPolyfill(config?: Omit<PolyfillConfig, 'policy'>): Polyfill {
  return new Polyfill({
    ...config,
    policy: new AllowAllPolicy(),
  })
}

/**
 * Convert kebab-case to camelCase
 * Examples:
 * - "get-environment" -> "getEnvironment"
 * - "[method]input-stream.read" -> "[method]inputStream.read"
 */
function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Transform plugin imports for jco compatibility
 *
 * jco-transpiled components expect:
 * - camelCase function names (getEnvironment, not get-environment)
 * - camelCase in method names ([method]outputStream.checkWrite, not [method]output-stream.check-write)
 */
function transformImportsForJco(
  imports: Record<string, unknown>
): Record<string, unknown> {
  const transformed: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(imports)) {
    const camelKey = kebabToCamel(key)
    transformed[camelKey] = value
  }

  return transformed
}
