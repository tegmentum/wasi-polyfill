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

// wasi:nn
export {
  // Handle types
  type GraphHandle,
  type GraphExecutionContextHandle,
  // Tensor types
  TensorType,
  type TensorDimensions,
  type TensorData,
  type Tensor,
  type NamedTensor,
  // Graph types
  GraphEncoding,
  ExecutionTarget,
  type GraphBuilder,
  // Error types
  NnErrorCode,
  type NnError,
  createNnError,
  // Result types
  type NnResult,
  nnOk,
  nnErr,
  // Config types
  type NnPluginConfig,
  type BackendInfo,
  type InferenceStats,
  // Plugins
  nnTensorPlugin,
  nnGraphPlugin,
  nnInferencePlugin,
  nnErrorsPlugin,
  nnPlugins,
  NN_TENSOR_INTERFACE,
  NN_GRAPH_INTERFACE,
  NN_INFERENCE_INTERFACE,
  NN_ERRORS_INTERFACE,
  // Implementations
  webnnImplementation,
  mockNnImplementation,
} from './nn/index.js'

// wasi:messaging
export {
  // Handle types
  type ClientHandle,
  type ChannelHandle,
  type TopicHandle,
  type SubscriptionHandle,
  // Message types
  type MessageMetadata,
  type Message,
  type ReceivedMessage,
  // Channel types
  ChannelType,
  type ChannelOptions,
  type ChannelInfo,
  // Subscription types
  type SubscribeOptions,
  type SubscriptionInfo,
  // Error types
  MessagingErrorCode,
  type MessagingError,
  createMessagingError,
  // Result types
  type MessagingResult,
  msgOk,
  msgErr,
  // Config types
  type MessagingPluginConfig,
  // Acknowledgment types
  AckAction,
  // Plugins
  messagingTypesPlugin,
  messagingProducerPlugin,
  messagingConsumerPlugin,
  messagingHandlerPlugin,
  messagingPlugins,
  MESSAGING_TYPES_INTERFACE,
  MESSAGING_PRODUCER_INTERFACE,
  MESSAGING_CONSUMER_INTERFACE,
  MESSAGING_HANDLER_INTERFACE,
  // Implementations
  memoryMessagingImplementation,
} from './messaging/index.js'

// wasi:sql
export {
  // Handle types
  type ConnectionHandle as SqlConnectionHandle,
  type StatementHandle,
  type ResultSetHandle,
  type TransactionHandle,
  // Value types
  SqlType,
  type SqlValue,
  sqlNull,
  sqlBoolean,
  sqlInteger,
  sqlBigint,
  sqlReal,
  sqlText,
  sqlBlob,
  sqlJson,
  extractValue,
  valueToSqlValue,
  // Column/Row types
  type ColumnInfo as SqlColumnInfo,
  type Row as SqlRow,
  rowFromObject,
  rowToObject,
  // Query types
  type QueryParams,
  type QueryResult,
  type ResultSetInfo,
  // Connection types
  DatabaseDriver,
  type ConnectionOptions as SqlConnectionOptions,
  type ConnectionInfo as SqlConnectionInfo,
  // Transaction types
  IsolationLevel,
  type TransactionOptions,
  // Error types
  SqlErrorCode,
  type SqlError,
  createSqlError,
  // Result types
  type SqlResult,
  sqlOk,
  sqlErr,
  // Config types
  type SqlPluginConfig,
  // Plugins
  sqlTypesPlugin,
  sqlConnectionPlugin,
  sqlQueryPlugin,
  sqlStatementPlugin,
  sqlTransactionPlugin,
  sqlPlugins,
  SQL_TYPES_INTERFACE,
  SQL_CONNECTION_INTERFACE,
  SQL_QUERY_INTERFACE,
  SQL_STATEMENT_INTERFACE,
  SQL_TRANSACTION_INTERFACE,
  // Implementations
  memorySqlImplementation,
} from './sql/index.js'
