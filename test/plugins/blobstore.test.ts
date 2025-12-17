import { describe, it, expect } from 'vitest'
import {
  blobstorePlugin,
  blobstoreContainerPlugin,
  memoryBlobstoreImplementation,
  createMemoryBlobstore,
  blobOk,
  blobErr,
  DEFAULT_BLOBSTORE_CONFIG,
  type BlobstoreResult,
  type ContainerMetadata,
  type ObjectMetadata,
  type ObjectId,
} from '../../src/wasip2/plugins/blobstore/index.js'

describe('wasi:blobstore/blobstore', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(blobstorePlugin.witInterface.package).toBe('wasi:blobstore')
      expect(blobstorePlugin.witInterface.name).toBe('blobstore')
      expect(blobstorePlugin.witInterface.version).toBe('0.2.0-draft')
    })

    it('has memory as default implementation', () => {
      expect(blobstorePlugin.defaultImplementation).toBe('memory')
    })
  })

  describe('container plugin', () => {
    it('has correct interface definition', () => {
      expect(blobstoreContainerPlugin.witInterface.package).toBe('wasi:blobstore')
      expect(blobstoreContainerPlugin.witInterface.name).toBe('container')
    })
  })

  describe('result helpers', () => {
    it('blobOk creates success result', () => {
      const result = blobOk('test')
      expect(result.tag).toBe('ok')
      expect(result.val).toBe('test')
    })

    it('blobErr creates error result', () => {
      const result = blobErr<string>('error message')
      expect(result.tag).toBe('err')
      expect(result.val).toBe('error message')
    })
  })

  describe('default config', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_BLOBSTORE_CONFIG.maxObjectSize).toBe(10 * 1024 * 1024)
    })
  })
})

describe('memory implementation', () => {
  it('has correct metadata', () => {
    expect(memoryBlobstoreImplementation.name).toBe('memory')
    expect(memoryBlobstoreImplementation.description).toContain('memory')
  })

  const getTestImports = () => {
    const { instance } = createMemoryBlobstore()
    const imports = instance.getImports() as {
      'create-container': (name: string) => BlobstoreResult<number>
      'get-container': (name: string) => BlobstoreResult<number>
      'delete-container': (name: string) => BlobstoreResult<void>
      'container-exists': (name: string) => BlobstoreResult<boolean>
      'copy-object': (src: ObjectId, dest: ObjectId) => BlobstoreResult<void>
      'move-object': (src: ObjectId, dest: ObjectId) => BlobstoreResult<void>
      '[method]container.name': (handle: number) => BlobstoreResult<string>
      '[method]container.info': (handle: number) => BlobstoreResult<ContainerMetadata>
      '[method]container.has-object': (handle: number, name: string) => BlobstoreResult<boolean>
      '[method]container.object-info': (handle: number, name: string) => BlobstoreResult<ObjectMetadata>
      '[method]container.get-data': (handle: number, name: string, start?: bigint, end?: bigint) => BlobstoreResult<Uint8Array>
      '[method]container.write-data': (handle: number, name: string, data: Uint8Array) => BlobstoreResult<void>
      '[method]container.delete-object': (handle: number, name: string) => BlobstoreResult<void>
      '[method]container.delete-objects': (handle: number, names: string[]) => BlobstoreResult<void>
      '[method]container.list-objects': (handle: number) => BlobstoreResult<string[]>
      '[method]container.clear': (handle: number) => BlobstoreResult<void>
      '[resource-drop]container': (handle: number) => void
    }
    return imports
  }

  describe('container management', () => {
    it('creates a container', () => {
      const imports = getTestImports()
      const result = imports['create-container']('test-container')
      expect(result.tag).toBe('ok')
      expect(result.val).toBeGreaterThan(0)
    })

    it('fails to create duplicate container', () => {
      const imports = getTestImports()
      imports['create-container']('test')
      const result = imports['create-container']('test')
      expect(result.tag).toBe('err')
    })

    it('gets existing container', () => {
      const imports = getTestImports()
      imports['create-container']('test')
      const result = imports['get-container']('test')
      expect(result.tag).toBe('ok')
    })

    it('fails to get non-existent container', () => {
      const imports = getTestImports()
      const result = imports['get-container']('nonexistent')
      expect(result.tag).toBe('err')
    })

    it('deletes container', () => {
      const imports = getTestImports()
      imports['create-container']('test')
      const deleteResult = imports['delete-container']('test')
      expect(deleteResult.tag).toBe('ok')

      const exists = imports['container-exists']('test')
      expect(exists.tag).toBe('ok')
      expect(exists.val).toBe(false)
    })

    it('checks container existence', () => {
      const imports = getTestImports()

      const before = imports['container-exists']('test')
      expect(before.tag).toBe('ok')
      expect(before.val).toBe(false)

      imports['create-container']('test')

      const after = imports['container-exists']('test')
      expect(after.tag).toBe('ok')
      expect(after.val).toBe(true)
    })
  })

  describe('container operations', () => {
    it('gets container name', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('my-bucket') as { tag: 'ok'; val: number }

      const result = imports['[method]container.name'](handle)
      expect(result.tag).toBe('ok')
      expect(result.val).toBe('my-bucket')
    })

    it('gets container info', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('my-bucket') as { tag: 'ok'; val: number }

      const result = imports['[method]container.info'](handle)
      expect(result.tag).toBe('ok')
      if (result.tag === 'ok') {
        expect(result.val.name).toBe('my-bucket')
        expect(typeof result.val.createdAt).toBe('bigint')
        expect(result.val.createdAt).toBeGreaterThan(0n)
      }
    })
  })

  describe('object operations', () => {
    it('writes and reads data', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      const data = new TextEncoder().encode('Hello, World!')
      const writeResult = imports['[method]container.write-data'](handle, 'greeting.txt', data)
      expect(writeResult.tag).toBe('ok')

      const readResult = imports['[method]container.get-data'](handle, 'greeting.txt')
      expect(readResult.tag).toBe('ok')
      if (readResult.tag === 'ok') {
        expect(new TextDecoder().decode(readResult.val)).toBe('Hello, World!')
      }
    })

    it('reads byte range', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      const data = new TextEncoder().encode('Hello, World!')
      imports['[method]container.write-data'](handle, 'greeting.txt', data)

      const rangeResult = imports['[method]container.get-data'](handle, 'greeting.txt', 0n, 5n)
      expect(rangeResult.tag).toBe('ok')
      if (rangeResult.tag === 'ok') {
        expect(new TextDecoder().decode(rangeResult.val)).toBe('Hello')
      }
    })

    it('checks object existence', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      const before = imports['[method]container.has-object'](handle, 'file.txt')
      expect(before.tag).toBe('ok')
      expect(before.val).toBe(false)

      imports['[method]container.write-data'](handle, 'file.txt', new Uint8Array([1, 2, 3]))

      const after = imports['[method]container.has-object'](handle, 'file.txt')
      expect(after.tag).toBe('ok')
      expect(after.val).toBe(true)
    })

    it('gets object info', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('bucket') as { tag: 'ok'; val: number }

      const data = new Uint8Array(100)
      imports['[method]container.write-data'](handle, 'file.bin', data)

      const result = imports['[method]container.object-info'](handle, 'file.bin')
      expect(result.tag).toBe('ok')
      if (result.tag === 'ok') {
        expect(result.val.name).toBe('file.bin')
        expect(result.val.container).toBe('bucket')
        expect(result.val.size).toBe(100n)
      }
    })

    it('deletes object', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      imports['[method]container.write-data'](handle, 'file.txt', new Uint8Array([1]))

      const deleteResult = imports['[method]container.delete-object'](handle, 'file.txt')
      expect(deleteResult.tag).toBe('ok')

      const exists = imports['[method]container.has-object'](handle, 'file.txt')
      expect(exists.val).toBe(false)
    })

    it('deletes multiple objects', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      imports['[method]container.write-data'](handle, 'a.txt', new Uint8Array([1]))
      imports['[method]container.write-data'](handle, 'b.txt', new Uint8Array([2]))
      imports['[method]container.write-data'](handle, 'c.txt', new Uint8Array([3]))

      const deleteResult = imports['[method]container.delete-objects'](handle, ['a.txt', 'c.txt'])
      expect(deleteResult.tag).toBe('ok')

      const listResult = imports['[method]container.list-objects'](handle)
      expect(listResult.tag).toBe('ok')
      if (listResult.tag === 'ok') {
        expect(listResult.val).toEqual(['b.txt'])
      }
    })

    it('lists objects sorted', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      imports['[method]container.write-data'](handle, 'zebra.txt', new Uint8Array([1]))
      imports['[method]container.write-data'](handle, 'alpha.txt', new Uint8Array([2]))
      imports['[method]container.write-data'](handle, 'mango.txt', new Uint8Array([3]))

      const result = imports['[method]container.list-objects'](handle)
      expect(result.tag).toBe('ok')
      if (result.tag === 'ok') {
        expect(result.val).toEqual(['alpha.txt', 'mango.txt', 'zebra.txt'])
      }
    })

    it('clears all objects', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      imports['[method]container.write-data'](handle, 'a.txt', new Uint8Array([1]))
      imports['[method]container.write-data'](handle, 'b.txt', new Uint8Array([2]))

      const clearResult = imports['[method]container.clear'](handle)
      expect(clearResult.tag).toBe('ok')

      const listResult = imports['[method]container.list-objects'](handle)
      expect(listResult.tag).toBe('ok')
      if (listResult.tag === 'ok') {
        expect(listResult.val).toEqual([])
      }
    })
  })

  describe('copy and move', () => {
    it('copies object between containers', () => {
      const imports = getTestImports()
      const { val: srcHandle } = imports['create-container']('src') as { tag: 'ok'; val: number }
      const { val: destHandle } = imports['create-container']('dest') as { tag: 'ok'; val: number }

      imports['[method]container.write-data'](srcHandle, 'file.txt', new TextEncoder().encode('data'))

      const copyResult = imports['copy-object'](
        { container: 'src', object: 'file.txt' },
        { container: 'dest', object: 'copied.txt' }
      )
      expect(copyResult.tag).toBe('ok')

      // Source still exists
      const srcExists = imports['[method]container.has-object'](srcHandle, 'file.txt')
      expect(srcExists.val).toBe(true)

      // Destination exists
      const destData = imports['[method]container.get-data'](destHandle, 'copied.txt')
      expect(destData.tag).toBe('ok')
      if (destData.tag === 'ok') {
        expect(new TextDecoder().decode(destData.val)).toBe('data')
      }
    })

    it('moves object between containers', () => {
      const imports = getTestImports()
      const { val: srcHandle } = imports['create-container']('src') as { tag: 'ok'; val: number }
      const { val: destHandle } = imports['create-container']('dest') as { tag: 'ok'; val: number }

      imports['[method]container.write-data'](srcHandle, 'file.txt', new TextEncoder().encode('data'))

      const moveResult = imports['move-object'](
        { container: 'src', object: 'file.txt' },
        { container: 'dest', object: 'moved.txt' }
      )
      expect(moveResult.tag).toBe('ok')

      // Source no longer exists
      const srcExists = imports['[method]container.has-object'](srcHandle, 'file.txt')
      expect(srcExists.val).toBe(false)

      // Destination exists
      const destData = imports['[method]container.get-data'](destHandle, 'moved.txt')
      expect(destData.tag).toBe('ok')
    })

    it('renames object within container', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      imports['[method]container.write-data'](handle, 'old.txt', new TextEncoder().encode('content'))

      const moveResult = imports['move-object'](
        { container: 'test', object: 'old.txt' },
        { container: 'test', object: 'new.txt' }
      )
      expect(moveResult.tag).toBe('ok')

      const oldExists = imports['[method]container.has-object'](handle, 'old.txt')
      const newExists = imports['[method]container.has-object'](handle, 'new.txt')

      expect(oldExists.val).toBe(false)
      expect(newExists.val).toBe(true)
    })
  })

  describe('limits', () => {
    it('enforces max object size', () => {
      const { instance } = createMemoryBlobstore({ maxObjectSize: 100 })
      const imports = instance.getImports() as {
        'create-container': (name: string) => BlobstoreResult<number>
        '[method]container.write-data': (handle: number, name: string, data: Uint8Array) => BlobstoreResult<void>
      }

      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      // Small data should work
      const smallResult = imports['[method]container.write-data'](handle, 'small.bin', new Uint8Array(50))
      expect(smallResult.tag).toBe('ok')

      // Large data should fail
      const largeResult = imports['[method]container.write-data'](handle, 'large.bin', new Uint8Array(150))
      expect(largeResult.tag).toBe('err')
    })

    it('enforces max objects per container', () => {
      const { instance } = createMemoryBlobstore({ maxObjectsPerContainer: 2 })
      const imports = instance.getImports() as {
        'create-container': (name: string) => BlobstoreResult<number>
        '[method]container.write-data': (handle: number, name: string, data: Uint8Array) => BlobstoreResult<void>
      }

      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      imports['[method]container.write-data'](handle, 'a.txt', new Uint8Array([1]))
      imports['[method]container.write-data'](handle, 'b.txt', new Uint8Array([2]))

      // Third object should fail
      const thirdResult = imports['[method]container.write-data'](handle, 'c.txt', new Uint8Array([3]))
      expect(thirdResult.tag).toBe('err')

      // Overwriting existing should work
      const overwrite = imports['[method]container.write-data'](handle, 'a.txt', new Uint8Array([10]))
      expect(overwrite.tag).toBe('ok')
    })

    it('enforces max containers', () => {
      const { instance } = createMemoryBlobstore({ maxContainers: 2 })
      const imports = instance.getImports() as {
        'create-container': (name: string) => BlobstoreResult<number>
      }

      imports['create-container']('a')
      imports['create-container']('b')

      const thirdResult = imports['create-container']('c')
      expect(thirdResult.tag).toBe('err')
    })
  })

  describe('initial data', () => {
    it('populates from initial data', () => {
      const initialData = new Map([
        ['bucket1', new Map([
          ['file1.txt', new TextEncoder().encode('content1')],
          ['file2.txt', new TextEncoder().encode('content2')],
        ])],
      ])

      const { instance } = createMemoryBlobstore({ initialData })
      const imports = instance.getImports() as {
        'get-container': (name: string) => BlobstoreResult<number>
        '[method]container.get-data': (handle: number, name: string) => BlobstoreResult<Uint8Array>
        '[method]container.list-objects': (handle: number) => BlobstoreResult<string[]>
      }

      const { val: handle } = imports['get-container']('bucket1') as { tag: 'ok'; val: number }

      const listResult = imports['[method]container.list-objects'](handle)
      expect(listResult.tag).toBe('ok')
      if (listResult.tag === 'ok') {
        expect(listResult.val).toEqual(['file1.txt', 'file2.txt'])
      }

      const dataResult = imports['[method]container.get-data'](handle, 'file1.txt')
      expect(dataResult.tag).toBe('ok')
      if (dataResult.tag === 'ok') {
        expect(new TextDecoder().decode(dataResult.val)).toBe('content1')
      }
    })
  })

  describe('handle management', () => {
    it('returns error for invalid handle', () => {
      const imports = getTestImports()
      const result = imports['[method]container.name'](9999)
      expect(result.tag).toBe('err')
    })

    it('returns error after handle dropped', () => {
      const imports = getTestImports()
      const { val: handle } = imports['create-container']('test') as { tag: 'ok'; val: number }

      imports['[resource-drop]container'](handle)

      const result = imports['[method]container.name'](handle)
      expect(result.tag).toBe('err')
    })

    it('multiple handles share container state', () => {
      const imports = getTestImports()
      const { val: handle1 } = imports['create-container']('shared') as { tag: 'ok'; val: number }
      const { val: handle2 } = imports['get-container']('shared') as { tag: 'ok'; val: number }

      imports['[method]container.write-data'](handle1, 'file.txt', new TextEncoder().encode('data'))

      const result = imports['[method]container.get-data'](handle2, 'file.txt')
      expect(result.tag).toBe('ok')
      if (result.tag === 'ok') {
        expect(new TextDecoder().decode(result.val)).toBe('data')
      }
    })
  })
})

describe('plugin integration', () => {
  it('can create memory blobstore via plugin', () => {
    const instance = blobstorePlugin.create({
      implementation: 'memory',
    })

    const imports = instance.getImports() as {
      'create-container': (name: string) => BlobstoreResult<number>
    }

    const result = imports['create-container']('test')
    expect(result.tag).toBe('ok')
  })
})
