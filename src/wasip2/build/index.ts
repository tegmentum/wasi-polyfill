/**
 * Build-time tooling for WASIP2 polyfill
 *
 * This module provides tools for generating component manifests at build time.
 * It uses @bytecodealliance/jco for component introspection.
 *
 * Note: This module is intended for build-time use only and should not
 * be included in browser bundles.
 *
 * @example
 * ```ts
 * // Generate manifest from a component file
 * import { generateManifestFile } from '@tegmentum/wasi-polyfill/build'
 *
 * await generateManifestFile('./my-component.wasm')
 * // Creates: ./my-component.wasm.manifest.json
 * ```
 *
 * @example
 * ```ts
 * // Vite plugin usage
 * import { wasipPolyfillPlugin } from '@tegmentum/wasi-polyfill/build'
 *
 * export default {
 *   plugins: [wasipPolyfillPlugin()]
 * }
 * ```
 *
 * @example
 * ```ts
 * // esbuild plugin usage
 * import { wasipPolyfillEsbuildPlugin } from '@tegmentum/wasi-polyfill/build'
 *
 * await esbuild.build({
 *   plugins: [wasipPolyfillEsbuildPlugin()]
 * })
 * ```
 */

// Introspection
export type { IntrospectOptions, IntrospectResult } from './introspect.js'
export {
  introspect,
  introspectFile,
  generateManifest,
  generateManifestFromFile,
  generateManifestFile,
  writeManifest,
  toManifest,
  parseInterfaceString,
  formatInterfaceString,
  getSubsystem,
} from './introspect.js'

// Vite plugin
export type { WasipPolyfillPluginOptions } from './vite-plugin.js'
export {
  wasipPolyfillPlugin,
  getManifestImport,
} from './vite-plugin.js'

// esbuild plugin
export type { WasipPolyfillEsbuildOptions } from './esbuild-plugin.js'
export {
  wasipPolyfillEsbuildPlugin,
  getManifestImportPath,
  getVirtualManifestImport,
} from './esbuild-plugin.js'
