/**
 * Vite plugin for WASIP2 polyfill
 *
 * Automatically generates manifests for WASM components during build.
 */

import type { Plugin, ResolvedConfig } from 'vite'
import type { ComponentManifest } from '../core/manifest.js'
import { generateManifest, type IntrospectOptions } from './introspect.js'

/**
 * Options for the Vite plugin
 */
export interface WasipPolyfillPluginOptions {
  /** File extensions to process (default: ['.wasm']) */
  extensions?: string[]
  /** Generate manifest files alongside components */
  generateManifests?: boolean
  /** Manifest file suffix (default: '.manifest.json') */
  manifestSuffix?: string
  /** Introspection options */
  introspectOptions?: IntrospectOptions
  /** Include source maps for generated code */
  sourcemap?: boolean
  /** Custom transform for manifest data */
  transformManifest?: (manifest: ComponentManifest, id: string) => ComponentManifest
}

const DEFAULT_OPTIONS: Required<Omit<WasipPolyfillPluginOptions, 'transformManifest'>> = {
  extensions: ['.wasm'],
  generateManifests: true,
  manifestSuffix: '.manifest.json',
  introspectOptions: { parseCapabilities: true },
  sourcemap: true,
}

/**
 * Create a Vite plugin for WASIP2 polyfill
 *
 * This plugin:
 * 1. Intercepts WASM component imports
 * 2. Generates manifests for components at build time
 * 3. Optionally emits manifest files alongside components
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { wasipPolyfillPlugin } from '@tegmentum/wasi-polyfill/build'
 *
 * export default {
 *   plugins: [
 *     wasipPolyfillPlugin({
 *       generateManifests: true,
 *     })
 *   ]
 * }
 * ```
 */
export function wasipPolyfillPlugin(options: WasipPolyfillPluginOptions = {}): Plugin {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let config: ResolvedConfig

  // Cache for generated manifests
  const manifestCache = new Map<string, ComponentManifest>()

  return {
    name: 'wasi-polyfill',

    configResolved(resolvedConfig) {
      config = resolvedConfig
    },

    // Provide virtual module for accessing manifest at runtime
    resolveId(id) {
      if (id.startsWith('virtual:wasip2-manifest:')) {
        return '\0' + id
      }
      return null
    },

    async load(id) {
      // Handle virtual manifest module
      if (id.startsWith('\0virtual:wasip2-manifest:')) {
        const componentPath = id.replace('\0virtual:wasip2-manifest:', '')

        try {
          const fs = await import('node:fs/promises')
          const path = await import('node:path')

          // Resolve the component path
          const resolvedPath = path.resolve(config.root, componentPath)
          const buffer = await fs.readFile(resolvedPath)

          let manifest = await generateManifest(buffer, opts.introspectOptions)

          if (options.transformManifest) {
            manifest = options.transformManifest(manifest, componentPath)
          }

          return `export default ${JSON.stringify(manifest)};`
        } catch (error) {
          this.error(`Failed to load manifest for ${componentPath}: ${error}`)
          return null
        }
      }

      // Check if this is a WASM file we should process
      if (!opts.extensions.some((ext) => id.endsWith(ext))) {
        return null
      }

      // Check for ?manifest query to return manifest data
      if (id.includes('?manifest')) {
        const cleanId = id.replace('?manifest', '')
        const manifest = manifestCache.get(cleanId)

        if (manifest) {
          return `export default ${JSON.stringify(manifest)};`
        }

        // Generate manifest if not cached
        try {
          const fs = await import('node:fs/promises')
          const buffer = await fs.readFile(cleanId)
          let newManifest = await generateManifest(buffer, opts.introspectOptions)

          if (options.transformManifest) {
            newManifest = options.transformManifest(newManifest, cleanId)
          }

          manifestCache.set(cleanId, newManifest)
          return `export default ${JSON.stringify(newManifest)};`
        } catch (error) {
          this.error(`Failed to generate manifest for ${cleanId}: ${error}`)
          return null
        }
      }

      return null
    },

    async transform(_code, id) {
      // Skip if not a WASM file
      if (!opts.extensions.some((ext) => id.endsWith(ext))) {
        return null
      }

      // Skip if already has ?manifest query
      if (id.includes('?')) {
        return null
      }

      return null
    },

    async generateBundle(_outputOptions, bundle) {
      if (!opts.generateManifests) {
        return
      }

      // Process all WASM files in the bundle
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (!opts.extensions.some((ext) => fileName.endsWith(ext))) {
          continue
        }

        // Get the source buffer
        if (chunk.type !== 'asset' || !(chunk.source instanceof Uint8Array)) {
          continue
        }

        try {
          let manifest = await generateManifest(chunk.source, opts.introspectOptions)

          if (options.transformManifest) {
            manifest = options.transformManifest(manifest, fileName)
          }

          // Emit manifest file
          const manifestFileName = fileName + opts.manifestSuffix
          this.emitFile({
            type: 'asset',
            fileName: manifestFileName,
            source: JSON.stringify(manifest, null, 2),
          })

          // Log in verbose mode
          if (config.logLevel === 'info') {
            console.log(`[wasi-polyfill] Generated manifest: ${manifestFileName}`)
          }
        } catch (error) {
          this.warn(`Failed to generate manifest for ${fileName}: ${error}`)
        }
      }
    },
  }
}

/**
 * Helper to import a component's manifest
 *
 * Use with the virtual module system:
 * ```ts
 * import manifest from 'virtual:wasip2-manifest:./my-component.wasm'
 * ```
 */
export function getManifestImport(componentPath: string): string {
  return `virtual:wasip2-manifest:${componentPath}`
}

export default wasipPolyfillPlugin
