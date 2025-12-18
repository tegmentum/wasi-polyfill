# WASI Preview 3 Implementation Plan

## Overview

WASI Preview 3 (wasip3) is the next major release of WASI, expected August 2025 (preview) with final release November 2025. The main theme is **composable concurrency** through native async support in the Component Model.

### Key Differences from P2

| Aspect | WASI P2 | WASI P3 |
|--------|---------|---------|
| Async model | `pollable` resources + `poll()` | Native async canonical ABI |
| I/O types | Resource-based streams | Built-in `stream<T>`, `future<T>` |
| Concurrency | Single component can poll at a time | Composable multi-component async |
| Interface complexity | 11 resource types (HTTP) | 5 resource types (HTTP) |
| Function coloring | Sync/async separate | Seamless interop |
| Waiting mechanism | Create pollable → add to list → poll → dispatch | Single async function call |

### Why P3?

P2's polling model has a fundamental limitation: when multiple components need to do I/O concurrently, only one can call `poll` at a time. P3 solves this with true async composition.

## Architecture

### Directory Structure

```
src/wasip3/
├── index.ts                    # Main entry point, Wasip3 class
├── types.ts                    # P3 types (stream, future, error-context)
├── canonical-abi/
│   ├── index.ts                # Canonical ABI async support
│   ├── task.ts                 # Task management (start, return, wait, poll)
│   ├── stream.ts               # stream<T> built-in implementation
│   ├── future.ts               # future<T> built-in implementation
│   └── subtask.ts              # Subtask state machine
├── adapters/
│   ├── p2-to-p3.ts             # Adapt P2 plugins to P3 interfaces
│   └── p3-to-p2.ts             # Adapt P3 interfaces for P2 consumers
├── interfaces/
│   ├── clocks.ts               # wasi:clocks@0.3.0
│   ├── random.ts               # wasi:random@0.3.0
│   ├── io.ts                   # wasi:io@0.3.0 (simplified)
│   ├── cli.ts                  # wasi:cli@0.3.0
│   ├── filesystem.ts           # wasi:filesystem@0.3.0
│   ├── sockets.ts              # wasi:sockets@0.3.0
│   └── http.ts                 # wasi:http@0.3.0
└── runtime/
    ├── async-executor.ts       # JavaScript async executor
    ├── component-loader.ts     # P3 component loading
    └── task-scheduler.ts       # Cross-component task scheduling
```

### Core Components

#### 1. Stream Type (`canonical-abi/stream.ts`)

The `stream<T>` type is a first-class built-in for async sequences:

```typescript
/**
 * Built-in stream type for async sequences of values.
 * Replaces P2's wasi:io/streams resource-based approach.
 */
export interface Stream<T> {
  /**
   * Read values from the stream.
   * Returns when at least one value is available or stream closes.
   */
  read(): Promise<StreamReadResult<T>>

  /**
   * Write values to the stream.
   * Returns when values are accepted (may buffer).
   */
  write(values: T[]): Promise<StreamWriteResult>

  /**
   * Close the stream (no more writes).
   */
  close(): void

  /**
   * Cancel the stream (abort pending operations).
   */
  cancel(): void
}

export type StreamReadResult<T> =
  | { status: 'values'; values: T[] }
  | { status: 'end' }
  | { status: 'cancelled' }

export type StreamWriteResult =
  | { status: 'ok'; count: number }
  | { status: 'closed' }
  | { status: 'cancelled' }

/**
 * Create a bidirectional stream pair (read end, write end).
 */
export function createStream<T>(): [StreamReader<T>, StreamWriter<T>]
```

#### 2. Future Type (`canonical-abi/future.ts`)

The `future<T>` type is a first-class built-in for single async values:

```typescript
/**
 * Built-in future type for single async value.
 * Similar to Promise but with cancellation support.
 */
export interface Future<T> {
  /**
   * Read the future's value.
   * Returns when value is available.
   */
  read(): Promise<FutureReadResult<T>>

  /**
   * Cancel the future.
   */
  cancel(): void
}

export type FutureReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'cancelled' }

/**
 * Create a future and its resolver.
 */
export function createFuture<T>(): [Future<T>, FutureResolver<T>]

export interface FutureResolver<T> {
  resolve(value: T): void
  reject(error: Error): void
}
```

#### 3. Task Management (`canonical-abi/task.ts`)

Tasks are the execution context for async component functions:

```typescript
/**
 * Task built-in functions for async canonical ABI.
 */
export interface TaskBuiltins {
  /**
   * Signal that a task has started and is ready to process.
   * Called by callee at start of async export.
   */
  'task.start'(): void

  /**
   * Signal task completion with return values.
   * Called by callee to complete async export.
   */
  'task.return'(values: unknown[]): void

  /**
   * Block until progress can be made on async operations.
   * Returns events describing what became ready.
   */
  'task.wait'(): Promise<TaskEvent[]>

  /**
   * Non-blocking check for progress on async operations.
   * Returns empty array if nothing ready.
   */
  'task.poll'(): TaskEvent[]

  /**
   * Yield execution to other tasks.
   */
  'task.yield'(): Promise<void>
}

export interface TaskEvent {
  type: 'stream-read' | 'stream-write' | 'future-read' | 'subtask-done'
  handle: number
  payload?: unknown
}
```

#### 4. Subtask State Machine (`canonical-abi/subtask.ts`)

Subtasks track the state of called async functions:

```typescript
/**
 * Subtask states in the async canonical ABI.
 */
export type SubtaskState =
  | 'starting'    // Call initiated, callee not yet started
  | 'started'     // Callee called task.start
  | 'returned'    // Callee called task.return
  | 'done'        // Caller acknowledged completion

export interface Subtask {
  state: SubtaskState
  returnValues?: unknown[]
  onStateChange: (state: SubtaskState) => void
}

/**
 * Manage subtasks for a parent task.
 */
export class SubtaskManager {
  create(call: () => Promise<void>): SubtaskHandle
  poll(handle: SubtaskHandle): SubtaskState
  wait(handle: SubtaskHandle): Promise<SubtaskState>
  getReturnValues(handle: SubtaskHandle): unknown[] | undefined
}
```

### Async/Sync Interop

P3's key innovation is seamless interop between sync and async functions:

```typescript
/**
 * Async/sync boundary handling.
 *
 * - Sync export calling async import: Runtime blocks (with task.wait)
 * - Async export calling sync import: Direct call
 * - Async export calling async import: Returns subtask handle
 */
export interface AsyncSyncBridge {
  /**
   * Call an async import from a sync context.
   * Blocks the current task until result is available.
   */
  callAsyncFromSync<T>(
    asyncFn: () => Promise<T>
  ): T

  /**
   * Call a sync import from an async context.
   * Just a direct call, returns immediately.
   */
  callSyncFromAsync<T>(
    syncFn: () => T
  ): T

  /**
   * Start an async call, returning a subtask handle.
   * Caller can continue and poll/wait for completion.
   */
  startAsyncCall(
    asyncFn: () => Promise<unknown[]>
  ): SubtaskHandle
}
```

## Interface Changes from P2

### wasi:io@0.3.0 (Simplified)

P3 removes most of `wasi:io` since `stream<T>` and `future<T>` are built-ins:

```wit
// P2 wasi:io/streams (being replaced)
interface streams {
  resource input-stream { ... }
  resource output-stream { ... }
}

// P2 wasi:io/poll (being replaced)
interface poll {
  resource pollable { ... }
  poll: func(in: list<borrow<pollable>>) -> list<u32>
}

// P3 wasi:io@0.3.0 - Dramatically simplified
interface error {
  resource error-context {
    get-debug-message: func() -> string
  }
}
// stream<T> and future<T> are now built-in types!
```

### wasi:http@0.3.0 (5 vs 11 Resource Types)

```wit
// P3 HTTP - much simpler with native async
interface handler {
  // Single async function replaces complex polling ceremony
  handle: async func(request: request) -> result<response, error-code>
}

interface types {
  resource request { ... }
  resource response { ... }
  resource fields { ... }
  resource body { ... }      // Uses stream<u8> instead of pollables
  resource trailers { ... }
}
// That's it! P2 has: incoming-request, outgoing-request,
// incoming-response, outgoing-response, request-options,
// incoming-body, outgoing-body, future-incoming-response,
// future-trailers, response-outparam, plus all the pollables
```

### wasi:filesystem@0.3.0

```wit
// P3 - Async file operations
interface types {
  resource descriptor {
    // These return futures/streams instead of pollables
    read: async func(len: u64, offset: u64) -> result<list<u8>, error-code>
    write: async func(data: list<u8>, offset: u64) -> result<u64, error-code>

    // Directory iteration uses stream
    read-directory: func() -> stream<directory-entry>
  }
}
```

### wasi:sockets@0.3.0

```wit
// P3 - Native async sockets
interface tcp {
  resource tcp-socket {
    // Async connect instead of start-connect + poll
    connect: async func(network: borrow<network>, addr: ip-socket-address)
      -> result<(stream<u8>, stream<u8>), error-code>

    // Returns streams directly
    accept: async func() -> result<(tcp-socket, stream<u8>, stream<u8>), error-code>
  }
}
```

## Implementation Phases

### Phase 1: Canonical ABI Async Core (~600 LOC)

Implement the async canonical ABI infrastructure:

- `stream<T>` type with read/write/close/cancel
- `future<T>` type with read/cancel
- Task built-ins (start, return, wait, poll, yield)
- Subtask state machine
- Basic async executor integration with JavaScript

### Phase 2: Async/Sync Bridge (~400 LOC)

Implement seamless interop:

- Sync-to-async bridging (blocking wait)
- Async-to-sync bridging (direct call)
- Subtask management for concurrent async calls
- Event dispatching for ready operations

### Phase 3: P2 Adapter Layer (~500 LOC)

Create adapters to reuse P2 plugin implementations:

```typescript
/**
 * Wrap a P2 plugin to expose P3 interfaces.
 * Converts pollable-based async to native async.
 */
export function adaptP2ToP3<T extends WasiPlugin>(
  p2Plugin: T
): P3Plugin

/**
 * Example: Adapt P2 streams to P3 stream<u8>
 */
export function adaptInputStream(
  p2Stream: InputStreamResource
): Stream<Uint8Array>

export function adaptOutputStream(
  p2Stream: OutputStreamResource
): StreamWriter<Uint8Array>
```

### Phase 4: Simplified Interfaces (~800 LOC)

Implement P3-native interfaces:

1. **wasi:io@0.3.0** - Error context only (streams are built-in)
2. **wasi:clocks@0.3.0** - Same as P2 but with async sleep
3. **wasi:random@0.3.0** - Mostly unchanged
4. **wasi:cli@0.3.0** - Async stdin with stream<u8>
5. **wasi:filesystem@0.3.0** - Async file operations

### Phase 5: HTTP and Sockets (~700 LOC)

The interfaces that benefit most from P3:

1. **wasi:http@0.3.0** - Simplified handler with async func
2. **wasi:sockets@0.3.0** - Native async connect/accept/read/write

### Phase 6: Component Loader (~400 LOC)

Load and instantiate P3 components:

```typescript
export class Wasip3ComponentLoader {
  /**
   * Load a P3 component, providing WASI imports.
   */
  async load(
    component: ArrayBuffer,
    config: Wasip3Config
  ): Promise<Wasip3Instance>
}

export interface Wasip3Instance {
  /**
   * Call an exported async function.
   */
  callAsync<T>(name: string, args: unknown[]): Promise<T>

  /**
   * Call an exported sync function.
   */
  callSync<T>(name: string, args: unknown[]): T

  /**
   * Start the component (if it has a wasi:cli/run export).
   */
  run(): Promise<number>
}
```

## JavaScript Runtime Considerations

### Async Executor

P3's async model maps naturally to JavaScript's:

```typescript
/**
 * Map P3 async to JavaScript Promises.
 *
 * - stream.read() -> awaitable Promise
 * - future.read() -> awaitable Promise
 * - task.wait() -> Promise that resolves when any operation ready
 */
export class P3AsyncExecutor {
  private pending: Map<number, PendingOperation>

  /**
   * Execute an async component function.
   * Returns a Promise that resolves with the return values.
   */
  execute(fn: WasmAsyncFunction): Promise<unknown[]> {
    // 1. Call the function
    // 2. If it returns BLOCKED, await task.wait()
    // 3. Continue until task.return is called
    // 4. Return the values
  }
}
```

### Stream Implementation

```typescript
/**
 * Browser-native stream implementation using ReadableStream/WritableStream.
 */
export function createBrowserStream<T>(): [Stream<T>, StreamWriter<T>] {
  // Use TransformStream for buffering
  const { readable, writable } = new TransformStream<T>()

  const reader: Stream<T> = {
    async read() {
      const reader = readable.getReader()
      const { value, done } = await reader.read()
      reader.releaseLock()
      if (done) return { status: 'end' }
      return { status: 'values', values: [value] }
    },
    // ...
  }

  const writer: StreamWriter<T> = {
    async write(values) {
      const writer = writable.getWriter()
      for (const v of values) await writer.write(v)
      writer.releaseLock()
      return { status: 'ok', count: values.length }
    },
    // ...
  }

  return [reader, writer]
}
```

## Tooling Dependencies

### Required for P3 Support

1. **jco with P3 support** - JavaScript component tooling
   - Status: In development
   - Needed for: Transpiling P3 components to JS

2. **wasm-tools >=1.227.1** - Component parsing
   - Status: Released
   - Needed for: Parsing async components

3. **Component Model async spec** - Finalized design
   - Status: Near complete
   - Needed for: Canonical ABI implementation

### Integration with jco

```typescript
// Once jco supports P3, transpilation will handle async
import { transpile } from '@bytecodealliance/jco'

const js = await transpile(p3ComponentBytes, {
  // P3 async mode
  asyncMode: 'native', // or 'promise' for JS integration
  map: {
    'wasi:clocks/*@0.3.0': '@tegmentum/wasi-polyfill/wasip3/clocks',
    'wasi:io/*@0.3.0': '@tegmentum/wasi-polyfill/wasip3/io',
    // ...
  }
})
```

## Migration Strategy

### Supporting Both P2 and P3

```typescript
// Unified entry point detects version
import { createPolyfill } from '@tegmentum/wasi-polyfill'

const polyfill = createPolyfill({
  // Auto-detect or specify version
  version: 'auto', // 'p2' | 'p3' | 'auto'

  // Config applies to detected version
  args: ['program'],
  env: { HOME: '/home' },
})

// Works with either P2 or P3 components
const instance = await polyfill.instantiate(componentBytes)
```

### P2 Plugin Reuse

Most P2 plugin logic can be reused:

```typescript
// Filesystem implementation is the same
// Only the async wrapper changes

// P2 version
class FilesystemP2 {
  read(fd, len, offset) {
    return this.backend.read(fd, len, offset)
  }
}

// P3 version - wraps with async
class FilesystemP3 {
  async read(fd, len, offset) {
    return this.backend.read(fd, len, offset)
  }
}

// Shared backend
class FilesystemBackend {
  read(fd, len, offset) {
    // Actual implementation
  }
}
```

## Testing Strategy

### Unit Tests

- Stream type operations (read, write, close, cancel)
- Future type operations (read, resolve, cancel)
- Task state machine transitions
- Async/sync bridging
- Subtask management

### Integration Tests

- Load and run P3 components (once tooling available)
- Test async HTTP handler
- Test concurrent component composition
- Test P2-to-P3 adapters

### Compatibility Tests

- Compare behavior with Wasmtime P3 implementation
- Test real P3 components from wasip3-prototyping

## Timeline Considerations

WASI P3 is currently in development:

- **August 2025**: Expected preview release (0.3.0-rc)
- **November 2025**: Expected final release (0.3.0)
- **2026**: WASI 1.0 based on P3

Our implementation should track the evolving specification. Initial focus:

1. **Now**: Implement core types and async executor
2. **Pre-preview**: Implement P2 adapters for early testing
3. **Post-preview**: Align with final interface definitions
4. **Post-release**: Full P3-native implementation

## Notes

1. **Specification stability**: P3 WIT definitions are still marked as draft (`0.3.0-draft`). Final definitions may change.

2. **Tooling availability**: Full P3 support in jco is in progress. Some features may require polyfilling until tooling catches up.

3. **Browser compatibility**: P3's async model maps well to JavaScript Promises. Browser streams (ReadableStream/WritableStream) can back `stream<T>`.

4. **Cancellation**: P3 adds proper cancellation support. This maps to AbortController in browsers.

5. **Error contexts**: P3 introduces `error-context` resources for richer error information across component boundaries.

## Sources

- [Looking Ahead to WASIp3](https://www.fermyon.com/blog/looking-ahead-to-wasip3)
- [WASI.dev Roadmap](https://wasi.dev/roadmap)
- [WASI and Component Model: Current Status](https://eunomia.dev/blog/2025/02/16/wasi-and-the-webassembly-component-model-current-status/)
- [WebAssembly Component Model Repository](https://github.com/WebAssembly/component-model)
- [WASIp3 Prototyping Repository](https://github.com/bytecodealliance/wasip3-prototyping)
- [Making the first WASIp3 snapshot](https://github.com/WebAssembly/WASI/issues/666)
- [jco - JavaScript Component Toolchain](https://github.com/bytecodealliance/jco)
