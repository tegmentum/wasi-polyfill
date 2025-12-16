/**
 * Plugin exports
 *
 * Each plugin implements a specific WASI interface and can be
 * imported independently for tree-shaking.
 */

// wasi:config
export {
  // Types
  type ConfigError,
  type ConfigResult,
  type ConfigStore,
  type ConfigSource,
  type ConfigPluginConfig,
  // Helpers
  configErrorUpstream,
  configErrorIo,
  configOk,
  configErr,
  // Implementations
  runtimeConfigImplementation,
  MutableConfigStore,
  // Plugins
  CONFIG_STORE_INTERFACE,
  CONFIG_RUNTIME_INTERFACE,
  configStorePlugin,
  configRuntimePlugin,
  configPlugins,
} from './config/index.js'

// wasi:logging
export {
  // Types
  type LogLevel,
  type LogEntry,
  type LogSink,
  type LogFilterConfig,
  type ConsoleLogConfig,
  type BufferLogConfig,
  // Utilities
  LOG_LEVEL_VALUES,
  levelFromNumber,
  shouldLog,
  shouldLogContext,
  // Implementations
  consoleLogImplementation,
  bufferLogImplementation,
  createBufferLogger,
  // Plugins
  LOGGING_INTERFACE,
  loggingPlugin,
  loggingPlugins,
} from './logging/index.js'
