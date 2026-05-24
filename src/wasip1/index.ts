/**
 * WASI Preview 1 (wasip1) implementation
 *
 * This module provides WASI Preview 1 support for running older
 * WebAssembly modules that use the wasi_snapshot_preview1 import namespace.
 *
 * WASI P1 uses a flat function import model with integer file descriptors,
 * as opposed to P2's component model with typed handles.
 *
 * @example
 * ```typescript
 * import { Wasip1 } from '@tegmentum/wasi-polyfill/wasip1'
 *
 * const wasi = new Wasip1({
 *   args: ['program', 'arg1'],
 *   env: { HOME: '/home/user' },
 * })
 *
 * const imports = { wasi_snapshot_preview1: wasi.getImports() }
 * const { instance } = await WebAssembly.instantiate(wasmBytes, imports)
 *
 * // Initialize WASI with the instance's memory
 * wasi.initialize(instance)
 *
 * // Run the module
 * try {
 *   const start = instance.exports._start as () => void
 *   start()
 * } catch (e) {
 *   if (e instanceof WasiExitError) {
 *     console.log('Exit code:', e.code)
 *   } else {
 *     throw e
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

import { WasiMemory, WasiMemoryError } from './memory.js'
import {
  FileDescriptorTable,
  createStdinEntry,
  createStdoutEntry,
  createStderrEntry,
  createDirectoryEntry,
} from './fd-table.js'
import { createProcFunctions } from './proc.js'
import { createArgsEnvironFunctions } from './args-environ.js'
import { createClockFunctions } from './clock.js'
import { createRandomFunctions } from './random.js'
import { createFdFunctions, type InputStream, type OutputStream } from './fd.js'
import { createPathFunctions, type Filesystem } from './path.js'
import { createPollFunctions } from './poll.js'
import { Errno } from './types.js'

// Re-export types
export { WasiExitError } from './proc.js'
export type { InputStream, OutputStream, FileResource, DirectoryResource } from './fd.js'
export type { Filesystem } from './path.js'
export * from './types.js'

/**
 * WASI Preview 1 configuration options
 */
export interface Wasip1Config {
  /** Command-line arguments (argv). Default: [] */
  args?: string[]

  /** Environment variables. Default: {} */
  env?: Record<string, string>

  /**
   * Preopened directories mapping guest paths to filesystems.
   * Example: { '/': myFilesystem, '/tmp': tmpFilesystem }
   */
  preopens?: Record<string, Filesystem>

  /** Standard input stream */
  stdin?: InputStream

  /** Standard output stream */
  stdout?: OutputStream

  /** Standard error stream */
  stderr?: OutputStream

  /**
   * If true, proc_exit throws WasiExitError instead of halting.
   * Default: false
   */
  returnOnExit?: boolean

  /**
   * If true, `poll_oneoff` blocks the thread until the earliest clock deadline
   * when no subscription is ready (so guest sleeps actually wait instead of
   * busy-looping). Synchronous blocking via `Atomics.wait` with a busy-wait
   * fallback. Default false. Only safe where blocking the thread is acceptable
   * (Node, Web Workers) — avoid on the main browser thread.
   */
  blockingPoll?: boolean
}

/**
 * Default console output stream.
 * Buffers output and writes complete lines to console.log/console.error.
 */
class ConsoleOutputStream implements OutputStream {
  private buffer = ''
  private readonly isError: boolean

  constructor(isError = false) {
    this.isError = isError
  }

  write(data: Uint8Array): void {
    const text = new TextDecoder().decode(data)
    this.buffer += text

    // Write complete lines
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (this.isError) {
        console.error(line)
      } else {
        console.log(line)
      }
    }
  }

  /** Flush any remaining buffered output */
  flush(): void {
    if (this.buffer) {
      if (this.isError) {
        console.error(this.buffer)
      } else {
        console.log(this.buffer)
      }
      this.buffer = ''
    }
  }
}

/**
 * WASI Preview 1 implementation.
 *
 * Provides the wasi_snapshot_preview1 imports for legacy WebAssembly modules.
 */
export class Wasip1 {
  private readonly memory: WasiMemory
  private readonly fdTable: FileDescriptorTable
  private readonly procFns: ReturnType<typeof createProcFunctions>
  private readonly argsEnvironFns: ReturnType<typeof createArgsEnvironFunctions>
  private readonly clockFns: ReturnType<typeof createClockFunctions>
  private readonly randomFns: ReturnType<typeof createRandomFunctions>
  private readonly fdFns: ReturnType<typeof createFdFunctions>
  private readonly pathFns: ReturnType<typeof createPathFunctions>
  private readonly pollFns: ReturnType<typeof createPollFunctions>
  private readonly stdout: ConsoleOutputStream | OutputStream
  private readonly stderr: ConsoleOutputStream | OutputStream
  private initialized = false

  constructor(config: Wasip1Config = {}) {
    this.memory = new WasiMemory()
    this.fdTable = new FileDescriptorTable()

    // Set up stdout/stderr with defaults
    this.stdout = config.stdout ?? new ConsoleOutputStream(false)
    this.stderr = config.stderr ?? new ConsoleOutputStream(true)

    // Initialize stdio
    this.fdTable.initStdio(
      createStdinEntry(config.stdin),
      createStdoutEntry(this.stdout),
      createStderrEntry(this.stderr)
    )

    // Set up preopens
    const filesystems = new Map<string, Filesystem>()
    if (config.preopens) {
      let preopenFd = 3 // Start after stdio
      for (const [guestPath, filesystem] of Object.entries(config.preopens)) {
        filesystems.set(guestPath, filesystem)
        const entry = createDirectoryEntry(guestPath, guestPath, { filesystem })
        this.fdTable.allocateAt(preopenFd++, entry)
      }
    }

    // Create function implementations
    const procOptions: { returnOnExit?: boolean; onExit?: (code: number) => void } = {
      onExit: () => {
        // Flush output on exit
        if (this.stdout instanceof ConsoleOutputStream) {
          this.stdout.flush()
        }
        if (this.stderr instanceof ConsoleOutputStream) {
          this.stderr.flush()
        }
      },
    }
    if (config.returnOnExit !== undefined) {
      procOptions.returnOnExit = config.returnOnExit
    }
    this.procFns = createProcFunctions(procOptions)

    const argsEnvironOptions: { args?: string[]; env?: Record<string, string> } = {}
    if (config.args !== undefined) {
      argsEnvironOptions.args = config.args
    }
    if (config.env !== undefined) {
      argsEnvironOptions.env = config.env
    }
    this.argsEnvironFns = createArgsEnvironFunctions(this.memory, argsEnvironOptions)

    this.clockFns = createClockFunctions(this.memory)
    this.randomFns = createRandomFunctions(this.memory)

    const fdOptions: { stdin?: InputStream; stdout?: OutputStream; stderr?: OutputStream } = {
      stdout: this.stdout,
      stderr: this.stderr,
    }
    if (config.stdin !== undefined) {
      fdOptions.stdin = config.stdin
    }
    this.fdFns = createFdFunctions(this.memory, this.fdTable, fdOptions)

    this.pathFns = createPathFunctions(this.memory, this.fdTable, {
      filesystems,
    })

    this.pollFns = createPollFunctions(this.memory, this.fdTable, {
      blocking: config.blockingPoll ?? false,
    })
  }

  /**
   * Initialize WASI with the WebAssembly instance.
   * Must be called after WebAssembly.instantiate and before calling _start.
   */
  initialize(instance: WebAssembly.Instance): void {
    const memory = instance.exports.memory as WebAssembly.Memory | undefined
    if (!memory) {
      throw new Error('WebAssembly instance does not export memory')
    }
    this.memory.attach(memory)
    this.initialized = true
  }

  /**
   * Get the wasi_snapshot_preview1 imports object.
   * Pass this to WebAssembly.instantiate as { wasi_snapshot_preview1: wasi.getImports() }
   */
  getImports(): WebAssembly.ModuleImports {
    // Helper to ensure initialized (arrow keeps `this` bound to the instance).
    const ensureInitialized = () => {
      if (!this.initialized) {
        throw new Error('WASI not initialized. Call wasi.initialize(instance) after WebAssembly.instantiate')
      }
    }

    // Each WASI import is a thin guard that checks initialization then forwards
    // to the matching function group. Generated from the groups instead of being
    // hand-written per function (was ~180 lines of identical passthroughs).
    const guard =
      <F extends (...args: never[]) => unknown>(fn: F) =>
      (...args: never[]): unknown => {
        ensureInitialized()
        return fn(...args)
      }

    // procFns also exposes getExitCode(), which is not a guest import.
    const { getExitCode: _getExitCode, ...procImports } = this.procFns

    const groups: Array<Record<string, (...args: never[]) => unknown>> = [
      procImports,
      this.argsEnvironFns,
      this.clockFns,
      this.randomFns,
      this.fdFns,
      this.pathFns,
      this.pollFns,
    ]

    const imports: Record<string, (...args: never[]) => unknown> = {}
    for (const group of groups) {
      for (const [name, fn] of Object.entries(group)) {
        imports[name] = guard(fn)
      }
    }

    // Socket operations are unsupported in this environment (no backing group).
    for (const name of ['sock_accept', 'sock_recv', 'sock_send', 'sock_shutdown']) {
      imports[name] = guard(() => Errno.ENOSYS)
    }

    // Translate guest memory faults (out-of-range pointers) into EFAULT instead
    // of letting a RangeError escape the import and trap the host. Every WASI
    // p1 function returns an errno, so returning EFAULT here is well-typed;
    // WasiExitError and init errors are not WasiMemoryError and pass through.
    for (const name of Object.keys(imports)) {
      const fn = imports[name]!
      imports[name] = (...args: never[]) => {
        try {
          return fn(...args)
        } catch (err) {
          if (err instanceof WasiMemoryError) {
            return err.errno
          }
          throw err
        }
      }
    }

    return imports
  }

  /**
   * Check if the module has exited.
   */
  get exited(): boolean {
    return this.procFns.getExitCode() !== null
  }

  /**
   * Get the exit code if the module has exited.
   */
  get exitCode(): number | null {
    return this.procFns.getExitCode()
  }

  /**
   * Get the file descriptor table (for advanced use).
   */
  get fileDescriptorTable(): FileDescriptorTable {
    return this.fdTable
  }
}

/**
 * Create a WASI Preview 1 instance.
 */
export function createWasip1(config?: Wasip1Config): Wasip1 {
  return new Wasip1(config)
}
