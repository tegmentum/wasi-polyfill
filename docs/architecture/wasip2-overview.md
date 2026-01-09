# WASIP2 Architecture Overview

This document provides a comprehensive overview of the WASIP2 implementation architecture in `@tegmentum/wasi-polyfill`.

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Core Components](#core-components)
3. [Plugin System](#plugin-system)
4. [Runtime Flow](#runtime-flow)
5. [Extension Points](#extension-points)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application                               │
├─────────────────────────────────────────────────────────────────┤
│                         Wasip2 Class                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Config    │  │   Policy    │  │    Plugin Registry      │  │
│  │   Manager   │  │   Engine    │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                        Plugin Layer                              │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────────┐ │
│  │  CLI   │ │Filesys │ │  HTTP  │ │Sockets │ │  ... (14+)     │ │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                       Runtime Layer                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Component  │  │  Bindgen    │  │    Provider Registry    │  │
│  │   Loader    │  │  (imports)  │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    WebAssembly Runtime                           │
│           (Browser WebAssembly API / Node.js)                    │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Wasip2 Class (`src/wasip2/index.ts`)

The main entry point for WASIP2 functionality:

```typescript
import { Wasip2 } from '@tegmentum/wasi-polyfill/wasip2'

const wasip2 = new Wasip2({
  args: ['program', '--flag'],
  env: { HOME: '/home/user' },
  // Plugin configuration...
})

const instance = await wasip2.instantiate(wasmBytes)
await instance.run()
```

**Responsibilities:**
- Configuration management
- Plugin initialization and registration
- Component instantiation
- Import/export binding

### 2. Policy Engine (`src/wasip2/core/policy.ts`)

Enforces capability-based security:

```typescript
interface PolicyConfig {
  // Network access control
  network?: {
    allowHosts?: string[]
    denyHosts?: string[]
    allowPorts?: number[]
  }

  // Filesystem access control
  filesystem?: {
    readonly?: boolean
    allowPaths?: string[]
    denyPaths?: string[]
  }

  // Resource limits
  limits?: {
    maxMemory?: number
    maxOpenFiles?: number
    maxNetworkConnections?: number
  }
}
```

**Enforcement points:**
- Before plugin operations execute
- Path resolution and validation
- Network connection establishment
- Resource allocation

### 3. Plugin Registry (`src/wasip2/core/registry.ts`)

Manages plugin lifecycle and lookup:

```typescript
class PluginRegistry {
  // Register a plugin
  register(plugin: WasiPlugin): void

  // Get plugin by interface
  get(interfaceName: string): WasiPlugin | undefined

  // List all registered plugins
  list(): WasiPlugin[]

  // Get imports for all plugins
  getImports(): Record<string, Record<string, Function>>
}
```

### 4. Component Loader (`src/wasip2/runtime/loader.ts`)

Handles WebAssembly component loading and instantiation:

```typescript
class ComponentLoader {
  // Load from bytes
  async load(bytes: ArrayBuffer): Promise<ComponentInstance>

  // Load from URL
  async loadFromUrl(url: string): Promise<ComponentInstance>

  // Introspect component manifest
  async introspect(bytes: ArrayBuffer): Promise<ComponentManifest>
}
```

---

## Plugin System

### Plugin Interface

All plugins implement the `WasiPlugin` interface:

```typescript
interface WasiPlugin {
  /** Plugin identifier */
  readonly name: string

  /** WASI version (e.g., "0.2.0") */
  readonly version: string

  /** Interfaces provided by this plugin */
  readonly interfaces: PluginInterface[]

  /** Initialize the plugin */
  initialize?(config: PluginConfig): Promise<void>

  /** Get import functions for WebAssembly */
  getImports(): Record<string, Function>

  /** Cleanup resources */
  dispose?(): Promise<void>
}

interface PluginInterface {
  /** Full interface name (e.g., "wasi:filesystem/types") */
  name: string

  /** Functions exported by this interface */
  functions: string[]
}
```

### Implementation Variants

Each plugin typically provides multiple implementation variants:

| Variant | Description | Use Case |
|---------|-------------|----------|
| `stub` | Returns not-implemented errors | Default fallback |
| `virtual` | In-memory simulation | Testing, sandboxing |
| `real` | Actual system resources | Production |
| `proxy` | Remote execution via WebSocket | Browser with server backend |

Example configuration:

```typescript
const wasip2 = new Wasip2({
  filesystem: {
    implementation: 'virtual', // or 'opfs', 'idb', 'proxy'
    config: {
      root: '/app',
      preopens: { '/data': '/real/path' }
    }
  },
  http: {
    implementation: 'fetch', // or 'proxy', 'service-worker'
  },
  sockets: {
    implementation: 'ws-gateway', // WebSocket tunneling
    config: {
      gatewayUrl: 'wss://gateway.example.com'
    }
  }
})
```

### Available Plugins

| Plugin | Package | Interfaces |
|--------|---------|------------|
| CLI | `wasi:cli` | environment, exit, stdin, stdout, stderr, terminal-* |
| Clocks | `wasi:clocks` | monotonic-clock, wall-clock |
| Filesystem | `wasi:filesystem` | types, preopens |
| HTTP | `wasi:http` | types, outgoing-handler, incoming-handler |
| I/O | `wasi:io` | poll, streams, error |
| Random | `wasi:random` | random, insecure, insecure-seed |
| Sockets | `wasi:sockets` | network, tcp, tcp-create-socket, udp, udp-create-socket, ip-name-lookup, instance-network |
| Logging | `wasi:logging` | logging |
| Config | `wasi:config` | runtime, store |
| KeyValue | `wasi:keyvalue` | store, atomics, batch |
| Blobstore | `wasi:blobstore` | types, container, blobstore |
| Threads | `wasi:thread-spawn` | thread-spawn |

---

## Runtime Flow

### 1. Initialization

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Create       │────▶│ Load         │────▶│ Register     │
│ Wasip2       │     │ Plugins      │     │ Plugins      │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                                                 ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Ready for    │◀────│ Apply        │◀────│ Initialize   │
│ Instantiate  │     │ Policy       │     │ Plugins      │
└──────────────┘     └──────────────┘     └──────────────┘
```

### 2. Component Instantiation

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Load WASM    │────▶│ Parse        │────▶│ Resolve      │
│ Bytes        │     │ Component    │     │ Imports      │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                                                 ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Return       │◀────│ Create       │◀────│ Instantiate  │
│ Instance     │     │ Bindings     │     │ WebAssembly  │
└──────────────┘     └──────────────┘     └──────────────┘
```

### 3. Import Resolution

When a component requests an import:

1. **Lookup**: Registry searches for matching plugin
2. **Policy Check**: Policy engine validates the operation
3. **Binding**: Function is bound with context
4. **Execution**: Call is dispatched to plugin implementation

```typescript
// Internal import resolution
function resolveImport(
  interfaceName: string,
  functionName: string
): Function {
  const plugin = registry.get(interfaceName)
  if (!plugin) {
    throw new Error(`No plugin for ${interfaceName}`)
  }

  const imports = plugin.getImports()
  const fn = imports[functionName]

  // Wrap with policy enforcement
  return (...args) => {
    policy.check(interfaceName, functionName, args)
    return fn(...args)
  }
}
```

### 4. Resource Lifecycle

Resources (handles) are managed with explicit lifecycle:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Create       │────▶│ Use          │────▶│ Drop         │
│ Resource     │     │ Resource     │     │ Resource     │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Allocate     │     │ Track        │     │ Cleanup      │
│ Handle ID    │     │ Operations   │     │ & Release    │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## Extension Points

### Custom Plugin Implementation

Create a custom plugin by implementing `WasiPlugin`:

```typescript
import type { WasiPlugin } from '@tegmentum/wasi-polyfill/wasip2'

const myPlugin: WasiPlugin = {
  name: 'my-custom-plugin',
  version: '0.2.0',
  interfaces: [
    { name: 'my:custom/api', functions: ['do-something'] }
  ],

  getImports() {
    return {
      'my:custom/api': {
        'do-something': (arg: number) => {
          console.log('Custom operation:', arg)
          return arg * 2
        }
      }
    }
  }
}

// Register with Wasip2
wasip2.registerPlugin(myPlugin)
```

### Middleware / Interceptors

Wrap plugin operations with custom logic:

```typescript
function loggingMiddleware(plugin: WasiPlugin): WasiPlugin {
  const originalImports = plugin.getImports()

  return {
    ...plugin,
    getImports() {
      const wrapped: Record<string, Function> = {}

      for (const [iface, fns] of Object.entries(originalImports)) {
        wrapped[iface] = {}
        for (const [name, fn] of Object.entries(fns)) {
          wrapped[iface][name] = (...args: unknown[]) => {
            console.log(`[${iface}] ${name}`, args)
            const result = fn(...args)
            console.log(`[${iface}] ${name} =>`, result)
            return result
          }
        }
      }

      return wrapped
    }
  }
}
```

### Custom Resource Providers

Extend built-in plugins with custom backends:

```typescript
import { FilesystemPlugin } from '@tegmentum/wasi-polyfill/wasip2/plugins/filesystem'

// Custom S3-backed filesystem
class S3Filesystem implements FilesystemBackend {
  constructor(private bucket: string, private region: string) {}

  async readFile(path: string): Promise<Uint8Array> {
    // Fetch from S3
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    // Upload to S3
  }

  // ... other methods
}

const wasip2 = new Wasip2({
  filesystem: {
    implementation: 'custom',
    backend: new S3Filesystem('my-bucket', 'us-east-1')
  }
})
```

---

## Directory Structure

```
src/wasip2/
├── index.ts                 # Main entry point
├── core/
│   ├── policy.ts           # Policy engine
│   ├── registry.ts         # Plugin registry
│   ├── manifest.ts         # Component manifest handling
│   └── types.ts            # Core type definitions
├── plugins/
│   ├── cli/                # wasi:cli plugin
│   ├── clocks/             # wasi:clocks plugin
│   ├── filesystem/         # wasi:filesystem plugin
│   ├── http/               # wasi:http plugin
│   ├── io/                 # wasi:io plugin
│   ├── random/             # wasi:random plugin
│   ├── sockets/            # wasi:sockets plugin
│   ├── logging/            # wasi:logging plugin
│   ├── keyvalue/           # wasi:keyvalue plugin
│   ├── blobstore/          # wasi:blobstore plugin
│   ├── config/             # wasi:config plugin
│   ├── threads/            # wasi:thread-spawn plugin
│   └── ws-gateway/         # WebSocket gateway for sockets
├── runtime/
│   ├── loader.ts           # Component loader
│   ├── bindgen.ts          # Import binding generation
│   ├── provider.ts         # Provider abstraction
│   └── resources.ts        # Resource handle management
├── proxy/
│   ├── client.ts           # Proxy client
│   ├── server.ts           # Proxy server
│   ├── protocol.ts         # Protocol definitions
│   └── adapters.ts         # Transport adapters
├── build/
│   ├── vite-plugin.ts      # Vite build plugin
│   ├── esbuild-plugin.ts   # esbuild build plugin
│   └── introspect.ts       # Component introspection
└── testing/
    ├── harness.ts          # Test harness
    └── fixtures.ts         # Test fixtures
```

---

## See Also

- [Plugin Development Guide](../guides/plugin-development.md)
- [Proxy Protocol Specification](proxy-protocol.md)
- [Security Best Practices](../guides/security.md)
- [Troubleshooting Guide](../guides/troubleshooting.md)
