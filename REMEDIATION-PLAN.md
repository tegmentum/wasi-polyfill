# Remediation Plan

A phased plan to address the findings from the 2026-05 code review (correctness bugs,
missing/incomplete features, refactoring, optimizations, and tooling gaps).

**Effort key:** S < 0.5d · M 0.5–2d · L 2–5d · XL > 1wk
**Risk:** Low / Med / High (chance of regression / blast radius)

## Guiding principles

1. **Safety net before surgery.** Restore lint and add tests for the untested
   subsystems (WASIP1/WASIP3) *first*, so the bug fixes can be verified and locked in.
2. **Shared abstractions before bug fixes.** Several bugs (handle leaks, cross-instance
   collisions) are cleanest to fix once a single `HandleTable` and `Result` exist.
3. **Fix silent feature-breakers next** — small diffs, high impact, restore advertised
   behavior.
4. **Then features, optimizations, and mechanical dedup**, each behind tests.
5. One concern per PR; every behavioral change ships with a test.

## Phase overview

| Phase | Theme | Gate it unblocks | Effort |
|-------|-------|------------------|--------|
| 0 | Tooling & test safety net | Confidence for all later phases | M |
| 1 | Shared abstractions (`HandleTable`, `Result`, `interfaceKey`) | Clean leak/isolation fixes + dedup | L |
| 2 | Critical correctness bugs (silent feature-breakers) | Restores HTTP/sockets/kv/security | L |
| 3 | Missing / incomplete features | hostfs, symlinks, streaming, GPU drops | XL |
| 4 | Optimizations | Perf (O(n²) writes, busy-poll, etc.) | M |
| 5 | Cross-cutting refactor / cleanup | Maintainability | M |

---

## Progress (updated 2026-05-23)

Completed on branch `remediation/phase-0-2` (each item shipped with a regression
test; full suite green at 2810 tests, typecheck + lint clean):

- ✅ **0.1 / 0.2 / 0.3** — ESLint v9 flat config, `.prettierrc`, CI lint now required.
- ✅ **2.1** — pollables routed through the global registry (HTTP/socket/DNS async).
- ✅ **2.2** — keyvalue atomics + batch wired up (memory backend) incl. CAS; shared
  BucketStore across interfaces. *(idb backend deferred — async/jco-incompatible.)*
- ✅ **2.11** — `wasi:cli/terminal-*` added to `createCliPolicy`.
- ✅ **2.12** — WASIP3 rejected-subtask errors surfaced.
- ✅ **2.13** — WASIP1 out-of-bounds pointers return EFAULT instead of trapping.
- ✅ **2.14** — `set-times` conflicting `*_NOW` flags return EINVAL.
- ✅ **4.3** — `get-random-bytes` supports lengths > 64KiB (chunked).

Note: WASIP1 and WASIP3 already have substantial test suites (the `COMPLETION.md`
"0 tests" claim was stale), so Phase 0.4/0.5 became "add regression tests with
each fix" rather than building suites from scratch.

Second autonomous batch (same branch):

- ✅ **2.3** — DOM `setAttribute` blocks `javascript:`/`vbscript:`/`data:` URLs
  (shared `unsafeAttributeReason`, used by dom.ts + gc-enhanced.ts).
- ✅ **2.15** — `worker.terminate` releases handlers + purges queues; geolocation
  and notification queues are bounded.
- ✅ **3.5** — WebGPU resource-drops added for the 9 leaf resource types;
  `create-query-set` returns an error instead of a fake handle.
- ✅ **4.2 / 4.6 / 4.7** — incremental stream size; TextEncoder/Decoder
  singletons; StatCache eviction without a full sort. *(4.5 jco memoization
  deferred — complexity vs. payoff.)*
- ✅ **5.2 / 5.3 / 5.7 / 5.9** — manifest parse dedup; `createJcoPolyfill` honors
  a real `jcoCompat` default; registry get/getSync dedup; removed empty
  `browser/plugins/` dir.

Decisions captured: continue autonomously; **P3 → scope to jco + document (3.7)**;
**mock backends → implement real**.

Third autonomous batch (same branch):

- ✅ **2.5/2.6** — WASIP1 `resolvePath` normalizes `.`/`..` (clamped at root);
  `path_open` attaches the filesystem ref so subdirectory fds are usable.
- ✅ **2.6b** — WASIP2 memory FS `normalizePath` resolves `.`/`..`.
- ✅ **2.9** — ws-gateway bounds frame payload size (`maxFrameSize`, default 16 MiB)
  to prevent an unbounded-buffering memory DoS.
- ✅ **2.16** — `browser:worker` imports return a `result<>` instead of throwing,
  matching every other browser interface.

Fourth autonomous batch — real backends (heavy deps greenlit):

- ✅ **3.9 SQL** — real SQLite via **sql.js** (optional peer dep; type-only import
  so nothing is bundled). New `sqljs` implementation: real SQL engine (JOINs,
  constraints) and real BEGIN/COMMIT/ROLLBACK transactions; shared backend so the
  5 wasi:sql interfaces share connections. `memory` stays the zero-config default.
- ✅ **3.10 messaging** — message TTL expiry now honored (per-message `ttl` and
  channel `defaultTtl`); expired messages are skipped/purged on delivery + receive.
- ⏸️ **3.8 NN** — a real onnxruntime-web backend is feasible (the NN interface is
  already async via JSPI) but is a large, awkward integration: wasi:nn here
  exposes a WebNN *graph-builder* API (createContext→build) that onnxruntime's
  load-a-model model doesn't map onto, plus a ~10 MB dep and tensor marshalling.
  Scoped as its own PR.

Fifth autonomous batch:

- ✅ **2.4** — `getBrowserImports` enforces an optional capability allow-list:
  only granted interfaces are wired (browser:types/runtime stay as pure
  utilities); omitting it preserves the previous behavior. Also avoids eagerly
  building ungranted heavy interfaces (e.g. WebGPU).
- ✅ **build** — added the missing tsup entries for the sql/nn/messaging/webgpu/
  frame-buffer/graphics-context/surface/wasi-gfx plugins; their package.json
  exports previously resolved to files that were never built.
- ℹ️ WASIP1 symlinks already work end-to-end (`MemoryFilesystem` implements
  symlink/readlink/link and the syscalls delegate to them) — the symlink gap is
  WASIP2-only (still deferred, needs full path-following).

Sixth autonomous batch:

- ✅ **3.1 hostfs** — `createNodeFilesystem(rootDir)`: a real `node:fs`-backed
  WASIP1 filesystem, sandboxed to a root (rejects `..`/absolute/symlink escapes →
  ENOTCAPABLE). Adds a `FileResource.close()` hook (called by fd_close) so real
  OS fds don't leak. Ships as a Node-only entry so browser bundles stay clean.

Seventh batch:

- ✅ **3.2 symlinks** — WASIP2 memory FS now supports symbolic + hard links:
  a symlink node type; intermediate symlinks always followed, final per the
  symlink-follow path flag; relative/absolute targets; depth-bounded loop guard;
  stat/get-type report `symbolic-link`. Replaces the previous Unsupported stubs.

Eighth batch:

- ✅ **3.3 streaming HTTP** — `ReadableStreamInputStream` (background-pumped,
  backed by a WHATWG ReadableStream / fetch Response.body); the outgoing handler
  uses it when `config.streamResponseBody` is set, so large downloads stream
  instead of being fully buffered. Default stays buffered (streaming makes body
  reads async → async/JSPI contexts only).

Ninth batch:

- ✅ **5.10 (partial 2.10)** — `Polyfill` accepts a private `PluginRegistry` via
  `PolyfillConfig.registry`, and `registerCorePlugins(registry?)` targets it, so
  independent polyfills/tests can avoid sharing plugin registrations. Defaults to
  the global registry (unchanged). Full per-instance plugin-*instance* isolation
  (module-level registries inside plugins) remains the larger 2.10 work.

Tenth batch:

- ✅ **3.7 P3 scope docs** — documented that WASIP3 targets jco-transpiled
  components and does not implement the real canonical ABI (no raw P3 binary
  instantiation); dropped the stale 2025 timeline. This also descopes **3.6**
  (expanding P3 fs methods) as inconsistent with the documented jco scope.

Eleventh batch:

- ✅ **Phase 1 `HandleRegistry` migration (clean cases)** — 11 plain
  register/get/drop tables now `extend` the shared `HandleRegistry` (sockets
  Network/Tcp/Udp/ResolveAddressStream, ws-gateway tunneled DNS, and the 7 http
  request/response/options registries), via a small `register` override that
  preserves the `.handle` field and any drop side effects. On inspection the
  remaining registries are genuinely bespoke (domain methods, `size` getter,
  handle-in-constructor, abort/close-on-drop, dual in/out tables) and are
  intentionally left — forcing them into the base would add code/risk for
  negative readability.

Twelfth batch:

- ✅ **2.17 OPFS** — fixed exclusive-create (probe with `getFileHandle({create:false})`
  instead of the bogus `file.size > 0` proxy) and made `renameAt` roll back the
  copy if deleting the source fails (no more duplicate on partial failure).
  Browser-only (Playwright e2e), not node unit tests.

Thirteenth batch:

- ✅ **2.8 UDP send** — datagrams are now sent on a per-destination tunnel stream
  (keyed by `host:port`) instead of one reused stream that misrouted later
  destinations; drop/clear close all of a socket's streams.

Fourteenth batch — Phase 2.10 (per-instance isolation), foundations:

- ✅ **2.10 infrastructure** — `ResourceContext`: a per-polyfill bag of plugin
  backing state. Each `Polyfill` owns one (or accepts `PolyfillConfig.context`)
  and injects it into every plugin `create()`; plugins resolve shared state from
  it by key, falling back to a global context for standalone use. Isolation by
  default between polyfills.
- ✅ **2.10 self-contained stores** — keyvalue `BucketStore` and sql sqljs backend
  are now context-scoped: shared across their own interfaces within a polyfill,
  isolated between polyfills. Proven by `test/core/resource-context.test.ts`.

Fifteenth batch — Phase 2.10 coupled space (started):

- ✅ **io error registry** context-scoped (self-contained → safe to isolate now).
  Added resolve+pre-seed helpers for the pollable and stream registries too,
  but kept poll/streams on the global registries: they're entangled with the
  filesystem *singleton* (still global) and deep fs/cli/http usage, so partial
  isolation would break cross-plugin poll/stream resolution in a fresh-context
  polyfill. Pollables/streams convert together with the filesystem.

Sixteenth batch — Phase 2.10 filesystem isolation (the linchpin):

- ✅ **filesystem per-polyfill** — the in-memory filesystem singleton (shared file
  data + descriptor handles between polyfills, the worst leak) is now scoped to
  the ResourceContext: fs/types and preopens share one instance within a polyfill,
  isolated between polyfills. `setGlobalFilesystem` pre-population preserved.
- ℹ️ Determined streams/pollables can safely stay on their global registries:
  handles are globally unique (shared counter) and each stream/pollable wraps a
  specific instance's node (content-isolated), so a shared registry causes no
  cross-talk. Isolating the filesystem is what actually closes the leak.

Seventeenth batch — Phase 2.10 polish:

- ✅ **opfs + idb backends context-scoped** — OPFS instances own their descriptor
  registries (were module-global) and resolve per-context; IDB resolves per
  context so fs/types + preopens share within a polyfill. Underlying browser
  storage (OPFS disk / IndexedDB) stays shared by nature, which is correct.
  This makes 2.10 complete for all three filesystem backends.

Eighteenth batch — HandleRegistry migration tail:

- ✅ Migrated the remaining **single-handle-space** registries to the shared
  HandleRegistry (extend + small overrides): fs DescriptorRegistry /
  DirectoryEntryStreamRegistry / OpfsDirectoryEntryStreamRegistry, http
  FutureIncomingResponseRegistry, ws-gateway TunneledTcp/UdpSocketRegistry.
  Left intentionally bespoke: OPFS/IDB descriptor registries (async drop),
  dual-space tables (Datagram/TunneledDatagram/Terminal), and the domain
  classes (Pollable/Stream/Error/Thread/Tunnel/gfx, Fields' size getter).

Nineteenth batch — Phase 3.8 NN real backend:

- ✅ Added a real ONNX-Runtime-backed wasi:nn implementation (`onnx`):
  `impl-onnx.ts` runs actual ONNX models through the standard load(model-bytes)
  → init-execution-context → set-input → compute → get-output flow, mapping
  onto `InferenceSession.create` / `session.run`. The runtime is an **optional,
  host-provided peer dependency** (`config.ort`, `onnxruntime-web`/`-node`) and
  is type-decoupled via a minimal structural interface, so the polyfill bundles
  nothing and the bridge is unit-testable with a fake `ort` (no model fixtures).
  Tensor<->ort.Tensor marshalling covers fp32/fp16/u8/i32/i64. Registered as
  the opt-in `onnx` implementation across all four nn interfaces and scoped to
  the polyfill's ResourceContext so the interfaces share graphs/contexts. The
  earlier blocker was the assumption that wasi:nn here was the WebNN
  graph-builder API; in fact the interface already exposes the model-load flow,
  which maps cleanly. (14 tests.)

Twentieth batch — Phase 4.1 memory-FS capacity doubling:

- ✅ Memory-FS file growth no longer reallocates to the exact size on every
  write (which made N streaming appends O(N²)). A `growFile` helper
  capacity-doubles the backing ArrayBuffer; `node.content` stays a view whose
  `.length` equals the logical file size, so every reader (stat/read/slice and
  the tests that touch `.content` directly) is unchanged. Newly exposed bytes
  are zero-filled to preserve POSIX hole/extend semantics; explicit `set-size`
  shrink still copies so the oversized buffer is freed. (5 tests covering
  streaming append, sparse zero-fill, reused-capacity re-grow, logical-size
  stat.)

Twenty-first batch — Phase 5.5 typed FilesystemError:

- ✅ `FilesystemError` (wasip1) now carries a typed POSIX `code` (`FsErrorCode`),
  set at all 23 throw sites; the message is composed as `${code}: ${detail}` so
  existing message-prefix expectations still hold. The internal `removeDirectory`
  / `open` etc. checks branch on `.code` instead of `e.message.includes('ENOENT')`,
  hostfs-node's plain code-prefixed `Error`s became typed, and `path.ts` `mapError`
  now maps by `.code` (a `Record<code, Errno>`) — which also covers native
  `node:fs` errors (they carry `.code` too), with a precise leading-token
  fallback and EIO otherwise. Replaces the brittle 12-pattern substring ladder;
  as a bonus EPERM now maps correctly (the old ladder silently returned EIO).
  (3 new mapping tests; mock fs updated to throw typed errors.)
  Scope note: the browser `mapErrorToBrowserError` substring heuristic is left
  as-is — it classifies third-party DOM/`TypeError` objects we don't throw, so
  there's no typed code to read.

Twenty-second batch — Phase 3.4 sockets ↔ ws-gateway:

- ✅ The ws-gateway tunnel adapters (`tunneledTcp/UdpImplementation`,
  their create-socket variants, and `tunneledDnsLookupImplementation`) are now
  registered as the opt-in `tunneled` implementation on the standard
  `wasi:sockets` tcp/udp/(create-socket)/ip-name-lookup plugins, so the real
  (relayed) path is selectable instead of only reachable via the separate
  ws-gateway plugins. `virtual` stays the default. No import cycle — the
  adapters depend on `sockets/types`, not `sockets/plugin`. Docstrings note
  the tunnel and the known UDP-receive limitation (2.7). (Tests assert the
  `tunneled` impl is present on all four socket plugins + DNS.)

Twenty-third batch — Phase 4 perf cluster (4.9 / 4.10 / 4.5):

- ✅ **4.9 ByteQueue** — reads/skips advance a `head` index instead of
  `Array.shift`-ing each drained chunk (shift is O(n) per call → draining many
  small chunks was O(n²)); the consumed prefix is spliced only occasionally so
  the backing array can't grow unbounded. `available` is now a running counter.
  (2 tests: interleaved push/read stress + peek non-disturbance.)
- ✅ **4.10 fd_readdir** — directory listings are snapshotted per fd (names
  pre-encoded) and reused across pages; a fresh enumeration (cookie 0) refreshes
  the snapshot. Paging a directory is O(N) instead of O(N²) (was re-reading +
  re-encoding + skipping `cookie` entries every call). Also switched the
  per-entry/per-call `new TextEncoder()` sites to a module-level singleton.
  (2 tests: cache reuse/refresh + multi-page enumeration with one readdir.)
- ✅ **4.5 jco imports memoization** — `Polyfill` memoizes `buildJcoImports`
  keyed by the sorted set of loaded interface strings (instances are cached for
  the polyfill's lifetime, so the same set always yields the same resource
  classes); cleared in `destroy()`. Resolves the long-deferred 4.5. (1 test:
  same set → same object, order-independent; different set → fresh build.)

Twenty-fourth batch — Phase 5.8 buildTunnelConfig:

- ✅ Extracted `buildTunnelConfig(source)` into tunnel-manager (copies only the
  set optional fields so `undefined` can't override registry defaults),
  replacing the identical ~16-line TunnelConfig assembly duplicated 4× in the
  tcp/udp adapters and a partial in the dns adapter. Pure refactor (covered by
  the existing 200 ws-gateway/sockets tests). The `AggregateError`→`MultiError`
  rename was already done in a prior batch (no global shadowing remains).

Twenty-fifth batch — Phase 5.4 buildJcoImports cleanup:

- ✅ Extracted `makeMethodCallable`/`makePlainCallable` (sharing a `finishJcoCall`
  finisher) so the duplicated wrapDesc-ternary closures in `buildJcoImports`
  collapse to single calls, and a single `parseImportKey` classifies each key in
  one regex pass (replacing the sequential `[resource-drop]`/`[method]`/`[static]`/
  `[constructor]` match ladder) feeding a `switch`. Pure refactor; behavior
  unchanged (covered by the 34 jco-compat tests). Static methods keep their
  existing semantics (no return-wrap/guard).

Twenty-sixth batch — Phase 5.6 withDescriptor guard:

- ✅ Added a `withDescriptor(handle, fn)` guard on the memory filesystem and
  routed all ~24 descriptor methods through it, removing the repeated
  `get(handle)` + `BadDescriptor` null-check (single-descriptor methods become
  one-liners; dual-descriptor `linkAt`/`renameAt` nest two guards). Pure
  refactor (covered by the existing 60 filesystem tests).
  Scope note: the sockets tcp/udp stubs interleave the handle lookup with state
  validation and varied error returns (and mostly return `NotSupported`), so a
  shared `withSocket` there would add risk for little readability gain — left
  bespoke, same judgment as the HandleRegistry "left bespoke" cases.

Twenty-seventh batch — Phase 5.1 Wasip1.getImports generation:

- ✅ `Wasip1.getImports()` now generates the ~45 guest imports by iterating the
  function groups (proc/args-environ/clock/random/fd/path/poll) and wrapping each
  with a single `guard` (init-check) instead of ~180 lines of hand-written
  identical passthroughs; socket ops stay explicit ENOSYS stubs. `procFns`'
  non-import `getExitCode` is destructured out. The memory-fault→EFAULT post-pass
  is unchanged, and the now-vestigial `const self = this` alias was dropped.
  Pure refactor (covered by the 28 wasip1/index tests, which assert all 45 import
  names are present + behavior). With this, **Phase 5 is complete**.

Twenty-eighth batch — Phase 3.14 blocking poll_oneoff:

- ✅ Added opt-in blocking to `poll_oneoff` (`Wasip1Config.blockingPoll`, default
  off): when nothing is ready, it blocks until the earliest clock deadline via
  `Atomics.wait` (busy-wait fallback) then signals the expired clock(s), instead
  of returning 0 events and letting a guest sleep busy-loop forever (the
  relative-clock deadline was recomputed every call, so it never fired).
  Non-expired clocks are now recorded so the earliest can be selected. Default
  off preserves the documented non-blocking behavior (and existing tests); only
  enable where blocking the thread is acceptable (Node/Workers, not the main
  browser thread). (2 tests: actually waits a ~20ms deadline; doesn't block when
  another sub is ready.)

Twenty-ninth batch — Phase 3.13 manifest verification:

- ✅ Put the previously-dead manifest fields to work: `verifyComponentHash`
  (Web Crypto digest of the component bytes vs the manifest's
  `[algo:]<hex>` hash — sha256/384/512, default sha256, case-insensitive; true
  when none declared) and `validateExports` (mirror of `validateManifest` on the
  export side, so a host can refuse a component that doesn't provide the
  interfaces it intends to call). Both exported from core. (9 tests.)

Thirtieth batch — Phase 4.4 async-executor waitAll:

- ✅ `AsyncExecutor.waitAll` no longer polls `activeTasks.size` every 10ms; a
  `finishTask` notifier wakes registered waiters the moment the last task drains
  (timeout still enforced via a single `setTimeout`; `cancelAll` also wakes
  waiters). The other `setTimeout` sites are legitimate, not busy-spins:
  `callAsync` already awaits `task.wait()` (event-driven), `eventLoop` yields in
  a generic poll over arbitrary operations, and `adaptPollable` polls because
  P2 pollables are poll-based by contract (no onReady to subscribe to). (1 test:
  multiple concurrent waiters wake on drain.)

Thirty-first batch — Phase 3.11 incoming-handler dispatch:

- ✅ Added `createIncomingHandler(handler).dispatch(request)`: a host-side
  round-trip that turns a Fetch `Request` into a `Response` by running the
  handler (createFromFetchRequest → handle → read the response outparam → build
  a `Response`; request body attached as an input stream). This is the concrete
  Service Worker `fetch`-event integration point that was previously only
  sketched. 501 when no handler, 500 on throw / error-outparam; handles cleaned
  up. The `stub`/`callback` plugin implementations remain for the registry path.
  (6 tests: status/headers/body, method+path, body passthrough, 501, 500×2.)

Thirty-second batch — Phase 3.15 wasm-GC detection + readEventRefs:

- ✅ `isWasmGcEnabled()` now really detects the WebAssembly GC proposal by
  validating a tiny module that declares a GC `struct` type (was hardcoded
  `false`); memoized. This correctly gates the GC-enhanced DOM/events tier.
- ✅ `readEventRefs` no longer returns a misleading empty success: it reports
  `NOT_SUPPORTED` (after a real subscription-handle check) because the base
  events layer deliberately serializes events rather than retaining raw `Event`
  objects (which would pin DOM nodes / leak across the host boundary). Callers
  use the per-`EventRef` query methods with an `Event` from a direct listener.
  (3 tests for the detector.)

Thirty-third batch — Phase 3.12 OPFS set-times sidecar:

- ✅ OPFS `set-times`/`set-times-at` no longer silently no-op while returning
  ok. A per-instance `OpfsTimesStore` (keyed by root-relative path) records
  access/modification overrides, and `stat`/`stat-at` reflect them for the
  session (OPFS has no native set-times — `lastModified` is read-only). Child
  descriptor paths are normalized root-relative so keys are consistent. Browser
  e2e covers the descriptor flow; 5 unit tests cover the store's merge
  semantics.

Thirty-fourth batch — Phase 4.8 OPFS set-size:

- ✅ OPFS `set-size` no longer reads the whole file then rewrites it (O(file)
  + double buffering). A descriptor-level `setSize` uses
  `FileSystemWritableFileStream.truncate`, which resizes in place (zero-filling
  on growth) in O(1) and works on the main thread and in workers. Read/write
  were already range-scoped (`getFile().slice()` and `createWritable`+seek), so
  the whole-file `set-size` read was the actual hot spot. Removed the unused
  `useSyncAccessHandle` config flag (a do-nothing public field); a worker-only
  SyncAccessHandle fast path is out of scope here (can't be validated without a
  worker harness, and the createWritable path is correct).

Thirty-fifth batch — Phase 2.7 ws-gateway UDP receive (connected/per-dest):

- ✅ Inbound UDP datagrams are now delivered for connected and per-destination
  sockets. Added a per-stream inbound handler on `WsTunnelManager`
  (`setStreamDataHandler`/`removeStreamDataHandler`, invoked once per DATA frame
  so datagram boundaries are preserved — unlike the byte-oriented rxQueue); the
  UDP adapter registers one when it opens a stream and routes each datagram into
  the socket's `incomingQueue` tagged with that stream's bound remote. The
  earlier "no source address" blocker is sidestepped because each tunnel stream
  is bound to a specific remote (the connected peer or the send destination), so
  that *is* the source. Handlers are removed on socket close. Remaining
  limitation (documented): receiving from a never-contacted peer (a pure UDP
  server with no opened stream) is still unsupported — the wire protocol carries
  no per-frame source address. (4 DatagramQueue tests for boundary/source
  semantics; live tunnel path is Playwright-only.)

Thirty-sixth batch — Phase 1.4 Result unification:

- ✅ Unified the four per-plugin Result types onto the shared `Result<T,E>`
  (`src/shared/result.ts`). `NnResult`/`SqlResult`/`MessagingResult`/
  `KeyValueResult<T>` are now type aliases of `Result<T, XError>`, and the
  `xOk`/`xErr` constructors delegate to the shared `ok`/`err` (single
  construction site). **keyvalue** carried the real divergence — its
  `{tag:'ok',val}`/`{tag:'err',val}` shape — and was migrated to the canonical
  `{ok,value}`/`{ok,error}`; all consumers updated (impl-memory/idb/replay +
  4 test files). nn/sql/messaging already matched the shape, so those were a
  no-op at runtime. The named `xOk`/`xErr` wrappers are kept (xErr bundles error
  construction) — removing 90+ call sites would be churn for negative value; the
  goal was eliminating the divergent *shape*, now done. Full suite green at 2943.

Thirty-seventh batch — Phase 1.5 interfaceKey helper:

- ✅ Added `interfaceKey(iface)` (`core/types.ts`, version-independent
  `package/name`) and replaced the 12 inlined `${pkg}/${name}` constructions
  across plugin-registry/policy/polyfill/manifest/runtime-policy/
  provider-registry/testing-harness. Versioned formatting stays
  `formatInterfaceString`. (2 tests.)

Thirty-eighth batch — Phase 2.8 WASIP3 stream error variant:

- ✅ Added an `error` status variant to `StreamReadResult`/`StreamWriteResult`
  and stopped masking source/sink failures as a clean EOF/close. The
  iterable/ReadableStream read paths and the WritableStream write path now
  return `{status:'error', error}` on a thrown error, and the p2-to-p3 adapter
  returns `error` for non-end errors (a message containing "end" is still a
  clean EOF). Tests that asserted errors-as-EOF were corrected, plus a new test
  that an end-signal error still yields `end`. (pendingWrite deadlock-drain half
  of 2.8 was already done.)

Remaining (the hard tail — large, low-value, or externally blocked):
- **2.10 — complete.** Isolated per-polyfill: kv/sql backing stores, the io error
  registry, and all three filesystem backends (memory/opfs/idb — file data +
  descriptor handles). Streams/pollables and the sockets/http handle tables
  intentionally remain on shared global registries: their handles are globally
  unique and each wraps a specific instance's node, so a shared registry is
  cross-talk-free. No further 2.10 work needed.
- **2.7 ws-gateway UDP receive — ✅ done for the connected/per-destination subset**
  (see thirty-fifth batch). Inbound datagrams are delivered via a per-stream,
  boundary-preserving handler, sourced from the stream's bound remote. Only
  unsolicited receive from a never-contacted peer (a pure UDP server) remains
  unsupported — the wire protocol carries no per-frame source address. (Send —
  2.8 — is fixed.)
- **3.8 NN real backend — ✅ done** (see nineteenth batch). Real ONNX Runtime
  backend wired as the opt-in `onnx` implementation; runtime is an optional
  host-provided peer dep, bridge is unit-tested with a fake `ort`. (SQL and
  messaging real backends: ✅ done.)

---

## Phase 0 — Tooling & test safety net

| # | Item | Finding | Files | Effort | Risk |
|---|------|---------|-------|--------|------|
| 0.1 | Add ESLint v9 flat config (`eslint.config.js`); fix or ratchet violations | ESLint dead (no v9 config) | new `eslint.config.js`, `package.json` | M | Low |
| 0.2 | Add `.prettierrc` to pin formatting | No prettier config | new `.prettierrc` | S | Low |
| 0.3 | Flip CI `lint` job to **required** (remove `continue-on-error`) once 0.1 is green | CI silently ignores lint | `.github/workflows/ci.yml` | S | Low |
| 0.4 | Add Vitest suites for WASIP1 (memory.ts iovec, fd table, path resolution, errno) | WASIP1 has 0 tests | new `test/wasip1/*` | M | Low |
| 0.5 | Add Vitest suites for WASIP3 (canonical-abi stream/future, async-executor) | WASIP3 has 0 tests | new `test/wasip3/*` | M | Low |
| 0.6 | Delete stale `COMPLETION.md` claims or align to real APIs | Stale docs | wasip1/wasip3 docs | S | Low |

**Exit criteria:** `npm run lint`, `npm run typecheck`, `npm run test:run` all green in CI;
WASIP1/WASIP3 have baseline coverage of the code paths Phase 2 will touch.

---

## Phase 1 — Shared abstractions

These are prerequisites that make the Phase 2 leak/isolation fixes small and uniform.

| # | Item | Finding | Files | Effort | Risk |
|---|------|---------|-------|--------|------|
| 1.1 | Promote generic `HandleTable<T>` (with `FinalizationRegistry`) to a shared module | ~40 hand-rolled handle tables | new `src/shared/handle-table.ts` (from `browser/webgpu/adapter.ts`) | M | Low |
| 1.2 | Migrate WASIP2 plugin registries to `HandleTable` (fs, io streams/pollables, sockets, http, kv, blobstore, sql, nn, messaging, ws-gateway) | dedup + missing-drop leaks | `src/wasip2/plugins/**` | L | Med |
| 1.3 | Migrate `browser/*` hand-rolled tables (dom, canvas, media, service-worker) to `HandleTable` | leak entries until lookup | `src/browser/*.ts` | M | Med |
| 1.4 | ✅ nn/sql/messaging/keyvalue Result types now alias shared `Result<T,E>`; keyvalue migrated off `{tag,val}`; constructors delegate to shared ok/err | Result reinvented per plugin | `src/shared/result.ts`, plugins | M | Med |
| 1.5 | ✅ Added `interfaceKey(iface)` + replaced 12 inline `` `${pkg}/${name}` `` constructions | duplicated key formula | `src/wasip2/core/types.ts` + callers | S | Low |

**Note:** 1.2/1.3 should be mechanical and test-covered; do them per-plugin in small PRs.
The `HandleTable` adoption directly fixes the WebGPU missing-drop leaks and the browser
`handleTo*` map leaks (no separate item needed once migrated, except adding the missing
`[resource-drop]` entries — see 3.5).

---

## Phase 2 — Critical correctness bugs

Highest-impact, smallest diffs. Each ships with a regression test.

| # | Item | Finding | Files | Effort | Risk |
|---|------|---------|-------|--------|------|
| 2.1 | Pass `globalPollableRegistry` (not `new PollableRegistry()`) to http/sockets/dns instances | HTTP/socket async broken (verified) | `http/outgoing-handler.ts:879,898`, `http/incoming-handler.ts`, `sockets/tcp.ts:570`, `sockets/udp.ts:497`, `sockets/ip-name-lookup.ts` | S | Low |
| 2.2 | Export `increment`/`getMany`/`setMany`/`deleteMany` + add `cas.*` in keyvalue `getImports()` (memory + idb) | atomics/batch dead (verified) | `keyvalue/impl-memory.ts:233`, `impl-idb.ts` | M | Low |
| 2.3 | URL-scheme allow-list in DOM `setAttribute` (reject `javascript:`/`data:`/`vbscript:` on url attrs) | DOM XSS (verified) | `browser/dom.ts:328`, `browser/gc-enhanced.ts:254` | M | Med |
| 2.4 | Thread a capability/allow-list policy through `BrowserImportsConfig`; gate each interface + privileged method; build only granted interfaces | capabilities never enforced | `browser/index.ts:751`, `browser/runtime.ts:362`, all interface modules | L | Med |
| 2.5 | Fix WASIP1 `path_open` to attach filesystem ref to directory entries | subdir fds return EBADF | `wasip1/path.ts:98,312` | M | Med |
| 2.6 | Normalize `..`/absolute paths and clamp to preopen root (return `ENOTCAPABLE`/error on escape) | path-traversal escape | `wasip1/path.ts:123`, `wasip1/memory-filesystem.ts:112`, `wasip2/.../impl-memory.ts:168` | M | Med |
| 2.7 | ✅ ws-gateway UDP: inbound datagrams routed to the per-socket queue via a per-stream boundary-preserving handler (connected/per-dest); pure-server receive still unsupported (no per-frame source addr) | UDP receive/send broken | `ws-gateway/udp-adapter.ts`, `tunnel-manager.ts` | L | Med |
| 2.8 | ✅ WASIP3 stream: pendingWrite drain (done earlier) + `error` status variant; source/sink errors no longer masked as EOF | deadlock + errors as EOF | `wasip3/canonical-abi/stream.ts`, `wasip3/types.ts`, `adapters/p2-to-p3.ts` | M | Med |
| 2.9 | Bound `payloadLen` against max frame size; cursor-based receive buffer | ws-gateway OOM DoS | `ws-gateway/tunnel-manager.ts:636`, `protocol.ts` | M | Med |
| 2.10 | Scope WASIP2 registries per-instance (pass through `PluginConfig`) instead of module singletons | cross-instance handle collision | `wasip2/plugins/**` global registries | L | High |
| 2.11 | Add `wasi:cli/terminal-*` to `createCliPolicy` | jco CLI components denied | `wasip2/core/policy.ts:247` | S | Low |
| 2.12 | Fix WASIP3 `executeSync` to surface subtask errors instead of empty values | async import errors vanish | `wasip3/runtime/async-executor.ts:127` | S | Low |
| 2.13 | Bounds-check WASIP1 memory read/write; return `EFAULT` instead of throwing `RangeError` | host trap on bad guest ptr | `wasip1/memory.ts:122,215` | S | Low |
| 2.14 | `set-times`/`path_filestat_set_times`: reject conflicting `*_NOW` + explicit flags (`EINVAL`) | spec conformance | `wasip1/fd.ts:371`, `wasip1/path.ts:210` | S | Low |
| 2.15 | Browser leaks: `worker.terminate` delete `workerInfo` + null handlers; make history/fullscreen/screen managers lazy or destroyable; cap geolocation/notification queues | unbounded growth / listener leaks | `browser/worker.ts:390`, `browser/index.ts:782`, `browser/geolocation.ts`, `browser/notifications.ts` | M | Low |
| 2.16 | Unify browser import ABI: return `Result` everywhere (fix `worker.ts` throwing) | divergent component-model ABI | `browser/worker.ts:795` | S | Med |
| 2.17 | OPFS exclusive-create: probe with `getFileHandle({create:false})` before create; wrap `renameAt` to avoid partial-rename data loss | wrong exclusivity / data loss | `filesystem/impl-opfs.ts:411,546` | M | Med |

**Sequencing within Phase 2:** 2.1, 2.2, 2.11, 2.12, 2.13, 2.14 first (trivial, verified).
2.10 depends on Phase 1.1–1.2 (per-instance `HandleTable`s). 2.3/2.4 are the security pair.

---

## Phase 3 — Missing / incomplete features

Larger. Some require a product decision (see "Decisions needed").

| # | Item | Finding | Files | Effort | Risk |
|---|------|---------|-------|--------|------|
| 3.1 | Node/Deno `hostfs` backend implementing the `Implementation` contract via `node:fs` | no host FS backend | new `filesystem/impl-node.ts`, `filesystem/plugin.ts` | L | Med |
| 3.2 | Symlink/hardlink support in memory FS (`SymlinkNode`), honor `symlinkFollow`; implement `link/symlink/readlink` | unimplemented everywhere | `filesystem/impl-memory.ts:1250` | L | Med |
| 3.3 | Streaming HTTP response body (wrap `response.body` ReadableStream) + enforce size cap during stream | full buffering / OOM | `http/outgoing-handler.ts:325`, `browser/fetch.ts:184` | M | Med |
| 3.4 | ✅ Wired ws-gateway tcp/udp/dns adapters as the opt-in `tunneled` impl on the standard sockets plugins (+ docstrings); `virtual` stays default | working path hidden | `sockets/plugin.ts` | M | Low |
| 3.5 | Add missing WebGPU `[resource-drop]` entries (texture-view, sampler, bind-group(-layout), pipeline-layout, shader-module, render/compute-pipeline, command-buffer); implement or error `create-query-set` | GPU handle leaks | `webgpu/plugin.ts:141` | M | Low |
| 3.6 | Expand WASIP3 filesystem to full `wasi:filesystem/types@0.3.0` (`open-at`, `*-at`, set-times/size, get-flags/type, metadata-hash, advise, sync) | only ~7/22 methods | `wasip3/interfaces/filesystem.ts:432` | L | Med |
| 3.7 | **Decision-gated:** real canonical ABI lift/lower over linear memory + handle tables, OR document P3 as jco-glue-only | P3 ABI is JS-object abstraction | `wasip3/canonical-abi/*`, `runtime/component-loader.ts` | XL | High |
| 3.8 | ✅ NN — added an opt-in `onnx` implementation backed by a host-provided ONNX Runtime (optional peer dep); real model load/compute, fake-`ort` unit tests | webnn default can't load models | `nn/impl-onnx.ts`, `nn/plugin.ts` | L–XL | Med |
| 3.9 | **Decision-gated:** SQL — adopt sql.js/WASM SQLite, or scope+document the subset and escape `LIKE`; add connection isolation | regex parser, no isolation | `sql/impl-memory.ts`, `sql/plugin.ts:14` | L–XL | Med |
| 3.10 | **Decision-gated:** messaging — honor TTL/durable/dead-letter + real request/reply correlation + topic cursors, or document as in-memory only | mock presented as real | `messaging/impl-memory.ts:246,315` | L | Med |
| 3.11 | ✅ `createIncomingHandler(handler).dispatch(request)` runs a handler end-to-end (Fetch Request→Response) — the Service Worker integration point | HTTP server stub | `http/incoming-handler.ts` | L | Med |
| 3.12 | ✅ OPFS `set-times`/`set-times-at` record a session sidecar (`OpfsTimesStore`); `stat`/`stat-at` reflect overrides | silent no-op returns ok | `filesystem/impl-opfs.ts` | M | Low |
| 3.13 | ✅ Manifest: `verifyComponentHash` (Web Crypto) + `validateExports` put the previously-unused fields to work | unused validation fields | `wasip2/core/manifest.ts` | M | Low |
| 3.14 | ✅ WASIP1 `poll_oneoff`: opt-in blocking (`blockingPoll`) waits for the earliest clock via `Atomics.wait`; non-blocking default documented | returns 0 events, busy-loops | `wasip1/poll.ts`, `wasip1/index.ts` | M | Med |
| 3.15 | ✅ `isWasmGcEnabled()` validates a GC struct module (real detection, memoized); `readEventRefs` returns honest NOT_SUPPORTED instead of empty success | GC tier unreachable | `browser/runtime.ts`, `browser/gc-enhanced.ts` | M | Low |

---

## Phase 4 — Optimizations

| # | Item | Finding | Files | Effort | Risk |
|---|------|---------|-------|--------|------|
| 4.1 | ✅ Capacity-doubling buffer for memory FS writes (`growFile`; content stays a logical-length view, amortized O(n) appends) | quadratic file writes | `filesystem/impl-memory.ts` | M | Med |
| 4.2 | Running size counter + avoid per-chunk copy in `MemoryOutputStream` | O(n²) size recompute | `io/streams.ts:241` | S | Low |
| 4.3 | Chunk `random.get-random-bytes` in ≤64KiB; remove cap on insecure/seeded | crash on len>64KiB | `random/impl-crypto.ts:28`, `impl-insecure.ts`, `impl-seeded.ts` | S | Low |
| 4.4 | ✅ `waitAll` is event-driven (finishTask notifier) instead of a 10ms poll; remaining setTimeouts are legitimate yields/poll-based-contract | CPU spin | `wasip3/runtime/async-executor.ts` | M | Med |
| 4.5 | ✅ Memoize `buildJcoImports` per loaded-interface set (cleared on destroy) | rebuilt every call | `wasip2/core/polyfill.ts` | S | Low |
| 4.6 | Module-level `TextEncoder`/`TextDecoder` singletons | per-call alloc in hot loops | `wasip1/memory.ts`, `wasip1/fd.ts:584`, `browser/types.ts:311` | S | Low |
| 4.7 | `StatCache.evictOldest`: delete first N Map keys (no sort) | full sort per insert | `shared/stat-cache.ts:176` | S | Low |
| 4.8 | ✅ OPFS `set-size` uses `writable.truncate` (O(1), no whole-file read); read/write already range-scoped; removed dead `useSyncAccessHandle` flag | slow per-write reopen | `filesystem/impl-opfs.ts` | M | Med |
| 4.9 | ✅ ws-gateway `ByteQueue`: head-index reads + amortized compaction instead of `Array.shift` | O(n) per read | `ws-gateway/byte-queue.ts` | S | Low |
| 4.10 | ✅ `fd_readdir`: per-fd directory snapshot reused across pages (refresh at cookie 0); shared TextEncoder | re-reads dir each call | `wasip1/fd.ts`, `wasip1/fd-table.ts` | M | Low |

---

## Phase 5 — Cross-cutting refactor / cleanup

| # | Item | Finding | Files | Effort | Risk |
|---|------|---------|-------|--------|------|
| 5.1 | ✅ `Wasip1.getImports()` generated by iterating fn groups + one `guard` wrapper (dropped ~180 lines) | hand-written passthroughs | `wasip1/index.ts` | M | Med |
| 5.2 | Extract `parseInterfaceList(items, kind)` for manifest import/export parsing | copy-paste | `wasip2/core/manifest.ts:77` | S | Low |
| 5.3 | Consolidate `createDevPolyfill`/`createJcoPolyfill`; fix jcoCompat docstring (store default on instance + apply in getImports) | identical / false doc | `wasip2/core/polyfill.ts:301` | S | Low |
| 5.4 | ✅ `buildJcoImports`: `makeMethodCallable`/`makePlainCallable` + `finishJcoCall`; single `parseImportKey` pass → `switch` | ~120-line fn, dup closures | `wasip2/core/polyfill.ts` | M | Med |
| 5.5 | ✅ Typed `FilesystemError` with POSIX `.code`; `mapError` maps by code (also covers native node:fs errors). Browser DOM-error heuristic left as-is (third-party errors) | brittle `e.message` matching | `wasip1/memory-filesystem.ts`, `wasip1/path.ts`, `wasip1/hostfs-node.ts` | M | Med |
| 5.6 | ✅ Added `withDescriptor(handle, fn)` on the memory fs (~24 methods deduped); sockets stubs left bespoke (lookup interleaved with state checks / NotSupported returns) | boilerplate per method | `filesystem/impl-memory.ts` | M | Low |
| 5.7 | Dedup `PluginRegistry.get`/`getSync` into shared `resolveLoaded`; dedup in-flight lazy-loader promise | dup logic + load race | `wasip2/core/plugin-registry.ts:61` | S | Low |
| 5.8 | ✅ Extracted `buildTunnelConfig(source)` (dedup tcp/udp/dns); `MultiError` rename already done | dup config / global shadow | `ws-gateway/tunnel-manager.ts`, `*-adapter.ts` | S | Low |
| 5.9 | Remove empty `src/browser/plugins/` dir; consolidate no-op mappers (geolocation/media/screen) | dead code | `browser/plugins/`, mappers | S | Low |
| 5.10 | Per-instance config staleness in `getOrCreateInstance` (compute config or document one-instance-per-iface contract); accept optional private `registry` in `PolyfillConfig` | stale config / global registry | `wasip2/core/polyfill.ts:82,258` | M | Med |

---

## Decisions needed (block Phase 3.7–3.10)

These change scope materially and should be settled before Phase 3:

1. **Mock backends (NN / SQL / messaging):** implement real backends, or relabel as
   dev/test-only and trim the docs/ROADMAP claims? (Recommendation: relabel now in Phase 0,
   implement opportunistically later.)
2. **WASIP3 canonical ABI (3.7):** invest in real lift/lower over linear memory, or
   officially scope P3 to jco-transpiled components? (Recommendation: scope to jco for now,
   document; revisit when Component Model async stabilizes.)
3. **ESLint strictness (0.1):** fix all violations to make lint required immediately, or
   ratchet (warn now, error over time)?

## Tracking

Each numbered item → one focused PR (or a small group for mechanical migrations).
Suggested labels: `phase-0`..`phase-5`, `security`, `correctness`, `perf`, `refactor`,
`docs`. Update the status column as work lands.
