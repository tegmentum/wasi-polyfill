/**
 * Provider base types for the WASIP2 polyfill runtime
 *
 * Providers are the core abstraction for implementing WASI interfaces.
 * Each provider implements a specific backend for a WASI interface
 * (e.g., crypto.web for random, opfs for filesystem).
 */

import type { WasiInterface, Policy, PluginConfig } from '../core/types.js'

/**
 * Capability flags that a provider may support
 */
export interface Capabilities {
  /** Whether the provider supports streaming operations */
  streaming?: boolean
  /** Whether the provider supports seeking */
  seek?: boolean
  /** Whether the provider supports async operations */
  async?: boolean
  /** Whether the provider supports UDP */
  udp?: boolean
  /** Whether the provider supports TCP */
  tcp?: boolean
  /** Whether the provider supports DNS */
  dns?: boolean
  /** Whether the provider is persistent across sessions */
  persistent?: boolean
  /** Whether the provider is deterministic (for testing) */
  deterministic?: boolean
  /** Custom capability flags */
  [key: string]: boolean | undefined
}

/**
 * Logger interface for provider context
 */
export interface Logger {
  trace(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/**
 * Clock interface for provider context
 *
 * Allows injection of virtual clocks for deterministic testing.
 */
export interface Clock {
  /** Get current monotonic time in nanoseconds */
  monotonicNow(): bigint
  /** Get current wall clock time */
  wallNow(): { seconds: bigint; nanoseconds: number }
  /** Advance time (for virtual clocks) */
  advance?(nanoseconds: bigint): void
}

/**
 * Random source interface for provider context
 *
 * Allows injection of seeded random for deterministic testing.
 */
export interface RandomSource {
  /** Get random bytes */
  getRandomBytes(length: number): Uint8Array
  /** Get random u64 */
  getRandomU64(): bigint
}

/**
 * Metrics collector interface
 */
export interface MetricsSink {
  /** Increment a counter */
  increment(name: string, value?: number, tags?: Record<string, string>): void
  /** Record a gauge value */
  gauge(name: string, value: number, tags?: Record<string, string>): void
  /** Record a histogram value */
  histogram(name: string, value: number, tags?: Record<string, string>): void
  /** Record a timing value in milliseconds */
  timing(name: string, durationMs: number, tags?: Record<string, string>): void
}

/**
 * Trace span interface
 */
export interface TraceSpan {
  /** Span ID */
  readonly id: string
  /** Set an attribute on the span */
  setAttribute(key: string, value: string | number | boolean): void
  /** Add an event to the span */
  addEvent(name: string, attributes?: Record<string, unknown>): void
  /** End the span */
  end(): void
}

/**
 * Tracer interface for provider context
 */
export interface Tracer {
  /** Start a new trace span */
  startSpan(name: string, attributes?: Record<string, unknown>): TraceSpan
  /** Get current trace ID if any */
  currentTraceId(): string | undefined
}

/**
 * HTTP client for providers that need to make HTTP requests
 */
export interface HttpClient {
  fetch(request: Request): Promise<Response>
}

/**
 * Environment configuration
 */
export interface EnvironmentConfig {
  /** Environment variables */
  env: Record<string, string>
  /** Command line arguments */
  args: string[]
  /** Current working directory */
  cwd?: string
}

/**
 * Provider context provides shared services to all providers
 *
 * This is the main extension point for cross-cutting concerns
 * like logging, metrics, tracing, and policy enforcement.
 */
export interface ProviderContext {
  /** Security policy */
  readonly policy: Policy

  /** Logger for this provider */
  readonly logger: Logger

  /** Clock source (may be virtual for testing) */
  readonly clock: Clock

  /** Random source (may be seeded for testing) */
  readonly random: RandomSource

  /** HTTP client for making requests */
  readonly httpClient: HttpClient

  /** Environment configuration */
  readonly env: EnvironmentConfig

  /** Metrics sink for observability */
  readonly metrics?: MetricsSink

  /** Tracer for distributed tracing */
  readonly tracer?: Tracer

  /** Whether we're in development mode */
  readonly devMode: boolean

  /** Get a child context with a specific logger name */
  child(name: string): ProviderContext
}

/**
 * Provider state
 */
export type ProviderState = 'created' | 'initializing' | 'ready' | 'closing' | 'closed' | 'error'

/**
 * Provider interface
 *
 * All providers must implement this interface. Providers are responsible
 * for implementing a specific backend for a WASI interface.
 */
export interface Provider {
  /** Stable provider ID for configuration and debugging */
  readonly id: string

  /** WASI interface this provider implements */
  readonly witInterface: WasiInterface

  /** Current state of the provider */
  readonly state: ProviderState

  /** Capabilities this provider supports */
  capabilities(): Capabilities

  /**
   * Initialize the provider
   *
   * Called once when the provider is first used. Providers should
   * perform any async setup here (e.g., opening databases, connecting
   * to services).
   */
  init(ctx: ProviderContext): void | Promise<void>

  /**
   * Get the imports object for WebAssembly instantiation
   *
   * Returns the functions that will be imported by the WASM component.
   */
  getImports(): Record<string, unknown>

  /**
   * Close the provider and release resources
   *
   * Called when the provider is no longer needed. Providers should
   * clean up any resources here (e.g., closing file handles, connections).
   */
  close(): void | Promise<void>
}

/**
 * Provider factory function
 */
export type ProviderFactory = (config: PluginConfig) => Provider

/**
 * Provider definition used for registration
 */
export interface ProviderDefinition {
  /** Provider ID */
  id: string
  /** WASI interface this provider implements */
  witInterface: WasiInterface
  /** Human-readable description */
  description: string
  /** Factory to create provider instances */
  factory: ProviderFactory
  /** Default capabilities (used for selection) */
  defaultCapabilities: Capabilities
  /** Priority for auto-selection (higher = preferred) */
  priority?: number
  /** Environment requirements (e.g., 'browser', 'node') */
  environments?: string[]
}

/**
 * Base class for implementing providers
 *
 * Provides common functionality and state management.
 */
export abstract class BaseProvider implements Provider {
  abstract readonly id: string
  abstract readonly witInterface: WasiInterface

  protected ctx: ProviderContext | null = null
  private _state: ProviderState = 'created'

  get state(): ProviderState {
    return this._state
  }

  protected setState(state: ProviderState): void {
    this._state = state
  }

  abstract capabilities(): Capabilities
  abstract getImports(): Record<string, unknown>

  async init(ctx: ProviderContext): Promise<void> {
    if (this._state !== 'created') {
      throw new Error(`Cannot initialize provider in state: ${this._state}`)
    }
    this._state = 'initializing'
    this.ctx = ctx

    try {
      await this.onInit(ctx)
      this._state = 'ready'
    } catch (error) {
      this._state = 'error'
      throw error
    }
  }

  async close(): Promise<void> {
    if (this._state === 'closed' || this._state === 'closing') {
      return
    }
    this._state = 'closing'

    try {
      await this.onClose()
    } finally {
      this._state = 'closed'
      this.ctx = null
    }
  }

  /**
   * Override this to perform async initialization
   */
  protected onInit(_ctx: ProviderContext): void | Promise<void> {
    // Default: no-op
  }

  /**
   * Override this to perform cleanup
   */
  protected onClose(): void | Promise<void> {
    // Default: no-op
  }

  /**
   * Get the provider context (throws if not initialized)
   */
  protected getContext(): ProviderContext {
    if (!this.ctx) {
      throw new Error('Provider not initialized')
    }
    return this.ctx
  }
}

/**
 * No-op logger implementation
 */
export const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

/**
 * Console logger implementation
 */
export function createConsoleLogger(prefix: string = ''): Logger {
  const fmt = (level: string, message: string) =>
    prefix ? `[${prefix}] ${level}: ${message}` : `${level}: ${message}`

  return {
    trace: (message, ...args) => console.debug(fmt('TRACE', message), ...args),
    debug: (message, ...args) => console.debug(fmt('DEBUG', message), ...args),
    info: (message, ...args) => console.info(fmt('INFO', message), ...args),
    warn: (message, ...args) => console.warn(fmt('WARN', message), ...args),
    error: (message, ...args) => console.error(fmt('ERROR', message), ...args),
  }
}

/**
 * Real clock implementation
 */
export const realClock: Clock = {
  monotonicNow(): bigint {
    // performance.now() returns milliseconds, convert to nanoseconds
    return BigInt(Math.floor(performance.now() * 1_000_000))
  },
  wallNow(): { seconds: bigint; nanoseconds: number } {
    const now = Date.now()
    const seconds = BigInt(Math.floor(now / 1000))
    const nanoseconds = (now % 1000) * 1_000_000
    return { seconds, nanoseconds }
  },
}

/**
 * Virtual clock for deterministic testing
 */
export class VirtualClock implements Clock {
  private monotonic: bigint = 0n
  private wall: { seconds: bigint; nanoseconds: number }

  constructor(initialWallTime?: Date) {
    const now = initialWallTime ?? new Date(0)
    this.wall = {
      seconds: BigInt(Math.floor(now.getTime() / 1000)),
      nanoseconds: (now.getTime() % 1000) * 1_000_000,
    }
  }

  monotonicNow(): bigint {
    return this.monotonic
  }

  wallNow(): { seconds: bigint; nanoseconds: number } {
    return { ...this.wall }
  }

  advance(nanoseconds: bigint): void {
    this.monotonic += nanoseconds

    // Also advance wall clock
    const totalNanos = BigInt(this.wall.nanoseconds) + nanoseconds
    const additionalSeconds = totalNanos / 1_000_000_000n
    const remainingNanos = totalNanos % 1_000_000_000n

    this.wall.seconds += additionalSeconds
    this.wall.nanoseconds = Number(remainingNanos)
  }

  setWallTime(date: Date): void {
    this.wall = {
      seconds: BigInt(Math.floor(date.getTime() / 1000)),
      nanoseconds: (date.getTime() % 1000) * 1_000_000,
    }
  }
}

/**
 * Crypto random source (browser/node)
 */
export const cryptoRandomSource: RandomSource = {
  getRandomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return bytes
  },
  getRandomU64(): bigint {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    const view = new DataView(bytes.buffer)
    return view.getBigUint64(0, true)
  },
}

/**
 * Seeded PRNG for deterministic testing (xorshift128+)
 */
export class SeededRandom implements RandomSource {
  private state0: bigint
  private state1: bigint

  constructor(seed: bigint = 1n) {
    // Initialize state from seed using splitmix64
    this.state0 = this.splitmix64(seed)
    this.state1 = this.splitmix64(this.state0)
  }

  private splitmix64(x: bigint): bigint {
    x = (x + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn
    x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn
    x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn
    return (x ^ (x >> 31n)) & 0xffffffffffffffffn
  }

  private next(): bigint {
    let s1 = this.state0
    const s0 = this.state1
    const result = (s0 + s1) & 0xffffffffffffffffn

    this.state0 = s0
    s1 ^= s1 << 23n
    s1 &= 0xffffffffffffffffn
    this.state1 = s1 ^ s0 ^ (s1 >> 17n) ^ (s0 >> 26n)

    return result
  }

  getRandomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i += 8) {
      const value = this.next()
      for (let j = 0; j < 8 && i + j < length; j++) {
        bytes[i + j] = Number((value >> BigInt(j * 8)) & 0xffn)
      }
    }
    return bytes
  }

  getRandomU64(): bigint {
    return this.next()
  }
}

/**
 * No-op metrics sink
 */
export const noopMetrics: MetricsSink = {
  increment: () => {},
  gauge: () => {},
  histogram: () => {},
  timing: () => {},
}

/**
 * No-op tracer
 */
export const noopTracer: Tracer = {
  startSpan: (_name: string) => ({
    id: 'noop',
    setAttribute: () => {},
    addEvent: () => {},
    end: () => {},
  }),
  currentTraceId: () => undefined,
}
