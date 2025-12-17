/**
 * Tests for the resource table
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ResourceTable,
  TypedHandle,
  createReadyPollable,
  createPromisePollable,
  type ResourceType,
  type StreamResource,
} from '../../src/wasip2/runtime/resources.js'
import { WasiError, WasiErrorCode } from '../../src/shared/errors.js'

describe('ResourceTable', () => {
  let table: ResourceTable

  beforeEach(() => {
    table = new ResourceTable()
  })

  describe('Allocation', () => {
    it('should allocate a handle', () => {
      const handle = table.allocate('stream.input', { data: 'test' })

      expect(handle).toBeGreaterThan(0)
    })

    it('should allocate unique handles', () => {
      const h1 = table.allocate('stream.input', {})
      const h2 = table.allocate('stream.input', {})
      const h3 = table.allocate('stream.output', {})

      expect(h1).not.toBe(h2)
      expect(h2).not.toBe(h3)
    })

    it('should store metadata', () => {
      const handle = table.allocate('stream.input', {}, { origin: 'test' })

      const entry = table.getEntry(handle)
      expect(entry?.metadata?.origin).toBe('test')
    })
  })

  describe('Get', () => {
    it('should retrieve a resource by handle', () => {
      const resource = { value: 42 }
      const handle = table.allocate('stream.input', resource)

      const retrieved = table.get(handle)

      expect(retrieved).toBe(resource)
    })

    it('should throw for invalid handle', () => {
      expect(() => table.get(999)).toThrow(WasiError)
      expect(() => table.get(999)).toThrow('Invalid handle')
    })

    it('should throw for closed handle', () => {
      const handle = table.allocate('stream.input', {})
      table.close(handle)

      expect(() => table.get(handle)).toThrow(WasiError)
      expect(() => table.get(handle)).toThrow('closed')
    })

    it('should validate type when specified', () => {
      const handle = table.allocate('stream.input', {})

      expect(() => table.get(handle, 'stream.output')).toThrow('type mismatch')
    })

    it('should return resource when type matches', () => {
      const resource = { test: true }
      const handle = table.allocate('stream.input', resource)

      const retrieved = table.get(handle, 'stream.input')

      expect(retrieved).toBe(resource)
    })
  })

  describe('TryGet', () => {
    it('should return resource when valid', () => {
      const resource = { value: 'test' }
      const handle = table.allocate('pollable', resource)

      const result = table.tryGet(handle)

      expect(result).toBe(resource)
    })

    it('should return undefined for invalid handle', () => {
      const result = table.tryGet(999)
      expect(result).toBeUndefined()
    })

    it('should return undefined for closed handle', () => {
      const handle = table.allocate('pollable', {})
      table.close(handle)

      const result = table.tryGet(handle)
      expect(result).toBeUndefined()
    })
  })

  describe('IsValid', () => {
    it('should return true for valid handle', () => {
      const handle = table.allocate('descriptor', {})

      expect(table.isValid(handle)).toBe(true)
    })

    it('should return false for invalid handle', () => {
      expect(table.isValid(999)).toBe(false)
    })

    it('should return false for closed handle', () => {
      const handle = table.allocate('descriptor', {})
      table.close(handle)

      expect(table.isValid(handle)).toBe(false)
    })

    it('should check type when specified', () => {
      const handle = table.allocate('descriptor', {})

      expect(table.isValid(handle, 'descriptor')).toBe(true)
      expect(table.isValid(handle, 'socket.tcp')).toBe(false)
    })
  })

  describe('Close', () => {
    it('should close a handle', () => {
      const handle = table.allocate('socket.tcp', {})

      const result = table.close(handle)

      expect(result).toBe(true)
      expect(table.isValid(handle)).toBe(false)
    })

    it('should return false for already closed handle', () => {
      const handle = table.allocate('socket.tcp', {})
      table.close(handle)

      const result = table.close(handle)

      expect(result).toBe(false)
    })

    it('should return false for never-existed handle', () => {
      const result = table.close(999)
      expect(result).toBe(false)
    })

    it('should recycle handles', () => {
      const h1 = table.allocate('stream.input', {})
      table.close(h1)

      const h2 = table.allocate('stream.output', {})

      // Handle should be recycled
      expect(h2).toBe(h1)
    })
  })

  describe('CloseWithCleanup', () => {
    it('should call cleanup function', async () => {
      let cleanupCalled = false
      const handle = table.allocate('socket.tcp', { id: 'test' })

      await table.closeWithCleanup(handle, (value) => {
        cleanupCalled = true
        expect((value as { id: string }).id).toBe('test')
      })

      expect(cleanupCalled).toBe(true)
      expect(table.isValid(handle)).toBe(false)
    })

    it('should handle async cleanup', async () => {
      const handle = table.allocate('socket.tcp', {})

      await table.closeWithCleanup(handle, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
      })

      expect(table.isValid(handle)).toBe(false)
    })

    it('should close even if cleanup throws', async () => {
      const handle = table.allocate('socket.tcp', {})

      await expect(
        table.closeWithCleanup(handle, () => {
          throw new Error('cleanup error')
        })
      ).rejects.toThrow('cleanup error')

      expect(table.isValid(handle)).toBe(false)
    })
  })

  describe('Update', () => {
    it('should update resource value', () => {
      const handle = table.allocate('stream.input', { count: 0 })

      table.update(handle, { count: 5 })

      const value = table.get<{ count: number }>(handle)
      expect(value.count).toBe(5)
    })

    it('should throw for invalid handle', () => {
      expect(() => table.update(999, {})).toThrow('Invalid handle')
    })

    it('should throw for closed handle', () => {
      const handle = table.allocate('stream.input', {})
      table.close(handle)

      expect(() => table.update(handle, {})).toThrow('closed')
    })
  })

  describe('Metadata', () => {
    it('should update metadata', () => {
      const handle = table.allocate('descriptor', {})

      table.updateMetadata(handle, { path: '/test' })

      const entry = table.getEntry(handle)
      expect(entry?.metadata?.path).toBe('/test')
    })

    it('should merge metadata', () => {
      const handle = table.allocate('descriptor', {}, { a: 1 })

      table.updateMetadata(handle, { b: 2 })

      const entry = table.getEntry(handle)
      expect(entry?.metadata?.a).toBe(1)
      expect(entry?.metadata?.b).toBe(2)
    })
  })

  describe('Parent-Child', () => {
    it('should set parent handle', () => {
      const parent = table.allocate('directory', {})
      const child = table.allocate('descriptor', {})

      table.setParent(child, parent)

      const entry = table.getEntry(child)
      expect(entry?.parent).toBe(parent)
    })

    it('should get children of parent', () => {
      const parent = table.allocate('directory', {})
      const child1 = table.allocate('descriptor', {})
      const child2 = table.allocate('descriptor', {})

      table.setParent(child1, parent)
      table.setParent(child2, parent)

      const children = table.getChildren(parent)

      expect(children).toContain(child1)
      expect(children).toContain(child2)
    })

    it('should not include closed children', () => {
      const parent = table.allocate('directory', {})
      const child1 = table.allocate('descriptor', {})
      const child2 = table.allocate('descriptor', {})

      table.setParent(child1, parent)
      table.setParent(child2, parent)
      table.close(child1)

      const children = table.getChildren(parent)

      expect(children).not.toContain(child1)
      expect(children).toContain(child2)
    })

    it('should close all children', () => {
      const parent = table.allocate('directory', {})
      const child1 = table.allocate('descriptor', {})
      const child2 = table.allocate('descriptor', {})

      table.setParent(child1, parent)
      table.setParent(child2, parent)

      table.closeChildren(parent)

      expect(table.isValid(child1)).toBe(false)
      expect(table.isValid(child2)).toBe(false)
      expect(table.isValid(parent)).toBe(true)
    })
  })

  describe('GetHandlesByType', () => {
    it('should return handles of specified type', () => {
      const h1 = table.allocate('stream.input', {})
      const h2 = table.allocate('stream.input', {})
      const h3 = table.allocate('stream.output', {})

      const handles = table.getHandlesByType('stream.input')

      expect(handles).toContain(h1)
      expect(handles).toContain(h2)
      expect(handles).not.toContain(h3)
    })

    it('should not include closed handles', () => {
      const h1 = table.allocate('stream.input', {})
      const h2 = table.allocate('stream.input', {})
      table.close(h1)

      const handles = table.getHandlesByType('stream.input')

      expect(handles).not.toContain(h1)
      expect(handles).toContain(h2)
    })
  })

  describe('Statistics', () => {
    it('should track total allocations', () => {
      table.allocate('stream.input', {})
      table.allocate('stream.output', {})

      const stats = table.getStats()

      expect(stats.totalAllocated).toBe(2)
    })

    it('should track active count', () => {
      const h1 = table.allocate('stream.input', {})
      table.allocate('stream.output', {})
      table.close(h1)

      const stats = table.getStats()

      expect(stats.activeCount).toBe(1)
    })

    it('should track by type', () => {
      table.allocate('stream.input', {})
      table.allocate('stream.input', {})
      table.allocate('stream.output', {})

      const stats = table.getStats()

      expect(stats.byType['stream.input']).toBe(2)
      expect(stats.byType['stream.output']).toBe(1)
    })

    it('should track peak count', () => {
      const h1 = table.allocate('stream.input', {})
      const h2 = table.allocate('stream.input', {})
      const h3 = table.allocate('stream.input', {})
      table.close(h1)
      table.close(h2)

      const stats = table.getStats()

      expect(stats.peakCount).toBe(3)
      expect(stats.activeCount).toBe(1)
    })
  })

  describe('Clear', () => {
    it('should clear all resources', () => {
      table.allocate('stream.input', {})
      table.allocate('stream.output', {})

      table.clear()

      const stats = table.getStats()
      expect(stats.totalAllocated).toBe(0)
      expect(stats.activeCount).toBe(0)
    })

    it('should reset handle counter', () => {
      table.allocate('stream.input', {})
      table.allocate('stream.input', {})

      table.clear()

      const h = table.allocate('stream.input', {})
      expect(h).toBe(1)
    })
  })

  describe('CloseAll', () => {
    it('should close all resources', () => {
      const h1 = table.allocate('stream.input', {})
      const h2 = table.allocate('stream.output', {})

      table.closeAll()

      expect(table.isValid(h1)).toBe(false)
      expect(table.isValid(h2)).toBe(false)
    })
  })
})

describe('TypedHandle', () => {
  let table: ResourceTable

  beforeEach(() => {
    table = new ResourceTable()
  })

  it('should provide type-safe access', () => {
    interface MyResource {
      value: number
    }

    const handle = table.allocate('stream.input', { value: 42 } as MyResource)
    const typed = new TypedHandle<MyResource, 'stream.input'>(table, handle, 'stream.input')

    expect(typed.id).toBe(handle)
    expect(typed.get().value).toBe(42)
    expect(typed.isValid()).toBe(true)
  })

  it('should close the handle', () => {
    const handle = table.allocate('pollable', {})
    const typed = new TypedHandle(table, handle, 'pollable')

    typed.close()

    expect(typed.isValid()).toBe(false)
  })

  it('should update the resource', () => {
    interface Counter {
      count: number
    }

    const handle = table.allocate('stream.input', { count: 0 } as Counter)
    const typed = new TypedHandle<Counter, 'stream.input'>(table, handle, 'stream.input')

    typed.update({ count: 10 })

    expect(typed.get().count).toBe(10)
  })
})

describe('Pollable Helpers', () => {
  describe('createReadyPollable', () => {
    it('should be immediately ready', () => {
      const pollable = createReadyPollable()

      expect(pollable.ready()).toBe(true)
    })

    it('should resolve immediately on block', async () => {
      const pollable = createReadyPollable()

      await pollable.block() // Should not hang
    })
  })

  describe('createPromisePollable', () => {
    it('should not be ready before promise resolves', () => {
      const promise = new Promise<void>(() => {}) // Never resolves
      const pollable = createPromisePollable(promise)

      expect(pollable.ready()).toBe(false)
    })

    it('should be ready after promise resolves', async () => {
      let resolve: () => void
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      const pollable = createPromisePollable(promise)

      resolve!()
      await promise

      expect(pollable.ready()).toBe(true)
    })

    it('should block until promise resolves', async () => {
      let resolve: () => void
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      const pollable = createPromisePollable(promise)

      setTimeout(() => resolve!(), 10)

      await pollable.block()

      expect(pollable.ready()).toBe(true)
    })
  })
})
