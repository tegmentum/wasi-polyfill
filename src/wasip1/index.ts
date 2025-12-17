/**
 * WASI Preview 1 (wasip1) implementation
 *
 * This module provides legacy WASI Preview 1 support for running older
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
 *   preopens: { '/': memoryFs },
 * })
 *
 * const imports = { wasi_snapshot_preview1: wasi.getImports() }
 * const { instance } = await WebAssembly.instantiate(wasmBytes, imports)
 *
 * // Bind memory after instantiation
 * wasi.initialize(instance.exports.memory as WebAssembly.Memory)
 *
 * // Run the module
 * const start = instance.exports._start as () => void
 * start()
 * ```
 *
 * @packageDocumentation
 */

// TODO: Implement WASI Preview 1 support
// This is a placeholder for future implementation

/**
 * WASI Preview 1 configuration options
 */
export interface Wasip1Config {
  /** Command-line arguments (argv) */
  args?: string[]

  /** Environment variables */
  env?: Record<string, string>

  /** Preopened directories mapping guest paths to host paths/filesystems */
  preopens?: Record<string, unknown>

  /** Standard input stream */
  stdin?: { read(len: number): Uint8Array }

  /** Standard output stream */
  stdout?: { write(data: Uint8Array): void }

  /** Standard error stream */
  stderr?: { write(data: Uint8Array): void }
}

/**
 * WASI Preview 1 error - thrown when P1 is used but not yet implemented
 */
export class Wasip1NotImplementedError extends Error {
  constructor() {
    super(
      'WASI Preview 1 support is not yet implemented. ' +
        'Please use WASI Preview 2 (wasip2) or contribute the implementation!'
    )
    this.name = 'Wasip1NotImplementedError'
  }
}

/**
 * WASI Preview 1 polyfill (not yet implemented)
 *
 * This class will provide the wasi_snapshot_preview1 imports for legacy
 * WebAssembly modules.
 */
export class Wasip1 {
  constructor(_config?: Wasip1Config) {
    throw new Wasip1NotImplementedError()
  }

  /**
   * Initialize with the WebAssembly memory
   * Must be called after instantiation
   */
  initialize(_memory: WebAssembly.Memory): void {
    throw new Wasip1NotImplementedError()
  }

  /**
   * Get the wasi_snapshot_preview1 imports
   */
  getImports(): Record<string, unknown> {
    throw new Wasip1NotImplementedError()
  }
}

/**
 * Create a WASI Preview 1 instance (not yet implemented)
 */
export function createWasip1(_config?: Wasip1Config): Wasip1 {
  throw new Wasip1NotImplementedError()
}
