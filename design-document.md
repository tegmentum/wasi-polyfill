# WASI 2 Polyfill – Comprehensive Design Document

**Project name (working):** `wasi2-polyfill`

**Audience:** Engineers implementing the polyfill (JS/TS + Wasm toolchain)

**Context:** KeyStone / WASI‑everywhere / browser + JS hosts

---

## 1. Purpose & Goals

The goal of `wasi2-polyfill` is to allow **WASI 2 (component‑model) WebAssembly components** to execute in environments that **do not natively implement WASI 2**, with an initial focus on **browser + JavaScript hosts**, and later extending to other JS runtimes (Deno, Bun, Node, Workers).

The polyfill **does not emulate an OS**. It provides **capability‑scoped, interface‑level implementations** of WASI 2 WIT worlds that map cleanly onto host‑provided APIs.

### Non‑Goals

* Full POSIX compatibility
* Transparent syscall emulation
* Supporting WASI 1 (except via adapters)

---

## 2. Design Principles

### 2.1 Interface‑First, Not Monolithic

* Each **WASI interface** (e.g. `wasi:filesystem`, `wasi:sockets`, `wasi:random`) is implemented as an **independent plugin/module**
* No global polyfill state
* No required "full install" of WASI

### 2.2 Incremental & Inspectable

* The polyfill must be **buildable incrementally**
* Interfaces can be added one at a time
* Components declare what they need; the polyfill loads only what is required

### 2.3 Async‑Native

* **Async is fundamental**, not an afterthought
* JS `Promise` ↔ WASI async lowering is explicit and uniform
* No attempt to hide async behind sync shims

### 2.4 Capability‑Driven

* Default behavior is **safe, sandboxed, minimal**
* Hosts explicitly grant broader access
* Multiple implementations per interface are supported

---

## 3. High‑Level Architecture

```
┌─────────────────────────────────────────────┐
│ Host (Browser / JS Runtime)                  │
│                                             │
│  ┌───────────────┐                          │
│  │ Polyfill Core │                          │
│  └──────┬────────┘                          │
│         │                                   │
│  ┌──────▼────────┐   ┌──────────────────┐  │
│  │ Interface     │   │ Interface        │  │
│  │ Plugin        │   │ Plugin           │  │
│  │ (filesystem)  │   │ (random)         │  │
│  └──────┬────────┘   └──────────────────┘  │
│         │                                   │
│  ┌──────▼────────┐                          │
│  │ Component     │                          │
│  │ (WASI 2)      │                          │
│  └───────────────┘                          │
└─────────────────────────────────────────────┘
```

---

## 4. Polyfill Core

The **Polyfill Core** is intentionally small.

### Responsibilities

1. Component inspection
2. Interface dependency resolution
3. Plugin lifecycle management
4. Async scheduling integration
5. Default configuration & overrides

### Explicitly Not Responsible For

* Implementing WASI interfaces
* Providing policy decisions
* Implementing storage/network logic

---

## 5. Component Inspection & Dependency Resolution

### 5.1 WIT‑Driven Detection

At load time, the polyfill:

1. Inspects the component’s **WIT metadata**
2. Extracts **imported worlds and interfaces**
3. Builds a **required‑interface set**

This allows:

* Loading **only** needed interfaces
* Tree‑shaking unused implementations
* Zero‑config defaults

### 5.2 Static vs Dynamic Loading

| Mode    | Description                        | Use case        |
| ------- | ---------------------------------- | --------------- |
| Static  | All interfaces known at build time | Bundlers, SSR   |
| Dynamic | Interfaces resolved at runtime     | Browser loaders |

---

## 6. Plugin Model

### 6.1 Plugin Structure

Each plugin corresponds to **one WIT interface**.

```
plugins/
  wasi-filesystem/
    index.ts
    impl-memory.ts
    impl-opfs.ts
    impl-deno.ts
    wit.lock
```

### 6.2 Plugin Contract

Each plugin exports:

```ts
interface WasiPlugin {
  witInterface: string
  implementations: Record<string, Implementation>
  defaultImplementation: string
}
```

### 6.3 Multiple Implementations

Example for `wasi:filesystem`:

| Implementation | Backend      |
| -------------- | ------------ |
| `memory`       | In‑memory FS |
| `opfs`         | Browser OPFS |
| `hostfs`       | Node/Deno FS |

Selection is driven by:

1. Host capabilities
2. User overrides
3. Safe defaults

---

## 7. Async Design

### 7.1 Core Rule

> **Every WASI 2 call is async‑capable.**

Even if the host backend is sync, the interface boundary remains async.

### 7.2 JS ↔ WASI Mapping

| WASI 2   | JS             |
| -------- | -------------- |
| async fn | Promise        |
| future   | Promise handle |
| poll     | await          |

### 7.3 No Sync Facade

The polyfill **does not attempt** to provide synchronous WASI APIs.

Benefits:

* Simpler implementation
* No deadlocks
* Correct browser semantics

---

## 8. Configuration Model

### 8.1 Zero‑Config Defaults

By default:

* Only required interfaces load
* Safe, in‑memory implementations used
* No filesystem or network access

### 8.2 Host Overrides

```ts
createPolyfill({
  filesystem: { implementation: "opfs" },
  sockets: { enabled: false }
})
```

### 8.3 Policy vs Mechanism

* Polyfill provides **mechanisms**
* Host provides **policy**

---

## 9. Interface‑Specific Design Notes

### 9.1 Filesystem

* Path‑based, capability‑scoped
* Directory handles, not raw paths
* Multiple backends supported

### 9.2 Random

* Browser: `crypto.getRandomValues`
* Node/Deno: native crypto

### 9.3 Clocks & Time

* Maps to `performance.now()` / `Date.now()`
* Monotonic vs wall‑clock explicitly separated

### 9.4 Sockets

* Browser: WebSockets / Fetch streams
* Node/Deno: native sockets
* Capability‑restricted endpoints

### 9.5 Threads

* Optional
* Browser: Web Workers
* Host decides availability

---

## 10. Bindgen & Host Interop

### 10.1 Bindgen Usage

* Component WIT → JS bindings
* Polyfill uses generated bindings
* No handwritten ABI glue

### 10.2 Dynamic Bindgen (Optional)

Future enhancement:

* Generate bindings at runtime when loading unknown components
* Cache bindings per WIT hash

---

## 11. Build & Packaging

### 11.1 Core Package

```
@keystone/wasi2-polyfill-core
```

### 11.2 Interface Packages

```
@keystone/wasi2-filesystem
@keystone/wasi2-random
@keystone/wasi2-sockets
```

Tree‑shakable, independently versioned.

---

## 12. Incremental Implementation Plan

### Phase 1 – Skeleton

* Polyfill core
* Interface detection
* Plugin loader

### Phase 2 – Minimal Interfaces

* random
* clocks
* environment

### Phase 3 – Filesystem

* In‑memory FS
* OPFS backend

### Phase 4 – Networking

* Fetch/WebSocket abstraction

### Phase 5 – Build Tooling ✓

* Component introspection (jco integration)
* Vite plugin
* esbuild plugin

### Phase 6 – Terminal Interfaces ✓

Browser‑compatible terminal I/O for CLI applications.

| Interface | Description |
| --- | --- |
| `wasi:cli/terminal‑input@0.2.0` | Terminal input stream |
| `wasi:cli/terminal‑output@0.2.0` | Terminal output stream |
| `wasi:cli/terminal‑stdin@0.2.0` | Get terminal for stdin |
| `wasi:cli/terminal‑stdout@0.2.0` | Get terminal for stdout |
| `wasi:cli/terminal‑stderr@0.2.0` | Get terminal for stderr |

**Implementation notes:**
* Browser: xterm.js integration or virtual terminal
* Node: native TTY support
* Default: no‑op (non‑terminal)

### Phase 7 – Sockets ✓

Full networking stack with capability restrictions.

| Interface | Description |
| --- | --- |
| `wasi:sockets/network@0.2.0` | Network handle resource |
| `wasi:sockets/instance‑network@0.2.0` | Get instance network |
| `wasi:sockets/ip‑name‑lookup@0.2.0` | DNS resolution |
| `wasi:sockets/tcp@0.2.0` | TCP socket operations |
| `wasi:sockets/tcp‑create‑socket@0.2.0` | Create TCP sockets |
| `wasi:sockets/udp@0.2.0` | UDP socket operations |
| `wasi:sockets/udp‑create‑socket@0.2.0` | Create UDP sockets |

**Implementation notes:**
* Browser: WebSocket tunneling or fetch‑based streams
* Browser limitations: No raw TCP/UDP; requires proxy server
* Node/Deno: Native socket support
* Policy: Allowlist of permitted hosts/ports

### Phase 8 – HTTP

HTTP client and server support.

| Interface | Description |
| --- | --- |
| `wasi:http/types@0.2.0` | HTTP types (request, response, headers) |
| `wasi:http/outgoing‑handler@0.2.0` | Make outgoing HTTP requests |
| `wasi:http/incoming‑handler@0.2.0` | Handle incoming HTTP requests |

**Implementation notes:**
* Browser: Fetch API backend
* `outgoing‑handler`: Maps directly to fetch()
* `incoming‑handler`: Service Worker integration
* CORS restrictions apply in browser context

### Phase 9 – Threads & Advanced Features

* Thread support via Web Workers
* Shared memory (`wasi:threads`)
* Component composition tooling

### Phase 10 – WebSocket Proxy Gateway

A WebSocket proxy enables **real TCP/UDP networking in browsers** by tunneling socket operations through a gateway server.

#### 10.1 Architecture Overview

**Guest (wasm component)** thinks it has a stream socket:
* `connect(url, protocols?, headers?) -> handle`
* `send(handle, bytes) -> u32 sent`
* `recv(handle, max) -> bytes`
* `close(handle)`

**Host (JS polyfill)** provides that API:
* Creates browser `WebSocket` to gateway
* Buffers inbound frames into byte queue
* Multiplexes multiple logical connections over single WS
* Provides polling/readiness for async operations

#### 10.2 Gateway Protocol (Binary Frames)

**Header layout (16 bytes, little‑endian):**

| Offset | Size | Field       | Type  |
| ------ | ---- | ----------- | ----- |
| 0      | 4    | magic       | `KSW1` |
| 4      | 1    | version     | u8    |
| 5      | 1    | type        | u8    |
| 6      | 1    | flags       | u8    |
| 7      | 1    | reserved    | u8    |
| 8      | 4    | stream_id   | u32   |
| 12     | 4    | payload_len | u32   |

**Message types:**
* `HELLO/HELLO_ACK` – Connection negotiation
* `OPEN/OPEN_OK/OPEN_ERR` – Stream creation
* `DATA/DATA_ACK` – Byte transfer with optional flow control
* `CLOSE/CLOSE_ACK` – Stream teardown
* `DNS_QUERY/DNS_RESULT/DNS_ERR` – Name resolution

#### 10.3 OPEN Payload Structure

| Offset | Size | Field     | Type  |
| ------ | ---- | --------- | ----- |
| 0      | 1    | proto     | u8 (1=tcp, 2=udp) |
| 1      | 1    | addr_kind | u8 (1=hostname, 2=ipv4, 3=ipv6) |
| 2      | 2    | port      | u16   |
| 4      | 2    | addr_len  | u16   |
| 6      | N    | addr      | bytes |
| 6+N    | 2    | token_len | u16   |
| 8+N    | M    | token     | bytes (auth) |

#### 10.4 WIT Interface for Gateway

```wit
package keystone:ws‑gateway@1.0.0;

flags features {
  flow_control, half_close, dns, udp, open_token,
}

variant open‑error {
  blocked, resolve_fail, conn_refused, timeout,
  unreachable, auth_required, auth_failed,
  too_many_streams, internal,
}

record open‑req {
  proto: proto,
  addr: addr,
  port: u16,
  token: option<list<u8>>,
}

variant event {
  open(u32, open‑req),
  open_ok(u32, open‑ok),
  open_err(u32, open‑error, string),
  data(u32, list<u8>, bool),
  close(u32, close‑req),
  dns_query(u32, dns‑req),
  dns_ok(u32, dns‑ok),
}

interface wire {
  send: func(e: event) -> result<(), proto‑error>;
  recv: func() -> result<option<event>, proto‑error>;
}
```

#### 10.5 Integration Patterns

**Pattern 1: Dedicated `websocket` capability**
* Guest imports `keystone:ws‑proxy/websocket`
* Clean, explicit, minimal

**Pattern 2: WASI sockets via tunnel**
* Guest imports `wasi:sockets/tcp`
* Host tunnels via WS gateway transparently
* Existing socket code works unchanged

#### 10.6 TCP Socket State Machine

```
NEW → CONNECTING → CONNECTED → CLOSING → CLOSED
         ↓              ↓
      CLOSED         CLOSED
     (on err)       (on err)
```

* `start_connect` → allocate stream_id, send OPEN
* `finish_connect` → wait for OPEN_OK/OPEN_ERR
* Connected streams expose `wasi:io/streams`

#### 10.7 Error Mapping (Gateway → WASI)

| Gateway Error | WASI Socket Error |
| ------------- | ----------------- |
| blocked       | access‑denied     |
| resolve_fail  | name‑unresolvable |
| conn_refused  | connection‑refused |
| timeout       | timeout           |
| unreachable   | host‑unreachable  |
| auth_failed   | not‑authorized    |

#### 10.8 Flow Control

**Minimum viable:** Per‑stream rx buffer cap (1–8MB), close on overflow

**Full implementation:** `DATA_ACK` credit‑based flow control
* Gateway only sends DATA when credit available
* Browser increases credit as guest drains rx queue

#### 10.9 Security Requirements

* **URL/host allowlist** – Only connect to approved endpoints
* **Rate limits** – Per origin/token
* **Max connections** – Per WS session
* **Auth tokens** – Via subprotocol or query param (browser can't set headers)
* **Binary‑only mode** – Reject text frames

#### 10.10 Implementation Components

**Browser side:**
* `WsTunnelManager` – Owns WebSocket, multiplexing, conn table
* `ByteQueue` – Per‑connection rx FIFO
* `TcpAdapter` – Maps `wasi:sockets/tcp` to tunnel events

**Gateway server side:**
* Frame decoder/encoder
* Connection table (`conn_id → net.Socket`)
* ACL/policy enforcement
* Optional: DNS forwarding

#### 10.11 Deliverables (Incremental)

1. Gateway: OPEN/DATA/CLOSE for TCP
2. Browser tunnel manager with rx FIFO + poll
3. `wasi:io/streams` integration for connections
4. `wasi:sockets/tcp` client adapter
5. `wasi:sockets/ip‑name‑lookup` via gateway DNS
6. Flow control (DATA_ACK)
7. Optional: UDP support, server sockets

---

## 13. Testing Strategy

* Per‑interface test suites
* Mock host backends
* Golden WIT behavior tests
* Browser + Node CI

---

## 14. Open Questions (Non‑Blocking)

* Dynamic bindgen performance
* Cross‑component interface reuse
* WASI 1 adapters

---

## 15. Summary

This design intentionally:

* Breaks the polyfill into **small, composable pieces**
* Treats **WASI 2 interfaces as plugins**
* Embraces **async and capability‑based design**
* Enables **incremental implementation and adoption**

It should be straightforward for an implementation team to pick a single interface plugin and build it end‑to‑end without needing to understand the entire system.

---

## 16. Alternative Provider Architecture

### 16.1 Goal and Non‑Goals

#### Goal

Turn the polyfill into a **provider‑based runtime** where each WASI interface can be backed by multiple implementations (browser‑native, node‑native, proxy/remote, deterministic‑test, etc.) and selected via a single consistent mechanism.

#### Non‑Goals (Keep Scope Bounded)

* Don't add new WASI interfaces
* Don't implement every provider on day 1; ship a **small canonical set** and keep the architecture open

### 16.2 Provider Host Internal API

Add an internal layer on top of the existing WIT bindings:

* **`Runtime`** (top‑level): owns provider registry + policy + lifecycle
* **`ProviderRegistry`**: interface → active provider instance
* **`Policy`**: shared capability rules used by multiple providers
* **`Resources`**: typed tables/handles shared across providers (streams, sockets, fs descriptors, pollables)

**Deliverable:** `runtime/` module with:
* `runtime.ts`
* `registry.ts`
* `policy.ts`
* `resources.ts` (handle tables)
* `errors.ts` (error normalization)

### 16.3 Standard Provider Contract

Every provider implements a common shape:

```typescript
interface Provider {
  /** Stable ID for config + debugging */
  id(): string

  /** What this provider supports */
  capabilities(): Capabilities

  /** Initialize the provider */
  init(ctx: ProviderContext): void | Promise<void>

  /** Cleanup resources */
  close(): void | Promise<void>

  // Interface-specific methods follow
}
```

**ProviderContext includes:**
* `policy` (allow/deny, quotas)
* `logger`
* `clock` (for time + deterministic test harnesses)
* `random` (for deterministic injection)
* `fetch` or `httpClient` hooks
* `env` (host environment data, filtered)
* `trace`/`metrics` sink

**Deliverable:** `providers/base.ts` defining base interfaces + shared utils

### 16.4 Provider Selection and Composition

#### Selection Algorithm

At startup:
1. Load config: `bundle` + per‑interface overrides
2. For each interface:
   * Pick provider by explicit config
   * Else pick "best available" by environment detection
   * Else fall back to proxy provider
   * Else fall back to "unsupported provider" (returns `not-supported`)

**Deliverable:** `registry.selectProvider(interfaceName): Provider`

#### Wrappers (Composition)

Support wrapping providers for:
* Auditing/logging
* Policy enforcement
* Metrics/tracing
* Deterministic recording/replay

Pattern:
```typescript
provider = wrap(provider, AuditWrapper)
provider = wrap(provider, MetricsWrapper)
provider = wrap(provider, PolicyWrapper)
```

**Deliverable:** `providers/wrappers/*` with at least `audit`, `metrics`, `replay`

---

## 17. Provider Matrix and Bundle Defaults

### 17.1 Provider IDs (Canonical)

Stable string IDs for configuration:

**Random:**
* `random.crypto.web`
* `random.crypto.node`
* `random.insecure.math`
* `random.insecure.seeded`
* `random.replay`

**Clocks:**
* `clocks.monotonic.real`
* `clocks.wall.real`
* `clocks.monotonic.virtual`
* `clocks.wall.fixed`

**IO:**
* `io.streams.webstreams`
* `io.streams.node`
* `io.streams.ringbuffer`
* `io.streams.messageport`
* `io.poll.promise`
* `io.poll.scheduler`

**CLI:**
* `cli.env.node`
* `cli.env.browser-config`
* `cli.stdio.node`
* `cli.stdio.console`
* `cli.stdio.capture`
* `cli.exit.throw`
* `cli.terminal.dumb`
* `cli.terminal.ansi-lite`

**Filesystem:**
* `fs.mem`
* `fs.opfs`
* `fs.idb`
* `fs.node`
* `fs.overlay`
* `fs.remote`
* `fs.preopens.static`
* `fs.preopens.manifest`
* `fs.preopens.user-consent`

**Sockets:**
* `net.node`
* `net.disabled`
* `dns.node`
* `dns.doh`
* `dns.static`
* `tcp.node`
* `tcp.ws-tunnel`
* `tcp.simulated`
* `udp.node`
* `udp.proxy-datagram`
* `udp.simulated`

**HTTP:**
* `http.client.fetch`
* `http.client.undici`
* `http.client.proxy`
* `http.client.replay`
* `http.server.node`
* `http.server.serviceworker`
* `http.server.inprocess`

**Config:** (stable, missing from current implementation)
* `config.layered` — layered config (defaults → bundle → host → per‑component override)
* `config.env-bridge` — fallback mapping from env vars
* `config.manifest` — config read from embedding manifest (JSON/TOML)
* `config.remote` — fetch config from proxy/control‑plane
* `config.fixed` — deterministic fixture set
* `config.denied` — always "not present / not permitted"

**Logging:** (draft/proposal)
* `logging.console` — browser console
* `logging.stderr` — maps to existing stderr provider
* `logging.ndjson` — structured JSON line sink
* `logging.otlp` — export to OpenTelemetry collector via proxy
* `logging.ringbuffer` — queryable in‑memory buffer for debugging
* `logging.denied` — no‑op or policy error

**KeyValue:** (draft/proposal)
* `kv.mem` — in‑memory store
* `kv.idb` — browser IndexedDB persistence
* `kv.sqlite` / `kv.libsql` — embedded store
* `kv.redis` — remote via proxy
* `kv.http` — REST‑ish backing service
* `kv.replay` — record/replay for deterministic tests

**BlobStore:** (draft/proposal)
* `blob.mem` — in‑memory for tests
* `blob.opfs` — browser object store
* `blob.fs` — maps to filesystem paths within preopen
* `blob.s3` — remote via proxy
* `blob.azure` / `blob.gcs` — remote cloud providers
* `blob.http` — generic object service
* `blob.replay` — record/replay

### 17.2 Bundle Definitions

Each bundle is a config preset stored in `bundles/*.json`.

#### `browser-default`

| Interface | Provider |
|-----------|----------|
| `wasi:random/random` | `random.crypto.web` |
| `wasi:random/insecure` | `random.insecure.math` |
| `wasi:random/insecure-seed` | `random.insecure.seeded` |
| `monotonic-clock` | `clocks.monotonic.real` |
| `wall-clock` | `clocks.wall.real` |
| `io/streams` | `io.streams.webstreams` |
| `io/poll` | `io.poll.promise` |
| `cli/environment` | `cli.env.browser-config` |
| `cli/stdin/out/err` | `cli.stdio.console` |
| `cli/exit` | `cli.exit.throw` |
| `cli/terminal-*` | `cli.terminal.ansi-lite` (fallback to dumb) |
| `filesystem/types` | `fs.opfs` → `fs.idb` → `fs.mem` |
| `filesystem/preopens` | `fs.preopens.user-consent` → `fs.preopens.manifest` |
| `sockets/network` | `net.disabled` (unless proxy enabled) |
| `sockets/dns` | `dns.doh` |
| `sockets/tcp` | `tcp.ws-tunnel` (if proxy enabled, else unsupported) |
| `sockets/udp` | `udp.proxy-datagram` (optional) |
| `http/outgoing` | `http.client.fetch` (or `http.client.proxy` if policy says) |
| `http/incoming` | `http.server.serviceworker` (if registered) else `http.server.inprocess` |
| `config/*` | `config.layered` (layers: `config.manifest` → `config.env-bridge` → `config.denied`) |
| `logging/*` | `logging.console` (or `logging.stderr`) |
| `keyvalue/*` | `kv.idb` → `kv.mem` |
| `blobstore/*` | `blob.opfs` → `blob.mem` |

#### `node-default`

| Interface | Provider |
|-----------|----------|
| `wasi:random/random` | `random.crypto.node` |
| `wasi:random/insecure` | `random.insecure.math` |
| `monotonic-clock` | `clocks.monotonic.real` |
| `wall-clock` | `clocks.wall.real` |
| `io/streams` | `io.streams.node` |
| `io/poll` | `io.poll.scheduler` |
| `cli/environment` | `cli.env.node` |
| `cli/stdio` | `cli.stdio.node` |
| `cli/exit` | `cli.exit.throw` (host decides whether to process.exit) |
| `cli/terminal` | `cli.terminal.ansi-lite` |
| `filesystem/*` | `fs.node` |
| `filesystem/preopens` | `fs.preopens.manifest` |
| `sockets/*` | `net.node`, `dns.node`, `tcp.node`, `udp.node` |
| `http/outgoing` | `http.client.undici` |
| `http/incoming` | `http.server.node` |
| `config/*` | `config.layered` (layers: `config.manifest` → `config.env-bridge` → `config.remote`) |
| `logging/*` | `logging.stderr` + optional `logging.ndjson` |
| `keyvalue/*` | `kv.sqlite` (or `kv.mem` for zero deps) |
| `blobstore/*` | `blob.fs` (or `blob.s3` via proxy) |

#### `deterministic-test`

| Interface | Provider |
|-----------|----------|
| `wasi:random/random` | `random.replay` (or seeded) |
| `wasi:random/insecure` | `random.insecure.seeded` |
| `clocks/*` | `clocks.monotonic.virtual` + `clocks.wall.fixed` |
| `io/streams` | `io.streams.ringbuffer` |
| `io/poll` | `io.poll.scheduler` (deterministic queue) |
| `cli/environment` | `cli.env.browser-config` (fixture) |
| `cli/stdio` | `cli.stdio.capture` |
| `cli/exit` | `cli.exit.throw` |
| `cli/terminal` | `cli.terminal.dumb` |
| `filesystem/*` | `fs.mem` (optionally `fs.overlay` with readonly image) |
| `filesystem/preopens` | `fs.preopens.static` |
| `sockets/*` | `tcp.simulated`, `udp.simulated`, `dns.static` |
| `http/outgoing` | `http.client.replay` |
| `http/incoming` | `http.server.inprocess` |
| `config/*` | `config.fixed` (or `config.layered` with only fixed layers) |
| `logging/*` | `logging.ringbuffer` (snapshotable) |
| `keyvalue/*` | `kv.mem` or `kv.replay` |
| `blobstore/*` | `blob.mem` or `blob.replay` |

#### `proxy-secure`

* Local capabilities minimal
* Prefer proxy for `fs`, `tcp`, `udp`, `dns`, `http`
* Enforce strict allowlists + quotas

| Interface | Provider |
|-----------|----------|
| `config/*` | `config.layered` with `config.remote` as primary + aggressive allowlisting/redaction |
| `logging/*` | `logging.otlp` (export via proxy) |
| `keyvalue/*` | `kv.redis` or `kv.http` via proxy |
| `blobstore/*` | `blob.s3` via proxy |

---

## 18. Implementation Epics

### Epic 1 — Runtime Foundation (Registry, Policy, Resources)

**E1‑T1: Provider base types**
* Implement `Provider`, `ProviderContext`, `Capabilities`, `Init/Close`
* Acceptance: Every provider compiles against base interfaces; `init()`/`close()` called exactly once per lifecycle

**E1‑T2: ProviderRegistry + selection**
* Config parsing: bundle + overrides
* Selection algo: explicit → best‑available → proxy → unsupported
* Acceptance: Given config fixtures, selected provider IDs match expected

**E1‑T3: Policy module**
* Policy schema: allowlist/denylist, quotas, redaction, feature toggles
* Acceptance: Policy enforceable in FS + sockets + HTTP via shared helpers

**E1‑T4: Resource tables**
* Unified handle tables for streams, pollables, fs descriptors, sockets, http bodies
* Acceptance: Handles stable, double‑close safe, use‑after‑close yields correct WASI error

### Epic 2 — Observability + Wrappers

**E2‑T1: Audit wrapper**
* Logs method calls + args metadata (redacted) + durations
* Acceptance: Can wrap any provider; redaction rules enforced

**E2‑T2: Metrics wrapper**
* Counters + histograms (ops, bytes, latency)
* Acceptance: Exposes metrics snapshot API usable in tests

**E2‑T3: Replay/record framework**
* Define cassette format v1 (NDJSON or binary framed)
* Acceptance: Record/replay works for at least random + http

### Epic 3 — Random Providers

**E3‑T1: `random.crypto.web`**
* Acceptance: Correct byte lengths; throws correct WASI error if crypto unavailable

**E3‑T2: `random.crypto.node`**
* Acceptance: Uses node crypto; behaves same as web in contract tests

**E3‑T3: `random.insecure.seeded` + `insecure-seed`**
* Acceptance: Same seed ⇒ same sequence (golden vectors)

**E3‑T4: `random.replay`**
* Acceptance: Replay matches exact bytes; exhaustion behavior documented + tested

### Epic 4 — Clock Providers

**E4‑T1: Real clocks**
* Acceptance: Monotonic non‑decreasing; wall clock returns plausible timestamps

**E4‑T2: Virtual monotonic + fixed wall**
* Acceptance: Time only advances when host calls `advance()`; fixed wall is constant

**E4‑T3: Clock contract tests**
* Acceptance: Shared test suite runs against all clock providers

### Epic 5 — IO Streams + Poll

**E5‑T1: Core stream abstraction**
* Define `InputStream/OutputStream` with backpressure semantics
* Acceptance: Passes generic stream contract tests (read/write/close/flush)

**E5‑T2: WebStreams provider**
* Acceptance: Large payload streaming; backpressure respected

**E5‑T3: Node streams provider**
* Acceptance: Interoperates with process stdio provider

**E5‑T4: Ring‑buffer provider**
* Acceptance: Deterministic scheduling; bounded buffer triggers correct blocking/ready

**E5‑T5: Poll provider(s)**
* Promise poll: minimal
* Scheduler poll: deterministic fairness
* Acceptance: Poll contract tests (ready order, cancellation, close)

### Epic 6 — CLI Providers

**E6‑T1: Exit semantics**
* Implement `WasiExit(code)` thrown and caught by host
* Acceptance: Exit never kills process unless embedding host opts in

**E6‑T2: Node env + stdio**
* Acceptance: Env filtered by policy; stdio wiring correct; handles EOF

**E6‑T3: Browser‑config env + console stdio**
* Acceptance: Args/env from injected config; stdin queue works; stdout/stderr go to sink

**E6‑T4: Capture stdio**
* Acceptance: Captured output matches golden snapshots exactly

**E6‑T5: Terminal**
* Dumb + ansi‑lite
* Acceptance: Reports width/height; resize event propagation (if supported)

### Epic 7 — Filesystem (Backends + Mounts + Preopens)

**E7‑T1: Path sandbox + normalization**
* Acceptance: `..` traversal blocked; unicode/percent edge cases documented + tested

**E7‑T2: MemFS backend**
* Acceptance: Supports open/read/write/seek/dir ops used by test suite

**E7‑T3: NodeFS backend**
* Acceptance: Strict preopen root; no escape; symlink policy enforced

**E7‑T4: OPFS backend**
* Acceptance: Persistence across runs; concurrency behavior documented

**E7‑T5: IDB backend fallback**
* Acceptance: Works when OPFS not available; passes minimal persistence tests

**E7‑T6: Overlay backend**
* Acceptance: Lower readonly + upper writable semantics; copy‑up on write

**E7‑T7: Remote FS backend**
* Depends on proxy protocol (Epic 10)
* Acceptance: Roundtrip tests via local proxy service

**E7‑T8: Preopens providers**
* static / manifest / user‑consent
* Acceptance: Preopen tables match config; permissions honored

### Epic 8 — Sockets (Node, Proxy, Simulated, DNS)

**E8‑T1: Socket model + poll integration**
* Acceptance: Socket read/write readiness exposed via pollables

**E8‑T2: Node net provider (tcp/udp/dns)**
* Acceptance: Basic connect/send/recv tests

**E8‑T3: DoH DNS provider**
* Acceptance: Resolves known names; caching respects TTL policy (or documented)

**E8‑T4: WS tunnel TCP provider**
* Depends on proxy protocol (Epic 10)
* Acceptance: Echo server integration via proxy

**E8‑T5: UDP proxy datagram (optional)**
* Acceptance: Send/recv via proxy; size limits enforced

**E8‑T6: Simulated TCP/UDP**
* Acceptance: Deterministic loss/delay/reorder knobs; reproducible tests

### Epic 9 — HTTP (Client + Server)

**E9‑T1: HTTP body streaming bridge**
* Bridge http bodies to/from `wasi:io/streams`
* Acceptance: Streaming upload/download with backpressure tests

**E9‑T2: Fetch client provider**
* Acceptance: Headers normalized; forbidden headers handled (documented); abort maps to WASI errors

**E9‑T3: Undici client provider**
* Acceptance: Parity contract with fetch provider (where features overlap)

**E9‑T4: Proxy HTTP client provider**
* Depends on proxy protocol (Epic 10)
* Acceptance: Policy‑enforced egress + tracing headers

**E9‑T5: Replay HTTP client provider**
* Acceptance: Cassette replay produces exact responses

**E9‑T6: Node HTTP server provider**
* Acceptance: Can accept request → call component incoming handler → respond

**E9‑T7: Service worker incoming provider**
* Acceptance: Fetch event → component handler → response; local demo app

**E9‑T8: In‑process incoming provider**
* Acceptance: Test harness can inject requests deterministically

### Epic 10 — Proxy Protocol + Reference Proxy

**E10‑T1: Protocol spec v1**
* Methods: fs, dns, tcp, udp (optional), http
* Framing: `request_id`, `interface`, `method`, `payload`, `error`
* Acceptance: Spec doc + example frames + versioning rules

**E10‑T2: Proxy server reference implementation**
* Minimal services: http + tcp + fs
* Acceptance: Integration tests pass locally in CI

**E10‑T3: Proxy client mux**
* Shared transport + per‑interface adapters
* Acceptance: Used by remote providers (fs.remote, tcp.ws‑tunnel, http.client.proxy)

### Epic 11 — Deterministic Test Harness + CI Matrix

**E11‑T1: Contract test suites**
* Create contract tests per subsystem: random, clocks, streams, poll, fs, sockets, http, cli
* Acceptance: Same test suite runs across providers via parametrization

**E11‑T2: Bundle runner**
* `run(component, bundle, overrides?)`
* Acceptance: Runs same component under `browser-default`, `node-default`, `deterministic-test`

**E11‑T3: Golden snapshot format**
* stdout/stderr snapshots
* FS op trace snapshots (optional)
* HTTP cassette snapshots
* Acceptance: Record/replay produces exact matches

**E11‑T4: CI**
* Node CI job: node‑default + deterministic‑test
* Browser CI job (playwright): browser‑default
* Acceptance: Green on PR with consistent timings

### Epic 12 — Config Providers (stable, priority)

`wasi:config` is the only missing package from the stable WASI 0.2.x set.

**E12‑T1: `config.layered` core**
* Supports multiple sources, precedence rules, caching
* Enforces policy: allowlist/denylist + redaction
* Acceptance: Layered config resolves correctly; policy blocks denied keys

**E12‑T2: `config.manifest`**
* Parse host‑provided JSON/TOML + map into layered source
* Acceptance: Manifest values available via config interface

**E12‑T3: `config.env-bridge`**
* Explicit mapping (no "read all env vars" by default)
* Acceptance: Only mapped env vars exposed; others denied

**E12‑T4: `config.fixed`**
* Deterministic fixtures, golden snapshots
* Acceptance: Same config across runs; snapshot matches

**E12‑T5: `config.remote`**
* Remote lookups via existing proxy transport (same mux as fs/http/sockets)
* Acceptance: Config fetched from remote; caching respects TTL

**E12‑T6: Config contract tests**
* "present/missing/denied", type conversion rules, redaction checks
* Acceptance: All providers pass contract tests

**Behavior contract for `wasi:config`:**
* Key namespace convention: `service.name`, `feature.flag.foo`, `db.primary.url`
* Type handling: typed getters where possible; canonical strings otherwise
* Absence vs denial: "Not found" distinct from "policy denied"
* Secrets stance: sensitive values opaque by default

### Epic 13 — Logging Providers (draft/proposal)

`wasi:logging` provides structured logging beyond stdout/stderr.

**E13‑T1: Logging core types + level filtering**
* Support log levels: trace, debug, info, warn, error
* Acceptance: Level filtering works correctly

**E13‑T2: `logging.console` + `logging.stderr` sinks**
* Browser console integration; stderr mapping
* Acceptance: Logs appear in correct sink with level formatting

**E13‑T3: `logging.ndjson`**
* Structured JSON line sink
* Acceptance: Valid NDJSON output with timestamp, level, message, context

**E13‑T4: `logging.ringbuffer`**
* Queryable in‑memory buffer for debugging
* Acceptance: Buffer queryable; supports export for snapshots

**E13‑T5: `logging.otlp` (optional)**
* Export to OpenTelemetry collector via proxy
* Acceptance: Logs exported in OTLP format

**E13‑T6: Logging contract tests**
* Ordering, truncation limits, redaction
* Acceptance: All providers pass contract tests

### Epic 14 — KeyValue Providers (draft/proposal)

`wasi:keyvalue` provides portable key‑value store interface.

**E14‑T1: Store resource model + error normalization**
* Define store handle, key/value types, error codes
* Acceptance: Consistent error handling across providers

**E14‑T2: `kv.mem` provider**
* In‑memory store
* Acceptance: CRUD operations work; data isolated per store instance

**E14‑T3: `kv.idb` provider**
* Browser IndexedDB persistence
* Acceptance: Data persists across page reloads

**E14‑T4: `kv.sqlite` / `kv.libsql` provider (optional)**
* Embedded store for Node
* Acceptance: Data persists; supports concurrent access

**E14‑T5: `kv.redis` / `kv.http` remote provider**
* Remote via proxy transport
* Acceptance: Roundtrip via proxy; handles network errors

**E14‑T6: `kv.replay` provider**
* Record/replay for deterministic tests
* Acceptance: Replay produces exact responses

**E14‑T7: KeyValue contract tests**
* Atomicity semantics, batch behavior, iteration
* Acceptance: All providers pass contract tests

### Epic 15 — BlobStore Providers (draft/proposal)

`wasi:blobstore` provides object/blob storage abstraction.

**E15‑T1: Container/object model + streaming integration**
* Bridge blob bodies to/from `wasi:io/streams`
* Acceptance: Streaming upload/download works with backpressure

**E15‑T2: `blob.mem` provider**
* In‑memory for tests
* Acceptance: CRUD + listing operations work

**E15‑T3: `blob.opfs` provider**
* Browser object store
* Acceptance: Data persists; handles large blobs

**E15‑T4: `blob.fs` provider**
* Maps to filesystem paths within preopen
* Acceptance: Capability‑scoped; no path escape

**E15‑T5: `blob.s3` / `blob.http` remote provider**
* Remote via proxy transport
* Acceptance: Roundtrip via proxy; supports range reads

**E15‑T6: `blob.replay` provider**
* Record/replay for deterministic tests
* Acceptance: Replay produces exact responses

**E15‑T7: BlobStore contract tests**
* Range reads, streaming, listing semantics, metadata
* Acceptance: All providers pass contract tests

---

## 19. Implementation Milestones

### Milestone 1 — Architecture + Bundles

* ProviderRegistry + ResourceTable + Policy
* `browser-default`, `node-default`, `deterministic-test`
* Wrap infrastructure (audit + metrics)

### Milestone 2 — Deterministic Core

* Seeded random, virtual clocks
* Capture CLI stdio
* MemFS + mount manager
* Basic replay format (stdout + fs initially)

### Milestone 3 — Realistic Browser Networking

* Fetch HTTP outgoing
* DoH DNS
* WS tunnel TCP (and optionally UDP)
* Proxy integration tests

### Milestone 4 — Filesystem Persistence

* OPFS backend + IDB fallback
* Overlay/readonly images
* Robust path sandbox + symlink policy

### Milestone 5 — Incoming HTTP Story

* Node server provider
* Service worker provider
* In‑process testing provider

### Milestone 6 — Config (Stable Priority)

* `wasi:config` implementation (the only missing stable WASI 0.2.x package)
* Layered config with policy enforcement
* Manifest + env‑bridge + fixed providers

### Milestone 7 — Extended Interfaces (Draft/Proposal)

* `wasi:logging` providers
* `wasi:keyvalue` providers
* `wasi:blobstore` providers

---

## 20. Recommended Implementation Order

For maximum leverage fastest:

1. **Epic 1 + Epic 2** (registry/policy/resources + audit/metrics)
2. **deterministic‑test bundle core**: seeded random + virtual clocks + ringbuffer streams + capture stdio + memfs
3. **node‑default parity**: node streams + node fs + undici http + node sockets
4. **browser‑default essentials**: fetch http + opfs/idb + webstreams + doh dns
5. **proxy‑secure + ws tunnel tcp** (to unlock browser "real networking")
6. **Epic 12: `wasi:config`** (priority: complete the stable WASI 0.2.x package set)
7. **Epic 13: `wasi:logging`** (makes everything else easier to debug/operate)
8. **Epic 14: `wasi:keyvalue`** (pairs perfectly with provider model, broadly useful)
9. **Epic 15: `wasi:blobstore`** (completes cloud‑native storage story)

---

## 21. Behavior Contracts (Spec Documents)

Create short "behavior contracts" for each interface where environments differ:

* **FS:** rename atomicity, symlinks, timestamps precision
* **Sockets:** connect timeouts, UDP max size, DNS caching
* **HTTP:** forbidden headers, streaming availability, redirect policy
* **CLI:** stdout/stderr ordering guarantees, exit semantics
* **Config:** key namespace convention, type handling, absence vs denial, secrets stance
* **Logging:** level semantics, structured fields, truncation, redaction
* **KeyValue:** atomicity guarantees, batch semantics, iteration order, TTL support
* **BlobStore:** range read semantics, streaming behavior, metadata fields, listing pagination

**Deliverable:** `docs/behavior/*.md` (one per subsystem)

---

## 22. Interface Coverage Summary

### Stable WASI 0.2.x Packages

| Package | Status | Notes |
|---------|--------|-------|
| `wasi:cli` | ✓ Implemented | environment, stdin/stdout/stderr, exit, terminal |
| `wasi:clocks` | ✓ Implemented | monotonic‑clock, wall‑clock |
| `wasi:filesystem` | ✓ Implemented | types, preopens |
| `wasi:http` | ✓ Implemented | types, outgoing‑handler, incoming‑handler |
| `wasi:io` | ✓ Implemented | poll, streams, error |
| `wasi:random` | ✓ Implemented | random, insecure, insecure‑seed |
| `wasi:sockets` | ✓ Implemented | network, tcp, udp, ip‑name‑lookup |
| `wasi:config` | ✓ Implemented | Epic 12 — runtime, remote, layered, manifest, env‑bridge, fixed |

### Draft/Proposal Interfaces

| Interface | Status | Notes |
|-----------|--------|-------|
| `wasi:logging` | ✓ Implemented | Epic 13 — console, stderr, ndjson, ringbuffer, otlp |
| `wasi:keyvalue` | ✓ Implemented | Epic 14 — memory, idb, replay |
| `wasi:blobstore` | ✓ Implemented | Epic 15 — memory, opfs, replay |

### Extended Capabilities

| Capability | Status | Notes |
|------------|--------|-------|
| WebSocket Gateway | ✓ Implemented | TCP/UDP tunneling for browsers |
| Thread Support | ✓ Implemented | Web Worker‑based threading |

