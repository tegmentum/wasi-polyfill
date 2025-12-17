/**
 * wasi:config plugin exports
 *
 * Provides configuration access for WASI components.
 */

// Types
export type {
  ConfigError,
  ConfigResult,
  ConfigStore,
  ConfigSource,
  ConfigPluginConfig,
} from './types.js'

export {
  configErrorUpstream,
  configErrorIo,
  configOk,
  configErr,
} from './types.js'

// Implementations
export {
  runtimeConfigImplementation,
  MutableConfigStore,
} from './impl-runtime.js'

// Remote config
export type {
  ConfigFormat,
  RemoteConfigOptions,
  RemoteConfigPluginConfig,
} from './impl-remote.js'

export {
  remoteConfigImplementation,
  RemoteConfigSource,
  createRemoteConfigSource,
  fetchConfig,
} from './impl-remote.js'

// Layered config
export type {
  ConfigLayer,
  ConfigPolicy,
  LayeredConfigPluginConfig,
} from './impl-layered.js'

export {
  layeredConfigImplementation,
  createLayeredConfig,
  createSimpleLayeredConfig,
} from './impl-layered.js'

// Manifest config
export type {
  ManifestFormat,
  ManifestSourceOptions,
  InterpolationOptions,
  ManifestConfigPluginConfig,
} from './impl-manifest.js'

export {
  manifestConfigImplementation,
  ManifestConfigSource,
  parseManifestConfig,
  createManifestSource,
} from './impl-manifest.js'

// Env bridge config
export type {
  EnvVarMapping,
  EnvPrefixMapping,
  EnvBridgeConfigPluginConfig,
} from './impl-env-bridge.js'

export {
  envBridgeConfigImplementation,
  EnvBridgeConfigSource,
  createEnvBridgeSource,
  envMapping,
  envPrefix,
} from './impl-env-bridge.js'

// Fixed config
export type {
  ConfigSnapshot,
  FixedConfigPluginConfig,
} from './impl-fixed.js'

export {
  fixedConfigImplementation,
  createFixedConfig,
  loadFixedConfig,
  parseFixedConfig,
  emptyFixedConfig,
  mergeFixedConfigs,
  assertConfigsEqual,
} from './impl-fixed.js'

// Plugins
export {
  CONFIG_STORE_INTERFACE,
  CONFIG_RUNTIME_INTERFACE,
  configStorePlugin,
  configRuntimePlugin,
  configPlugins,
} from './plugin.js'
