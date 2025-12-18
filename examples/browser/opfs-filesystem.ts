/**
 * Origin Private File System (OPFS) example for @tegmentum/wasi-polyfill
 *
 * Shows how to configure and use the OPFS filesystem backend
 * for persistent storage in browser environments.
 */

import { Polyfill } from '@tegmentum/wasi-polyfill'
import {
  filesystemPlugins,
  filesystemTypesPlugin,
  opfsFilesystemImplementation,
  memoryFilesystemImplementation,
  memoryPreopensImplementation,
  isOpfsAvailable,
  getGlobalOpfsFilesystemInstance,
  FILESYSTEM_TYPES_INTERFACE,
  FILESYSTEM_PREOPENS_INTERFACE,
} from '@tegmentum/wasi-polyfill/plugins/filesystem'

/**
 * Example: Check OPFS availability
 */
function checkOpfsAvailability() {
  const available = isOpfsAvailable()
  console.log('OPFS available:', available)

  if (!available) {
    console.log('OPFS requires:')
    console.log('  - Modern browser (Chrome 86+, Firefox 111+, Safari 15.2+)')
    console.log('  - Secure context (HTTPS or localhost)')
    console.log('  - navigator.storage API support')
  }

  return available
}

/**
 * Example: Basic OPFS setup
 */
async function basicOpfsSetup() {
  if (!isOpfsAvailable()) {
    console.log('OPFS not available, falling back to memory filesystem')
    return fallbackToMemory()
  }

  const polyfill = new Polyfill()

  // Register filesystem with OPFS implementation
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'opfs',
    options: {
      // Custom root directory name within OPFS
      rootDirName: 'wasi-root',
    },
  })

  console.log('OPFS filesystem configured')
}

/**
 * Example: Fallback to memory filesystem
 */
async function fallbackToMemory() {
  const polyfill = new Polyfill()

  // Use in-memory filesystem (works everywhere, but not persistent)
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'memory',
  })

  console.log('Memory filesystem configured')
}

/**
 * Example: Automatic OPFS with fallback
 */
async function automaticFilesystemSetup() {
  const polyfill = new Polyfill()

  // Choose implementation based on availability
  const implementation = isOpfsAvailable() ? 'opfs' : 'memory'

  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation,
    options: implementation === 'opfs' ? { rootDirName: 'my-app-data' } : undefined,
  })

  console.log(`Filesystem configured with ${implementation} implementation`)
}

/**
 * Example: Configuring preopens (pre-opened directories)
 */
async function configuringPreopens() {
  const polyfill = new Polyfill()

  // First, set up filesystem implementation
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: isOpfsAvailable() ? 'opfs' : 'memory',
  })

  // Then configure preopens
  polyfill.registerPlugins(filesystemPlugins, {
    implementation: 'memory', // Uses memory preopens
    options: {
      preopens: [
        // Map root directory to '.'
        { path: '/', alias: '.' },
        // Map /home to 'home'
        { path: '/home', alias: 'home' },
        // Map /tmp to 'tmp'
        { path: '/tmp', alias: 'tmp' },
      ],
    },
  })

  console.log('Preopens configured')
}

/**
 * Example: Using OPFS for application data
 */
async function applicationDataStorage() {
  if (!isOpfsAvailable()) {
    console.log('This example requires OPFS')
    return
  }

  const polyfill = new Polyfill()

  // Create dedicated storage area for application
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'opfs',
    options: {
      // Use application-specific root
      rootDirName: 'my-wasm-app-v1',
    },
  })

  // WASI components will have access to this filesystem
  // Data persists across page loads and browser sessions

  console.log('Application data storage configured')
}

/**
 * Example: Multiple applications with isolated storage
 */
async function isolatedAppStorage() {
  if (!isOpfsAvailable()) {
    console.log('This example requires OPFS')
    return
  }

  // Each application can use its own root directory
  // This provides isolation between different WASI components

  // App 1: Game save data
  const gamePolyfill = new Polyfill()
  gamePolyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'opfs',
    options: { rootDirName: 'game-saves' },
  })

  // App 2: Document editor
  const editorPolyfill = new Polyfill()
  editorPolyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'opfs',
    options: { rootDirName: 'documents' },
  })

  // App 3: Configuration storage
  const configPolyfill = new Polyfill()
  configPolyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'opfs',
    options: { rootDirName: 'app-config' },
  })

  console.log('Isolated storage areas created')
}

/**
 * Example: Accessing the global OPFS instance
 */
async function accessGlobalInstance() {
  if (!isOpfsAvailable()) {
    console.log('This example requires OPFS')
    return
  }

  // First create the filesystem
  const polyfill = new Polyfill()
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'opfs',
  })

  // Get the global instance (singleton)
  const instance = getGlobalOpfsFilesystemInstance()

  if (instance) {
    console.log('Got global OPFS instance:', instance)
    // The instance can be used for advanced operations
    // or to share filesystem state between components
  }
}

/**
 * Example: Full filesystem setup for WASI component
 */
async function fullFilesystemSetup() {
  const polyfill = new Polyfill()

  // Determine best available implementation
  const fsImpl = isOpfsAvailable() ? 'opfs' : 'memory'
  console.log(`Using ${fsImpl} filesystem`)

  // Register filesystem type plugin
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: fsImpl,
    options: fsImpl === 'opfs' ? { rootDirName: 'wasi-component-data' } : undefined,
  })

  // Configure preopens for the component
  const preopensConfig = {
    preopens: [
      { path: '/', alias: '.' },
      { path: '/tmp', alias: 'tmp' },
      { path: '/data', alias: 'data' },
    ],
  }

  // Get imports for WASI filesystem interfaces
  const imports = polyfill.getImportsForInterfaces([
    FILESYSTEM_TYPES_INTERFACE,
    FILESYSTEM_PREOPENS_INTERFACE,
  ])

  console.log('Full filesystem setup complete:', {
    implementation: fsImpl,
    imports: Object.keys(imports),
  })
}

// Run examples
checkOpfsAvailability()
basicOpfsSetup().catch(console.error)
automaticFilesystemSetup().catch(console.error)
configuringPreopens().catch(console.error)
applicationDataStorage().catch(console.error)
isolatedAppStorage().catch(console.error)
accessGlobalInstance().catch(console.error)
fullFilesystemSetup().catch(console.error)
