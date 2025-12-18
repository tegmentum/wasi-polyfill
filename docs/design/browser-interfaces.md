# Design Document: `browser:*` Host Interfaces (with wasmGC-aware implementation)

## 1. Overview

We want a set of **capability-scoped** `browser:*` interfaces that WebAssembly components can import to access browser functionality (DOM, canvas, storage, networking, etc.) in a way that is:

* **Portable** across browsers (and ideally polyfillable in non-browser hosts).
* **Secure-by-default** (no ambient authority; explicit capability grants).
* **Performant** (minimize copies, avoid excessive JS↔Wasm marshaling).
* **Ergonomic** for component authors (typed APIs, async support, consistent error model).
* **Forward-compatible** with **wasmGC** for better object interop and lower overhead.

This document defines an architecture, cross-cutting conventions, a proposed interface breakdown, and an implementation plan with an explicit wasmGC "fast path" strategy.

---

## 2. Goals

### Functional goals

* Provide `browser:*` interfaces for:

  * `browser:console`
  * `browser:dom`
  * `browser:events`
  * `browser:canvas`
  * `browser:storage`
  * `browser:fetch` / `browser:network`
  * `browser:clipboard`
  * `browser:geolocation`
  * `browser:media` (camera/mic, streams)
  * `browser:audio`
  * `browser:video`
  * `browser:notifications`
  * `browser:service-worker`
  * `browser:performance`

### Non-functional goals

* **Safety**: respect user permissions, secure context requirements, user gesture gating.
* **Capability model**: imports reflect what is allowed; deny-by-default.
* **Async model**: natural async calls that integrate with the browser event loop.
* **Streaming**: request/response bodies and media should support streaming.
* **Testability**: deterministic integration tests in real browsers.

### wasmGC goals

* Allow a **baseline** implementation that works without wasmGC.
* Add an **optional wasmGC-enabled path** that:

  * Reduces handle-table churn and manual lifetime management.
  * Enables holding references to host objects (via `externref`) *inside wasm-managed GC objects* where appropriate.
  * Supports "zero/low-copy" transfer patterns for large buffers and high-frequency calls.

---

## 3. Non-goals (explicitly out of scope for v0)

* Exposing the **entire** DOM/Web platform surface 1:1.
* A general "eval" / arbitrary JS reflection interface by default.
* Perfect parity across all browsers (we will define feature detection + `not-supported` errors).
* Full WebGL/WebGPU coverage in the first iteration (we can start with Canvas2D; add GPU later).

---

## 4. Terminology & Constraints

* **Component**: a Wasm component importing `browser:*`.
* **Host**: JS (or another embedding) providing implementations.
* **Resource**: a typed handle to a host-managed object (Component Model "resource" type).
* **wasmGC**: WebAssembly GC types (`struct`, `array`, typed refs), enabling Wasm-managed objects that can hold references like `externref`.

Constraints to respect:

* Some APIs are **main-thread only** (DOM, many UI APIs).
* Some require **secure context** (HTTPS) and/or **user gesture** (clipboard, notifications).
* Some require **permissions** (geo, camera/mic, notifications).
* Some APIs behave differently in iframes / cross-origin contexts.

---

## 5. High-level architecture

### 5.1 Package layout

Proposed packages (versioned independently, but kept in lockstep initially):

* `browser:types@0.1.x` – shared types (errors, urls, headers, byte buffers, time).
* `browser:runtime@0.1.x` – host capability discovery (secure context? main thread? features?).
* Functional packages:

  * `browser:console`
  * `browser:dom`
  * `browser:events`
  * `browser:canvas`
  * `browser:storage`
  * `browser:fetch`
  * `browser:network` (websocket, sse)
  * `browser:clipboard`
  * `browser:geolocation`
  * `browser:media`
  * `browser:audio`
  * `browser:video`
  * `browser:notifications`
  * `browser:service-worker`
  * `browser:performance`
  * `browser:permissions` (optional but recommended)

### 5.2 Host implementation layers

**Layer A — API Surface (WIT / interface definitions)**

* Defines stable function signatures, resources, and error types.

**Layer B — Canonical adapter / bindings**

* Generated bindings (language-specific) + a canonical ABI layer.

**Layer C — JS Host runtime**

* A JS module that implements the interfaces using real browser APIs.
* Centralized policy enforcement for permissions, gestures, secure context, thread constraints.

**Layer D — Polyfill shims**

* Optional: allow running in non-browser hosts (e.g., Node + undici + jsdom subset), but not required for v0.

### 5.3 Object lifecycle strategy

We support **two interop modes**:

1. **Baseline mode (no wasmGC required)**

   * All host objects are represented as **typed `resource` handles**.
   * The host maintains a handle table: `handle -> JSObject`.
   * Explicit `drop()` / `close()` methods are used for deterministic release.

2. **wasmGC mode (optional fast path)**

   * Allow components compiled with wasmGC to **store `externref` in Wasm GC objects**.
   * Use fewer cross-boundary conversions in hot paths (events, DOM, streaming).
   * Retain explicit `close()` for scarce resources (e.g., tracks, streams, contexts).

**Key design choice**: the *public* `browser:*` interfaces remain stable and usable in baseline mode. wasmGC is an optimization and an optional "enhanced" surface, not a requirement.

---

## 6. Cross-cutting conventions

### 6.1 Error model

Define a shared error type in `browser:types`:

* `error-code` enum (stable set)
* `error` record: `{ code, message, details? }`

Recommended codes:

* `denied` (permission / policy denial)
* `not-supported` (API not available / wrong environment)
* `invalid-argument`
* `not-found`
* `timeout`
* `aborted`
* `network`
* `security` (CSP, mixed content, insecure context, cross-origin blocks)
* `busy` (e.g., locked resource)
* `unknown`

All fallible operations return `result<T, error>` (or the equivalent pattern in your IDL).

### 6.2 Capability grants

Prefer explicit capability-bearing "context" resources:

* `browser:dom` might require a `dom:context` resource created only if allowed.
* `browser:geolocation` requires `geo:capability` minted after permission flow.

This prevents "ambient authority" where importing the interface is enough to do everything.

### 6.3 Feature discovery

Provide `browser:runtime`:

* `is-secure-context() -> bool`
* `is-main-thread() -> bool`
* `supports(feature: string) -> bool`
* `user-agent-hints() -> record { … }` (optional, privacy-aware)
* `wasm-gc-enabled() -> bool` (host-level signal; can be a static build-time truth or runtime feature detect)

### 6.4 Async + event loop integration

We need an async pattern that:

* Works with browser promises
* Works with component callers in multiple languages

Two viable patterns (choose one and standardize):

**Pattern A: native component async (`future`/`stream`)**

* Async functions return `future<T>`
* Event subscriptions return `stream<Event>`

**Pattern B: pollables + callbacks**

* Return an opaque `operation` resource and poll it.
* More verbose, but can be lower-level.

Recommendation: **Pattern A** for ergonomics, with a fallback binding strategy for languages lacking native `future`.

### 6.5 Data transfer: bytes, strings, and "large blobs"

* Small/medium payloads: `list<u8>` is fine.
* Large payloads (images, media, fetch bodies): favor streaming or shared buffers.

Provide in `browser:types`:

* `bytes` as `list<u8>` (baseline)
* `byte-buffer` resource for large buffers with chunked reads/writes
* In wasmGC mode: optionally allow a "view" type that maps to host `ArrayBuffer`/`Uint8Array` without copies (details in §7)

---

## 7. wasmGC integration plan

### 7.1 Why wasmGC helps here

With wasmGC, components can allocate GC-managed objects that can hold reference-typed fields, including `externref`. That enables:

* Representing DOM/event objects as "fat references" held in Wasm, rather than round-tripping integer handles.
* Avoiding repeated conversions for event payloads, nodes, headers, etc.
* More natural bindings for GC languages (Java/Kotlin/Swift-like runtimes) and better interop patterns overall.

### 7.2 Dual-surface strategy

We define **two tiers**:

#### Tier 1: Stable baseline (`browser:*`)

* Uses `resource` handles for host objects.
* Uses serializable records/lists for data.
* Always available.

#### Tier 2: Optional GC-enhanced (`browser-gc:*` or `browser:*@gc`)

* Adds functions that accept/return "direct references" (conceptually `externref`) for hot paths.
* Example: events can yield a GC-friendly wrapper that avoids rehydrating fields repeatedly.

This keeps baseline stable and avoids forcing wasmGC everywhere.

### 7.3 Interop representation options

**Option 1 (recommended): keep WIT resources, optimize the backing**

* Keep public API as `resource node`, `resource event`, etc.
* In wasmGC builds, implement those resource handles as *thin wrappers* over an underlying `externref` stored in wasmGC memory (plus host-side weak maps).
* Pros: minimal surface changes, easy to keep one API.
* Cons: still a handle boundary; less "direct" than pure externref.

**Option 2: introduce explicit GC reference types in the enhanced tier**

* Expose new APIs that directly pass host refs.
* Pros: maximum performance in hot paths.
* Cons: requires toolchain and embedding support; more complex versioning.

In either option, keep explicit `close()` for scarce resources.

### 7.4 Lifetime, cycles, and finalization

Even with wasmGC, **don't rely solely on GC for releasing scarce resources**:

* Provide `close()`/`dispose()` for:

  * MediaStreamTrack, AudioContext, WebSocket, event subscriptions, etc.

GC considerations:

* JS and Wasm GC can create cycles (`WasmObj -> externref(JSObj) -> closure -> WasmObj)`).
* Host runtime should:

  * Avoid capturing Wasm objects in long-lived JS closures.
  * Use `WeakRef` / `FinalizationRegistry` where appropriate.
  * Keep event listeners detachable and tied to explicit subscription lifetimes.

### 7.5 Feature detection and fallback

* Expose `browser:runtime.wasm-gc-enabled()` and `supports("browser-gc:events")`.
* Components can either:

  * Use baseline always, or
  * Try enhanced tier and fall back gracefully.

---

## 8. Interface-by-interface design

Below are **v0** proposals: small, implementable subsets that cover most real use-cases and provide a foundation for extension.

### 8.1 `browser:console`

**Purpose**: structured logging without needing DOM.

Core:

* `log(level, message)`
* `log-structured(level, parts)` (optional)
* `time(label)`, `time-end(label)` (optional)

Mapping:

* JS `console.log/info/warn/error/debug`
* Keep formatting conservative (avoid exposing `%c` styling or arbitrary object dumps unless safe).

wasmGC enhancement:

* Optionally allow passing a "structured value" reference for better debug printing (careful about leaking host objects).

---

### 8.2 `browser:dom`

**Purpose**: controlled DOM interaction.

**Key design rule**: don't mirror the entire DOM. Start with:

* Query + basic element manipulation
* Attributes + text
* Event target wiring (via `browser:events`)
* Minimal style manipulation (optional)

Resources:

* `document`, `node`, `element`, `text`, `window` (or just `document` + `element`)

Core functions (subset):

* `document() -> document`
* `query-selector(doc, selector) -> option<element>`
* `create-element(doc, tag) -> element`
* `append-child(parent: element, child: node)`
* `set-attribute(el, name, value)`
* `get-attribute(el, name) -> option<string>`
* `set-text(el, text)`
* `get-text(el) -> string`

Thread constraints:

* If not main thread: return `not-supported` / `wrong-thread`.

wasmGC enhancement:

* Fast-path wrappers for `node`/`element` backed by `externref`.
* Event payloads can include direct element refs without handle re-lookup.

Security:

* Disallow raw HTML injection by default (no `innerHTML` in v0).
* Provide a separate opt-in `browser:dom-unsafe` if needed.

---

### 8.3 `browser:events`

**Purpose**: subscribe to DOM events without JS callbacks.

Model:

* `subscribe(target, event-type, options) -> subscription`
* `subscription.events() -> stream<event>` (or an equivalent)
* `subscription.close()`

Event type:

* Minimal standard fields: `type`, `timeStamp`, `bubbles`, `cancelable`
* Optional typed payload extraction helpers:

  * `as-mouse-event(event) -> option<mouse-event>`
  * `as-keyboard-event(event) -> option<keyboard-event>`

Mapping:

* JS `addEventListener` with an internal listener that pushes into an async queue.

Backpressure:

* Stream queue must be bounded.
* If overwhelmed: drop oldest / drop newest (choose and document) and emit a `dropped` counter event.

wasmGC enhancement:

* Represent `event` as a wasmGC object holding `externref` to the native JS Event for on-demand field access.

---

### 8.4 `browser:canvas`

**Purpose**: graphics drawing and pixel access.

Start with:

* Canvas2D subset:

  * `get-canvas-by-id(id) -> canvas`
  * `get-context-2d(canvas) -> context2d`
  * Basic draw ops: `fill-rect`, `stroke-rect`, `draw-image` (optional), text (optional)
  * `get-image-data` / `put-image-data` (watch performance)
* Optional `OffscreenCanvas` support behind feature detection.

Performance notes:

* Minimize per-call overhead: encourage batching APIs (e.g., `draw-commands(list<command>)`).
* wasmGC enhancement can help represent command lists as GC arrays/structs.

---

### 8.5 `browser:storage`

**Purpose**: persistence.

v0 recommendation: two layers:

1. **Simple KV** (portable)

* `get(key) -> option<bytes>`
* `set(key, bytes)`
* `delete(key)`
* `list(prefix) -> list<string>`

Backed by:

* `localStorage` for small items or
* IndexedDB for larger/async-safe items

2. **IndexedDB-native** (optional later)

* More complex; defer unless needed.

Security/privacy:

* Respect partitioning rules; don't promise cross-site persistence.

wasmGC enhancement:

* Use shared buffers or chunked reads for large values.

---

### 8.6 `browser:fetch` and `browser:network`

Split responsibilities:

#### `browser:fetch`

* `fetch(request) -> future<result<response, error>>`
* `request` includes:

  * url, method, headers, body (stream or bytes)
  * mode/credentials/cache (optional, carefully)
* `response` includes:

  * status, headers
  * body as `stream<bytes>` or `byte-stream` resource

#### `browser:network` (optional v0)

* WebSocket:

  * `connect(url, protocols) -> websocket`
  * `send(bytes|text)`
  * `events() -> stream<ws-event>`
  * `close(code, reason)`

Security:

* Enforce CORS via the browser; surface errors clearly.

wasmGC enhancement:

* Allow passing through native `ReadableStream`/`WritableStream` equivalents via reference-backed resources for fewer copies.

---

### 8.7 `browser:clipboard`

* `read-text() -> future<result<string, error>>`
* `write-text(text) -> future<result<(), error>>`

Policy enforcement:

* Require secure context.
* Require user gesture (host decides; return `denied` with message if missing).

---

### 8.8 `browser:geolocation`

* `request-permission() -> future<result<permission-state, error>>`
* `get-current-position(options) -> future<result<position, error>>`
* `watch-position(options) -> future<result<watch, error>>`
* `watch.events() -> stream<position>`
* `watch.close()`

Privacy:

* No silent access; permission flow must be explicit.

---

### 8.9 `browser:media`, `browser:audio`, `browser:video`

**`browser:media` (capture)**

* `get-user-media(constraints) -> future<result<media-stream, error>>`
* `media-stream.tracks() -> list<track>`
* `track.stop()`

**`browser:audio` (playback/processing subset)**

* `create-audio-context() -> audio-context`
* `audio-context.close()`
* Minimal nodes (gain/source/destination) or defer to v1.

**`browser:video`**

* v0: bind a stream to a `<video>` element by id:

  * `attach-stream(video-element-id, media-stream)`
* optional: `capture-frame(video) -> image-bitmap` later.

wasmGC enhancement:

* Media objects are ideal candidates for `externref`-backed resources.

---

### 8.10 `browser:notifications`

* `request-permission() -> future<result<permission-state, error>>`
* `show(title, options) -> future<result<notification, error>>`
* `notification.close()`

Constraints:

* Secure context.
* Permission gate.

---

### 8.11 `browser:service-worker`

v0: extremely minimal, behind feature detection

* `register(script-url, options) -> future<result<registration, error>>`
* `get-registrations() -> future<result<list<registration>, error>>`

Important: many environments disallow SW (file://, sandboxed frames). Return `not-supported` with details.

---

### 8.12 `browser:performance`

* `now() -> f64`
* `mark(name)`
* `measure(name, start?, end?) -> result<measure, error>`

Mapping:

* `performance.now()`, `performance.mark`, `performance.measure`

---

## 9. Security, privacy, and policy enforcement

Central host policy module should enforce:

* **Secure context** checks (`window.isSecureContext`) where required.
* **User gesture** checks (best-effort; browser limitations vary).
* **Permission state** gating with explicit request flows.
* **Threading** checks (main-thread only APIs).
* **Origin restrictions** (CORS, same-origin checks, iframe sandbox constraints).

Design principle:

* Prefer returning `error { code: denied/security/not-supported, message }` over silently failing.
* Include actionable messages ("Requires secure context (HTTPS)", "Must be called in response to a user gesture", etc.).

---

## 10. Host implementation details (JS)

### 10.1 Module structure

```
src/browser/
├── runtime.ts
├── types.ts          # shared codecs, error mapping
├── console.ts
├── dom.ts
├── events.ts
├── fetch.ts
├── network.ts
├── storage.ts
├── canvas.ts
├── clipboard.ts
├── geolocation.ts
├── media.ts
├── notifications.ts
├── performance.ts
└── service-worker.ts
```

### 10.2 Resource tables (baseline)

Each interface owns resources:

* A monotonically increasing `u32` id
* A `Map<u32, JSObject>`
* Optionally a `FinalizationRegistry` to auto-clean if the component drops without closing (best-effort)

Example:

* `dom.Element` resource -> actual `HTMLElement`
* `events.Subscription` -> `{ target, type, listener, queue }`

### 10.3 Async and streaming plumbing

* For `future<T>`: host returns a promise-backed completion.
* For `stream<T>`:

  * Implement with an internal async queue.
  * Provide `next()` semantics or canonical `stream` ABI as required by your component toolchain.

### 10.4 wasmGC fast path implementation

When wasmGC is enabled + the component opts in:

* Represent certain resources internally as:

  * Wasm GC object storing `externref` (native JS object)
  * Host functions accept/return those references directly, reducing map lookups and round-trips.

Practical rule:

* Use wasmGC enhancements primarily for:

  * `events` (event objects)
  * `dom` nodes/elements
  * streaming (response bodies, media streams)
  * canvas command batching

Keep baseline always available.

---

## 11. Versioning and stability strategy

* Use semver per package.
* v0 (`0.1.x`) guarantees:

  * Additive changes only (new functions/types)
  * No breaking changes without `0.2` bump
* Mark experimental surfaces:

  * `browser-gc:*@0.1.x-experimental` (or `@unstable` in metadata)
  * Host can choose not to expose them even if wasmGC exists.

---

## 12. Testing strategy

### 12.1 Unit tests (host-side)

* Mock browser APIs where possible.
* Validate error mapping, permission gating logic, queue behavior.

### 12.2 Integration tests (real browsers)

* Use a harness that:

  * Loads a test page
  * Instantiates the Wasm component
  * Runs scripted scenarios (DOM manipulation, fetch, events, storage)

### 12.3 Compatibility matrix

* Main thread vs worker
* Secure vs insecure context (where testable)
* wasmGC enabled vs disabled
* Feature flags on/off (service worker, clipboard, etc.)

### 12.4 Performance tests

* Event throughput tests (mousemove, keydown streams)
* Fetch streaming throughput
* Canvas command batching overhead
* wasmGC fast path vs baseline comparisons

---

## 13. Rollout plan

1. **Phase 0**: `browser:types`, `browser:runtime`, `browser:console`
2. **Phase 1**: `browser:fetch`, `browser:storage`, `browser:performance`
3. **Phase 2**: `browser:dom` + `browser:events` (main-thread only)
4. **Phase 3**: `browser:canvas`
5. **Phase 4**: permissions-gated APIs (`clipboard`, `geolocation`, `notifications`, `media`)
6. **Phase 5**: `service-worker` (experimental)
7. **Parallel**: wasmGC-enhanced tier for `events` and `dom` once baseline is stable

---

## 14. Design Decisions

The following decisions have been made for the v0 implementation:

### 14.1 Async ABI: Native `future`/`stream`

**Decision**: Use native Component Model async primitives.

- Async functions return `future<T>`
- Event subscriptions return `stream<Event>`
- Aligns with WASIP3 async model for consistency
- More ergonomic than explicit pollables
- Fallback binding strategy available for languages lacking native `future` support

### 14.2 Event Backpressure: Drop Oldest

**Decision**: When the event stream queue is full, drop the oldest events.

- Prefer fresh events for UI responsiveness (e.g., latest mouse position matters more than old positions)
- Bounded queue size (configurable, default 1000 events)
- Emit `dropped-count` metadata on next delivered event when drops occur
- Components can detect drops and adjust behavior if needed

### 14.3 DOM Scope: Structural Only in v0

**Decision**: Keep v0 purely structural; defer style/layout APIs to v0.2.

v0 includes:
- Query selectors
- Create/append/remove elements
- Get/set attributes
- Get/set text content
- Event target wiring

v0.2 will add:
- `set-style(el, prop, value)`
- `get-computed-style(el, prop)`
- Layout queries (bounding rect, scroll position)

Rationale: Smaller attack surface, simpler implementation, style APIs have more security considerations.

### 14.4 Storage Backing: IndexedDB Only

**Decision**: Use IndexedDB exclusively for `browser:storage`.

- Consistent async API across all operations
- Handles large values well (no 5MB localStorage limit)
- Works in Web Workers
- Future-proof for more complex storage patterns
- Simpler mental model (one backing store)

Trade-off accepted: Slightly higher latency for small reads vs localStorage.

### 14.5 Canvas Strategy: Command Buffers

**Decision**: Use batched command buffers instead of immediate-mode calls.

```
draw-commands(ctx: context2d, commands: list<draw-command>) -> result<(), error>
```

- Dramatically reduces cross-boundary call overhead
- Better for complex scenes and animations
- Natural fit for wasmGC arrays/structs
- Immediate-mode convenience wrappers can be built on top in userland

Command types include: `fill-rect`, `stroke-rect`, `fill-text`, `stroke-text`, `draw-image`, `begin-path`, `move-to`, `line-to`, `arc`, `close-path`, `fill`, `stroke`, `save`, `restore`, `translate`, `rotate`, `scale`, `set-fill-style`, `set-stroke-style`, `set-line-width`, `set-font`.

### 14.6 wasmGC Surface: Single API with Optimized Backing

**Decision**: Keep a single `browser:*` API surface; optimize implementation when wasmGC is available.

- Public API remains stable regardless of wasmGC availability
- When wasmGC is detected, resource handles are backed by `externref` stored in Wasm GC objects
- Host uses feature detection: `browser:runtime.wasm-gc-enabled()`
- No separate `browser-gc:*` package needed
- Transparent optimization without user code changes

Implementation detail: Hot paths (events, DOM nodes, streaming) get `externref` backing; cold paths use traditional handle tables.

---

### Decision Summary

| Question | Decision | Rationale |
|----------|----------|-----------|
| Async ABI | `future`/`stream` | Aligns with WASIP3, more ergonomic |
| Backpressure | Drop oldest | UI responsiveness, fresh events preferred |
| DOM scope | Structural only (v0) | Smaller surface, add style in v0.2 |
| Storage | IndexedDB only | Consistent async, handles large values |
| Canvas | Command buffers | Performance, fewer boundary crossings |
| wasmGC | Single API, optimized backing | Stable surface, transparent optimization |

---

## Appendix A: Suggested minimal type set (`browser:types`)

(Notation is illustrative; adjust to your chosen IDL / WIT syntax.)

```wit
package browser:types@0.1.0;

interface types {
  record error {
    code: error-code,
    message: string,
  }

  enum error-code {
    denied,
    not-supported,
    invalid-argument,
    not-found,
    timeout,
    aborted,
    network,
    security,
    busy,
    unknown,
  }

  record header {
    name: string,
    value: string,
  }

  type headers = list<header>;
  type url = string;
  type bytes = list<u8>;

  enum permission-state {
    granted,
    denied,
    prompt,
  }
}
```
