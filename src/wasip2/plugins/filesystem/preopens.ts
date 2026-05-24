/**
 * Preopens implementation for wasi:filesystem/preopens
 *
 * Manages pre-opened directories that are available to WASI components.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  resolveFilesystemTypesInstance,
  type FilesystemTypesInstance,
} from './impl-memory.js'
import { DescriptorFlags } from './types.js'

/**
 * Configuration for preopens
 */
export interface PreopensConfig {
  /** Pre-opened directories as [descriptor_handle, path] tuples */
  preopens?: Array<{ path: string; alias?: string; flags?: DescriptorFlags }>
}

/**
 * Default flags for preopened directories
 */
const DEFAULT_PREOPEN_FLAGS: DescriptorFlags = {
  read: true,
  write: true,
  mutateDirectory: true,
}

/**
 * Preopens plugin instance
 */
class PreopensInstance implements PluginInstance {
  private readonly preopens: Array<[number, string]> = []

  constructor(config: PreopensConfig, fsInstance: FilesystemTypesInstance | null) {
    if (!fsInstance) {
      // No filesystem instance, return empty preopens
      return
    }

    // Set up preopens
    if (config.preopens) {
      for (const preopen of config.preopens) {
        const flags = preopen.flags ?? DEFAULT_PREOPEN_FLAGS
        try {
          const descriptor = fsInstance.createDescriptor(preopen.path, flags)
          const alias = preopen.alias ?? preopen.path
          this.preopens.push([descriptor.handle, alias])
        } catch {
          // Skip invalid paths
          console.warn(`Failed to create preopen for path: ${preopen.path}`)
        }
      }
    }
  }

  getImports(): Record<string, unknown> {
    return {
      'get-directories': this.getDirectories.bind(this),
    }
  }

  destroy(): void {
    // Descriptors are managed by the filesystem plugin
  }

  /**
   * Get pre-opened directories
   */
  private getDirectories(): Array<[number, string]> {
    return [...this.preopens]
  }
}

/**
 * Memory preopens implementation
 */
export const memoryPreopensImplementation: Implementation = {
  name: 'memory',
  description: 'Preopens for memory filesystem',
  create(config: PluginConfig): PluginInstance {
    const preopensConfig: PreopensConfig = {}

    if (config.options?.['preopens'] !== undefined) {
      preopensConfig.preopens = config.options['preopens'] as Array<{
        path: string
        alias?: string
        flags?: DescriptorFlags
      }>
    }

    // Resolve the same filesystem instance the fs/types plugin uses for this
    // polyfill's context, so preopened descriptors live in that filesystem.
    return new PreopensInstance(preopensConfig, resolveFilesystemTypesInstance(config))
  },
}

/**
 * Empty preopens implementation (no filesystem access)
 */
export const emptyPreopensImplementation: Implementation = {
  name: 'empty',
  description: 'No pre-opened directories',
  create(): PluginInstance {
    return new PreopensInstance({}, null)
  },
}
