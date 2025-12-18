/**
 * WASI Preview 3 Component Loader
 *
 * Loads and instantiates P3 WebAssembly components, providing
 * WASI imports and managing the component lifecycle.
 *
 * @packageDocumentation
 */

import type { Stream, StreamWriter } from '../types.js'
import { AsyncExecutor } from './async-executor.js'
import { InMemoryFilesystem, getFilesystemImports } from '../interfaces/filesystem.js'
import { getCliImports, CliExitError, type CliConfig } from '../interfaces/cli.js'
import { getClocksImports } from '../interfaces/clocks.js'
import { getRandomImports } from '../interfaces/random.js'
import { getIoImports } from '../interfaces/io.js'
import { getHttpImports, OutgoingHandler } from '../interfaces/http.js'
import { getSocketsImports } from '../interfaces/sockets.js'

/**
 * Configuration for loading a P3 component.
 */
export interface Wasip3LoaderConfig {
  /** Command-line arguments */
  args?: string[]

  /** Environment variables */
  env?: Record<string, string>

  /** Preopened directories */
  preopens?: Record<string, string>

  /** Standard input stream */
  stdin?: Stream<Uint8Array>

  /** Standard output stream writer */
  stdout?: StreamWriter<Uint8Array>

  /** Standard error stream writer */
  stderr?: StreamWriter<Uint8Array>

  /** Filesystem implementation */
  filesystem?: InMemoryFilesystem

  /** WebSocket gateway URL for TCP sockets */
  wsGatewayUrl?: string

  /** Custom fetch function for HTTP */
  fetch?: typeof fetch

  /** Additional imports to merge */
  additionalImports?: Record<string, unknown>
}

/**
 * A loaded P3 component instance.
 */
export interface Wasip3ComponentInstance {
  /**
   * The WebAssembly instance.
   */
  instance: WebAssembly.Instance

  /**
   * Call an exported async function.
   */
  callAsync<T>(name: string, ...args: unknown[]): Promise<T>

  /**
   * Call an exported sync function.
   */
  callSync<T>(name: string, ...args: unknown[]): T

  /**
   * Run the component's main entry point (wasi:cli/run).
   */
  run(): Promise<number>

  /**
   * Get the component's exports.
   */
  exports: WebAssembly.Exports

  /**
   * The executor used for this instance.
   */
  executor: AsyncExecutor

  /**
   * Cleanup resources.
   */
  dispose(): void
}

/**
 * Loads and instantiates WASI Preview 3 components.
 *
 * This loader provides all WASI P3 imports and manages
 * the component's lifecycle.
 *
 * @example
 * ```typescript
 * const loader = new Wasip3ComponentLoader({
 *   args: ['program', 'arg1'],
 *   env: { HOME: '/home/user' },
 * })
 *
 * const instance = await loader.load(wasmBytes)
 * const exitCode = await instance.run()
 * instance.dispose()
 * ```
 */
export class Wasip3ComponentLoader {
  private config: Wasip3LoaderConfig
  private instances: Set<Wasip3ComponentInstance> = new Set()

  constructor(config: Wasip3LoaderConfig = {}) {
    this.config = config
  }

  /**
   * Build the complete WASI imports object.
   */
  buildImports(): Record<string, unknown> {
    const config = this.config

    // Build CLI config - only include optional properties when defined
    const cliConfig: CliConfig = {
      args: config.args ?? [],
      env: config.env ?? {},
    }
    if (config.stdin !== undefined) {
      cliConfig.stdin = config.stdin
    }
    if (config.stdout !== undefined) {
      cliConfig.stdout = config.stdout
    }
    if (config.stderr !== undefined) {
      cliConfig.stderr = config.stderr
    }

    // Build filesystem
    const filesystem = config.filesystem ?? new InMemoryFilesystem()

    // Build HTTP handler
    const httpHandler = config.fetch
      ? new OutgoingHandler(config.fetch)
      : new OutgoingHandler()

    // Merge all imports
    const imports: Record<string, unknown> = {
      ...getIoImports(),
      ...getClocksImports(),
      ...getRandomImports(),
      ...getCliImports(cliConfig),
      ...getFilesystemImports(filesystem, config.preopens),
      ...getHttpImports(httpHandler),
      ...getSocketsImports(config.wsGatewayUrl),
      ...config.additionalImports,
    }

    return imports
  }

  /**
   * Load a P3 component from bytes.
   *
   * @param source - The component bytes or a WebAssembly.Module
   * @returns The instantiated component
   */
  async load(
    source: ArrayBuffer | Uint8Array | WebAssembly.Module
  ): Promise<Wasip3ComponentInstance> {
    const imports = this.buildImports()
    const executor = new AsyncExecutor()
    const loader = this

    // Compile if needed
    let module: WebAssembly.Module
    if (source instanceof WebAssembly.Module) {
      module = source
    } else {
      // Convert to ArrayBuffer for WebAssembly.compile
      let buffer: ArrayBuffer
      if (source instanceof Uint8Array) {
        // Create a new ArrayBuffer from Uint8Array to ensure we have a proper ArrayBuffer
        buffer = new ArrayBuffer(source.byteLength)
        new Uint8Array(buffer).set(source)
      } else {
        buffer = source
      }
      module = await WebAssembly.compile(buffer)
    }

    // Create wrapper imports that handle async
    const wrappedImports = this.wrapImportsForAsync(imports)

    // Instantiate
    const instance = await WebAssembly.instantiate(module, wrappedImports as WebAssembly.Imports)

    // Create component instance
    const componentInstance: Wasip3ComponentInstance = {
      instance,
      exports: instance.exports,
      executor,

      async callAsync<T>(name: string, ...args: unknown[]): Promise<T> {
        const fn = instance.exports[name]
        if (typeof fn !== 'function') {
          throw new Error(`Export '${name}' is not a function`)
        }

        // Execute with P3 async semantics
        return executor.execute<[T]>(async (_builtins, task) => {
          task.start()
          const result = (fn as Function)(...args)
          task.return([result])
        }).then(([result]) => result)
      },

      callSync<T>(name: string, ...args: unknown[]): T {
        const fn = instance.exports[name]
        if (typeof fn !== 'function') {
          throw new Error(`Export '${name}' is not a function`)
        }
        return (fn as Function)(...args) as T
      },

      async run(): Promise<number> {
        // Look for wasi:cli/run export
        const runFn = instance.exports['wasi:cli/run@0.3.0#run']
          ?? instance.exports['_start']
          ?? instance.exports['run']
          ?? instance.exports['main']

        if (typeof runFn !== 'function') {
          throw new Error('Component does not export a run function')
        }

        try {
          await executor.execute(async (_builtins, task) => {
            task.start()
            ;(runFn as Function)()
            task.return([])
          })
          return 0
        } catch (error) {
          if (error instanceof CliExitError) {
            return error.code
          }
          throw error
        }
      },

      dispose(): void {
        executor.cancelAll()
        loader.instances.delete(componentInstance)
      },
    }

    this.instances.add(componentInstance)
    return componentInstance
  }

  /**
   * Load a P3 component from a URL.
   *
   * @param url - The URL to fetch the component from
   * @returns The instantiated component
   */
  async loadFromUrl(url: string): Promise<Wasip3ComponentInstance> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch component: ${response.status}`)
    }
    const bytes = await response.arrayBuffer()
    return this.load(bytes)
  }

  /**
   * Load a P3 component that was transpiled by jco.
   *
   * This assumes the component has been transpiled to JavaScript
   * and can be imported as an ES module.
   *
   * @param moduleFactory - The jco-transpiled module factory
   * @returns The instantiated component
   */
  async loadTranspiled(
    moduleFactory: (imports: Record<string, unknown>) => Promise<{ exports: Record<string, unknown> }>
  ): Promise<Wasip3ComponentInstance> {
    const imports = this.buildImports()
    const executor = new AsyncExecutor()
    const loader = this

    // Call the jco-generated instantiate function
    const module = await moduleFactory(imports)

    // Create component instance
    const componentInstance: Wasip3ComponentInstance = {
      instance: {} as WebAssembly.Instance, // jco modules don't have a direct instance
      exports: module.exports as WebAssembly.Exports,
      executor,

      async callAsync<T>(name: string, ...args: unknown[]): Promise<T> {
        const fn = module.exports[name]
        if (typeof fn !== 'function') {
          throw new Error(`Export '${name}' is not a function`)
        }
        // jco-transpiled functions are already async-aware
        return (fn as Function)(...args) as T
      },

      callSync<T>(name: string, ...args: unknown[]): T {
        const fn = module.exports[name]
        if (typeof fn !== 'function') {
          throw new Error(`Export '${name}' is not a function`)
        }
        return (fn as Function)(...args) as T
      },

      async run(): Promise<number> {
        const runFn = module.exports['run']
          ?? module.exports['main']
          ?? module.exports['_start']

        if (typeof runFn !== 'function') {
          throw new Error('Component does not export a run function')
        }

        try {
          await (runFn as Function)()
          return 0
        } catch (error) {
          if (error instanceof CliExitError) {
            return error.code
          }
          throw error
        }
      },

      dispose(): void {
        executor.cancelAll()
        loader.instances.delete(componentInstance)
      },
    }

    this.instances.add(componentInstance)
    return componentInstance
  }

  /**
   * Wrap imports to handle async calling conventions.
   */
  private wrapImportsForAsync(
    imports: Record<string, unknown>
  ): Record<string, Record<string, unknown>> {
    const wrapped: Record<string, Record<string, unknown>> = {}

    for (const [namespace, members] of Object.entries(imports)) {
      if (typeof members === 'object' && members !== null) {
        wrapped[namespace] = members as Record<string, unknown>
      }
    }

    return wrapped
  }

  /**
   * Get all active instances.
   */
  getInstances(): Wasip3ComponentInstance[] {
    return Array.from(this.instances)
  }

  /**
   * Dispose all instances.
   */
  disposeAll(): void {
    for (const instance of this.instances) {
      instance.dispose()
    }
    this.instances.clear()
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Wasip3LoaderConfig {
    return { ...this.config }
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<Wasip3LoaderConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

/**
 * Convenience function to load and run a P3 component.
 *
 * @param source - Component bytes
 * @param config - Loader configuration
 * @returns Exit code
 */
export async function runComponent(
  source: ArrayBuffer | Uint8Array,
  config: Wasip3LoaderConfig = {}
): Promise<number> {
  const loader = new Wasip3ComponentLoader(config)
  const instance = await loader.load(source)

  try {
    return await instance.run()
  } finally {
    instance.dispose()
  }
}

/**
 * Convenience function to load a P3 component from URL and run it.
 *
 * @param url - Component URL
 * @param config - Loader configuration
 * @returns Exit code
 */
export async function runComponentFromUrl(
  url: string,
  config: Wasip3LoaderConfig = {}
): Promise<number> {
  const loader = new Wasip3ComponentLoader(config)
  const instance = await loader.loadFromUrl(url)

  try {
    return await instance.run()
  } finally {
    instance.dispose()
  }
}
