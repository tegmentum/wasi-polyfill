/**
 * Core module exports
 */

// Types
export type {
  WasiInterface,
  WasiPlugin,
  PluginConfig,
  PluginInstance,
  Implementation,
  ImplementationFactory,
  Policy,
  PluginOverride,
  PolyfillConfig,
} from './types.js'

export {
  parseInterfaceString,
  formatInterfaceString,
  interfaceMatches,
} from './types.js'

// Plugin Registry
export {
  PluginRegistry,
  globalRegistry,
  registerPlugin,
  registerLazyPlugin,
} from './plugin-registry.js'

// Policy
export type { PolicyConfig } from './policy.js'

export {
  DenyAllPolicy,
  AllowAllPolicy,
  ConfigurablePolicy,
  createPolicy,
  createSafePolicy,
  createCliPolicy,
  mergePolicies,
} from './policy.js'

// Manifest
export type {
  ComponentManifest,
  CapabilityRequirements,
} from './manifest.js'

export {
  parseManifest,
  loadManifest,
  loadManifestForComponent,
  createManifest,
  serializeManifest,
  validateManifest,
} from './manifest.js'

// Polyfill
export type {
  GetImportsOptions,
  ImportResult,
} from './polyfill.js'

export {
  Polyfill,
  createPolyfill,
  createDevPolyfill,
  createJcoPolyfill,
} from './polyfill.js'

/**
 * Register all core WASI plugins (cli, io, clocks, random, filesystem)
 *
 * Call this once at application startup to make all standard plugins available.
 * This is a convenience function for common use cases.
 *
 * @example
 * ```typescript
 * import { registerCorePlugins, createJcoPolyfill } from '@tegmentum/wasi-polyfill'
 *
 * // Register plugins at startup
 * await registerCorePlugins()
 *
 * // Create polyfill and get imports
 * const polyfill = createJcoPolyfill()
 * const { imports } = await polyfill.getImports(interfaces, { jcoCompat: true })
 * ```
 */
export async function registerCorePlugins(): Promise<void> {
  const { globalRegistry } = await import('./plugin-registry.js')

  // Dynamically import plugins to support tree-shaking when not used
  const [
    { cliPlugins },
    { ioPlugins },
    { clocksPlugins },
    { randomPlugins },
    { filesystemPlugins },
  ] = await Promise.all([
    import('../plugins/cli/index.js'),
    import('../plugins/io/index.js'),
    import('../plugins/clocks/index.js'),
    import('../plugins/random/index.js'),
    import('../plugins/filesystem/index.js'),
  ])

  const allPlugins = [
    ...cliPlugins,
    ...ioPlugins,
    ...clocksPlugins,
    ...randomPlugins,
    ...filesystemPlugins,
  ]

  for (const plugin of allPlugins) {
    globalRegistry.register(plugin)
  }
}
