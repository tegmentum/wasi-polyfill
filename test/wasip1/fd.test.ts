import { describe, it, expect, beforeEach } from 'vitest'
import { createFdFunctions, type FileResource, type DirectoryResource } from '../../src/wasip1/fd.js'
import { WasiMemory } from '../../src/wasip1/memory.js'
import {
  FileDescriptorTable,
  createStdinEntry,
  createStdoutEntry,
  createStderrEntry,
  createDirectoryEntry,
  createFileEntry,
} from '../../src/wasip1/fd-table.js'
import { Errno, FileType, Whence, FdFlags, FstFlags, Rights, DIRENT_SIZE } from '../../src/wasip1/types.js'

/**
 * Creates a mock file resource for testing.
 */
function createMockFileResource(data: Uint8Array = new Uint8Array()): FileResource {
  let content = new Uint8Array(data)
  const stats = {
    dev: 1n,
    ino: 1n,
    filetype: FileType.REGULAR_FILE,
    nlink: 1n,
    size: BigInt(content.length),
    atim: BigInt(Date.now()) * 1_000_000n,
    mtim: BigInt(Date.now()) * 1_000_000n,
    ctim: BigInt(Date.now()) * 1_000_000n,
  }

  return {
    read(offset: bigint, len: number): Uint8Array {
      const start = Number(offset)
      if (start >= content.length) return new Uint8Array()
      const end = Math.min(start + len, content.length)
      return content.slice(start, end)
    },
    write(offset: bigint, data: Uint8Array): number {
      const start = Number(offset)
      const end = start + data.length
      if (end > content.length) {
        const newContent = new Uint8Array(end)
        newContent.set(content)
        content = newContent
        stats.size = BigInt(content.length)
      }
      content.set(data, start)
      stats.mtim = BigInt(Date.now()) * 1_000_000n
      return data.length
    },
    size(): bigint {
      return BigInt(content.length)
    },
    setSize(size: bigint): void {
      const newSize = Number(size)
      const newContent = new Uint8Array(newSize)
      newContent.set(content.slice(0, Math.min(content.length, newSize)))
      content = newContent
      stats.size = size
    },
    sync(): void {},
    stat() {
      return { ...stats, size: BigInt(content.length) }
    },
    setTimes(atim: bigint | null, mtim: bigint | null): void {
      if (atim !== null) stats.atim = atim
      if (mtim !== null) stats.mtim = mtim
    },
  }
}

/**
 * Creates a mock directory resource for testing.
 */
function createMockDirectoryResource(
  entries: Array<{ name: string; ino: bigint; type: FileType }>
): DirectoryResource {
  return {
    readdir() {
      return entries
    },
    stat() {
      return {
        dev: 1n,
        ino: 1n,
        filetype: FileType.DIRECTORY,
        nlink: BigInt(entries.length + 2), // . and ..
        size: 4096n,
        atim: BigInt(Date.now()) * 1_000_000n,
        mtim: BigInt(Date.now()) * 1_000_000n,
        ctim: BigInt(Date.now()) * 1_000_000n,
      }
    },
  }
}

describe('WASIP1 FD Functions', () => {
  let wasiMemory: WasiMemory
  let memory: WebAssembly.Memory
  let fdTable: FileDescriptorTable
  let fdFunctions: ReturnType<typeof createFdFunctions>
  let stdoutData: Uint8Array[]
  let stderrData: Uint8Array[]

  beforeEach(() => {
    wasiMemory = new WasiMemory()
    memory = new WebAssembly.Memory({ initial: 1 })
    wasiMemory.attach(memory)
    fdTable = new FileDescriptorTable()

    stdoutData = []
    stderrData = []

    fdFunctions = createFdFunctions(wasiMemory, fdTable, {
      stdin: {
        read: async () => new Uint8Array(),
        tryRead: () => null,
      },
      stdout: { write: (data) => { stdoutData.push(data) } },
      stderr: { write: (data) => { stderrData.push(data) } },
    })

    // Initialize stdio
    fdTable.initStdio(createStdinEntry(), createStdoutEntry(), createStderrEntry())
  })

  describe('fd_advise', () => {
    it('returns SUCCESS for valid fd', () => {
      const fileResource = createMockFileResource()
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_advise(fd, 0n, 100n, 0)
      expect(result).toBe(Errno.SUCCESS)
    })

    it('returns EBADF for invalid fd', () => {
      const result = fdFunctions.fd_advise(999, 0n, 100n, 0)
      expect(result).toBe(Errno.EBADF)
    })

    it('returns ENOTCAPABLE when missing rights', () => {
      const entry = createFileEntry('/test.txt', 0, { base: 0n, inheriting: 0n })
      const fd = fdTable.allocate(entry)

      const result = fdFunctions.fd_advise(fd, 0n, 100n, 0)
      expect(result).toBe(Errno.ENOTCAPABLE)
    })
  })

  describe('fd_allocate', () => {
    it('extends file size', () => {
      const fileResource = createMockFileResource(new Uint8Array([1, 2, 3]))
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_allocate(fd, 0n, 100n)
      expect(result).toBe(Errno.SUCCESS)
      expect(fileResource.size()).toBe(100n)
    })

    it('does not shrink file', () => {
      const fileResource = createMockFileResource(new Uint8Array(100))
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_allocate(fd, 0n, 50n)
      expect(result).toBe(Errno.SUCCESS)
      expect(fileResource.size()).toBe(100n)
    })

    it('returns EBADF for invalid fd', () => {
      const result = fdFunctions.fd_allocate(999, 0n, 100n)
      expect(result).toBe(Errno.EBADF)
    })
  })

  describe('fd_close', () => {
    it('closes a file descriptor', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))
      expect(fdTable.has(fd)).toBe(true)

      const result = fdFunctions.fd_close(fd)
      expect(result).toBe(Errno.SUCCESS)
      expect(fdTable.has(fd)).toBe(false)
    })

    it('returns EBADF for invalid fd', () => {
      const result = fdFunctions.fd_close(999)
      expect(result).toBe(Errno.EBADF)
    })

    it('returns EBADF for stdio', () => {
      expect(fdFunctions.fd_close(0)).toBe(Errno.EBADF)
      expect(fdFunctions.fd_close(1)).toBe(Errno.EBADF)
      expect(fdFunctions.fd_close(2)).toBe(Errno.EBADF)
    })
  })

  describe('fd_datasync', () => {
    it('returns SUCCESS for valid fd', () => {
      const fileResource = createMockFileResource()
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_datasync(fd)
      expect(result).toBe(Errno.SUCCESS)
    })

    it('returns EBADF for invalid fd', () => {
      const result = fdFunctions.fd_datasync(999)
      expect(result).toBe(Errno.EBADF)
    })
  })

  describe('fd_fdstat_get', () => {
    it('writes fdstat for file', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', FdFlags.APPEND))
      const statPtr = 100

      const result = fdFunctions.fd_fdstat_get(fd, statPtr)
      expect(result).toBe(Errno.SUCCESS)

      // Verify structure was written
      expect(wasiMemory.readU8(statPtr)).toBe(FileType.REGULAR_FILE)
      expect(wasiMemory.readU16(statPtr + 2)).toBe(FdFlags.APPEND)
    })

    it('writes fdstat for directory', () => {
      const fd = fdTable.allocate(createDirectoryEntry('/home', '/home'))
      const statPtr = 100

      const result = fdFunctions.fd_fdstat_get(fd, statPtr)
      expect(result).toBe(Errno.SUCCESS)

      expect(wasiMemory.readU8(statPtr)).toBe(FileType.DIRECTORY)
    })

    it('returns EBADF for invalid fd', () => {
      const result = fdFunctions.fd_fdstat_get(999, 100)
      expect(result).toBe(Errno.EBADF)
    })
  })

  describe('fd_fdstat_set_flags', () => {
    it('sets file descriptor flags', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))

      const result = fdFunctions.fd_fdstat_set_flags(fd, FdFlags.APPEND | FdFlags.NONBLOCK)
      expect(result).toBe(Errno.SUCCESS)

      const entry = fdTable.get(fd)!
      expect(entry.flags).toBe(FdFlags.APPEND | FdFlags.NONBLOCK)
    })

    it('returns EBADF for invalid fd', () => {
      const result = fdFunctions.fd_fdstat_set_flags(999, 0)
      expect(result).toBe(Errno.EBADF)
    })
  })

  describe('fd_fdstat_set_rights', () => {
    it('reduces rights', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))

      const result = fdFunctions.fd_fdstat_set_rights(fd, Rights.FD_READ, 0n)
      expect(result).toBe(Errno.SUCCESS)

      const entry = fdTable.get(fd)!
      expect(entry.rights.base).toBe(Rights.FD_READ)
    })

    it('returns ENOTCAPABLE when trying to expand rights', () => {
      const entry = createFileEntry('/test.txt', 0, { base: Rights.FD_READ, inheriting: 0n })
      const fd = fdTable.allocate(entry)

      const result = fdFunctions.fd_fdstat_set_rights(fd, Rights.FD_READ | Rights.FD_WRITE, 0n)
      expect(result).toBe(Errno.ENOTCAPABLE)
    })
  })

  describe('fd_filestat_get', () => {
    it('writes filestat for file', () => {
      const fileResource = createMockFileResource(new Uint8Array([1, 2, 3, 4, 5]))
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))
      const statPtr = 100

      const result = fdFunctions.fd_filestat_get(fd, statPtr)
      expect(result).toBe(Errno.SUCCESS)

      // Check size at offset 32
      expect(wasiMemory.readU64(statPtr + 32)).toBe(5n)
      // Check filetype at offset 16
      expect(wasiMemory.readU8(statPtr + 16)).toBe(FileType.REGULAR_FILE)
    })

    it('writes default stats for stdio', () => {
      // stdin doesn't have FD_FILESTAT_GET right by default
      // but we can test with a character device that has the right
      const entry = createStdinEntry()
      entry.rights.base = entry.rights.base | Rights.FD_FILESTAT_GET
      fdTable.set(0, entry)

      const statPtr = 100
      const result = fdFunctions.fd_filestat_get(0, statPtr)
      expect(result).toBe(Errno.SUCCESS)

      expect(wasiMemory.readU8(statPtr + 16)).toBe(FileType.CHARACTER_DEVICE)
    })

    it('returns EBADF for invalid fd', () => {
      const result = fdFunctions.fd_filestat_get(999, 100)
      expect(result).toBe(Errno.EBADF)
    })
  })

  describe('fd_filestat_set_size', () => {
    it('truncates file', () => {
      const fileResource = createMockFileResource(new Uint8Array(100))
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_filestat_set_size(fd, 50n)
      expect(result).toBe(Errno.SUCCESS)
      expect(fileResource.size()).toBe(50n)
    })

    it('extends file', () => {
      const fileResource = createMockFileResource(new Uint8Array(50))
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_filestat_set_size(fd, 100n)
      expect(result).toBe(Errno.SUCCESS)
      expect(fileResource.size()).toBe(100n)
    })
  })

  describe('fd_filestat_set_times', () => {
    it('sets access time', () => {
      const fileResource = createMockFileResource()
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_filestat_set_times(fd, 1000000000n, 0n, FstFlags.ATIM)
      expect(result).toBe(Errno.SUCCESS)

      const stat = fileResource.stat()
      expect(stat.atim).toBe(1000000000n)
    })

    it('sets modification time', () => {
      const fileResource = createMockFileResource()
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_filestat_set_times(fd, 0n, 2000000000n, FstFlags.MTIM)
      expect(result).toBe(Errno.SUCCESS)

      const stat = fileResource.stat()
      expect(stat.mtim).toBe(2000000000n)
    })

    it('sets times to now', () => {
      const fileResource = createMockFileResource()
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))
      const before = BigInt(Date.now()) * 1_000_000n

      const result = fdFunctions.fd_filestat_set_times(fd, 0n, 0n, FstFlags.ATIM_NOW | FstFlags.MTIM_NOW)
      expect(result).toBe(Errno.SUCCESS)

      const stat = fileResource.stat()
      expect(stat.atim).toBeGreaterThanOrEqual(before)
      expect(stat.mtim).toBeGreaterThanOrEqual(before)
    })

    it('returns EINVAL when ATIM and ATIM_NOW are both set', () => {
      const fileResource = createMockFileResource()
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_filestat_set_times(
        fd,
        1000000000n,
        0n,
        FstFlags.ATIM | FstFlags.ATIM_NOW
      )
      expect(result).toBe(Errno.EINVAL)
    })

    it('returns EINVAL when MTIM and MTIM_NOW are both set', () => {
      const fileResource = createMockFileResource()
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_filestat_set_times(
        fd,
        0n,
        2000000000n,
        FstFlags.MTIM | FstFlags.MTIM_NOW
      )
      expect(result).toBe(Errno.EINVAL)
    })
  })

  describe('fd_pread', () => {
    it('reads at offset without changing position', () => {
      const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      const fileResource = createMockFileResource(data)
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      entry.position = 0n
      const fd = fdTable.allocate(entry)

      // Set up iovec
      const iovsPtr = 100
      wasiMemory.writeU32(iovsPtr, 200) // buf
      wasiMemory.writeU32(iovsPtr + 4, 5) // len

      const nreadPtr = 300

      const result = fdFunctions.fd_pread(fd, iovsPtr, 1, 3n, nreadPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU32(nreadPtr)).toBe(5)
      expect(wasiMemory.readBytes(200, 5)).toEqual(new Uint8Array([3, 4, 5, 6, 7]))

      // Position should not change
      expect(fdTable.get(fd)?.position).toBe(0n)
    })
  })

  describe('fd_prestat_get', () => {
    it('returns prestat for preopened directory', () => {
      fdTable.allocateAt(3, createDirectoryEntry('/home', '/home'))
      const prestatPtr = 100

      const result = fdFunctions.fd_prestat_get(3, prestatPtr)
      expect(result).toBe(Errno.SUCCESS)

      // Check prestat type
      expect(wasiMemory.readU8(prestatPtr)).toBe(0) // DIR
      // Check name length
      expect(wasiMemory.readU32(prestatPtr + 4)).toBe(5) // "/home".length
    })

    it('returns EBADF for non-preopen', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))
      const result = fdFunctions.fd_prestat_get(fd, 100)
      expect(result).toBe(Errno.EBADF)
    })
  })

  describe('fd_prestat_dir_name', () => {
    it('returns preopen path', () => {
      fdTable.allocateAt(3, createDirectoryEntry('/home', '/home'))
      const pathPtr = 100

      const result = fdFunctions.fd_prestat_dir_name(3, pathPtr, 10)
      expect(result).toBe(Errno.SUCCESS)

      expect(wasiMemory.readBytes(pathPtr, 5)).toEqual(new TextEncoder().encode('/home'))
    })

    it('returns ENAMETOOLONG if buffer too small', () => {
      fdTable.allocateAt(3, createDirectoryEntry('/home/very/long/path', '/home/very/long/path'))

      const result = fdFunctions.fd_prestat_dir_name(3, 100, 5)
      expect(result).toBe(Errno.ENAMETOOLONG)
    })
  })

  describe('fd_pwrite', () => {
    it('writes at offset without changing position', () => {
      const fileResource = createMockFileResource(new Uint8Array(20))
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      entry.position = 0n
      const fd = fdTable.allocate(entry)

      // Set up ciovec
      const ciovsPtr = 100
      wasiMemory.writeU32(ciovsPtr, 200) // buf
      wasiMemory.writeU32(ciovsPtr + 4, 5) // len
      wasiMemory.writeBytes(200, new Uint8Array([10, 11, 12, 13, 14]))

      const nwrittenPtr = 300

      const result = fdFunctions.fd_pwrite(fd, ciovsPtr, 1, 5n, nwrittenPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU32(nwrittenPtr)).toBe(5)

      // Verify data was written at offset
      expect(fileResource.read(5n, 5)).toEqual(new Uint8Array([10, 11, 12, 13, 14]))

      // Position should not change
      expect(fdTable.get(fd)?.position).toBe(0n)
    })
  })

  describe('fd_read', () => {
    it('reads from file and updates position', () => {
      const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      const fileResource = createMockFileResource(data)
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      const fd = fdTable.allocate(entry)

      // Set up iovec
      const iovsPtr = 100
      wasiMemory.writeU32(iovsPtr, 200) // buf
      wasiMemory.writeU32(iovsPtr + 4, 5) // len

      const nreadPtr = 300

      const result = fdFunctions.fd_read(fd, iovsPtr, 1, nreadPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU32(nreadPtr)).toBe(5)
      expect(wasiMemory.readBytes(200, 5)).toEqual(new Uint8Array([0, 1, 2, 3, 4]))

      // Position should update
      expect(fdTable.get(fd)?.position).toBe(5n)
    })

    it('reads multiple iovecs', () => {
      const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      const fileResource = createMockFileResource(data)
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      const fd = fdTable.allocate(entry)

      // Set up two iovecs
      const iovsPtr = 100
      wasiMemory.writeU32(iovsPtr, 200) // buf1
      wasiMemory.writeU32(iovsPtr + 4, 3) // len1
      wasiMemory.writeU32(iovsPtr + 8, 210) // buf2
      wasiMemory.writeU32(iovsPtr + 12, 3) // len2

      const nreadPtr = 300

      const result = fdFunctions.fd_read(fd, iovsPtr, 2, nreadPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU32(nreadPtr)).toBe(6)
      expect(wasiMemory.readBytes(200, 3)).toEqual(new Uint8Array([0, 1, 2]))
      expect(wasiMemory.readBytes(210, 3)).toEqual(new Uint8Array([3, 4, 5]))
    })

    it('returns 0 bytes at EOF', () => {
      const fileResource = createMockFileResource(new Uint8Array())
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      const fd = fdTable.allocate(entry)

      const iovsPtr = 100
      wasiMemory.writeU32(iovsPtr, 200)
      wasiMemory.writeU32(iovsPtr + 4, 10)

      const nreadPtr = 300

      const result = fdFunctions.fd_read(fd, iovsPtr, 1, nreadPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU32(nreadPtr)).toBe(0)
    })
  })

  describe('fd_readdir', () => {
    it('reads directory entries', () => {
      const dirResource = createMockDirectoryResource([
        { name: 'file1.txt', ino: 10n, type: FileType.REGULAR_FILE },
        { name: 'subdir', ino: 20n, type: FileType.DIRECTORY },
      ])
      const entry = createDirectoryEntry('/home', undefined, dirResource)
      const fd = fdTable.allocate(entry)

      const bufPtr = 100
      const bufLen = 256
      const bufUsedPtr = 400

      const result = fdFunctions.fd_readdir(fd, bufPtr, bufLen, 0n, bufUsedPtr)
      expect(result).toBe(Errno.SUCCESS)

      const bufUsed = wasiMemory.readU32(bufUsedPtr)
      expect(bufUsed).toBeGreaterThan(0)

      // First entry should be file1.txt
      const firstIno = wasiMemory.readU64(bufPtr + 8)
      expect(firstIno).toBe(10n)
    })

    it('respects cookie to skip entries', () => {
      const dirResource = createMockDirectoryResource([
        { name: 'first', ino: 1n, type: FileType.REGULAR_FILE },
        { name: 'second', ino: 2n, type: FileType.REGULAR_FILE },
      ])
      const entry = createDirectoryEntry('/home', undefined, dirResource)
      const fd = fdTable.allocate(entry)

      const bufPtr = 100
      const bufUsedPtr = 400

      // Skip first entry
      const result = fdFunctions.fd_readdir(fd, bufPtr, 256, 1n, bufUsedPtr)
      expect(result).toBe(Errno.SUCCESS)

      // Should have second entry
      const ino = wasiMemory.readU64(bufPtr + 8)
      expect(ino).toBe(2n)
    })

    it('returns ENOTDIR for non-directory', () => {
      // Create a file with FD_READDIR right to ensure we get ENOTDIR, not ENOTCAPABLE
      const entry = createFileEntry('/test.txt', 0, { base: Rights.FD_READDIR, inheriting: 0n })
      const fd = fdTable.allocate(entry)
      const result = fdFunctions.fd_readdir(fd, 100, 256, 0n, 400)
      expect(result).toBe(Errno.ENOTDIR)
    })

    it('caches the listing across pages and refreshes at cookie 0', () => {
      const entries = [
        { name: 'a', ino: 1n, type: FileType.REGULAR_FILE },
        { name: 'b', ino: 2n, type: FileType.REGULAR_FILE },
        { name: 'c', ino: 3n, type: FileType.REGULAR_FILE },
      ]
      let calls = 0
      const resource: DirectoryResource = {
        readdir() {
          calls++
          return entries
        },
        stat: () => createMockDirectoryResource(entries).stat(),
      }
      const fd = fdTable.allocate(createDirectoryEntry('/d', undefined, resource))
      const bufPtr = 100
      const bufUsedPtr = 1000

      fdFunctions.fd_readdir(fd, bufPtr, 256, 0n, bufUsedPtr)
      expect(calls).toBe(1)
      // Continue paging from cookie 1: reuse the snapshot (no new readdir()).
      fdFunctions.fd_readdir(fd, bufPtr, 256, 1n, bufUsedPtr)
      expect(calls).toBe(1)
      expect(wasiMemory.readU64(bufPtr + 8)).toBe(2n) // second entry first
      // A fresh enumeration (cookie 0) refreshes the snapshot.
      fdFunctions.fd_readdir(fd, bufPtr, 256, 0n, bufUsedPtr)
      expect(calls).toBe(2)
    })

    it('returns every entry across multiple small pages (one readdir total)', () => {
      const entries = Array.from({ length: 10 }, (_, i) => ({
        name: `f${i}`,
        ino: BigInt(i + 1),
        type: FileType.REGULAR_FILE,
      }))
      let calls = 0
      const resource: DirectoryResource = {
        readdir() {
          calls++
          return entries
        },
        stat: () => createMockDirectoryResource(entries).stat(),
      }
      const fd = fdTable.allocate(createDirectoryEntry('/d', undefined, resource))
      const bufPtr = 100
      const bufUsedPtr = 2000
      const pageLen = DIRENT_SIZE + 4 // room for ~one entry per page

      const seen: bigint[] = []
      let cookie = 0n
      for (let guard = 0; guard < 100; guard++) {
        const r = fdFunctions.fd_readdir(fd, bufPtr, pageLen, cookie, bufUsedPtr)
        expect(r).toBe(Errno.SUCCESS)
        const used = wasiMemory.readU32(bufUsedPtr)
        if (used === 0) break
        let o = 0
        while (o < used) {
          const next = wasiMemory.readU64(bufPtr + o)
          const ino = wasiMemory.readU64(bufPtr + o + 8)
          const namelen = wasiMemory.readU32(bufPtr + o + 16)
          seen.push(ino)
          cookie = next
          o += DIRENT_SIZE + namelen
        }
      }

      expect(seen).toEqual(entries.map((e) => e.ino))
      expect(calls).toBe(1)
    })
  })

  describe('fd_renumber', () => {
    it('renumbers fd', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))

      const result = fdFunctions.fd_renumber(fd, 10)
      expect(result).toBe(Errno.SUCCESS)

      expect(fdTable.has(fd)).toBe(false)
      expect(fdTable.has(10)).toBe(true)
    })

    it('returns EBADF when renumbering to stdio', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))

      expect(fdFunctions.fd_renumber(fd, 0)).toBe(Errno.EBADF)
      expect(fdFunctions.fd_renumber(fd, 1)).toBe(Errno.EBADF)
      expect(fdFunctions.fd_renumber(fd, 2)).toBe(Errno.EBADF)
    })
  })

  describe('fd_seek', () => {
    it('seeks from start', () => {
      const fileResource = createMockFileResource(new Uint8Array(100))
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      const fd = fdTable.allocate(entry)
      const newOffsetPtr = 300

      const result = fdFunctions.fd_seek(fd, 50n, Whence.SET, newOffsetPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU64(newOffsetPtr)).toBe(50n)
      expect(fdTable.get(fd)?.position).toBe(50n)
    })

    it('seeks from current position', () => {
      const fileResource = createMockFileResource(new Uint8Array(100))
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      entry.position = 20n
      const fd = fdTable.allocate(entry)
      const newOffsetPtr = 300

      const result = fdFunctions.fd_seek(fd, 30n, Whence.CUR, newOffsetPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU64(newOffsetPtr)).toBe(50n)
    })

    it('seeks from end', () => {
      const fileResource = createMockFileResource(new Uint8Array(100))
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      const fd = fdTable.allocate(entry)
      const newOffsetPtr = 300

      const result = fdFunctions.fd_seek(fd, -10n, Whence.END, newOffsetPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU64(newOffsetPtr)).toBe(90n)
    })

    it('returns ESPIPE for stdio', () => {
      // stdin/stdout don't have FD_SEEK right by default, so add it to test ESPIPE
      const stdinEntry = createStdinEntry()
      stdinEntry.rights.base = stdinEntry.rights.base | Rights.FD_SEEK
      fdTable.set(0, stdinEntry)

      const stdoutEntry = createStdoutEntry()
      stdoutEntry.rights.base = stdoutEntry.rights.base | Rights.FD_SEEK
      fdTable.set(1, stdoutEntry)

      const newOffsetPtr = 300
      expect(fdFunctions.fd_seek(0, 0n, Whence.SET, newOffsetPtr)).toBe(Errno.ESPIPE)
      expect(fdFunctions.fd_seek(1, 0n, Whence.SET, newOffsetPtr)).toBe(Errno.ESPIPE)
    })

    it('returns EINVAL for negative position', () => {
      const fileResource = createMockFileResource(new Uint8Array(10))
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      const fd = fdTable.allocate(entry)

      const result = fdFunctions.fd_seek(fd, -100n, Whence.SET, 300)
      expect(result).toBe(Errno.EINVAL)
    })
  })

  describe('fd_sync', () => {
    it('returns SUCCESS for valid fd', () => {
      const fileResource = createMockFileResource()
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0, undefined, fileResource))

      const result = fdFunctions.fd_sync(fd)
      expect(result).toBe(Errno.SUCCESS)
    })
  })

  describe('fd_tell', () => {
    it('returns current position', () => {
      const fileResource = createMockFileResource(new Uint8Array(100))
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      entry.position = 42n
      const fd = fdTable.allocate(entry)
      const offsetPtr = 300

      const result = fdFunctions.fd_tell(fd, offsetPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU64(offsetPtr)).toBe(42n)
    })
  })

  describe('fd_write', () => {
    it('writes to stdout', () => {
      const ciovsPtr = 100
      wasiMemory.writeU32(ciovsPtr, 200) // buf
      wasiMemory.writeU32(ciovsPtr + 4, 5) // len
      wasiMemory.writeBytes(200, new TextEncoder().encode('hello'))

      const nwrittenPtr = 300

      const result = fdFunctions.fd_write(1, ciovsPtr, 1, nwrittenPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU32(nwrittenPtr)).toBe(5)
      expect(stdoutData.length).toBe(1)
      expect(new TextDecoder().decode(stdoutData[0])).toBe('hello')
    })

    it('writes to stderr', () => {
      const ciovsPtr = 100
      wasiMemory.writeU32(ciovsPtr, 200)
      wasiMemory.writeU32(ciovsPtr + 4, 5)
      wasiMemory.writeBytes(200, new TextEncoder().encode('error'))

      const nwrittenPtr = 300

      const result = fdFunctions.fd_write(2, ciovsPtr, 1, nwrittenPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(stderrData.length).toBe(1)
      expect(new TextDecoder().decode(stderrData[0])).toBe('error')
    })

    it('writes to file and updates position', () => {
      const fileResource = createMockFileResource(new Uint8Array(10))
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      const fd = fdTable.allocate(entry)

      const ciovsPtr = 100
      wasiMemory.writeU32(ciovsPtr, 200)
      wasiMemory.writeU32(ciovsPtr + 4, 5)
      wasiMemory.writeBytes(200, new Uint8Array([1, 2, 3, 4, 5]))

      const nwrittenPtr = 300

      const result = fdFunctions.fd_write(fd, ciovsPtr, 1, nwrittenPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU32(nwrittenPtr)).toBe(5)
      expect(fdTable.get(fd)?.position).toBe(5n)
      expect(fileResource.read(0n, 5)).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    })

    it('writes in append mode', () => {
      const fileResource = createMockFileResource(new Uint8Array([10, 11, 12]))
      const entry = createFileEntry('/test.txt', FdFlags.APPEND, undefined, fileResource)
      entry.position = 0n
      const fd = fdTable.allocate(entry)

      const ciovsPtr = 100
      wasiMemory.writeU32(ciovsPtr, 200)
      wasiMemory.writeU32(ciovsPtr + 4, 2)
      wasiMemory.writeBytes(200, new Uint8Array([20, 21]))

      const nwrittenPtr = 300

      fdFunctions.fd_write(fd, ciovsPtr, 1, nwrittenPtr)

      // Data should be at end
      expect(fileResource.read(3n, 2)).toEqual(new Uint8Array([20, 21]))
    })

    it('writes multiple ciovecs', () => {
      const fileResource = createMockFileResource(new Uint8Array(20))
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      const fd = fdTable.allocate(entry)

      const ciovsPtr = 100
      wasiMemory.writeU32(ciovsPtr, 200) // buf1
      wasiMemory.writeU32(ciovsPtr + 4, 3) // len1
      wasiMemory.writeU32(ciovsPtr + 8, 210) // buf2
      wasiMemory.writeU32(ciovsPtr + 12, 3) // len2
      wasiMemory.writeBytes(200, new Uint8Array([1, 2, 3]))
      wasiMemory.writeBytes(210, new Uint8Array([4, 5, 6]))

      const nwrittenPtr = 300

      const result = fdFunctions.fd_write(fd, ciovsPtr, 2, nwrittenPtr)
      expect(result).toBe(Errno.SUCCESS)
      expect(wasiMemory.readU32(nwrittenPtr)).toBe(6)
      expect(fileResource.read(0n, 6)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
    })
  })

  describe('integration scenarios', () => {
    it('simulates reading a file sequentially', () => {
      const content = new TextEncoder().encode('Hello, World!')
      const fileResource = createMockFileResource(content)
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      const fd = fdTable.allocate(entry)

      const iovsPtr = 100
      const nreadPtr = 300
      const bufPtr = 200

      // Read in chunks
      const chunks: Uint8Array[] = []
      while (true) {
        wasiMemory.writeU32(iovsPtr, bufPtr)
        wasiMemory.writeU32(iovsPtr + 4, 5)

        fdFunctions.fd_read(fd, iovsPtr, 1, nreadPtr)
        const nread = wasiMemory.readU32(nreadPtr)
        if (nread === 0) break

        chunks.push(wasiMemory.readBytes(bufPtr, nread))
      }

      const result = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }

      expect(new TextDecoder().decode(result)).toBe('Hello, World!')
    })

    it('simulates writing then reading a file', () => {
      const fileResource = createMockFileResource(new Uint8Array(100))
      const entry = createFileEntry('/test.txt', 0, undefined, fileResource)
      const fd = fdTable.allocate(entry)

      // Write data
      const ciovsPtr = 100
      const nwrittenPtr = 300
      wasiMemory.writeU32(ciovsPtr, 200)
      wasiMemory.writeU32(ciovsPtr + 4, 11)
      wasiMemory.writeBytes(200, new TextEncoder().encode('Test data!!'))

      fdFunctions.fd_write(fd, ciovsPtr, 1, nwrittenPtr)

      // Seek to beginning
      fdFunctions.fd_seek(fd, 0n, Whence.SET, 400)

      // Read back
      const iovsPtr = 120
      const nreadPtr = 320
      wasiMemory.writeU32(iovsPtr, 220)
      wasiMemory.writeU32(iovsPtr + 4, 11)

      fdFunctions.fd_read(fd, iovsPtr, 1, nreadPtr)
      expect(wasiMemory.readU32(nreadPtr)).toBe(11)
      expect(new TextDecoder().decode(wasiMemory.readBytes(220, 11))).toBe('Test data!!')
    })
  })
})
