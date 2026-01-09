import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryFilesystem, FilesystemError } from '../../src/wasip1/memory-filesystem.js'
import { FileType } from '../../src/wasip1/types.js'

describe('WASIP1 MemoryFilesystem', () => {
  let fs: MemoryFilesystem

  beforeEach(() => {
    fs = new MemoryFilesystem()
  })

  describe('constructor', () => {
    it('creates a filesystem with root directory', () => {
      expect(fs.exists('/')).toBe(true)
    })

    it('accepts custom device id', () => {
      const customFs = new MemoryFilesystem({ dev: 42n })
      const stat = customFs.stat('/')
      expect(stat.dev).toBe(42n)
    })
  })

  describe('createDirectory', () => {
    it('creates a directory', () => {
      fs.createDirectory('/test')
      expect(fs.exists('/test')).toBe(true)
      const stat = fs.stat('/test')
      expect(stat.filetype).toBe(FileType.DIRECTORY)
    })

    it('creates nested directories', () => {
      fs.createDirectory('/a')
      fs.createDirectory('/a/b')
      fs.createDirectory('/a/b/c')
      expect(fs.exists('/a/b/c')).toBe(true)
    })

    it('throws EEXIST if directory already exists', () => {
      fs.createDirectory('/test')
      expect(() => fs.createDirectory('/test')).toThrow('EEXIST')
    })

    it('throws ENOENT if parent does not exist', () => {
      expect(() => fs.createDirectory('/nonexistent/test')).toThrow('ENOENT')
    })
  })

  describe('removeDirectory', () => {
    it('removes an empty directory', () => {
      fs.createDirectory('/test')
      fs.removeDirectory('/test')
      expect(fs.exists('/test')).toBe(false)
    })

    it('throws ENOTEMPTY if directory is not empty', () => {
      fs.createDirectory('/test')
      fs.createDirectory('/test/child')
      expect(() => fs.removeDirectory('/test')).toThrow('ENOTEMPTY')
    })

    it('throws ENOTDIR if path is a file', () => {
      fs.writeFileSync('/file.txt', 'content')
      expect(() => fs.removeDirectory('/file.txt')).toThrow('ENOTDIR')
    })

    it('throws ENOENT if path does not exist', () => {
      expect(() => fs.removeDirectory('/nonexistent')).toThrow('ENOENT')
    })
  })

  describe('open', () => {
    describe('opening files', () => {
      it('opens an existing file', () => {
        fs.writeFileSync('/test.txt', 'hello')
        const resource = fs.open('/test.txt', {})
        expect(resource).toBeDefined()
        expect('read' in resource).toBe(true)
      })

      it('creates a file if create option is set', () => {
        const resource = fs.open('/new.txt', { create: true })
        expect(resource).toBeDefined()
        expect(fs.exists('/new.txt')).toBe(true)
      })

      it('throws ENOENT if file does not exist and create is false', () => {
        expect(() => fs.open('/nonexistent.txt', {})).toThrow('ENOENT')
      })

      it('throws EEXIST if file exists and exclusive is set', () => {
        fs.writeFileSync('/test.txt', 'hello')
        expect(() => fs.open('/test.txt', { create: true, exclusive: true })).toThrow('EEXIST')
      })

      it('truncates file if truncate option is set', () => {
        fs.writeFileSync('/test.txt', 'hello world')
        fs.open('/test.txt', { truncate: true })
        expect(fs.readFileSync('/test.txt')).toBe('')
      })
    })

    describe('opening directories', () => {
      it('opens an existing directory', () => {
        fs.createDirectory('/testdir')
        const resource = fs.open('/testdir', { directory: true })
        expect(resource).toBeDefined()
        expect('readdir' in resource).toBe(true)
      })

      it('creates a directory if create option is set', () => {
        const resource = fs.open('/newdir', { create: true, directory: true })
        expect(resource).toBeDefined()
        expect(fs.exists('/newdir')).toBe(true)
        expect(fs.stat('/newdir').filetype).toBe(FileType.DIRECTORY)
      })

      it('throws ENOTDIR if path is a file and directory flag is set', () => {
        fs.writeFileSync('/test.txt', 'hello')
        expect(() => fs.open('/test.txt', { directory: true })).toThrow('ENOTDIR')
      })
    })
  })

  describe('unlink', () => {
    it('removes a file', () => {
      fs.writeFileSync('/test.txt', 'hello')
      fs.unlink('/test.txt')
      expect(fs.exists('/test.txt')).toBe(false)
    })

    it('throws EISDIR if path is a directory', () => {
      fs.createDirectory('/testdir')
      expect(() => fs.unlink('/testdir')).toThrow('EISDIR')
    })

    it('throws ENOENT if path does not exist', () => {
      expect(() => fs.unlink('/nonexistent.txt')).toThrow('ENOENT')
    })
  })

  describe('rename', () => {
    it('renames a file', () => {
      fs.writeFileSync('/old.txt', 'content')
      fs.rename('/old.txt', '/new.txt')
      expect(fs.exists('/old.txt')).toBe(false)
      expect(fs.exists('/new.txt')).toBe(true)
      expect(fs.readFileSync('/new.txt')).toBe('content')
    })

    it('renames a directory', () => {
      fs.createDirectory('/olddir')
      fs.writeFileSync('/olddir/file.txt', 'content')
      fs.rename('/olddir', '/newdir')
      expect(fs.exists('/olddir')).toBe(false)
      expect(fs.exists('/newdir')).toBe(true)
      expect(fs.readFileSync('/newdir/file.txt')).toBe('content')
    })

    it('overwrites existing file', () => {
      fs.writeFileSync('/old.txt', 'old content')
      fs.writeFileSync('/new.txt', 'new content')
      fs.rename('/old.txt', '/new.txt')
      expect(fs.exists('/old.txt')).toBe(false)
      expect(fs.readFileSync('/new.txt')).toBe('old content')
    })

    it('throws EISDIR if renaming file to directory', () => {
      fs.writeFileSync('/file.txt', 'content')
      fs.createDirectory('/dir')
      expect(() => fs.rename('/file.txt', '/dir')).toThrow('EISDIR')
    })

    it('throws ENOTEMPTY if target directory is not empty', () => {
      fs.createDirectory('/olddir')
      fs.createDirectory('/newdir')
      fs.writeFileSync('/newdir/file.txt', 'content')
      expect(() => fs.rename('/olddir', '/newdir')).toThrow('ENOTEMPTY')
    })
  })

  describe('stat', () => {
    it('returns stats for a file', () => {
      fs.writeFileSync('/test.txt', 'hello')
      const stat = fs.stat('/test.txt')

      expect(stat.filetype).toBe(FileType.REGULAR_FILE)
      expect(stat.size).toBe(5n)
      expect(stat.nlink).toBe(1n)
      expect(stat.ino).toBeGreaterThan(0n)
      expect(stat.atim).toBeGreaterThan(0n)
      expect(stat.mtim).toBeGreaterThan(0n)
      expect(stat.ctim).toBeGreaterThan(0n)
    })

    it('returns stats for a directory', () => {
      fs.createDirectory('/testdir')
      fs.writeFileSync('/testdir/file.txt', 'content')
      const stat = fs.stat('/testdir')

      expect(stat.filetype).toBe(FileType.DIRECTORY)
      expect(stat.size).toBe(1n) // One entry
    })

    it('returns stats for root directory', () => {
      const stat = fs.stat('/')
      expect(stat.filetype).toBe(FileType.DIRECTORY)
      expect(stat.ino).toBe(1n)
    })

    it('throws ENOENT for non-existent path', () => {
      expect(() => fs.stat('/nonexistent')).toThrow('ENOENT')
    })
  })

  describe('setTimes', () => {
    it('sets access time', () => {
      fs.writeFileSync('/test.txt', 'hello')
      const newAtim = 1000000000n
      fs.setTimes('/test.txt', newAtim, null)

      const stat = fs.stat('/test.txt')
      expect(stat.atim).toBe(newAtim)
    })

    it('sets modification time', () => {
      fs.writeFileSync('/test.txt', 'hello')
      const newMtim = 2000000000n
      fs.setTimes('/test.txt', null, newMtim)

      const stat = fs.stat('/test.txt')
      expect(stat.mtim).toBe(newMtim)
    })

    it('sets both times', () => {
      fs.writeFileSync('/test.txt', 'hello')
      fs.setTimes('/test.txt', 1000000000n, 2000000000n)

      const stat = fs.stat('/test.txt')
      expect(stat.atim).toBe(1000000000n)
      expect(stat.mtim).toBe(2000000000n)
    })

    it('updates ctim when times are set', () => {
      fs.writeFileSync('/test.txt', 'hello')
      const statBefore = fs.stat('/test.txt')
      const ctimBefore = statBefore.ctim

      // Small delay to ensure time difference
      fs.setTimes('/test.txt', 1000000000n, null)

      const statAfter = fs.stat('/test.txt')
      expect(statAfter.ctim).toBeGreaterThanOrEqual(ctimBefore)
    })
  })

  describe('symlink and readlink', () => {
    it('creates a symbolic link', () => {
      fs.writeFileSync('/target.txt', 'content')
      fs.symlink('/target.txt', '/link.txt')

      expect(fs.exists('/link.txt')).toBe(true)
      const stat = fs.stat('/link.txt')
      expect(stat.filetype).toBe(FileType.REGULAR_FILE) // Follows symlink
    })

    it('reads a symbolic link', () => {
      fs.writeFileSync('/target.txt', 'content')
      fs.symlink('/target.txt', '/link.txt')

      const target = fs.readlink('/link.txt')
      expect(target).toBe('/target.txt')
    })

    it('creates relative symbolic link', () => {
      fs.createDirectory('/dir')
      fs.writeFileSync('/dir/target.txt', 'content')
      fs.symlink('target.txt', '/dir/link.txt')

      const target = fs.readlink('/dir/link.txt')
      expect(target).toBe('target.txt')
    })

    it('throws EINVAL when reading non-symlink', () => {
      fs.writeFileSync('/file.txt', 'content')
      expect(() => fs.readlink('/file.txt')).toThrow('EINVAL')
    })

    it('throws EEXIST when symlink target already exists', () => {
      fs.writeFileSync('/existing.txt', 'content')
      expect(() => fs.symlink('/target.txt', '/existing.txt')).toThrow('EEXIST')
    })
  })

  describe('link', () => {
    it('creates a hard link', () => {
      fs.writeFileSync('/original.txt', 'content')
      fs.link('/original.txt', '/hardlink.txt')

      expect(fs.exists('/hardlink.txt')).toBe(true)
      expect(fs.readFileSync('/hardlink.txt')).toBe('content')

      // Both should have same inode
      const stat1 = fs.stat('/original.txt')
      const stat2 = fs.stat('/hardlink.txt')
      expect(stat1.ino).toBe(stat2.ino)
      expect(stat1.nlink).toBe(2n)
      expect(stat2.nlink).toBe(2n)
    })

    it('hard linked files share data', () => {
      fs.writeFileSync('/original.txt', 'original')
      fs.link('/original.txt', '/hardlink.txt')

      fs.writeFileSync('/original.txt', 'modified')
      expect(fs.readFileSync('/hardlink.txt')).toBe('modified')
    })

    it('throws EPERM for hard links to directories', () => {
      fs.createDirectory('/dir')
      expect(() => fs.link('/dir', '/link')).toThrow('EPERM')
    })

    it('throws EEXIST if target exists', () => {
      fs.writeFileSync('/original.txt', 'content')
      fs.writeFileSync('/existing.txt', 'content')
      expect(() => fs.link('/original.txt', '/existing.txt')).toThrow('EEXIST')
    })
  })

  describe('FileResource', () => {
    it('reads data at offset', () => {
      fs.writeFileSync('/test.txt', 'hello world')
      const resource = fs.open('/test.txt', {})

      if (!('read' in resource)) throw new Error('Not a file resource')

      const data = resource.read(6n, 5)
      expect(new TextDecoder().decode(data)).toBe('world')
    })

    it('writes data at offset', () => {
      fs.writeFileSync('/test.txt', 'hello world')
      const resource = fs.open('/test.txt', {})

      if (!('write' in resource)) throw new Error('Not a file resource')

      const written = resource.write(6n, new TextEncoder().encode('WORLD'))
      expect(written).toBe(5)
      expect(fs.readFileSync('/test.txt')).toBe('hello WORLD')
    })

    it('extends file when writing past end', () => {
      fs.writeFileSync('/test.txt', 'hi')
      const resource = fs.open('/test.txt', {})

      if (!('write' in resource)) throw new Error('Not a file resource')

      resource.write(5n, new TextEncoder().encode('!'))
      expect(resource.size()).toBe(6n)
    })

    it('returns correct size', () => {
      fs.writeFileSync('/test.txt', 'hello')
      const resource = fs.open('/test.txt', {})

      if (!('size' in resource)) throw new Error('Not a file resource')

      expect(resource.size()).toBe(5n)
    })

    it('truncates file with setSize', () => {
      fs.writeFileSync('/test.txt', 'hello world')
      const resource = fs.open('/test.txt', {})

      if (!('setSize' in resource)) throw new Error('Not a file resource')

      resource.setSize(5n)
      expect(fs.readFileSync('/test.txt')).toBe('hello')
    })

    it('extends file with setSize', () => {
      fs.writeFileSync('/test.txt', 'hi')
      const resource = fs.open('/test.txt', {})

      if (!('setSize' in resource)) throw new Error('Not a file resource')

      resource.setSize(10n)
      expect(resource.size()).toBe(10n)
    })

    it('returns stats', () => {
      fs.writeFileSync('/test.txt', 'hello')
      const resource = fs.open('/test.txt', {})

      if (!('stat' in resource)) throw new Error('Not a file resource')

      const stat = resource.stat()
      expect(stat.filetype).toBe(FileType.REGULAR_FILE)
      expect(stat.size).toBe(5n)
    })

    it('sets times', () => {
      fs.writeFileSync('/test.txt', 'hello')
      const resource = fs.open('/test.txt', {})

      if (!('setTimes' in resource)) throw new Error('Not a file resource')

      resource.setTimes(1000n, 2000n)
      const stat = resource.stat()
      expect(stat.atim).toBe(1000n)
      expect(stat.mtim).toBe(2000n)
    })
  })

  describe('DirectoryResource', () => {
    it('lists directory entries', () => {
      fs.createDirectory('/testdir')
      fs.writeFileSync('/testdir/file1.txt', 'a')
      fs.writeFileSync('/testdir/file2.txt', 'b')
      fs.createDirectory('/testdir/subdir')

      const resource = fs.open('/testdir', { directory: true })

      if (!('readdir' in resource)) throw new Error('Not a directory resource')

      const entries = resource.readdir()
      const names = entries.map((e) => e.name).sort()
      expect(names).toEqual(['file1.txt', 'file2.txt', 'subdir'])
    })

    it('returns correct types for entries', () => {
      fs.createDirectory('/testdir')
      fs.writeFileSync('/testdir/file.txt', 'content')
      fs.createDirectory('/testdir/subdir')
      fs.symlink('/testdir/file.txt', '/testdir/link')

      const resource = fs.open('/testdir', { directory: true })

      if (!('readdir' in resource)) throw new Error('Not a directory resource')

      const entries = resource.readdir()
      const fileEntry = entries.find((e) => e.name === 'file.txt')
      const dirEntry = entries.find((e) => e.name === 'subdir')
      const linkEntry = entries.find((e) => e.name === 'link')

      expect(fileEntry?.type).toBe(FileType.REGULAR_FILE)
      expect(dirEntry?.type).toBe(FileType.DIRECTORY)
      expect(linkEntry?.type).toBe(FileType.SYMBOLIC_LINK)
    })

    it('returns stats for directory', () => {
      fs.createDirectory('/testdir')
      const resource = fs.open('/testdir', { directory: true })

      if (!('stat' in resource)) throw new Error('Not a directory resource')

      const stat = resource.stat()
      expect(stat.filetype).toBe(FileType.DIRECTORY)
    })
  })

  describe('utility methods', () => {
    describe('exists', () => {
      it('returns true for existing paths', () => {
        fs.writeFileSync('/test.txt', 'content')
        expect(fs.exists('/test.txt')).toBe(true)
      })

      it('returns false for non-existing paths', () => {
        expect(fs.exists('/nonexistent.txt')).toBe(false)
      })
    })

    describe('readFileSync', () => {
      it('reads file content as string', () => {
        fs.writeFileSync('/test.txt', 'hello world')
        expect(fs.readFileSync('/test.txt')).toBe('hello world')
      })

      it('throws EISDIR for directories', () => {
        fs.createDirectory('/testdir')
        expect(() => fs.readFileSync('/testdir')).toThrow('EISDIR')
      })
    })

    describe('writeFileSync', () => {
      it('creates new file', () => {
        fs.writeFileSync('/new.txt', 'content')
        expect(fs.exists('/new.txt')).toBe(true)
        expect(fs.readFileSync('/new.txt')).toBe('content')
      })

      it('overwrites existing file', () => {
        fs.writeFileSync('/test.txt', 'old')
        fs.writeFileSync('/test.txt', 'new')
        expect(fs.readFileSync('/test.txt')).toBe('new')
      })
    })

    describe('readdirSync', () => {
      it('lists directory contents', () => {
        fs.createDirectory('/testdir')
        fs.writeFileSync('/testdir/a.txt', '')
        fs.writeFileSync('/testdir/b.txt', '')

        const entries = fs.readdirSync('/testdir')
        expect(entries.sort()).toEqual(['a.txt', 'b.txt'])
      })

      it('throws ENOTDIR for files', () => {
        fs.writeFileSync('/file.txt', '')
        expect(() => fs.readdirSync('/file.txt')).toThrow('ENOTDIR')
      })
    })
  })

  describe('path normalization', () => {
    it('handles paths with trailing slashes', () => {
      fs.createDirectory('/testdir')
      expect(fs.exists('/testdir/')).toBe(true)
    })

    it('handles paths with multiple slashes', () => {
      fs.createDirectory('/testdir')
      expect(fs.exists('//testdir')).toBe(true)
      expect(fs.exists('/testdir//')).toBe(true)
    })

    it('handles relative-like paths', () => {
      fs.createDirectory('/test')
      expect(fs.exists('test')).toBe(true) // Treated as relative from root
    })
  })

  describe('inode management', () => {
    it('allocates unique inodes', () => {
      fs.writeFileSync('/file1.txt', '')
      fs.writeFileSync('/file2.txt', '')
      fs.createDirectory('/dir')

      const stat1 = fs.stat('/file1.txt')
      const stat2 = fs.stat('/file2.txt')
      const stat3 = fs.stat('/dir')

      const inodes = [stat1.ino, stat2.ino, stat3.ino]
      const uniqueInodes = [...new Set(inodes)]
      expect(uniqueInodes.length).toBe(3)
    })

    it('preserves inode across renames', () => {
      fs.writeFileSync('/old.txt', 'content')
      const statBefore = fs.stat('/old.txt')

      fs.rename('/old.txt', '/new.txt')
      const statAfter = fs.stat('/new.txt')

      expect(statAfter.ino).toBe(statBefore.ino)
    })

    it('removes inode when nlink reaches 0', () => {
      fs.writeFileSync('/file.txt', 'content')
      const stat = fs.stat('/file.txt')
      const ino = stat.ino

      fs.unlink('/file.txt')

      // File should no longer exist
      expect(fs.exists('/file.txt')).toBe(false)
    })

    it('decrements nlink on unlink but preserves with hard links', () => {
      fs.writeFileSync('/original.txt', 'content')
      fs.link('/original.txt', '/hardlink.txt')

      let stat = fs.stat('/original.txt')
      expect(stat.nlink).toBe(2n)

      fs.unlink('/original.txt')

      // Hard link should still exist
      expect(fs.exists('/hardlink.txt')).toBe(true)
      stat = fs.stat('/hardlink.txt')
      expect(stat.nlink).toBe(1n)
    })
  })

  describe('integration scenarios', () => {
    it('simulates a typical workflow', () => {
      // Create directory structure
      fs.createDirectory('/project')
      fs.createDirectory('/project/src')
      fs.createDirectory('/project/dist')

      // Create source files
      fs.writeFileSync('/project/src/index.ts', 'export default 42')
      fs.writeFileSync('/project/src/utils.ts', 'export const add = (a, b) => a + b')

      // Compile (simulate)
      fs.writeFileSync('/project/dist/index.js', 'exports.default = 42')

      // Verify structure
      expect(fs.readdirSync('/project').sort()).toEqual(['dist', 'src'])
      expect(fs.readdirSync('/project/src').sort()).toEqual(['index.ts', 'utils.ts'])

      // Clean and rebuild
      fs.unlink('/project/dist/index.js')
      fs.removeDirectory('/project/dist')

      expect(fs.exists('/project/dist')).toBe(false)
    })

    it('handles complex operations', () => {
      // Create initial structure
      fs.createDirectory('/old')
      fs.writeFileSync('/old/data.txt', 'important data')
      fs.createDirectory('/old/nested')
      fs.writeFileSync('/old/nested/deep.txt', 'deep data')

      // Create symlink
      fs.symlink('/old/data.txt', '/old/link.txt')

      // Create hard link
      fs.link('/old/data.txt', '/old/hardlink.txt')

      // Verify
      expect(fs.readFileSync('/old/data.txt')).toBe('important data')
      expect(fs.readFileSync('/old/link.txt')).toBe('important data')
      expect(fs.readFileSync('/old/hardlink.txt')).toBe('important data')

      // Modify via hard link
      fs.writeFileSync('/old/hardlink.txt', 'modified data')
      expect(fs.readFileSync('/old/data.txt')).toBe('modified data')
    })
  })
})
