/**
 * Tests for wasi:config plugin
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Types
  type ConfigResult,
  type ConfigError,
  // Helpers
  configErrorUpstream,
  configErrorIo,
  configOk,
  configErr,
  // Implementations
  runtimeConfigImplementation,
  MutableConfigStore,
  // Plugins
  CONFIG_STORE_INTERFACE,
  CONFIG_RUNTIME_INTERFACE,
  configStorePlugin,
  configRuntimePlugin,
  configPlugins,
} from '../../src/plugins/config/index.js'

describe('Config Plugin', () => {
  describe('Types and Helpers', () => {
    describe('configErrorUpstream', () => {
      it('should create an upstream error', () => {
        const error = configErrorUpstream('Vault connection failed')
        expect(error.tag).toBe('upstream')
        expect(error.val).toBe('Vault connection failed')
      })
    })

    describe('configErrorIo', () => {
      it('should create an I/O error', () => {
        const error = configErrorIo('File not found')
        expect(error.tag).toBe('io')
        expect(error.val).toBe('File not found')
      })
    })

    describe('configOk', () => {
      it('should create a successful result', () => {
        const result = configOk('value')
        expect(result.tag).toBe('ok')
        expect(result.val).toBe('value')
      })

      it('should handle undefined values', () => {
        const result = configOk<string | undefined>(undefined)
        expect(result.tag).toBe('ok')
        expect(result.val).toBeUndefined()
      })
    })

    describe('configErr', () => {
      it('should create an error result', () => {
        const error = configErrorUpstream('failed')
        const result = configErr<string>(error)
        expect(result.tag).toBe('err')
        expect(result.val).toEqual(error)
      })
    })
  })

  describe('Interface Definitions', () => {
    it('should define CONFIG_STORE_INTERFACE correctly', () => {
      expect(CONFIG_STORE_INTERFACE.package).toBe('wasi:config')
      expect(CONFIG_STORE_INTERFACE.name).toBe('store')
      expect(CONFIG_STORE_INTERFACE.version).toBe('0.2.0-draft')
    })

    it('should define CONFIG_RUNTIME_INTERFACE correctly', () => {
      expect(CONFIG_RUNTIME_INTERFACE.package).toBe('wasi:config')
      expect(CONFIG_RUNTIME_INTERFACE.name).toBe('runtime')
      expect(CONFIG_RUNTIME_INTERFACE.version).toBe('0.2.0-draft')
    })
  })

  describe('Runtime Config Implementation', () => {
    describe('runtimeConfigImplementation', () => {
      it('should have correct metadata', () => {
        expect(runtimeConfigImplementation.name).toBe('runtime')
        expect(runtimeConfigImplementation.description).toContain('In-memory')
      })

      it('should create an instance', () => {
        const instance = runtimeConfigImplementation.create({})
        expect(instance).toBeDefined()
        expect(instance.getImports).toBeDefined()
        expect(instance.destroy).toBeDefined()
      })
    })

    describe('Instance with initial values', () => {
      it('should return configured values', () => {
        const instance = runtimeConfigImplementation.create({
          values: {
            'database.url': 'postgres://localhost:5432/mydb',
            'api.timeout': '30000',
          },
        })

        const imports = instance.getImports()
        const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

        const result = get('database.url')
        expect(result.tag).toBe('ok')
        expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('postgres://localhost:5432/mydb')
      })

      it('should return undefined for missing keys', () => {
        const instance = runtimeConfigImplementation.create({
          values: { key: 'value' },
        })

        const imports = instance.getImports()
        const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

        const result = get('nonexistent')
        expect(result.tag).toBe('ok')
        expect((result as { tag: 'ok'; val: string | undefined }).val).toBeUndefined()
      })

      it('should return all key-value pairs', () => {
        const instance = runtimeConfigImplementation.create({
          values: {
            'key1': 'value1',
            'key2': 'value2',
            'key3': 'value3',
          },
        })

        const imports = instance.getImports()
        const getAll = imports['get-all'] as () => ConfigResult<Array<[string, string]>>

        const result = getAll()
        expect(result.tag).toBe('ok')

        const entries = (result as { tag: 'ok'; val: Array<[string, string]> }).val
        expect(entries).toHaveLength(3)
        expect(entries).toContainEqual(['key1', 'value1'])
        expect(entries).toContainEqual(['key2', 'value2'])
        expect(entries).toContainEqual(['key3', 'value3'])
      })
    })

    describe('Instance with no initial values', () => {
      it('should return empty for get-all', () => {
        const instance = runtimeConfigImplementation.create({})

        const imports = instance.getImports()
        const getAll = imports['get-all'] as () => ConfigResult<Array<[string, string]>>

        const result = getAll()
        expect(result.tag).toBe('ok')
        expect((result as { tag: 'ok'; val: Array<[string, string]> }).val).toHaveLength(0)
      })

      it('should return undefined for any key', () => {
        const instance = runtimeConfigImplementation.create({})

        const imports = instance.getImports()
        const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

        const result = get('any-key')
        expect(result.tag).toBe('ok')
        expect((result as { tag: 'ok'; val: string | undefined }).val).toBeUndefined()
      })
    })

    describe('destroy', () => {
      it('should clean up resources', () => {
        const instance = runtimeConfigImplementation.create({
          values: { key: 'value' },
        })

        instance.destroy()

        // After destroy, getting values should still work but return empty
        // (implementation clears the map on destroy)
        const imports = instance.getImports()
        const getAll = imports['get-all'] as () => ConfigResult<Array<[string, string]>>
        const result = getAll()
        expect(result.tag).toBe('ok')
        expect((result as { tag: 'ok'; val: Array<[string, string]> }).val).toHaveLength(0)
      })
    })
  })

  describe('MutableConfigStore', () => {
    let store: MutableConfigStore

    beforeEach(() => {
      store = new MutableConfigStore()
    })

    describe('constructor', () => {
      it('should create empty store', () => {
        expect(store.size).toBe(0)
      })

      it('should initialize with values', () => {
        const store = new MutableConfigStore({
          'key1': 'value1',
          'key2': 'value2',
        })
        expect(store.size).toBe(2)
      })
    })

    describe('set and get', () => {
      it('should set and get values', () => {
        store.set('database.url', 'postgres://localhost')
        expect(store.get('database.url')).toBe('postgres://localhost')
      })

      it('should return undefined for missing keys', () => {
        expect(store.get('nonexistent')).toBeUndefined()
      })

      it('should overwrite existing values', () => {
        store.set('key', 'value1')
        store.set('key', 'value2')
        expect(store.get('key')).toBe('value2')
      })
    })

    describe('delete', () => {
      it('should delete existing keys', () => {
        store.set('key', 'value')
        expect(store.delete('key')).toBe(true)
        expect(store.get('key')).toBeUndefined()
      })

      it('should return false for non-existing keys', () => {
        expect(store.delete('nonexistent')).toBe(false)
      })
    })

    describe('setAll', () => {
      it('should replace all values', () => {
        store.set('old1', 'value1')
        store.set('old2', 'value2')

        store.setAll({
          'new1': 'newvalue1',
          'new2': 'newvalue2',
        })

        expect(store.get('old1')).toBeUndefined()
        expect(store.get('old2')).toBeUndefined()
        expect(store.get('new1')).toBe('newvalue1')
        expect(store.get('new2')).toBe('newvalue2')
        expect(store.size).toBe(2)
      })
    })

    describe('getAll', () => {
      it('should return all values as Map', () => {
        store.set('key1', 'value1')
        store.set('key2', 'value2')

        const all = store.getAll()
        expect(all).toBeInstanceOf(Map)
        expect(all.size).toBe(2)
        expect(all.get('key1')).toBe('value1')
        expect(all.get('key2')).toBe('value2')
      })
    })

    describe('getImports', () => {
      it('should return WASI-compatible imports', () => {
        store.set('key', 'value')

        const imports = store.getImports()
        expect(imports['get']).toBeDefined()
        expect(imports['get-all']).toBeDefined()

        const get = imports['get'] as (key: string) => ConfigResult<string | undefined>
        const result = get('key')
        expect(result.tag).toBe('ok')
        expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('value')
      })
    })

    describe('size', () => {
      it('should track entry count', () => {
        expect(store.size).toBe(0)
        store.set('key1', 'value1')
        expect(store.size).toBe(1)
        store.set('key2', 'value2')
        expect(store.size).toBe(2)
        store.delete('key1')
        expect(store.size).toBe(1)
      })
    })

    describe('destroy', () => {
      it('should clean up resources', () => {
        store.set('key', 'value')
        store.destroy()
        expect(store.size).toBe(0)
      })
    })
  })

  describe('Plugins', () => {
    describe('configStorePlugin', () => {
      it('should have correct interface', () => {
        expect(configStorePlugin.witInterface).toEqual(CONFIG_STORE_INTERFACE)
      })

      it('should have runtime implementation', () => {
        expect(configStorePlugin.implementations.has('runtime')).toBe(true)
      })

      it('should default to runtime implementation', () => {
        expect(configStorePlugin.defaultImplementation).toBe('runtime')
      })

      it('should create instance', () => {
        const instance = configStorePlugin.create({
          values: { key: 'value' },
        })
        expect(instance).toBeDefined()
      })
    })

    describe('configRuntimePlugin', () => {
      it('should have correct interface', () => {
        expect(configRuntimePlugin.witInterface).toEqual(CONFIG_RUNTIME_INTERFACE)
      })

      it('should have runtime implementation', () => {
        expect(configRuntimePlugin.implementations.has('runtime')).toBe(true)
      })
    })

    describe('configPlugins array', () => {
      it('should contain both plugins', () => {
        expect(configPlugins).toHaveLength(2)
        expect(configPlugins).toContain(configStorePlugin)
        expect(configPlugins).toContain(configRuntimePlugin)
      })
    })
  })

  describe('Integration', () => {
    it('should work end-to-end with component-like usage', () => {
      // Simulate host creating config for a component
      const instance = configStorePlugin.create({
        values: {
          'app.name': 'MyApp',
          'app.version': '1.0.0',
          'feature.dark-mode': 'true',
          'feature.beta': 'false',
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>
      const getAll = imports['get-all'] as () => ConfigResult<Array<[string, string]>>

      // Component reads individual config
      const appName = get('app.name')
      expect(appName.tag).toBe('ok')
      expect((appName as { tag: 'ok'; val: string | undefined }).val).toBe('MyApp')

      // Component checks feature flag
      const darkMode = get('feature.dark-mode')
      expect(darkMode.tag).toBe('ok')
      expect((darkMode as { tag: 'ok'; val: string | undefined }).val).toBe('true')

      // Component reads non-existent config (returns none, not error)
      const missing = get('feature.experimental')
      expect(missing.tag).toBe('ok')
      expect((missing as { tag: 'ok'; val: string | undefined }).val).toBeUndefined()

      // Component lists all config
      const all = getAll()
      expect(all.tag).toBe('ok')
      expect((all as { tag: 'ok'; val: Array<[string, string]> }).val).toHaveLength(4)

      instance.destroy()
    })

    it('should support runtime config updates via MutableConfigStore', () => {
      const store = new MutableConfigStore({
        'feature.flag': 'false',
      })

      const imports = store.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      // Initial state
      let result = get('feature.flag')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('false')

      // Host updates config
      store.set('feature.flag', 'true')

      // Component sees updated value
      result = get('feature.flag')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('true')

      // Host adds new config
      store.set('feature.new', 'enabled')
      result = get('feature.new')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('enabled')

      store.destroy()
    })
  })
})
