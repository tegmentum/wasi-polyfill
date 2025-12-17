/**
 * HTTP plugin usage examples for @tegmentum/wasip2-polyfill
 *
 * This example demonstrates how to use the HTTP plugin for both
 * outgoing requests (client) and incoming requests (server).
 */

import { createDevPolyfill, Polyfill } from '@tegmentum/wasip2-polyfill'
import {
  httpTypesPlugin,
  httpOutgoingHandlerPlugin,
  httpIncomingHandlerPlugin,
  httpPlugins,
  Fields,
  createTestHttpHandler,
  createServiceWorkerHandler,
  isServiceWorkerContext,
  type TestRequest,
  type TestResponse,
} from '@tegmentum/wasip2-polyfill/plugins/http'

// ============================================================================
// Example 1: HTTP Client (Outgoing Requests)
// ============================================================================

async function httpClientUsage() {
  const polyfill = createDevPolyfill()

  // Register HTTP plugins for making outgoing requests
  polyfill.registerPlugin(httpTypesPlugin)
  polyfill.registerPlugin(httpOutgoingHandlerPlugin, {
    implementation: 'fetch', // Uses browser/Node fetch API
    // Optional: Configure allowed hosts for security
    // allowedHosts: ['api.example.com', 'cdn.example.com'],
  })

  // Get imports for HTTP interfaces
  const result = await polyfill.forInterfaces([
    'wasi:http/types@0.2.0',
    'wasi:http/outgoing-handler@0.2.0',
  ])

  console.log('HTTP client interfaces loaded:', result.loaded.length)

  // The WASM component can now make HTTP requests using wasi:http/outgoing-handler
  // Example component code (Rust/JavaScript compiled to WASM):
  //
  // use wasi::http::outgoing_handler::handle;
  // let response = handle(request, None)?;

  polyfill.destroy()
}

// ============================================================================
// Example 2: All HTTP Plugins at Once
// ============================================================================

async function allHttpPluginsUsage() {
  const polyfill = createDevPolyfill()

  // Register all HTTP plugins at once using the plugins array
  for (const plugin of httpPlugins) {
    polyfill.registerPlugin(plugin)
  }

  const result = await polyfill.forInterfaces([
    'wasi:http/types@0.2.0',
    'wasi:http/outgoing-handler@0.2.0',
    'wasi:http/incoming-handler@0.2.0',
  ])

  console.log('All HTTP interfaces loaded:', result.loaded.length)

  polyfill.destroy()
}

// ============================================================================
// Example 3: HTTP Server with Callback Handler
// ============================================================================

async function httpServerUsage() {
  const polyfill = createDevPolyfill()

  polyfill.registerPlugin(httpTypesPlugin)

  // Register incoming handler with a callback to process requests
  polyfill.registerPlugin(httpIncomingHandlerPlugin, {
    implementation: 'callback',
    // The handler that processes incoming requests
    handler: async (request) => {
      console.log(`Received ${request.method} ${request.pathWithQuery}`)

      // Return a response
      return {
        status: 200,
        headers: new Fields([['content-type', 'application/json']]),
        body: JSON.stringify({ message: 'Hello from WASI!' }),
      }
    },
  })

  const result = await polyfill.forInterfaces([
    'wasi:http/types@0.2.0',
    'wasi:http/incoming-handler@0.2.0',
  ])

  console.log('HTTP server loaded')

  polyfill.destroy()
}

// ============================================================================
// Example 4: Testing HTTP Components
// ============================================================================

async function httpTestingUsage() {
  const polyfill = createDevPolyfill()

  // Create a test handler for in-process HTTP testing
  const testHandler = createTestHttpHandler()

  polyfill.registerPlugin(httpTypesPlugin)
  polyfill.registerPlugin(httpIncomingHandlerPlugin, {
    implementation: 'test',
    testHandler,
  })

  const result = await polyfill.forInterfaces([
    'wasi:http/types@0.2.0',
    'wasi:http/incoming-handler@0.2.0',
  ])

  // Simulate an incoming request for testing
  const testRequest: TestRequest = {
    method: 'GET',
    uri: '/api/users',
    headers: [['accept', 'application/json']],
    body: undefined,
  }

  // The test handler captures requests and lets you verify behavior
  const response: TestResponse = await testHandler.sendRequest(testRequest)

  console.log('Test response status:', response.status)
  console.log('Test response body:', response.body)

  polyfill.destroy()
}

// ============================================================================
// Example 5: Service Worker Integration
// ============================================================================

async function serviceWorkerUsage() {
  // This example shows how to use HTTP incoming handler in a Service Worker
  // to route fetch events through a WASM component

  if (!isServiceWorkerContext()) {
    console.log('Not running in a Service Worker context')
    return
  }

  const polyfill = createDevPolyfill()

  // Create a Service Worker handler
  const swHandler = createServiceWorkerHandler({
    // Route patterns to handle
    routes: ['/api/*', '/app/*'],
    // Fallback behavior for unmatched routes
    fallback: 'network',
  })

  polyfill.registerPlugin(httpTypesPlugin)
  polyfill.registerPlugin(httpIncomingHandlerPlugin, {
    implementation: 'service-worker',
    handler: swHandler,
  })

  // Register the handler with the Service Worker
  // This connects fetch events to your WASM component
  swHandler.register()

  console.log('Service Worker HTTP handler registered')
}

// ============================================================================
// Example 6: Working with HTTP Fields (Headers)
// ============================================================================

function httpFieldsUsage() {
  // Create headers from an array of key-value pairs
  const headers = new Fields([
    ['content-type', 'application/json'],
    ['authorization', 'Bearer token123'],
    ['x-custom-header', 'value1'],
    ['x-custom-header', 'value2'], // Multiple values for same header
  ])

  // Get all values for a header
  const customValues = headers.get('x-custom-header')
  console.log('Custom header values:', customValues) // ['value1', 'value2']

  // Check if header exists
  const hasAuth = headers.has('authorization')
  console.log('Has authorization:', hasAuth) // true

  // Get all header entries
  const entries = headers.entries()
  console.log('All headers:', entries)

  // Clone and modify
  const newHeaders = headers.clone()
  newHeaders.set('x-new-header', ['new-value'])
  newHeaders.delete('authorization')

  console.log('Modified headers:', newHeaders.entries())
}

// ============================================================================
// Example 7: Restricting Outgoing Requests
// ============================================================================

async function restrictedHttpUsage() {
  const polyfill = createDevPolyfill()

  polyfill.registerPlugin(httpTypesPlugin)
  polyfill.registerPlugin(httpOutgoingHandlerPlugin, {
    implementation: 'fetch',
    // Only allow requests to specific domains
    allowedHosts: ['api.myservice.com', 'cdn.myservice.com'],
    // Optional: Set default headers for all requests
    defaultHeaders: [
      ['user-agent', 'MyApp/1.0'],
      ['x-api-version', '2024-01'],
    ],
  })

  const result = await polyfill.forInterfaces([
    'wasi:http/types@0.2.0',
    'wasi:http/outgoing-handler@0.2.0',
  ])

  // Requests to non-allowed hosts will fail with an error

  polyfill.destroy()
}

// Run examples
export {
  httpClientUsage,
  allHttpPluginsUsage,
  httpServerUsage,
  httpTestingUsage,
  serviceWorkerUsage,
  httpFieldsUsage,
  restrictedHttpUsage,
}
