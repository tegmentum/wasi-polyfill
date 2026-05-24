/**
 * Core type definitions for the WASIP2 polyfill
 */

/**
 * Represents a WASI interface identifier
 */
export interface WasiInterface {
  /** Package name, e.g., "wasi:random" */
  package: string
  /** Interface name, e.g., "random" */
  name: string
  /** Semantic version, e.g., "0.2.0" */
  version: string
}

/**
 * Configuration for a specific plugin instance
 *
 * Plugins may define additional configuration properties beyond the base ones.
 */
export interface PluginConfig {
  /** Which implementation to use (e.g., "crypto", "memory", "opfs") */
  implementation?: string
  /** Implementation-specific configuration */
  options?: Record<string, unknown>
  /** Allow additional implementation-specific properties */
  [key: string]: unknown
}

/**
 * A plugin instance provides the actual WASI interface implementation
 */
export interface PluginInstance {
  /** Get the imports object for WebAssembly instantiation */
  getImports(): Record<string, unknown>
  /** Clean up any resources held by this instance */
  destroy(): void
}

/**
 * Factory function for creating implementation instances
 */
export type ImplementationFactory = (config: PluginConfig) => PluginInstance

/**
 * An implementation provides a specific backend for a WASI interface
 */
export interface Implementation {
  /** Human-readable name */
  name: string
  /** Description of this implementation */
  description: string
  /** Factory to create instances */
  create: ImplementationFactory
}

/**
 * A plugin manages multiple implementations of a single WASI interface
 */
export interface WasiPlugin {
  /** The WASI interface this plugin implements */
  witInterface: WasiInterface
  /** Available implementations keyed by name */
  implementations: Map<string, Implementation>
  /** Default implementation name */
  defaultImplementation: string
  /** Create a plugin instance with the given configuration */
  create(config: PluginConfig): PluginInstance
}

/**
 * Policy determines what interfaces are allowed and how they're configured
 */
export interface Policy {
  /** Check if an interface is allowed */
  allow(iface: WasiInterface): boolean
  /** Get configuration for an interface */
  configure(iface: WasiInterface): PluginConfig
}

/**
 * Override configuration for a specific plugin
 */
export interface PluginOverride {
  /** Interface to override */
  interface: WasiInterface | string
  /** Implementation to use */
  implementation?: string
  /** Implementation-specific options */
  options?: Record<string, unknown>
  /** Whether this interface is enabled */
  enabled?: boolean
}

/**
 * Configuration for creating a Polyfill instance
 */
export interface PolyfillConfig {
  /** Plugin overrides */
  plugins?: PluginOverride[]
  /** Custom policy (overrides plugins if both provided) */
  policy?: Policy
  /**
   * Default jco compatibility mode for getImports (default: false).
   * Per-call `GetImportsOptions.jcoCompat` overrides this.
   */
  jcoCompat?: boolean
  /**
   * Plugin registry to use. Defaults to the shared global registry; pass a
   * private `PluginRegistry` for an isolated setup (tests, multi-tenant) that
   * does not share plugins with other polyfills.
   */
  registry?: import('./plugin-registry.js').PluginRegistry
}

/**
 * Parse a WASI interface string into components
 * Format: "wasi:package/interface@version" or "wasi:package@version"
 */
export function parseInterfaceString(str: string): WasiInterface {
  // Match patterns like:
  // - wasi:random/random@0.2.0
  // - wasi:clocks/monotonic-clock@0.2.0
  // - wasi:filesystem@0.2.0
  const match = str.match(/^(wasi:[^/@]+)(?:\/([^@]+))?@(.+)$/)
  if (!match) {
    throw new Error(`Invalid WASI interface string: ${str}`)
  }

  const [, pkg, name, version] = match
  return {
    package: pkg!,
    name: name ?? pkg!.split(':')[1]!,
    version: version!,
  }
}

/**
 * Format a WASI interface as a string
 */
export function formatInterfaceString(iface: WasiInterface): string {
  const baseName = iface.package.split(':')[1]
  if (iface.name === baseName) {
    return `${iface.package}@${iface.version}`
  }
  return `${iface.package}/${iface.name}@${iface.version}`
}

/**
 * Check if two interfaces match (package and name, version may differ)
 */
export function interfaceMatches(
  a: WasiInterface,
  b: WasiInterface,
  checkVersion = false
): boolean {
  const packageMatch = a.package === b.package
  const nameMatch = a.name === b.name
  if (!checkVersion) {
    return packageMatch && nameMatch
  }
  return packageMatch && nameMatch && a.version === b.version
}
