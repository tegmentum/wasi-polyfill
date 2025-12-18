/**
 * WASI Preview 1 (wasip1) usage examples
 *
 * This example demonstrates how to use the WASIP1 implementation
 * to run legacy WebAssembly modules that use wasi_snapshot_preview1.
 *
 * WASIP1 is the original WASI specification, using flat function imports
 * with integer file descriptors.
 */

import {
  Wasip1,
  WasiExitError,
  Errno,
  type InputStream,
  type OutputStream,
  type Filesystem,
} from '@tegmentum/wasi-polyfill/wasip1'

// ============================================================================
// Example 1: Basic WASIP1 Setup
// ============================================================================

async function basicUsage() {
  console.log('=== Example 1: Basic WASIP1 Setup ===\n')

  // Create a WASIP1 instance with basic configuration
  const wasi = new Wasip1({
    args: ['my-program', '--verbose', 'input.txt'],
    env: {
      HOME: '/home/user',
      PATH: '/usr/bin:/bin',
      NODE_ENV: 'production',
    },
    returnOnExit: true, // Throw WasiExitError instead of halting
  })

  // Get the WASI imports object
  const wasiImports = wasi.getImports()

  console.log('WASI imports created with functions:')
  console.log('  -', Object.keys(wasiImports).length, 'functions available')
  console.log('  - Sample functions:', Object.keys(wasiImports).slice(0, 5).join(', '), '...')

  // In a real scenario, you would use these imports with WebAssembly:
  // const imports = { wasi_snapshot_preview1: wasiImports }
  // const { instance } = await WebAssembly.instantiate(wasmBytes, imports)
  // wasi.initialize(instance)
  // const start = instance.exports._start as () => void
  // start()

  console.log()
}

// ============================================================================
// Example 2: Custom I/O Streams
// ============================================================================

async function customIOUsage() {
  console.log('=== Example 2: Custom I/O Streams ===\n')

  // Create a custom input stream that provides data
  const inputData = 'Hello from stdin!\nLine 2\nLine 3'
  let inputOffset = 0
  const customStdin: InputStream = {
    read(maxBytes: number): Uint8Array | null {
      if (inputOffset >= inputData.length) {
        return null // EOF
      }
      const chunk = inputData.slice(inputOffset, inputOffset + maxBytes)
      inputOffset += chunk.length
      return new TextEncoder().encode(chunk)
    },
    close(): void {
      inputOffset = inputData.length
    },
  }

  // Create a custom output stream that captures data
  const outputChunks: string[] = []
  const customStdout: OutputStream = {
    write(data: Uint8Array): number {
      const text = new TextDecoder().decode(data)
      outputChunks.push(text)
      console.log('  [stdout captured]:', JSON.stringify(text))
      return data.length
    },
    close(): void {
      console.log('  [stdout closed]')
    },
  }

  // Error output to separate location
  const errorChunks: string[] = []
  const customStderr: OutputStream = {
    write(data: Uint8Array): number {
      const text = new TextDecoder().decode(data)
      errorChunks.push(text)
      console.log('  [stderr captured]:', JSON.stringify(text))
      return data.length
    },
    close(): void {
      console.log('  [stderr closed]')
    },
  }

  const wasi = new Wasip1({
    args: ['test-program'],
    env: {},
    stdin: customStdin,
    stdout: customStdout,
    stderr: customStderr,
    returnOnExit: true,
  })

  console.log('Custom I/O streams configured')
  console.log('  - stdin: provides', inputData.length, 'bytes')
  console.log('  - stdout: captures to array')
  console.log('  - stderr: captures to separate array')
  console.log()
}

// ============================================================================
// Example 3: Virtual Filesystem with Preopens
// ============================================================================

async function filesystemUsage() {
  console.log('=== Example 3: Virtual Filesystem ===\n')

  // Create a simple in-memory filesystem
  const files = new Map<string, Uint8Array>([
    ['config.json', new TextEncoder().encode('{"debug": true}')],
    ['data.txt', new TextEncoder().encode('Hello, World!')],
  ])

  const directories = new Map<string, string[]>([
    ['/', ['config.json', 'data.txt', 'subdir']],
    ['/subdir', ['nested.txt']],
  ])

  // Implement the Filesystem interface
  const virtualFs: Filesystem = {
    open(path: string, _flags: number): { fd: number } | { errno: number } {
      // Simplified: just check if file exists
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path
      if (files.has(normalizedPath)) {
        return { fd: 10 } // Return a dummy fd
      }
      return { errno: Errno.ENOENT }
    },

    stat(path: string): { type: 'file' | 'directory'; size: bigint } | { errno: number } {
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path
      if (files.has(normalizedPath)) {
        return { type: 'file', size: BigInt(files.get(normalizedPath)!.length) }
      }
      if (directories.has('/' + normalizedPath) || normalizedPath === '') {
        return { type: 'directory', size: 0n }
      }
      return { errno: Errno.ENOENT }
    },

    readdir(path: string): string[] | { errno: number } {
      const normalizedPath = path === '' ? '/' : (path.startsWith('/') ? path : '/' + path)
      if (directories.has(normalizedPath)) {
        return directories.get(normalizedPath)!
      }
      return { errno: Errno.ENOTDIR }
    },

    read(path: string, offset: bigint, length: number): Uint8Array | { errno: number } {
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path
      const data = files.get(normalizedPath)
      if (!data) {
        return { errno: Errno.ENOENT }
      }
      return data.slice(Number(offset), Number(offset) + length)
    },

    write(path: string, data: Uint8Array, offset: bigint): number | { errno: number } {
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path
      const existing = files.get(normalizedPath) ?? new Uint8Array(0)
      const newData = new Uint8Array(Math.max(existing.length, Number(offset) + data.length))
      newData.set(existing)
      newData.set(data, Number(offset))
      files.set(normalizedPath, newData)
      return data.length
    },

    unlink(path: string): void | { errno: number } {
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path
      if (files.has(normalizedPath)) {
        files.delete(normalizedPath)
        return
      }
      return { errno: Errno.ENOENT }
    },

    mkdir(path: string): void | { errno: number } {
      const normalizedPath = path.startsWith('/') ? path : '/' + path
      if (directories.has(normalizedPath)) {
        return { errno: Errno.EEXIST }
      }
      directories.set(normalizedPath, [])
      return
    },

    rmdir(path: string): void | { errno: number } {
      const normalizedPath = path.startsWith('/') ? path : '/' + path
      const contents = directories.get(normalizedPath)
      if (!contents) {
        return { errno: Errno.ENOENT }
      }
      if (contents.length > 0) {
        return { errno: Errno.ENOTEMPTY }
      }
      directories.delete(normalizedPath)
      return
    },

    rename(oldPath: string, newPath: string): void | { errno: number } {
      const oldNorm = oldPath.startsWith('/') ? oldPath.slice(1) : oldPath
      const newNorm = newPath.startsWith('/') ? newPath.slice(1) : newPath
      if (files.has(oldNorm)) {
        files.set(newNorm, files.get(oldNorm)!)
        files.delete(oldNorm)
        return
      }
      return { errno: Errno.ENOENT }
    },
  }

  const wasi = new Wasip1({
    args: ['fs-demo'],
    env: {},
    preopens: {
      '/': virtualFs,
      '/data': virtualFs, // Can mount same fs at multiple paths
    },
    returnOnExit: true,
  })

  console.log('Virtual filesystem configured:')
  console.log('  - Preopened: / and /data')
  console.log('  - Files:', Array.from(files.keys()).join(', '))
  console.log('  - Directories:', Array.from(directories.keys()).join(', '))
  console.log()
}

// ============================================================================
// Example 4: Handling Exit Codes
// ============================================================================

async function exitHandlingUsage() {
  console.log('=== Example 4: Handling Exit Codes ===\n')

  const wasi = new Wasip1({
    args: ['exit-demo'],
    env: {},
    returnOnExit: true, // This makes proc_exit throw WasiExitError
  })

  // Simulate what happens when a WASM module calls proc_exit
  const imports = wasi.getImports()
  const procExit = imports.proc_exit as (code: number) => void

  console.log('Testing exit handling...')

  // Test exit code 0 (success)
  try {
    procExit(0)
  } catch (e) {
    if (e instanceof WasiExitError) {
      console.log('  Exit code 0 caught: success (code =', e.code, ')')
    }
  }

  // Test exit code 1 (failure)
  try {
    procExit(1)
  } catch (e) {
    if (e instanceof WasiExitError) {
      console.log('  Exit code 1 caught: failure (code =', e.code, ')')
    }
  }

  // Test custom exit code
  try {
    procExit(42)
  } catch (e) {
    if (e instanceof WasiExitError) {
      console.log('  Exit code 42 caught: custom (code =', e.code, ')')
    }
  }

  console.log()
}

// ============================================================================
// Example 5: Clock and Random Functions
// ============================================================================

async function clockRandomUsage() {
  console.log('=== Example 5: Clock and Random Functions ===\n')

  const wasi = new Wasip1({
    args: ['clock-demo'],
    env: {},
    returnOnExit: true,
  })

  // Get the WASI imports
  const imports = wasi.getImports()

  // We need to initialize with a mock memory for these to work
  // In a real scenario, this would be the WebAssembly instance's memory
  const memory = new WebAssembly.Memory({ initial: 1 })
  const mockInstance = {
    exports: { memory },
  } as unknown as WebAssembly.Instance
  wasi.initialize(mockInstance)

  // Now we can demonstrate the concepts
  console.log('Clock functions available:')
  console.log('  - clock_time_get: Get current time for a clock')
  console.log('  - clock_res_get: Get resolution of a clock')
  console.log()
  console.log('Random functions available:')
  console.log('  - random_get: Fill buffer with random bytes')
  console.log()
  console.log('Clock IDs:')
  console.log('  - 0: REALTIME (wall clock)')
  console.log('  - 1: MONOTONIC (monotonically increasing)')
  console.log('  - 2: PROCESS_CPUTIME_ID')
  console.log('  - 3: THREAD_CPUTIME_ID')
  console.log()
}

// ============================================================================
// Example 6: Full Integration Pattern
// ============================================================================

async function fullIntegrationPattern() {
  console.log('=== Example 6: Full Integration Pattern ===\n')

  console.log(`
// This is the typical pattern for running a WASIP1 module:

import { Wasip1, WasiExitError } from '@tegmentum/wasi-polyfill/wasip1'

async function runWasiModule(wasmBytes: ArrayBuffer) {
  // 1. Create WASI instance with configuration
  const wasi = new Wasip1({
    args: ['my-program', 'arg1', 'arg2'],
    env: {
      HOME: '/home/user',
      USER: 'demo',
    },
    preopens: {
      '/': myFilesystem,
    },
    returnOnExit: true,
  })

  // 2. Compile and instantiate the WebAssembly module
  const imports = {
    wasi_snapshot_preview1: wasi.getImports(),
  }
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports)

  // 3. Initialize WASI with the instance's memory
  wasi.initialize(instance)

  // 4. Run the module's entry point
  try {
    const start = instance.exports._start as () => void
    start()
    console.log('Module completed successfully')
    return 0
  } catch (e) {
    if (e instanceof WasiExitError) {
      console.log('Module exited with code:', e.code)
      return e.code
    }
    throw e
  }
}
`)
}

// ============================================================================
// Run all examples
// ============================================================================

async function main() {
  console.log('WASIP1 Usage Examples')
  console.log('=====================\n')

  await basicUsage()
  await customIOUsage()
  await filesystemUsage()
  await exitHandlingUsage()
  await clockRandomUsage()
  await fullIntegrationPattern()

  console.log('All examples completed!')
}

// Run if executed directly
main().catch(console.error)

export {
  basicUsage,
  customIOUsage,
  filesystemUsage,
  exitHandlingUsage,
  clockRandomUsage,
  fullIntegrationPattern,
}
