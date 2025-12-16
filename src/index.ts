/**
 * @tegmentum/wasip2-polyfill
 *
 * WASI Preview 2 polyfill for browser and JavaScript environments.
 *
 * This is a provider framework + policy engine + loader for WASI 2 components.
 * It provides:
 * - Runtime implementation selection
 * - Capability-based security policy
 * - Zero-config safe defaults
 * - Uniform async model
 * - Plugin architecture for extensibility
 *
 * @example
 * ```typescript
 * import { createPolyfill, createCliPolicy } from '@tegmentum/wasip2-polyfill'
 *
 * const polyfill = createPolyfill({
 *   policy: createCliPolicy({ env: { FOO: 'bar' } })
 * })
 *
 * const { imports } = await polyfill.forInterfaces([
 *   'wasi:random/random@0.2.0',
 *   'wasi:clocks/monotonic-clock@0.2.0'
 * ])
 *
 * const instance = await WebAssembly.instantiate(wasmBytes, imports)
 * ```
 *
 * @packageDocumentation
 */

// Re-export everything from core
export * from './core/index.js'

// Re-export errors
export {
  WasiErrorCode,
  WasiError,
  PluginNotFoundError,
  PolicyDeniedError,
  ImplementationNotFoundError,
  ManifestError,
} from './util/errors.js'

// Re-export runtime (component loader and bindgen)
export {
  ComponentLoader,
  createComponentLoader,
  type ComponentLoaderOptions,
  type LoadedComponent,
  type ComponentExports,
  RuntimeBindgen,
  createRuntimeBindgen,
  type RuntimeBindgenOptions,
  type BindgenResult,
  parseComponentImports,
  type ParsedImport,
  type ParsedComponentInfo,
} from './runtime/index.js'
