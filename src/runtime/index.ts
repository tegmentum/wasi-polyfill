/**
 * Runtime component loading and instantiation
 *
 * Provides dynamic component loading without build-time code generation.
 * This module can introspect components at runtime and automatically
 * provide the necessary WASI imports.
 */

export {
  ComponentLoader,
  type ComponentLoaderOptions,
  type LoadedComponent,
  type ComponentExports,
  createComponentLoader,
} from './loader.js'

export {
  parseComponentImports,
  type ParsedImport,
  type ParsedComponentInfo,
} from './parser.js'

export {
  RuntimeBindgen,
  createRuntimeBindgen,
  type RuntimeBindgenOptions,
  type BindgenResult,
} from './bindgen.js'
