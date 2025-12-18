/**
 * WASI Preview 2 (wasip2) implementation
 *
 * This module provides the full WASI Preview 2 polyfill including:
 * - Core polyfill and policy engine
 * - Plugin architecture for all WASI interfaces
 * - Runtime component loader
 * - Build tools for manifest generation
 * - Testing harness
 * - Proxy for native capabilities
 *
 * @example
 * ```typescript
 * import { createPolyfill, createCliPolicy } from '@tegmentum/wasi-polyfill/wasip2'
 *
 * const polyfill = createPolyfill({
 *   policy: createCliPolicy({ env: { FOO: 'bar' } })
 * })
 *
 * const { imports } = await polyfill.forInterfaces([
 *   'wasi:random/random@0.2.0',
 *   'wasi:clocks/monotonic-clock@0.2.0'
 * ])
 * ```
 *
 * @packageDocumentation
 */

// Re-export everything from core
export * from './core/index.js'

// Re-export errors from shared
export {
  WasiErrorCode,
  WasiError,
  PluginNotFoundError,
  PolicyDeniedError,
  ImplementationNotFoundError,
  ManifestError,
} from '../shared/errors.js'

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
