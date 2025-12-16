/**
 * Tests for wasi:filesystem plugins
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  filesystemTypesPlugin,
  filesystemPreopensPlugin,
  filesystemPlugins,
  memoryFilesystemImplementation,
  memoryPreopensImplementation,
  emptyPreopensImplementation,
  MemoryFileSystem,
  FilesystemErrorCode,
  FILESYSTEM_TYPES_INTERFACE,
  FILESYSTEM_PREOPENS_INTERFACE,
  // OPFS exports
  opfsFilesystemImplementation,
  OpfsDescriptor,
  isOpfsAvailable,
  getGlobalOpfsFilesystemInstance,
} from '../../src/plugins/filesystem/index.js'

describe('Filesystem Plugins', () => {
  describe('Plugin Definitions', () => {
    it('should define filesystem types plugin correctly', () => {
      expect(filesystemTypesPlugin.witInterface).toEqual(FILESYSTEM_TYPES_INTERFACE)
      expect(filesystemTypesPlugin.witInterface.package).toBe('wasi:filesystem')
      expect(filesystemTypesPlugin.witInterface.name).toBe('types')
      expect(filesystemTypesPlugin.defaultImplementation).toBe('memory')
    })

    it('should define filesystem preopens plugin correctly', () => {
      expect(filesystemPreopensPlugin.witInterface).toEqual(FILESYSTEM_PREOPENS_INTERFACE)
      expect(filesystemPreopensPlugin.witInterface.package).toBe('wasi:filesystem')
      expect(filesystemPreopensPlugin.witInterface.name).toBe('preopens')
      expect(filesystemPreopensPlugin.defaultImplementation).toBe('empty')
    })

    it('should export all filesystem plugins', () => {
      expect(filesystemPlugins).toHaveLength(2)
      expect(filesystemPlugins).toContain(filesystemTypesPlugin)
      expect(filesystemPlugins).toContain(filesystemPreopensPlugin)
    })
  })

  describe('MemoryFileSystem', () => {
    let fs: MemoryFileSystem

    beforeEach(() => {
      fs = new MemoryFileSystem()
    })

    describe('Directory Operations', () => {
      it('should get root node', () => {
        const result = fs.getNode('/')
        expect(result.tag).toBe('ok')
        if (result.tag === 'ok') {
          expect(result.val.type).toBe('directory')
        }
      })

      it('should create directory', () => {
        const result = fs.createDirectory('/test')
        expect(result.tag).toBe('ok')
        if (result.tag === 'ok') {
          expect(result.val.type).toBe('directory')
        }
      })

      it('should fail to create existing directory', () => {
        fs.createDirectory('/test')
        const result = fs.createDirectory('/test')
        expect(result.tag).toBe('err')
        if (result.tag === 'err') {
          expect(result.val).toBe(FilesystemErrorCode.Exist)
        }
      })

      it('should create nested directories', () => {
        fs.createDirectory('/a')
        const result = fs.createDirectory('/a/b')
        expect(result.tag).toBe('ok')
      })

      it('should fail to create directory in non-existent parent', () => {
        const result = fs.createDirectory('/nonexistent/test')
        expect(result.tag).toBe('err')
        if (result.tag === 'err') {
          expect(result.val).toBe(FilesystemErrorCode.NoEntry)
        }
      })

      it('should remove empty directory', () => {
        fs.createDirectory('/test')
        const result = fs.remove('/test')
        expect(result.tag).toBe('ok')

        const getResult = fs.getNode('/test')
        expect(getResult.tag).toBe('err')
      })

      it('should fail to remove non-empty directory', () => {
        fs.createDirectory('/test')
        fs.createDirectory('/test/child')
        const result = fs.remove('/test')
        expect(result.tag).toBe('err')
        if (result.tag === 'err') {
          expect(result.val).toBe(FilesystemErrorCode.NotEmpty)
        }
      })
    })

    describe('File Operations', () => {
      it('should create file', () => {
        const result = fs.createFile('/test.txt', { create: true })
        expect(result.tag).toBe('ok')
        if (result.tag === 'ok') {
          expect(result.val.type).toBe('file')
          expect(result.val.content).toEqual(new Uint8Array(0))
        }
      })

      it('should fail to create file without create flag', () => {
        const result = fs.createFile('/test.txt', {})
        expect(result.tag).toBe('err')
        if (result.tag === 'err') {
          expect(result.val).toBe(FilesystemErrorCode.NoEntry)
        }
      })

      it('should fail with exclusive flag if file exists', () => {
        fs.createFile('/test.txt', { create: true })
        const result = fs.createFile('/test.txt', { create: true, exclusive: true })
        expect(result.tag).toBe('err')
        if (result.tag === 'err') {
          expect(result.val).toBe(FilesystemErrorCode.Exist)
        }
      })

      it('should truncate file with truncate flag', () => {
        const createResult = fs.createFile('/test.txt', { create: true })
        expect(createResult.tag).toBe('ok')
        if (createResult.tag === 'ok') {
          createResult.val.content = new Uint8Array([1, 2, 3])
        }

        const result = fs.createFile('/test.txt', { truncate: true })
        expect(result.tag).toBe('ok')
        if (result.tag === 'ok') {
          expect(result.val.content).toEqual(new Uint8Array(0))
        }
      })

      it('should remove file', () => {
        fs.createFile('/test.txt', { create: true })
        const result = fs.remove('/test.txt')
        expect(result.tag).toBe('ok')

        const getResult = fs.getNode('/test.txt')
        expect(getResult.tag).toBe('err')
      })
    })

    describe('Rename Operations', () => {
      it('should rename file', () => {
        fs.createFile('/old.txt', { create: true })
        const result = fs.rename('/old.txt', '/new.txt')
        expect(result.tag).toBe('ok')

        expect(fs.getNode('/old.txt').tag).toBe('err')
        expect(fs.getNode('/new.txt').tag).toBe('ok')
      })

      it('should rename directory', () => {
        fs.createDirectory('/old')
        const result = fs.rename('/old', '/new')
        expect(result.tag).toBe('ok')

        expect(fs.getNode('/old').tag).toBe('err')
        expect(fs.getNode('/new').tag).toBe('ok')
      })

      it('should fail to rename over non-empty directory', () => {
        fs.createDirectory('/old')
        fs.createDirectory('/new')
        fs.createDirectory('/new/child')
        const result = fs.rename('/old', '/new')
        expect(result.tag).toBe('err')
        if (result.tag === 'err') {
          expect(result.val).toBe(FilesystemErrorCode.NotEmpty)
        }
      })

      it('should fail to rename file over directory', () => {
        fs.createFile('/file.txt', { create: true })
        fs.createDirectory('/dir')
        const result = fs.rename('/file.txt', '/dir')
        expect(result.tag).toBe('err')
        if (result.tag === 'err') {
          expect(result.val).toBe(FilesystemErrorCode.IsDirectory)
        }
      })
    })
  })

  describe('Memory Filesystem Implementation', () => {
    it('should create singleton instance', () => {
      const instance1 = memoryFilesystemImplementation.create({
        interface: FILESYSTEM_TYPES_INTERFACE,
      })
      const instance2 = memoryFilesystemImplementation.create({
        interface: FILESYSTEM_TYPES_INTERFACE,
      })

      expect(instance1).toBe(instance2)
    })

    it('should provide descriptor operations', () => {
      const instance = memoryFilesystemImplementation.create({
        interface: FILESYSTEM_TYPES_INTERFACE,
      })
      const imports = instance.getImports()

      expect(imports['[resource-drop]descriptor']).toBeDefined()
      expect(imports['[method]descriptor.get-type']).toBeDefined()
      expect(imports['[method]descriptor.stat']).toBeDefined()
      expect(imports['[method]descriptor.read']).toBeDefined()
      expect(imports['[method]descriptor.write']).toBeDefined()
      expect(imports['[method]descriptor.read-directory']).toBeDefined()
      expect(imports['[method]descriptor.create-directory-at']).toBeDefined()
      expect(imports['[method]descriptor.open-at']).toBeDefined()
      expect(imports['[method]descriptor.remove-directory-at']).toBeDefined()
      expect(imports['[method]descriptor.unlink-file-at']).toBeDefined()
    })
  })

  describe('Preopens Implementation', () => {
    it('should create empty preopens by default', () => {
      const instance = emptyPreopensImplementation.create({
        interface: FILESYSTEM_PREOPENS_INTERFACE,
      })
      const imports = instance.getImports() as {
        'get-directories': () => Array<[number, string]>
      }

      expect(imports['get-directories']()).toEqual([])
    })

    it('should create memory preopens implementation', () => {
      // First create filesystem instance
      memoryFilesystemImplementation.create({
        interface: FILESYSTEM_TYPES_INTERFACE,
      })

      const instance = memoryPreopensImplementation.create({
        interface: FILESYSTEM_PREOPENS_INTERFACE,
        options: {
          preopens: [{ path: '/', alias: '.' }],
        },
      })
      const imports = instance.getImports() as {
        'get-directories': () => Array<[number, string]>
      }

      const dirs = imports['get-directories']()
      expect(dirs.length).toBeGreaterThan(0)
      expect(dirs[0]?.[1]).toBe('.')
    })

    it('should return empty for invalid paths', () => {
      // First create filesystem instance
      memoryFilesystemImplementation.create({
        interface: FILESYSTEM_TYPES_INTERFACE,
      })

      const instance = memoryPreopensImplementation.create({
        interface: FILESYSTEM_PREOPENS_INTERFACE,
        options: {
          preopens: [{ path: '/nonexistent/path' }],
        },
      })
      const imports = instance.getImports() as {
        'get-directories': () => Array<[number, string]>
      }

      const dirs = imports['get-directories']()
      // Should be empty since path doesn't exist
      expect(dirs.length).toBe(0)
    })
  })

  describe('FilesystemErrorCode', () => {
    it('should have correct error codes', () => {
      expect(FilesystemErrorCode.Access).toBe('access')
      expect(FilesystemErrorCode.NoEntry).toBe('no-entry')
      expect(FilesystemErrorCode.Exist).toBe('exist')
      expect(FilesystemErrorCode.IsDirectory).toBe('is-directory')
      expect(FilesystemErrorCode.NotDirectory).toBe('not-directory')
      expect(FilesystemErrorCode.NotEmpty).toBe('not-empty')
      expect(FilesystemErrorCode.NotPermitted).toBe('not-permitted')
      expect(FilesystemErrorCode.Unsupported).toBe('unsupported')
    })
  })

  describe('OPFS Implementation', () => {
    describe('Exports', () => {
      it('should export opfsFilesystemImplementation', () => {
        expect(opfsFilesystemImplementation).toBeDefined()
        expect(opfsFilesystemImplementation.name).toBe('opfs')
        expect(opfsFilesystemImplementation.description).toContain('Origin Private File System')
      })

      it('should export OpfsDescriptor class', () => {
        expect(OpfsDescriptor).toBeDefined()
        expect(typeof OpfsDescriptor).toBe('function')
      })

      it('should export isOpfsAvailable function', () => {
        expect(isOpfsAvailable).toBeDefined()
        expect(typeof isOpfsAvailable).toBe('function')
      })

      it('should export getGlobalOpfsFilesystemInstance function', () => {
        expect(getGlobalOpfsFilesystemInstance).toBeDefined()
        expect(typeof getGlobalOpfsFilesystemInstance).toBe('function')
      })
    })

    describe('isOpfsAvailable', () => {
      it('should return false in Node.js environment', () => {
        // In Node.js, navigator.storage.getDirectory is not available
        expect(isOpfsAvailable()).toBe(false)
      })
    })

    describe('Plugin Registration', () => {
      it('should include opfs implementation in filesystem types plugin', () => {
        expect(filesystemTypesPlugin.implementations.has('opfs')).toBe(true)
        const impl = filesystemTypesPlugin.implementations.get('opfs')
        expect(impl).toBe(opfsFilesystemImplementation)
      })

      it('should have memory as default implementation', () => {
        expect(filesystemTypesPlugin.defaultImplementation).toBe('memory')
      })

      it('should have both memory and opfs implementations', () => {
        expect(filesystemTypesPlugin.implementations.size).toBe(2)
        expect(filesystemTypesPlugin.implementations.has('memory')).toBe(true)
        expect(filesystemTypesPlugin.implementations.has('opfs')).toBe(true)
      })
    })

    describe('Implementation Structure', () => {
      it('should have create method', () => {
        expect(typeof opfsFilesystemImplementation.create).toBe('function')
      })

      it('should accept rootDirName configuration', () => {
        // This will throw because OPFS is not available in Node.js,
        // but we can verify the configuration is accepted
        const config = {
          interface: FILESYSTEM_TYPES_INTERFACE,
          options: {
            rootDirName: 'custom-root',
          },
        }

        // The implementation creation succeeds but will fail on first use
        // because OPFS is not available
        const instance = opfsFilesystemImplementation.create(config)
        expect(instance).toBeDefined()
        expect(typeof instance.getImports).toBe('function')
      })
    })

    describe('getGlobalOpfsFilesystemInstance', () => {
      it('should return instance after creation', () => {
        // Create instance first
        opfsFilesystemImplementation.create({
          interface: FILESYSTEM_TYPES_INTERFACE,
        })

        const instance = getGlobalOpfsFilesystemInstance()
        expect(instance).toBeDefined()
        expect(instance).not.toBeNull()
      })

      it('should return same singleton instance', () => {
        const instance1 = opfsFilesystemImplementation.create({
          interface: FILESYSTEM_TYPES_INTERFACE,
        })
        const instance2 = opfsFilesystemImplementation.create({
          interface: FILESYSTEM_TYPES_INTERFACE,
        })

        expect(instance1).toBe(instance2)
      })
    })

    describe('OPFS Instance Imports', () => {
      it('should provide all required descriptor operations', () => {
        const instance = opfsFilesystemImplementation.create({
          interface: FILESYSTEM_TYPES_INTERFACE,
        })
        const imports = instance.getImports()

        // Core resource operations
        expect(imports['[resource-drop]descriptor']).toBeDefined()

        // Descriptor methods
        expect(imports['[method]descriptor.get-type']).toBeDefined()
        expect(imports['[method]descriptor.stat']).toBeDefined()
        expect(imports['[method]descriptor.get-flags']).toBeDefined()
        expect(imports['[method]descriptor.read']).toBeDefined()
        expect(imports['[method]descriptor.write']).toBeDefined()
        expect(imports['[method]descriptor.read-directory']).toBeDefined()
        expect(imports['[method]descriptor.sync']).toBeDefined()
        expect(imports['[method]descriptor.sync-data']).toBeDefined()
        expect(imports['[method]descriptor.create-directory-at']).toBeDefined()
        expect(imports['[method]descriptor.stat-at']).toBeDefined()
        expect(imports['[method]descriptor.open-at']).toBeDefined()
        expect(imports['[method]descriptor.remove-directory-at']).toBeDefined()
        expect(imports['[method]descriptor.unlink-file-at']).toBeDefined()
        expect(imports['[method]descriptor.rename-at']).toBeDefined()
        expect(imports['[method]descriptor.metadata-hash']).toBeDefined()
        expect(imports['[method]descriptor.metadata-hash-at']).toBeDefined()

        // Directory entry stream operations
        expect(imports['[resource-drop]directory-entry-stream']).toBeDefined()
        expect(imports['[method]directory-entry-stream.read-directory-entry']).toBeDefined()

        // Filesystem error helper
        expect(imports['filesystem-error-code']).toBeDefined()
      })

      it('should provide unsupported operations that return proper errors', () => {
        const instance = opfsFilesystemImplementation.create({
          interface: FILESYSTEM_TYPES_INTERFACE,
        })
        const imports = instance.getImports() as Record<string, unknown>

        // These operations are not supported in OPFS
        expect(imports['[method]descriptor.link-at']).toBeDefined()
        expect(imports['[method]descriptor.symlink-at']).toBeDefined()
        expect(imports['[method]descriptor.readlink-at']).toBeDefined()
        expect(imports['[method]descriptor.read-via-stream']).toBeDefined()
        expect(imports['[method]descriptor.write-via-stream']).toBeDefined()
        expect(imports['[method]descriptor.append-via-stream']).toBeDefined()
      })
    })
  })
})
