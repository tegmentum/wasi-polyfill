# Roadmap

This document outlines the planned development roadmap for `@tegmentum/wasi-polyfill`.

## Current Status

### Completed

- **WASI Preview 2 (wasip2)** - Full plugin-based implementation
  - Core framework with policy engine and plugin registry
  - All standard WASI 0.2.x interfaces (random, clocks, io, cli, filesystem, http, sockets)
  - Extended interfaces (threads, logging, keyvalue, blobstore, config)
  - WebSocket gateway for TCP/UDP in browsers
  - Component introspection and manifest generation
  - Testing harness for deterministic tests
  - Proxy architecture for remote WASI execution

- **WASI Preview 1 (wasip1)** - Complete implementation
  - All 45+ `wasi_snapshot_preview1` functions
  - Memory utilities, file descriptor table, virtual filesystem
  - Clock, random, poll, and process control
  - Custom I/O streams support

- **WASI Preview 3 (wasip3)** - Async Component Model support **(jco-scoped)**
  - Canonical ABI async primitives (`stream<T>`, `future<T>`, task, subtask)
    modeled as JavaScript objects
  - Async executor with event loop
  - P2-to-P3 adapters for reusing existing plugins
  - Simplified P3-native interfaces (io, clocks, random, cli, filesystem, http, sockets)
  - Component loader for **jco-transpiled** modules
  - **Scope:** targets jco-transpiled components; does not yet implement the
    real canonical ABI (linear-memory lift/lower + handle tables), so raw P3
    component binaries can't be instantiated directly. See
    `src/wasip3/index.ts` for details.

---

## Planned Work

### Browser Host Interfaces (`browser:*`)

**Status**: ✅ Implementation Complete | **Priority**: High

Capability-scoped browser interfaces for WebAssembly components with wasmGC-aware optimizations.

**Design Document**: [docs/design/browser-interfaces.md](docs/design/browser-interfaces.md)

#### Phases

| Phase | Interfaces | Status |
|-------|-----------|--------|
| Phase 0 | `browser:types`, `browser:runtime`, `browser:console` | ✅ Complete |
| Phase 1 | `browser:fetch`, `browser:storage`, `browser:performance` | ✅ Complete |
| Phase 2 | `browser:dom`, `browser:events` | ✅ Complete |
| Phase 3 | `browser:canvas` | ✅ Complete |
| Phase 4 | `browser:clipboard`, `browser:geolocation`, `browser:notifications`, `browser:media` | ✅ Complete |
| Phase 5 | `browser:service-worker` (experimental) | ✅ Complete |
| Parallel | wasmGC-enhanced tier for events and DOM | ✅ Complete |

#### Key Features

- **15 browser interface packages** covering DOM, events, canvas, storage, networking, media, and more
- **Dual-mode implementation**: Baseline (no wasmGC) + optional wasmGC fast path
- **Capability-scoped security**: Explicit permission grants, secure context enforcement
- **Async-native**: Native `future<T>` and `stream<T>` integration
- **Cross-browser compatibility**: Feature detection with graceful degradation

#### Design Decisions (Resolved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Async ABI | `future`/`stream` | Aligns with WASIP3, more ergonomic |
| Event backpressure | Drop oldest | UI responsiveness, fresh events preferred |
| DOM scope (v0) | Structural only | Smaller surface, add style in v0.2 |
| Storage backing | IndexedDB only | Consistent async, handles large values |
| Canvas strategy | Command buffers | Performance, fewer boundary crossings |
| wasmGC surface | Single API, optimized backing | Stable surface, transparent optimization |

See [docs/design/browser-interfaces.md](docs/design/browser-interfaces.md#14-design-decisions) for detailed rationale.

---

### Future Considerations

#### WebGPU/WebGL Support
- ✅ `browser:webgpu` interface complete with full GPU compute and rendering support
- Comprehensive handle management for adapters, devices, buffers, textures, pipelines
- Command batching for efficient render/compute passes

#### Worker Thread Support
- ✅ `browser:worker` interface complete for spawning Web Workers
- SharedArrayBuffer support for parallel computation
- MessageChannel for worker-to-worker communication

#### WebAssembly Component Model 1.0
- Track upstream Component Model specification progress
- Adopt standardized async semantics when finalized

#### Additional WASI Worlds
- ✅ `wasi:nn` - Neural network inference (WebNN and mock backends)
- ✅ `wasi:messaging` - Message queue interfaces (in-memory broker)
- ✅ `wasi:sql` - Database access interfaces (in-memory SQL engine)

---

## Contributing

We welcome contributions! Areas where help is particularly needed:

1. **Browser interface implementations** - Help build `browser:*` interfaces
2. **wasmGC optimization** - Performance improvements for GC-enabled components
3. **Testing** - Browser compatibility testing across Chrome, Firefox, Safari
4. **Documentation** - Examples and API documentation

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines (if it exists, or open an issue to discuss).

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| 0.1.0 | 2025 | Initial release with WASIP1, WASIP2, WASIP3 support |
