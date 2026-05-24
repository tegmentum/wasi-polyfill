/**
 * WASI Preview 3 (wasip3) implementation
 *
 * This module provides WASI Preview 3 support for WebAssembly components
 * using the new async Component Model features.
 *
 * WASI P3 introduces native async support with built-in `stream<T>` and
 * `future<T>` types, enabling composable concurrency across components.
 *
 * ## Scope & limitations
 *
 * This implementation models the async Component Model primitives (`stream<T>`,
 * `future<T>`, task/subtask) as **JavaScript objects** and wires imports/exports
 * as nested namespaces. It targets **jco-transpiled components**, where jco
 * generates the JS glue that bridges the component to these host objects.
 *
 * It does **not** implement the real canonical ABI (lifting/lowering values and
 * stream/future handles through linear memory + handle tables), so it cannot
 * `WebAssembly.instantiate` a raw P3 component binary directly — transpile P3
 * components with jco, then supply these imports. The Component Model async ABI
 * is still stabilizing upstream; real lift/lower is tracked as future work.
 *
 * @example
 * ```typescript
 * import { Wasip3 } from '@tegmentum/wasi-polyfill/wasip3'
 *
 * const wasi = new Wasip3({
 *   args: ['program', 'arg1'],
 *   env: { HOME: '/home/user' },
 * })
 *
 * // Load and run a P3 component
 * const instance = await wasi.instantiate(wasmBytes)
 * await instance.run()
 * ```
 *
 * @packageDocumentation
 */

import { AsyncExecutor } from './runtime/async-executor.js'
import { Task } from './canonical-abi/task.js'
import type { Stream, StreamWriter } from './types.js'

/**
 * WASI Preview 3 configuration options
 */
export interface Wasip3Config {
  /** Command-line arguments (argv) */
  args?: string[]

  /** Environment variables */
  env?: Record<string, string>

  /** Preopened directories mapping guest paths to host paths/filesystems */
  preopens?: Record<string, unknown>

  /** Standard input stream */
  stdin?: Stream<Uint8Array>

  /** Standard output stream */
  stdout?: StreamWriter<Uint8Array>

  /** Standard error stream */
  stderr?: StreamWriter<Uint8Array>
}

/**
 * WASI Preview 3 instance
 */
export interface Wasip3Instance {
  /**
   * Call an exported async function
   */
  callAsync<T>(name: string, args: unknown[]): Promise<T>

  /**
   * Call an exported sync function
   */
  callSync<T>(name: string, args: unknown[]): T

  /**
   * Run the component (if it exports wasi:cli/run)
   */
  run(): Promise<number>
}

/**
 * WASI Preview 3 polyfill
 *
 * Provides native async support for P3 components with built-in
 * stream<T> and future<T> types.
 *
 * Note: Full P3 component loading requires jco P3 support (in development).
 * This implementation provides the core async primitives that will be
 * used once tooling is available.
 */
export class Wasip3 {
  private config: Wasip3Config
  private executor: AsyncExecutor

  constructor(config: Wasip3Config = {}) {
    this.config = config
    this.executor = new AsyncExecutor()
  }

  /**
   * Get the command-line arguments.
   */
  getArgs(): string[] {
    return this.config.args ?? []
  }

  /**
   * Get the environment variables.
   */
  getEnv(): Record<string, string> {
    return this.config.env ?? {}
  }

  /**
   * Get the stdin stream.
   */
  getStdin(): Stream<Uint8Array> | undefined {
    return this.config.stdin
  }

  /**
   * Get the stdout stream writer.
   */
  getStdout(): StreamWriter<Uint8Array> | undefined {
    return this.config.stdout
  }

  /**
   * Get the stderr stream writer.
   */
  getStderr(): StreamWriter<Uint8Array> | undefined {
    return this.config.stderr
  }

  /**
   * Execute an async function using P3 semantics.
   *
   * This provides the task built-ins (task.start, task.return, etc.)
   * for implementing async exports.
   *
   * @param fn - The async function to execute
   * @returns Promise with the return values
   */
  async execute<T extends unknown[]>(
    fn: (task: Task) => Promise<void>
  ): Promise<T> {
    return this.executor.execute<T>(async (_builtins, task) => {
      await fn(task)
    })
  }

  /**
   * Get the async executor for advanced use cases.
   */
  getExecutor(): AsyncExecutor {
    return this.executor
  }

  /**
   * Instantiate a P3 component.
   *
   * Note: This requires jco P3 support which is still in development.
   * Currently returns a placeholder that demonstrates the API.
   *
   * @param _component - The component bytes
   * @returns The instantiated component
   */
  async instantiate(_component: ArrayBuffer): Promise<Wasip3Instance> {
    // Note: Full implementation requires jco P3 support
    // This placeholder demonstrates the intended API

    return {
      async callAsync<T>(name: string, args: unknown[]): Promise<T> {
        // This would call the component's async export
        console.warn(`P3 callAsync('${name}', ${JSON.stringify(args)}) - requires jco P3 support`)
        return undefined as T
      },

      callSync<T>(name: string, args: unknown[]): T {
        // This would call the component's sync export
        console.warn(`P3 callSync('${name}', ${JSON.stringify(args)}) - requires jco P3 support`)
        return undefined as T
      },

      async run(): Promise<number> {
        // This would call wasi:cli/run
        console.warn('P3 run() - requires jco P3 support')
        return 0
      },
    }
  }

  /**
   * Get the WASI imports for manual instantiation.
   *
   * Returns the imports object to be passed to WebAssembly.instantiate
   * or jco's instantiate function.
   */
  getImports(): Record<string, unknown> {
    const config = this.config

    return {
      // wasi:cli/environment@0.3.0
      'wasi:cli/environment@0.3.0': {
        'get-arguments': () => config.args ?? [],
        'get-environment': () => Object.entries(config.env ?? {}),
      },

      // wasi:cli/exit@0.3.0
      'wasi:cli/exit@0.3.0': {
        exit: (status: { tag: string; val?: number }) => {
          const code = status.tag === 'err' ? (status.val ?? 1) : 0
          throw new Wasip3ExitError(code)
        },
      },

      // wasi:random/random@0.3.0
      'wasi:random/random@0.3.0': {
        'get-random-bytes': (len: bigint): Uint8Array => {
          const bytes = new Uint8Array(Number(len))
          crypto.getRandomValues(bytes)
          return bytes
        },
        'get-random-u64': (): bigint => {
          const bytes = new Uint8Array(8)
          crypto.getRandomValues(bytes)
          const view = new DataView(bytes.buffer)
          return view.getBigUint64(0, true)
        },
      },

      // wasi:clocks/monotonic-clock@0.3.0
      'wasi:clocks/monotonic-clock@0.3.0': {
        now: (): bigint => BigInt(Math.floor(performance.now() * 1_000_000)),
        resolution: (): bigint => 1_000n, // 1 microsecond
      },

      // wasi:clocks/wall-clock@0.3.0
      'wasi:clocks/wall-clock@0.3.0': {
        now: (): { seconds: bigint; nanoseconds: number } => {
          const now = Date.now()
          return {
            seconds: BigInt(Math.floor(now / 1000)),
            nanoseconds: (now % 1000) * 1_000_000,
          }
        },
        resolution: (): { seconds: bigint; nanoseconds: number } => ({
          seconds: 0n,
          nanoseconds: 1_000_000, // 1 millisecond
        }),
      },
    }
  }
}

/**
 * Error thrown when a P3 component calls exit.
 */
export class Wasip3ExitError extends Error {
  constructor(public readonly code: number) {
    super(`Component exited with code ${code}`)
    this.name = 'Wasip3ExitError'
  }
}

/**
 * Create a WASI Preview 3 instance.
 *
 * @param config - Configuration options
 * @returns A new Wasip3 instance
 */
export function createWasip3(config?: Wasip3Config): Wasip3 {
  return new Wasip3(config)
}

// =============================================================================
// Re-exports
// =============================================================================

// Types
export type {
  Stream,
  StreamWriter,
  StreamReadResult,
  StreamWriteResult,
  Future,
  FutureReadResult,
  FutureResolver,
  TaskEvent,
  TaskEventType,
  SubtaskState,
  ErrorContext,
  WasiErrorCode,
  StreamHandle,
  FutureHandle,
  SubtaskHandleType,
} from './types.js'

// Canonical ABI
export {
  // Stream
  createStream,
  streamFromAsyncIterable,
  streamFromReadable,
  writerFromWritable,
  collectStream,
  // Future
  createFuture,
  futureFromPromise,
  delay,
  resolvedFuture,
  cancelledFuture,
  raceFutures,
  allFutures,
  // Task
  Task,
  createTaskBuiltins,
  type TaskBuiltins,
  // Subtask
  SubtaskManager,
  type SubtaskHandle,
  type Subtask,
} from './canonical-abi/index.js'

// Runtime
export {
  AsyncExecutor,
  runAsync,
  eventLoop,
  type AsyncExecutorConfig,
  type AsyncCaller,
  type ExecuteResult,
  // Component Loader
  Wasip3ComponentLoader,
  runComponent,
  runComponentFromUrl,
  type Wasip3LoaderConfig,
  type Wasip3ComponentInstance,
} from './runtime/index.js'

// Adapters
export {
  // Async/Sync bridge
  AsyncSyncBridge,
  EventDispatcher,
  createBridgeContext,
  blockingCall,
  promisify,
  wrapSyncAsAsync,
  wrapAsyncWithDefault,
  streamToFuture,
  futureToStream,
  pipeStream,
  mergeStreams,
  type BridgeContext,
  // P2 to P3 adapters
  adaptInputStream,
  adaptOutputStream,
  adaptPollable,
  adaptFileRead,
  adaptFileWrite,
  adaptDirectoryRead,
  adaptP2ToP3,
  createStreamFromCallback,
  createWriterFromCallback,
  type P2InputStream,
  type P2OutputStream,
  type P2Pollable,
  type P2Descriptor,
  type P2Plugin,
  type P3Plugin,
} from './adapters/index.js'

// Interfaces
export {
  // I/O
  ErrorContextImpl,
  createErrorContext,
  errorContextFromError,
  mapErrorToCode,
  getIoImports,
  // Clocks
  monotonicNow,
  monotonicResolution,
  sleepUntil,
  sleepFor,
  wallClockNow,
  wallClockResolution,
  getClocksImports,
  type Instant,
  type Duration,
  type Datetime,
  // Random
  getRandomBytes,
  getRandomU64,
  getInsecureRandomBytes,
  getInsecureRandomU64,
  setInsecureSeed,
  getSeededU64,
  getRandomImports,
  // CLI
  CliExitError,
  createStdinFromString,
  createStdinFromLines,
  createCollectingWriter,
  createConsoleWriter,
  getCliImports,
  type CliConfig,
  type ExitStatus,
  // Filesystem
  InMemoryFilesystem,
  getFilesystemImports,
  DescriptorFlags,
  DescriptorType,
  type DescriptorStat,
  type DirectoryEntry,
  // HTTP
  Fields,
  Body,
  Request,
  Response,
  OutgoingHandler,
  IncomingHandler,
  getHttpImports,
  HttpErrorCode,
  type Method,
  type Scheme,
  type HttpHandler,
  // Sockets
  TcpSocket,
  UdpSocket,
  Network,
  resolveAddresses,
  getSocketsImports,
  SocketErrorCode,
  type IpAddress,
  type IpSocketAddress,
  type TcpState,
} from './interfaces/index.js'
