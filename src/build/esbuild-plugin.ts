/**
 * esbuild plugin for WASIP2 polyfill
 *
 * Automatically generates manifests for WASM components during build.
 */

import type { Plugin, OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult } from 'esbuild'
import type { ComponentManifest } from '../core/manifest.js'
import { generateManifest, type IntrospectOptions } from './introspect.js'

/**
 * Options for the esbuild plugin
 */
export interface WasipPolyfillEsbuildOptions {
  /** File extensions to process (default: ['.wasm']) */
  extensions?: string[]
  /** Generate manifest files alongside components */
  generateManifests?: boolean
  /** Manifest file suffix (default: '.manifest.json') */
  manifestSuffix?: string
  /** Introspection options */
  introspectOptions?: IntrospectOptions
  /** Custom transform for manifest data */
  transformManifest?: (manifest: ComponentManifest, id: string) => ComponentManifest
  /** Output directory for manifests (defaults to same as component) */
  manifestOutDir?: string
}

const DEFAULT_OPTIONS: Required<Omit<WasipPolyfillEsbuildOptions, 'transformManifest' | 'manifestOutDir'>> = {
  extensions: ['.wasm'],
  generateManifests: true,
  manifestSuffix: '.manifest.json',
  introspectOptions: { parseCapabilities: true },
}

/**
 * Create an esbuild plugin for WASIP2 polyfill
 *
 * This plugin:
 * 1. Intercepts WASM component imports with ?manifest query
 * 2. Generates manifests for components at build time
 * 3. Optionally emits manifest files alongside components
 *
 * @example
 * ```ts
 * // esbuild.config.js
 * import { wasipPolyfillEsbuildPlugin } from '@tegmentum/wasip2-polyfill/build'
 *
 * await esbuild.build({
 *   plugins: [
 *     wasipPolyfillEsbuildPlugin({
 *       generateManifests: true,
 *     })
 *   ]
 * })
 * ```
 */
export function wasipPolyfillEsbuildPlugin(options: WasipPolyfillEsbuildOptions = {}): Plugin {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Cache for generated manifests
  const manifestCache = new Map<string, ComponentManifest>()

  // Track files to generate manifests for
  const wasmFiles = new Set<string>()

  return {
    name: 'wasip2-polyfill',

    setup(build) {
      // Namespace for manifest virtual modules
      const MANIFEST_NS = 'wasip2-manifest'

      // Handle ?manifest imports
      build.onResolve(
        { filter: /\?manifest$/ },
        async (args: OnResolveArgs): Promise<OnResolveResult> => {
          const cleanPath = args.path.replace('?manifest', '')
          const path = await import('node:path')

          // Resolve the actual file path
          let resolvedPath: string
          if (cleanPath.startsWith('.')) {
            resolvedPath = path.resolve(args.resolveDir, cleanPath)
          } else {
            resolvedPath = cleanPath
          }

          return {
            path: resolvedPath,
            namespace: MANIFEST_NS,
          }
        }
      )

      // Load manifest for ?manifest imports
      build.onLoad(
        { filter: /.*/, namespace: MANIFEST_NS },
        async (args: OnLoadArgs): Promise<OnLoadResult> => {
          const filePath = args.path

          // Check cache first
          let manifest = manifestCache.get(filePath)

          if (!manifest) {
            try {
              const fs = await import('node:fs/promises')
              const buffer = await fs.readFile(filePath)
              manifest = await generateManifest(buffer, opts.introspectOptions)

              if (options.transformManifest) {
                manifest = options.transformManifest(manifest, filePath)
              }

              manifestCache.set(filePath, manifest)
            } catch (error) {
              return {
                errors: [
                  {
                    text: `Failed to generate manifest for ${filePath}: ${error}`,
                    location: null,
                  },
                ],
              }
            }
          }

          return {
            contents: `export default ${JSON.stringify(manifest)};`,
            loader: 'js',
          }
        }
      )

      // Track WASM files for manifest generation
      for (const ext of opts.extensions) {
        const filter = new RegExp(`\\${ext}$`)

        build.onLoad({ filter }, async (args: OnLoadArgs): Promise<OnLoadResult | undefined> => {
          wasmFiles.add(args.path)
          return undefined // Let default loader handle the file
        })
      }

      // Generate manifest files at end of build
      build.onEnd(async (result) => {
        if (!opts.generateManifests || result.errors.length > 0) {
          return
        }

        const fs = await import('node:fs/promises')
        const path = await import('node:path')

        for (const filePath of wasmFiles) {
          // Check if file was actually included in output
          const outputFiles = result.outputFiles ?? []
          const wasIncluded = outputFiles.some(
            (f) =>
              f.path.endsWith(path.basename(filePath)) ||
              f.path.includes(path.basename(filePath, path.extname(filePath)))
          )

          // For write mode, we need to check differently
          if (!wasIncluded && outputFiles.length > 0) {
            continue
          }

          try {
            let manifest = manifestCache.get(filePath)

            if (!manifest) {
              const buffer = await fs.readFile(filePath)
              manifest = await generateManifest(buffer, opts.introspectOptions)

              if (options.transformManifest) {
                manifest = options.transformManifest(manifest, filePath)
              }

              manifestCache.set(filePath, manifest)
            }

            // Determine output path
            let manifestPath: string
            if (opts.manifestOutDir) {
              manifestPath = path.join(
                opts.manifestOutDir,
                path.basename(filePath) + opts.manifestSuffix
              )
            } else {
              manifestPath = filePath + opts.manifestSuffix
            }

            await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
          } catch (error) {
            console.warn(`[wasip2-polyfill] Failed to generate manifest for ${filePath}: ${error}`)
          }
        }
      })

      // Handle virtual manifest module resolution
      build.onResolve(
        { filter: /^virtual:wasip2-manifest:/ },
        async (args: OnResolveArgs): Promise<OnResolveResult> => {
          const componentPath = args.path.replace('virtual:wasip2-manifest:', '')
          const path = await import('node:path')

          // Resolve the actual file path
          let resolvedPath: string
          if (componentPath.startsWith('.')) {
            resolvedPath = path.resolve(args.resolveDir, componentPath)
          } else {
            resolvedPath = path.resolve(process.cwd(), componentPath)
          }

          return {
            path: resolvedPath,
            namespace: MANIFEST_NS,
          }
        }
      )
    },
  }
}

/**
 * Helper to create manifest import path
 *
 * @example
 * ```ts
 * // In your code
 * import manifest from './component.wasm?manifest'
 * // or
 * import manifest from 'virtual:wasip2-manifest:./component.wasm'
 * ```
 */
export function getManifestImportPath(componentPath: string): string {
  return `${componentPath}?manifest`
}

/**
 * Helper to create virtual manifest import
 */
export function getVirtualManifestImport(componentPath: string): string {
  return `virtual:wasip2-manifest:${componentPath}`
}

export default wasipPolyfillEsbuildPlugin
