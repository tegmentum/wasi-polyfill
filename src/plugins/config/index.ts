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

// Plugins
export {
  CONFIG_STORE_INTERFACE,
  CONFIG_RUNTIME_INTERFACE,
  configStorePlugin,
  configRuntimePlugin,
  configPlugins,
} from './plugin.js'
