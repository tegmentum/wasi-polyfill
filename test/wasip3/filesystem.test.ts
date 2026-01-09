/**
 * WASI Filesystem 0.3.0 Interface Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryFilesystem,
  getFilesystemImports,
  DescriptorFlags,
  DescriptorType,
  type DescriptorStat,
  type DirectoryEntry,
} from '../../src/wasip3/interfaces/filesystem.js'

describe('WASIP3 Filesystem Interface', () => {
  describe('DescriptorFlags', () => {
    it('defines flag values', () => {
      expect(DescriptorFlags.READ).toBe(1)
      expect(DescriptorFlags.WRITE).toBe(2)
      expect(DescriptorFlags.FILE_INTEGRITY_SYNC).toBe(4)
      expect(DescriptorFlags.DATA_INTEGRITY_SYNC).toBe(8)
      expect(DescriptorFlags.REQUESTED_WRITE_SYNC).toBe(16)
      expect(DescriptorFlags.MUTATE_DIRECTORY).toBe(32)
    })

    it('allows combining flags', () => {
      const readWrite = DescriptorFlags.READ | DescriptorFlags.WRITE
      expect(readWrite).toBe(3)
    })
  })

  describe('DescriptorType', () => {
    it('defines type values', () => {
      expect(DescriptorType.UNKNOWN).toBe(0)
      expect(DescriptorType.BLOCK_DEVICE).toBe(1)
      expect(DescriptorType.CHARACTER_DEVICE).toBe(2)
      expect(DescriptorType.DIRECTORY).toBe(3)
      expect(DescriptorType.FIFO).toBe(4)
      expect(DescriptorType.SYMBOLIC_LINK).toBe(5)
      expect(DescriptorType.REGULAR_FILE).toBe(6)
      expect(DescriptorType.SOCKET).toBe(7)
    })
  })

  describe('InMemoryFilesystem', () => {
    let fs: InMemoryFilesystem

    beforeEach(() => {
      fs = new InMemoryFilesystem()
    })

    describe('createFile', () => {
      it('creates file in root directory', async () => {
        await fs.createFile('/test.txt', new TextEncoder().encode('hello'))
        const handle = await fs.open('/test.txt', DescriptorFlags.READ)
        const [data] = await fs.read(handle, 100n, 0n)
        expect(new TextDecoder().decode(data)).toBe('hello')
      })

      it('creates empty file by default', async () => {
        await fs.createFile('/empty.txt')
        const handle = await fs.open('/empty.txt', DescriptorFlags.READ)
        const [data] = await fs.read(handle, 100n, 0n)
        expect(data.length).toBe(0)
      })

      it('throws for nonexistent parent', async () => {
        await expect(fs.createFile('/nonexistent/file.txt')).rejects.toThrow('Parent directory does not exist')
      })
    })

    describe('createDirectory', () => {
      it('creates directory in root', async () => {
        await fs.createDirectory('/subdir')
        const handle = await fs.open('/subdir', DescriptorFlags.READ)
        const stat = await fs.stat(handle)
        expect(stat.type).toBe(DescriptorType.DIRECTORY)
      })

      it('creates nested directory', async () => {
        await fs.createDirectory('/parent')
        await fs.createDirectory('/parent/child')
        const handle = await fs.open('/parent/child', DescriptorFlags.READ)
        const stat = await fs.stat(handle)
        expect(stat.type).toBe(DescriptorType.DIRECTORY)
      })

      it('throws for nonexistent parent', async () => {
        await expect(fs.createDirectory('/a/b')).rejects.toThrow('Parent directory does not exist')
      })

      it('throws if path already exists', async () => {
        await fs.createDirectory('/exists')
        await expect(fs.createDirectory('/exists')).rejects.toThrow('Path already exists')
      })
    })

    describe('open', () => {
      it('opens existing file', async () => {
        await fs.createFile('/file.txt')
        const handle = await fs.open('/file.txt', DescriptorFlags.READ)
        expect(typeof handle).toBe('number')
        expect(handle).toBeGreaterThan(0)
      })

      it('opens existing directory', async () => {
        await fs.createDirectory('/dir')
        const handle = await fs.open('/dir', DescriptorFlags.READ)
        expect(typeof handle).toBe('number')
      })

      it('throws for nonexistent path', async () => {
        await expect(fs.open('/nonexistent', DescriptorFlags.READ)).rejects.toThrow('File not found')
      })

      it('allocates unique handles', async () => {
        await fs.createFile('/a.txt')
        await fs.createFile('/b.txt')

        const h1 = await fs.open('/a.txt', DescriptorFlags.READ)
        const h2 = await fs.open('/b.txt', DescriptorFlags.READ)
        const h3 = await fs.open('/a.txt', DescriptorFlags.READ)

        expect(h1).not.toBe(h2)
        expect(h2).not.toBe(h3)
        expect(h1).not.toBe(h3)
      })
    })

    describe('read', () => {
      it('reads file contents', async () => {
        await fs.createFile('/file.txt', new TextEncoder().encode('test data'))
        const handle = await fs.open('/file.txt', DescriptorFlags.READ)

        const [data, eof] = await fs.read(handle, 100n, 0n)
        expect(new TextDecoder().decode(data)).toBe('test data')
        expect(eof).toBe(true)
      })

      it('reads with offset', async () => {
        await fs.createFile('/file.txt', new TextEncoder().encode('hello world'))
        const handle = await fs.open('/file.txt', DescriptorFlags.READ)

        const [data] = await fs.read(handle, 100n, 6n)
        expect(new TextDecoder().decode(data)).toBe('world')
      })

      it('reads partial length', async () => {
        await fs.createFile('/file.txt', new TextEncoder().encode('hello world'))
        const handle = await fs.open('/file.txt', DescriptorFlags.READ)

        const [data, eof] = await fs.read(handle, 5n, 0n)
        expect(new TextDecoder().decode(data)).toBe('hello')
        expect(eof).toBe(false)
      })

      it('returns eof at end of file', async () => {
        await fs.createFile('/file.txt', new TextEncoder().encode('short'))
        const handle = await fs.open('/file.txt', DescriptorFlags.READ)

        const [data1, eof1] = await fs.read(handle, 100n, 0n)
        expect(eof1).toBe(true)
        expect(new TextDecoder().decode(data1)).toBe('short')
      })

      it('throws for invalid handle', async () => {
        await expect(fs.read(9999, 100n, 0n)).rejects.toThrow('Invalid descriptor')
      })

      it('throws for directory', async () => {
        await fs.createDirectory('/dir')
        const handle = await fs.open('/dir', DescriptorFlags.READ)
        await expect(fs.read(handle, 100n, 0n)).rejects.toThrow('Not a file')
      })
    })

    describe('write', () => {
      it('writes to file', async () => {
        await fs.createFile('/file.txt')
        const handle = await fs.open('/file.txt', DescriptorFlags.WRITE)

        const written = await fs.write(handle, new TextEncoder().encode('hello'), 0n)
        expect(written).toBe(5n)

        const [data] = await fs.read(handle, 100n, 0n)
        expect(new TextDecoder().decode(data)).toBe('hello')
      })

      it('writes with offset', async () => {
        await fs.createFile('/file.txt', new TextEncoder().encode('xxxxx'))
        const handle = await fs.open('/file.txt', DescriptorFlags.WRITE)

        await fs.write(handle, new TextEncoder().encode('YY'), 2n)

        const [data] = await fs.read(handle, 100n, 0n)
        expect(new TextDecoder().decode(data)).toBe('xxYYx')
      })

      it('expands file when writing past end', async () => {
        await fs.createFile('/file.txt', new TextEncoder().encode('short'))
        const handle = await fs.open('/file.txt', DescriptorFlags.WRITE)

        await fs.write(handle, new TextEncoder().encode('extended'), 10n)

        const [data] = await fs.read(handle, 100n, 0n)
        expect(data.length).toBe(18) // 10 + 8
      })

      it('throws for invalid handle', async () => {
        await expect(fs.write(9999, new Uint8Array([1, 2, 3]), 0n)).rejects.toThrow('Invalid descriptor')
      })

      it('throws for directory', async () => {
        await fs.createDirectory('/dir')
        const handle = await fs.open('/dir', DescriptorFlags.WRITE)
        await expect(fs.write(handle, new Uint8Array([1, 2, 3]), 0n)).rejects.toThrow('Not a file')
      })
    })

    describe('stat', () => {
      it('returns file stat', async () => {
        await fs.createFile('/file.txt', new TextEncoder().encode('content'))
        const handle = await fs.open('/file.txt', DescriptorFlags.READ)

        const stat = await fs.stat(handle)

        expect(stat.type).toBe(DescriptorType.REGULAR_FILE)
        expect(stat.linkCount).toBe(1n)
        expect(stat.size).toBe(7n)
        expect(stat.dataAccessTimestamp).toBeDefined()
        expect(stat.dataModificationTimestamp).toBeDefined()
        expect(stat.statusChangeTimestamp).toBeDefined()
      })

      it('returns directory stat', async () => {
        await fs.createDirectory('/dir')
        const handle = await fs.open('/dir', DescriptorFlags.READ)

        const stat = await fs.stat(handle)

        expect(stat.type).toBe(DescriptorType.DIRECTORY)
        expect(stat.size).toBe(0n)
      })

      it('returns link count based on directory entries', async () => {
        await fs.createDirectory('/dir')
        await fs.createFile('/dir/a.txt')
        await fs.createFile('/dir/b.txt')
        await fs.createDirectory('/dir/subdir')

        const handle = await fs.open('/dir', DescriptorFlags.READ)
        const stat = await fs.stat(handle)

        expect(stat.linkCount).toBe(5n) // 3 entries + . + ..
      })

      it('throws for invalid handle', async () => {
        await expect(fs.stat(9999)).rejects.toThrow('Invalid descriptor')
      })
    })

    describe('readDirectory', () => {
      it('returns stream of directory entries', async () => {
        await fs.createDirectory('/dir')
        await fs.createFile('/dir/a.txt')
        await fs.createFile('/dir/b.txt')

        const handle = await fs.open('/dir', DescriptorFlags.READ)
        const stream = fs.readDirectory(handle)

        const result = await stream.read()
        expect(result.status).toBe('values')
        if (result.status === 'values') {
          expect(result.values.length).toBe(2)
          const names = result.values.map((e) => e.name).sort()
          expect(names).toEqual(['a.txt', 'b.txt'])
        }
      })

      it('returns correct entry types', async () => {
        await fs.createDirectory('/dir')
        await fs.createFile('/dir/file.txt')
        await fs.createDirectory('/dir/subdir')

        const handle = await fs.open('/dir', DescriptorFlags.READ)
        const stream = fs.readDirectory(handle)

        const result = await stream.read()
        if (result.status === 'values') {
          const file = result.values.find((e) => e.name === 'file.txt')
          const dir = result.values.find((e) => e.name === 'subdir')

          expect(file?.type).toBe(DescriptorType.REGULAR_FILE)
          expect(dir?.type).toBe(DescriptorType.DIRECTORY)
        }
      })

      it('returns end for empty directory', async () => {
        await fs.createDirectory('/empty')
        const handle = await fs.open('/empty', DescriptorFlags.READ)
        const stream = fs.readDirectory(handle)

        const result = await stream.read()
        expect(result.status).toBe('end')
      })

      it('throws for invalid handle', () => {
        expect(() => fs.readDirectory(9999)).toThrow('Invalid descriptor')
      })

      it('throws for file', async () => {
        await fs.createFile('/file.txt')
        const handle = await fs.open('/file.txt', DescriptorFlags.READ)
        expect(() => fs.readDirectory(handle)).toThrow('Not a directory')
      })
    })

    describe('close', () => {
      it('closes descriptor', async () => {
        await fs.createFile('/file.txt')
        const handle = await fs.open('/file.txt', DescriptorFlags.READ)

        fs.close(handle)

        await expect(fs.read(handle, 100n, 0n)).rejects.toThrow('Invalid descriptor')
      })

      it('does not throw for invalid handle', () => {
        expect(() => fs.close(9999)).not.toThrow()
      })
    })

    describe('removeFile', () => {
      it('removes file', async () => {
        await fs.createFile('/file.txt')
        await fs.removeFile('/file.txt')

        await expect(fs.open('/file.txt', DescriptorFlags.READ)).rejects.toThrow('File not found')
      })

      it('throws for nonexistent file', async () => {
        await expect(fs.removeFile('/nonexistent')).rejects.toThrow('File not found')
      })

      it('throws for directory', async () => {
        await fs.createDirectory('/dir')
        await expect(fs.removeFile('/dir')).rejects.toThrow('Not a file')
      })
    })

    describe('removeDirectory', () => {
      it('removes empty directory', async () => {
        await fs.createDirectory('/dir')
        await fs.removeDirectory('/dir')

        await expect(fs.open('/dir', DescriptorFlags.READ)).rejects.toThrow('File not found')
      })

      it('throws for nonexistent directory', async () => {
        await expect(fs.removeDirectory('/nonexistent')).rejects.toThrow('Directory not found')
      })

      it('throws for file', async () => {
        await fs.createFile('/file.txt')
        await expect(fs.removeDirectory('/file.txt')).rejects.toThrow('Not a directory')
      })

      it('throws for non-empty directory', async () => {
        await fs.createDirectory('/dir')
        await fs.createFile('/dir/file.txt')

        await expect(fs.removeDirectory('/dir')).rejects.toThrow('Directory not empty')
      })
    })

    describe('path normalization', () => {
      it('handles trailing slashes', async () => {
        await fs.createDirectory('/dir/')
        const handle = await fs.open('/dir/', DescriptorFlags.READ)
        expect(handle).toBeGreaterThan(0)
      })

      it('handles multiple slashes', async () => {
        await fs.createDirectory('/dir')
        await fs.createFile('/dir//file.txt')
        const handle = await fs.open('//dir///file.txt', DescriptorFlags.READ)
        expect(handle).toBeGreaterThan(0)
      })
    })
  })

  describe('getFilesystemImports', () => {
    it('returns import object with types interface', () => {
      const imports = getFilesystemImports()
      expect(imports).toHaveProperty('wasi:filesystem/types@0.3.0')
    })

    it('returns import object with preopens interface', () => {
      const imports = getFilesystemImports()
      expect(imports).toHaveProperty('wasi:filesystem/preopens@0.3.0')
    })

    describe('types imports', () => {
      it('provides read-via-stream', async () => {
        const fs = new InMemoryFilesystem()
        await fs.createFile('/test.txt', new TextEncoder().encode('content'))
        const handle = await fs.open('/test.txt', DescriptorFlags.READ)

        const imports = getFilesystemImports(fs)
        const types = imports['wasi:filesystem/types@0.3.0'] as Record<string, Function>

        const stream = types['[method]descriptor.read-via-stream'](handle, 0n)
        const result = await stream.read()

        expect(result.status).toBe('values')
        if (result.status === 'values') {
          expect(new TextDecoder().decode(result.values[0])).toBe('content')
        }
      })

      it('provides write-via-stream', async () => {
        const fs = new InMemoryFilesystem()
        await fs.createFile('/test.txt')
        const handle = await fs.open('/test.txt', DescriptorFlags.WRITE)

        const imports = getFilesystemImports(fs)
        const types = imports['wasi:filesystem/types@0.3.0'] as Record<string, Function>

        const writer = types['[method]descriptor.write-via-stream'](handle, 0n)
        await writer.write([new TextEncoder().encode('written')])

        const [data] = await fs.read(handle, 100n, 0n)
        expect(new TextDecoder().decode(data)).toBe('written')
      })

      it('provides async read method', async () => {
        const fs = new InMemoryFilesystem()
        await fs.createFile('/test.txt', new TextEncoder().encode('async content'))
        const handle = await fs.open('/test.txt', DescriptorFlags.READ)

        const imports = getFilesystemImports(fs)
        const types = imports['wasi:filesystem/types@0.3.0'] as Record<string, Function>

        const [data, eof] = await types['[method]descriptor.read'](handle, 100n, 0n)
        expect(new TextDecoder().decode(data)).toBe('async content')
        expect(eof).toBe(true)
      })

      it('provides async write method', async () => {
        const fs = new InMemoryFilesystem()
        await fs.createFile('/test.txt')
        const handle = await fs.open('/test.txt', DescriptorFlags.WRITE)

        const imports = getFilesystemImports(fs)
        const types = imports['wasi:filesystem/types@0.3.0'] as Record<string, Function>

        const written = await types['[method]descriptor.write'](handle, new TextEncoder().encode('async'), 0n)
        expect(written).toBe(5n)
      })

      it('provides stat method', async () => {
        const fs = new InMemoryFilesystem()
        await fs.createFile('/test.txt', new TextEncoder().encode('12345'))
        const handle = await fs.open('/test.txt', DescriptorFlags.READ)

        const imports = getFilesystemImports(fs)
        const types = imports['wasi:filesystem/types@0.3.0'] as Record<string, Function>

        const stat = await types['[method]descriptor.stat'](handle)
        expect(stat.type).toBe(DescriptorType.REGULAR_FILE)
        expect(stat.size).toBe(5n)
      })

      it('provides read-directory method', async () => {
        const fs = new InMemoryFilesystem()
        await fs.createDirectory('/dir')
        await fs.createFile('/dir/a.txt')
        const handle = await fs.open('/dir', DescriptorFlags.READ)

        const imports = getFilesystemImports(fs)
        const types = imports['wasi:filesystem/types@0.3.0'] as Record<string, Function>

        const stream = types['[method]descriptor.read-directory'](handle)
        const result = await stream.read()

        expect(result.status).toBe('values')
        if (result.status === 'values') {
          expect(result.values[0]!.name).toBe('a.txt')
        }
      })

      it('provides resource-drop method', async () => {
        const fs = new InMemoryFilesystem()
        await fs.createFile('/test.txt')
        const handle = await fs.open('/test.txt', DescriptorFlags.READ)

        const imports = getFilesystemImports(fs)
        const types = imports['wasi:filesystem/types@0.3.0'] as Record<string, Function>

        types['[resource-drop]descriptor'](handle)

        // Should now be invalid
        await expect(fs.read(handle, 100n, 0n)).rejects.toThrow()
      })
    })

    describe('preopens imports', () => {
      it('returns empty array by default', () => {
        const imports = getFilesystemImports()
        const preopens = imports['wasi:filesystem/preopens@0.3.0'] as Record<string, Function>

        expect(preopens['get-directories']()).toEqual([])
      })
    })
  })
})
