/**
 * Service Worker HTTP Handler example for @tegmentum/wasip2-polyfill
 *
 * Shows how to set up a Service Worker to handle HTTP requests
 * using WASI components.
 *
 * This example includes both the Service Worker code and
 * the main page registration code.
 */

import { Polyfill } from '@tegmentum/wasip2-polyfill'
import {
  httpPlugins,
  httpIncomingHandlerPlugin,
  ServiceWorkerHandler,
  ServiceWorkerAdapter,
  createServiceWorkerHandler,
  registerServiceWorkerHandler,
  isServiceWorkerContext,
  serviceWorkerIncomingHandlerImplementation,
  HTTP_INCOMING_HANDLER_INTERFACE,
} from '@tegmentum/wasip2-polyfill/plugins/http'

// =============================================================================
// SERVICE WORKER CODE (sw.ts)
// =============================================================================

/**
 * Example: Basic Service Worker setup
 *
 * This code would go in your service worker file (sw.ts)
 */
async function serviceWorkerSetup() {
  // Check if we're in a Service Worker context
  if (!isServiceWorkerContext()) {
    console.log('Not in Service Worker context')
    return
  }

  // Load your WASI component
  const wasmBytes = await fetch('/path/to/http-component.wasm').then((r) => r.arrayBuffer())
  const module = await WebAssembly.compile(wasmBytes)

  // Set up the polyfill
  const polyfill = new Polyfill()
  polyfill.registerPlugins(httpPlugins)

  // Get imports for the component
  const imports = polyfill.getImportsForInterfaces([HTTP_INCOMING_HANDLER_INTERFACE])

  // Instantiate the WASI component
  const instance = await WebAssembly.instantiate(module, imports)

  // Create the Service Worker handler
  const handler = createServiceWorkerHandler({
    wasmInstance: instance,
    // The exported handle function name
    handleExport: 'wasi:http/incoming-handler#handle',
  })

  // Register the fetch event listener
  self.addEventListener('fetch', ((event: FetchEvent) => {
    event.respondWith(handler(event.request))
  }) as EventListener)

  console.log('Service Worker initialized')
}

/**
 * Example: Using URL patterns
 *
 * Only handle requests matching certain patterns
 */
async function serviceWorkerWithPatterns() {
  if (!isServiceWorkerContext()) return

  const wasmBytes = await fetch('/api-handler.wasm').then((r) => r.arrayBuffer())
  const module = await WebAssembly.compile(wasmBytes)

  const polyfill = new Polyfill()
  polyfill.registerPlugins(httpPlugins)

  const imports = polyfill.getImportsForInterfaces([HTTP_INCOMING_HANDLER_INTERFACE])
  const instance = await WebAssembly.instantiate(module, imports)

  const handler = createServiceWorkerHandler({
    wasmInstance: instance,
    // Only handle API requests
    urlPatterns: [
      { test: (url: string) => url.includes('/api/') },
      { test: (url: string) => url.includes('/graphql') },
    ],
    // Let other requests through to the network
    fallthrough: true,
  })

  self.addEventListener('fetch', ((event: FetchEvent) => {
    event.respondWith(handler(event.request))
  }) as EventListener)
}

/**
 * Example: Using the ServiceWorkerAdapter class
 *
 * For more control over request handling
 */
async function usingServiceWorkerAdapter() {
  if (!isServiceWorkerContext()) return

  const adapter = new ServiceWorkerAdapter()

  // Load and initialize the WASI component
  const wasmBytes = await fetch('/component.wasm').then((r) => r.arrayBuffer())
  const module = await WebAssembly.compile(wasmBytes)

  const polyfill = new Polyfill()
  polyfill.registerPlugins(httpPlugins)

  const imports = polyfill.getImportsForInterfaces([HTTP_INCOMING_HANDLER_INTERFACE])
  const instance = await WebAssembly.instantiate(module, imports)

  // Initialize the adapter
  adapter.initialize({
    wasmInstance: instance,
    urlPatterns: [{ test: (url) => url.includes('/api/') }],
    fallthrough: true,
  })

  // Handle fetch events with more control
  self.addEventListener('fetch', ((event: FetchEvent) => {
    // Check if we should handle this request
    if (adapter.canHandle(event.request)) {
      event.respondWith(adapter.handleRequest(event.request))
    }
    // Otherwise, let the browser handle it normally
  }) as EventListener)
}

/**
 * Example: Custom handle function (no WASM)
 *
 * For testing or JavaScript-only implementations
 */
async function customHandleFunction() {
  if (!isServiceWorkerContext()) return

  // Create handler with a custom JavaScript function
  const handler = createServiceWorkerHandler({
    handleFunction: async (_requestHandle: number, _responseOutparamHandle: number) => {
      // This would be your WASI component's handle logic
      // For testing, we just return without setting a response
      console.log('Handling request with custom function')
    },
    urlPatterns: [{ test: (url) => url.includes('/mock/') }],
  })

  self.addEventListener('fetch', ((event: FetchEvent) => {
    if (event.request.url.includes('/mock/')) {
      event.respondWith(handler(event.request))
    }
  }) as EventListener)
}

/**
 * Example: Using registerServiceWorkerHandler helper
 *
 * Simplest way to set up the handler
 */
async function simpleRegistration() {
  if (!isServiceWorkerContext()) return

  const wasmBytes = await fetch('/component.wasm').then((r) => r.arrayBuffer())
  const module = await WebAssembly.compile(wasmBytes)

  const polyfill = new Polyfill()
  polyfill.registerPlugins(httpPlugins)

  const imports = polyfill.getImportsForInterfaces([HTTP_INCOMING_HANDLER_INTERFACE])
  const instance = await WebAssembly.instantiate(module, imports)

  // One-liner to register the handler
  registerServiceWorkerHandler({
    wasmInstance: instance,
    urlPatterns: [{ test: (url) => url.includes('/api/') }],
    fallthrough: true,
  })
}

// =============================================================================
// MAIN PAGE CODE (main.ts)
// =============================================================================

/**
 * Example: Register Service Worker from main page
 */
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      })

      console.log('Service Worker registered:', registration.scope)

      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        console.log('Service Worker update found:', newWorker?.state)
      })
    } catch (error) {
      console.error('Service Worker registration failed:', error)
    }
  } else {
    console.log('Service Workers not supported')
  }
}

/**
 * Example: Communicate with Service Worker
 */
async function communicateWithServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  const registration = await navigator.serviceWorker.ready

  // Post a message to the Service Worker
  registration.active?.postMessage({
    type: 'CONFIG_UPDATE',
    config: {
      debugMode: true,
      maxCacheSize: 1024 * 1024,
    },
  })

  // Listen for messages from Service Worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    console.log('Message from Service Worker:', event.data)
  })
}

/**
 * Example: Full setup for a web application
 */
async function fullApplicationSetup() {
  // 1. Register the Service Worker
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/sw.js')
    console.log('Service Worker registered')
  }

  // 2. Wait for it to be ready
  await navigator.serviceWorker.ready
  console.log('Service Worker ready')

  // 3. Now API calls will be handled by the Service Worker
  // which uses our WASI component
  const response = await fetch('/api/data')
  const data = await response.json()
  console.log('Response from WASI component:', data)
}

// =============================================================================
// CONFIGURATION EXAMPLES
// =============================================================================

/**
 * Example: Plugin configuration for incoming handler
 */
function pluginConfiguration() {
  const polyfill = new Polyfill()

  // Register with Service Worker implementation
  polyfill.registerPlugin(httpIncomingHandlerPlugin, {
    implementation: 'service-worker',
    options: {
      // Fall through to network for unmatched requests
      fallthrough: true,
      // URL patterns to match
      urlPatterns: [
        { test: (url: string) => url.includes('/api/') },
        { test: (url: string) => new URL(url).pathname.startsWith('/v1/') },
      ],
    },
  })

  console.log('HTTP incoming handler configured for Service Worker')
}

/**
 * Example: Testing the handler without a Service Worker
 */
async function testingWithoutServiceWorker() {
  // For testing, you can use the ServiceWorkerHandler directly
  // without being in a Service Worker context

  const mockHandleFunction = async (
    requestHandle: number,
    responseOutparamHandle: number
  ): Promise<void> => {
    console.log('Mock handle called:', { requestHandle, responseOutparamHandle })
    // Simulate WASI component behavior
  }

  const handler = new ServiceWorkerHandler({
    handleFunction: mockHandleFunction,
  })

  // Test with a Request object
  const request = new Request('https://example.com/api/test')
  const response = await handler.handle(request)

  console.log('Test response:', {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
  })
}

// Run main page examples (not Service Worker ones)
registerServiceWorker().catch(console.error)
pluginConfiguration()
testingWithoutServiceWorker().catch(console.error)
