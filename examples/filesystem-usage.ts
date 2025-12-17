/**
 * Filesystem plugin usage examples for @tegmentum/wasip2-polyfill
 *
 * This example demonstrates how to use the filesystem plugin with
 * different backends: memory, OPFS, IndexedDB, and overlay filesystems.
 */

import { createDevPolyfill, Polyfill } from '@tegmentum/wasip2-polyfill'
import {
  filesystemTypesPlugin,
  filesystemPreopensPlugin,
  MemoryFileSystem,
  memoryFilesystemImplementation,
  opfsFilesystemImplementation,
  idbFilesystemImplementation,
  overlayFilesystemImplementation,
  isOpfsAvailable,
  isIdbAvailable,
  FilesystemErrorCode,
} from '@tegmentum/wasip2-polyfill/plugins/filesystem'

// ============================================================================
// Example 1: In-Memory Filesystem (Default)
// ============================================================================

async function memoryFilesystemUsage() {
  const polyfill = createDevPolyfill()

  // Register filesystem plugins with memory backend (default)
  polyfill.registerPlugin(filesystemTypesPlugin)
  polyfill.registerPlugin(filesystemPreopensPlugin, {
    implementation: 'memory',
    // Configure preopened directories
    preopens: [
      { path: '/', alias: '/' },
      { path: '/tmp', alias: '/tmp' },
    ],
  })

  // Get imports for filesystem interfaces
  const result = await polyfill.forInterfaces([
    'wasi:filesystem/types@0.2.0',
    'wasi:filesystem/preopens@0.2.0',
  ])

  console.log('Filesystem interfaces loaded:', result.loaded.length)

  // Example: Pre-populate the filesystem with files
  // This is useful for testing or providing initial data
  const fs = new MemoryFileSystem()
  fs.createFile('/config/app.json', new TextEncoder().encode('{"debug": true}'))
  fs.createDirectory('/data')

  polyfill.destroy()
}

// ============================================================================
// Example 2: Origin Private File System (OPFS) - Browser Persistent Storage
// ============================================================================

async function opfsFilesystemUsage() {
  // Check if OPFS is available (only in browsers with File System Access API)
  if (!isOpfsAvailable()) {
    console.log('OPFS is not available in this environment')
    return
  }

  const polyfill = createDevPolyfill()

  // Register filesystem with OPFS backend for persistence
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'opfs',
    // OPFS-specific configuration
    rootDirectory: 'my-app-data', // Isolated namespace
  })

  polyfill.registerPlugin(filesystemPreopensPlugin, {
    implementation: 'opfs',
    preopens: [{ path: '/', alias: '/' }],
  })

  // Files written through this plugin will persist across page reloads
  const result = await polyfill.forInterfaces([
    'wasi:filesystem/types@0.2.0',
    'wasi:filesystem/preopens@0.2.0',
  ])

  console.log('OPFS filesystem loaded')

  polyfill.destroy()
}

// ============================================================================
// Example 3: IndexedDB Filesystem - Alternative Browser Persistence
// ============================================================================

async function idbFilesystemUsage() {
  // Check if IndexedDB is available
  if (!isIdbAvailable()) {
    console.log('IndexedDB is not available in this environment')
    return
  }

  const polyfill = createDevPolyfill()

  // Register filesystem with IndexedDB backend
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'idb',
    // IDB-specific configuration
    databaseName: 'my-app-fs',
    storeName: 'files',
  })

  polyfill.registerPlugin(filesystemPreopensPlugin, {
    implementation: 'idb',
    preopens: [{ path: '/', alias: '/' }],
  })

  const result = await polyfill.forInterfaces([
    'wasi:filesystem/types@0.2.0',
    'wasi:filesystem/preopens@0.2.0',
  ])

  console.log('IndexedDB filesystem loaded')

  polyfill.destroy()
}

// ============================================================================
// Example 4: Overlay Filesystem - Layered Read/Write with Read-Only Base
// ============================================================================

async function overlayFilesystemUsage() {
  const polyfill = createDevPolyfill()

  // Create a read-only base filesystem with initial content
  const baseFs = new MemoryFileSystem()
  baseFs.createFile(
    '/README.md',
    new TextEncoder().encode('# Welcome\nThis is read-only.')
  )
  baseFs.createFile(
    '/lib/utils.js',
    new TextEncoder().encode('export function hello() {}')
  )

  // Register overlay filesystem: writes go to memory, reads fall back to base
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'overlay',
    // Overlay configuration
    baseFilesystem: baseFs,
    writable: true, // Allow writes to overlay layer
  })

  polyfill.registerPlugin(filesystemPreopensPlugin, {
    implementation: 'overlay',
    preopens: [{ path: '/', alias: '/' }],
  })

  // The component can:
  // - Read /README.md from the base layer
  // - Write new files to the overlay layer
  // - "Delete" base files (marks them as deleted in overlay)
  const result = await polyfill.forInterfaces([
    'wasi:filesystem/types@0.2.0',
    'wasi:filesystem/preopens@0.2.0',
  ])

  console.log('Overlay filesystem loaded')

  polyfill.destroy()
}

// ============================================================================
// Example 5: Restricted Filesystem Access with Safe Polyfill
// ============================================================================

async function restrictedFilesystemUsage() {
  const polyfill = createDevPolyfill()

  // Only expose specific directories
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'memory',
  })

  polyfill.registerPlugin(filesystemPreopensPlugin, {
    implementation: 'memory',
    // Restrict access to specific paths
    preopens: [
      { path: '/sandbox', alias: '/sandbox' },
      // No access to / or other directories
    ],
  })

  // The component can only access /sandbox
  const result = await polyfill.forInterfaces([
    'wasi:filesystem/types@0.2.0',
    'wasi:filesystem/preopens@0.2.0',
  ])

  console.log('Restricted filesystem loaded')

  polyfill.destroy()
}

// ============================================================================
// Example 6: Error Handling
// ============================================================================

async function errorHandlingExample() {
  const polyfill = createDevPolyfill()

  polyfill.registerPlugin(filesystemTypesPlugin)
  polyfill.registerPlugin(filesystemPreopensPlugin, {
    implementation: 'empty', // No preopens - filesystem is empty
  })

  const result = await polyfill.forInterfaces([
    'wasi:filesystem/types@0.2.0',
    'wasi:filesystem/preopens@0.2.0',
  ])

  // Access the getDirectories function from preopens
  const preopensImports = result.imports['wasi:filesystem/preopens@0.2.0']
  const getDirectories = preopensImports['get-directories'] as () => Array<
    [unknown, string]
  >

  const directories = getDirectories()
  console.log('Preopened directories:', directories.length) // Should be 0

  // Filesystem error codes for handling errors from WASM components
  console.log('Available error codes:')
  console.log('  - access:', FilesystemErrorCode.access)
  console.log('  - notFound:', FilesystemErrorCode.noEntry)
  console.log('  - exists:', FilesystemErrorCode.exist)
  console.log('  - isDir:', FilesystemErrorCode.isDirectory)
  console.log('  - notDir:', FilesystemErrorCode.notDirectory)

  polyfill.destroy()
}

// Run examples
export {
  memoryFilesystemUsage,
  opfsFilesystemUsage,
  idbFilesystemUsage,
  overlayFilesystemUsage,
  restrictedFilesystemUsage,
  errorHandlingExample,
}
