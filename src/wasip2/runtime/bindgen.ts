/**
 * Runtime bindgen for WebAssembly Component Model
 *
 * Provides runtime transpilation and instantiation of components
 * without build-time code generation.
 *
 * This uses jco's browser build for component model transpilation,
 * enabling full component model support in the browser.
 */

import type { WasiInterface, PolyfillConfig } from '../core/types.js'
import { Polyfill, createDevPolyfill } from '../core/polyfill.js'
import { parseComponentImports } from './parser.js'
import type { ParsedComponentInfo } from './parser.js'

/**
 * Options for runtime bindgen
 */
export interface RuntimeBindgenOptions {
  /**
   * Polyfill instance to use
   */
  polyfill?: Polyfill

  /**
   * Polyfill configuration (used if polyfill not provided)
   */
  polyfillConfig?: PolyfillConfig

  /**
   * Use development mode (allow all interfaces)
   * @default false
   */
  devMode?: boolean

  /**
   * Additional imports beyond WASI
   */
  additionalImports?: Record<string, Record<string, unknown>>

  /**
   * Custom jco options for transpilation
   */
  jcoOptions?: JcoTranspileOptions
}

/**
 * Options passed to jco transpile
 */
export interface JcoTranspileOptions {
  /**
   * Name for the component
   */
  name?: string

  /**
   * Whether to use top-level await compatibility mode
   * @default true (for broader browser support)
   */
  tlaCompat?: boolean

  /**
   * Whether to emit minified output
   * @default false
   */
  minify?: boolean

  /**
   * Whether to optimize the wasm
   * @default false
   */
  optimize?: boolean

  /**
   * Base64 cutoff for inlining wasm
   * Set to 0 to disable inlining
   * @default 5000
   */
  base64Cutoff?: number

  /**
   * Async transpilation mode.
   *
   * Set to `'jspi'` for components whose imports SUSPEND the guest — e.g.
   * blocking `wasi:io/poll` (`pollable.block`), `wasi:http`, `wasi:sockets`, or
   * any host-async custom interface. In the default `'sync'` mode such imports
   * cannot await the polyfill's async plugins, so the guest cannot truly block:
   * the sync trampoline is handed a Promise it cannot suspend on. JSPI
   * (JavaScript Promise Integration) makes the suspend real.
   *
   * Requires JSPI support in the host (`WebAssembly.Suspending`/`promising`;
   * Chrome 137+, Node 22+).
   * @default 'sync'
   */
  asyncMode?: 'sync' | 'jspi'

  /**
   * Imports to make async (suspending) when `asyncMode: 'jspi'`. Each entry is a
   * jco import specifier, e.g. `'wasi:io/poll@0.2.0#[method]pollable.block'` or a
   * custom `'my:pkg/iface@0.1.0#func'`.
   */
  asyncImports?: string[]

  /**
   * Exports to make async (promising) when `asyncMode: 'jspi'`. Any export that
   * (transitively) reaches a suspending import must be listed, e.g. `'handle'`
   * or `'wasi:cli/run@0.2.0#run'`.
   */
  asyncExports?: string[]
}

/**
 * Result of bindgen
 */
export interface BindgenResult<T = Record<string, unknown>> {
  /**
   * The instantiated component exports
   */
  exports: T

  /**
   * The component info
   */
  componentInfo: ParsedComponentInfo

  /**
   * Loaded WASI interfaces
   */
  loadedInterfaces: WasiInterface[]

  /**
   * Whether jco was used for transpilation
   */
  usedJco: boolean

  /**
   * Clean up resources
   */
  destroy(): void
}

/**
 * Transpile result from jco
 * files is an array of [filename, contents] tuples
 */
interface TranspileResult {
  files: Array<[string, Uint8Array]>
  imports: string[]
  exports: Array<[string, 'function' | 'instance']>
}

/**
 * The instantiate function signature from jco instantiation mode
 */
type InstantiateFunction<T> = (
  getCoreModule: (path: string) => Promise<WebAssembly.Module>,
  imports: Record<string, Record<string, unknown>>,
  instantiateCore?: (
    module: WebAssembly.Module,
    imports: Record<string, unknown>
  ) => Promise<WebAssembly.Instance>
) => Promise<T>

/**
 * Runtime bindgen for component model
 *
 * This class provides full component model support by:
 * 1. Parsing component imports
 * 2. Transpiling the component to JavaScript+WASM using jco (browser build)
 * 3. Providing WASI imports via the polyfill
 * 4. Instantiating and returning typed exports
 *
 * @example
 * ```typescript
 * import { RuntimeBindgen } from '@tegmentum/wasi-polyfill/runtime'
 * import { registerCorePlugins } from '@tegmentum/wasi-polyfill'
 *
 * // Register plugins first
 * await registerCorePlugins()
 *
 * const bindgen = new RuntimeBindgen({ devMode: true })
 *
 * // Instantiate a component directly from .wasm bytes
 * const result = await bindgen.instantiate<MyExports>(wasmBytes)
 *
 * // Use exports with type safety
 * const value = result.exports.myFunction()
 *
 * // Clean up
 * result.destroy()
 * ```
 */
/**
 * jco generate options with proper instantiation mode format
 */
interface JcoGenerateOptions {
  name: string
  instantiation?: { tag: 'async' } | { tag: 'sync' }
  asyncMode?: JcoAsyncMode
  tlaCompat?: boolean
  compat?: boolean
  noNodejsCompat?: boolean
  base64Cutoff?: number
  tracing?: boolean
  map?: Array<[string, string]>
}

/**
 * jco's `GenerateOptions.asyncMode` shape: `null` = sync; `'jspi'` carries the
 * suspending imports and promising exports.
 */
export type JcoAsyncMode = null | {
  tag: 'jspi'
  val: { imports: string[]; exports: string[] }
}

/**
 * Map the polyfill's async transpile options onto jco's `asyncMode` argument.
 * `'sync'` (the default) → `null`; `'jspi'` → a JSPI descriptor with the
 * suspending imports / promising exports. Exported for testing.
 */
export function buildAsyncMode(opts?: JcoTranspileOptions): JcoAsyncMode {
  if (!opts || (opts.asyncMode ?? 'sync') !== 'jspi') {
    return null
  }
  return {
    tag: 'jspi',
    val: { imports: opts.asyncImports ?? [], exports: opts.asyncExports ?? [] },
  }
}

/**
 * Type for the jco generate function
 * Note: The browser build wraps this in async, but types show sync
 */
type JcoGenerateFunction = (
  component: Uint8Array,
  options: JcoGenerateOptions
) => TranspileResult | Promise<TranspileResult>

export class RuntimeBindgen {
  private polyfill: Polyfill
  private ownsPolyfill: boolean
  private options: RuntimeBindgenOptions
  private jcoAvailable: boolean | null = null
  private jcoModule: { generate: JcoGenerateFunction } | null = null

  constructor(options: RuntimeBindgenOptions = {}) {
    this.options = options

    if (options.polyfill) {
      this.polyfill = options.polyfill
      this.ownsPolyfill = false
    } else if (options.devMode) {
      this.polyfill = createDevPolyfill()
      this.ownsPolyfill = true
    } else {
      this.polyfill = new Polyfill(options.polyfillConfig)
      this.ownsPolyfill = true
    }
  }

  /**
   * Instantiate a component with runtime bindgen
   */
  async instantiate<T = Record<string, unknown>>(
    bytes: ArrayBuffer | Uint8Array
  ): Promise<BindgenResult<T>> {
    // Parse component to understand its structure
    const componentInfo = parseComponentImports(bytes)

    if (!componentInfo.isComponent) {
      // Try as a core module
      return this.instantiateCoreModule<T>(bytes, componentInfo)
    }

    // Check if jco is available for full component model support
    const hasJco = await this.checkJcoAvailable()

    if (hasJco) {
      return this.instantiateWithJco<T>(bytes, componentInfo)
    }

    // Fall back to direct instantiation (limited support)
    return this.instantiateDirect<T>(bytes, componentInfo)
  }

  /**
   * Instantiate a component from a URL
   */
  async instantiateFromUrl<T = Record<string, unknown>>(
    url: string
  ): Promise<BindgenResult<T>> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch component: ${response.statusText}`)
    }
    const bytes = await response.arrayBuffer()
    return this.instantiate<T>(bytes)
  }

  /**
   * Check if jco is available for runtime transpilation
   */
  async isJcoAvailable(): Promise<boolean> {
    return this.checkJcoAvailable()
  }

  /**
   * Get the polyfill instance
   */
  getPolyfill(): Polyfill {
    return this.polyfill
  }

  /**
   * Destroy the bindgen and its resources
   */
  destroy(): void {
    if (this.ownsPolyfill) {
      this.polyfill.destroy()
    }
  }

  private async checkJcoAvailable(): Promise<boolean> {
    if (this.jcoAvailable !== null) {
      return this.jcoAvailable
    }

    try {
      // Use the browser-compatible build of jco
      // This import path works in both Node.js and browsers
      const jco = await import('@bytecodealliance/jco/component')
      this.jcoModule = { generate: jco.generate as JcoGenerateFunction }
      this.jcoAvailable = true
    } catch {
      this.jcoAvailable = false
    }

    return this.jcoAvailable
  }

  private async instantiateWithJco<T>(
    bytes: ArrayBuffer | Uint8Array,
    componentInfo: ParsedComponentInfo
  ): Promise<BindgenResult<T>> {
    if (!this.jcoModule) {
      throw new Error('jco module not loaded')
    }

    // Get WASI imports from polyfill
    const { imports: wasiImports, loaded } = await this.polyfill.getImports(
      componentInfo.requiredInterfaces,
      { throwOnMissing: true, throwOnDenied: true, jcoCompat: true }
    )

    // Merge with additional imports
    const allImports = {
      ...wasiImports,
      ...this.options.additionalImports,
    }

    // Transpile the component using jco's generate function with instantiation mode
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const transpiled: TranspileResult = await this.jcoModule.generate(data, {
      name: this.options.jcoOptions?.name ?? 'component',
      instantiation: { tag: 'async' }, // Use async instantiation mode
      // JSPI when requested (suspending imports / promising exports), else sync.
      asyncMode: buildAsyncMode(this.options.jcoOptions),
      tlaCompat: this.options.jcoOptions?.tlaCompat ?? true,
      base64Cutoff: this.options.jcoOptions?.base64Cutoff ?? 5000,
      noNodejsCompat: true, // Browser-only output
    })

    // Execute the transpiled code and get exports
    const exports = await this.executeTranspiled<T>(transpiled, allImports)

    return {
      exports,
      componentInfo,
      loadedInterfaces: loaded,
      usedJco: true,
      destroy: () => {
        if (this.ownsPolyfill) {
          this.polyfill.destroy()
        }
      },
    }
  }

  private async executeTranspiled<T>(
    transpiled: TranspileResult,
    imports: Record<string, Record<string, unknown>>
  ): Promise<T> {
    // Files are tuples: [filename, contents]
    // Find the main JS file
    const mainJs = transpiled.files.find(
      ([name]) => name.endsWith('.js') && !name.endsWith('.d.ts')
    )

    if (!mainJs) {
      throw new Error('Transpilation did not produce a JavaScript file')
    }

    // Create a map of WASM file contents for the getCoreModule function
    const wasmModules = new Map<string, Uint8Array>()
    for (const [name, contents] of transpiled.files) {
      if (name.endsWith('.wasm')) {
        wasmModules.set(name, contents)
      }
    }

    // Compile WASM modules ahead of time
    const compiledModules = new Map<string, WebAssembly.Module>()
    for (const [name, contents] of wasmModules) {
      // Create a proper ArrayBuffer from the Uint8Array
      const buffer = contents.buffer.slice(
        contents.byteOffset,
        contents.byteOffset + contents.byteLength
      ) as ArrayBuffer
      const module = await WebAssembly.compile(buffer)
      compiledModules.set(name, module)
    }

    // Create the getCoreModule function
    const getCoreModule = async (path: string): Promise<WebAssembly.Module> => {
      // Normalize the path - jco generates relative paths like './component.core.wasm'
      const normalizedPath = path.replace(/^\.\//, '')
      const module = compiledModules.get(normalizedPath)
      if (!module) {
        throw new Error(`Core module not found: ${path}`)
      }
      return module
    }

    // Execute the JS module to get the instantiate function
    const instantiate = await this.loadInstantiateFunction<T>(
      mainJs[1], // contents is at index 1
      transpiled.files
    )

    // Call instantiate with our imports
    return instantiate(getCoreModule, imports)
  }

  private async loadInstantiateFunction<T>(
    jsContents: Uint8Array,
    allFiles: Array<[string, Uint8Array]>
  ): Promise<InstantiateFunction<T>> {
    const jsCode = new TextDecoder().decode(jsContents)

    // Find the main JS file name for comparison
    const mainJsFile = allFiles.find(
      ([name]) => name.endsWith('.js') && !name.endsWith('.d.ts')
    )

    // Create blob URLs for any additional JS files (like .core.js files)
    const jsBlobUrls = new Map<string, string>()

    for (const [name, contents] of allFiles) {
      if (
        name.endsWith('.js') &&
        !name.endsWith('.d.ts') &&
        mainJsFile && name !== mainJsFile[0]
      ) {
        // Create a proper ArrayBuffer for the Blob
        const buffer = contents.buffer.slice(
          contents.byteOffset,
          contents.byteOffset + contents.byteLength
        ) as ArrayBuffer
        const blob = new Blob([buffer], { type: 'text/javascript' })
        jsBlobUrls.set(name, URL.createObjectURL(blob))
      }
    }

    try {
      // Patch the JS to remove any imports we need to replace
      // jco with instantiation mode generates self-contained code
      // that doesn't import WASI shims - it expects them via the imports parameter
      let patchedJs = jsCode

      // Replace relative .js imports with blob URLs if any exist
      for (const [filename, blobUrl] of jsBlobUrls) {
        patchedJs = patchedJs.replace(
          new RegExp(`['"]\\./${filename.replace('.', '\\.')}['"]`, 'g'),
          `'${blobUrl}'`
        )
      }

      // Create a blob URL for the main JS and import it
      const jsBlob = new Blob([patchedJs], { type: 'text/javascript' })
      const jsUrl = URL.createObjectURL(jsBlob)

      try {
        // Dynamic import the module
        const module = await import(/* @vite-ignore */ jsUrl)

        // The module should export an instantiate function
        if (typeof module.instantiate !== 'function') {
          throw new Error(
            'Transpiled module does not export an instantiate function. ' +
              'This may indicate a jco version mismatch.'
          )
        }

        return module.instantiate as InstantiateFunction<T>
      } finally {
        URL.revokeObjectURL(jsUrl)
      }
    } finally {
      // Clean up blob URLs
      for (const url of jsBlobUrls.values()) {
        URL.revokeObjectURL(url)
      }
    }
  }

  private async instantiateDirect<T>(
    bytes: ArrayBuffer | Uint8Array,
    componentInfo: ParsedComponentInfo
  ): Promise<BindgenResult<T>> {
    // Get WASI imports
    const { imports: wasiImports, loaded } = await this.polyfill.getImports(
      componentInfo.requiredInterfaces,
      { throwOnMissing: true, throwOnDenied: true }
    )

    // Merge with additional imports
    const allImports = {
      ...wasiImports,
      ...this.options.additionalImports,
    }

    // Try direct instantiation (works for some components)
    try {
      const buffer = bytes instanceof Uint8Array ? bytes.buffer : bytes
      const result: WebAssembly.WebAssemblyInstantiatedSource =
        await WebAssembly.instantiate(
          buffer as ArrayBuffer,
          allImports as WebAssembly.Imports
        )

      return {
        exports: result.instance.exports as T,
        componentInfo,
        loadedInterfaces: loaded,
        usedJco: false,
        destroy: () => {
          if (this.ownsPolyfill) {
            this.polyfill.destroy()
          }
        },
      }
    } catch (err) {
      throw new Error(
        `Direct component instantiation failed. ` +
          `Install @bytecodealliance/jco for full component model support. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  private async instantiateCoreModule<T>(
    bytes: ArrayBuffer | Uint8Array,
    componentInfo: ParsedComponentInfo
  ): Promise<BindgenResult<T>> {
    // This is a core WASM module, not a component
    // Try direct instantiation with available imports

    const buffer = bytes instanceof Uint8Array ? bytes.buffer : bytes
    const result: WebAssembly.WebAssemblyInstantiatedSource =
      await WebAssembly.instantiate(buffer as ArrayBuffer, {})

    return {
      exports: result.instance.exports as T,
      componentInfo,
      loadedInterfaces: [],
      usedJco: false,
      destroy: () => {
        if (this.ownsPolyfill) {
          this.polyfill.destroy()
        }
      },
    }
  }
}

/**
 * Create a runtime bindgen instance
 */
export function createRuntimeBindgen(
  options?: RuntimeBindgenOptions
): RuntimeBindgen {
  return new RuntimeBindgen(options)
}
