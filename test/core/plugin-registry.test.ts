import { describe, it, expect, beforeEach } from 'vitest'
import { PluginRegistry } from '../../src/wasip2/core/plugin-registry.js'
import type { WasiPlugin, WasiInterface, PluginInstance, PluginConfig } from '../../src/wasip2/core/types.js'

// Mock plugin for testing
function createMockPlugin(iface: WasiInterface): WasiPlugin {
  const mockInstance: PluginInstance = {
    getImports: () => ({ test: () => 'mock' }),
    destroy: () => {},
  }

  return {
    witInterface: iface,
    implementations: new Map([
      ['default', {
        name: 'default',
        description: 'Default implementation',
        create: (_config: PluginConfig) => mockInstance,
      }],
    ]),
    defaultImplementation: 'default',
    create: (_config: PluginConfig) => mockInstance,
  }
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry

  beforeEach(() => {
    registry = new PluginRegistry()
  })

  describe('register', () => {
    it('registers a plugin', () => {
      const iface: WasiInterface = { package: 'wasi:random', name: 'random', version: '0.2.0' }
      const plugin = createMockPlugin(iface)

      registry.register(plugin)

      expect(registry.has(iface)).toBe(true)
    })

    it('replaces existing plugin', async () => {
      const iface: WasiInterface = { package: 'wasi:random', name: 'random', version: '0.2.0' }
      const plugin1 = createMockPlugin(iface)
      const plugin2 = createMockPlugin(iface)

      registry.register(plugin1)
      registry.register(plugin2)

      const retrieved = await registry.get(iface)
      expect(retrieved).toBe(plugin2)
    })
  })

  describe('get', () => {
    it('returns undefined for unregistered plugin', async () => {
      const iface: WasiInterface = { package: 'wasi:unknown', name: 'unknown', version: '0.2.0' }
      const result = await registry.get(iface)
      expect(result).toBeUndefined()
    })

    it('returns registered plugin', async () => {
      const iface: WasiInterface = { package: 'wasi:random', name: 'random', version: '0.2.0' }
      const plugin = createMockPlugin(iface)

      registry.register(plugin)
      const result = await registry.get(iface)

      expect(result).toBe(plugin)
    })

    it('matches plugin regardless of version', async () => {
      const iface: WasiInterface = { package: 'wasi:random', name: 'random', version: '0.2.0' }
      const plugin = createMockPlugin(iface)

      registry.register(plugin)

      const differentVersion: WasiInterface = { package: 'wasi:random', name: 'random', version: '0.3.0' }
      const result = await registry.get(differentVersion)

      expect(result).toBe(plugin)
    })
  })

  describe('registerLazy', () => {
    it('loads plugin on first access', async () => {
      const iface: WasiInterface = { package: 'wasi:lazy', name: 'lazy', version: '0.2.0' }
      const plugin = createMockPlugin(iface)
      let loadCalled = false

      registry.registerLazy(iface, async () => {
        loadCalled = true
        return plugin
      })

      expect(loadCalled).toBe(false)
      const result = await registry.get(iface)
      expect(loadCalled).toBe(true)
      expect(result).toBe(plugin)
    })

    it('caches loaded plugin', async () => {
      const iface: WasiInterface = { package: 'wasi:lazy', name: 'lazy', version: '0.2.0' }
      const plugin = createMockPlugin(iface)
      let loadCount = 0

      registry.registerLazy(iface, async () => {
        loadCount++
        return plugin
      })

      await registry.get(iface)
      await registry.get(iface)

      expect(loadCount).toBe(1)
    })
  })

  describe('list', () => {
    it('returns all registered plugins', () => {
      const iface1: WasiInterface = { package: 'wasi:random', name: 'random', version: '0.2.0' }
      const iface2: WasiInterface = { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' }

      registry.register(createMockPlugin(iface1))
      registry.register(createMockPlugin(iface2))

      const plugins = registry.list()
      expect(plugins).toHaveLength(2)
    })
  })

  describe('unregister', () => {
    it('removes registered plugin', () => {
      const iface: WasiInterface = { package: 'wasi:random', name: 'random', version: '0.2.0' }
      registry.register(createMockPlugin(iface))

      const result = registry.unregister(iface)

      expect(result).toBe(true)
      expect(registry.has(iface)).toBe(false)
    })

    it('returns false for non-existent plugin', () => {
      const iface: WasiInterface = { package: 'wasi:unknown', name: 'unknown', version: '0.2.0' }
      const result = registry.unregister(iface)
      expect(result).toBe(false)
    })
  })

  describe('clear', () => {
    it('removes all plugins', () => {
      const iface1: WasiInterface = { package: 'wasi:random', name: 'random', version: '0.2.0' }
      const iface2: WasiInterface = { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' }

      registry.register(createMockPlugin(iface1))
      registry.register(createMockPlugin(iface2))
      registry.clear()

      expect(registry.size).toBe(0)
    })
  })
})
