/**
 * Component loader for runtime instantiation
 *
 * Loads and instantiates WebAssembly components with automatic
 * WASI import resolution using the polyfill.
 */

import type { WasiInterface, PolyfillConfig } from '../core/types.js'
import { Polyfill, createDevPolyfill } from '../core/polyfill.js'
import { parseComponentImports, isComponent } from './parser.js'
import type { ParsedComponentInfo } from './parser.js'

/**
 * Options for creating a component loader
 */
export interface ComponentLoaderOptions {
  /**
   * Polyfill instance to use. If not provided, creates a new one.
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
   * Additional imports to provide beyond WASI
   */
  additionalImports?: Record<string, Record<string, unknown>>

  /**
   * Callback when imports are being resolved
   */
  onResolveImports?: (interfaces: WasiInterface[]) => void

  /**
   * Whether to use jco for full introspection when available
   * @default false (use lightweight parser)
   */
  useJco?: boolean
}

/**
 * Exports from a loaded component
 */
export type ComponentExports = Record<string, unknown>

/**
 * Result of loading a component
 */
export interface LoadedComponent<T extends ComponentExports = ComponentExports> {
  /**
   * The component exports
   */
  exports: T

  /**
   * The parsed component info
   */
  componentInfo: ParsedComponentInfo

  /**
   * Interfaces that were loaded
   */
  loadedInterfaces: WasiInterface[]

  /**
   * The polyfill instance used
   */
  polyfill: Polyfill

  /**
   * Clean up resources
   */
  destroy(): void
}

/**
 * Component loader for dynamic instantiation
 *
 * @example
 * ```typescript
 * const loader = createComponentLoader({ devMode: true })
 *
 * // Load a component from bytes
 * const component = await loader.load(wasmBytes)
 *
 * // Call exported functions
 * component.exports['my-function']()
 *
 * // Clean up
 * component.destroy()
 * ```
 */
export class ComponentLoader {
  private polyfill: Polyfill
  private ownsPolyfill: boolean
  private options: ComponentLoaderOptions

  constructor(options: ComponentLoaderOptions = {}) {
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
   * Load a component from bytes
   */
  async load<T extends ComponentExports = ComponentExports>(
    bytes: ArrayBuffer | Uint8Array
  ): Promise<LoadedComponent<T>> {
    // Parse component to find imports
    const componentInfo = await this.parseComponent(bytes)

    if (!componentInfo.isComponent) {
      throw new Error(
        'Not a valid WebAssembly component. Expected component binary format.'
      )
    }

    // Resolve WASI imports
    const { imports, loaded } = await this.resolveImports(
      componentInfo.requiredInterfaces
    )

    // Merge with additional imports
    const allImports = {
      ...imports,
      ...this.options.additionalImports,
    }

    // Instantiate the component
    // Note: Native component instantiation requires specific browser/runtime support
    // This implementation uses the standard WebAssembly API which works with
    // components that have been lowered to core modules
    const instance = await this.instantiate(bytes, allImports)

    return {
      exports: instance.exports as T,
      componentInfo,
      loadedInterfaces: loaded,
      polyfill: this.polyfill,
      destroy: () => {
        // Only destroy polyfill if we own it
        if (this.ownsPolyfill) {
          this.polyfill.destroy()
        }
      },
    }
  }

  /**
   * Load a component from a URL
   */
  async loadFromUrl<T extends ComponentExports = ComponentExports>(
    url: string
  ): Promise<LoadedComponent<T>> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch component: ${response.statusText}`)
    }
    const bytes = await response.arrayBuffer()
    return this.load<T>(bytes)
  }

  /**
   * Load a component with streaming compilation
   */
  async loadStreaming<T extends ComponentExports = ComponentExports>(
    source: Response | Promise<Response>
  ): Promise<LoadedComponent<T>> {
    const response = await source
    const bytes = await response.arrayBuffer()
    return this.load<T>(bytes)
  }

  /**
   * Check if bytes are a valid component
   */
  isComponent(bytes: ArrayBuffer | Uint8Array): boolean {
    return isComponent(bytes)
  }

  /**
   * Parse a component without loading
   */
  async parseComponent(
    bytes: ArrayBuffer | Uint8Array
  ): Promise<ParsedComponentInfo> {
    if (this.options.useJco) {
      return this.parseWithJco(bytes)
    }
    return parseComponentImports(bytes)
  }

  /**
   * Get the polyfill instance
   */
  getPolyfill(): Polyfill {
    return this.polyfill
  }

  /**
   * Register plugins with the loader's polyfill
   */
  registerPlugins(
    ...plugins: Parameters<typeof Polyfill.prototype.registerPlugin>[]
  ): void {
    for (const [plugin] of plugins) {
      this.polyfill.registerPlugin(plugin)
    }
  }

  /**
   * Destroy the loader and its resources
   */
  destroy(): void {
    if (this.ownsPolyfill) {
      this.polyfill.destroy()
    }
  }

  private async resolveImports(
    interfaces: WasiInterface[]
  ): Promise<{ imports: Record<string, Record<string, unknown>>; loaded: WasiInterface[] }> {
    this.options.onResolveImports?.(interfaces)

    const result = await this.polyfill.getImports(interfaces, {
      throwOnMissing: true,
      throwOnDenied: true,
    })

    return {
      imports: result.imports,
      loaded: result.loaded,
    }
  }

  private async instantiate(
    bytes: ArrayBuffer | Uint8Array,
    imports: Record<string, Record<string, unknown>>
  ): Promise<WebAssembly.Instance> {
    // Get ArrayBuffer for instantiation
    const data =
      bytes instanceof Uint8Array
        ? (bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer)
        : bytes

    // Try to instantiate
    // Note: For true component model support, we'd need the component to be
    // transpiled to a core module (e.g., using jco transpile)
    try {
      const result: WebAssembly.WebAssemblyInstantiatedSource =
        await WebAssembly.instantiate(
          data as BufferSource,
          imports as WebAssembly.Imports
        )
      return result.instance
    } catch (err) {
      // If instantiation fails with a component, provide helpful error
      if (
        err instanceof Error &&
        err.message.includes('expected magic word')
      ) {
        throw new Error(
          'Component instantiation failed. ' +
            'The component may need to be transpiled to a core module first. ' +
            'Use jco transpile or RuntimeBindgen for full component support.'
        )
      }
      throw err
    }
  }

  private async parseWithJco(
    bytes: ArrayBuffer | Uint8Array
  ): Promise<ParsedComponentInfo> {
    try {
      const { introspect } = await import('../build/introspect.js')
      const result = await introspect(bytes)

      return {
        imports: result.imports.map((iface) => ({
          name: `${iface.package}/${iface.name}@${iface.version}`,
          wasiInterface: iface,
          kind: 'instance' as const,
        })),
        wasiImports: result.imports.map((iface) => ({
          name: `${iface.package}/${iface.name}@${iface.version}`,
          wasiInterface: iface,
          kind: 'instance' as const,
        })),
        requiredInterfaces: result.imports,
        isComponent: true,
      }
    } catch {
      // Fall back to lightweight parser
      return parseComponentImports(bytes)
    }
  }
}

/**
 * Create a component loader
 */
export function createComponentLoader(
  options?: ComponentLoaderOptions
): ComponentLoader {
  return new ComponentLoader(options)
}
