/**
 * Basic usage example for @tegmentum/wasi-polyfill
 *
 * This example demonstrates how to use the polyfill to provide WASI
 * implementations for a WebAssembly component.
 */

import {
  Polyfill,
  createDevPolyfill,
  createSafePolyfill,
} from '@tegmentum/wasi-polyfill'
import { randomPlugin } from '@tegmentum/wasi-polyfill/plugins/random'
import {
  monotonicClockPlugin,
  wallClockPlugin,
} from '@tegmentum/wasi-polyfill/plugins/clocks'
import { environmentPlugin } from '@tegmentum/wasi-polyfill/plugins/cli'

// ============================================================================
// Example 1: Development polyfill (allows all interfaces)
// ============================================================================

async function developmentUsage() {
  // Create a development polyfill that allows all WASI interfaces
  // This is useful for development and testing
  const polyfill = createDevPolyfill()

  // Register the plugins you need
  polyfill.registerPlugin(randomPlugin)
  polyfill.registerPlugin(monotonicClockPlugin)
  polyfill.registerPlugin(wallClockPlugin)
  polyfill.registerPlugin(environmentPlugin, {
    implementation: 'virtual',
    environment: {
      NODE_ENV: 'development',
      DEBUG: 'true',
    },
    args: ['myprogram', '--verbose'],
  })

  // Get imports for specific interfaces
  const result = await polyfill.getImports([
    { package: 'wasi:random', name: 'random', version: '0.2.0' },
    { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
    { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
  ])

  console.log('Loaded interfaces:', result.loaded.length)
  console.log('Missing interfaces:', result.missing.length)

  // Use the imports directly
  const getRandomBytes = result.imports['wasi:random@0.2.0'][
    'get-random-bytes'
  ] as (len: bigint) => Uint8Array

  const bytes = getRandomBytes(16n)
  console.log('Random bytes:', bytes)

  // Clean up when done
  polyfill.destroy()
}

// ============================================================================
// Example 2: Safe polyfill (restricts interfaces by default)
// ============================================================================

async function productionUsage() {
  // Create a safe polyfill that only allows explicitly enabled interfaces
  const polyfill = createSafePolyfill()

  // Enable specific interfaces
  polyfill.allowInterface('wasi:random@0.2.0')
  polyfill.allowInterface('wasi:clocks/monotonic-clock@0.2.0')

  // Register plugins
  polyfill.registerPlugin(randomPlugin)
  polyfill.registerPlugin(monotonicClockPlugin)

  // Check if an interface is allowed
  console.log(
    'Random allowed:',
    polyfill.isAllowed('wasi:random@0.2.0')
  )
  console.log(
    'Filesystem allowed:',
    polyfill.isAllowed('wasi:filesystem/types@0.2.0')
  )

  // Get imports
  const result = await polyfill.getImports([
    { package: 'wasi:random', name: 'random', version: '0.2.0' },
    { package: 'wasi:filesystem', name: 'types', version: '0.2.0' }, // Will be denied
  ])

  console.log('Loaded:', result.loaded.length) // 1
  console.log('Denied:', result.denied.length) // 1

  polyfill.destroy()
}

// ============================================================================
// Example 3: Using forInterfaces with string specs
// ============================================================================

async function stringSpecUsage() {
  const polyfill = createDevPolyfill()
  polyfill.registerPlugin(randomPlugin)
  polyfill.registerPlugin(monotonicClockPlugin)

  // Use string interface specifications (more concise)
  const result = await polyfill.forInterfaces([
    'wasi:random@0.2.0',
    'wasi:clocks/monotonic-clock@0.2.0',
  ])

  console.log('Loaded with string specs:', result.loaded.length)

  polyfill.destroy()
}

// ============================================================================
// Example 4: Integration with WebAssembly.instantiate
// ============================================================================

async function wasmIntegration(wasmBytes: ArrayBuffer) {
  const polyfill = createDevPolyfill()
  polyfill.registerPlugin(randomPlugin)
  polyfill.registerPlugin(monotonicClockPlugin)
  polyfill.registerPlugin(wallClockPlugin)

  // Get imports for your component
  const result = await polyfill.forInterfaces([
    'wasi:random@0.2.0',
    'wasi:clocks/monotonic-clock@0.2.0',
    'wasi:clocks/wall-clock@0.2.0',
  ])

  // Instantiate your WebAssembly component with the imports
  // Note: This is simplified - real components need jco transpilation
  const { instance } = await WebAssembly.instantiate(wasmBytes, result.imports)

  // Use the component
  // const exports = instance.exports as { myFunction: () => void }
  // exports.myFunction()

  polyfill.destroy()
}

// Run examples
if (typeof require !== 'undefined' && require.main === module) {
  developmentUsage().catch(console.error)
}

export { developmentUsage, productionUsage, stringSpecUsage, wasmIntegration }
