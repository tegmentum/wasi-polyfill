/**
 * browser:worker tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BrowserWorker,
  WorkerType,
  WorkerState,
  getDefaultWorkerManager,
  getBrowserWorkerImports,
} from '../../../src/browser/worker.js'

// Mock Worker in Node.js environment
class MockWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: ((event: unknown) => void) | null = null

  constructor(public url: string, public options?: unknown) {}

  postMessage(data: unknown, transfer?: Transferable[]) {
    // Simulate echo response
    setTimeout(() => {
      if (this.onmessage) {
        this.onmessage({ data: { echo: data } })
      }
    }, 10)
  }

  terminate() {}
}

// Use real SharedArrayBuffer if available, otherwise mock with backing ArrayBuffer
const MockSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined'
  ? SharedArrayBuffer
  : class MockSharedArrayBufferPolyfill {
      private _buffer: ArrayBuffer
      readonly byteLength: number
      constructor(byteLength: number, options?: { maxByteLength?: number }) {
        this._buffer = new ArrayBuffer(byteLength)
        this.byteLength = byteLength
      }
      // Make it work with Uint8Array by returning the internal buffer for typed array views
      slice(begin?: number, end?: number): ArrayBuffer {
        return this._buffer.slice(begin, end)
      }
    } as unknown as typeof SharedArrayBuffer

// Mock MessageChannel
class MockMessageChannel {
  port1 = { close: vi.fn() }
  port2 = { close: vi.fn() }
}

describe('browser:worker', () => {
  beforeEach(() => {
    // @ts-ignore
    globalThis.Worker = MockWorker
    // @ts-ignore
    globalThis.SharedArrayBuffer = MockSharedArrayBuffer
    // @ts-ignore
    globalThis.MessageChannel = MockMessageChannel
  })

  afterEach(() => {
    // @ts-ignore
    delete globalThis.Worker
    // @ts-ignore
    delete globalThis.SharedArrayBuffer
    // @ts-ignore
    delete globalThis.MessageChannel
  })

  describe('BrowserWorker', () => {
    it('should detect worker support', () => {
      const manager = new BrowserWorker()
      expect(manager.supportsWorkers()).toBe(true)
    })

    it('should detect shared memory support', () => {
      const manager = new BrowserWorker()
      expect(manager.supportsSharedMemory()).toBe(true)
    })

    it('should spawn a worker', () => {
      const manager = new BrowserWorker()
      const result = manager.spawn({ url: './test-worker.js' })

      expect('value' in result).toBe(true)
      if ('value' in result) {
        expect(result.value).toBeGreaterThan(0)
      }
    })

    it('should spawn a module worker', () => {
      const manager = new BrowserWorker()
      const result = manager.spawn({
        url: './test-worker.js',
        type: WorkerType.MODULE,
        name: 'test-module-worker',
      })

      expect('value' in result).toBe(true)
      if ('value' in result) {
        const info = manager.getWorkerInfo(result.value)
        expect(info).not.toBeNull()
        expect(info?.type).toBe(WorkerType.MODULE)
        expect(info?.name).toBe('test-module-worker')
      }
    })

    it('should spawn inline worker', () => {
      const manager = new BrowserWorker()
      const code = 'self.onmessage = (e) => self.postMessage(e.data * 2)'
      const result = manager.spawnInline(code)

      expect('value' in result).toBe(true)
    })

    it('should get worker info', () => {
      const manager = new BrowserWorker()
      const result = manager.spawn({ url: './test.js', name: 'info-test' })

      if ('value' in result) {
        const info = manager.getWorkerInfo(result.value)
        expect(info).not.toBeNull()
        expect(info?.name).toBe('info-test')
        expect(info?.url).toContain('test.js')
      }
    })

    it('should get active workers', () => {
      const manager = new BrowserWorker()
      manager.spawn({ url: './worker1.js' })
      manager.spawn({ url: './worker2.js' })

      const active = manager.getActiveWorkers()
      expect(active.length).toBe(2)
    })

    it('should terminate a worker', () => {
      const manager = new BrowserWorker()
      const result = manager.spawn({ url: './test.js' })

      if ('value' in result) {
        const terminateResult = manager.terminate(result.value)
        expect('value' in terminateResult).toBe(true)

        const info = manager.getWorkerInfo(result.value)
        expect(info?.state).toBe(WorkerState.TERMINATED)
      }
    })

    it('should terminate all workers', () => {
      const manager = new BrowserWorker()
      manager.spawn({ url: './worker1.js' })
      manager.spawn({ url: './worker2.js' })
      manager.spawn({ url: './worker3.js' })

      manager.terminateAll()

      const active = manager.getActiveWorkers()
      expect(active.length).toBe(0)
    })

    it('should respect max workers limit', () => {
      const manager = new BrowserWorker({ maxWorkers: 2 })
      manager.spawn({ url: './worker1.js' })
      manager.spawn({ url: './worker2.js' })
      const result = manager.spawn({ url: './worker3.js' })

      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.error.code).toBe('busy')
      }
    })

    it('should post message to worker', () => {
      const manager = new BrowserWorker()
      const result = manager.spawn({ url: './test.js' })

      if ('value' in result) {
        const postResult = manager.postMessage(result.value, { test: 'data' })
        expect('value' in postResult).toBe(true)
      }
    })

    it('should error when posting to invalid worker', () => {
      const manager = new BrowserWorker()
      const result = manager.postMessage(9999, { test: 'data' })

      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.error.code).toBe('not-found')
      }
    })

    it('should create shared buffer', () => {
      const manager = new BrowserWorker()
      const result = manager.createSharedBuffer({ byteLength: 1024 })

      expect('value' in result).toBe(true)
      if ('value' in result) {
        const info = manager.getSharedBufferInfo(result.value)
        expect(info).not.toBeNull()
        expect(info?.byteLength).toBe(1024)
      }
    })

    it('should get shared buffer view', () => {
      const manager = new BrowserWorker()
      const result = manager.createSharedBuffer({ byteLength: 1024 })

      if ('value' in result) {
        const viewResult = manager.getSharedBufferView(result.value, 0, 512)
        expect('value' in viewResult).toBe(true)
        if ('value' in viewResult) {
          expect(viewResult.value.length).toBe(512)
        }
      }
    })

    it('should delete shared buffer', () => {
      const manager = new BrowserWorker()
      const result = manager.createSharedBuffer({ byteLength: 1024 })

      if ('value' in result) {
        const deleted = manager.deleteSharedBuffer(result.value)
        expect(deleted).toBe(true)

        const info = manager.getSharedBufferInfo(result.value)
        expect(info).toBeNull()
      }
    })

    it('should create message channel', () => {
      const manager = new BrowserWorker()
      const result = manager.createMessageChannel()

      expect('value' in result).toBe(true)
      if ('value' in result) {
        const [port1, port2] = result.value
        expect(port1).toBeGreaterThan(0)
        expect(port2).toBeGreaterThan(0)
        expect(port1).not.toBe(port2)
      }
    })

    it('should close message port', () => {
      const manager = new BrowserWorker()
      const result = manager.createMessageChannel()

      if ('value' in result) {
        const [port1] = result.value
        const closeResult = manager.closeMessagePort(port1)
        expect('value' in closeResult).toBe(true)
      }
    })

    it('should clean up all resources on destroy', () => {
      const manager = new BrowserWorker()
      manager.spawn({ url: './worker1.js' })
      manager.spawn({ url: './worker2.js' })
      manager.createSharedBuffer({ byteLength: 1024 })
      manager.createMessageChannel()

      manager.destroy()

      expect(manager.getActiveWorkers().length).toBe(0)
    })
  })

  describe('getBrowserWorkerImports', () => {
    it('should return valid imports object', () => {
      const imports = getBrowserWorkerImports()

      expect(imports['browser:worker']).toBeDefined()
      expect(typeof imports['browser:worker']).toBe('object')
    })

    it('should include all required functions', () => {
      const imports = getBrowserWorkerImports()
      const workerImports = imports['browser:worker'] as Record<string, unknown>

      expect(typeof workerImports['supports-workers']).toBe('function')
      expect(typeof workerImports['supports-shared-memory']).toBe('function')
      expect(typeof workerImports['spawn']).toBe('function')
      expect(typeof workerImports['spawn-inline']).toBe('function')
      expect(typeof workerImports['terminate']).toBe('function')
      expect(typeof workerImports['post-message']).toBe('function')
      expect(typeof workerImports['read-messages']).toBe('function')
      expect(typeof workerImports['create-shared-buffer']).toBe('function')
      expect(typeof workerImports['create-message-channel']).toBe('function')
    })
  })

  describe('default manager', () => {
    it('should return same instance', () => {
      const manager1 = getDefaultWorkerManager()
      const manager2 = getDefaultWorkerManager()
      expect(manager1).toBe(manager2)
    })
  })
})
