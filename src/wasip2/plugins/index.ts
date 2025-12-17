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

// wasi:keyvalue
export {
  // Types
  type KeyValueError,
  type KeyValueResult,
  type KeyResponse,
  type Bucket,
  type AtomicBucket,
  type BatchBucket,
  type CasHandle,
  type StoreConfig,
  type MemoryStoreConfig,
  // Utilities
  DEFAULT_STORE_CONFIG,
  noSuchStore,
  accessDenied,
  otherError,
  kvOk,
  kvErr,
  // Implementations
  memoryStoreImplementation,
  createMemoryStore,
  // Plugins
  KEYVALUE_STORE_INTERFACE,
  KEYVALUE_ATOMICS_INTERFACE,
  KEYVALUE_BATCH_INTERFACE,
  keyvalueStorePlugin,
  keyvalueAtomicsPlugin,
  keyvalueBatchPlugin,
  keyvaluePlugins,
} from './keyvalue/index.js'

// wasi:blobstore
export {
  // Types
  type ContainerName,
  type ObjectName,
  type Timestamp,
  type ObjectSize,
  type BlobstoreError,
  type BlobstoreResult,
  type ContainerMetadata,
  type ObjectMetadata,
  type ObjectId,
  type Container,
  type BlobstoreConfig,
  type MemoryBlobstoreConfig,
  // Utilities
  DEFAULT_BLOBSTORE_CONFIG,
  blobOk,
  blobErr,
  // Implementations
  memoryBlobstoreImplementation,
  createMemoryBlobstore,
  // Plugins
  BLOBSTORE_INTERFACE,
  BLOBSTORE_CONTAINER_INTERFACE,
  BLOBSTORE_TYPES_INTERFACE,
  blobstorePlugin,
  blobstoreContainerPlugin,
  blobstorePlugins,
} from './blobstore/index.js'
