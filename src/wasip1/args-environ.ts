/**
 * WASI Preview 1 args and environ functions
 *
 * Implements args_get, args_sizes_get, environ_get, environ_sizes_get.
 *
 * @packageDocumentation
 */

import { Errno } from './types.js'
import { WasiMemory } from './memory.js'

/**
 * Options for args/environ functions.
 */
export interface ArgsEnvironOptions {
  /** Command-line arguments (argv) */
  args?: string[]
  /** Environment variables */
  env?: Record<string, string>
}

/**
 * Creates WASI args and environ functions.
 */
export function createArgsEnvironFunctions(
  memory: WasiMemory,
  options: ArgsEnvironOptions = {}
): {
  args_get: (argvPtr: number, argvBufPtr: number) => number
  args_sizes_get: (argcPtr: number, argvBufSizePtr: number) => number
  environ_get: (environPtr: number, environBufPtr: number) => number
  environ_sizes_get: (environcPtr: number, environBufSizePtr: number) => number
} {
  const args = options.args ?? []
  const env = options.env ?? {}

  // Pre-encode args for efficiency
  const encodedArgs = args.map((arg) => new TextEncoder().encode(arg + '\0'))
  const argsTotalSize = encodedArgs.reduce((sum, arr) => sum + arr.length, 0)

  // Pre-encode environ for efficiency
  const environStrings = Object.entries(env).map(([key, value]) => `${key}=${value}`)
  const encodedEnviron = environStrings.map((s) => new TextEncoder().encode(s + '\0'))
  const environTotalSize = encodedEnviron.reduce((sum, arr) => sum + arr.length, 0)

  return {
    /**
     * args_get(argv: i32, argv_buf: i32) -> errno
     *
     * Read command-line argument data.
     * The sizes of the buffers should match those returned by args_sizes_get.
     */
    args_get(argvPtr: number, argvBufPtr: number): number {
      let bufOffset = argvBufPtr

      for (let i = 0; i < encodedArgs.length; i++) {
        // Write pointer to this arg
        memory.writeU32(argvPtr + i * 4, bufOffset)

        // Write the arg string (already null-terminated)
        memory.writeBytes(bufOffset, encodedArgs[i]!)
        bufOffset += encodedArgs[i]!.length
      }

      return Errno.SUCCESS
    },

    /**
     * args_sizes_get(argc: i32, argv_buf_size: i32) -> errno
     *
     * Return command-line argument data sizes.
     */
    args_sizes_get(argcPtr: number, argvBufSizePtr: number): number {
      memory.writeU32(argcPtr, args.length)
      memory.writeU32(argvBufSizePtr, argsTotalSize)
      return Errno.SUCCESS
    },

    /**
     * environ_get(environ: i32, environ_buf: i32) -> errno
     *
     * Read environment variable data.
     * The sizes of the buffers should match those returned by environ_sizes_get.
     */
    environ_get(environPtr: number, environBufPtr: number): number {
      let bufOffset = environBufPtr

      for (let i = 0; i < encodedEnviron.length; i++) {
        // Write pointer to this env var
        memory.writeU32(environPtr + i * 4, bufOffset)

        // Write the env var string (already null-terminated)
        memory.writeBytes(bufOffset, encodedEnviron[i]!)
        bufOffset += encodedEnviron[i]!.length
      }

      return Errno.SUCCESS
    },

    /**
     * environ_sizes_get(environc: i32, environ_buf_size: i32) -> errno
     *
     * Return environment variable data sizes.
     */
    environ_sizes_get(environcPtr: number, environBufSizePtr: number): number {
      memory.writeU32(environcPtr, environStrings.length)
      memory.writeU32(environBufSizePtr, environTotalSize)
      return Errno.SUCCESS
    },
  }
}
