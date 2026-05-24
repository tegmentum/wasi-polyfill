/**
 * Comprehensive integration tests for all plugins
 *
 * These tests verify that all plugins provide correctly structured
 * imports and functional implementations through the polyfill.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDevPolyfill, Polyfill } from '../../src/wasip2/core/polyfill.js'
import { randomPlugin } from '../../src/wasip2/plugins/random/index.js'
import {
  monotonicClockPlugin,
  wallClockPlugin,
} from '../../src/wasip2/plugins/clocks/index.js'
import {
  environmentPlugin,
  stdoutPlugin,
  stderrPlugin,
  stdinPlugin,
  exitPlugin,
} from '../../src/wasip2/plugins/cli/index.js'
import { streamsPlugin, pollPlugin } from '../../src/wasip2/plugins/io/index.js'
import { configRuntimePlugin } from '../../src/wasip2/plugins/config/index.js'
import { loggingPlugin, LOG_LEVEL_VALUES } from '../../src/wasip2/plugins/logging/index.js'
import {
  keyvalueStorePlugin,
  memoryStoreImplementation,
} from '../../src/wasip2/plugins/keyvalue/index.js'
import {
  blobstorePlugin,
  memoryBlobstoreImplementation,
} from '../../src/wasip2/plugins/blobstore/index.js'
import {
  filesystemTypesPlugin,
  filesystemPreopensPlugin,
  memoryFilesystemImplementation,
} from '../../src/wasip2/plugins/filesystem/index.js'
import {
  httpOutgoingHandlerPlugin,
  httpTypesPlugin,
} from '../../src/wasip2/plugins/http/index.js'

describe('All Plugins Integration', () => {
  let polyfill: Polyfill

  beforeEach(() => {
    polyfill = createDevPolyfill()
  })

  afterEach(() => {
    polyfill.destroy()
  })

  describe('Random Plugin', () => {
    beforeEach(() => {
      polyfill.registerPlugin(randomPlugin)
    })

    it('should provide random bytes with correct length', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
      ])

      const getRandomBytes = result.imports['wasi:random@0.2.0'][
        'get-random-bytes'
      ] as (len: bigint) => Uint8Array

      // Test various lengths
      for (const len of [1, 10, 100, 1000]) {
        const bytes = getRandomBytes(BigInt(len))
        expect(bytes).toBeInstanceOf(Uint8Array)
        expect(bytes.length).toBe(len)
      }
    })

    it('should provide random u64 values', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
      ])

      const getRandomU64 = result.imports['wasi:random@0.2.0'][
        'get-random-u64'
      ] as () => bigint

      // Generate multiple values and verify they're bigints
      const values: bigint[] = []
      for (let i = 0; i < 10; i++) {
        const value = getRandomU64()
        expect(typeof value).toBe('bigint')
        expect(value).toBeGreaterThanOrEqual(0n)
        values.push(value)
      }

      // Verify not all values are the same (extremely unlikely)
      const unique = new Set(values.map((v) => v.toString()))
      expect(unique.size).toBeGreaterThan(1)
    })

    it('should provide cryptographically random bytes', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
      ])

      const getRandomBytes = result.imports['wasi:random@0.2.0'][
        'get-random-bytes'
      ] as (len: bigint) => Uint8Array

      // Get two batches of random bytes
      const batch1 = getRandomBytes(32n)
      const batch2 = getRandomBytes(32n)

      // They should be different
      const areEqual = batch1.every((b, i) => b === batch2[i])
      expect(areEqual).toBe(false)
    })
  })

  describe('Clocks Plugin', () => {
    beforeEach(() => {
      polyfill.registerPlugin(monotonicClockPlugin)
      polyfill.registerPlugin(wallClockPlugin)
    })

    it('should provide monotonically increasing time', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
      ])

      const now = result.imports['wasi:clocks/monotonic-clock@0.2.0'][
        'now'
      ] as () => bigint

      const times: bigint[] = []
      for (let i = 0; i < 10; i++) {
        times.push(now())
        // Small delay
        await new Promise((resolve) => setTimeout(resolve, 1))
      }

      // Each time should be >= previous
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!)
      }
    })

    it('should provide wall clock with reasonable time', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:clocks', name: 'wall-clock', version: '0.2.0' },
      ])

      const now = result.imports['wasi:clocks/wall-clock@0.2.0']['now'] as () => {
        seconds: bigint
        nanoseconds: number
      }

      const datetime = now()

      // Time should be after year 2020 and before year 2100
      const year2020 = 1577836800n
      const year2100 = 4102444800n

      expect(datetime.seconds).toBeGreaterThan(year2020)
      expect(datetime.seconds).toBeLessThan(year2100)
      expect(datetime.nanoseconds).toBeGreaterThanOrEqual(0)
      expect(datetime.nanoseconds).toBeLessThan(1_000_000_000)
    })

    it('should provide clock resolution', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
        { package: 'wasi:clocks', name: 'wall-clock', version: '0.2.0' },
      ])

      const monotonicResolution = result.imports['wasi:clocks/monotonic-clock@0.2.0'][
        'resolution'
      ] as () => bigint

      const wallResolution = result.imports['wasi:clocks/wall-clock@0.2.0'][
        'resolution'
      ] as () => { seconds: bigint; nanoseconds: number }

      const monoRes = monotonicResolution()
      expect(typeof monoRes).toBe('bigint')
      expect(monoRes).toBeGreaterThan(0n)

      const wallRes = wallResolution()
      expect(wallRes).toHaveProperty('seconds')
      expect(wallRes).toHaveProperty('nanoseconds')
    })
  })

  describe('CLI Environment Plugin', () => {
    beforeEach(() => {
      polyfill.registerPlugin(environmentPlugin)
    })

    it('should provide environment variables', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
      ])

      const getEnvironment = result.imports['wasi:cli/environment@0.2.0'][
        'get-environment'
      ] as () => [string, string][]

      const env = getEnvironment()
      expect(Array.isArray(env)).toBe(true)

      // Each entry should be a tuple
      for (const entry of env) {
        expect(Array.isArray(entry)).toBe(true)
        expect(entry.length).toBe(2)
        expect(typeof entry[0]).toBe('string')
        expect(typeof entry[1]).toBe('string')
      }
    })

    it('should provide command line arguments', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
      ])

      const getArguments = result.imports['wasi:cli/environment@0.2.0'][
        'get-arguments'
      ] as () => string[]

      const args = getArguments()
      expect(Array.isArray(args)).toBe(true)

      for (const arg of args) {
        expect(typeof arg).toBe('string')
      }
    })
  })

  describe('IO Streams Plugin', () => {
    beforeEach(() => {
      polyfill.registerPlugin(streamsPlugin)
      polyfill.registerPlugin(pollPlugin)
    })

    it('should provide stream resource methods', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:io', name: 'streams', version: '0.2.0' },
        { package: 'wasi:io', name: 'poll', version: '0.2.0' },
      ])

      const streamsImports = result.imports['wasi:io/streams@0.2.0']

      // Check for input stream methods
      expect(typeof streamsImports['[method]input-stream.read']).toBe('function')
      expect(typeof streamsImports['[method]input-stream.blocking-read']).toBe(
        'function'
      )

      // Check for output stream methods
      expect(typeof streamsImports['[method]output-stream.write']).toBe('function')
      expect(typeof streamsImports['[method]output-stream.blocking-write-and-flush']).toBe(
        'function'
      )

      // Check for resource drops
      expect(typeof streamsImports['[resource-drop]input-stream']).toBe('function')
      expect(typeof streamsImports['[resource-drop]output-stream']).toBe('function')
    })

    it('should provide poll interface', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:io', name: 'poll', version: '0.2.0' },
      ])

      const pollImports = result.imports['wasi:io/poll@0.2.0']

      expect(typeof pollImports['poll']).toBe('function')
      expect(typeof pollImports['[resource-drop]pollable']).toBe('function')
    })
  })

  describe('Config Plugin', () => {
    beforeEach(() => {
      polyfill.registerPlugin(configRuntimePlugin, {
        implementation: 'runtime',
        values: {
          'app.name': 'TestApp',
          'app.version': '1.0.0',
          'feature.enabled': 'true',
        },
      })
    })

    it('should provide get function', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:config', name: 'runtime', version: '0.2.0-draft' },
      ])

      const get = result.imports['wasi:config/runtime@0.2.0-draft']['get'] as (
        key: string
      ) => { tag: 'ok'; val: string | undefined } | { tag: 'err'; val: unknown }

      expect(typeof get).toBe('function')

      // Should return ok for any key
      const result1 = get('app.name')
      expect(result1.tag).toBe('ok')

      const result2 = get('nonexistent')
      expect(result2.tag).toBe('ok')
    })

    it('should provide get-all function', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:config', name: 'runtime', version: '0.2.0-draft' },
      ])

      const getAll = result.imports['wasi:config/runtime@0.2.0-draft']['get-all'] as () =>
        | { tag: 'ok'; val: [string, string][] }
        | { tag: 'err'; val: unknown }

      expect(typeof getAll).toBe('function')

      const all = getAll()
      expect(all.tag).toBe('ok')
      if (all.tag === 'ok') {
        expect(Array.isArray(all.val)).toBe(true)
      }
    })
  })

  describe('Logging Plugin', () => {
    beforeEach(() => {
      polyfill.registerPlugin(loggingPlugin, {
        implementation: 'console',
      })
    })

    it('should provide log function', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:logging', name: 'logging', version: '0.1.0-draft' },
      ])

      const log = result.imports['wasi:logging@0.1.0-draft']['log'] as (
        level: number,
        context: string,
        message: string
      ) => void

      expect(typeof log).toBe('function')

      // Log at various levels (using numeric values)
      // These should not throw
      expect(() => log(LOG_LEVEL_VALUES.trace, 'test', 'Trace message')).not.toThrow()
      expect(() => log(LOG_LEVEL_VALUES.debug, 'test', 'Debug message')).not.toThrow()
      expect(() => log(LOG_LEVEL_VALUES.info, 'test', 'Info message')).not.toThrow()
      expect(() => log(LOG_LEVEL_VALUES.warn, 'test', 'Warn message')).not.toThrow()
      expect(() => log(LOG_LEVEL_VALUES.error, 'test', 'Error message')).not.toThrow()
    })

    it('should log messages with different contexts', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:logging', name: 'logging', version: '0.1.0-draft' },
      ])

      const log = result.imports['wasi:logging@0.1.0-draft']['log'] as (
        level: number,
        context: string,
        message: string
      ) => void

      // These should not throw
      expect(() => log(LOG_LEVEL_VALUES.info, 'app.auth', 'User logged in')).not.toThrow()
      expect(() => log(LOG_LEVEL_VALUES.info, 'app.db', 'Query executed')).not.toThrow()
    })
  })

  describe('KeyValue Plugin', () => {
    beforeEach(() => {
      polyfill.registerPlugin(keyvalueStorePlugin, {
        implementation: 'memory',
      })
    })

    it('should provide store open function', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:keyvalue', name: 'store', version: '0.2.0' },
      ])

      const open = result.imports['wasi:keyvalue/store@0.2.0']['open'] as (
        name: string
      ) => { ok: true; value: number } | { ok: false; error: unknown }

      const storeResult = open('test-store')
      expect(storeResult.ok).toBe(true)
      if (storeResult.ok) {
        expect(typeof storeResult.value).toBe('number')
      }
    })

    it('should support basic CRUD operations', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:keyvalue', name: 'store', version: '0.2.0' },
      ])

      const imports = result.imports['wasi:keyvalue/store@0.2.0']
      const open = imports['open'] as (
        name: string
      ) => { ok: true; value: number } | { ok: false; error: unknown }

      const storeResult = open('crud-test')
      expect(storeResult.ok).toBe(true)
      if (!storeResult.ok) return

      const storeId = storeResult.value

      // Get set method
      const set = imports['[method]bucket.set'] as (
        self: number,
        key: string,
        value: Uint8Array
      ) => { ok: true; value: undefined } | { ok: false; error: unknown }

      const get = imports['[method]bucket.get'] as (
        self: number,
        key: string
      ) => { ok: true; value: Uint8Array | undefined } | { ok: false; error: unknown }

      const exists = imports['[method]bucket.exists'] as (
        self: number,
        key: string
      ) => { ok: true; value: boolean } | { ok: false; error: unknown }

      const del = imports['[method]bucket.delete'] as (
        self: number,
        key: string
      ) => { ok: true; value: undefined } | { ok: false; error: unknown }

      // Set a value
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const setResult = set(storeId, 'test-key', encoder.encode('test-value'))
      expect(setResult.ok).toBe(true)

      // Check exists
      const existsResult = exists(storeId, 'test-key')
      expect(existsResult.ok).toBe(true)
      if (existsResult.ok) {
        expect(existsResult.value).toBe(true)
      }

      // Get the value
      const getResult = get(storeId, 'test-key')
      expect(getResult.ok).toBe(true)
      if (getResult.ok && getResult.value) {
        expect(decoder.decode(getResult.value)).toBe('test-value')
      }

      // Delete the value
      const delResult = del(storeId, 'test-key')
      expect(delResult.ok).toBe(true)

      // Verify deleted
      const existsAfter = exists(storeId, 'test-key')
      expect(existsAfter.ok).toBe(true)
      if (existsAfter.ok) {
        expect(existsAfter.value).toBe(false)
      }
    })
  })

  describe('Blobstore Plugin', () => {
    beforeEach(() => {
      polyfill.registerPlugin(blobstorePlugin, {
        implementation: 'memory',
      })
    })

    it('should provide container management functions', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:blobstore', name: 'blobstore', version: '0.2.0-draft' },
      ])

      const imports = result.imports['wasi:blobstore@0.2.0-draft']

      expect(typeof imports['create-container']).toBe('function')
      expect(typeof imports['get-container']).toBe('function')
      expect(typeof imports['delete-container']).toBe('function')
      expect(typeof imports['container-exists']).toBe('function')
    })

    it('should support container operations', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:blobstore', name: 'blobstore', version: '0.2.0-draft' },
      ])

      const imports = result.imports['wasi:blobstore@0.2.0-draft']

      const createContainer = imports['create-container'] as (
        name: string
      ) => { tag: 'ok'; val: number } | { tag: 'err'; val: unknown }

      const containerExists = imports['container-exists'] as (
        name: string
      ) => { tag: 'ok'; val: boolean } | { tag: 'err'; val: unknown }

      const deleteContainer = imports['delete-container'] as (
        name: string
      ) => { tag: 'ok'; val: undefined } | { tag: 'err'; val: unknown }

      // Create container
      const createResult = createContainer('test-container')
      expect(createResult.tag).toBe('ok')

      // Check exists
      const existsResult = containerExists('test-container')
      expect(existsResult.tag).toBe('ok')
      if (existsResult.tag === 'ok') {
        expect(existsResult.val).toBe(true)
      }

      // Delete container
      const deleteResult = deleteContainer('test-container')
      expect(deleteResult.tag).toBe('ok')

      // Verify deleted
      const existsAfter = containerExists('test-container')
      expect(existsAfter.tag).toBe('ok')
      if (existsAfter.tag === 'ok') {
        expect(existsAfter.val).toBe(false)
      }
    })
  })

  describe('Filesystem Plugin', () => {
    beforeEach(() => {
      polyfill.registerPlugin(filesystemTypesPlugin, {
        implementation: 'memory',
      })
      polyfill.registerPlugin(filesystemPreopensPlugin, {
        implementation: 'empty', // Use empty preopens for simplicity
      })
    })

    it('should provide filesystem types', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:filesystem', name: 'types', version: '0.2.0' },
      ])

      const imports = result.imports['wasi:filesystem/types@0.2.0']

      // Check for descriptor methods
      expect(typeof imports['[method]descriptor.read-via-stream']).toBe('function')
      expect(typeof imports['[method]descriptor.write-via-stream']).toBe('function')
      expect(typeof imports['[method]descriptor.stat']).toBe('function')
      expect(typeof imports['[resource-drop]descriptor']).toBe('function')
    })

    it('should provide preopens interface', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:filesystem', name: 'preopens', version: '0.2.0' },
      ])

      const imports = result.imports['wasi:filesystem/preopens@0.2.0']

      const getDirectories = imports['get-directories'] as () => Array<
        [number, string]
      >

      expect(typeof getDirectories).toBe('function')

      // With empty preopens, this should return an empty array
      const directories = getDirectories()
      expect(Array.isArray(directories)).toBe(true)
    })
  })

  describe('HTTP Plugin', () => {
    beforeEach(() => {
      polyfill.registerPlugin(httpTypesPlugin)
      polyfill.registerPlugin(httpOutgoingHandlerPlugin)
    })

    it('should provide outgoing handler interface', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:http', name: 'outgoing-handler', version: '0.2.0' },
      ])

      const imports = result.imports['wasi:http/outgoing-handler@0.2.0']

      expect(typeof imports['handle']).toBe('function')
    })

    it('should provide types interface', async () => {
      const result = await polyfill.getImports([
        { package: 'wasi:http', name: 'types', version: '0.2.0' },
      ])

      const imports = result.imports['wasi:http/types@0.2.0']

      // Check for request/response constructors
      expect(typeof imports['[constructor]outgoing-request']).toBe('function')
      expect(typeof imports['[constructor]fields']).toBe('function')

      // Check for method functions
      expect(typeof imports['[method]outgoing-request.path-with-query']).toBe(
        'function'
      )
      expect(typeof imports['[method]outgoing-request.set-path-with-query']).toBe(
        'function'
      )
    })
  })

  describe('Multiple Plugins Together', () => {
    it('should support all basic plugins simultaneously', async () => {
      polyfill.registerPlugin(randomPlugin)
      polyfill.registerPlugin(monotonicClockPlugin)
      polyfill.registerPlugin(wallClockPlugin)
      polyfill.registerPlugin(environmentPlugin)
      polyfill.registerPlugin(streamsPlugin)
      polyfill.registerPlugin(pollPlugin)

      const result = await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
        { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
        { package: 'wasi:clocks', name: 'wall-clock', version: '0.2.0' },
        { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
        { package: 'wasi:io', name: 'streams', version: '0.2.0' },
        { package: 'wasi:io', name: 'poll', version: '0.2.0' },
      ])

      // All should be loaded
      expect(result.loaded.length).toBe(6)
      expect(result.missing.length).toBe(0)

      // All namespaces should be present
      expect(result.imports['wasi:random@0.2.0']).toBeDefined()
      expect(result.imports['wasi:clocks/monotonic-clock@0.2.0']).toBeDefined()
      expect(result.imports['wasi:clocks/wall-clock@0.2.0']).toBeDefined()
      expect(result.imports['wasi:cli/environment@0.2.0']).toBeDefined()
      expect(result.imports['wasi:io/streams@0.2.0']).toBeDefined()
      expect(result.imports['wasi:io/poll@0.2.0']).toBeDefined()

      // Functions should work
      const getRandomBytes = result.imports['wasi:random@0.2.0'][
        'get-random-bytes'
      ] as (len: bigint) => Uint8Array
      expect(getRandomBytes(16n).length).toBe(16)

      const now = result.imports['wasi:clocks/monotonic-clock@0.2.0'][
        'now'
      ] as () => bigint
      expect(typeof now()).toBe('bigint')
    })

    it('should support forInterfaces with string specs', async () => {
      polyfill.registerPlugin(randomPlugin)
      polyfill.registerPlugin(monotonicClockPlugin)
      polyfill.registerPlugin(environmentPlugin)

      const result = await polyfill.forInterfaces([
        'wasi:random@0.2.0',
        'wasi:clocks/monotonic-clock@0.2.0',
        'wasi:cli/environment@0.2.0',
      ])

      expect(result.loaded.length).toBe(3)
      expect(result.imports['wasi:random@0.2.0']).toBeDefined()
      expect(result.imports['wasi:clocks/monotonic-clock@0.2.0']).toBeDefined()
      expect(result.imports['wasi:cli/environment@0.2.0']).toBeDefined()
    })
  })

  describe('Cross-Plugin Functionality', () => {
    it('should use clocks from logging timestamps', async () => {
      polyfill.registerPlugin(monotonicClockPlugin)
      polyfill.registerPlugin(loggingPlugin, {
        implementation: 'console',
      })

      const result = await polyfill.getImports([
        { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
        { package: 'wasi:logging', name: 'logging', version: '0.1.0-draft' },
      ])

      const now = result.imports['wasi:clocks/monotonic-clock@0.2.0'][
        'now'
      ] as () => bigint
      const log = result.imports['wasi:logging@0.1.0-draft']['log'] as (
        level: number,
        context: string,
        message: string
      ) => void

      const t1 = now()
      expect(() => log(LOG_LEVEL_VALUES.info, 'test', 'Test message')).not.toThrow()
      const t2 = now()

      // Time should have advanced
      expect(t2).toBeGreaterThanOrEqual(t1)
    })

    it('should use random and filesystem together', async () => {
      polyfill.registerPlugin(randomPlugin)
      polyfill.registerPlugin(filesystemTypesPlugin, {
        implementation: 'memory',
      })
      polyfill.registerPlugin(filesystemPreopensPlugin, {
        implementation: 'empty',
      })

      const result = await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
        { package: 'wasi:filesystem', name: 'preopens', version: '0.2.0' },
      ])

      // Generate random filename using random bytes
      const getRandomBytes = result.imports['wasi:random@0.2.0'][
        'get-random-bytes'
      ] as (len: bigint) => Uint8Array

      const randomBytes = getRandomBytes(8n)
      const randomName = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      expect(randomName.length).toBe(16)
      expect(/^[0-9a-f]+$/.test(randomName)).toBe(true)

      // Verify filesystem preopens interface is available
      const getDirectories = result.imports['wasi:filesystem/preopens@0.2.0'][
        'get-directories'
      ] as () => Array<[number, string]>

      expect(typeof getDirectories).toBe('function')
      const dirs = getDirectories()
      expect(Array.isArray(dirs)).toBe(true)
    })
  })

  describe('Resource Lifecycle', () => {
    it('should properly track resource creation and destruction', async () => {
      polyfill.registerPlugin(keyvalueStorePlugin, {
        implementation: 'memory',
      })

      const result = await polyfill.getImports([
        { package: 'wasi:keyvalue', name: 'store', version: '0.2.0' },
      ])

      const imports = result.imports['wasi:keyvalue/store@0.2.0']
      const open = imports['open'] as (
        name: string
      ) => { ok: true; value: number } | { ok: false; error: unknown }

      const drop = imports['[resource-drop]bucket'] as (handle: number) => void

      // Create multiple stores
      const stores: number[] = []
      for (let i = 0; i < 5; i++) {
        const storeResult = open(`store-${i}`)
        expect(storeResult.ok).toBe(true)
        if (storeResult.ok) {
          stores.push(storeResult.value)
        }
      }

      expect(stores.length).toBe(5)

      // Drop all stores
      for (const storeId of stores) {
        expect(() => drop(storeId)).not.toThrow()
      }
    })

    it('should clean up all resources on polyfill destruction', async () => {
      polyfill.registerPlugin(randomPlugin)
      polyfill.registerPlugin(keyvalueStorePlugin, {
        implementation: 'memory',
      })

      const result = await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
        { package: 'wasi:keyvalue', name: 'store', version: '0.2.0' },
      ])

      // Create some resources
      const open = result.imports['wasi:keyvalue/store@0.2.0']['open'] as (
        name: string
      ) => { ok: true; value: number } | { ok: false; error: unknown }

      open('cleanup-test')

      // Destroy polyfill
      expect(() => polyfill.destroy()).not.toThrow()

      // After destruction, getImports should throw
      await expect(
        polyfill.getImports([
          { package: 'wasi:random', name: 'random', version: '0.2.0' },
        ])
      ).rejects.toThrow('destroyed')
    })
  })
})
