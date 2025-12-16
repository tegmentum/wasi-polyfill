/**
 * Provider wrappers for observability and testing
 *
 * Provides cross-cutting concerns like:
 * - Audit logging
 * - Metrics collection
 * - Recording/replay for deterministic testing
 */

// Audit wrapper
export {
  type AuditLogEntry,
  type AuditSink,
  type AuditWrapperConfig,
  ConsoleAuditSink,
  ArrayAuditSink,
  createAuditWrapper,
  withAudit,
} from './audit.js'

// Metrics wrapper
export {
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
} from './metrics.js'

// Replay/Record wrapper
export {
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
} from './replay.js'
