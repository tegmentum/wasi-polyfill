/**
 * Runtime component loading and instantiation
 *
 * Provides dynamic component loading without build-time code generation.
 * This module can introspect components at runtime and automatically
 * provide the necessary WASI imports.
 */

// Component loading
export {
  ComponentLoader,
  type ComponentLoaderOptions,
  type LoadedComponent,
  type ComponentExports,
  createComponentLoader,
} from './loader.js'

export {
  parseComponentImports,
  type ParsedImport,
  type ParsedComponentInfo,
} from './parser.js'

export {
  RuntimeBindgen,
  createRuntimeBindgen,
  type RuntimeBindgenOptions,
  type BindgenResult,
} from './bindgen.js'

// Provider system
export {
  // Types
  type Capabilities,
  type Logger,
  type Clock,
  type RandomSource,
  type MetricsSink,
  type TraceSpan,
  type Tracer,
  type HttpClient,
  type EnvironmentConfig,
  type ProviderContext,
  type ProviderState,
  type Provider,
  type ProviderFactory,
  type ProviderDefinition,
  // Classes
  BaseProvider,
  VirtualClock,
  SeededRandom,
  // Utilities
  noopLogger,
  createConsoleLogger,
  realClock,
  cryptoRandomSource,
  noopMetrics,
  noopTracer,
} from './provider.js'

export {
  // Types
  type BundleConfig,
  type ProviderOverride,
  type ProviderRegistryConfig,
  type SelectionResult,
  type Environment,
  // Classes
  ProviderRegistry,
  // Functions
  detectEnvironment,
  createProviderRegistry,
  // Built-in bundles
  browserDefaultBundle,
  nodeDefaultBundle,
  deterministicTestBundle,
} from './provider-registry.js'

export {
  // Types
  type ResourceType,
  type ResourceEntry,
  type HandleAllocation,
  type ResourceStats,
  type StreamResource,
  type PollableResource,
  // Classes
  ResourceTable,
  TypedHandle,
  // Functions
  createReadyPollable,
  createPromisePollable,
  // Global instance
  globalResourceTable,
} from './resources.js'

export {
  // Types
  type QuotaConfig,
  type RedactionConfig,
  type FeatureToggles,
  type NetworkPolicy,
  type FilesystemPolicy,
  type HttpPolicy,
  type EnhancedPolicyConfig,
  // Classes
  QuotaTracker,
  Redactor,
  EnhancedPolicy,
  // Functions
  createEnhancedPolicy,
  createSecurePolicy,
  // Constants
  defaultRedactionPatterns,
} from './policy.js'

// Wrappers for observability and testing
export {
  // Audit
  type AuditLogEntry,
  type AuditSink,
  type AuditWrapperConfig,
  ConsoleAuditSink,
  ArrayAuditSink,
  createAuditWrapper,
  withAudit,
  // Metrics
  type Counter,
  type Gauge,
  type Histogram,
  type HistogramBucket,
  type MetricsCollector,
  type MetricEntry,
  type MetricsSnapshot,
  type MetricsWrapperConfig,
  InMemoryMetricsCollector,
  createMetricsWrapper,
  withMetrics,
  globalMetricsCollector,
  DEFAULT_LATENCY_BUCKETS,
  DEFAULT_SIZE_BUCKETS,
  // Replay/Record
  CASSETTE_VERSION,
  type RecordedCall,
  type SerializedValue,
  type Cassette,
  type RecordingWrapperConfig,
  type ReplayWrapperConfig,
  serializeValue,
  deserializeValue,
  CassetteRecorder,
  CassettePlayer,
  createRecordingWrapper,
  createReplayWrapper,
  withRecording,
  withReplay,
} from './wrappers/index.js'
