import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  threadSpawnPlugin,
  threadPlugins,
  THREAD_SPAWN_INTERFACE,
  ThreadSpawnError,
  ThreadState,
  checkThreadCapabilities,
  spawnError,
  spawnSuccess,
  ThreadRegistry,
  globalThreadRegistry,
  stubThreadSpawnImplementation,
  workerThreadSpawnImplementation,
} from '../../src/wasip2/plugins/threads/index.js'
import type { SpawnResult, ThreadInfo } from '../../src/wasip2/plugins/threads/index.js'

describe('wasi:thread-spawn/thread-spawn', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(threadSpawnPlugin.witInterface.package).toBe('wasi:thread-spawn')
      expect(threadSpawnPlugin.witInterface.name).toBe('thread-spawn')
      expect(threadSpawnPlugin.witInterface.version).toBe('0.1.0')
    })

    it('has stub as default implementation', () => {
      expect(threadSpawnPlugin.defaultImplementation).toBe('stub')
    })

    it('has correct interface constant', () => {
      expect(THREAD_SPAWN_INTERFACE).toEqual({
        package: 'wasi:thread-spawn',
        name: 'thread-spawn',
        version: '0.1.0',
      })
    })
  })

  describe('ThreadSpawnError enum', () => {
    it('has expected error codes', () => {
      expect(ThreadSpawnError.NotSupported).toBe('not-supported')
      expect(ThreadSpawnError.ResourceExhausted).toBe('resource-exhausted')
      expect(ThreadSpawnError.InvalidArgument).toBe('invalid-argument')
      expect(ThreadSpawnError.AccessDenied).toBe('access-denied')
      expect(ThreadSpawnError.InternalError).toBe('internal-error')
    })
  })

  describe('ThreadState enum', () => {
    it('has expected states', () => {
      expect(ThreadState.Running).toBe('running')
      expect(ThreadState.Completed).toBe('completed')
      expect(ThreadState.Terminated).toBe('terminated')
      expect(ThreadState.Error).toBe('error')
    })
  })

  describe('checkThreadCapabilities', () => {
    it('returns capability info', () => {
      const caps = checkThreadCapabilities()
      expect(typeof caps.canSpawn).toBe('boolean')
      expect(typeof caps.hasSharedMemory).toBe('boolean')
      expect(typeof caps.hasAtomics).toBe('boolean')
      expect(typeof caps.maxThreads).toBe('number')
    })

    it('maxThreads is 0 when canSpawn is false', () => {
      const caps = checkThreadCapabilities()
      if (!caps.canSpawn) {
        expect(caps.maxThreads).toBe(0)
      }
    })
  })

  describe('spawnError utility', () => {
    it('creates error result', () => {
      const result = spawnError(ThreadSpawnError.NotSupported)
      expect(result.tag).toBe('err')
      expect(result.val).toBe(ThreadSpawnError.NotSupported)
    })
  })

  describe('spawnSuccess utility', () => {
    it('creates success result', () => {
      const result = spawnSuccess(42)
      expect(result.tag).toBe('ok')
      expect(result.val).toBe(42)
    })
  })
})

describe('ThreadRegistry', () => {
  let registry: ThreadRegistry

  beforeEach(() => {
    registry = new ThreadRegistry(4)
  })

  describe('register', () => {
    it('registers a thread and returns ID', () => {
      const id = registry.register(123)
      expect(id).toBeGreaterThan(0)
    })

    it('returns unique IDs', () => {
      const id1 = registry.register(1)
      const id2 = registry.register(2)
      const id3 = registry.register(3)
      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
    })
  })

  describe('get', () => {
    it('retrieves thread info', () => {
      const id = registry.register(456)
      const info = registry.get(id)
      expect(info).toBeDefined()
      expect(info?.id).toBe(id)
      expect(info?.startArg).toBe(456)
      expect(info?.state).toBe(ThreadState.Running)
    })

    it('returns undefined for unknown ID', () => {
      expect(registry.get(9999)).toBeUndefined()
    })
  })

  describe('setState', () => {
    it('updates thread state', () => {
      const id = registry.register(1)
      registry.setState(id, ThreadState.Completed)
      expect(registry.get(id)?.state).toBe(ThreadState.Completed)
    })

    it('sets error message', () => {
      const id = registry.register(1)
      registry.setState(id, ThreadState.Error, 'Something failed')
      const info = registry.get(id)
      expect(info?.state).toBe(ThreadState.Error)
      expect(info?.error).toBe('Something failed')
    })
  })

  describe('remove', () => {
    it('removes thread from registry', () => {
      const id = registry.register(1)
      registry.remove(id)
      expect(registry.get(id)).toBeUndefined()
    })
  })

  describe('activeCount', () => {
    it('counts running threads', () => {
      expect(registry.activeCount).toBe(0)
      const id1 = registry.register(1)
      expect(registry.activeCount).toBe(1)
      const id2 = registry.register(2)
      expect(registry.activeCount).toBe(2)
      registry.setState(id1, ThreadState.Completed)
      expect(registry.activeCount).toBe(1)
    })
  })

  describe('canSpawn', () => {
    it('returns true when under limit', () => {
      expect(registry.canSpawn()).toBe(true)
    })

    it('returns false when at limit', () => {
      registry.register(1)
      registry.register(2)
      registry.register(3)
      registry.register(4)
      expect(registry.canSpawn()).toBe(false)
    })

    it('returns true after thread completes', () => {
      registry.register(1)
      registry.register(2)
      registry.register(3)
      const id4 = registry.register(4)
      expect(registry.canSpawn()).toBe(false)
      registry.setState(id4, ThreadState.Completed)
      expect(registry.canSpawn()).toBe(true)
    })
  })

  describe('getAll', () => {
    it('returns all thread IDs', () => {
      const id1 = registry.register(1)
      const id2 = registry.register(2)
      const all = registry.getAll()
      expect(all).toContain(id1)
      expect(all).toContain(id2)
    })
  })

  describe('clear', () => {
    it('removes all threads', () => {
      registry.register(1)
      registry.register(2)
      registry.clear()
      expect(registry.getAll()).toHaveLength(0)
    })
  })
})

describe('stub implementation', () => {
  it('creates an instance', () => {
    const instance = stubThreadSpawnImplementation.create({})
    expect(instance).toBeDefined()
  })

  it('exposes spawn function', () => {
    const instance = stubThreadSpawnImplementation.create({})
    const imports = instance.getImports()
    expect(imports['spawn']).toBeDefined()
    expect(typeof imports['spawn']).toBe('function')
  })

  it('spawn returns NotSupported', () => {
    const instance = stubThreadSpawnImplementation.create({})
    const imports = instance.getImports() as {
      spawn: (startArg: number) => SpawnResult
    }
    const result = imports.spawn(0)
    expect(result.tag).toBe('err')
    expect(result.val).toBe(ThreadSpawnError.NotSupported)
  })
})

describe('worker implementation', () => {
  it('creates an instance', () => {
    const instance = workerThreadSpawnImplementation.create({})
    expect(instance).toBeDefined()
  })

  it('exposes spawn function', () => {
    const instance = workerThreadSpawnImplementation.create({})
    const imports = instance.getImports()
    expect(imports['spawn']).toBeDefined()
    expect(typeof imports['spawn']).toBe('function')
  })

  it('spawn returns NotSupported without workerUrl', () => {
    const instance = workerThreadSpawnImplementation.create({})
    const imports = instance.getImports() as {
      spawn: (startArg: number) => SpawnResult
    }
    const result = imports.spawn(0)
    expect(result.tag).toBe('err')
    // Either NotSupported (no SharedArrayBuffer) or NotSupported (no workerUrl)
    expect(result.val).toBe(ThreadSpawnError.NotSupported)
  })

  it('spawn returns AccessDenied when disabled', () => {
    const instance = workerThreadSpawnImplementation.create({
      options: { enabled: false },
    })
    const imports = instance.getImports() as {
      spawn: (startArg: number) => SpawnResult
    }
    const result = imports.spawn(0)
    expect(result.tag).toBe('err')
    expect(result.val).toBe(ThreadSpawnError.AccessDenied)
  })

  it('accepts configuration options', () => {
    const onComplete = vi.fn()
    const onError = vi.fn()
    const instance = workerThreadSpawnImplementation.create({
      options: {
        maxThreads: 8,
        enabled: true,
        workerUrl: '/worker.js',
        onThreadComplete: onComplete,
        onThreadError: onError,
      },
    })
    expect(instance).toBeDefined()
  })
})

describe('threadPlugins array', () => {
  it('contains thread spawn plugin', () => {
    expect(threadPlugins.length).toBe(1)
    expect(threadPlugins).toContain(threadSpawnPlugin)
  })
})
