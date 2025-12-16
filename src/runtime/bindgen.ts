/**
 * Runtime bindgen for WebAssembly Component Model
 *
 * Provides runtime transpilation and instantiation of components
 * without build-time code generation.
 *
 * This uses jco for component model transpilation when available,
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
   * Whether to generate types
   * @default false (runtime only)
   */
  tlaCompat?: boolean

  /**
   * Import mappings
   */
  map?: Record<string, string>

  /**
   * Whether to emit minified output
   * @default false
   */
  minify?: boolean
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
 * Runtime bindgen for component model
 *
 * This class provides full component model support by:
 * 1. Parsing component imports
 * 2. Transpiling the component to JavaScript+WASM using jco (if available)
 * 3. Providing WASI imports via the polyfill
 * 4. Instantiating and returning typed exports
 *
 * @example
 * ```typescript
 * const bindgen = new RuntimeBindgen({ devMode: true })
 *
 * // Instantiate a component
 * const result = await bindgen.instantiate<MyExports>(wasmBytes)
 *
 * // Use exports with type safety
 * const value = result.exports.myFunction()
 *
 * // Clean up
 * result.destroy()
 * ```
 */
export class RuntimeBindgen {
  private polyfill: Polyfill
  private ownsPolyfill: boolean
  private options: RuntimeBindgenOptions
  private jcoAvailable: boolean | null = null

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
      await import('@bytecodealliance/jco')
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
    // Dynamic import jco
    const jco = await import('@bytecodealliance/jco')

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

    // Build import map for jco
    const importMap: Record<string, string> = {}
    for (const iface of componentInfo.requiredInterfaces) {
      const key = `${iface.package}/${iface.name}@${iface.version}`
      // Map to a virtual module that will be provided via imports
      importMap[key] = `#wasi/${iface.package}/${iface.name}`
    }

    // Transpile the component
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const transpiled = await jco.transpile(data, {
      name: this.options.jcoOptions?.name ?? 'component',
      map: { ...importMap, ...this.options.jcoOptions?.map },
      tlaCompat: this.options.jcoOptions?.tlaCompat ?? true,
      minify: this.options.jcoOptions?.minify ?? false,
    })

    // The transpiled output includes JS and WASM files
    // We need to execute the JS with our imports
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
    transpiled: { files: { name: string; contents: Uint8Array }[] },
    imports: Record<string, Record<string, unknown>>
  ): Promise<T> {
    // Find the main JS file
    const mainJs = transpiled.files.find(
      (f) => f.name.endsWith('.js') && !f.name.includes('.d.ts')
    )

    if (!mainJs) {
      throw new Error('Transpilation did not produce a JavaScript file')
    }

    // Create blob URLs for WASM files
    const wasmUrls: Record<string, string> = {}
    for (const file of transpiled.files) {
      if (file.name.endsWith('.wasm')) {
        const blob = new Blob([file.contents.buffer as ArrayBuffer], {
          type: 'application/wasm',
        })
        wasmUrls[file.name] = URL.createObjectURL(blob)
      }
    }

    try {
      // Modify the JS to use our imports and WASM URLs
      const jsCode = new TextDecoder().decode(mainJs.contents)
      const modifiedJs = this.patchTranspiledJs(jsCode, wasmUrls, imports)

      // Create a blob URL for the modified JS
      const jsBlob = new Blob([modifiedJs], { type: 'text/javascript' })
      const jsUrl = URL.createObjectURL(jsBlob)

      try {
        // Dynamically import and execute
        const module = await import(/* @vite-ignore */ jsUrl)
        return module as T
      } finally {
        URL.revokeObjectURL(jsUrl)
      }
    } finally {
      // Clean up WASM blob URLs
      for (const url of Object.values(wasmUrls)) {
        URL.revokeObjectURL(url)
      }
    }
  }

  private patchTranspiledJs(
    code: string,
    wasmUrls: Record<string, string>,
    imports: Record<string, Record<string, unknown>>
  ): string {
    // This is a simplified patching - full implementation would need
    // more sophisticated code transformation

    // Replace WASM fetch URLs with blob URLs
    let patched = code
    for (const [filename, url] of Object.entries(wasmUrls)) {
      patched = patched.replace(
        new RegExp(`['"]${filename.replace('.', '\\.')}['"]`, 'g'),
        `'${url}'`
      )
    }

    // Inject imports at the start
    const importSetup = `
const __wasiImports = ${JSON.stringify(imports, null, 2)};
globalThis.__wasiPolyfillImports = __wasiImports;
`

    return importSetup + patched
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
