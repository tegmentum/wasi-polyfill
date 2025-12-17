/**
 * Tests for provider wrappers (audit, metrics, replay)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Provider, ProviderContext } from '../../src/wasip2/runtime/provider.js'
import {
  // Audit
  ConsoleAuditSink,
  ArrayAuditSink,
  createAuditWrapper,
  withAudit,
  type AuditLogEntry,
  // Metrics
  InMemoryMetricsCollector,
  createMetricsWrapper,
  withMetrics,
  DEFAULT_LATENCY_BUCKETS,
  DEFAULT_SIZE_BUCKETS,
  globalMetricsCollector,
  // Replay
  CASSETTE_VERSION,
  serializeValue,
  deserializeValue,
  CassetteRecorder,
  CassettePlayer,
  createRecordingWrapper,
  createReplayWrapper,
  withRecording,
  withReplay,
} from '../../src/wasip2/runtime/wrappers/index.js'

/**
 * Create a mock provider for testing
 */
function createMockProvider(
  methods: Record<string, (...args: unknown[]) => unknown>
): Provider {
  return {
    id: 'test-provider',
    witInterface: {
      package: 'test',
      name: 'mock',
      version: '0.1.0',
    },
    state: 'ready',
    capabilities: () => ({
      deterministic: false,
      asyncRequired: false,
    }),
    init: () => {},
    getImports: () => methods,
    close: () => {},
  }
}

describe('Audit Wrapper', () => {
  describe('ConsoleAuditSink', () => {
    it('should log successful calls with debug', () => {
      const logger = {
        debug: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
      }
      const sink = new ConsoleAuditSink(logger)

      const entry: AuditLogEntry = {
        timestamp: Date.now(),
        providerId: 'test',
        interface: 'test:mock@0.1.0',
        method: 'doSomething',
        args: [1, 2, 3],
        result: 'success',
        durationMs: 5.5,
      }

      sink.log(entry)

      expect(logger.debug).toHaveBeenCalledTimes(1)
      expect(logger.warn).not.toHaveBeenCalled()
      expect(logger.debug.mock.calls[0]?.[0]).toContain('test.doSomething')
      expect(logger.debug.mock.calls[0]?.[0]).toContain('OK')
    })

    it('should log failed calls with warn', () => {
      const logger = {
        debug: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
      }
      const sink = new ConsoleAuditSink(logger)

      const entry: AuditLogEntry = {
        timestamp: Date.now(),
        providerId: 'test',
        interface: 'test:mock@0.1.0',
        method: 'doSomething',
        args: [1, 2, 3],
        error: 'Something went wrong',
        durationMs: 5.5,
      }

      sink.log(entry)

      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.debug).not.toHaveBeenCalled()
      expect(logger.warn.mock.calls[0]?.[0]).toContain('FAILED')
    })
  })

  describe('ArrayAuditSink', () => {
    it('should collect entries', () => {
      const sink = new ArrayAuditSink()

      sink.log({
        timestamp: 1,
        providerId: 'test',
        interface: 'test:mock@0.1.0',
        method: 'method1',
        args: [],
        durationMs: 1,
      })

      sink.log({
        timestamp: 2,
        providerId: 'test',
        interface: 'test:mock@0.1.0',
        method: 'method2',
        args: [],
        durationMs: 2,
      })

      expect(sink.entries).toHaveLength(2)
      expect(sink.getEntries()).toHaveLength(2)
    })

    it('should trim entries when over max', () => {
      const sink = new ArrayAuditSink(3)

      for (let i = 0; i < 5; i++) {
        sink.log({
          timestamp: i,
          providerId: 'test',
          interface: 'test:mock@0.1.0',
          method: `method${i}`,
          args: [],
          durationMs: i,
        })
      }

      expect(sink.entries).toHaveLength(3)
      expect(sink.entries[0]?.method).toBe('method2')
      expect(sink.entries[2]?.method).toBe('method4')
    })

    it('should filter by method', () => {
      const sink = new ArrayAuditSink()

      sink.log({
        timestamp: 1,
        providerId: 'test',
        interface: 'test:mock@0.1.0',
        method: 'read',
        args: [],
        durationMs: 1,
      })

      sink.log({
        timestamp: 2,
        providerId: 'test',
        interface: 'test:mock@0.1.0',
        method: 'write',
        args: [],
        durationMs: 2,
      })

      sink.log({
        timestamp: 3,
        providerId: 'test',
        interface: 'test:mock@0.1.0',
        method: 'read',
        args: [],
        durationMs: 3,
      })

      const readEntries = sink.getEntriesForMethod('read')
      expect(readEntries).toHaveLength(2)
    })

    it('should filter by provider', () => {
      const sink = new ArrayAuditSink()

      sink.log({
        timestamp: 1,
        providerId: 'provider-a',
        interface: 'test:mock@0.1.0',
        method: 'read',
        args: [],
        durationMs: 1,
      })

      sink.log({
        timestamp: 2,
        providerId: 'provider-b',
        interface: 'test:mock@0.1.0',
        method: 'read',
        args: [],
        durationMs: 2,
      })

      const entriesA = sink.getEntriesForProvider('provider-a')
      expect(entriesA).toHaveLength(1)
    })

    it('should filter failed entries', () => {
      const sink = new ArrayAuditSink()

      sink.log({
        timestamp: 1,
        providerId: 'test',
        interface: 'test:mock@0.1.0',
        method: 'success',
        args: [],
        result: 'ok',
        durationMs: 1,
      })

      sink.log({
        timestamp: 2,
        providerId: 'test',
        interface: 'test:mock@0.1.0',
        method: 'failure',
        args: [],
        error: 'failed',
        durationMs: 2,
      })

      const failed = sink.getFailedEntries()
      expect(failed).toHaveLength(1)
      expect(failed[0]?.method).toBe('failure')
    })

    it('should clear entries', () => {
      const sink = new ArrayAuditSink()

      sink.log({
        timestamp: 1,
        providerId: 'test',
        interface: 'test:mock@0.1.0',
        method: 'method1',
        args: [],
        durationMs: 1,
      })

      expect(sink.entries).toHaveLength(1)
      sink.clear()
      expect(sink.entries).toHaveLength(0)
    })
  })

  describe('createAuditWrapper', () => {
    it('should wrap sync method calls', () => {
      const sink = new ArrayAuditSink()
      const provider = createMockProvider({
        add: (a: number, b: number) => a + b,
      })

      const wrapped = createAuditWrapper(provider, { sink })
      const imports = wrapped.getImports()
      const add = imports['add'] as (a: number, b: number) => number

      const result = add(2, 3)

      expect(result).toBe(5)
      expect(sink.entries).toHaveLength(1)
      expect(sink.entries[0]?.method).toBe('add')
      expect(sink.entries[0]?.args).toEqual([2, 3])
    })

    it('should wrap async method calls', async () => {
      const sink = new ArrayAuditSink()
      const provider = createMockProvider({
        asyncAdd: async (a: number, b: number) => {
          await new Promise((r) => setTimeout(r, 10))
          return a + b
        },
      })

      const wrapped = createAuditWrapper(provider, { sink })
      const imports = wrapped.getImports()
      const asyncAdd = imports['asyncAdd'] as (a: number, b: number) => Promise<number>

      const result = await asyncAdd(2, 3)

      expect(result).toBe(5)
      expect(sink.entries).toHaveLength(1)
      expect(sink.entries[0]?.durationMs).toBeGreaterThan(5)
    })

    it('should log errors for sync methods', () => {
      const sink = new ArrayAuditSink()
      const provider = createMockProvider({
        failing: () => {
          throw new Error('test error')
        },
      })

      const wrapped = createAuditWrapper(provider, { sink })
      const imports = wrapped.getImports()
      const failing = imports['failing'] as () => never

      expect(() => failing()).toThrow('test error')
      expect(sink.entries).toHaveLength(1)
      expect(sink.entries[0]?.error).toBe('test error')
    })

    it('should log errors for async methods', async () => {
      const sink = new ArrayAuditSink()
      const provider = createMockProvider({
        asyncFailing: async () => {
          throw new Error('async error')
        },
      })

      const wrapped = createAuditWrapper(provider, { sink })
      const imports = wrapped.getImports()
      const asyncFailing = imports['asyncFailing'] as () => Promise<never>

      await expect(asyncFailing()).rejects.toThrow('async error')
      expect(sink.entries).toHaveLength(1)
      expect(sink.entries[0]?.error).toBe('async error')
    })

    it('should exclude specified methods', () => {
      const sink = new ArrayAuditSink()
      const provider = createMockProvider({
        include: () => 'included',
        exclude: () => 'excluded',
      })

      const wrapped = createAuditWrapper(provider, {
        sink,
        excludeMethods: ['exclude'],
      })
      const imports = wrapped.getImports()
      const include = imports['include'] as () => string
      const exclude = imports['exclude'] as () => string

      include()
      exclude()

      expect(sink.entries).toHaveLength(1)
      expect(sink.entries[0]?.method).toBe('include')
    })

    it('should not log args when logArgs is false', () => {
      const sink = new ArrayAuditSink()
      const provider = createMockProvider({
        method: (secret: string) => secret,
      })

      const wrapped = createAuditWrapper(provider, {
        sink,
        logArgs: false,
      })
      const imports = wrapped.getImports()
      const method = imports['method'] as (s: string) => string

      method('secret-value')

      expect(sink.entries[0]?.args).toEqual([])
    })

    it('should log results when logResults is true', () => {
      const sink = new ArrayAuditSink()
      const provider = createMockProvider({
        method: () => 'result-value',
      })

      const wrapped = createAuditWrapper(provider, {
        sink,
        logResults: true,
      })
      const imports = wrapped.getImports()
      const method = imports['method'] as () => string

      method()

      expect(sink.entries[0]?.result).toBe('result-value')
    })

    it('should include context in entries', () => {
      const sink = new ArrayAuditSink()
      const provider = createMockProvider({
        method: () => 'ok',
      })

      const wrapped = createAuditWrapper(provider, {
        sink,
        context: { env: 'test', user: 'tester' },
      })
      const imports = wrapped.getImports()
      const method = imports['method'] as () => string

      method()

      expect(sink.entries[0]?.context).toEqual({ env: 'test', user: 'tester' })
    })
  })

  describe('withAudit helper', () => {
    it('should create audit wrapper with sink', () => {
      const sink = new ArrayAuditSink()
      const provider = createMockProvider({
        method: () => 'ok',
      })

      const wrapped = withAudit(provider, sink)
      const imports = wrapped.getImports()
      const method = imports['method'] as () => string

      method()

      expect(sink.entries).toHaveLength(1)
    })
  })
})

describe('Metrics Wrapper', () => {
  describe('InMemoryMetricsCollector', () => {
    let collector: InMemoryMetricsCollector

    beforeEach(() => {
      collector = new InMemoryMetricsCollector()
    })

    describe('Counter', () => {
      it('should increment counter', () => {
        const counter = collector.counter('requests_total')
        counter.inc()
        counter.inc()
        counter.inc(5)

        expect(counter.value).toBe(7)
      })

      it('should reset counter', () => {
        const counter = collector.counter('requests_total')
        counter.inc(10)
        counter.reset()

        expect(counter.value).toBe(0)
      })

      it('should create counters with labels', () => {
        const counter1 = collector.counter('requests', { method: 'GET' })
        const counter2 = collector.counter('requests', { method: 'POST' })

        counter1.inc(5)
        counter2.inc(3)

        expect(counter1.value).toBe(5)
        expect(counter2.value).toBe(3)
      })
    })

    describe('Gauge', () => {
      it('should set gauge value', () => {
        const gauge = collector.gauge('temperature')
        gauge.set(25)
        expect(gauge.value).toBe(25)

        gauge.set(30)
        expect(gauge.value).toBe(30)
      })

      it('should increment and decrement gauge', () => {
        const gauge = collector.gauge('connections')
        gauge.inc()
        gauge.inc()
        expect(gauge.value).toBe(2)

        gauge.dec()
        expect(gauge.value).toBe(1)

        gauge.inc(5)
        gauge.dec(3)
        expect(gauge.value).toBe(3)
      })
    })

    describe('Histogram', () => {
      it('should observe values', () => {
        const histogram = collector.histogram('latency', [10, 50, 100, 500])

        histogram.observe(5)
        histogram.observe(25)
        histogram.observe(75)
        histogram.observe(200)
        histogram.observe(1000)

        expect(histogram.count).toBe(5)
        expect(histogram.sum).toBe(1305)
      })

      it('should calculate percentiles', () => {
        const histogram = collector.histogram('latency')

        // Add 100 values from 1 to 100
        for (let i = 1; i <= 100; i++) {
          histogram.observe(i)
        }

        expect(histogram.percentile(50)).toBe(50)
        expect(histogram.percentile(90)).toBe(90)
        expect(histogram.percentile(99)).toBe(99)
      })

      it('should populate buckets', () => {
        const histogram = collector.histogram('latency', [10, 50, 100])

        histogram.observe(5)   // <= 10
        histogram.observe(15)  // <= 50
        histogram.observe(45)  // <= 50
        histogram.observe(75)  // <= 100
        histogram.observe(150) // <= Infinity

        // Buckets are cumulative
        expect(histogram.buckets[0]?.count).toBe(1)  // <= 10
        expect(histogram.buckets[1]?.count).toBe(3)  // <= 50
        expect(histogram.buckets[2]?.count).toBe(4)  // <= 100
        expect(histogram.buckets[3]?.count).toBe(5)  // <= Infinity
      })

      it('should reset histogram', () => {
        const histogram = collector.histogram('latency')
        histogram.observe(100)
        histogram.observe(200)
        histogram.reset()

        expect(histogram.count).toBe(0)
        expect(histogram.sum).toBe(0)
      })
    })

    describe('Snapshot', () => {
      it('should return snapshot of all metrics', () => {
        collector.counter('counter1').inc(5)
        collector.gauge('gauge1').set(10)
        collector.histogram('histogram1').observe(25)

        const snapshot = collector.snapshot()

        expect(snapshot.metrics).toHaveLength(3)
        expect(snapshot.timestamp).toBeGreaterThan(0)

        const counter = snapshot.metrics.find(m => m.name === 'counter1')
        expect(counter?.type).toBe('counter')
        expect(counter?.value).toBe(5)

        const gauge = snapshot.metrics.find(m => m.name === 'gauge1')
        expect(gauge?.type).toBe('gauge')
        expect(gauge?.value).toBe(10)

        const histogram = snapshot.metrics.find(m => m.name === 'histogram1')
        expect(histogram?.type).toBe('histogram')
        expect(histogram?.count).toBe(1)
        expect(histogram?.sum).toBe(25)
      })

      it('should parse labels from key', () => {
        collector.counter('requests', { method: 'GET', status: '200' }).inc()

        const snapshot = collector.snapshot()
        const metric = snapshot.metrics[0]

        expect(metric?.labels).toEqual({ method: 'GET', status: '200' })
      })
    })

    describe('Reset', () => {
      it('should reset all metrics', () => {
        collector.counter('counter1').inc(5)
        collector.gauge('gauge1').set(10)
        collector.histogram('histogram1').observe(25)

        collector.reset()

        expect(collector.counter('counter1').value).toBe(0)
        expect(collector.gauge('gauge1').value).toBe(0)
        expect(collector.histogram('histogram1').count).toBe(0)
      })
    })
  })

  describe('createMetricsWrapper', () => {
    it('should track call counts', () => {
      const collector = new InMemoryMetricsCollector()
      const provider = createMockProvider({
        method: () => 'result',
      })

      const wrapped = createMetricsWrapper(provider, { collector })
      const imports = wrapped.getImports()
      const method = imports['method'] as () => string

      method()
      method()
      method()

      const snapshot = collector.snapshot()
      const callsCounter = snapshot.metrics.find(
        m => m.name === 'wasi_calls_total' && m.labels['method'] === 'method'
      )
      expect(callsCounter?.value).toBe(3)
    })

    it('should track latency histogram', async () => {
      const collector = new InMemoryMetricsCollector()
      const provider = createMockProvider({
        slowMethod: async () => {
          await new Promise(r => setTimeout(r, 50))
          return 'done'
        },
      })

      const wrapped = createMetricsWrapper(provider, { collector })
      const imports = wrapped.getImports()
      const slowMethod = imports['slowMethod'] as () => Promise<string>

      await slowMethod()

      const snapshot = collector.snapshot()
      const histogram = snapshot.metrics.find(
        m => m.name === 'wasi_call_duration_ms' && m.labels['method'] === 'slowMethod'
      )
      expect(histogram?.count).toBe(1)
      expect((histogram?.sum ?? 0) > 40).toBe(true)
    })

    it('should track errors', () => {
      const collector = new InMemoryMetricsCollector()
      const provider = createMockProvider({
        failing: () => {
          throw new Error('test error')
        },
      })

      const wrapped = createMetricsWrapper(provider, { collector })
      const imports = wrapped.getImports()
      const failing = imports['failing'] as () => never

      try { failing() } catch { /* expected */ }
      try { failing() } catch { /* expected */ }

      const snapshot = collector.snapshot()
      const errorsCounter = snapshot.metrics.find(
        m => m.name === 'wasi_errors_total' && m.labels['method'] === 'failing'
      )
      expect(errorsCounter?.value).toBe(2)
    })

    it('should track in-flight calls', async () => {
      const collector = new InMemoryMetricsCollector()
      let resolvePromise: () => void
      const pendingPromise = new Promise<void>(r => { resolvePromise = r })

      const provider = createMockProvider({
        slowMethod: async () => {
          await pendingPromise
          return 'done'
        },
      })

      const wrapped = createMetricsWrapper(provider, { collector })
      const imports = wrapped.getImports()
      const slowMethod = imports['slowMethod'] as () => Promise<string>

      const promise = slowMethod()

      const snapshotDuring = collector.snapshot()
      const inFlightDuring = snapshotDuring.metrics.find(
        m => m.name === 'wasi_in_flight' && m.labels['method'] === 'slowMethod'
      )
      expect(inFlightDuring?.value).toBe(1)

      resolvePromise!()
      await promise

      const snapshotAfter = collector.snapshot()
      const inFlightAfter = snapshotAfter.metrics.find(
        m => m.name === 'wasi_in_flight' && m.labels['method'] === 'slowMethod'
      )
      expect(inFlightAfter?.value).toBe(0)
    })

    it('should use custom prefix', () => {
      const collector = new InMemoryMetricsCollector()
      const provider = createMockProvider({
        method: () => 'result',
      })

      const wrapped = createMetricsWrapper(provider, {
        collector,
        prefix: 'custom',
      })
      const imports = wrapped.getImports()
      const method = imports['method'] as () => string

      method()

      const snapshot = collector.snapshot()
      const metric = snapshot.metrics.find(m => m.name.startsWith('custom_'))
      expect(metric).toBeDefined()
    })

    it('should exclude specified methods', () => {
      const collector = new InMemoryMetricsCollector()
      const provider = createMockProvider({
        include: () => 'included',
        exclude: () => 'excluded',
      })

      const wrapped = createMetricsWrapper(provider, {
        collector,
        excludeMethods: ['exclude'],
      })
      const imports = wrapped.getImports()
      const include = imports['include'] as () => string
      const exclude = imports['exclude'] as () => string

      include()
      exclude()

      const snapshot = collector.snapshot()
      const excludeMetric = snapshot.metrics.find(m => m.labels['method'] === 'exclude')
      expect(excludeMetric).toBeUndefined()
    })
  })

  describe('globalMetricsCollector', () => {
    it('should be a singleton instance', () => {
      expect(globalMetricsCollector).toBeInstanceOf(InMemoryMetricsCollector)
    })
  })

  describe('Default buckets', () => {
    it('should have latency buckets', () => {
      expect(DEFAULT_LATENCY_BUCKETS).toContain(1)
      expect(DEFAULT_LATENCY_BUCKETS).toContain(100)
      expect(DEFAULT_LATENCY_BUCKETS).toContain(1000)
    })

    it('should have size buckets', () => {
      expect(DEFAULT_SIZE_BUCKETS).toContain(1024)
      expect(DEFAULT_SIZE_BUCKETS).toContain(1048576)
    })
  })
})

describe('Replay/Record Framework', () => {
  describe('Serialization', () => {
    it('should serialize null', () => {
      expect(serializeValue(null)).toEqual({ type: 'null' })
      expect(deserializeValue({ type: 'null' })).toBe(null)
    })

    it('should serialize undefined', () => {
      expect(serializeValue(undefined)).toEqual({ type: 'undefined' })
      expect(deserializeValue({ type: 'undefined' })).toBe(undefined)
    })

    it('should serialize booleans', () => {
      expect(serializeValue(true)).toEqual({ type: 'boolean', value: true })
      expect(serializeValue(false)).toEqual({ type: 'boolean', value: false })
      expect(deserializeValue({ type: 'boolean', value: true })).toBe(true)
    })

    it('should serialize numbers', () => {
      expect(serializeValue(42)).toEqual({ type: 'number', value: 42 })
      expect(serializeValue(3.14)).toEqual({ type: 'number', value: 3.14 })
      expect(deserializeValue({ type: 'number', value: 42 })).toBe(42)
    })

    it('should serialize bigints', () => {
      expect(serializeValue(BigInt(123))).toEqual({ type: 'bigint', value: '123' })
      expect(deserializeValue({ type: 'bigint', value: '123' })).toBe(BigInt(123))
    })

    it('should serialize strings', () => {
      expect(serializeValue('hello')).toEqual({ type: 'string', value: 'hello' })
      expect(deserializeValue({ type: 'string', value: 'hello' })).toBe('hello')
    })

    it('should serialize Uint8Array as base64', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5])
      const serialized = serializeValue(bytes)
      expect(serialized.type).toBe('bytes')

      const deserialized = deserializeValue(serialized)
      expect(deserialized).toBeInstanceOf(Uint8Array)
      expect(deserialized).toEqual(bytes)
    })

    it('should serialize arrays', () => {
      const arr = [1, 'two', true]
      const serialized = serializeValue(arr)
      expect(serialized.type).toBe('array')

      const deserialized = deserializeValue(serialized)
      expect(deserialized).toEqual(arr)
    })

    it('should serialize objects', () => {
      const obj = { name: 'test', value: 42 }
      const serialized = serializeValue(obj)
      expect(serialized.type).toBe('object')

      const deserialized = deserializeValue(serialized)
      expect(deserialized).toEqual(obj)
    })

    it('should serialize errors', () => {
      const error = new Error('test error')
      const serialized = serializeValue(error)
      expect(serialized).toEqual({ type: 'error', message: 'test error' })

      const deserialized = deserializeValue(serialized)
      expect(deserialized).toBeInstanceOf(Error)
      expect((deserialized as Error).message).toBe('test error')
    })

    it('should serialize nested structures', () => {
      const nested = {
        items: [1, 2, { nested: true }],
        data: new Uint8Array([1, 2, 3]),
      }
      const serialized = serializeValue(nested)
      const deserialized = deserializeValue(serialized) as typeof nested

      expect(deserialized.items).toEqual(nested.items)
      expect(deserialized.data).toEqual(nested.data)
    })
  })

  describe('CassetteRecorder', () => {
    it('should create cassette with version', () => {
      const recorder = new CassetteRecorder()
      const cassette = recorder.getCassette()

      expect(cassette.version).toBe(CASSETTE_VERSION)
      expect(cassette.startTime).toBeGreaterThan(0)
      expect(cassette.calls).toHaveLength(0)
    })

    it('should record calls', () => {
      const recorder = new CassetteRecorder()

      recorder.record('provider1', 'test:mock@0.1.0', 'method1', [1, 2], 3, undefined, 10)
      recorder.record('provider1', 'test:mock@0.1.0', 'method2', ['arg'], 'result', undefined, 5)

      const cassette = recorder.getCassette()
      expect(cassette.calls).toHaveLength(2)
      expect(cassette.calls[0]?.seq).toBe(0)
      expect(cassette.calls[1]?.seq).toBe(1)
    })

    it('should record errors', () => {
      const recorder = new CassetteRecorder()

      recorder.record(
        'provider1',
        'test:mock@0.1.0',
        'failing',
        [],
        undefined,
        new Error('test error'),
        5
      )

      const cassette = recorder.getCassette()
      expect(cassette.calls[0]?.error).toBe('test error')
      expect(cassette.calls[0]?.result).toBeUndefined()
    })

    it('should include metadata', () => {
      const recorder = new CassetteRecorder({ testName: 'example', version: '1.0' })
      const cassette = recorder.getCassette()

      expect(cassette.metadata).toEqual({ testName: 'example', version: '1.0' })
    })

    it('should finish with endTime', () => {
      const recorder = new CassetteRecorder()
      const cassette = recorder.finish()

      expect(cassette.endTime).toBeGreaterThan(0)
      expect(cassette.endTime).toBeGreaterThanOrEqual(cassette.startTime)
    })

    it('should export to JSON', () => {
      const recorder = new CassetteRecorder()
      recorder.record('p', 'i', 'm', [], 'r', undefined, 1)

      const json = recorder.toJSON()
      const parsed = JSON.parse(json)

      expect(parsed.version).toBe(CASSETTE_VERSION)
      expect(parsed.calls).toHaveLength(1)
    })

    it('should export to NDJSON', () => {
      const recorder = new CassetteRecorder({ test: true })
      recorder.record('p', 'i', 'm1', [], 'r1', undefined, 1)
      recorder.record('p', 'i', 'm2', [], 'r2', undefined, 2)

      const ndjson = recorder.toNDJSON()
      const lines = ndjson.split('\n')

      expect(lines).toHaveLength(4) // header, 2 calls, footer

      const header = JSON.parse(lines[0]!)
      expect(header.version).toBe(CASSETTE_VERSION)
      expect(header.metadata).toEqual({ test: true })

      const call1 = JSON.parse(lines[1]!)
      expect(call1.method).toBe('m1')

      const footer = JSON.parse(lines[3]!)
      expect(footer.endTime).toBeGreaterThan(0)
    })
  })

  describe('CassettePlayer', () => {
    it('should load from JSON', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [],
      }
      const player = CassettePlayer.fromJSON(JSON.stringify(cassette))

      expect(player.strict).toBe(true)
    })

    it('should load from NDJSON', () => {
      const ndjson = [
        JSON.stringify({ version: CASSETTE_VERSION, startTime: 1000 }),
        JSON.stringify({
          seq: 0,
          timestamp: 1001,
          providerId: 'p',
          interface: 'i',
          method: 'm',
          args: [],
          durationMs: 1,
        }),
        JSON.stringify({ endTime: 2000 }),
      ].join('\n')

      const player = CassettePlayer.fromNDJSON(ndjson)
      const call = player.next('p', 'm')

      expect(call).toBeDefined()
      expect(call?.method).toBe('m')
    })

    it('should replay recorded calls in order', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [
          {
            seq: 0,
            timestamp: Date.now(),
            providerId: 'p',
            interface: 'i',
            method: 'read',
            args: [{ type: 'string', value: 'file1' }],
            result: { type: 'string', value: 'content1' },
            durationMs: 1,
          },
          {
            seq: 1,
            timestamp: Date.now(),
            providerId: 'p',
            interface: 'i',
            method: 'read',
            args: [{ type: 'string', value: 'file2' }],
            result: { type: 'string', value: 'content2' },
            durationMs: 1,
          },
        ],
      }

      const player = new CassettePlayer(cassette as any)

      const call1 = player.next('p', 'read')
      expect(player.replay(call1!)).toBe('content1')

      const call2 = player.next('p', 'read')
      expect(player.replay(call2!)).toBe('content2')

      const call3 = player.next('p', 'read')
      expect(call3).toBeUndefined()
    })

    it('should replay errors', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [
          {
            seq: 0,
            timestamp: Date.now(),
            providerId: 'p',
            interface: 'i',
            method: 'failing',
            args: [],
            error: 'recorded error',
            durationMs: 1,
          },
        ],
      }

      const player = new CassettePlayer(cassette as any)
      const call = player.next('p', 'failing')

      expect(() => player.replay(call!)).toThrow('recorded error')
    })

    it('should check completion status', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [
          {
            seq: 0,
            timestamp: Date.now(),
            providerId: 'p',
            interface: 'i',
            method: 'm',
            args: [],
            result: { type: 'null' },
            durationMs: 1,
          },
        ],
      }

      const player = new CassettePlayer(cassette as any)
      expect(player.isComplete()).toBe(false)

      player.next('p', 'm')
      expect(player.isComplete()).toBe(true)
    })

    it('should return remaining calls', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [
          { seq: 0, timestamp: 1, providerId: 'p', interface: 'i', method: 'm1', args: [], durationMs: 1 },
          { seq: 1, timestamp: 2, providerId: 'p', interface: 'i', method: 'm2', args: [], durationMs: 1 },
          { seq: 2, timestamp: 3, providerId: 'p', interface: 'i', method: 'm3', args: [], durationMs: 1 },
        ],
      }

      const player = new CassettePlayer(cassette as any)
      player.next('p', 'm1')

      const remaining = player.remaining()
      expect(remaining).toHaveLength(2)
    })

    it('should reset playback position', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [
          {
            seq: 0,
            timestamp: Date.now(),
            providerId: 'p',
            interface: 'i',
            method: 'm',
            args: [],
            result: { type: 'string', value: 'first' },
            durationMs: 1,
          },
        ],
      }

      const player = new CassettePlayer(cassette as any)

      player.next('p', 'm')
      expect(player.next('p', 'm')).toBeUndefined()

      player.reset()
      expect(player.next('p', 'm')).toBeDefined()
    })

    it('should return metadata', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [],
        metadata: { test: 'value' },
      }

      const player = new CassettePlayer(cassette)
      expect(player.getMetadata()).toEqual({ test: 'value' })
    })
  })

  describe('createRecordingWrapper', () => {
    it('should record sync method calls', () => {
      const recorder = new CassetteRecorder()
      const provider = createMockProvider({
        add: (a: number, b: number) => a + b,
      })

      const wrapped = createRecordingWrapper(provider, { recorder })
      const imports = wrapped.getImports()
      const add = imports['add'] as (a: number, b: number) => number

      const result = add(2, 3)

      expect(result).toBe(5)

      const cassette = recorder.getCassette()
      expect(cassette.calls).toHaveLength(1)
      expect(cassette.calls[0]?.method).toBe('add')
    })

    it('should record async method calls', async () => {
      const recorder = new CassetteRecorder()
      const provider = createMockProvider({
        asyncAdd: async (a: number, b: number) => a + b,
      })

      const wrapped = createRecordingWrapper(provider, { recorder })
      const imports = wrapped.getImports()
      const asyncAdd = imports['asyncAdd'] as (a: number, b: number) => Promise<number>

      const result = await asyncAdd(2, 3)

      expect(result).toBe(5)

      const cassette = recorder.getCassette()
      expect(cassette.calls).toHaveLength(1)
    })

    it('should record errors', () => {
      const recorder = new CassetteRecorder()
      const provider = createMockProvider({
        failing: () => {
          throw new Error('test error')
        },
      })

      const wrapped = createRecordingWrapper(provider, { recorder })
      const imports = wrapped.getImports()
      const failing = imports['failing'] as () => never

      expect(() => failing()).toThrow('test error')

      const cassette = recorder.getCassette()
      expect(cassette.calls[0]?.error).toBe('test error')
    })

    it('should exclude specified methods', () => {
      const recorder = new CassetteRecorder()
      const provider = createMockProvider({
        include: () => 'included',
        exclude: () => 'excluded',
      })

      const wrapped = createRecordingWrapper(provider, {
        recorder,
        excludeMethods: ['exclude'],
      })
      const imports = wrapped.getImports()
      const include = imports['include'] as () => string
      const exclude = imports['exclude'] as () => string

      include()
      exclude()

      const cassette = recorder.getCassette()
      expect(cassette.calls).toHaveLength(1)
      expect(cassette.calls[0]?.method).toBe('include')
    })
  })

  describe('createReplayWrapper', () => {
    it('should replay recorded results', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [
          {
            seq: 0,
            timestamp: Date.now(),
            providerId: 'test-provider',
            interface: 'test:mock@0.1.0',
            method: 'getValue',
            args: [],
            result: { type: 'number', value: 42 },
            durationMs: 1,
          },
        ],
      }

      const player = new CassettePlayer(cassette as any)
      const provider = createMockProvider({
        getValue: () => 999, // Should not be called
      })

      const wrapped = createReplayWrapper(provider, { player })
      const imports = wrapped.getImports()
      const getValue = imports['getValue'] as () => number

      const result = getValue()

      expect(result).toBe(42) // From recording, not from provider
    })

    it('should replay errors', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [
          {
            seq: 0,
            timestamp: Date.now(),
            providerId: 'test-provider',
            interface: 'test:mock@0.1.0',
            method: 'failing',
            args: [],
            error: 'recorded error',
            durationMs: 1,
          },
        ],
      }

      const player = new CassettePlayer(cassette as any)
      const provider = createMockProvider({
        failing: () => 'should not return this',
      })

      const wrapped = createReplayWrapper(provider, { player })
      const imports = wrapped.getImports()
      const failing = imports['failing'] as () => never

      expect(() => failing()).toThrow('recorded error')
    })

    it('should throw in strict mode when no recording found', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [],
      }

      const player = new CassettePlayer(cassette)
      const provider = createMockProvider({
        method: () => 'result',
      })

      const wrapped = createReplayWrapper(provider, { player, strict: true })
      const imports = wrapped.getImports()
      const method = imports['method'] as () => string

      expect(() => method()).toThrow('No recorded call')
    })

    it('should fall back to real implementation in non-strict mode', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [],
      }

      const player = new CassettePlayer(cassette)
      const provider = createMockProvider({
        method: () => 'real result',
      })

      const wrapped = createReplayWrapper(provider, { player, strict: false })
      const imports = wrapped.getImports()
      const method = imports['method'] as () => string

      const result = method()

      expect(result).toBe('real result')
    })

    it('should exclude specified methods from replay', () => {
      const cassette = {
        version: CASSETTE_VERSION,
        startTime: Date.now(),
        calls: [
          {
            seq: 0,
            timestamp: Date.now(),
            providerId: 'test-provider',
            interface: 'test:mock@0.1.0',
            method: 'excluded',
            args: [],
            result: { type: 'string', value: 'recorded' },
            durationMs: 1,
          },
        ],
      }

      const player = new CassettePlayer(cassette as any)
      const provider = createMockProvider({
        excluded: () => 'real',
      })

      const wrapped = createReplayWrapper(provider, {
        player,
        excludeMethods: ['excluded'],
      })
      const imports = wrapped.getImports()
      const excluded = imports['excluded'] as () => string

      const result = excluded()

      expect(result).toBe('real') // From provider, not recording
    })
  })

  describe('Record and replay roundtrip', () => {
    it('should record and replay a session', () => {
      // Record phase
      const recorder = new CassetteRecorder({ test: 'roundtrip' })
      const originalProvider = createMockProvider({
        getTime: () => Date.now(),
        random: () => Math.random(),
        greet: (name: string) => `Hello, ${name}!`,
      })

      const recordedProvider = withRecording(originalProvider, recorder)
      const recordImports = recordedProvider.getImports()

      const time1 = (recordImports['getTime'] as () => number)()
      const random1 = (recordImports['random'] as () => number)()
      const greeting = (recordImports['greet'] as (n: string) => string)('World')

      const cassette = recorder.finish()

      // Replay phase
      const player = new CassettePlayer(cassette)
      const replayProvider = createMockProvider({
        getTime: () => -1, // Should not be called
        random: () => -1,
        greet: () => 'Wrong!',
      })

      const replayedProvider = withReplay(replayProvider, player)
      const replayImports = replayedProvider.getImports()

      const time2 = (replayImports['getTime'] as () => number)()
      const random2 = (replayImports['random'] as () => number)()
      const greeting2 = (replayImports['greet'] as (n: string) => string)('World')

      // Results should match
      expect(time2).toBe(time1)
      expect(random2).toBe(random1)
      expect(greeting2).toBe(greeting)
      expect(greeting2).toBe('Hello, World!')
    })
  })
})
