/**
 * Metrics wrapper for providers
 *
 * Collects counters, histograms, and timing metrics for all method calls.
 */

import type {
  Provider,
  ProviderContext,
} from '../provider.js'
import { formatInterfaceString } from '../../core/types.js'

/**
 * Counter metric
 */
export interface Counter {
  /** Current value */
  value: number
  /** Increment the counter */
  inc(amount?: number): void
  /** Reset to zero */
  reset(): void
}

/**
 * Gauge metric
 */
export interface Gauge {
  /** Current value */
  value: number
  /** Set the value */
  set(value: number): void
  /** Increment */
  inc(amount?: number): void
  /** Decrement */
  dec(amount?: number): void
}

/**
 * Histogram bucket
 */
export interface HistogramBucket {
  le: number // less than or equal
  count: number
}

/**
 * Histogram metric
 */
export interface Histogram {
  /** Observe a value */
  observe(value: number): void
  /** Get count of observations */
  count: number
  /** Get sum of all observations */
  sum: number
  /** Get buckets */
  buckets: HistogramBucket[]
  /** Get percentile value */
  percentile(p: number): number
  /** Reset the histogram */
  reset(): void
}

/**
 * Metrics collector interface
 */
export interface MetricsCollector {
  /** Get or create a counter */
  counter(name: string, labels?: Record<string, string>): Counter
  /** Get or create a gauge */
  gauge(name: string, labels?: Record<string, string>): Gauge
  /** Get or create a histogram */
  histogram(name: string, buckets?: number[], labels?: Record<string, string>): Histogram
  /** Get a snapshot of all metrics */
  snapshot(): MetricsSnapshot
  /** Reset all metrics */
  reset(): void
}

/**
 * Metric snapshot entry
 */
export interface MetricEntry {
  name: string
  type: 'counter' | 'gauge' | 'histogram'
  labels: Record<string, string>
  value?: number
  count?: number
  sum?: number
  buckets?: HistogramBucket[]
}

/**
 * Snapshot of all metrics
 */
export interface MetricsSnapshot {
  timestamp: number
  metrics: MetricEntry[]
}

/**
 * Default histogram buckets (latency in ms)
 */
export const DEFAULT_LATENCY_BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]

/**
 * Default size buckets (bytes)
 */
export const DEFAULT_SIZE_BUCKETS = [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216]

/**
 * Simple counter implementation
 */
class SimpleCounter implements Counter {
  value: number = 0

  inc(amount: number = 1): void {
    this.value += amount
  }

  reset(): void {
    this.value = 0
  }
}

/**
 * Simple gauge implementation
 */
class SimpleGauge implements Gauge {
  value: number = 0

  set(value: number): void {
    this.value = value
  }

  inc(amount: number = 1): void {
    this.value += amount
  }

  dec(amount: number = 1): void {
    this.value -= amount
  }
}

/**
 * Simple histogram implementation
 */
class SimpleHistogram implements Histogram {
  count: number = 0
  sum: number = 0
  buckets: HistogramBucket[]
  private values: number[] = []
  private readonly maxValues: number = 10000

  constructor(bucketBoundaries: number[] = DEFAULT_LATENCY_BUCKETS) {
    this.buckets = bucketBoundaries.map((le) => ({ le, count: 0 }))
    // Add +Inf bucket
    this.buckets.push({ le: Infinity, count: 0 })
  }

  observe(value: number): void {
    this.count++
    this.sum += value

    // Update buckets
    for (const bucket of this.buckets) {
      if (value <= bucket.le) {
        bucket.count++
      }
    }

    // Store value for percentile calculation
    this.values.push(value)
    if (this.values.length > this.maxValues) {
      this.values.shift()
    }
  }

  percentile(p: number): number {
    if (this.values.length === 0) return 0
    const first = this.values[0]
    const last = this.values[this.values.length - 1]
    if (first === undefined || last === undefined) return 0
    if (p <= 0) return first
    if (p >= 100) return last

    const sorted = [...this.values].sort((a, b) => a - b)
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)] ?? 0
  }

  reset(): void {
    this.count = 0
    this.sum = 0
    this.values = []
    for (const bucket of this.buckets) {
      bucket.count = 0
    }
  }
}

/**
 * Simple in-memory metrics collector
 */
export class InMemoryMetricsCollector implements MetricsCollector {
  private counters: Map<string, Counter> = new Map()
  private gauges: Map<string, Gauge> = new Map()
  private histograms: Map<string, Histogram> = new Map()

  private makeKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name
    }
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',')
    return `${name}{${labelStr}}`
  }

  counter(name: string, labels?: Record<string, string>): Counter {
    const key = this.makeKey(name, labels)
    let counter = this.counters.get(key)
    if (!counter) {
      counter = new SimpleCounter()
      this.counters.set(key, counter)
    }
    return counter
  }

  gauge(name: string, labels?: Record<string, string>): Gauge {
    const key = this.makeKey(name, labels)
    let gauge = this.gauges.get(key)
    if (!gauge) {
      gauge = new SimpleGauge()
      this.gauges.set(key, gauge)
    }
    return gauge
  }

  histogram(name: string, buckets?: number[], labels?: Record<string, string>): Histogram {
    const key = this.makeKey(name, labels)
    let histogram = this.histograms.get(key)
    if (!histogram) {
      histogram = new SimpleHistogram(buckets)
      this.histograms.set(key, histogram)
    }
    return histogram
  }

  snapshot(): MetricsSnapshot {
    const metrics: MetricEntry[] = []

    for (const [key, counter] of this.counters) {
      const { name, labels } = this.parseKey(key)
      metrics.push({
        name,
        type: 'counter',
        labels,
        value: counter.value,
      })
    }

    for (const [key, gauge] of this.gauges) {
      const { name, labels } = this.parseKey(key)
      metrics.push({
        name,
        type: 'gauge',
        labels,
        value: gauge.value,
      })
    }

    for (const [key, histogram] of this.histograms) {
      const { name, labels } = this.parseKey(key)
      metrics.push({
        name,
        type: 'histogram',
        labels,
        count: histogram.count,
        sum: histogram.sum,
        buckets: histogram.buckets,
      })
    }

    return {
      timestamp: Date.now(),
      metrics,
    }
  }

  reset(): void {
    for (const counter of this.counters.values()) {
      counter.reset()
    }
    for (const gauge of this.gauges.values()) {
      gauge.set(0)
    }
    for (const histogram of this.histograms.values()) {
      histogram.reset()
    }
  }

  private parseKey(key: string): { name: string; labels: Record<string, string> } {
    const match = key.match(/^([^{]+)(?:\{(.+)\})?$/)
    if (!match) {
      return { name: key, labels: {} }
    }

    const name = match[1] ?? key
    const labels: Record<string, string> = {}

    if (match[2]) {
      const labelPairs = match[2].split(',')
      for (const pair of labelPairs) {
        const [k, v] = pair.split('=')
        if (k && v) {
          labels[k] = v.replace(/"/g, '')
        }
      }
    }

    return { name, labels }
  }
}

/**
 * Metrics wrapper configuration
 */
export interface MetricsWrapperConfig {
  /** Metrics collector */
  collector: MetricsCollector
  /** Prefix for metric names */
  prefix?: string
  /** Custom latency buckets */
  latencyBuckets?: number[]
  /** Methods to exclude from metrics */
  excludeMethods?: string[]
  /** Whether to track argument sizes */
  trackArgSizes?: boolean
  /** Whether to track result sizes */
  trackResultSizes?: boolean
}

/**
 * Estimate the size of a value in bytes
 */
function estimateSize(value: unknown): number {
  if (value === null || value === undefined) {
    return 0
  }

  if (value instanceof Uint8Array) {
    return value.length
  }

  if (typeof value === 'string') {
    return value.length * 2 // UTF-16
  }

  if (typeof value === 'number') {
    return 8
  }

  if (typeof value === 'boolean') {
    return 1
  }

  if (Array.isArray(value)) {
    return value.reduce((sum, v) => sum + estimateSize(v), 0)
  }

  if (typeof value === 'object') {
    return Object.values(value).reduce((sum: number, v) => sum + estimateSize(v), 0)
  }

  return 0
}

/**
 * Create a metrics-wrapped version of a provider
 */
export function createMetricsWrapper(
  provider: Provider,
  config: MetricsWrapperConfig
): Provider {
  const {
    collector,
    prefix = 'wasi',
    latencyBuckets = DEFAULT_LATENCY_BUCKETS,
    excludeMethods = [],
    trackArgSizes = false,
    trackResultSizes = false,
  } = config

  const interfaceStr = formatInterfaceString(provider.witInterface)
  const excludeSet = new Set(excludeMethods)

  // Create metrics
  const labels = { provider: provider.id, interface: interfaceStr }

  // Get the original imports
  const originalImports = provider.getImports()

  // Wrap each method
  const wrappedImports: Record<string, unknown> = {}

  for (const [methodName, method] of Object.entries(originalImports)) {
    if (typeof method !== 'function') {
      wrappedImports[methodName] = method
      continue
    }

    if (excludeSet.has(methodName)) {
      wrappedImports[methodName] = method
      continue
    }

    const methodLabels = { ...labels, method: methodName }

    // Create method-specific metrics
    const callsTotal = collector.counter(`${prefix}_calls_total`, methodLabels)
    const errorsTotal = collector.counter(`${prefix}_errors_total`, methodLabels)
    const latencyHistogram = collector.histogram(`${prefix}_call_duration_ms`, latencyBuckets, methodLabels)
    const inFlightGauge = collector.gauge(`${prefix}_in_flight`, methodLabels)

    let argSizeHistogram: Histogram | undefined
    let resultSizeHistogram: Histogram | undefined

    if (trackArgSizes) {
      argSizeHistogram = collector.histogram(`${prefix}_arg_size_bytes`, DEFAULT_SIZE_BUCKETS, methodLabels)
    }
    if (trackResultSizes) {
      resultSizeHistogram = collector.histogram(`${prefix}_result_size_bytes`, DEFAULT_SIZE_BUCKETS, methodLabels)
    }

    // Create wrapped method
    wrappedImports[methodName] = (...args: unknown[]) => {
      const startTime = performance.now()

      callsTotal.inc()
      inFlightGauge.inc()

      if (argSizeHistogram) {
        const argSize = args.reduce<number>((sum, arg) => sum + estimateSize(arg), 0)
        argSizeHistogram.observe(argSize)
      }

      const recordCompletion = (result: unknown, error?: unknown) => {
        const durationMs = performance.now() - startTime
        latencyHistogram.observe(durationMs)
        inFlightGauge.dec()

        if (error) {
          errorsTotal.inc()
        }

        if (resultSizeHistogram && result !== undefined) {
          resultSizeHistogram.observe(estimateSize(result))
        }
      }

      try {
        const result = (method as (...args: unknown[]) => unknown)(...args)

        // Handle async results
        if (result instanceof Promise) {
          return result
            .then((asyncResult) => {
              recordCompletion(asyncResult)
              return asyncResult
            })
            .catch((error) => {
              recordCompletion(undefined, error)
              throw error
            })
        }

        // Sync result
        recordCompletion(result)
        return result
      } catch (error) {
        recordCompletion(undefined, error)
        throw error
      }
    }
  }

  // Return wrapped provider
  return {
    id: provider.id,
    witInterface: provider.witInterface,
    state: provider.state,
    capabilities: () => provider.capabilities(),
    init: (ctx: ProviderContext) => provider.init(ctx),
    getImports: () => wrappedImports,
    close: () => provider.close(),
  }
}

/**
 * Wrap a provider with metrics collection
 */
export function withMetrics(
  provider: Provider,
  collector: MetricsCollector,
  options?: Partial<Omit<MetricsWrapperConfig, 'collector'>>
): Provider {
  return createMetricsWrapper(provider, { collector, ...options })
}

/**
 * Create a global metrics collector
 */
export const globalMetricsCollector = new InMemoryMetricsCollector()
