import { describe, it, expect, beforeEach } from 'vitest'
import {
  FileDescriptorTable,
  createStdinEntry,
  createStdoutEntry,
  createStderrEntry,
  createDirectoryEntry,
  createFileEntry,
  type FdEntry,
} from '../../src/wasip1/fd-table.js'
import { FileType, FdFlags, STDIN_RIGHTS, STDOUT_RIGHTS, DIRECTORY_RIGHTS, FILE_RIGHTS, ALL_RIGHTS, Rights } from '../../src/wasip1/types.js'

describe('WASIP1 FileDescriptorTable', () => {
  let fdTable: FileDescriptorTable

  beforeEach(() => {
    fdTable = new FileDescriptorTable()
  })

  describe('createStdinEntry', () => {
    it('creates a stdin entry with correct type', () => {
      const entry = createStdinEntry()
      expect(entry.type).toBe('stdin')
      expect(entry.filetype).toBe(FileType.CHARACTER_DEVICE)
    })

    it('creates a stdin entry with correct rights', () => {
      const entry = createStdinEntry()
      expect(entry.rights.base).toBe(STDIN_RIGHTS)
      expect(entry.rights.inheriting).toBe(0n)
    })

    it('creates a stdin entry with resource', () => {
      const resource = { read: () => new Uint8Array() }
      const entry = createStdinEntry(resource)
      expect(entry.resource).toBe(resource)
    })

    it('creates a stdin entry with position 0', () => {
      const entry = createStdinEntry()
      expect(entry.position).toBe(0n)
    })
  })

  describe('createStdoutEntry', () => {
    it('creates a stdout entry with correct type', () => {
      const entry = createStdoutEntry()
      expect(entry.type).toBe('stdout')
      expect(entry.filetype).toBe(FileType.CHARACTER_DEVICE)
    })

    it('creates a stdout entry with correct rights', () => {
      const entry = createStdoutEntry()
      expect(entry.rights.base).toBe(STDOUT_RIGHTS)
      expect(entry.rights.inheriting).toBe(0n)
    })

    it('creates a stdout entry with resource', () => {
      const resource = { write: () => {} }
      const entry = createStdoutEntry(resource)
      expect(entry.resource).toBe(resource)
    })
  })

  describe('createStderrEntry', () => {
    it('creates a stderr entry with correct type', () => {
      const entry = createStderrEntry()
      expect(entry.type).toBe('stderr')
      expect(entry.filetype).toBe(FileType.CHARACTER_DEVICE)
    })

    it('creates a stderr entry with correct rights', () => {
      const entry = createStderrEntry()
      expect(entry.rights.base).toBe(STDOUT_RIGHTS) // Same as stdout
      expect(entry.rights.inheriting).toBe(0n)
    })
  })

  describe('createDirectoryEntry', () => {
    it('creates a directory entry with correct type', () => {
      const entry = createDirectoryEntry('/home')
      expect(entry.type).toBe('directory')
      expect(entry.filetype).toBe(FileType.DIRECTORY)
    })

    it('creates a directory entry with correct rights', () => {
      const entry = createDirectoryEntry('/home')
      expect(entry.rights.base).toBe(DIRECTORY_RIGHTS)
      expect(entry.rights.inheriting).toBe(ALL_RIGHTS)
    })

    it('creates a directory entry with path', () => {
      const entry = createDirectoryEntry('/home/user')
      expect(entry.path).toBe('/home/user')
    })

    it('creates a directory entry with preopen', () => {
      const entry = createDirectoryEntry('/home', '/')
      expect(entry.preopen).toBe('/')
    })

    it('creates a directory entry without preopen', () => {
      const entry = createDirectoryEntry('/home')
      expect(entry.preopen).toBeUndefined()
    })

    it('creates a directory entry with resource', () => {
      const resource = { readdir: () => [] }
      const entry = createDirectoryEntry('/home', undefined, resource)
      expect(entry.resource).toBe(resource)
    })
  })

  describe('createFileEntry', () => {
    it('creates a file entry with correct type', () => {
      const entry = createFileEntry('/home/file.txt', 0)
      expect(entry.type).toBe('file')
      expect(entry.filetype).toBe(FileType.REGULAR_FILE)
    })

    it('creates a file entry with correct rights', () => {
      const entry = createFileEntry('/home/file.txt', 0)
      expect(entry.rights.base).toBe(FILE_RIGHTS)
      expect(entry.rights.inheriting).toBe(0n)
    })

    it('creates a file entry with custom rights', () => {
      const customRights = { base: Rights.FD_READ, inheriting: 0n }
      const entry = createFileEntry('/home/file.txt', 0, customRights)
      expect(entry.rights.base).toBe(Rights.FD_READ)
    })

    it('creates a file entry with flags', () => {
      const entry = createFileEntry('/home/file.txt', FdFlags.APPEND | FdFlags.NONBLOCK)
      expect(entry.flags).toBe(FdFlags.APPEND | FdFlags.NONBLOCK)
    })

    it('creates a file entry with resource', () => {
      const resource = { read: () => new Uint8Array() }
      const entry = createFileEntry('/home/file.txt', 0, undefined, resource)
      expect(entry.resource).toBe(resource)
    })
  })

  describe('initStdio', () => {
    it('initializes stdio file descriptors', () => {
      const stdin = createStdinEntry()
      const stdout = createStdoutEntry()
      const stderr = createStderrEntry()

      fdTable.initStdio(stdin, stdout, stderr)

      expect(fdTable.get(0)).toBe(stdin)
      expect(fdTable.get(1)).toBe(stdout)
      expect(fdTable.get(2)).toBe(stderr)
    })

    it('sets fds 0, 1, 2', () => {
      fdTable.initStdio(createStdinEntry(), createStdoutEntry(), createStderrEntry())

      expect(fdTable.has(0)).toBe(true)
      expect(fdTable.has(1)).toBe(true)
      expect(fdTable.has(2)).toBe(true)
    })
  })

  describe('allocate', () => {
    it('allocates a new file descriptor starting at 3', () => {
      const entry = createFileEntry('/test.txt', 0)
      const fd = fdTable.allocate(entry)

      expect(fd).toBe(3)
      expect(fdTable.get(fd)).toBe(entry)
    })

    it('returns incrementing fd numbers', () => {
      const fd1 = fdTable.allocate(createFileEntry('/file1.txt', 0))
      const fd2 = fdTable.allocate(createFileEntry('/file2.txt', 0))
      const fd3 = fdTable.allocate(createFileEntry('/file3.txt', 0))

      expect(fd1).toBe(3)
      expect(fd2).toBe(4)
      expect(fd3).toBe(5)
    })

    it('does not reuse closed fds', () => {
      const fd1 = fdTable.allocate(createFileEntry('/file1.txt', 0))
      fdTable.close(fd1)
      const fd2 = fdTable.allocate(createFileEntry('/file2.txt', 0))

      expect(fd2).toBe(4) // Not 3
    })
  })

  describe('allocateAt', () => {
    it('allocates at a specific fd number', () => {
      const entry = createFileEntry('/test.txt', 0)
      fdTable.allocateAt(10, entry)

      expect(fdTable.get(10)).toBe(entry)
    })

    it('updates nextFd if necessary', () => {
      fdTable.allocateAt(100, createFileEntry('/test.txt', 0))
      const nextFd = fdTable.allocate(createFileEntry('/next.txt', 0))

      expect(nextFd).toBe(101)
    })

    it('overwrites existing entry at fd', () => {
      const entry1 = createFileEntry('/file1.txt', 0)
      const entry2 = createFileEntry('/file2.txt', 0)

      fdTable.allocateAt(5, entry1)
      fdTable.allocateAt(5, entry2)

      expect(fdTable.get(5)).toBe(entry2)
    })
  })

  describe('get', () => {
    it('returns entry for valid fd', () => {
      const entry = createFileEntry('/test.txt', 0)
      fdTable.allocateAt(5, entry)

      expect(fdTable.get(5)).toBe(entry)
    })

    it('returns undefined for invalid fd', () => {
      expect(fdTable.get(999)).toBeUndefined()
    })

    it('returns undefined for closed fd', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))
      fdTable.close(fd)

      expect(fdTable.get(fd)).toBeUndefined()
    })
  })

  describe('has', () => {
    it('returns true for existing fd', () => {
      fdTable.allocateAt(5, createFileEntry('/test.txt', 0))
      expect(fdTable.has(5)).toBe(true)
    })

    it('returns false for non-existing fd', () => {
      expect(fdTable.has(999)).toBe(false)
    })

    it('returns false for closed fd', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))
      fdTable.close(fd)
      expect(fdTable.has(fd)).toBe(false)
    })
  })

  describe('set', () => {
    it('updates an existing entry', () => {
      const entry1 = createFileEntry('/file1.txt', 0)
      const entry2 = createFileEntry('/file2.txt', 0)

      fdTable.allocateAt(5, entry1)
      fdTable.set(5, entry2)

      expect(fdTable.get(5)).toBe(entry2)
    })

    it('can create a new entry', () => {
      const entry = createFileEntry('/test.txt', 0)
      fdTable.set(10, entry)

      expect(fdTable.get(10)).toBe(entry)
    })
  })

  describe('close', () => {
    it('removes a file descriptor', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))
      const result = fdTable.close(fd)

      expect(result).toBe(true)
      expect(fdTable.has(fd)).toBe(false)
    })

    it('returns false for non-existing fd', () => {
      expect(fdTable.close(999)).toBe(false)
    })

    it('returns false for already closed fd', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))
      fdTable.close(fd)

      expect(fdTable.close(fd)).toBe(false)
    })
  })

  describe('renumber', () => {
    it('moves fd from source to dest', () => {
      const entry = createFileEntry('/test.txt', 0)
      fdTable.allocateAt(5, entry)

      const result = fdTable.renumber(5, 10)

      expect(result).toBe(true)
      expect(fdTable.has(5)).toBe(false)
      expect(fdTable.get(10)).toBe(entry)
    })

    it('closes existing fd at dest', () => {
      const entry1 = createFileEntry('/file1.txt', 0)
      const entry2 = createFileEntry('/file2.txt', 0)

      fdTable.allocateAt(5, entry1)
      fdTable.allocateAt(10, entry2)

      fdTable.renumber(5, 10)

      expect(fdTable.get(10)).toBe(entry1)
    })

    it('returns false for non-existing source', () => {
      expect(fdTable.renumber(999, 10)).toBe(false)
    })
  })

  describe('getPreopens', () => {
    it('returns all preopened directories', () => {
      fdTable.allocateAt(3, createDirectoryEntry('/home', '/home'))
      fdTable.allocateAt(4, createDirectoryEntry('/tmp', '/tmp'))
      fdTable.allocate(createFileEntry('/test.txt', 0)) // Not a preopen

      const preopens = fdTable.getPreopens()

      expect(preopens).toHaveLength(2)
      expect(preopens).toContainEqual({ fd: 3, path: '/home' })
      expect(preopens).toContainEqual({ fd: 4, path: '/tmp' })
    })

    it('returns empty array when no preopens', () => {
      fdTable.allocate(createFileEntry('/test.txt', 0))
      expect(fdTable.getPreopens()).toEqual([])
    })
  })

  describe('findPreopenForPath', () => {
    beforeEach(() => {
      fdTable.allocateAt(3, createDirectoryEntry('/home', '/home'))
      fdTable.allocateAt(4, createDirectoryEntry('/tmp', '/tmp'))
    })

    it('finds preopen for exact path match', () => {
      const result = fdTable.findPreopenForPath('/home')
      expect(result).toBeDefined()
      expect(result?.fd).toBe(3)
    })

    it('finds preopen for path under preopen', () => {
      const result = fdTable.findPreopenForPath('/home/user/file.txt')
      expect(result).toBeDefined()
      expect(result?.fd).toBe(3)
    })

    it('finds correct preopen for different paths', () => {
      const homeResult = fdTable.findPreopenForPath('/home/test')
      const tmpResult = fdTable.findPreopenForPath('/tmp/test')

      expect(homeResult?.fd).toBe(3)
      expect(tmpResult?.fd).toBe(4)
    })

    it('returns undefined for path not under any preopen', () => {
      const result = fdTable.findPreopenForPath('/var/log')
      expect(result).toBeUndefined()
    })

    it('handles root preopen', () => {
      fdTable.allocateAt(5, createDirectoryEntry('/', '/'))
      const result = fdTable.findPreopenForPath('/any/path')
      expect(result).toBeDefined()
    })

    it('handles dot preopen', () => {
      fdTable.allocateAt(6, createDirectoryEntry('.', '.'))
      const result = fdTable.findPreopenForPath('relative/path')
      expect(result).toBeDefined()
      expect(result?.fd).toBe(6)
    })
  })

  describe('hasRights', () => {
    it('returns true when fd has required rights', () => {
      fdTable.allocateAt(3, createFileEntry('/test.txt', 0))
      expect(fdTable.hasRights(3, Rights.FD_READ)).toBe(true)
      expect(fdTable.hasRights(3, Rights.FD_WRITE)).toBe(true)
    })

    it('returns true when fd has all required rights', () => {
      fdTable.allocateAt(3, createFileEntry('/test.txt', 0))
      expect(fdTable.hasRights(3, Rights.FD_READ | Rights.FD_WRITE)).toBe(true)
    })

    it('returns false when fd lacks some rights', () => {
      const customRights = { base: Rights.FD_READ, inheriting: 0n }
      fdTable.allocateAt(3, createFileEntry('/test.txt', 0, customRights))
      expect(fdTable.hasRights(3, Rights.FD_READ | Rights.FD_WRITE)).toBe(false)
    })

    it('returns false for non-existing fd', () => {
      expect(fdTable.hasRights(999, Rights.FD_READ)).toBe(false)
    })
  })

  describe('entries', () => {
    it('returns all entries', () => {
      fdTable.initStdio(createStdinEntry(), createStdoutEntry(), createStderrEntry())
      fdTable.allocate(createFileEntry('/test.txt', 0))

      const entries = Array.from(fdTable.entries())

      expect(entries.length).toBe(4)
      expect(entries.map(([fd]) => fd).sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
    })

    it('returns empty iterator when no fds', () => {
      const entries = Array.from(fdTable.entries())
      expect(entries).toEqual([])
    })
  })

  describe('size', () => {
    it('returns count of open fds', () => {
      expect(fdTable.size).toBe(0)

      fdTable.initStdio(createStdinEntry(), createStdoutEntry(), createStderrEntry())
      expect(fdTable.size).toBe(3)

      fdTable.allocate(createFileEntry('/test.txt', 0))
      expect(fdTable.size).toBe(4)
    })

    it('decreases after close', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))
      expect(fdTable.size).toBe(1)

      fdTable.close(fd)
      expect(fdTable.size).toBe(0)
    })
  })

  describe('FdEntry mutations', () => {
    it('allows modifying entry properties', () => {
      const entry = createFileEntry('/test.txt', 0)
      fdTable.allocateAt(5, entry)

      const retrieved = fdTable.get(5)!
      retrieved.position = 100n
      retrieved.flags = FdFlags.APPEND

      expect(fdTable.get(5)?.position).toBe(100n)
      expect(fdTable.get(5)?.flags).toBe(FdFlags.APPEND)
    })

    it('allows modifying rights', () => {
      const entry = createFileEntry('/test.txt', 0)
      fdTable.allocateAt(5, entry)

      const retrieved = fdTable.get(5)!
      retrieved.rights.base = Rights.FD_READ

      expect(fdTable.get(5)?.rights.base).toBe(Rights.FD_READ)
    })
  })

  describe('integration scenarios', () => {
    it('simulates typical WASI startup', () => {
      // Initialize stdio
      fdTable.initStdio(createStdinEntry(), createStdoutEntry(), createStderrEntry())

      // Add preopened directories
      fdTable.allocateAt(3, createDirectoryEntry('/home', '/home'))
      fdTable.allocateAt(4, createDirectoryEntry('/tmp', '/tmp'))

      // Verify setup
      expect(fdTable.size).toBe(5)
      expect(fdTable.getPreopens().length).toBe(2)
      expect(fdTable.get(0)?.type).toBe('stdin')
      expect(fdTable.get(3)?.preopen).toBe('/home')
    })

    it('simulates opening and closing files', () => {
      // Open several files
      const fd1 = fdTable.allocate(createFileEntry('/file1.txt', 0))
      const fd2 = fdTable.allocate(createFileEntry('/file2.txt', 0))
      const fd3 = fdTable.allocate(createFileEntry('/file3.txt', 0))

      expect(fdTable.size).toBe(3)

      // Close middle file
      fdTable.close(fd2)
      expect(fdTable.size).toBe(2)
      expect(fdTable.has(fd1)).toBe(true)
      expect(fdTable.has(fd2)).toBe(false)
      expect(fdTable.has(fd3)).toBe(true)
    })

    it('simulates file seeking', () => {
      const fd = fdTable.allocate(createFileEntry('/test.txt', 0))
      const entry = fdTable.get(fd)!

      // Initial position
      expect(entry.position).toBe(0n)

      // Seek forward
      entry.position = 100n
      expect(fdTable.get(fd)?.position).toBe(100n)

      // Seek to end (simulated)
      entry.position = 1000n
      expect(fdTable.get(fd)?.position).toBe(1000n)
    })

    it('simulates dup2-like operation with renumber', () => {
      fdTable.initStdio(createStdinEntry(), createStdoutEntry(), createStderrEntry())

      // Open a file
      const fileFd = fdTable.allocate(createFileEntry('/log.txt', 0))

      // Redirect stdout to file (like dup2(fileFd, 1))
      fdTable.renumber(fileFd, 1)

      expect(fdTable.get(1)?.type).toBe('file')
      expect(fdTable.get(1)?.path).toBe('/log.txt')
      expect(fdTable.has(fileFd)).toBe(false)
    })
  })
})
