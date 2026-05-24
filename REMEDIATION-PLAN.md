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

Remaining (large / dependency-bearing, best as dedicated PRs):
- **Phase 1 full migration** of ~40 hand-rolled tables to the existing
  `shared/registry.ts` HandleRegistry (mechanical, large).
- **2.4** browser capability enforcement; **2.5–2.9** (wasip1 path_open/traversal,
  ws-gateway UDP/framing); **2.10** per-instance registries (high-risk overhaul).
- **2.16/2.17** worker import ABI; OPFS atomicity.
- **3.2** symlinks (wasip2), **3.3** streaming HTTP, **3.6** P3 fs methods,
  **3.7** document P3-jco scope.
- **3.8–3.10 real backends** (NN onnx-runtime-web, SQL sql.js/SQLite-WASM,
  messaging durability) — these add heavy external dependencies and an async
  init model; flagged for an explicit dependency decision before adding.

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
| 1.4 | Standardize on shared `Result<T,E>` + ok/err helpers; remove per-plugin `kvOk/sqlOk/nnOk/msgOk` and `{ok:boolean}` vs `{tag}` divergence | Result reinvented per plugin | `src/shared/result.ts`, plugins | M | Med |
| 1.5 | Add `interfaceKey(iface)` helper; replace 5+ inline `` `${pkg}/${name}` `` constructions | duplicated key formula | `src/wasip2/core/types.ts` + callers | S | Low |

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
| 2.7 | ws-gateway UDP: route inbound datagrams to per-socket queue; key outbound streams by destination | UDP receive/send broken | `ws-gateway/udp-adapter.ts:573,663`, `tunnel-manager.ts` | L | Med |
| 2.8 | WASIP3 stream: drain `pendingWrite` unconditionally on read; add `error` status variant | deadlock + errors as EOF | `wasip3/canonical-abi/stream.ts:86,296`, `adapters/p2-to-p3.ts:96` | M | Med |
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
| 3.4 | Wire `sockets/tcp`/`udp` stubs to the ws-gateway adapters (register as alternate impls) + document | working path hidden | `sockets/plugin.ts`, stub docstrings | M | Low |
| 3.5 | Add missing WebGPU `[resource-drop]` entries (texture-view, sampler, bind-group(-layout), pipeline-layout, shader-module, render/compute-pipeline, command-buffer); implement or error `create-query-set` | GPU handle leaks | `webgpu/plugin.ts:141` | M | Low |
| 3.6 | Expand WASIP3 filesystem to full `wasi:filesystem/types@0.3.0` (`open-at`, `*-at`, set-times/size, get-flags/type, metadata-hash, advise, sync) | only ~7/22 methods | `wasip3/interfaces/filesystem.ts:432` | L | Med |
| 3.7 | **Decision-gated:** real canonical ABI lift/lower over linear memory + handle tables, OR document P3 as jco-glue-only | P3 ABI is JS-object abstraction | `wasip3/canonical-abi/*`, `runtime/component-loader.ts` | XL | High |
| 3.8 | **Decision-gated:** NN — make `mock` (or onnx-runtime-web) the default, or implement WebNN graph loading; document clearly | webnn default can't load models | `nn/impl-webnn.ts:289`, `nn/plugin.ts` | L–XL | Med |
| 3.9 | **Decision-gated:** SQL — adopt sql.js/WASM SQLite, or scope+document the subset and escape `LIKE`; add connection isolation | regex parser, no isolation | `sql/impl-memory.ts`, `sql/plugin.ts:14` | L–XL | Med |
| 3.10 | **Decision-gated:** messaging — honor TTL/durable/dead-letter + real request/reply correlation + topic cursors, or document as in-memory only | mock presented as real | `messaging/impl-memory.ts:246,315` | L | Med |
| 3.11 | Implement `incoming-handler` (Service Worker) or mark experimental/stub clearly | HTTP server stub | `http/incoming-handler.ts` | L | Med |
| 3.12 | OPFS `set-times` and metadata: sidecar metadata store or return `Unsupported` (stop pretending) | silent no-op returns ok | `filesystem/impl-opfs.ts:191` | M | Low |
| 3.13 | Manifest: implement `componentHash` verification + export-availability checks, or remove the dead fields | unused validation fields | `wasip2/core/manifest.ts:219` | M | Low |
| 3.14 | WASIP1 `poll_oneoff`: pick earliest clock; flag the no-block limitation loudly (or async via JSPI) | returns 0 events, busy-loops | `wasip1/poll.ts:84` | M | Med |
| 3.15 | `isWasmGcEnabled()` real detection (or document the GC tier as disabled) + implement/remove `readEventRefs` stub | GC tier unreachable | `browser/runtime.ts:81`, `browser/gc-enhanced.ts:408` | M | Low |

---

## Phase 4 — Optimizations

| # | Item | Finding | Files | Effort | Risk |
|---|------|---------|-------|--------|------|
| 4.1 | Capacity-doubling / chunked buffer for memory FS writes (kill O(n²)) | quadratic file writes | `filesystem/impl-memory.ts:55` | M | Med |
| 4.2 | Running size counter + avoid per-chunk copy in `MemoryOutputStream` | O(n²) size recompute | `io/streams.ts:241` | S | Low |
| 4.3 | Chunk `random.get-random-bytes` in ≤64KiB; remove cap on insecure/seeded | crash on len>64KiB | `random/impl-crypto.ts:28`, `impl-insecure.ts`, `impl-seeded.ts` | S | Low |
| 4.4 | Replace `setTimeout(0)` busy-polls with `SubtaskManager.onStateChange` callbacks | CPU spin | `wasip3/runtime/async-executor.ts:234`, `adapters/p2-to-p3.ts:228` | M | Med |
| 4.5 | Memoize `buildJcoImports` per interface set (per Polyfill instance) | rebuilt every call | `wasip2/core/polyfill.ts:528` | S | Low |
| 4.6 | Module-level `TextEncoder`/`TextDecoder` singletons | per-call alloc in hot loops | `wasip1/memory.ts`, `wasip1/fd.ts:584`, `browser/types.ts:311` | S | Low |
| 4.7 | `StatCache.evictOldest`: delete first N Map keys (no sort) | full sort per insert | `shared/stat-cache.ts:176` | S | Low |
| 4.8 | OPFS: use `FileSystemSyncAccessHandle` (worker) for random access; stop reading whole file for `set-size` | slow per-write reopen | `filesystem/impl-opfs.ts:236` | M | Med |
| 4.9 | ws-gateway `ByteQueue`: index-based read instead of `Array.shift`; avoid defensive `slice` when caller owns buffer | O(n) per read | `ws-gateway/byte-queue.ts:83` | S | Low |
| 4.10 | `fd_readdir`: cache directory snapshot per-fd/cookie (kill O(n²) paging) | re-reads dir each call | `wasip1/fd.ts:573` | M | Low |

---

## Phase 5 — Cross-cutting refactor / cleanup

| # | Item | Finding | Files | Effort | Risk |
|---|------|---------|-------|--------|------|
| 5.1 | Generate `Wasip1.getImports()` by iterating fn maps + one guard wrapper (drop ~180 lines) | hand-written passthroughs | `wasip1/index.ts:255` | M | Med |
| 5.2 | Extract `parseInterfaceList(items, kind)` for manifest import/export parsing | copy-paste | `wasip2/core/manifest.ts:77` | S | Low |
| 5.3 | Consolidate `createDevPolyfill`/`createJcoPolyfill`; fix jcoCompat docstring (store default on instance + apply in getImports) | identical / false doc | `wasip2/core/polyfill.ts:301` | S | Low |
| 5.4 | Refactor `buildJcoImports` into one `makeWrappedCallable` helper; single regex parse per key | ~120-line fn, dup closures | `wasip2/core/polyfill.ts:528` | M | Med |
| 5.5 | Typed `FilesystemError` with numeric `code`; remove substring-based errno mapping | brittle `e.message` matching | `wasip1/path.ts:488`, `wasip1/io.ts:95`, `browser/types.ts:114` | M | Med |
| 5.6 | Extract `withDescriptor`/`withSocket`/`withObject(table,handle,fn)` guard helpers (remove ~30 repeated null-checks) | boilerplate per method | fs/sockets/browser plugins | M | Low |
| 5.7 | Dedup `PluginRegistry.get`/`getSync` into shared `resolveLoaded`; dedup in-flight lazy-loader promise | dup logic + load race | `wasip2/core/plugin-registry.ts:61` | S | Low |
| 5.8 | Extract `buildTunnelConfig(options)`; rename custom `AggregateError`→`MultiError` | dup config / global shadow | `ws-gateway/*-adapter.ts`, `shared/error-utils.ts:399` | S | Low |
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
