# WASI Preview 1 Implementation Plan

## Overview

WASI Preview 1 (wasip1) is the legacy WASI API used by older WebAssembly modules. It uses a flat function import model with integer file descriptors, as opposed to P2's component model with typed handles.

### Key Differences from P2

| Aspect | WASI P1 | WASI P2 |
|--------|---------|---------|
| Import namespace | `wasi_snapshot_preview1` | `wasi:*/interface@version` |
| Model | Flat functions | Component Model |
| Resources | Integer file descriptors | Typed handles |
| Memory access | Direct linear memory (i32 pointers) | Structured types |
| Strings | Pointer + length pairs | First-class strings |
| Error handling | Integer errno codes | Result types |
| API style | Synchronous, C-like | Async-friendly |

## Architecture

### Directory Structure

```
src/wasip1/
├── index.ts              # Main entry point, Wasip1 class
├── types.ts              # P1 types (errno, clockid, fdflags, etc.)
├── memory.ts             # Linear memory read/write helpers
├── fd-table.ts           # File descriptor table management
├── args-environ.ts       # args_* and environ_* functions
├── clock.ts              # clock_* functions
├── fd.ts                 # fd_* functions (I/O operations)
├── path.ts               # path_* functions (filesystem operations)
├── random.ts             # random_get function
├── poll.ts               # poll_oneoff function
├── proc.ts               # proc_exit, proc_raise functions
├── sock.ts               # sock_* functions (optional sockets)
└── adapters/
    ├── streams.ts        # Adapter to use P2 stream backends
    ├── filesystem.ts     # Adapter to use P2 filesystem backends
    └── clocks.ts         # Adapter to use P2 clock backends
```

### Core Components

#### 1. Memory Helper (`memory.ts`)

Provides utilities for reading/writing to WebAssembly linear memory:

```typescript
export class WasiMemory {
  private view: DataView
  private bytes: Uint8Array

  constructor(memory: WebAssembly.Memory)

  // Attach to memory (call after instantiation)
  attach(memory: WebAssembly.Memory): void

  // Read operations
  readU8(ptr: number): number
  readU16(ptr: number): number
  readU32(ptr: number): number
  readU64(ptr: number): bigint
  readBytes(ptr: number, len: number): Uint8Array
  readString(ptr: number, len: number): string
  readIovec(ptr: number, count: number): Array<{buf: number, len: number}>
  readCiovec(ptr: number, count: number): Array<{buf: number, len: number}>

  // Write operations
  writeU8(ptr: number, value: number): void
  writeU16(ptr: number, value: number): void
  writeU32(ptr: number, value: number): void
  writeU64(ptr: number, value: bigint): void
  writeBytes(ptr: number, data: Uint8Array): void
  writeString(ptr: number, str: string): number // returns bytes written
}
```

#### 2. File Descriptor Table (`fd-table.ts`)

Manages the mapping from integer file descriptors to resources:

```typescript
export interface FdEntry {
  type: 'stdin' | 'stdout' | 'stderr' | 'file' | 'directory' | 'socket'
  rights: {
    base: bigint
    inheriting: bigint
  }
  flags: number

  // For files/directories
  path?: string
  preopen?: string  // Preopen name if this is a preopen
  position?: bigint

  // Underlying resource (from P2 adapters)
  resource?: unknown
}

export class FileDescriptorTable {
  private fds: Map<number, FdEntry>
  private nextFd: number

  constructor()

  // Reserve stdio fds
  initStdio(stdin: FdEntry, stdout: FdEntry, stderr: FdEntry): void

  // Allocate a new fd
  allocate(entry: FdEntry): number

  // Get/set/close
  get(fd: number): FdEntry | undefined
  set(fd: number, entry: FdEntry): void
  close(fd: number): boolean

  // Renumber (dup2-like)
  renumber(from: number, to: number): boolean

  // List preopens
  getPreopens(): Array<{fd: number, path: string}>
}
```

#### 3. Types (`types.ts`)

Define all WASI P1 types and constants:

```typescript
// Error codes
export const enum Errno {
  SUCCESS = 0,
  E2BIG = 1,
  EACCES = 2,
  EADDRINUSE = 3,
  // ... all 76 errno values
  ENOTCAPABLE = 76,
}

// Clock IDs
export const enum ClockId {
  REALTIME = 0,
  MONOTONIC = 1,
  PROCESS_CPUTIME_ID = 2,
  THREAD_CPUTIME_ID = 3,
}

// File descriptor flags
export const enum FdFlags {
  APPEND = 1 << 0,
  DSYNC = 1 << 1,
  NONBLOCK = 1 << 2,
  RSYNC = 1 << 3,
  SYNC = 1 << 4,
}

// Rights
export const enum Rights {
  FD_DATASYNC = 1n << 0n,
  FD_READ = 1n << 1n,
  FD_SEEK = 1n << 2n,
  // ... all rights
}

// File types
export const enum FileType {
  UNKNOWN = 0,
  BLOCK_DEVICE = 1,
  CHARACTER_DEVICE = 2,
  DIRECTORY = 3,
  REGULAR_FILE = 4,
  SOCKET_DGRAM = 5,
  SOCKET_STREAM = 6,
  SYMBOLIC_LINK = 7,
}

// Whence for seek
export const enum Whence {
  SET = 0,
  CUR = 1,
  END = 2,
}

// Prestat type
export const enum PrestatType {
  DIR = 0,
}

// Structures
export interface Filestat {
  dev: bigint
  ino: bigint
  filetype: FileType
  nlink: bigint
  size: bigint
  atim: bigint
  mtim: bigint
  ctim: bigint
}

export interface Fdstat {
  filetype: FileType
  flags: FdFlags
  rightsBase: bigint
  rightsInheriting: bigint
}
```

## Function Implementation

### Phase 1: Core Infrastructure

#### args_sizes_get / args_get
```typescript
// args_sizes_get(argc_ptr: i32, argv_buf_size_ptr: i32) -> errno
// args_get(argv_ptr: i32, argv_buf_ptr: i32) -> errno
```

#### environ_sizes_get / environ_get
```typescript
// environ_sizes_get(environc_ptr: i32, environ_buf_size_ptr: i32) -> errno
// environ_get(environ_ptr: i32, environ_buf_ptr: i32) -> errno
```

#### proc_exit
```typescript
// proc_exit(code: i32) -> noreturn
```

### Phase 2: Clock & Random

#### clock_res_get / clock_time_get
```typescript
// clock_res_get(clock_id: i32, resolution_ptr: i32) -> errno
// clock_time_get(clock_id: i32, precision: i64, time_ptr: i32) -> errno
```

Adapter: Reuse P2 `wasi:clocks/monotonic-clock` and `wasi:clocks/wall-clock`

#### random_get
```typescript
// random_get(buf_ptr: i32, buf_len: i32) -> errno
```

Adapter: Reuse P2 `wasi:random/random`

### Phase 3: File Descriptor I/O

#### fd_read / fd_write
```typescript
// fd_read(fd: i32, iovs_ptr: i32, iovs_len: i32, nread_ptr: i32) -> errno
// fd_write(fd: i32, iovs_ptr: i32, iovs_len: i32, nwritten_ptr: i32) -> errno
```

Adapter: Reuse P2 `wasi:io/streams` via stdio provider

#### fd_close
```typescript
// fd_close(fd: i32) -> errno
```

#### fd_seek / fd_tell
```typescript
// fd_seek(fd: i32, offset: i64, whence: i32, newoffset_ptr: i32) -> errno
// fd_tell(fd: i32, offset_ptr: i32) -> errno
```

#### fd_fdstat_get / fd_fdstat_set_flags
```typescript
// fd_fdstat_get(fd: i32, stat_ptr: i32) -> errno
// fd_fdstat_set_flags(fd: i32, flags: i32) -> errno
```

#### fd_prestat_get / fd_prestat_dir_name
```typescript
// fd_prestat_get(fd: i32, prestat_ptr: i32) -> errno
// fd_prestat_dir_name(fd: i32, path_ptr: i32, path_len: i32) -> errno
```

#### Other fd_* functions
- fd_advise, fd_allocate, fd_datasync, fd_sync
- fd_filestat_get, fd_filestat_set_size, fd_filestat_set_times
- fd_pread, fd_pwrite
- fd_readdir
- fd_renumber
- fd_fdstat_set_rights (usually no-op in browser)

### Phase 4: Path Operations

#### path_open
```typescript
// path_open(fd: i32, dirflags: i32, path_ptr: i32, path_len: i32,
//           oflags: i32, fs_rights_base: i64, fs_rights_inheriting: i64,
//           fdflags: i32, opened_fd_ptr: i32) -> errno
```

Adapter: Reuse P2 `wasi:filesystem/types` via filesystem backends

#### path_create_directory / path_remove_directory
```typescript
// path_create_directory(fd: i32, path_ptr: i32, path_len: i32) -> errno
// path_remove_directory(fd: i32, path_ptr: i32, path_len: i32) -> errno
```

#### path_filestat_get / path_filestat_set_times
```typescript
// path_filestat_get(fd: i32, flags: i32, path_ptr: i32, path_len: i32, buf_ptr: i32) -> errno
// path_filestat_set_times(fd: i32, flags: i32, path_ptr: i32, path_len: i32, atim: i64, mtim: i64, fst_flags: i32) -> errno
```

#### Other path_* functions
- path_link, path_unlink_file
- path_readlink, path_symlink
- path_rename

### Phase 5: Polling

#### poll_oneoff
```typescript
// poll_oneoff(in_ptr: i32, out_ptr: i32, nsubscriptions: i32, nevents_ptr: i32) -> errno
```

This is complex - handles:
- Clock subscriptions (sleep/timeout)
- FD read readiness
- FD write readiness

Adapter: Use P2 pollable system

### Phase 6: Sockets (Optional)

#### sock_recv / sock_send / sock_shutdown
```typescript
// sock_recv(fd: i32, ri_data_ptr: i32, ri_data_len: i32, ri_flags: i32, ro_datalen_ptr: i32, ro_flags_ptr: i32) -> errno
// sock_send(fd: i32, si_data_ptr: i32, si_data_len: i32, si_flags: i32, so_datalen_ptr: i32) -> errno
// sock_shutdown(fd: i32, how: i32) -> errno
```

Note: Many WASI P1 implementations don't fully support sockets. We can either:
1. Return ENOSYS for unimplemented
2. Adapter via P2 sockets plugin

## Adapters to P2 Backends

### Stream Adapter (`adapters/streams.ts`)

Bridge P1 fd_read/fd_write to P2 streams:

```typescript
import type { InputStreamLike, OutputStreamLike } from '../../wasip2/plugins/cli/stdio-provider.js'

export class P1StreamAdapter {
  constructor(
    private stdin: InputStreamLike,
    private stdout: OutputStreamLike,
    private stderr: OutputStreamLike,
  ) {}

  read(fd: number, buf: Uint8Array): number | Errno {
    // Use stdin.tryRead() for non-blocking
    // Map to appropriate stream based on fd
  }

  write(fd: number, data: Uint8Array): number | Errno {
    // Use stdout/stderr write
  }
}
```

### Filesystem Adapter (`adapters/filesystem.ts`)

Bridge P1 path operations to P2 filesystem:

```typescript
import type { VirtualFilesystem } from '../../wasip2/plugins/filesystem/types.js'

export class P1FilesystemAdapter {
  constructor(private fs: VirtualFilesystem) {}

  open(dirFd: number, path: string, oflags: number, rights: bigint): number | Errno
  createDirectory(dirFd: number, path: string): Errno
  stat(dirFd: number, path: string): Filestat | Errno
  // etc.
}
```

### Clock Adapter (`adapters/clocks.ts`)

Bridge P1 clock functions to P2 clocks:

```typescript
export class P1ClockAdapter {
  getResolution(clockId: ClockId): bigint | Errno
  getTime(clockId: ClockId): bigint | Errno
}
```

## Main Entry Point (`index.ts`)

```typescript
export interface Wasip1Config {
  args?: string[]
  env?: Record<string, string>
  preopens?: Record<string, VirtualFilesystem | string>
  stdin?: InputStreamLike
  stdout?: OutputStreamLike
  stderr?: OutputStreamLike
  returnOnExit?: boolean  // Don't throw on proc_exit
}

export class Wasip1 {
  private memory: WasiMemory
  private fdTable: FileDescriptorTable
  private args: string[]
  private env: Record<string, string>
  private exitCode: number | null = null

  constructor(config: Wasip1Config)

  // Must be called after WebAssembly.instantiate
  initialize(instance: WebAssembly.Instance): void

  // Get the wasi_snapshot_preview1 imports
  getImports(): Record<string, Function>

  // Check if module exited
  get exited(): boolean
  get code(): number | null
}

// Factory function
export function createWasip1(config?: Wasip1Config): Wasip1
```

## Implementation Phases

### Phase 1: Minimal Viable (args, environ, clock, random, proc_exit)
**Estimate: ~400 LOC**

Gets basic "hello world" programs running:
- Memory helpers
- args_get, args_sizes_get
- environ_get, environ_sizes_get
- clock_time_get, clock_res_get
- random_get
- proc_exit

### Phase 2: Stdio (fd_read, fd_write for stdin/stdout/stderr)
**Estimate: ~300 LOC**

Enables programs that do I/O:
- File descriptor table (basic)
- fd_read for fd 0
- fd_write for fd 1, 2
- fd_close
- fd_fdstat_get
- fd_prestat_get, fd_prestat_dir_name (return no preopens)

### Phase 3: Filesystem (path operations, file I/O)
**Estimate: ~800 LOC**

Full filesystem support:
- Preopens support
- path_open, path_create_directory, path_remove_directory
- path_filestat_get, path_filestat_set_times
- path_unlink_file, path_rename
- fd_seek, fd_tell
- fd_filestat_get, fd_filestat_set_times
- fd_readdir
- fd_pread, fd_pwrite

### Phase 4: Polling
**Estimate: ~400 LOC**

Async/timeout support:
- poll_oneoff with clock subscriptions
- poll_oneoff with fd read/write subscriptions

### Phase 5: Advanced (optional)
**Estimate: ~300 LOC**

Rarely used features:
- fd_advise, fd_allocate
- path_link, path_symlink, path_readlink
- sock_* (if needed)
- sched_yield

## Testing Strategy

### Unit Tests
- Memory read/write operations
- FD table management
- Individual WASI function implementations

### Integration Tests
- Run actual WASI P1 modules (compiled with older wasi-sdk)
- Test programs:
  - Hello world (stdout)
  - Echo (stdin/stdout)
  - File operations (create, read, write, delete)
  - Environment/args access
  - Clock/random

### Compatibility Tests
- Compare output with wasmtime/wasmer for same modules
- Test with real-world WASI P1 modules (e.g., from wapm)

## Dependencies

### From wasip2
- `InputStreamLike`, `OutputStreamLike` from stdio-provider
- `VirtualFilesystem` from filesystem types
- Clock implementations from clocks plugin

### External
- None (pure TypeScript implementation)

## Notes

1. **Memory binding**: P1 requires binding to WebAssembly.Memory after instantiation, before calling `_start`. This is because the imports need access to linear memory.

2. **Blocking operations**: P1 has blocking APIs (fd_read blocks until data), but browser JS is async. Options:
   - Return EAGAIN for would-block cases
   - Use SharedArrayBuffer + Atomics (requires cross-origin isolation)
   - Use synchronous XMLHttpRequest (deprecated, doesn't work in workers)

3. **Rights**: P1 has a complex capability rights system. For browser use, we can simplify by granting appropriate rights based on preopen configuration.

4. **Path resolution**: P1 uses fd-relative paths. The dirfd parameter indicates which preopen directory to resolve paths against.

5. **Error mapping**: Map JavaScript errors to appropriate WASI errno values consistently.
