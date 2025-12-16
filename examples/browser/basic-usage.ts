/**
 * Basic usage example for @tegmentum/wasip2-polyfill
 *
 * Shows how to set up the polyfill and run a WASI component
 * in a browser environment.
 */

import { Polyfill } from '@tegmentum/wasip2-polyfill'
import { randomPlugin, cryptoRandomImplementation } from '@tegmentum/wasip2-polyfill/plugins/random'
import { clocksPlugins, performanceMonotonicImplementation } from '@tegmentum/wasip2-polyfill/plugins/clocks'

/**
 * Example: Basic polyfill setup
 */
async function basicSetup() {
  // Create polyfill with default plugins
  const polyfill = new Polyfill()

  // Register plugins with specific implementations
  polyfill.registerPlugin(randomPlugin, { implementation: 'crypto' })
  polyfill.registerPlugins(clocksPlugins)

  // Load and instantiate a WASI component
  const wasmBytes = await fetch('/path/to/component.wasm').then((r) => r.arrayBuffer())

  // Get imports for the component
  // In real usage, you'd introspect the component or use a manifest
  const imports = polyfill.getImportsForInterfaces([
    { package: 'wasi:random', name: 'random', version: '0.2.0' },
    { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
  ])

  // Instantiate the WebAssembly module
  const module = await WebAssembly.compile(wasmBytes)
  const instance = await WebAssembly.instantiate(module, imports)

  // Call exports from the WASI component
  // The exact exports depend on what the component provides
  console.log('WASI component instantiated:', instance)
}

/**
 * Example: Using with jco-generated code
 */
async function withJcoGenerated() {
  const polyfill = new Polyfill()

  // When using jco to generate JS bindings, you can pass
  // the polyfill's imports to the generated instantiate function
  const imports = polyfill.getImportsForInterfaces([
    { package: 'wasi:random', name: 'random', version: '0.2.0' },
    { package: 'wasi:clocks', name: 'wall-clock', version: '0.2.0' },
  ])

  // Example: calling jco-generated instantiate
  // import { instantiate } from './generated-component.js'
  // const component = await instantiate(imports)
  // component.exportedFunction()

  console.log('Imports ready for jco-generated component:', Object.keys(imports))
}

/**
 * Example: CLI environment setup
 */
async function cliEnvironment() {
  const polyfill = new Polyfill()

  // Import CLI plugins
  const { cliPlugins, virtualCliImplementation } = await import(
    '@tegmentum/wasip2-polyfill/plugins/cli'
  )

  // Configure CLI environment
  polyfill.registerPlugins(cliPlugins, {
    // Override with virtual implementation
    implementation: 'virtual',
    options: {
      // Set command-line arguments
      args: ['my-program', '--verbose', 'input.txt'],
      // Set environment variables
      env: {
        HOME: '/home/user',
        PATH: '/usr/bin',
        DEBUG: 'true',
      },
    },
  })

  const imports = polyfill.getImportsForInterfaces([
    { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
    { package: 'wasi:cli', name: 'stdout', version: '0.2.0' },
    { package: 'wasi:cli', name: 'stderr', version: '0.2.0' },
  ])

  console.log('CLI environment configured:', imports)
}

// Run examples
basicSetup().catch(console.error)
withJcoGenerated().catch(console.error)
cliEnvironment().catch(console.error)
