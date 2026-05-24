/**
 * WASI Preview 1 Path Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPathFunctions, type Filesystem } from '../../src/wasip1/path.js'
import { WasiMemory } from '../../src/wasip1/memory.js'
import {
  FileDescriptorTable,
  createDirectoryEntry,
} from '../../src/wasip1/fd-table.js'
import {
  Errno,
  FileType,
  OFlags,
  FstFlags,
  DIRECTORY_RIGHTS,
} from '../../src/wasip1/types.js'

/**
 * Mock filesystem for testing
 */
function createMockFilesystem(): Filesystem {
  const files = new Map<string, { content: Uint8Array; times: { atim: bigint; mtim: bigint } }>()
  const dirs = new Set<string>(['/'])

  return {
    open(path, options) {
      if (options.directory) {
        if (!dirs.has(path)) {
          throw new Error('Not found: ' + path)
        }
        return {
          readdir: () => {
            const entries: Array<{ name: string; type: FileType }> = []
            for (const f of files.keys()) {
              if (f.startsWith(path === '/' ? '/' : path + '/')) {
                const name = f.slice(path === '/' ? 1 : path.length + 1).split('/')[0]
                if (name && !entries.find((e) => e.name === name)) {
                  entries.push({ name, type: FileType.REGULAR_FILE })
                }
              }
            }
            for (const d of dirs) {
              if (d.startsWith(path === '/' ? '/' : path + '/') && d !== path) {
                const name = d.slice(path === '/' ? 1 : path.length + 1).split('/')[0]
                if (name && !entries.find((e) => e.name === name)) {
                  entries.push({ name, type: FileType.DIRECTORY })
                }
              }
            }
            return entries
          },
        }
      }

      if (options.exclusive && files.has(path)) {
        throw new Error('File exists: ' + path)
      }

      if (!options.create && !files.has(path)) {
        throw new Error('Not found: ' + path)
      }

      if (options.create && !files.has(path)) {
        files.set(path, {
          content: new Uint8Array(0),
          times: { atim: BigInt(Date.now()) * 1_000_000n, mtim: BigInt(Date.now()) * 1_000_000n },
        })
      }

      if (options.truncate && files.has(path)) {
        files.get(path)!.content = new Uint8Array(0)
      }

      const file = files.get(path)!
      let position = 0

      return {
        read(len: number): Uint8Array {
          const chunk = file.content.slice(position, position + len)
          position += chunk.length
          return chunk
        },
        write(data: Uint8Array): number {
          const newContent = new Uint8Array(Math.max(position + data.length, file.content.length))
          newContent.set(file.content)
          newContent.set(data, position)
          file.content = newContent
          position += data.length
          return data.length
        },
        seek(offset: bigint, whence: number): bigint {
          if (whence === 0) position = Number(offset)
          else if (whence === 1) position += Number(offset)
          else if (whence === 2) position = file.content.length + Number(offset)
          return BigInt(position)
        },
        size(): bigint {
          return BigInt(file.content.length)
        },
        close(): void {},
      }
    },

    createDirectory(path) {
      if (dirs.has(path)) {
        throw new Error('File exists: ' + path)
      }
      dirs.add(path)
    },

    removeDirectory(path) {
      if (!dirs.has(path)) {
        throw new Error('Not found: ' + path)
      }
      // Check if empty
      for (const f of files.keys()) {
        if (f.startsWith(path + '/')) {
          throw new Error('Directory not empty: ' + path)
        }
      }
      for (const d of dirs) {
        if (d.startsWith(path + '/')) {
          throw new Error('Directory not empty: ' + path)
        }
      }
      dirs.delete(path)
    },

    unlink(path) {
      if (!files.has(path)) {
        throw new Error('Not found: ' + path)
      }
      files.delete(path)
    },

    rename(oldPath, newPath) {
      if (files.has(oldPath)) {
        const file = files.get(oldPath)!
        files.delete(oldPath)
        files.set(newPath, file)
      } else if (dirs.has(oldPath)) {
        dirs.delete(oldPath)
        dirs.add(newPath)
      } else {
        throw new Error('Not found: ' + oldPath)
      }
    },

    stat(path) {
      const now = BigInt(Date.now()) * 1_000_000n
      if (dirs.has(path)) {
        return {
          dev: 0n,
          ino: BigInt(path.length),
          filetype: FileType.DIRECTORY,
          nlink: 1n,
          size: 0n,
          atim: now,
          mtim: now,
          ctim: now,
        }
      }
      if (files.has(path)) {
        const file = files.get(path)!
        return {
          dev: 0n,
          ino: BigInt(path.length),
          filetype: FileType.REGULAR_FILE,
          nlink: 1n,
          size: BigInt(file.content.length),
          atim: file.times.atim,
          mtim: file.times.mtim,
          ctim: now,
        }
      }
      throw new Error('Not found: ' + path)
    },

    setTimes(path, atim, mtim) {
      if (files.has(path)) {
        const file = files.get(path)!
        if (atim !== null) file.times.atim = atim
        if (mtim !== null) file.times.mtim = mtim
      } else if (dirs.has(path)) {
        // No-op for directories in this mock
      } else {
        throw new Error('Not found: ' + path)
      }
    },

    // Note: symlink, readlink, and link are intentionally NOT defined
    // so that path.ts returns ENOSYS when they are called
  }
}

describe('WASIP1 Path', () => {
  let memory: WasiMemory
  let wasmMemory: WebAssembly.Memory
  let fdTable: FileDescriptorTable
  let mockFs: Filesystem

  beforeEach(() => {
    wasmMemory = new WebAssembly.Memory({ initial: 1 })
    memory = new WasiMemory()
    memory.attach(wasmMemory)
    fdTable = new FileDescriptorTable()
    mockFs = createMockFilesystem()

    // Create preopen directory entry at fd 3
    const entry = createDirectoryEntry('/', '/', { filesystem: mockFs })
    entry.rights.base = DIRECTORY_RIGHTS
    entry.rights.inheriting = DIRECTORY_RIGHTS
    fdTable.allocateAt(3, entry)
  })

  /**
   * Helper to write a path to memory and return the pointer/length
   */
  function writePath(path: string): { ptr: number; len: number } {
    const encoded = new TextEncoder().encode(path)
    memory.writeBytes(1000, encoded)
    return { ptr: 1000, len: encoded.length }
  }

  describe('path_create_directory', () => {
    it('creates a directory', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/'], mockFs]) })
      const { ptr, len } = writePath('/newdir')

      const result = fns.path_create_directory(3, ptr, len)

      expect(result).toBe(Errno.SUCCESS)
    })

    it('returns EEXIST for existing directory', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr, len } = writePath('/newdir')

      fns.path_create_directory(3, ptr, len)
      const result = fns.path_create_directory(3, ptr, len)

      expect(result).toBe(Errno.EEXIST)
    })

    it('returns ENOTCAPABLE for invalid fd', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr, len } = writePath('/newdir')

      // The implementation checks rights first, so invalid fd returns ENOTCAPABLE
      const result = fns.path_create_directory(999, ptr, len)

      expect(result).toBe(Errno.ENOTCAPABLE)
    })
  })

  describe('path_remove_directory', () => {
    it('removes an empty directory', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr, len } = writePath('/mydir')

      fns.path_create_directory(3, ptr, len)
      const result = fns.path_remove_directory(3, ptr, len)

      expect(result).toBe(Errno.SUCCESS)
    })

    it('returns ENOENT for non-existent directory', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr, len } = writePath('/nonexistent')

      const result = fns.path_remove_directory(3, ptr, len)

      expect(result).toBe(Errno.ENOENT)
    })
  })

  describe('path_open', () => {
    it('opens existing file', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })

      // Create a file first
      const { ptr: createPtr, len: createLen } = writePath('/testfile')
      fns.path_open(3, 0, createPtr, createLen, OFlags.CREAT, 0n, 0n, 0, 2000)

      // Open it again
      const { ptr, len } = writePath('/testfile')
      const result = fns.path_open(3, 0, ptr, len, 0, 0n, 0n, 0, 2004)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(2004)).toBeGreaterThan(3) // New fd allocated
    })

    it('creates file with CREAT flag', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr, len } = writePath('/newfile')

      const result = fns.path_open(3, 0, ptr, len, OFlags.CREAT, 0n, 0n, 0, 2000)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(2000)).toBeGreaterThan(3)
    })

    it('returns ENOENT when file does not exist without CREAT', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr, len } = writePath('/nonexistent')

      const result = fns.path_open(3, 0, ptr, len, 0, 0n, 0n, 0, 2000)

      expect(result).toBe(Errno.ENOENT)
    })

    it('returns EEXIST with CREAT and EXCL for existing file', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })

      // Create file first
      const { ptr, len } = writePath('/existingfile')
      fns.path_open(3, 0, ptr, len, OFlags.CREAT, 0n, 0n, 0, 2000)

      // Try to create exclusively
      const result = fns.path_open(3, 0, ptr, len, OFlags.CREAT | OFlags.EXCL, 0n, 0n, 0, 2004)

      expect(result).toBe(Errno.EEXIST)
    })

    it('opens directory with DIRECTORY flag', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })

      // Create directory first
      const { ptr: dirPtr, len: dirLen } = writePath('/mydir')
      fns.path_create_directory(3, dirPtr, dirLen)

      // Open it
      const result = fns.path_open(3, 0, dirPtr, dirLen, OFlags.DIRECTORY, 0n, 0n, 0, 2000)

      expect(result).toBe(Errno.SUCCESS)
    })
  })

  describe('path_filestat_get', () => {
    it('gets stats for directory', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr, len } = writePath('/')

      const result = fns.path_filestat_get(3, 0, ptr, len, 2000)

      expect(result).toBe(Errno.SUCCESS)
      // Read filetype (at offset 16)
      expect(memory.readU8(2000 + 16)).toBe(FileType.DIRECTORY)
    })

    it('gets stats for file', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })

      // Create file
      const { ptr, len } = writePath('/testfile')
      fns.path_open(3, 0, ptr, len, OFlags.CREAT, 0n, 0n, 0, 2000)

      const result = fns.path_filestat_get(3, 0, ptr, len, 2100)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU8(2100 + 16)).toBe(FileType.REGULAR_FILE)
    })

    it('returns ENOENT for non-existent path', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr, len } = writePath('/nonexistent')

      const result = fns.path_filestat_get(3, 0, ptr, len, 2000)

      expect(result).toBe(Errno.ENOENT)
    })
  })

  describe('path_filestat_set_times', () => {
    it('sets file times with ATIM and MTIM', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })

      // Create file
      const { ptr, len } = writePath('/timefile')
      fns.path_open(3, 0, ptr, len, OFlags.CREAT, 0n, 0n, 0, 2000)

      const atim = 1000000000000000000n
      const mtim = 2000000000000000000n
      const result = fns.path_filestat_set_times(3, 0, ptr, len, atim, mtim, FstFlags.ATIM | FstFlags.MTIM)

      expect(result).toBe(Errno.SUCCESS)
    })

    it('sets times to now with ATIM_NOW and MTIM_NOW', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })

      // Create file
      const { ptr, len } = writePath('/nowfile')
      fns.path_open(3, 0, ptr, len, OFlags.CREAT, 0n, 0n, 0, 2000)

      const result = fns.path_filestat_set_times(3, 0, ptr, len, 0n, 0n, FstFlags.ATIM_NOW | FstFlags.MTIM_NOW)

      expect(result).toBe(Errno.SUCCESS)
    })
  })

  describe('path_unlink_file', () => {
    it('unlinks a file', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })

      // Create file
      const { ptr, len } = writePath('/todelete')
      fns.path_open(3, 0, ptr, len, OFlags.CREAT, 0n, 0n, 0, 2000)

      const result = fns.path_unlink_file(3, ptr, len)

      expect(result).toBe(Errno.SUCCESS)
    })

    it('returns ENOENT for non-existent file', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr, len } = writePath('/nonexistent')

      const result = fns.path_unlink_file(3, ptr, len)

      expect(result).toBe(Errno.ENOENT)
    })
  })

  describe('path_rename', () => {
    it('renames a file', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })

      // Create file - write old path at offset 1000
      const oldPath = '/oldname'
      const oldEncoded = new TextEncoder().encode(oldPath)
      memory.writeBytes(1000, oldEncoded)
      const oldPtr = 1000
      const oldLen = oldEncoded.length

      fns.path_open(3, 0, oldPtr, oldLen, OFlags.CREAT, 0n, 0n, 0, 2000)

      // Write new path at different offset (1100)
      const newPath = '/newname'
      const newEncoded = new TextEncoder().encode(newPath)
      memory.writeBytes(1100, newEncoded)
      const newPtr = 1100
      const newLen = newEncoded.length

      const result = fns.path_rename(3, oldPtr, oldLen, 3, newPtr, newLen)

      expect(result).toBe(Errno.SUCCESS)

      // Old should not exist
      expect(fns.path_filestat_get(3, 0, oldPtr, oldLen, 2100)).toBe(Errno.ENOENT)

      // New should exist
      expect(fns.path_filestat_get(3, 0, newPtr, newLen, 2100)).toBe(Errno.SUCCESS)
    })

    it('returns ENOENT for non-existent source', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })

      // Write old path at offset 1000
      const oldEncoded = new TextEncoder().encode('/nonexistent')
      memory.writeBytes(1000, oldEncoded)
      const oldPtr = 1000
      const oldLen = oldEncoded.length

      // Write new path at offset 1100
      const newEncoded = new TextEncoder().encode('/newname')
      memory.writeBytes(1100, newEncoded)
      const newPtr = 1100
      const newLen = newEncoded.length

      const result = fns.path_rename(3, oldPtr, oldLen, 3, newPtr, newLen)

      expect(result).toBe(Errno.ENOENT)
    })
  })

  describe('path_symlink', () => {
    it('returns ENOSYS when not supported', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr: targetPtr, len: targetLen } = writePath('/target')
      const { ptr: linkPtr, len: linkLen } = writePath('/link')

      const result = fns.path_symlink(targetPtr, targetLen, 3, linkPtr, linkLen)

      expect(result).toBe(Errno.ENOSYS)
    })
  })

  describe('path_readlink', () => {
    it('returns ENOSYS when not supported', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr, len } = writePath('/link')

      const result = fns.path_readlink(3, ptr, len, 2000, 256, 2256)

      expect(result).toBe(Errno.ENOSYS)
    })
  })

  describe('path_link', () => {
    it('returns ENOSYS when not supported', () => {
      const fns = createPathFunctions(memory, fdTable, { filesystems: new Map([['/', mockFs]]) })
      const { ptr: oldPtr, len: oldLen } = writePath('/source')
      const { ptr: newPtr, len: newLen } = writePath('/target')

      const result = fns.path_link(3, 0, oldPtr, oldLen, 3, newPtr, newLen)

      expect(result).toBe(Errno.ENOSYS)
    })
  })

  describe('path normalization and subdirectory fds (Phase 2.5/2.6)', () => {
    it('resolves "." and ".." components', () => {
      const fns = createPathFunctions(memory, fdTable, {
        filesystems: new Map([['/', mockFs]]),
      })

      // Create /data.txt
      const created = writePath('data.txt')
      expect(
        fns.path_open(3, 0, created.ptr, created.len, OFlags.CREAT, 0n, 0n, 0, 2000)
      ).toBe(Errno.SUCCESS)

      // Stat via a path that needs '..' normalization: sub/../data.txt -> /data.txt
      const viaDotDot = writePath('sub/../data.txt')
      const result = fns.path_filestat_get(3, 0, viaDotDot.ptr, viaDotDot.len, 2100)
      expect(result).toBe(Errno.SUCCESS)
    })

    it('clamps ".." at the preopen root (no escape)', () => {
      const fns = createPathFunctions(memory, fdTable, {
        filesystems: new Map([['/', mockFs]]),
      })

      const created = writePath('data.txt')
      fns.path_open(3, 0, created.ptr, created.len, OFlags.CREAT, 0n, 0n, 0, 2000)

      // ../../data.txt must clamp to /data.txt rather than escaping above root.
      const escape = writePath('../../data.txt')
      expect(
        fns.path_filestat_get(3, 0, escape.ptr, escape.len, 2100)
      ).toBe(Errno.SUCCESS)
    })

    it('allows path_* operations on a directory opened via path_open', () => {
      const fns = createPathFunctions(memory, fdTable, {
        filesystems: new Map([['/', mockFs]]),
      })

      // Create and open /mydir as a directory fd.
      const dir = writePath('/mydir')
      expect(fns.path_create_directory(3, dir.ptr, dir.len)).toBe(Errno.SUCCESS)
      expect(
        fns.path_open(
          3,
          0,
          dir.ptr,
          dir.len,
          OFlags.DIRECTORY,
          DIRECTORY_RIGHTS,
          DIRECTORY_RIGHTS,
          0,
          2000
        )
      ).toBe(Errno.SUCCESS)
      const newFd = memory.readU32(2000)

      // A path_* call against the new dir fd must resolve (was EBADF before the
      // fix because the filesystem ref was not attached).
      const child = writePath('child')
      const result = fns.path_create_directory(newFd, child.ptr, child.len)
      expect(result).toBe(Errno.SUCCESS)
    })
  })
})
