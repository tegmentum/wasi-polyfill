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
 * import { Wasip1 } from '@tegmentum/wasip2-polyfill/wasip1'
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

import { WasiMemory } from './memory.js'
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

    this.pollFns = createPollFunctions(this.memory, this.fdTable)
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
    const self = this

    // Helper to ensure initialized
    const ensureInitialized = () => {
      if (!self.initialized) {
        throw new Error('WASI not initialized. Call wasi.initialize(instance) after WebAssembly.instantiate')
      }
    }

    return {
      // Process functions
      proc_exit: (code: number) => {
        ensureInitialized()
        return self.procFns.proc_exit(code)
      },
      proc_raise: (sig: number) => {
        ensureInitialized()
        return self.procFns.proc_raise(sig)
      },
      sched_yield: () => {
        ensureInitialized()
        return self.procFns.sched_yield()
      },

      // Args and environ functions
      args_get: (argvPtr: number, argvBufPtr: number) => {
        ensureInitialized()
        return self.argsEnvironFns.args_get(argvPtr, argvBufPtr)
      },
      args_sizes_get: (argcPtr: number, argvBufSizePtr: number) => {
        ensureInitialized()
        return self.argsEnvironFns.args_sizes_get(argcPtr, argvBufSizePtr)
      },
      environ_get: (environPtr: number, environBufPtr: number) => {
        ensureInitialized()
        return self.argsEnvironFns.environ_get(environPtr, environBufPtr)
      },
      environ_sizes_get: (environcPtr: number, environBufSizePtr: number) => {
        ensureInitialized()
        return self.argsEnvironFns.environ_sizes_get(environcPtr, environBufSizePtr)
      },

      // Clock functions
      clock_res_get: (clockId: number, resolutionPtr: number) => {
        ensureInitialized()
        return self.clockFns.clock_res_get(clockId, resolutionPtr)
      },
      clock_time_get: (clockId: number, precision: bigint, timePtr: number) => {
        ensureInitialized()
        return self.clockFns.clock_time_get(clockId, precision, timePtr)
      },

      // Random functions
      random_get: (bufPtr: number, bufLen: number) => {
        ensureInitialized()
        return self.randomFns.random_get(bufPtr, bufLen)
      },

      // FD functions
      fd_advise: (fd: number, offset: bigint, len: bigint, advice: number) => {
        ensureInitialized()
        return self.fdFns.fd_advise(fd, offset, len, advice)
      },
      fd_allocate: (fd: number, offset: bigint, len: bigint) => {
        ensureInitialized()
        return self.fdFns.fd_allocate(fd, offset, len)
      },
      fd_close: (fd: number) => {
        ensureInitialized()
        return self.fdFns.fd_close(fd)
      },
      fd_datasync: (fd: number) => {
        ensureInitialized()
        return self.fdFns.fd_datasync(fd)
      },
      fd_fdstat_get: (fd: number, statPtr: number) => {
        ensureInitialized()
        return self.fdFns.fd_fdstat_get(fd, statPtr)
      },
      fd_fdstat_set_flags: (fd: number, flags: number) => {
        ensureInitialized()
        return self.fdFns.fd_fdstat_set_flags(fd, flags)
      },
      fd_fdstat_set_rights: (fd: number, rightsBase: bigint, rightsInheriting: bigint) => {
        ensureInitialized()
        return self.fdFns.fd_fdstat_set_rights(fd, rightsBase, rightsInheriting)
      },
      fd_filestat_get: (fd: number, bufPtr: number) => {
        ensureInitialized()
        return self.fdFns.fd_filestat_get(fd, bufPtr)
      },
      fd_filestat_set_size: (fd: number, size: bigint) => {
        ensureInitialized()
        return self.fdFns.fd_filestat_set_size(fd, size)
      },
      fd_filestat_set_times: (fd: number, atim: bigint, mtim: bigint, fstFlags: number) => {
        ensureInitialized()
        return self.fdFns.fd_filestat_set_times(fd, atim, mtim, fstFlags)
      },
      fd_pread: (fd: number, iovsPtr: number, iovsLen: number, offset: bigint, nreadPtr: number) => {
        ensureInitialized()
        return self.fdFns.fd_pread(fd, iovsPtr, iovsLen, offset, nreadPtr)
      },
      fd_prestat_get: (fd: number, prestatPtr: number) => {
        ensureInitialized()
        return self.fdFns.fd_prestat_get(fd, prestatPtr)
      },
      fd_prestat_dir_name: (fd: number, pathPtr: number, pathLen: number) => {
        ensureInitialized()
        return self.fdFns.fd_prestat_dir_name(fd, pathPtr, pathLen)
      },
      fd_pwrite: (fd: number, ciovsPtr: number, ciovsLen: number, offset: bigint, nwrittenPtr: number) => {
        ensureInitialized()
        return self.fdFns.fd_pwrite(fd, ciovsPtr, ciovsLen, offset, nwrittenPtr)
      },
      fd_read: (fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number) => {
        ensureInitialized()
        return self.fdFns.fd_read(fd, iovsPtr, iovsLen, nreadPtr)
      },
      fd_readdir: (fd: number, bufPtr: number, bufLen: number, cookie: bigint, bufUsedPtr: number) => {
        ensureInitialized()
        return self.fdFns.fd_readdir(fd, bufPtr, bufLen, cookie, bufUsedPtr)
      },
      fd_renumber: (from: number, to: number) => {
        ensureInitialized()
        return self.fdFns.fd_renumber(from, to)
      },
      fd_seek: (fd: number, offset: bigint, whence: number, newOffsetPtr: number) => {
        ensureInitialized()
        return self.fdFns.fd_seek(fd, offset, whence, newOffsetPtr)
      },
      fd_sync: (fd: number) => {
        ensureInitialized()
        return self.fdFns.fd_sync(fd)
      },
      fd_tell: (fd: number, offsetPtr: number) => {
        ensureInitialized()
        return self.fdFns.fd_tell(fd, offsetPtr)
      },
      fd_write: (fd: number, ciovsPtr: number, ciovsLen: number, nwrittenPtr: number) => {
        ensureInitialized()
        return self.fdFns.fd_write(fd, ciovsPtr, ciovsLen, nwrittenPtr)
      },

      // Path functions
      path_create_directory: (fd: number, pathPtr: number, pathLen: number) => {
        ensureInitialized()
        return self.pathFns.path_create_directory(fd, pathPtr, pathLen)
      },
      path_filestat_get: (fd: number, flags: number, pathPtr: number, pathLen: number, bufPtr: number) => {
        ensureInitialized()
        return self.pathFns.path_filestat_get(fd, flags, pathPtr, pathLen, bufPtr)
      },
      path_filestat_set_times: (fd: number, flags: number, pathPtr: number, pathLen: number, atim: bigint, mtim: bigint, fstFlags: number) => {
        ensureInitialized()
        return self.pathFns.path_filestat_set_times(fd, flags, pathPtr, pathLen, atim, mtim, fstFlags)
      },
      path_link: (oldFd: number, oldFlags: number, oldPathPtr: number, oldPathLen: number, newFd: number, newPathPtr: number, newPathLen: number) => {
        ensureInitialized()
        return self.pathFns.path_link(oldFd, oldFlags, oldPathPtr, oldPathLen, newFd, newPathPtr, newPathLen)
      },
      path_open: (fd: number, dirflags: number, pathPtr: number, pathLen: number, oflags: number, rightsBase: bigint, rightsInheriting: bigint, fdflags: number, fdPtr: number) => {
        ensureInitialized()
        return self.pathFns.path_open(fd, dirflags, pathPtr, pathLen, oflags, rightsBase, rightsInheriting, fdflags, fdPtr)
      },
      path_readlink: (fd: number, pathPtr: number, pathLen: number, bufPtr: number, bufLen: number, bufUsedPtr: number) => {
        ensureInitialized()
        return self.pathFns.path_readlink(fd, pathPtr, pathLen, bufPtr, bufLen, bufUsedPtr)
      },
      path_remove_directory: (fd: number, pathPtr: number, pathLen: number) => {
        ensureInitialized()
        return self.pathFns.path_remove_directory(fd, pathPtr, pathLen)
      },
      path_rename: (oldFd: number, oldPathPtr: number, oldPathLen: number, newFd: number, newPathPtr: number, newPathLen: number) => {
        ensureInitialized()
        return self.pathFns.path_rename(oldFd, oldPathPtr, oldPathLen, newFd, newPathPtr, newPathLen)
      },
      path_symlink: (oldPathPtr: number, oldPathLen: number, fd: number, newPathPtr: number, newPathLen: number) => {
        ensureInitialized()
        return self.pathFns.path_symlink(oldPathPtr, oldPathLen, fd, newPathPtr, newPathLen)
      },
      path_unlink_file: (fd: number, pathPtr: number, pathLen: number) => {
        ensureInitialized()
        return self.pathFns.path_unlink_file(fd, pathPtr, pathLen)
      },

      // Poll functions
      poll_oneoff: (inPtr: number, outPtr: number, nsubscriptions: number, neventsPtr: number) => {
        ensureInitialized()
        return self.pollFns.poll_oneoff(inPtr, outPtr, nsubscriptions, neventsPtr)
      },

      // Socket functions (stubs - return ENOSYS)
      sock_accept: (_fd: number, _flags: number, _fdPtr: number) => {
        ensureInitialized()
        return Errno.ENOSYS
      },
      sock_recv: (_fd: number, _riDataPtr: number, _riDataLen: number, _riFlags: number, _roDatalenPtr: number, _roFlagsPtr: number) => {
        ensureInitialized()
        return Errno.ENOSYS
      },
      sock_send: (_fd: number, _siDataPtr: number, _siDataLen: number, _siFlags: number, _soDatalenPtr: number) => {
        ensureInitialized()
        return Errno.ENOSYS
      },
      sock_shutdown: (_fd: number, _how: number) => {
        ensureInitialized()
        return Errno.ENOSYS
      },
    }
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
