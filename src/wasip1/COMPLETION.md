# WASIP1 Completion Plan: Test Suite & Memory Filesystem

## Overview

WASIP1 has a complete implementation of all 46 `wasi_snapshot_preview1` functions (~3,700 LOC) but lacks test coverage and a built-in filesystem. This plan establishes comprehensive testing and adds a convenient memory filesystem.

### Current State

| Component | LOC | Status |
|-----------|-----|--------|
| types.ts | 663 | Complete - all 76 errno codes, types |
| memory.ts | 453 | Complete - linear memory helpers |
| fd-table.ts | 290 | Complete - FD management |
| fd.ts | 763 | Complete - 21 fd_* functions |
| path.ts | 504 | Complete - 10 path_* functions |
| args-environ.ts | 111 | Complete |
| clock.ts | 99 | Complete |
| random.ts | 61 | Complete |
| poll.ts | 203 | Complete |
| proc.ts | 100 | Complete |
| index.ts | 485 | Complete - main class |
| **Total** | **~3,732** | **0 tests** |

### Goals

1. Achieve >90% test coverage for all WASIP1 modules
2. Validate compatibility with wasmtime/wasmer behavior
3. Add built-in memory filesystem for easy adoption
4. Document blocking I/O limitations and workarounds

---

## Phase 1: Memory Helper Tests (~400 LOC)

**Priority**: Critical | **Effort**: Medium | **Duration**: 1-2 days

### 1.1 Memory Tests (`test/wasip1/memory.test.ts`)

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { WasiMemory } from '../../src/wasip1/memory.js'

describe('WasiMemory', () => {
  let memory: WebAssembly.Memory
  let wasiMemory: WasiMemory

  beforeEach(() => {
    memory = new WebAssembly.Memory({ initial: 1 })
    wasiMemory = new WasiMemory(memory)
  })

  describe('Integer Operations', () => {
    describe('u8', () => {
      it('should read u8', () => {
        const view = new DataView(memory.buffer)
        view.setUint8(0, 255)

        expect(wasiMemory.readU8(0)).toBe(255)
      })

      it('should write u8', () => {
        wasiMemory.writeU8(0, 128)

        const view = new DataView(memory.buffer)
        expect(view.getUint8(0)).toBe(128)
      })

      it('should handle boundary values', () => {
        wasiMemory.writeU8(0, 0)
        expect(wasiMemory.readU8(0)).toBe(0)

        wasiMemory.writeU8(0, 255)
        expect(wasiMemory.readU8(0)).toBe(255)
      })
    })

    describe('u16', () => {
      it('should read u16 little-endian', () => {
        const view = new DataView(memory.buffer)
        view.setUint16(0, 0x1234, true) // little-endian

        expect(wasiMemory.readU16(0)).toBe(0x1234)
      })

      it('should write u16 little-endian', () => {
        wasiMemory.writeU16(0, 0xABCD)

        const view = new DataView(memory.buffer)
        expect(view.getUint16(0, true)).toBe(0xABCD)
      })
    })

    describe('u32', () => {
      it('should read u32', () => {
        const view = new DataView(memory.buffer)
        view.setUint32(0, 0x12345678, true)

        expect(wasiMemory.readU32(0)).toBe(0x12345678)
      })

      it('should write u32', () => {
        wasiMemory.writeU32(0, 0xDEADBEEF)

        const view = new DataView(memory.buffer)
        expect(view.getUint32(0, true)).toBe(0xDEADBEEF)
      })
    })

    describe('u64', () => {
      it('should read u64', () => {
        const view = new DataView(memory.buffer)
        view.setBigUint64(0, 0x123456789ABCDEF0n, true)

        expect(wasiMemory.readU64(0)).toBe(0x123456789ABCDEF0n)
      })

      it('should write u64', () => {
        wasiMemory.writeU64(0, 0xFEDCBA9876543210n)

        const view = new DataView(memory.buffer)
        expect(view.getBigUint64(0, true)).toBe(0xFEDCBA9876543210n)
      })

      it('should handle max u64', () => {
        const max = 0xFFFFFFFFFFFFFFFFn
        wasiMemory.writeU64(0, max)
        expect(wasiMemory.readU64(0)).toBe(max)
      })
    })

    describe('i32', () => {
      it('should read negative i32', () => {
        const view = new DataView(memory.buffer)
        view.setInt32(0, -1, true)

        expect(wasiMemory.readI32(0)).toBe(-1)
      })

      it('should write negative i32', () => {
        wasiMemory.writeI32(0, -12345)

        const view = new DataView(memory.buffer)
        expect(view.getInt32(0, true)).toBe(-12345)
      })
    })

    describe('i64', () => {
      it('should read negative i64', () => {
        const view = new DataView(memory.buffer)
        view.setBigInt64(0, -1n, true)

        expect(wasiMemory.readI64(0)).toBe(-1n)
      })

      it('should write negative i64', () => {
        wasiMemory.writeI64(0, -9876543210n)

        const view = new DataView(memory.buffer)
        expect(view.getBigInt64(0, true)).toBe(-9876543210n)
      })
    })
  })

  describe('Byte Operations', () => {
    it('should read bytes', () => {
      const bytes = new Uint8Array(memory.buffer)
      bytes[0] = 1
      bytes[1] = 2
      bytes[2] = 3

      const result = wasiMemory.readBytes(0, 3)
      expect(result).toEqual(new Uint8Array([1, 2, 3]))
    })

    it('should write bytes', () => {
      wasiMemory.writeBytes(0, new Uint8Array([4, 5, 6, 7]))

      const bytes = new Uint8Array(memory.buffer)
      expect(bytes[0]).toBe(4)
      expect(bytes[1]).toBe(5)
      expect(bytes[2]).toBe(6)
      expect(bytes[3]).toBe(7)
    })

    it('should handle empty byte array', () => {
      const result = wasiMemory.readBytes(0, 0)
      expect(result).toEqual(new Uint8Array([]))

      wasiMemory.writeBytes(0, new Uint8Array([]))
      // Should not throw
    })
  })

  describe('String Operations', () => {
    it('should read UTF-8 string', () => {
      const encoder = new TextEncoder()
      const encoded = encoder.encode('Hello')
      new Uint8Array(memory.buffer).set(encoded, 0)

      expect(wasiMemory.readString(0, 5)).toBe('Hello')
    })

    it('should write UTF-8 string', () => {
      const len = wasiMemory.writeString(0, 'World')

      expect(len).toBe(5)
      expect(wasiMemory.readString(0, 5)).toBe('World')
    })

    it('should handle Unicode', () => {
      const unicode = '日本語'
      const len = wasiMemory.writeString(0, unicode)

      expect(len).toBe(9) // 3 chars × 3 bytes
      expect(wasiMemory.readString(0, len)).toBe(unicode)
    })

    it('should handle empty string', () => {
      const len = wasiMemory.writeString(0, '')
      expect(len).toBe(0)
      expect(wasiMemory.readString(0, 0)).toBe('')
    })
  })

  describe('iovec Operations', () => {
    it('should read iovec array', () => {
      // iovec: { buf: u32, len: u32 }
      const view = new DataView(memory.buffer)
      // First iovec
      view.setUint32(0, 100, true)  // buf ptr
      view.setUint32(4, 10, true)   // len
      // Second iovec
      view.setUint32(8, 200, true)  // buf ptr
      view.setUint32(12, 20, true)  // len

      const iovecs = wasiMemory.readIovec(0, 2)

      expect(iovecs).toHaveLength(2)
      expect(iovecs[0]).toEqual({ buf: 100, len: 10 })
      expect(iovecs[1]).toEqual({ buf: 200, len: 20 })
    })

    it('should handle empty iovec array', () => {
      const iovecs = wasiMemory.readIovec(0, 0)
      expect(iovecs).toEqual([])
    })
  })

  describe('Memory Growth', () => {
    it('should handle memory growth', () => {
      // Write at end of first page
      wasiMemory.writeU32(65532, 0x12345678)

      // Grow memory
      memory.grow(1)

      // Refresh memory view
      wasiMemory.refresh()

      // Should still read correctly
      expect(wasiMemory.readU32(65532)).toBe(0x12345678)

      // Should be able to write to new page
      wasiMemory.writeU32(65536, 0xABCDABCD)
      expect(wasiMemory.readU32(65536)).toBe(0xABCDABCD)
    })
  })

  describe('Structure Operations', () => {
    describe('Filestat', () => {
      it('should write and read filestat', () => {
        const stat = {
          dev: 1n,
          ino: 2n,
          filetype: 4, // REGULAR_FILE
          nlink: 1n,
          size: 1024n,
          atim: 1000000000n,
          mtim: 2000000000n,
          ctim: 3000000000n
        }

        wasiMemory.writeFilestat(0, stat)
        const result = wasiMemory.readFilestat(0)

        expect(result).toEqual(stat)
      })
    })

    describe('Fdstat', () => {
      it('should write and read fdstat', () => {
        const fdstat = {
          filetype: 4, // REGULAR_FILE
          flags: 0x01, // APPEND
          rightsBase: 0xFFn,
          rightsInheriting: 0xFFn
        }

        wasiMemory.writeFdstat(0, fdstat)
        const result = wasiMemory.readFdstat(0)

        expect(result).toEqual(fdstat)
      })
    })
  })
})
```

---

## Phase 2: File Descriptor Table Tests (~300 LOC)

**Priority**: High | **Effort**: Medium | **Duration**: 1 day

### 2.1 FD Table Tests (`test/wasip1/fd-table.test.ts`)

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { FileDescriptorTable, FdEntry, FdType } from '../../src/wasip1/fd-table.js'
import { Rights, FileType } from '../../src/wasip1/types.js'

describe('FileDescriptorTable', () => {
  let table: FileDescriptorTable

  beforeEach(() => {
    table = new FileDescriptorTable()
  })

  describe('Stdio Initialization', () => {
    it('should reserve fds 0, 1, 2 for stdio', () => {
      table.initStdio(
        createStdinEntry(),
        createStdoutEntry(),
        createStderrEntry()
      )

      expect(table.get(0)?.type).toBe('stdin')
      expect(table.get(1)?.type).toBe('stdout')
      expect(table.get(2)?.type).toBe('stderr')
    })

    it('should allocate new fds starting from 3', () => {
      table.initStdio(
        createStdinEntry(),
        createStdoutEntry(),
        createStderrEntry()
      )

      const fd = table.allocate(createFileEntry('/test.txt'))

      expect(fd).toBe(3)
    })
  })

  describe('Allocation', () => {
    it('should allocate sequential fds', () => {
      const fd1 = table.allocate(createFileEntry('/a.txt'))
      const fd2 = table.allocate(createFileEntry('/b.txt'))
      const fd3 = table.allocate(createFileEntry('/c.txt'))

      expect(fd1).toBe(0)
      expect(fd2).toBe(1)
      expect(fd3).toBe(2)
    })

    it('should reuse closed fds', () => {
      const fd1 = table.allocate(createFileEntry('/a.txt'))
      const fd2 = table.allocate(createFileEntry('/b.txt'))

      table.close(fd1)

      const fd3 = table.allocate(createFileEntry('/c.txt'))

      // Should reuse fd1 (lowest available)
      expect(fd3).toBe(fd1)
    })
  })

  describe('Get/Set', () => {
    it('should get entry by fd', () => {
      const entry = createFileEntry('/test.txt')
      const fd = table.allocate(entry)

      const retrieved = table.get(fd)

      expect(retrieved).toBe(entry)
    })

    it('should return undefined for invalid fd', () => {
      expect(table.get(999)).toBeUndefined()
    })

    it('should update entry', () => {
      const entry = createFileEntry('/test.txt')
      const fd = table.allocate(entry)

      const updated = { ...entry, position: 100n }
      table.set(fd, updated)

      expect(table.get(fd)?.position).toBe(100n)
    })
  })

  describe('Close', () => {
    it('should close and remove entry', () => {
      const fd = table.allocate(createFileEntry('/test.txt'))

      const result = table.close(fd)

      expect(result).toBe(true)
      expect(table.get(fd)).toBeUndefined()
    })

    it('should return false for already closed fd', () => {
      const fd = table.allocate(createFileEntry('/test.txt'))
      table.close(fd)

      const result = table.close(fd)

      expect(result).toBe(false)
    })

    it('should return false for invalid fd', () => {
      expect(table.close(999)).toBe(false)
    })
  })

  describe('Renumber', () => {
    it('should renumber fd to new number', () => {
      const entry = createFileEntry('/test.txt')
      const fd = table.allocate(entry)

      const result = table.renumber(fd, 10)

      expect(result).toBe(true)
      expect(table.get(fd)).toBeUndefined()
      expect(table.get(10)).toBe(entry)
    })

    it('should close target fd if exists', () => {
      const entry1 = createFileEntry('/a.txt')
      const entry2 = createFileEntry('/b.txt')
      const fd1 = table.allocate(entry1)
      const fd2 = table.allocate(entry2)

      table.renumber(fd1, fd2)

      expect(table.get(fd2)).toBe(entry1)
      expect(table.get(fd1)).toBeUndefined()
    })

    it('should fail for invalid source fd', () => {
      expect(table.renumber(999, 10)).toBe(false)
    })
  })

  describe('Preopens', () => {
    it('should track preopen directories', () => {
      const entry: FdEntry = {
        type: 'directory',
        rights: { base: Rights.ALL, inheriting: Rights.ALL },
        flags: 0,
        path: '/home',
        preopen: '/'
      }
      table.allocate(entry)

      const preopens = table.getPreopens()

      expect(preopens).toHaveLength(1)
      expect(preopens[0].path).toBe('/')
    })

    it('should return empty for no preopens', () => {
      expect(table.getPreopens()).toEqual([])
    })
  })

  describe('Rights Checking', () => {
    it('should check base rights', () => {
      const entry: FdEntry = {
        type: 'file',
        rights: { base: Rights.FD_READ, inheriting: 0n },
        flags: 0,
        path: '/test.txt'
      }
      const fd = table.allocate(entry)

      expect(table.hasRight(fd, Rights.FD_READ)).toBe(true)
      expect(table.hasRight(fd, Rights.FD_WRITE)).toBe(false)
    })

    it('should check multiple rights', () => {
      const entry: FdEntry = {
        type: 'file',
        rights: { base: Rights.FD_READ | Rights.FD_SEEK, inheriting: 0n },
        flags: 0,
        path: '/test.txt'
      }
      const fd = table.allocate(entry)

      expect(table.hasRight(fd, Rights.FD_READ | Rights.FD_SEEK)).toBe(true)
      expect(table.hasRight(fd, Rights.FD_READ | Rights.FD_WRITE)).toBe(false)
    })
  })
})

// Helper functions
function createStdinEntry(): FdEntry {
  return {
    type: 'stdin',
    rights: { base: Rights.FD_READ, inheriting: 0n },
    flags: 0
  }
}

function createStdoutEntry(): FdEntry {
  return {
    type: 'stdout',
    rights: { base: Rights.FD_WRITE, inheriting: 0n },
    flags: 0
  }
}

function createStderrEntry(): FdEntry {
  return {
    type: 'stderr',
    rights: { base: Rights.FD_WRITE, inheriting: 0n },
    flags: 0
  }
}

function createFileEntry(path: string): FdEntry {
  return {
    type: 'file',
    rights: { base: Rights.FD_READ | Rights.FD_WRITE | Rights.FD_SEEK, inheriting: 0n },
    flags: 0,
    path,
    position: 0n
  }
}
```

---

## Phase 3: WASI Function Tests (~1500 LOC)

**Priority**: Critical | **Effort**: High | **Duration**: 4-5 days

### 3.1 Args/Environ Tests (`test/wasip1/args-environ.test.ts`)

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { Wasip1 } from '../../src/wasip1/index.js'
import { Errno } from '../../src/wasip1/types.js'

describe('Args and Environ', () => {
  let wasip1: Wasip1
  let memory: WebAssembly.Memory
  let imports: Record<string, Function>

  beforeEach(() => {
    memory = new WebAssembly.Memory({ initial: 1 })
    wasip1 = new Wasip1({
      args: ['program', '--flag', 'value'],
      env: { HOME: '/home/user', PATH: '/usr/bin' }
    })
    wasip1.setMemory(memory)
    imports = wasip1.getImports()
  })

  describe('args_sizes_get', () => {
    it('should return argc and total buffer size', () => {
      const argc_ptr = 0
      const argv_buf_size_ptr = 4

      const result = imports.args_sizes_get(argc_ptr, argv_buf_size_ptr)

      expect(result).toBe(Errno.SUCCESS)

      const view = new DataView(memory.buffer)
      expect(view.getUint32(argc_ptr, true)).toBe(3) // 3 args
      // Buffer size = "program\0" + "--flag\0" + "value\0" = 8 + 7 + 6 = 21
      expect(view.getUint32(argv_buf_size_ptr, true)).toBe(21)
    })

    it('should return 0 for no args', () => {
      wasip1 = new Wasip1({ args: [] })
      wasip1.setMemory(memory)
      imports = wasip1.getImports()

      const argc_ptr = 0
      const argv_buf_size_ptr = 4

      imports.args_sizes_get(argc_ptr, argv_buf_size_ptr)

      const view = new DataView(memory.buffer)
      expect(view.getUint32(argc_ptr, true)).toBe(0)
      expect(view.getUint32(argv_buf_size_ptr, true)).toBe(0)
    })
  })

  describe('args_get', () => {
    it('should write args to memory', () => {
      const argv_ptr = 0
      const argv_buf_ptr = 100

      const result = imports.args_get(argv_ptr, argv_buf_ptr)

      expect(result).toBe(Errno.SUCCESS)

      const view = new DataView(memory.buffer)
      const bytes = new Uint8Array(memory.buffer)

      // Check argv pointers
      expect(view.getUint32(argv_ptr, true)).toBe(100)      // argv[0]
      expect(view.getUint32(argv_ptr + 4, true)).toBe(108)  // argv[1]
      expect(view.getUint32(argv_ptr + 8, true)).toBe(115)  // argv[2]

      // Check strings
      const decoder = new TextDecoder()
      expect(decoder.decode(bytes.slice(100, 107))).toBe('program')
      expect(decoder.decode(bytes.slice(108, 114))).toBe('--flag')
      expect(decoder.decode(bytes.slice(115, 120))).toBe('value')
    })
  })

  describe('environ_sizes_get', () => {
    it('should return environ count and buffer size', () => {
      const environc_ptr = 0
      const environ_buf_size_ptr = 4

      const result = imports.environ_sizes_get(environc_ptr, environ_buf_size_ptr)

      expect(result).toBe(Errno.SUCCESS)

      const view = new DataView(memory.buffer)
      expect(view.getUint32(environc_ptr, true)).toBe(2) // HOME, PATH

      // Buffer size = "HOME=/home/user\0" + "PATH=/usr/bin\0"
      const expectedSize = 'HOME=/home/user'.length + 1 + 'PATH=/usr/bin'.length + 1
      expect(view.getUint32(environ_buf_size_ptr, true)).toBe(expectedSize)
    })
  })

  describe('environ_get', () => {
    it('should write environ to memory', () => {
      const environ_ptr = 0
      const environ_buf_ptr = 100

      const result = imports.environ_get(environ_ptr, environ_buf_ptr)

      expect(result).toBe(Errno.SUCCESS)

      const bytes = new Uint8Array(memory.buffer)
      const decoder = new TextDecoder()

      // Find null terminators and extract strings
      const str1End = bytes.indexOf(0, 100)
      const str2End = bytes.indexOf(0, str1End + 1)

      const env1 = decoder.decode(bytes.slice(100, str1End))
      const env2 = decoder.decode(bytes.slice(str1End + 1, str2End))

      // Order may vary, check both are present
      const envs = [env1, env2].sort()
      expect(envs).toContain('HOME=/home/user')
      expect(envs).toContain('PATH=/usr/bin')
    })
  })
})
```

### 3.2 Clock Tests (`test/wasip1/clock.test.ts`)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Wasip1 } from '../../src/wasip1/index.js'
import { Errno, ClockId } from '../../src/wasip1/types.js'

describe('Clock Functions', () => {
  let wasip1: Wasip1
  let memory: WebAssembly.Memory
  let imports: Record<string, Function>

  beforeEach(() => {
    memory = new WebAssembly.Memory({ initial: 1 })
    wasip1 = new Wasip1({})
    wasip1.setMemory(memory)
    imports = wasip1.getImports()
  })

  describe('clock_res_get', () => {
    it('should return resolution for REALTIME', () => {
      const resolution_ptr = 0

      const result = imports.clock_res_get(ClockId.REALTIME, resolution_ptr)

      expect(result).toBe(Errno.SUCCESS)

      const view = new DataView(memory.buffer)
      const resolution = view.getBigUint64(resolution_ptr, true)

      // Should be at least 1ns, at most 1s
      expect(resolution).toBeGreaterThan(0n)
      expect(resolution).toBeLessThanOrEqual(1_000_000_000n)
    })

    it('should return resolution for MONOTONIC', () => {
      const resolution_ptr = 0

      const result = imports.clock_res_get(ClockId.MONOTONIC, resolution_ptr)

      expect(result).toBe(Errno.SUCCESS)

      const view = new DataView(memory.buffer)
      const resolution = view.getBigUint64(resolution_ptr, true)

      expect(resolution).toBeGreaterThan(0n)
    })

    it('should return EINVAL for invalid clock', () => {
      const result = imports.clock_res_get(999, 0)
      expect(result).toBe(Errno.EINVAL)
    })
  })

  describe('clock_time_get', () => {
    it('should return current time for REALTIME', () => {
      const time_ptr = 0

      const before = BigInt(Date.now()) * 1_000_000n
      const result = imports.clock_time_get(ClockId.REALTIME, 0n, time_ptr)
      const after = BigInt(Date.now()) * 1_000_000n

      expect(result).toBe(Errno.SUCCESS)

      const view = new DataView(memory.buffer)
      const time = view.getBigUint64(time_ptr, true)

      // Time should be between before and after
      expect(time).toBeGreaterThanOrEqual(before)
      expect(time).toBeLessThanOrEqual(after)
    })

    it('should return monotonic time', () => {
      const time_ptr = 0

      imports.clock_time_get(ClockId.MONOTONIC, 0n, time_ptr)
      const view = new DataView(memory.buffer)
      const time1 = view.getBigUint64(time_ptr, true)

      // Small delay
      for (let i = 0; i < 1000; i++) {}

      imports.clock_time_get(ClockId.MONOTONIC, 0n, time_ptr)
      const time2 = view.getBigUint64(time_ptr, true)

      // Monotonic time should not go backwards
      expect(time2).toBeGreaterThanOrEqual(time1)
    })

    it('should return EINVAL for invalid clock', () => {
      const result = imports.clock_time_get(999, 0n, 0)
      expect(result).toBe(Errno.EINVAL)
    })
  })
})
```

### 3.3 FD Function Tests (`test/wasip1/fd.test.ts`)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Wasip1 } from '../../src/wasip1/index.js'
import { Errno, Whence, FdFlags, FileType } from '../../src/wasip1/types.js'

describe('File Descriptor Functions', () => {
  let wasip1: Wasip1
  let memory: WebAssembly.Memory
  let imports: Record<string, Function>
  let stdoutData: Uint8Array[]
  let stdinData: Uint8Array

  beforeEach(() => {
    memory = new WebAssembly.Memory({ initial: 1 })
    stdoutData = []
    stdinData = new TextEncoder().encode('Hello from stdin')

    wasip1 = new Wasip1({
      stdin: {
        read: (len: number) => {
          const chunk = stdinData.slice(0, len)
          stdinData = stdinData.slice(len)
          return chunk
        }
      },
      stdout: {
        write: (data: Uint8Array) => {
          stdoutData.push(data)
          return data.length
        }
      }
    })
    wasip1.setMemory(memory)
    imports = wasip1.getImports()
  })

  describe('fd_read', () => {
    it('should read from stdin', () => {
      // Setup iovec: buf at 100, len 10
      const view = new DataView(memory.buffer)
      view.setUint32(0, 100, true)  // buf ptr
      view.setUint32(4, 10, true)   // buf len

      const nread_ptr = 50

      const result = imports.fd_read(0, 0, 1, nread_ptr)

      expect(result).toBe(Errno.SUCCESS)

      const nread = view.getUint32(nread_ptr, true)
      expect(nread).toBe(10)

      const bytes = new Uint8Array(memory.buffer, 100, nread)
      expect(new TextDecoder().decode(bytes)).toBe('Hello from')
    })

    it('should return EBADF for invalid fd', () => {
      const result = imports.fd_read(999, 0, 1, 0)
      expect(result).toBe(Errno.EBADF)
    })

    it('should return EBADF for stdout', () => {
      const view = new DataView(memory.buffer)
      view.setUint32(0, 100, true)
      view.setUint32(4, 10, true)

      const result = imports.fd_read(1, 0, 1, 50) // stdout
      expect(result).toBe(Errno.EBADF)
    })
  })

  describe('fd_write', () => {
    it('should write to stdout', () => {
      // Setup data in memory
      const message = 'Hello, World!'
      const encoder = new TextEncoder()
      const encoded = encoder.encode(message)
      new Uint8Array(memory.buffer).set(encoded, 100)

      // Setup iovec
      const view = new DataView(memory.buffer)
      view.setUint32(0, 100, true)           // buf ptr
      view.setUint32(4, encoded.length, true) // buf len

      const nwritten_ptr = 50

      const result = imports.fd_write(1, 0, 1, nwritten_ptr)

      expect(result).toBe(Errno.SUCCESS)

      const nwritten = view.getUint32(nwritten_ptr, true)
      expect(nwritten).toBe(encoded.length)

      const written = new TextDecoder().decode(
        Buffer.concat(stdoutData.map(d => Buffer.from(d)))
      )
      expect(written).toBe(message)
    })

    it('should write to stderr', () => {
      const view = new DataView(memory.buffer)
      const encoder = new TextEncoder()
      const data = encoder.encode('Error!')
      new Uint8Array(memory.buffer).set(data, 100)

      view.setUint32(0, 100, true)
      view.setUint32(4, data.length, true)

      const result = imports.fd_write(2, 0, 1, 50)

      expect(result).toBe(Errno.SUCCESS)
    })

    it('should handle multiple iovecs', () => {
      const view = new DataView(memory.buffer)
      const bytes = new Uint8Array(memory.buffer)

      // First buffer: "Hello"
      bytes.set(new TextEncoder().encode('Hello'), 100)
      view.setUint32(0, 100, true)
      view.setUint32(4, 5, true)

      // Second buffer: " World"
      bytes.set(new TextEncoder().encode(' World'), 200)
      view.setUint32(8, 200, true)
      view.setUint32(12, 6, true)

      const nwritten_ptr = 50

      const result = imports.fd_write(1, 0, 2, nwritten_ptr)

      expect(result).toBe(Errno.SUCCESS)
      expect(view.getUint32(nwritten_ptr, true)).toBe(11)

      const written = new TextDecoder().decode(
        Buffer.concat(stdoutData.map(d => Buffer.from(d)))
      )
      expect(written).toBe('Hello World')
    })
  })

  describe('fd_close', () => {
    it('should close file descriptor', () => {
      // First verify fd 0 exists
      const view = new DataView(memory.buffer)
      view.setUint32(0, 100, true)
      view.setUint32(4, 1, true)

      expect(imports.fd_read(0, 0, 1, 50)).toBe(Errno.SUCCESS)

      // Close it
      const result = imports.fd_close(0)
      expect(result).toBe(Errno.SUCCESS)

      // Should now return EBADF
      expect(imports.fd_read(0, 0, 1, 50)).toBe(Errno.EBADF)
    })

    it('should return EBADF for invalid fd', () => {
      expect(imports.fd_close(999)).toBe(Errno.EBADF)
    })
  })

  describe('fd_seek', () => {
    // These tests require a file fd, not stdio
    // Will be tested with memory filesystem in Phase 5
  })

  describe('fd_fdstat_get', () => {
    it('should return fdstat for stdin', () => {
      const stat_ptr = 0

      const result = imports.fd_fdstat_get(0, stat_ptr)

      expect(result).toBe(Errno.SUCCESS)

      const view = new DataView(memory.buffer)
      const filetype = view.getUint8(stat_ptr)
      expect(filetype).toBe(FileType.CHARACTER_DEVICE)
    })

    it('should return EBADF for invalid fd', () => {
      expect(imports.fd_fdstat_get(999, 0)).toBe(Errno.EBADF)
    })
  })

  describe('fd_prestat_get', () => {
    it('should return EBADF when no preopens', () => {
      const result = imports.fd_prestat_get(3, 0)
      expect(result).toBe(Errno.EBADF)
    })
  })
})
```

### 3.4 Additional Test Files

Create similar test files for:
- `test/wasip1/path.test.ts` (~300 LOC) - path_* functions
- `test/wasip1/random.test.ts` (~100 LOC) - random_get
- `test/wasip1/poll.test.ts` (~200 LOC) - poll_oneoff
- `test/wasip1/proc.test.ts` (~100 LOC) - proc_exit, proc_raise

---

## Phase 4: Memory Filesystem (~600 LOC)

**Priority**: High | **Effort**: Medium | **Duration**: 2-3 days

### 4.1 Memory Filesystem Implementation (`src/wasip1/filesystem/memory.ts`)

```typescript
/**
 * In-memory filesystem for WASIP1
 *
 * Provides a simple filesystem implementation that stores
 * all files and directories in memory. Useful for testing
 * and sandboxed execution.
 */

export interface MemoryFsConfig {
  /** Initial files to populate */
  files?: Record<string, string | Uint8Array>
  /** Initial directories to create */
  directories?: string[]
}

export interface FileNode {
  type: 'file'
  content: Uint8Array
  size: number
  atime: bigint
  mtime: bigint
  ctime: bigint
}

export interface DirectoryNode {
  type: 'directory'
  entries: Map<string, FileNode | DirectoryNode>
  atime: bigint
  mtime: bigint
  ctime: bigint
}

type FsNode = FileNode | DirectoryNode

export class MemoryFilesystem {
  private root: DirectoryNode

  constructor(config: MemoryFsConfig = {}) {
    const now = BigInt(Date.now()) * 1_000_000n

    this.root = {
      type: 'directory',
      entries: new Map(),
      atime: now,
      mtime: now,
      ctime: now
    }

    // Create initial directories
    for (const dir of config.directories ?? []) {
      this.createDirectory(dir)
    }

    // Create initial files
    for (const [path, content] of Object.entries(config.files ?? {})) {
      const data = typeof content === 'string'
        ? new TextEncoder().encode(content)
        : content
      this.writeFile(path, data)
    }
  }

  /**
   * Resolve a path to its parent directory and entry name
   */
  private resolvePath(path: string): { parent: DirectoryNode; name: string } | null {
    const parts = path.split('/').filter(p => p.length > 0)
    if (parts.length === 0) {
      return null // Can't resolve root
    }

    let current: DirectoryNode = this.root
    for (let i = 0; i < parts.length - 1; i++) {
      const entry = current.entries.get(parts[i])
      if (!entry || entry.type !== 'directory') {
        return null
      }
      current = entry
    }

    return { parent: current, name: parts[parts.length - 1] }
  }

  /**
   * Get a node at the given path
   */
  private getNode(path: string): FsNode | null {
    if (path === '/' || path === '') {
      return this.root
    }

    const resolved = this.resolvePath(path)
    if (!resolved) return null

    return resolved.parent.entries.get(resolved.name) ?? null
  }

  /**
   * Check if a path exists
   */
  exists(path: string): boolean {
    return this.getNode(path) !== null
  }

  /**
   * Check if path is a directory
   */
  isDirectory(path: string): boolean {
    const node = this.getNode(path)
    return node?.type === 'directory'
  }

  /**
   * Check if path is a file
   */
  isFile(path: string): boolean {
    const node = this.getNode(path)
    return node?.type === 'file'
  }

  /**
   * Create a directory
   */
  createDirectory(path: string): boolean {
    const resolved = this.resolvePath(path)
    if (!resolved) return false

    if (resolved.parent.entries.has(resolved.name)) {
      return false // Already exists
    }

    const now = BigInt(Date.now()) * 1_000_000n
    resolved.parent.entries.set(resolved.name, {
      type: 'directory',
      entries: new Map(),
      atime: now,
      mtime: now,
      ctime: now
    })

    resolved.parent.mtime = now
    return true
  }

  /**
   * Remove a directory (must be empty)
   */
  removeDirectory(path: string): boolean {
    const resolved = this.resolvePath(path)
    if (!resolved) return false

    const entry = resolved.parent.entries.get(resolved.name)
    if (!entry || entry.type !== 'directory') return false
    if (entry.entries.size > 0) return false // Not empty

    resolved.parent.entries.delete(resolved.name)
    resolved.parent.mtime = BigInt(Date.now()) * 1_000_000n
    return true
  }

  /**
   * Write a file (creates or overwrites)
   */
  writeFile(path: string, content: Uint8Array): boolean {
    // Ensure parent directories exist
    const parts = path.split('/').filter(p => p.length > 0)
    let current: DirectoryNode = this.root

    for (let i = 0; i < parts.length - 1; i++) {
      let entry = current.entries.get(parts[i])
      if (!entry) {
        // Create intermediate directory
        const now = BigInt(Date.now()) * 1_000_000n
        entry = {
          type: 'directory',
          entries: new Map(),
          atime: now,
          mtime: now,
          ctime: now
        }
        current.entries.set(parts[i], entry)
      }
      if (entry.type !== 'directory') return false
      current = entry
    }

    const fileName = parts[parts.length - 1]
    const now = BigInt(Date.now()) * 1_000_000n

    current.entries.set(fileName, {
      type: 'file',
      content: new Uint8Array(content),
      size: content.length,
      atime: now,
      mtime: now,
      ctime: now
    })

    current.mtime = now
    return true
  }

  /**
   * Read a file
   */
  readFile(path: string): Uint8Array | null {
    const node = this.getNode(path)
    if (!node || node.type !== 'file') return null

    node.atime = BigInt(Date.now()) * 1_000_000n
    return node.content
  }

  /**
   * Delete a file
   */
  deleteFile(path: string): boolean {
    const resolved = this.resolvePath(path)
    if (!resolved) return false

    const entry = resolved.parent.entries.get(resolved.name)
    if (!entry || entry.type !== 'file') return false

    resolved.parent.entries.delete(resolved.name)
    resolved.parent.mtime = BigInt(Date.now()) * 1_000_000n
    return true
  }

  /**
   * Rename/move a file or directory
   */
  rename(oldPath: string, newPath: string): boolean {
    const oldResolved = this.resolvePath(oldPath)
    const newResolved = this.resolvePath(newPath)

    if (!oldResolved || !newResolved) return false

    const entry = oldResolved.parent.entries.get(oldResolved.name)
    if (!entry) return false

    // Remove from old location
    oldResolved.parent.entries.delete(oldResolved.name)
    oldResolved.parent.mtime = BigInt(Date.now()) * 1_000_000n

    // Add to new location
    newResolved.parent.entries.set(newResolved.name, entry)
    newResolved.parent.mtime = BigInt(Date.now()) * 1_000_000n

    return true
  }

  /**
   * Get file/directory statistics
   */
  stat(path: string): {
    type: 'file' | 'directory'
    size: number
    atime: bigint
    mtime: bigint
    ctime: bigint
  } | null {
    const node = this.getNode(path)
    if (!node) return null

    return {
      type: node.type,
      size: node.type === 'file' ? node.size : 0,
      atime: node.atime,
      mtime: node.mtime,
      ctime: node.ctime
    }
  }

  /**
   * List directory entries
   */
  readDirectory(path: string): Array<{
    name: string
    type: 'file' | 'directory'
  }> | null {
    const node = this.getNode(path)
    if (!node || node.type !== 'directory') return null

    const entries: Array<{ name: string; type: 'file' | 'directory' }> = []
    for (const [name, entry] of node.entries) {
      entries.push({ name, type: entry.type })
    }

    return entries
  }

  /**
   * Truncate or extend a file to specific size
   */
  truncate(path: string, size: number): boolean {
    const node = this.getNode(path)
    if (!node || node.type !== 'file') return false

    if (size < node.content.length) {
      node.content = node.content.slice(0, size)
    } else if (size > node.content.length) {
      const newContent = new Uint8Array(size)
      newContent.set(node.content, 0)
      node.content = newContent
    }

    node.size = size
    node.mtime = BigInt(Date.now()) * 1_000_000n
    return true
  }

  /**
   * Update file timestamps
   */
  setTimes(path: string, atime: bigint, mtime: bigint): boolean {
    const node = this.getNode(path)
    if (!node) return false

    node.atime = atime
    node.mtime = mtime
    return true
  }
}
```

### 4.2 Integration with WASIP1 (`src/wasip1/filesystem/adapter.ts`)

```typescript
/**
 * Adapter to use MemoryFilesystem with WASIP1
 */

import { MemoryFilesystem } from './memory.js'
import type { FileDescriptorTable, FdEntry } from '../fd-table.js'
import { Errno, FileType, Rights } from '../types.js'

export class Wasip1FilesystemAdapter {
  constructor(
    private fs: MemoryFilesystem,
    private fdTable: FileDescriptorTable
  ) {}

  /**
   * Open a file or directory
   */
  pathOpen(
    dirFd: number,
    path: string,
    oflags: number,
    fsRightsBase: bigint,
    fsRightsInheriting: bigint,
    fdflags: number
  ): number | Errno {
    const dirEntry = this.fdTable.get(dirFd)
    if (!dirEntry || dirEntry.type !== 'directory') {
      return Errno.EBADF
    }

    const fullPath = this.resolvePath(dirEntry.path ?? '/', path)

    // Handle creation flags
    const O_CREAT = 0x01
    const O_EXCL = 0x04
    const O_TRUNC = 0x08
    const O_DIRECTORY = 0x10

    const exists = this.fs.exists(fullPath)

    if (oflags & O_CREAT) {
      if (exists && (oflags & O_EXCL)) {
        return Errno.EEXIST
      }
      if (!exists) {
        this.fs.writeFile(fullPath, new Uint8Array())
      }
    } else if (!exists) {
      return Errno.ENOENT
    }

    if (oflags & O_DIRECTORY && !this.fs.isDirectory(fullPath)) {
      return Errno.ENOTDIR
    }

    if (oflags & O_TRUNC && this.fs.isFile(fullPath)) {
      this.fs.truncate(fullPath, 0)
    }

    const isDir = this.fs.isDirectory(fullPath)
    const entry: FdEntry = {
      type: isDir ? 'directory' : 'file',
      rights: { base: fsRightsBase, inheriting: fsRightsInheriting },
      flags: fdflags,
      path: fullPath,
      position: 0n
    }

    return this.fdTable.allocate(entry)
  }

  /**
   * Read from a file
   */
  fdRead(fd: number, length: number, offset?: bigint): Uint8Array | Errno {
    const entry = this.fdTable.get(fd)
    if (!entry || entry.type !== 'file') {
      return Errno.EBADF
    }

    const content = this.fs.readFile(entry.path!)
    if (!content) {
      return Errno.ENOENT
    }

    const pos = offset ?? entry.position ?? 0n
    const start = Number(pos)
    const end = Math.min(start + length, content.length)
    const data = content.slice(start, end)

    // Update position if not pread
    if (offset === undefined) {
      entry.position = BigInt(end)
      this.fdTable.set(fd, entry)
    }

    return data
  }

  /**
   * Write to a file
   */
  fdWrite(fd: number, data: Uint8Array, offset?: bigint): number | Errno {
    const entry = this.fdTable.get(fd)
    if (!entry || entry.type !== 'file') {
      return Errno.EBADF
    }

    const content = this.fs.readFile(entry.path!) ?? new Uint8Array()
    const pos = offset ?? entry.position ?? 0n
    const start = Number(pos)

    // Expand content if needed
    const newSize = Math.max(content.length, start + data.length)
    const newContent = new Uint8Array(newSize)
    newContent.set(content, 0)
    newContent.set(data, start)

    this.fs.writeFile(entry.path!, newContent)

    // Update position if not pwrite
    if (offset === undefined) {
      entry.position = BigInt(start + data.length)
      this.fdTable.set(fd, entry)
    }

    return data.length
  }

  // Additional methods: seek, stat, readdir, etc.

  private resolvePath(base: string, relative: string): string {
    if (relative.startsWith('/')) {
      return relative
    }
    return base.replace(/\/$/, '') + '/' + relative
  }
}
```

---

## Phase 5: Integration & Compatibility Tests (~400 LOC)

**Priority**: High | **Effort**: Medium | **Duration**: 2 days

### 5.1 Integration Tests (`test/wasip1/integration.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { Wasip1 } from '../../src/wasip1/index.js'
import { MemoryFilesystem } from '../../src/wasip1/filesystem/memory.js'

describe('WASIP1 Integration', () => {
  describe('Hello World', () => {
    it('should run a simple hello world program', async () => {
      const output: string[] = []

      const wasip1 = new Wasip1({
        args: ['hello'],
        stdout: {
          write: (data) => {
            output.push(new TextDecoder().decode(data))
            return data.length
          }
        }
      })

      // Load and run a simple WASI P1 module
      // (This would require a real .wasm file in tests)
      // const module = await WebAssembly.compile(helloWorldWasm)
      // const instance = await WebAssembly.instantiate(module, {
      //   wasi_snapshot_preview1: wasip1.getImports()
      // })
      // wasip1.setMemory(instance.exports.memory)
      // instance.exports._start()

      // expect(output.join('')).toBe('Hello, World!\n')
    })
  })

  describe('File Operations', () => {
    it('should read and write files', async () => {
      const fs = new MemoryFilesystem({
        files: {
          '/input.txt': 'Hello from file'
        }
      })

      const wasip1 = new Wasip1({
        args: ['test'],
        preopens: { '/': fs }
      })

      // Test file operations
      expect(fs.exists('/input.txt')).toBe(true)
      expect(fs.readFile('/input.txt')).toEqual(
        new TextEncoder().encode('Hello from file')
      )

      fs.writeFile('/output.txt', new TextEncoder().encode('Written'))
      expect(fs.exists('/output.txt')).toBe(true)
    })
  })

  describe('Environment', () => {
    it('should pass environment variables', () => {
      const wasip1 = new Wasip1({
        env: {
          HOME: '/home/user',
          USER: 'testuser'
        }
      })

      const memory = new WebAssembly.Memory({ initial: 1 })
      wasip1.setMemory(memory)

      const imports = wasip1.getImports()
      const view = new DataView(memory.buffer)

      imports.environ_sizes_get(0, 4)

      const count = view.getUint32(0, true)
      expect(count).toBe(2)
    })
  })
})
```

### 5.2 Compatibility Tests (`test/wasip1/compatibility.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { Wasip1 } from '../../src/wasip1/index.js'
import { Errno, ClockId, FileType, Whence } from '../../src/wasip1/types.js'

/**
 * These tests verify our implementation matches wasmtime/wasmer behavior
 * for edge cases and specific scenarios.
 */
describe('WASIP1 Compatibility', () => {
  describe('Error Codes', () => {
    it('should return correct errno for common errors', () => {
      const wasip1 = new Wasip1({})
      const memory = new WebAssembly.Memory({ initial: 1 })
      wasip1.setMemory(memory)
      const imports = wasip1.getImports()

      // EBADF for invalid fd
      expect(imports.fd_read(999, 0, 0, 0)).toBe(Errno.EBADF)
      expect(imports.fd_write(999, 0, 0, 0)).toBe(Errno.EBADF)
      expect(imports.fd_close(999)).toBe(Errno.EBADF)

      // EINVAL for invalid clock
      expect(imports.clock_time_get(99, 0n, 0)).toBe(Errno.EINVAL)
    })
  })

  describe('Preopen Behavior', () => {
    it('should iterate preopens starting at fd 3', () => {
      const fs = new MemoryFilesystem()
      const wasip1 = new Wasip1({
        preopens: { '/': fs }
      })

      const memory = new WebAssembly.Memory({ initial: 1 })
      wasip1.setMemory(memory)
      const imports = wasip1.getImports()
      const view = new DataView(memory.buffer)

      // fd 3 should be the first preopen
      expect(imports.fd_prestat_get(3, 0)).toBe(Errno.SUCCESS)

      // fd 4 should not exist (only one preopen)
      expect(imports.fd_prestat_get(4, 0)).toBe(Errno.EBADF)
    })
  })

  describe('Clock Behavior', () => {
    it('should handle all standard clock IDs', () => {
      const wasip1 = new Wasip1({})
      const memory = new WebAssembly.Memory({ initial: 1 })
      wasip1.setMemory(memory)
      const imports = wasip1.getImports()

      // REALTIME and MONOTONIC should work
      expect(imports.clock_time_get(ClockId.REALTIME, 0n, 0)).toBe(Errno.SUCCESS)
      expect(imports.clock_time_get(ClockId.MONOTONIC, 0n, 0)).toBe(Errno.SUCCESS)

      // CPU time clocks may return approximations
      expect(imports.clock_time_get(ClockId.PROCESS_CPUTIME_ID, 0n, 0)).toBe(Errno.SUCCESS)
    })
  })

  describe('Rights Inheritance', () => {
    it('should respect rights when opening files', () => {
      // Test that files opened from a directory
      // respect the inheriting rights of that directory
    })
  })
})
```

---

## Phase 6: Documentation (~200 LOC)

**Priority**: Medium | **Effort**: Low | **Duration**: 0.5 day

### 6.1 Blocking I/O Documentation

Add to PLAN.md or create `docs/wasip1-limitations.md`:

```markdown
# WASIP1 Limitations and Workarounds

## Blocking I/O

WASIP1 was designed for synchronous execution, but JavaScript is inherently
asynchronous. This creates challenges for certain operations.

### stdin Blocking

**Problem**: `fd_read` on stdin should block until input is available.

**Current Behavior**: Returns immediately with available data or empty.

**Workarounds**:
1. **Pre-buffer input**: Provide all input upfront via configuration
2. **Async wrapper**: Use an async wrapper around the entire execution
3. **SharedArrayBuffer**: Use Atomics.wait for true blocking (requires COOP/COEP)

### poll_oneoff with Clock Subscriptions

**Problem**: `poll_oneoff` should block until a timeout expires.

**Current Behavior**: Checks readiness and returns immediately.

**Workarounds**:
1. **Event loop integration**: Use requestAnimationFrame or setTimeout
2. **SharedArrayBuffer**: Use Atomics.wait for precise timing

## Socket Operations

Socket operations (`sock_*`) return `ENOSYS` in browser environments.
Use the WASIP2 proxy or WebSocket gateway for network operations.

## Thread Safety

WASIP1 assumes single-threaded execution. When using Web Workers:
- Each worker needs its own WASIP1 instance
- File descriptors are not shared between workers
- Use SharedArrayBuffer for inter-worker communication
```

---

## Implementation Checklist

### Phase 1: Memory Helper Tests
- [ ] `test/wasip1/memory.test.ts` (~400 lines)

### Phase 2: FD Table Tests
- [ ] `test/wasip1/fd-table.test.ts` (~300 lines)

### Phase 3: WASI Function Tests
- [ ] `test/wasip1/args-environ.test.ts` (~200 lines)
- [ ] `test/wasip1/clock.test.ts` (~150 lines)
- [ ] `test/wasip1/fd.test.ts` (~500 lines)
- [ ] `test/wasip1/path.test.ts` (~300 lines)
- [ ] `test/wasip1/random.test.ts` (~100 lines)
- [ ] `test/wasip1/poll.test.ts` (~200 lines)
- [ ] `test/wasip1/proc.test.ts` (~100 lines)

### Phase 4: Memory Filesystem
- [ ] `src/wasip1/filesystem/memory.ts` (~400 lines)
- [ ] `src/wasip1/filesystem/adapter.ts` (~200 lines)
- [ ] `test/wasip1/filesystem.test.ts` (~300 lines)

### Phase 5: Integration & Compatibility
- [ ] `test/wasip1/integration.test.ts` (~200 lines)
- [ ] `test/wasip1/compatibility.test.ts` (~200 lines)

### Phase 6: Documentation
- [ ] Update PLAN.md with limitations
- [ ] Create blocking I/O guide

---

## Success Criteria

1. **Coverage**: >90% line coverage for all wasip1 modules
2. **Functions**: All 46 functions have dedicated tests
3. **Filesystem**: Memory filesystem passes all path/fd tests
4. **Compatibility**: Behavior matches wasmtime for standard operations
5. **Documentation**: Limitations clearly documented with workarounds

## Estimated Total Effort

| Phase | LOC | Duration |
|-------|-----|----------|
| Memory Helper Tests | ~400 | 1-2 days |
| FD Table Tests | ~300 | 1 day |
| WASI Function Tests | ~1500 | 4-5 days |
| Memory Filesystem | ~900 | 2-3 days |
| Integration Tests | ~400 | 2 days |
| Documentation | ~200 | 0.5 day |
| **Total** | **~3700** | **10-13 days** |
