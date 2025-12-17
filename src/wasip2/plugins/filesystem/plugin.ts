/**
 * wasi:filesystem plugin definitions
 *
 * Includes:
 * - wasi:filesystem/types - File descriptor operations
 * - wasi:filesystem/preopens - Pre-opened directories
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { memoryFilesystemImplementation } from './impl-memory.js'
import { opfsFilesystemImplementation } from './impl-opfs.js'
import { memoryPreopensImplementation, emptyPreopensImplementation } from './preopens.js'

/**
 * WASI filesystem types interface definition
 */
export const FILESYSTEM_TYPES_INTERFACE: WasiInterface = {
  package: 'wasi:filesystem',
  name: 'types',
  version: '0.2.0',
}

/**
 * WASI filesystem preopens interface definition
 */
export const FILESYSTEM_PREOPENS_INTERFACE: WasiInterface = {
  package: 'wasi:filesystem',
  name: 'preopens',
  version: '0.2.0',
}

/**
 * wasi:filesystem/types plugin
 *
 * Provides file descriptor operations and filesystem types.
 */
export const filesystemTypesPlugin: WasiPlugin = createPlugin(
  FILESYSTEM_TYPES_INTERFACE,
  {
    memory: memoryFilesystemImplementation,
    opfs: opfsFilesystemImplementation,
  },
  'memory'
)

/**
 * wasi:filesystem/preopens plugin
 *
 * Provides pre-opened directories for filesystem access.
 */
export const filesystemPreopensPlugin: WasiPlugin = createPlugin(
  FILESYSTEM_PREOPENS_INTERFACE,
  {
    memory: memoryPreopensImplementation,
    empty: emptyPreopensImplementation,
  },
  'empty' // Default to no preopens for security
)

/**
 * All filesystem plugins for convenient registration
 */
export const filesystemPlugins: WasiPlugin[] = [
  filesystemTypesPlugin,
  filesystemPreopensPlugin,
]
