/**
 * Advanced usage examples for @tegmentum/wasip2-polyfill
 *
 * This example demonstrates advanced patterns including:
 * - Combining multiple plugins
 * - Resource lifecycle management
 * - Security policies
 * - Custom implementations
 * - Error handling
 */

import {
  Polyfill,
  createDevPolyfill,
  createSafePolyfill,
  type WasiInterface,
} from '@tegmentum/wasip2-polyfill'
import { randomPlugin } from '@tegmentum/wasip2-polyfill/plugins/random'
import {
  monotonicClockPlugin,
  wallClockPlugin,
} from '@tegmentum/wasip2-polyfill/plugins/clocks'
import { environmentPlugin } from '@tegmentum/wasip2-polyfill/plugins/cli'
import {
  filesystemTypesPlugin,
  filesystemPreopensPlugin,
} from '@tegmentum/wasip2-polyfill/plugins/filesystem'
import {
  httpTypesPlugin,
  httpOutgoingHandlerPlugin,
} from '@tegmentum/wasip2-polyfill/plugins/http'
import { loggingPlugin } from '@tegmentum/wasip2-polyfill/plugins/logging'
import { keyvalueStorePlugin } from '@tegmentum/wasip2-polyfill/plugins/keyvalue'

// ============================================================================
// Example 1: Full Application Setup with All Common Plugins
// ============================================================================

async function fullApplicationSetup() {
  const polyfill = createDevPolyfill()

  // Register all common plugins for a full-featured app
  polyfill.registerPlugin(randomPlugin)
  polyfill.registerPlugin(monotonicClockPlugin)
  polyfill.registerPlugin(wallClockPlugin)
  polyfill.registerPlugin(environmentPlugin, {
    implementation: 'virtual',
    environment: {
      NODE_ENV: 'production',
      APP_VERSION: '1.0.0',
    },
    args: ['app', '--config=/etc/app.conf'],
  })
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'memory',
  })
  polyfill.registerPlugin(filesystemPreopensPlugin, {
    implementation: 'memory',
    preopens: [{ path: '/', alias: '/' }],
  })
  polyfill.registerPlugin(httpTypesPlugin)
  polyfill.registerPlugin(httpOutgoingHandlerPlugin, {
    implementation: 'fetch',
  })
  polyfill.registerPlugin(loggingPlugin, {
    implementation: 'console',
    minLevel: 'info',
  })
  polyfill.registerPlugin(keyvalueStorePlugin, {
    implementation: 'memory',
  })

  // Load all interfaces at once
  const result = await polyfill.forInterfaces([
    'wasi:random@0.2.0',
    'wasi:clocks/monotonic-clock@0.2.0',
    'wasi:clocks/wall-clock@0.2.0',
    'wasi:cli/environment@0.2.0',
    'wasi:filesystem/types@0.2.0',
    'wasi:filesystem/preopens@0.2.0',
    'wasi:http/types@0.2.0',
    'wasi:http/outgoing-handler@0.2.0',
    'wasi:logging/logging@0.1.0-draft',
    'wasi:keyvalue/store@0.2.0',
  ])

  console.log('Full application setup complete')
  console.log('  Loaded interfaces:', result.loaded.length)
  console.log('  Missing interfaces:', result.missing.length)
  console.log('  Denied interfaces:', result.denied.length)

  return { polyfill, imports: result.imports }
}

// ============================================================================
// Example 2: Security-Focused Safe Polyfill
// ============================================================================

async function securityFocusedSetup() {
  // Create a safe polyfill that denies interfaces by default
  const polyfill = createSafePolyfill()

  // Explicitly allow only the interfaces we need
  polyfill.allowInterface('wasi:random@0.2.0')
  polyfill.allowInterface('wasi:clocks/monotonic-clock@0.2.0')
  polyfill.allowInterface('wasi:logging/logging@0.1.0-draft')
  // Note: filesystem and HTTP are NOT allowed

  // Register plugins
  polyfill.registerPlugin(randomPlugin)
  polyfill.registerPlugin(monotonicClockPlugin)
  polyfill.registerPlugin(loggingPlugin)

  // Attempt to load multiple interfaces
  const result = await polyfill.forInterfaces([
    'wasi:random@0.2.0',
    'wasi:clocks/monotonic-clock@0.2.0',
    'wasi:logging/logging@0.1.0-draft',
    'wasi:filesystem/types@0.2.0', // Will be denied
    'wasi:http/outgoing-handler@0.2.0', // Will be denied
  ])

  console.log('Security-focused setup:')
  console.log('  Loaded:', result.loaded.map((i) => i.name))
  console.log('  Denied:', result.denied.map((i) => i.name))

  // Check if specific interface is allowed
  console.log('  Random allowed:', polyfill.isAllowed('wasi:random@0.2.0'))
  console.log(
    '  Filesystem allowed:',
    polyfill.isAllowed('wasi:filesystem/types@0.2.0')
  )

  polyfill.destroy()
}

// ============================================================================
// Example 3: Resource Lifecycle Management
// ============================================================================

async function resourceLifecycleExample() {
  const polyfill = createDevPolyfill()

  // Register plugins that create resources
  polyfill.registerPlugin(filesystemTypesPlugin, {
    implementation: 'memory',
  })
  polyfill.registerPlugin(filesystemPreopensPlugin, {
    implementation: 'memory',
    preopens: [{ path: '/', alias: '/' }],
  })

  const result = await polyfill.forInterfaces([
    'wasi:filesystem/types@0.2.0',
    'wasi:filesystem/preopens@0.2.0',
  ])

  // Open some file descriptors
  const imports = result.imports['wasi:filesystem/preopens@0.2.0']
  const getDirectories = imports['get-directories'] as () => Array<
    [unknown, string]
  >
  const directories = getDirectories()

  console.log('Opened', directories.length, 'preopened directories')

  // IMPORTANT: Always destroy the polyfill when done
  // This cleans up all resources (file descriptors, connections, etc.)
  polyfill.destroy()

  console.log('Resources cleaned up')
}

// ============================================================================
// Example 4: Handling Missing Interfaces Gracefully
// ============================================================================

async function gracefulDegradationExample() {
  const polyfill = createDevPolyfill()

  // Only register some plugins
  polyfill.registerPlugin(randomPlugin)
  polyfill.registerPlugin(loggingPlugin)

  // Request interfaces, some of which won't be available
  const result = await polyfill.forInterfaces([
    'wasi:random@0.2.0',
    'wasi:logging/logging@0.1.0-draft',
    'wasi:clocks/wall-clock@0.2.0', // Not registered
    'wasi:keyvalue/store@0.2.0', // Not registered
  ])

  // Check what's available
  if (result.missing.length > 0) {
    console.log('Some interfaces are missing:')
    for (const missing of result.missing) {
      console.log(`  - ${missing.package}/${missing.name}@${missing.version}`)
    }
  }

  // Use available interfaces, with fallbacks for missing ones
  const hasClocks =
    result.imports['wasi:clocks/wall-clock@0.2.0'] !== undefined
  const hasKeyValue = result.imports['wasi:keyvalue/store@0.2.0'] !== undefined

  if (!hasClocks) {
    console.log('Falling back to Date.now() for timestamps')
  }

  if (!hasKeyValue) {
    console.log('Falling back to in-memory Map for storage')
  }

  polyfill.destroy()
}

// ============================================================================
// Example 5: Interface Specification Formats
// ============================================================================

async function interfaceSpecFormatsExample() {
  const polyfill = createDevPolyfill()
  polyfill.registerPlugin(randomPlugin)
  polyfill.registerPlugin(monotonicClockPlugin)

  // Method 1: Object specification (most explicit)
  const result1 = await polyfill.getImports([
    { package: 'wasi:random', name: 'random', version: '0.2.0' },
    { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
  ])

  // Method 2: String specification (more concise)
  const result2 = await polyfill.forInterfaces([
    'wasi:random@0.2.0',
    'wasi:clocks/monotonic-clock@0.2.0',
  ])

  // Both methods produce the same imports
  console.log(
    'Method 1 loaded:',
    result1.loaded.map((i) => `${i.package}/${i.name}`)
  )
  console.log(
    'Method 2 loaded:',
    result2.loaded.map((i) => `${i.package}/${i.name}`)
  )

  polyfill.destroy()
}

// ============================================================================
// Example 6: Plugin Configuration Patterns
// ============================================================================

async function pluginConfigurationPatterns() {
  const polyfill = createDevPolyfill()

  // Pattern 1: No config (uses defaults)
  polyfill.registerPlugin(randomPlugin)

  // Pattern 2: Implementation selection
  polyfill.registerPlugin(loggingPlugin, {
    implementation: 'console', // or 'buffer', 'ndjson', 'otlp'
  })

  // Pattern 3: Implementation with additional config
  polyfill.registerPlugin(environmentPlugin, {
    implementation: 'virtual',
    environment: { KEY: 'value' },
    args: ['arg1', 'arg2'],
  })

  // Pattern 4: External resource injection
  // (e.g., injecting a pre-configured store)
  const preConfiguredStore = new Map([
    ['key1', new TextEncoder().encode('value1')],
  ])
  polyfill.registerPlugin(keyvalueStorePlugin, {
    implementation: 'memory',
    initialData: { default: preConfiguredStore },
  })

  const result = await polyfill.forInterfaces([
    'wasi:random@0.2.0',
    'wasi:logging/logging@0.1.0-draft',
    'wasi:cli/environment@0.2.0',
    'wasi:keyvalue/store@0.2.0',
  ])

  console.log('Plugin configuration patterns loaded:', result.loaded.length)

  polyfill.destroy()
}

// ============================================================================
// Example 7: Integration with WebAssembly.instantiate
// ============================================================================

async function wasmInstantiationExample(wasmBytes: ArrayBuffer) {
  const polyfill = createDevPolyfill()

  // Register plugins
  polyfill.registerPlugin(randomPlugin)
  polyfill.registerPlugin(monotonicClockPlugin)

  // Get imports for the component
  const result = await polyfill.forInterfaces([
    'wasi:random@0.2.0',
    'wasi:clocks/monotonic-clock@0.2.0',
  ])

  if (result.missing.length > 0) {
    throw new Error(
      `Missing required interfaces: ${result.missing.map((i) => i.name).join(', ')}`
    )
  }

  // Note: For real WebAssembly Component Model usage, you would need
  // to use jco or a similar tool to transpile the component first.
  // This is a simplified example showing the integration pattern.

  try {
    // Instantiate the WebAssembly module with polyfill imports
    const { instance } = await WebAssembly.instantiate(wasmBytes, result.imports)

    // Call exported functions
    // const exports = instance.exports as { run: () => void }
    // exports.run()

    console.log('WASM component instantiated successfully')
  } finally {
    // Always clean up
    polyfill.destroy()
  }
}

// ============================================================================
// Example 8: Error Handling
// ============================================================================

async function errorHandlingExample() {
  const polyfill = createDevPolyfill()

  try {
    // Registering the same plugin twice throws
    polyfill.registerPlugin(randomPlugin)
    // polyfill.registerPlugin(randomPlugin) // Would throw

    // Getting imports for unregistered interfaces returns them in 'missing'
    const result = await polyfill.forInterfaces([
      'wasi:nonexistent/interface@0.2.0',
    ])

    if (result.missing.length > 0) {
      console.log('Missing interfaces:', result.missing)
    }

    // Accessing imports that don't exist
    const nonexistent =
      result.imports['wasi:nonexistent/interface@0.2.0']?.['some-function']
    if (nonexistent === undefined) {
      console.log('Function not available (as expected)')
    }
  } catch (error) {
    console.error('Error:', error)
  } finally {
    polyfill.destroy()
  }
}

// ============================================================================
// Example 9: Multiple Polyfill Instances
// ============================================================================

async function multipleInstancesExample() {
  // You can create multiple polyfill instances with different configurations
  // This is useful for running multiple WASM components with different permissions

  // Instance 1: Full access for trusted component
  const trustedPolyfill = createDevPolyfill()
  trustedPolyfill.registerPlugin(randomPlugin)
  trustedPolyfill.registerPlugin(filesystemTypesPlugin)
  trustedPolyfill.registerPlugin(httpOutgoingHandlerPlugin)

  // Instance 2: Restricted access for untrusted component
  const untrustedPolyfill = createSafePolyfill()
  untrustedPolyfill.allowInterface('wasi:random@0.2.0')
  untrustedPolyfill.registerPlugin(randomPlugin)
  // No filesystem or HTTP for untrusted code

  console.log('Created two polyfill instances with different permissions')

  // Clean up both when done
  trustedPolyfill.destroy()
  untrustedPolyfill.destroy()
}

// ============================================================================
// Example 10: Debugging and Inspection
// ============================================================================

async function debuggingExample() {
  const polyfill = createDevPolyfill()

  polyfill.registerPlugin(randomPlugin)
  polyfill.registerPlugin(monotonicClockPlugin)

  const result = await polyfill.forInterfaces([
    'wasi:random@0.2.0',
    'wasi:clocks/monotonic-clock@0.2.0',
  ])

  // Inspect the imports structure
  console.log('Available import namespaces:', Object.keys(result.imports))

  for (const [namespace, functions] of Object.entries(result.imports)) {
    console.log(`\n${namespace}:`)
    for (const [name, fn] of Object.entries(
      functions as Record<string, unknown>
    )) {
      console.log(`  - ${name}: ${typeof fn}`)
    }
  }

  polyfill.destroy()
}

// Run examples
export {
  fullApplicationSetup,
  securityFocusedSetup,
  resourceLifecycleExample,
  gracefulDegradationExample,
  interfaceSpecFormatsExample,
  pluginConfigurationPatterns,
  wasmInstantiationExample,
  errorHandlingExample,
  multipleInstancesExample,
  debuggingExample,
}
