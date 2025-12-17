# @tegmentum/wasip2-polyfill

A comprehensive WASI Preview 2 polyfill for browser and JavaScript environments.

## Overview

This package provides a provider framework, policy engine, and loader for running WASI 2 components in environments that don't natively support WASI Preview 2 (primarily browsers and JavaScript runtimes).

**Key Features:**

- **Plugin Architecture** - Modular interface implementations with multiple backends
- **Capability-Based Security** - Fine-grained policy control over what components can access
- **Zero-Config Defaults** - Safe, sandboxed defaults with explicit capability grants
- **Async-Native** - All operations are async-capable for browser compatibility
- **Tree-Shakeable** - Import only the interfaces you need

## Installation

```bash
npm install @tegmentum/wasip2-polyfill
```

## Quick Start

```typescript
import { createPolyfill, createCliPolicy } from '@tegmentum/wasip2-polyfill'
import { randomPlugin } from '@tegmentum/wasip2-polyfill/plugins/random'
import { monotonicClockPlugin } from '@tegmentum/wasip2-polyfill/plugins/clocks'

// Create a polyfill with a CLI-friendly policy
const polyfill = createPolyfill({
  policy: createCliPolicy({
    env: { NODE_ENV: 'production' },
    args: ['--verbose']
  })
})

// Register the plugins you need
polyfill.registerPlugin(randomPlugin)
polyfill.registerPlugin(monotonicClockPlugin)

// Get imports for your WASM component
const { imports } = await polyfill.forInterfaces([
  'wasi:random@0.2.0',
  'wasi:clocks/monotonic-clock@0.2.0'
])

// Use with WebAssembly.instantiate
const instance = await WebAssembly.instantiate(wasmBytes, imports)
```

## Supported Interfaces

### Core Interfaces

| Interface | Plugin | Description |
|-----------|--------|-------------|
| `wasi:random/random` | `randomPlugin` | Cryptographic random number generation |
| `wasi:clocks/monotonic-clock` | `monotonicClockPlugin` | High-resolution monotonic time |
| `wasi:clocks/wall-clock` | `wallClockPlugin` | Wall clock time (date/time) |
| `wasi:io/streams` | `streamsPlugin` | Input/output streams |
| `wasi:io/poll` | `pollPlugin` | Polling for I/O readiness |

### CLI Interfaces

| Interface | Plugin | Description |
|-----------|--------|-------------|
| `wasi:cli/environment` | `environmentPlugin` | Environment variables and arguments |
| `wasi:cli/stdin` | `stdinPlugin` | Standard input stream |
| `wasi:cli/stdout` | `stdoutPlugin` | Standard output stream |
| `wasi:cli/stderr` | `stderrPlugin` | Standard error stream |
| `wasi:cli/exit` | `exitPlugin` | Process exit handling |

### Filesystem Interfaces

| Interface | Plugin | Description |
|-----------|--------|-------------|
| `wasi:filesystem/types` | `filesystemTypesPlugin` | Filesystem types and operations |
| `wasi:filesystem/preopens` | `preopensPlugin` | Pre-opened directory handles |

**Backends:**
- `memory` - In-memory filesystem (default, safe)
- `opfs` - Origin Private File System (browser persistent storage)

### Networking Interfaces

| Interface | Plugin | Description |
|-----------|--------|-------------|
| `wasi:sockets/tcp` | `tcpPlugin` | TCP socket operations |
| `wasi:sockets/udp` | `udpPlugin` | UDP socket operations |
| `wasi:sockets/ip-name-lookup` | `ipNameLookupPlugin` | DNS resolution |
| `wasi:http/outgoing-handler` | `outgoingHandlerPlugin` | HTTP client (fetch) |
| `wasi:http/incoming-handler` | `incomingHandlerPlugin` | HTTP server (Service Worker) |

### Storage Interfaces

| Interface | Plugin | Description |
|-----------|--------|-------------|
| `wasi:keyvalue/store` | `keyvalueStorePlugin` | Key-value storage |
| `wasi:keyvalue/atomics` | `keyvalueAtomicsPlugin` | Atomic key-value operations |
| `wasi:keyvalue/batch` | `keyvalueBatchPlugin` | Batch key-value operations |
| `wasi:blobstore/blobstore` | `blobstorePlugin` | Object/blob storage |
| `wasi:blobstore/container` | `containerPlugin` | Blob container management |

### Configuration & Logging

| Interface | Plugin | Description |
|-----------|--------|-------------|
| `wasi:config/store` | `configStorePlugin` | Configuration values |
| `wasi:logging/logging` | `loggingPlugin` | Structured logging |

### Advanced Interfaces

| Interface | Plugin | Description |
|-----------|--------|-------------|
| `wasi:threads` | Thread plugins | Web Worker-based threading |
| WebSocket Gateway | `wsGatewayPlugin` | Native socket tunneling via WebSocket |

## Policies

Policies control which interfaces components can access and how they're configured.

### Built-in Policies

```typescript
import {
  createSafePolicy,    // Allows random + clocks only
  createCliPolicy,     // Allows CLI interfaces
  AllowAllPolicy,      // Development only - allows everything
  DenyAllPolicy        // Denies all interfaces
} from '@tegmentum/wasip2-polyfill'
```

### Custom Policy

```typescript
import { createPolicy } from '@tegmentum/wasip2-polyfill'

const policy = createPolicy({
  defaultAllow: false,
  allow: [
    'wasi:random@0.2.0',
    'wasi:clocks/monotonic-clock@0.2.0',
  ],
  deny: [
    'wasi:filesystem/types@0.2.0',
  ],
  preopens: ['/app/data'],  // For filesystem access
  env: { API_KEY: 'secret' },
  args: ['--config', 'prod.json'],
})
```

## Runtime Component Loading

For dynamically loading unknown components at runtime:

```typescript
import { createComponentLoader } from '@tegmentum/wasip2-polyfill/runtime'
import { randomPlugin } from '@tegmentum/wasip2-polyfill/plugins/random'

const loader = createComponentLoader({ devMode: true })
loader.getPolyfill().registerPlugin(randomPlugin)

// Load and instantiate a component
const component = await loader.loadFromUrl('/my-component.wasm')

// Access exports
component.exports.myFunction()

// Clean up
component.destroy()
```

## Build-Time Tooling

### Vite Plugin

```typescript
// vite.config.ts
import { wasiPolyfillPlugin } from '@tegmentum/wasip2-polyfill/build'

export default {
  plugins: [
    wasiPolyfillPlugin({
      // Auto-generate manifests for .wasm files
      generateManifests: true,
    })
  ]
}
```

### Component Introspection

```typescript
import { introspect, generateManifest } from '@tegmentum/wasip2-polyfill/build'

// Get required interfaces from a component
const result = await introspect(wasmBytes)
console.log(result.imports)  // Required WASI interfaces
console.log(result.wasiSubsystems)  // ['random', 'clocks', ...]

// Generate a manifest file
const manifest = await generateManifest(wasmBytes)
```

## WebSocket Gateway

For native TCP/UDP socket access in browsers, use the WebSocket gateway:

```typescript
import { createWsGatewayPlugin } from '@tegmentum/wasip2-polyfill/plugins/ws-gateway'

const wsGateway = createWsGatewayPlugin({
  gatewayUrl: 'wss://gateway.example.com/tunnel',
  authToken: 'your-auth-token',
})

polyfill.registerPlugin(wsGateway)
```

This tunnels socket operations through a WebSocket proxy server, enabling real TCP/UDP networking from browsers.

## Deterministic Testing

For reproducible tests, use the deterministic test harness:

```typescript
import { createTestHarness, withTestHarness } from '@tegmentum/wasip2-polyfill/testing'

// Create a harness with a fixed seed and time
const harness = createTestHarness({
  seed: 42n,
  initialTime: new Date('2024-01-01T00:00:00Z'),
})

// Get imports with deterministic random and virtual clocks
const { imports } = await harness.getImports([
  { package: 'wasi:random', name: 'random', version: '0.2.0' },
  { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
])

// Control time
harness.advanceTimeSeconds(60)  // Advance 60 seconds
harness.setWallTime(new Date('2024-06-15T12:00:00Z'))

// Get snapshot for assertions
const snapshot = harness.getSnapshot()
console.log(snapshot.monotonicTime)  // 60_000_000_000n (60 seconds in nanoseconds)
console.log(snapshot.logs)  // Captured log entries

// Clean up
harness.destroy()

// Or use the auto-cleanup helper
const result = await withTestHarness({ seed: 123n }, async (h) => {
  const { imports } = await h.getImports([...])
  // ... run your test
  return h.getSnapshot()
})
```

### Bundle Presets

```typescript
import { deterministicBundle, browserTestBundle, minimalBundle } from '@tegmentum/wasip2-polyfill/testing'

// deterministicBundle: Seeded random, virtual clocks, buffer logging
// browserTestBundle: Real crypto, real clocks, buffer logging
// minimalBundle: Just random and clocks with defaults

const harness = createTestHarness({ bundle: 'deterministic' })
```

## API Reference

### Polyfill

```typescript
class Polyfill {
  // Get imports for specified interfaces
  getImports(required: WasiInterface[]): Promise<ImportResult>

  // Get imports from interface strings
  forInterfaces(interfaces: string[]): Promise<ImportResult>

  // Get imports from a component manifest
  forManifest(manifest: ComponentManifest): Promise<ImportResult>

  // Register a plugin
  registerPlugin(plugin: WasiPlugin): void

  // Check if interface is allowed
  isAllowed(iface: WasiInterface | string): boolean

  // Check if plugin is available
  hasPlugin(iface: WasiInterface | string): boolean

  // Clean up resources
  destroy(): void
}
```

### ImportResult

```typescript
interface ImportResult {
  // Imports object for WebAssembly.instantiate
  imports: Record<string, Record<string, unknown>>

  // Successfully loaded interfaces
  loaded: WasiInterface[]

  // Interfaces denied by policy
  denied: WasiInterface[]

  // Interfaces without available plugins
  missing: WasiInterface[]
}
```

## Examples

### Plugin Usage Examples

See the [examples](./examples) directory for comprehensive plugin usage guides:

- **basic-usage.ts** - Dev/safe polyfills, string specs, WASM integration
- **filesystem-usage.ts** - Memory, OPFS, IndexedDB, overlay filesystems
- **http-usage.ts** - HTTP client, server, testing, service workers
- **storage-usage.ts** - KeyValue and blobstore with multiple backends
- **logging-usage.ts** - Console, buffer, NDJSON, OTLP logging backends
- **config-usage.ts** - Static, remote, layered, manifest configurations
- **advanced-usage.ts** - Multi-plugin setup, security policies, lifecycle management

### Browser-Specific Examples

See [examples/browser](./examples/browser) for browser-focused examples:

- **basic-usage.ts** - Simple browser polyfill setup
- **opfs-filesystem.ts** - Persistent filesystem with OPFS
- **dns-over-https.ts** - DNS resolution via DoH
- **service-worker-http.ts** - HTTP server with Service Worker

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run E2E browser tests
npm run test:e2e

# Type check
npm run typecheck
```

## Browser Compatibility

- Chrome/Edge 89+
- Firefox 89+
- Safari 15+

Some features require additional browser APIs:
- OPFS filesystem: Chrome 86+, Firefox 111+, Safari 15.2+
- Service Worker HTTP: All modern browsers
- Web Workers (threads): All modern browsers

## License

MIT
