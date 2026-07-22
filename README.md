# @tegmentum/wasi-polyfill

A multi-version WASI polyfill for browsers and JavaScript runtimes, plus a suite of browser Web API host imports for WebAssembly components.

## Overview

This package lets you run WebAssembly modules and components in environments that don't natively support WASI — primarily the browser, but also Node.js, Deno, Bun, and other JS runtimes.

It provides four subsystems:

| Subsystem | Purpose | Entry point |
|-----------|---------|-------------|
| **wasip1** | Standalone WASI Preview 1 implementation for core modules | `@tegmentum/wasi-polyfill/wasip1` |
| **wasip2** | Capability-based plugin framework for WASI Preview 2 components | `@tegmentum/wasi-polyfill/wasip2` |
| **wasip3** | Async-native primitives (streams, futures, tasks) targeting WASI Preview 3 | `@tegmentum/wasi-polyfill/wasip3` |
| **browser** | Host imports that expose Web Platform APIs (DOM, canvas, fetch, WebGPU, …) to guests | `@tegmentum/wasi-polyfill/browser` |

> The bare `@tegmentum/wasi-polyfill` import still re-exports `wasip2` as a back-compat alias, but it is **deprecated** — prefer the explicit `/wasip2` subpath. The unprefixed `./plugins/*`, `./runtime`, `./build`, `./testing`, and `./proxy` subpaths are likewise aliases for their `/wasip2/...` equivalents.

**Key features**

- **Plugin architecture** — modular interface implementations with multiple backends per interface
- **Capability-based security** — fine-grained policy control over what guests can access
- **Zero-config defaults** — safe sandboxed defaults with explicit capability grants
- **Async-native** — every interface is async-capable for browser compatibility
- **Tree-shakeable** — import only the subpaths you need
- **Component-model native** — works with jco-transpiled components or via runtime transpilation

## Installation

```bash
npm install @tegmentum/wasi-polyfill
```

Optional peer dependencies (install only what you use):

```bash
npm install @bytecodealliance/jco  # runtime component transpilation
npm install ws                      # WebSocket gateway / Node-side sockets
npm install sql.js                  # SQL backend for wasi:sql
npm install onnxruntime-web         # ONNX backend for wasi:nn
```

---

## Quick Start (WASI Preview 2)

```typescript
import { createPolyfill, createCliPolicy } from '@tegmentum/wasi-polyfill/wasip2'
import { randomPlugin } from '@tegmentum/wasi-polyfill/wasip2/plugins/random'
import { monotonicClockPlugin } from '@tegmentum/wasi-polyfill/wasip2/plugins/clocks'

const polyfill = createPolyfill({
  policy: createCliPolicy({
    env: { NODE_ENV: 'production' },
    args: ['--verbose'],
  }),
})

polyfill.registerPlugin(randomPlugin)
polyfill.registerPlugin(monotonicClockPlugin)

const { imports } = await polyfill.forInterfaces([
  'wasi:random/random@0.2.0',
  'wasi:clocks/monotonic-clock@0.2.0',
])

const instance = await WebAssembly.instantiate(wasmBytes, imports)
```

Factories:

- `createPolyfill(config?)` — explicit policy, safe by default
- `createDevPolyfill()` — allows every interface (development only)
- `createJcoPolyfill(config?)` — jco-compatible import shape

---

## WASI Preview 2 Plugins

Each plugin satisfies one or more `wasi:*` interface versions. Register the plugins you need; the policy decides which the guest is actually allowed to import.

### Core

| Interface | Plugin export | Description |
|-----------|---------------|-------------|
| `wasi:random/random` | `randomPlugin` | Cryptographic random number generation |
| `wasi:clocks/monotonic-clock` | `monotonicClockPlugin` | High-resolution monotonic time |
| `wasi:clocks/wall-clock` | `wallClockPlugin` | Wall-clock time |
| `wasi:io/streams` | `streamsPlugin` | Input/output streams |
| `wasi:io/poll` | `pollPlugin` | Polling for I/O readiness |
| `wasi:io/error` | `errorPlugin` | Stream error resource |

Import path: `@tegmentum/wasi-polyfill/wasip2/plugins/{random,clocks,io}`

### CLI

| Interface | Plugin export | Description |
|-----------|---------------|-------------|
| `wasi:cli/environment` | `environmentPlugin` | Env vars, args, initial CWD |
| `wasi:cli/stdin` / `stdout` / `stderr` | (via `environmentPlugin`) | Standard streams |
| `wasi:cli/exit` | (via `environmentPlugin`) | Process exit |

Import path: `@tegmentum/wasi-polyfill/wasip2/plugins/cli`

### Filesystem

| Interface | Plugin export | Description |
|-----------|---------------|-------------|
| `wasi:filesystem/types` | `filesystemTypesPlugin` | Files, descriptors, metadata |
| `wasi:filesystem/preopens` | `filesystemPreopensPlugin` | Pre-opened directory handles |

Backends: in-memory (default), OPFS (browser persistent), IndexedDB, overlay.
Import path: `@tegmentum/wasi-polyfill/wasip2/plugins/filesystem`

### Networking

| Interface | Plugin export | Description |
|-----------|---------------|-------------|
| `wasi:sockets/network` | `networkPlugin` | Network resource handle |
| `wasi:sockets/tcp` | `tcpPlugin` | TCP sockets |
| `wasi:sockets/udp` | `udpPlugin` | UDP sockets |
| `wasi:sockets/ip-name-lookup` | `ipNameLookupPlugin` | DNS resolution (incl. DoH) |
| `wasi:http/types` | `httpTypesPlugin` | HTTP request/response types |
| `wasi:http/outgoing-handler` | `httpOutgoingHandlerPlugin` | HTTP client (fetch) |
| `wasi:http/incoming-handler` | `httpIncomingHandlerPlugin` | HTTP server (Service Worker) |

For real sockets from a browser, see [WebSocket Gateway](#websocket-gateway).
Import paths: `@tegmentum/wasi-polyfill/wasip2/plugins/{sockets,http,ws-gateway}`

### Storage

| Interface | Plugin export | Description |
|-----------|---------------|-------------|
| `wasi:keyvalue/store` | `keyvalueStorePlugin` | Key-value storage |
| `wasi:keyvalue/atomics` | `keyvalueAtomicsPlugin` | Atomic KV operations |
| `wasi:keyvalue/batch` | `keyvalueBatchPlugin` | Batched KV operations |
| `wasi:blobstore/blobstore` | `blobstorePlugin` | Object/blob storage root |
| `wasi:blobstore/container` | `blobstoreContainerPlugin` | Blob container management |

Import paths: `@tegmentum/wasi-polyfill/wasip2/plugins/{keyvalue,blobstore}`

### Configuration & Logging

| Interface | Plugin export | Description |
|-----------|---------------|-------------|
| `wasi:config/store` | `configStorePlugin` | Static configuration values |
| `wasi:config/runtime` | `configRuntimePlugin` | Runtime / remote configuration |
| `wasi:logging/logging` | `loggingPlugin` | Structured logging (console, buffer, NDJSON, OTLP) |

Import paths: `@tegmentum/wasi-polyfill/wasip2/plugins/{config,logging}`

### Messaging & Compute

| Interface | Plugin export | Description |
|-----------|---------------|-------------|
| `wasi:messaging/{types,producer,consumer,handler}` | `messagingTypesPlugin`, `messagingProducerPlugin`, `messagingConsumerPlugin`, `messagingHandlerPlugin` | Pub/sub message queues (draft) |
| `wasi:nn/{tensor,graph,inference,errors}` | `nnTensorPlugin`, `nnGraphPlugin`, `nnInferencePlugin`, `nnErrorsPlugin` | Neural-network inference via WebNN / ONNX |
| `wasi:sql/{types,connection,query,statement,transaction}` | `sqlTypesPlugin`, `sqlConnectionPlugin`, `sqlQueryPlugin`, `sqlStatementPlugin`, `sqlTransactionPlugin` | SQL access (in-memory engine or sql.js) |
| `wasi:threads` | `threadsPlugin` | Web Worker-based threads |

Import paths: `@tegmentum/wasi-polyfill/wasip2/plugins/{messaging,nn,sql,threads}`

### Graphics (wasi-gfx)

| Interface | Plugin export | Description |
|-----------|---------------|-------------|
| `wasi:frame-buffer/frame-buffer` | `frameBufferPlugin` | Software-rendered framebuffers |
| `wasi:graphics-context/graphics-context` | `graphicsContextPlugin` | Graphics context binding |
| `wasi:surface/surface` | `surfacePlugin` | Windowing, pointer, keyboard events |
| `wasi:webgpu` | `webgpuPlugin` | WebGPU compute and rendering |

Convenience bundle: `wasiGfxPlugins` registers all four.
Import paths: `@tegmentum/wasi-polyfill/wasip2/plugins/{frame-buffer,graphics-context,surface,webgpu,wasi-gfx}`

---

## Policies

Policies decide which interfaces a polyfill instance exposes and how each one is configured.

### Built-in policies

```typescript
import {
  createSafePolicy,    // deny-all default; opt in explicitly
  createCliPolicy,     // allows the CLI interface set
  AllowAllPolicy,      // development only — allows everything
  DenyAllPolicy,       // denies all interfaces
  mergePolicies,
} from '@tegmentum/wasi-polyfill/wasip2'
```

### Custom policy

```typescript
import { createPolicy } from '@tegmentum/wasi-polyfill/wasip2'

const policy = createPolicy({
  defaultAllow: false,
  allow: [
    'wasi:random/random@0.2.0',
    'wasi:clocks/monotonic-clock@0.2.0',
  ],
  deny: [
    'wasi:filesystem/types@0.2.0',
  ],
  preopens: ['/app/data'],
  env: { API_KEY: 'secret' },
  args: ['--config', 'prod.json'],
})
```

---

## Runtime Component Loading

`RuntimeBindgen` and `ComponentLoader` instantiate `.component.wasm` files directly in the browser using jco's runtime transpilation.

```bash
npm install @bytecodealliance/jco
```

```typescript
import { createRuntimeBindgen, registerCorePlugins } from '@tegmentum/wasi-polyfill/wasip2'

await registerCorePlugins()

const bindgen = createRuntimeBindgen({ devMode: true })
const result = await bindgen.instantiate<MyExports>(wasmBytes)
// or: bindgen.instantiateFromUrl('/my-component.wasm')

result.exports.myFunction()
result.destroy()
```

### Async imports (JSPI)

Suspending imports — `wasi:io/poll` (`pollable.block`), `wasi:http`, `wasi:sockets`, or any host-async interface — require [JSPI](https://github.com/WebAssembly/js-promise-integration) to actually block the guest. With the default sync transpilation, those imports cannot await the polyfill's async plugins.

```typescript
const bindgen = createRuntimeBindgen({
  devMode: true,
  jcoOptions: {
    asyncMode: 'jspi',
    asyncImports: ['wasi:io/poll@0.2.0#[method]pollable.block'],
    asyncExports: ['handle'],
  },
})

const result = await bindgen.instantiate<MyExports>(wasmBytes)
const value = await result.exports.handle(input) // promising export — await it
```

Requires `WebAssembly.Suspending` / `promising` (Chrome 137+, Node 22+).

`WasiInputStreamWrapper.blockingRead` (from `wasip2/plugins/cli`) falls
through to the impl's async `read()` when both sync paths (`tryRead`,
`waitForData`) yield nothing. Under JSPI the `wasi:io/streams` dispatch
awaits the returned `Promise<Uint8Array | StreamError>`, so the guest
suspends until data lands — useful for queue-backed persistent stdin.

### ComponentLoader

A lighter API when you don't need full bindgen control:

```typescript
import { createComponentLoader } from '@tegmentum/wasi-polyfill/wasip2/runtime'
import { randomPlugin } from '@tegmentum/wasi-polyfill/wasip2/plugins/random'

const loader = createComponentLoader({ devMode: true })
loader.getPolyfill().registerPlugin(randomPlugin)

const component = await loader.loadFromUrl('/my-component.wasm')
component.exports.myFunction()
component.destroy()
```

If jco is not installed, both loaders fall back to direct instantiation (works for pre-transpiled components or core modules).

---

## WASI Preview 1

Use `wasip1` when you need to run a classic WASI Preview 1 core `.wasm` (e.g. a Rust binary compiled to `wasm32-wasi`) rather than a Preview 2 component.

```typescript
import { createWasip1 } from '@tegmentum/wasi-polyfill/wasip1'

const wasi = createWasip1({
  args: ['myprog', '--verbose'],
  env: { HOME: '/home/user' },
  // preopens: { '/': filesystem },  // optional
})

const { instance } = await WebAssembly.instantiate(wasmBytes, {
  wasi_snapshot_preview1: wasi.getImports(),
})

wasi.initialize(instance)
;(instance.exports._start as () => void)()

if (wasi.exited) console.log('exit code:', wasi.exitCode)
```

Supported capabilities: `args`, `env`, stdio (custom streams), filesystem (preopens), clocks (monotonic / realtime / CPU), random, poll (with optional blocking).

### Node host filesystem

```typescript
import { createNodeFilesystem } from '@tegmentum/wasi-polyfill/wasip1/hostfs-node'

const fs = createNodeFilesystem('/path/to/sandbox-root')
const wasi = createWasip1({ preopens: { '/': fs } })
```

`createNodeFilesystem` is sandboxed to its root and guards against path-escape attacks.

---

## WASI Preview 3 (preview)

`wasip3` provides the async primitives — streams, futures, tasks — that Preview 3 will be built on. Treat the binary-level component ABI as **not yet implemented**; the current `instantiate()` is a stub that targets jco-transpiled output. The API is stable enough to write tests against.

```typescript
import {
  createWasip3,
  createStream,
  createFuture,
  delay,
} from '@tegmentum/wasi-polyfill/wasip3'

const wasi = createWasip3({
  args: ['myprog'],
  env: { LOG: 'debug' },
})

await wasi.execute(async (task) => {
  const { stream, writer } = createStream<Uint8Array>()
  writer.write(new TextEncoder().encode('hello'))
  writer.close()

  for await (const chunk of stream) {
    // …
  }
})
```

Re-exports from `canonical-abi/`: `createStream`, `streamFromAsyncIterable`, `streamFromReadable`, `collectStream`, `pipeStream`, `mergeStreams`, `createFuture`, `futureFromPromise`, `delay`, `resolvedFuture`, `raceFutures`, `allFutures`, `Task`, `SubtaskManager`.

---

## Browser Host Imports

The `browser/*` subpaths expose Web Platform APIs as host imports for WebAssembly components — useful when you're shipping a guest module that wants to draw to a canvas, hit `fetch`, listen for DOM events, or read the clipboard.

```typescript
import { getBrowserImports } from '@tegmentum/wasi-polyfill/browser'

const imports = getBrowserImports({
  capabilities: ['console', 'fetch', 'canvas', 'events'],
})

const instance = await WebAssembly.instantiate(wasmBytes, imports)
```

`getBrowserImports` is capability-gated. Each capability has a dedicated subpath if you want to load it individually or lazily.

| Capability | Subpath | What it exposes |
|------------|---------|-----------------|
| `console` | `/browser/console` | `console.log/debug/info/warn/error/trace`, `time`/`timeEnd` |
| `fetch` | `/browser/fetch` | `fetch()` plus request/response builders |
| `storage` | `/browser/storage` | `localStorage`, IndexedDB |
| `performance` | `/browser/performance` | `performance.now`, `mark`, `measure` |
| `dom` | `/browser/dom` | Node/element handles, query, traversal, mutation |
| `events` | `/browser/events` | Mouse, keyboard, touch, wheel, focus event subscriptions |
| `canvas` | `/browser/canvas` | 2D context, drawing primitives, images |
| `clipboard` | `/browser/clipboard` | Read/write clipboard text |
| `geolocation` | `/browser/geolocation` | `getCurrentPosition()` |
| `notifications` | `/browser/notifications` | Permission + show |
| `media` | `/browser/media` | `getUserMedia`, `MediaStream`, tracks |
| `service-worker` | `/browser/service-worker` | Register, get registrations |
| `worker` | `/browser/worker` | Spawn Web Workers, post/read messages |
| `websocket` | `/browser/websocket` | WebSocket connect/send/read/close |
| `broadcast-channel` | `/browser/broadcast-channel` | Cross-tab BroadcastChannel |
| `animation` | `/browser/animation` | `requestAnimationFrame`, `requestIdleCallback` |
| `history` | `/browser/history` | `pushState`, `replaceState`, navigation |
| `screen` | `/browser/screen` | Screen info, orientation lock |
| `fullscreen` | `/browser/fullscreen` | Request / exit fullscreen |
| `vibration` | `/browser/vibration` | Vibration API |
| `webgpu` | `/browser/webgpu` | Adapter, device, buffer, texture, pipeline, queue, canvas |
| `gc-enhanced` | `/browser/gc-enhanced` | DOM/Events optimised for the WasmGC proposal |
| (runtime) | `/browser/runtime` | Feature detection, user gesture, capability checks |
| (types) | `/browser/types` | Shared error/result/header/URL/event types |

Other helpers exported from `@tegmentum/wasi-polyfill/browser`:

- `getMinimalBrowserImports()` — just `types` + `runtime`
- `getCoreBrowserImports()` — console, fetch, storage, performance
- `getWebGPUImportsLazy()`, `getCanvasImportsLazy()`, `getGcEnhancedImportsLazy()` — dynamic imports for heavy modules

---

## WebSocket Gateway

For real TCP/UDP/DNS from a browser, tunnel socket operations through a WebSocket proxy server:

```typescript
import {
  wsGatewayTcpPlugin,
  wsGatewayUdpPlugin,
  wsGatewayDnsPlugin,
} from '@tegmentum/wasi-polyfill/wasip2/plugins/ws-gateway'

polyfill.registerPlugin(wsGatewayTcpPlugin, {
  gatewayUrl: 'wss://gateway.example.com/tunnel',
  authToken: 'your-auth-token',
})
polyfill.registerPlugin(wsGatewayUdpPlugin, { /* same gateway */ })
polyfill.registerPlugin(wsGatewayDnsPlugin, { /* same gateway */ })
```

---

## Build-Time Tooling

### Vite plugin

```typescript
// vite.config.ts
import { wasiPolyfillPlugin } from '@tegmentum/wasi-polyfill/wasip2/build'

export default {
  plugins: [
    wasiPolyfillPlugin({ generateManifests: true }),
  ],
}
```

### Component introspection

```typescript
import { introspect, generateManifest } from '@tegmentum/wasi-polyfill/wasip2/build'

const result = await introspect(wasmBytes)
result.imports         // required WASI interfaces
result.wasiSubsystems  // ['random', 'clocks', ...]

const manifest = await generateManifest(wasmBytes)
```

---

## Deterministic Testing

```typescript
import {
  createTestHarness,
  withTestHarness,
} from '@tegmentum/wasi-polyfill/wasip2/testing'

const harness = createTestHarness({
  seed: 42n,
  initialTime: new Date('2024-01-01T00:00:00Z'),
})

const { imports } = await harness.getImports([
  { package: 'wasi:random', name: 'random', version: '0.2.0' },
  { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
])

harness.advanceTimeSeconds(60)
harness.setWallTime(new Date('2024-06-15T12:00:00Z'))

const snapshot = harness.getSnapshot()
snapshot.monotonicTime  // 60_000_000_000n
snapshot.logs           // captured log entries

harness.destroy()
```

Bundle presets: `deterministicBundle`, `browserTestBundle`, `minimalBundle`.

---

## API Reference (wasip2 core)

```typescript
class Polyfill {
  getImports(required: WasiInterface[], options?): Promise<ImportResult>
  forInterfaces(interfaces: string[], options?): Promise<ImportResult>
  forManifest(manifest: ComponentManifest, options?): Promise<ImportResult>
  forComponent(bytes: ArrayBuffer, options?): Promise<ImportResult>
  registerPlugin(plugin: WasiPlugin, config?: PluginConfig): void
  isAllowed(iface: WasiInterface | string): boolean
  hasPlugin(iface: WasiInterface | string): boolean
  destroy(): void
}

interface ImportResult {
  imports: Record<string, Record<string, unknown>>
  loaded:  WasiInterface[]
  denied:  WasiInterface[]
  missing: WasiInterface[]
}
```

Manifest helpers: `parseManifest`, `loadManifest`, `loadManifestForComponent`, `createManifest`, `serializeManifest`, `validateManifest`, `validateExports`, `verifyComponentHash`.

Errors: `WasiError`, `WasiErrorCode`, `PluginNotFoundError`, `PolicyDeniedError`, `ImplementationNotFoundError`, `ManifestError`.

---

## Examples

See [`examples/`](./examples) for runnable demos:

- `basic-usage.ts` — dev/safe polyfills, string specs, WASM integration
- `advanced-usage.ts` — multi-plugin setup, security policies, lifecycle
- `filesystem-usage.ts` — memory, OPFS, IndexedDB, overlay filesystems
- `http-usage.ts` — HTTP client, server, test handler, service worker
- `storage-usage.ts` — keyvalue store, atomics, batch
- `logging-usage.ts` — console, buffer, NDJSON, OTLP sinks
- `config-usage.ts` — static, layered, remote, manifest-driven config
- `wasip1-usage.ts` — Preview 1 setup, custom I/O, virtual filesystem
- `wasip3-usage.ts` — streams, futures, async executor, P3 loader
- [`examples/browser/`](./examples/browser) — `basic-usage.ts`, `opfs-filesystem.ts`, `dns-over-https.ts`, `service-worker-http.ts`
- [`examples/fractal-demo/`](./examples/fractal-demo) — full WASM fractal renderer

---

## Development

```bash
npm install
npm run build         # tsup
npm test              # vitest
npm run test:e2e      # playwright
npm run typecheck     # tsc --noEmit
npm run lint
```

---

## Browser Compatibility

- Chrome / Edge 89+
- Firefox 89+
- Safari 15+

Feature-specific requirements:

- **OPFS filesystem** — Chrome 86+, Firefox 111+, Safari 15.2+
- **Service Worker HTTP** — all modern browsers
- **Web Workers (threads)** — all modern browsers
- **JSPI async imports** — Chrome 137+, Node 22+
- **WebGPU** — Chrome 113+, Firefox Nightly, Safari 18+

---

## The tegmentum wasm ecosystem

Seven repos, one concern each:

| Repo | Concern |
|------|---------|
| [`tegmentum/wasmos`](https://github.com/tegmentum/wasmos) | Portable `wasmos:runtime` WIT contract + native adapters (wasmtime, wamr, js) + example guests |
| [`tegmentum/wasm-cm`](https://github.com/tegmentum/wasm-cm) | Component Model implementation, portable, runs as wasm above a small core-engine ABI |
| [`tegmentum/wit-js-bindgen`](https://github.com/tegmentum/wit-js-bindgen) | WIT → JavaScript/TypeScript bindings generator, aligned with wasm-cm's canonical ABI |
| [`tegmentum/wasmos-host-js`](https://github.com/tegmentum/wasmos-host-js) | Shared JS host runtime — `host:js` implementation, cap system, wasi-plumbing |
| [`tegmentum/wasmbrowsers`](https://github.com/tegmentum/wasmbrowsers) | WasmOS on browsers — deploy target, Playwright cross-browser tests |
| [`tegmentum/wasmworkers`](https://github.com/tegmentum/wasmworkers) | WasmOS on Cloudflare Workers — deploy target, workerd tests |
| [`tegmentum/wasi-polyfill`](https://github.com/tegmentum/wasi-polyfill) | WASI 0.2 surface for JS runtimes (migrating to modular wasm components) |

## License

MIT
