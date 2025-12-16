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
} from './polyfill.js'
