/**
 * Standard I/O implementations for wasi:cli/stdin, stdout, stderr
 *
 * Provides input/output streams for standard I/O using a pluggable provider model.
 *
 * Key design:
 * - Streams are byte-oriented (adapters decode for display)
 * - Terminal features are optional (isTTY flag)
 * - Default: console adapter (zero config)
 * - Supports xterm.js and custom stream providers
 */

import type {
  Implementation,
  PluginConfig,
  PluginInstance,
} from '../../core/types.js'
import type { InputStream, OutputStream, StreamError } from '../io/streams.js'
import { StreamRegistry, globalStreamRegistry } from '../io/streams.js'
import { PollableRegistry, createReadyPollable } from '../io/pollable.js'
import {
  type InputStreamLike,
  type OutputStreamLike,
  type StdioProvider,
  type StdioStreams,
  type StdioConfig as ProviderStdioConfig,
  createStdioProvider,
  createConsoleStdio,
  QueueInputStream as QueueInputStreamClass,
} from './stdio-provider.js'

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Legacy configuration for stdio plugins (backward compatible)
 */
export interface StdioConfig {
  /** Initial stdin content (for testing/scripted input) */
  stdinContent?: string | Uint8Array
  /** Callback for stdout writes */
  onStdout?: (data: Uint8Array) => void
  /** Callback for stderr writes */
  onStderr?: (data: Uint8Array) => void
  /** Whether to log stdout to console */
  logToConsole?: boolean
  /** New: Use stdio provider for pluggable streams */
  stdioProvider?: StdioProvider
  /** New: Provider configuration shorthand */
  stdio?: ProviderStdioConfig
}

// Re-export provider types for convenience
export type { ProviderStdioConfig as StdioProviderConfig }
export {
  type InputStreamLike,
  type OutputStreamLike,
  type StdioProvider,
  type StdioStreams,
  type XTermLike,
  type XTermInputLike,
  type XTermOutputLike,
  createConsoleStdio,
  createXtermStdio,
  createCustomStdio,
  createStdioProvider,
  ConsoleOutputStream as ConsoleOutputStreamLike,
  EmptyInputStream as EmptyInputStreamLike,
  QueueInputStream,
  XtermOutputStream as XtermOutputStreamLike,
} from './stdio-provider.js'

// Also export QueueInputStream with an alias for internal use
export { QueueInputStreamClass }

// ============================================================================
// WASI Stream Wrappers
// ============================================================================

/**
 * Wraps an InputStreamLike as a WASI InputStream resource.
 * Bridges the simple async interface to WASI stream semantics.
 */
export class WasiInputStreamWrapper implements InputStream {
  handle = 0

  private closed = false
  private readonly impl: InputStreamLike

  constructor(impl: InputStreamLike) {
    this.impl = impl
  }

  /** Whether this stream is connected to a TTY */
  get isTTY(): boolean {
    return this.impl.isTTY
  }

  isClosed(): boolean {
    return this.closed
  }

  close(): void {
    this.closed = true
    this.impl.close?.()
  }

  read(len: bigint): Uint8Array | StreamError {
    if (this.closed) {
      return { tag: 'closed' }
    }

    // Try synchronous non-blocking read if available
    if (this.impl.tryRead) {
      const data = this.impl.tryRead(Number(len))
      if (data !== null) {
        if (data.length === 0) {
          // EOF
          return { tag: 'closed' }
        }
        return data
      }
    }

    // No data available - return empty to indicate "would block"
    // The caller should use blockingRead for actual data
    return new Uint8Array(0)
  }

  async blockingRead(len: bigint): Promise<Uint8Array | StreamError> {
    if (this.closed) {
      return { tag: 'closed' }
    }

    try {
      const data = await this.impl.read(Number(len))
      if (data.length === 0) {
        // EOF
        return { tag: 'closed' }
      }
      return data
    } catch (error) {
      return {
        tag: 'last-operation-failed',
        val: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  skip(_len: bigint): bigint | StreamError {
    if (this.closed) {
      return { tag: 'closed' }
    }
    // Can't really skip without reading
    return 0n
  }

  subscribe(registry: PollableRegistry): number {
    // For streams with hasData, create a pollable that checks data availability
    if (this.impl.hasData !== undefined) {
      // Create a promise that resolves when data is available
      const checkData = (): Promise<void> => {
        return new Promise((resolve) => {
          const check = () => {
            if (this.impl.hasData?.() || this.closed) {
              resolve()
            } else {
              // Check again in a microtask
              queueMicrotask(check)
            }
          }
          check()
        })
      }
      return registry.create(checkData())
    }
    // Default: always ready (for EOF streams)
    return createReadyPollable(registry)
  }
}

/**
 * Wraps an OutputStreamLike as a WASI OutputStream resource.
 * Bridges the simple async interface to WASI stream semantics.
 */
export class WasiOutputStreamWrapper implements OutputStream {
  handle = 0

  private closed = false
  private readonly impl: OutputStreamLike
  private readonly callback: ((data: Uint8Array) => void) | undefined

  constructor(impl: OutputStreamLike, callback?: (data: Uint8Array) => void) {
    this.impl = impl
    this.callback = callback ?? undefined
  }

  /** Whether this stream is connected to a TTY */
  get isTTY(): boolean {
    return this.impl.isTTY
  }

  isClosed(): boolean {
    return this.closed
  }

  close(): void {
    this.impl.flush().then(() => {
      this.closed = true
      this.impl.close?.()
    })
  }

  checkWrite(): bigint | StreamError {
    if (this.closed) {
      return { tag: 'closed' }
    }
    // Allow up to 64KB at a time
    return 65536n
  }

  write(contents: Uint8Array): StreamError | undefined {
    if (this.closed) {
      return { tag: 'closed' }
    }

    // Fire and forget - queue the write
    // Note: This is sync for WASI but we're async internally
    this.impl.write(contents).catch(() => {
      // Ignore errors in fire-and-forget mode
    })

    // Call callback if provided (for capturing output)
    if (this.callback) {
      this.callback(contents)
    }

    return undefined
  }

  async blockingWriteAndFlush(contents: Uint8Array): Promise<StreamError | undefined> {
    if (this.closed) {
      return { tag: 'closed' }
    }

    try {
      await this.impl.write(contents)
      await this.impl.flush()

      if (this.callback) {
        this.callback(contents)
      }

      return undefined
    } catch (error) {
      return {
        tag: 'last-operation-failed',
        val: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  flush(): StreamError | undefined {
    if (this.closed) {
      return { tag: 'closed' }
    }
    // Fire and forget
    this.impl.flush().catch(() => {})
    return undefined
  }

  async blockingFlush(): Promise<StreamError | undefined> {
    if (this.closed) {
      return { tag: 'closed' }
    }

    try {
      await this.impl.flush()
      return undefined
    } catch (error) {
      return {
        tag: 'last-operation-failed',
        val: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  subscribe(registry: PollableRegistry): number {
    // Output streams are always ready for writing
    return createReadyPollable(registry)
  }

  writeZeroes(len: bigint): StreamError | undefined {
    return this.write(new Uint8Array(Number(len)))
  }

  splice(src: InputStream, len: bigint): bigint | StreamError {
    const data = src.read(len)
    if (!(data instanceof Uint8Array)) {
      return data
    }
    const error = this.write(data)
    if (error) return error
    return BigInt(data.length)
  }
}

// ============================================================================
// Plugin Instances
// ============================================================================

/**
 * Shared stdio state managed by a provider
 */
class SharedStdioState {
  private static instance: SharedStdioState | null = null
  private readonly streams: StdioStreams
  private refCount = 0

  private constructor(provider: StdioProvider) {
    this.streams = provider()
  }

  static get(provider: StdioProvider): SharedStdioState {
    if (!SharedStdioState.instance) {
      SharedStdioState.instance = new SharedStdioState(provider)
    }
    SharedStdioState.instance.refCount++
    return SharedStdioState.instance
  }

  release(): void {
    this.refCount--
    if (this.refCount <= 0) {
      this.streams.destroy?.()
      SharedStdioState.instance = null
    }
  }

  get stdin(): InputStreamLike {
    return this.streams.stdin
  }

  get stdout(): OutputStreamLike {
    return this.streams.stdout
  }

  get stderr(): OutputStreamLike {
    return this.streams.stderr
  }

  get isTTY(): boolean {
    return this.streams.terminal?.isTTY ?? false
  }
}

// Global provider state (can be configured before plugins are created)
let globalStdioProvider: StdioProvider = createConsoleStdio()
let globalStdioState: SharedStdioState | null = null

/**
 * Set the global stdio provider (call before creating plugins)
 */
export function setGlobalStdioProvider(provider: StdioProvider): void {
  if (globalStdioState) {
    throw new Error('Cannot change stdio provider after plugins are created')
  }
  globalStdioProvider = provider
}

/**
 * Get the global shared stdio state
 */
function getGlobalStdioState(): SharedStdioState {
  if (!globalStdioState) {
    globalStdioState = SharedStdioState.get(globalStdioProvider)
  }
  return globalStdioState
}

/**
 * Reset global stdio state (for testing)
 */
export function resetGlobalStdioState(): void {
  if (globalStdioState) {
    globalStdioState.release()
    globalStdioState = null
  }
  globalStdioProvider = createConsoleStdio()
}

/**
 * Check if stdin is a TTY
 */
export function isStdinTTY(): boolean {
  return getGlobalStdioState().isTTY
}

/**
 * Check if stdout is a TTY
 */
export function isStdoutTTY(): boolean {
  return getGlobalStdioState().isTTY
}

/**
 * Check if stderr is a TTY
 */
export function isStderrTTY(): boolean {
  return getGlobalStdioState().isTTY
}

/**
 * Stdin plugin instance
 */
class StdinInstance implements PluginInstance {
  private readonly streamRegistry: StreamRegistry
  private streamHandle: number | null = null
  private readonly inputStream: WasiInputStreamWrapper

  constructor(streamRegistry: StreamRegistry, stdinImpl: InputStreamLike) {
    this.streamRegistry = streamRegistry
    this.inputStream = new WasiInputStreamWrapper(stdinImpl)
    this.streamHandle = streamRegistry.register(this.inputStream)
  }

  getImports(): Record<string, unknown> {
    return {
      'get-stdin': this.getStdin.bind(this),
    }
  }

  destroy(): void {
    if (this.streamHandle !== null) {
      this.streamRegistry.drop(this.streamHandle)
    }
  }

  private getStdin(): number {
    if (this.streamHandle === null) {
      throw new Error('stdin stream not available')
    }
    return this.streamHandle
  }

  /** Get the underlying input stream for testing/inspection */
  getInputStream(): WasiInputStreamWrapper {
    return this.inputStream
  }
}

/**
 * Stdout plugin instance
 */
class StdoutInstance implements PluginInstance {
  private readonly streamRegistry: StreamRegistry
  private streamHandle: number | null = null
  private readonly outputStream: WasiOutputStreamWrapper

  constructor(
    streamRegistry: StreamRegistry,
    stdoutImpl: OutputStreamLike,
    callback?: (data: Uint8Array) => void
  ) {
    this.streamRegistry = streamRegistry
    this.outputStream = new WasiOutputStreamWrapper(stdoutImpl, callback)
    this.streamHandle = streamRegistry.register(this.outputStream)
  }

  getImports(): Record<string, unknown> {
    return {
      'get-stdout': this.getStdout.bind(this),
    }
  }

  destroy(): void {
    if (this.streamHandle !== null) {
      this.streamRegistry.drop(this.streamHandle)
    }
  }

  private getStdout(): number {
    if (this.streamHandle === null) {
      throw new Error('stdout stream not available')
    }
    return this.streamHandle
  }

  /** Get the underlying output stream for testing/inspection */
  getOutputStream(): WasiOutputStreamWrapper {
    return this.outputStream
  }
}

/**
 * Stderr plugin instance
 */
class StderrInstance implements PluginInstance {
  private readonly streamRegistry: StreamRegistry
  private streamHandle: number | null = null
  private readonly outputStream: WasiOutputStreamWrapper

  constructor(
    streamRegistry: StreamRegistry,
    stderrImpl: OutputStreamLike,
    callback?: (data: Uint8Array) => void
  ) {
    this.streamRegistry = streamRegistry
    this.outputStream = new WasiOutputStreamWrapper(stderrImpl, callback)
    this.streamHandle = streamRegistry.register(this.outputStream)
  }

  getImports(): Record<string, unknown> {
    return {
      'get-stderr': this.getStderr.bind(this),
    }
  }

  destroy(): void {
    if (this.streamHandle !== null) {
      this.streamRegistry.drop(this.streamHandle)
    }
  }

  private getStderr(): number {
    if (this.streamHandle === null) {
      throw new Error('stderr stream not available')
    }
    return this.streamHandle
  }

  /** Get the underlying output stream for testing/inspection */
  getOutputStream(): WasiOutputStreamWrapper {
    return this.outputStream
  }
}

// ============================================================================
// Implementation Factories
// ============================================================================

/**
 * Virtual stdin implementation - uses the global stdio provider
 */
export const virtualStdinImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual stdin using pluggable provider (default: console EOF)',
  create(config: PluginConfig): PluginInstance {
    // Check for provider configuration
    if (config.options?.['stdioProvider']) {
      const provider = config.options['stdioProvider'] as StdioProvider
      setGlobalStdioProvider(provider)
    } else if (config.options?.['stdio']) {
      const stdioConfig = config.options['stdio'] as ProviderStdioConfig
      setGlobalStdioProvider(createStdioProvider(stdioConfig))
    }

    // Legacy: stdinContent creates a memory stream
    const content = config.options?.['stdinContent'] as
      | string
      | Uint8Array
      | undefined
    if (content !== undefined) {
      const data =
        typeof content === 'string'
          ? new TextEncoder().encode(content)
          : content
      // Create a queue input stream and push the content
      const queue = new QueueInputStreamClass(false)
      queue.push(data)
      queue.close() // EOF after content
      return new StdinInstance(globalStreamRegistry, queue)
    }

    // Use global provider
    const state = getGlobalStdioState()
    return new StdinInstance(globalStreamRegistry, state.stdin)
  },
}

/**
 * Virtual stdout implementation - uses the global stdio provider
 */
export const virtualStdoutImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual stdout using pluggable provider (default: console)',
  create(config: PluginConfig): PluginInstance {
    const callback = config.options?.['onStdout'] as
      | ((data: Uint8Array) => void)
      | undefined

    // Use global provider
    const state = getGlobalStdioState()
    return new StdoutInstance(globalStreamRegistry, state.stdout, callback)
  },
}

/**
 * Virtual stderr implementation - uses the global stdio provider
 */
export const virtualStderrImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual stderr using pluggable provider (default: console)',
  create(config: PluginConfig): PluginInstance {
    const callback = config.options?.['onStderr'] as
      | ((data: Uint8Array) => void)
      | undefined

    // Use global provider
    const state = getGlobalStdioState()
    return new StderrInstance(globalStreamRegistry, state.stderr, callback)
  },
}
