/**
 * Tests for new config provider implementations
 *
 * - layered: Multi-source configuration with priority
 * - manifest: JSON/TOML manifest parsing
 * - env-bridge: Environment variable mapping
 * - fixed: Deterministic configuration for testing
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Layered config
  type ConfigLayer,
  type ConfigPolicy,
  type LayeredConfigPluginConfig,
  layeredConfigImplementation,
  createLayeredConfig,
  createSimpleLayeredConfig,
  // Manifest config
  type ManifestFormat,
  type ManifestSourceOptions,
  type ManifestConfigPluginConfig,
  manifestConfigImplementation,
  parseManifestConfig,
  // Env bridge config
  type EnvVarMapping,
  type EnvPrefixMapping,
  type EnvBridgeConfigPluginConfig,
  envBridgeConfigImplementation,
  envMapping,
  envPrefix,
  // Fixed config
  type ConfigSnapshot,
  type FixedConfigPluginConfig,
  fixedConfigImplementation,
  createFixedConfig,
  loadFixedConfig,
  parseFixedConfig,
  emptyFixedConfig,
  mergeFixedConfigs,
  assertConfigsEqual,
  // Types
  type ConfigResult,
} from '../../src/plugins/config/index.js'

// =============================================================================
// Layered Config Tests
// =============================================================================

describe('Layered Config', () => {
  describe('layeredConfigImplementation', () => {
    it('should have correct metadata', () => {
      expect(layeredConfigImplementation.name).toBe('layered')
      expect(layeredConfigImplementation.description).toContain('Layered')
    })

    it('should throw if no layers provided', () => {
      expect(() => {
        layeredConfigImplementation.create({ layers: [] })
      }).toThrow('at least one layer')
    })

    it('should create instance with layers', () => {
      const instance = layeredConfigImplementation.create({
        layers: [{ name: 'default', values: { key: 'value' } }],
      })
      expect(instance).toBeDefined()
      expect(instance.getImports).toBeDefined()
    })
  })

  describe('Layer Priority', () => {
    it('should apply layers in priority order', () => {
      const instance = createLayeredConfig({
        layers: [
          { name: 'defaults', priority: 0, values: { key: 'default' } },
          { name: 'overrides', priority: 100, values: { key: 'override' } },
        ],
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      const result = get('key')
      expect(result.tag).toBe('ok')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('override')
    })

    it('should use index as default priority', () => {
      const instance = createLayeredConfig({
        layers: [
          { name: 'first', values: { key: 'first' } },
          { name: 'second', values: { key: 'second' } },
          { name: 'third', values: { key: 'third' } },
        ],
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      const result = get('key')
      expect(result.tag).toBe('ok')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('third')
    })

    it('should merge keys from all layers', () => {
      const instance = createLayeredConfig({
        layers: [
          { name: 'layer1', values: { 'key1': 'value1' } },
          { name: 'layer2', values: { 'key2': 'value2' } },
          { name: 'layer3', values: { 'key3': 'value3' } },
        ],
      })

      const imports = instance.getImports()
      const getAll = imports['get-all'] as () => ConfigResult<Array<[string, string]>>

      const result = getAll()
      expect(result.tag).toBe('ok')
      const entries = (result as { tag: 'ok'; val: Array<[string, string]> }).val
      expect(entries).toHaveLength(3)
    })
  })

  describe('Policy Enforcement', () => {
    it('should allow keys matching allowedKeys pattern', () => {
      const instance = createLayeredConfig({
        layers: [
          {
            name: 'config',
            values: {
              'db.host': 'localhost',
              'db.port': '5432',
              'api.key': 'secret',
            },
          },
        ],
        policy: {
          allowedKeys: ['db.*'],
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      // Allowed key
      const dbHost = get('db.host')
      expect(dbHost.tag).toBe('ok')
      expect((dbHost as { tag: 'ok'; val: string | undefined }).val).toBe('localhost')

      // Denied key (not matching pattern)
      const apiKey = get('api.key')
      expect(apiKey.tag).toBe('ok')
      expect((apiKey as { tag: 'ok'; val: string | undefined }).val).toBeUndefined()
    })

    it('should deny keys matching deniedKeys pattern', () => {
      const instance = createLayeredConfig({
        layers: [
          {
            name: 'config',
            values: {
              'db.host': 'localhost',
              'db.password': 'secret',
            },
          },
        ],
        policy: {
          deniedKeys: ['*.password', '*.secret'],
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      // Allowed key
      const dbHost = get('db.host')
      expect((dbHost as { tag: 'ok'; val: string | undefined }).val).toBe('localhost')

      // Denied key
      const dbPassword = get('db.password')
      expect((dbPassword as { tag: 'ok'; val: string | undefined }).val).toBeUndefined()
    })

    it('should return error when throwOnDenied is true', () => {
      const instance = createLayeredConfig({
        layers: [{ name: 'config', values: { 'secret': 'value' } }],
        policy: {
          deniedKeys: ['secret'],
          throwOnDenied: true,
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      const result = get('secret')
      expect(result.tag).toBe('err')
    })

    it('should filter denied keys from get-all', () => {
      const instance = createLayeredConfig({
        layers: [
          {
            name: 'config',
            values: {
              'public.key': 'visible',
              'private.key': 'hidden',
            },
          },
        ],
        policy: {
          deniedKeys: ['private.*'],
        },
      })

      const imports = instance.getImports()
      const getAll = imports['get-all'] as () => ConfigResult<Array<[string, string]>>

      const result = getAll()
      const entries = (result as { tag: 'ok'; val: Array<[string, string]> }).val
      expect(entries).toHaveLength(1)
      expect(entries[0]).toEqual(['public.key', 'visible'])
    })
  })

  describe('Layer Management', () => {
    it('should add layer at runtime', () => {
      const instance = createLayeredConfig({
        layers: [{ name: 'initial', values: { key: 'initial' } }],
      })

      instance.addLayer({ name: 'added', priority: 100, values: { key: 'added' } })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      const result = get('key')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('added')
    })

    it('should remove layer by name', () => {
      const instance = createLayeredConfig({
        layers: [
          { name: 'base', values: { key: 'base' } },
          { name: 'override', priority: 100, values: { key: 'override' } },
        ],
      })

      const removed = instance.removeLayer('override')
      expect(removed).toBe(true)

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      const result = get('key')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('base')
    })

    it('should return false when removing non-existent layer', () => {
      const instance = createLayeredConfig({
        layers: [{ name: 'base', values: {} }],
      })

      const removed = instance.removeLayer('nonexistent')
      expect(removed).toBe(false)
    })

    it('should set and clear overrides', () => {
      const instance = createLayeredConfig({
        layers: [{ name: 'base', values: { key: 'base' } }],
      })

      instance.setOverrides({ key: 'override' })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      let result = get('key')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('override')

      instance.clearOverrides()

      result = get('key')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('base')
    })
  })

  describe('createSimpleLayeredConfig', () => {
    it('should create config with defaults only', () => {
      const instance = createSimpleLayeredConfig({ key: 'default' })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      const result = get('key')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('default')
    })

    it('should create config with defaults and overrides', () => {
      const instance = createSimpleLayeredConfig(
        { key: 'default', other: 'value' },
        { key: 'override' }
      )

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('key') as { tag: 'ok'; val: string | undefined }).val).toBe('override')
      expect((get('other') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
    })
  })
})

// =============================================================================
// Manifest Config Tests
// =============================================================================

describe('Manifest Config', () => {
  describe('manifestConfigImplementation', () => {
    it('should have correct metadata', () => {
      expect(manifestConfigImplementation.name).toBe('manifest')
      expect(manifestConfigImplementation.description).toContain('manifest')
    })

    it('should throw if no manifests provided', () => {
      expect(() => {
        manifestConfigImplementation.create({} as ManifestConfigPluginConfig)
      }).toThrow('manifest source')
    })
  })

  describe('JSON Manifest Parsing', () => {
    it('should parse JSON object manifest', () => {
      const instance = manifestConfigImplementation.create({
        manifests: {
          content: { 'key': 'value', 'nested': { 'key': 'nested-value' } },
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('key') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
      expect((get('nested.key') as { tag: 'ok'; val: string | undefined }).val).toBe('nested-value')
    })

    it('should parse JSON string manifest', () => {
      const instance = manifestConfigImplementation.create({
        manifests: {
          content: '{"key": "value", "number": 42, "bool": true}',
          format: 'json',
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('key') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
      expect((get('number') as { tag: 'ok'; val: string | undefined }).val).toBe('42')
      expect((get('bool') as { tag: 'ok'; val: string | undefined }).val).toBe('true')
    })

    it('should flatten nested objects', () => {
      const instance = manifestConfigImplementation.create({
        manifests: {
          content: {
            database: {
              host: 'localhost',
              port: 5432,
              credentials: {
                user: 'admin',
                password: 'secret',
              },
            },
          },
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('database.host') as { tag: 'ok'; val: string | undefined }).val).toBe('localhost')
      expect((get('database.port') as { tag: 'ok'; val: string | undefined }).val).toBe('5432')
      expect((get('database.credentials.user') as { tag: 'ok'; val: string | undefined }).val).toBe('admin')
    })

    it('should serialize arrays as JSON', () => {
      const instance = manifestConfigImplementation.create({
        manifests: {
          content: { tags: ['a', 'b', 'c'] },
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      const result = (get('tags') as { tag: 'ok'; val: string | undefined }).val
      expect(JSON.parse(result!)).toEqual(['a', 'b', 'c'])
    })
  })

  describe('TOML Manifest Parsing', () => {
    it('should parse simple TOML', () => {
      const toml = `
key = "value"
number = 42
bool = true
`
      const instance = manifestConfigImplementation.create({
        manifests: { content: toml, format: 'toml' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('key') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
      expect((get('number') as { tag: 'ok'; val: string | undefined }).val).toBe('42')
      expect((get('bool') as { tag: 'ok'; val: string | undefined }).val).toBe('true')
    })

    it('should parse TOML sections', () => {
      const toml = `
[database]
host = "localhost"
port = 5432

[database.credentials]
user = "admin"
`
      const instance = manifestConfigImplementation.create({
        manifests: { content: toml, format: 'toml' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('database.host') as { tag: 'ok'; val: string | undefined }).val).toBe('localhost')
      expect((get('database.port') as { tag: 'ok'; val: string | undefined }).val).toBe('5432')
      expect((get('database.credentials.user') as { tag: 'ok'; val: string | undefined }).val).toBe('admin')
    })

    it('should auto-detect TOML format', () => {
      const toml = `
[section]
key = "value"
`
      const instance = manifestConfigImplementation.create({
        manifests: { content: toml, format: 'auto' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('section.key') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
    })
  })

  describe('Key Prefix', () => {
    it('should add key prefix to all keys', () => {
      const instance = manifestConfigImplementation.create({
        manifests: {
          content: { key: 'value' },
          keyPrefix: 'app',
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('key') as { tag: 'ok'; val: string | undefined }).val).toBeUndefined()
      expect((get('app.key') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
    })
  })

  describe('Custom Key Separator', () => {
    it('should use custom separator for flattening', () => {
      const instance = manifestConfigImplementation.create({
        manifests: {
          content: { nested: { key: 'value' } },
          keySeparator: '/',
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('nested/key') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
    })
  })

  describe('Environment Variable Interpolation', () => {
    it('should interpolate env vars when enabled', () => {
      const instance = manifestConfigImplementation.create({
        manifests: {
          content: { url: 'https://${HOST}:${PORT}' },
        },
        interpolation: {
          enabled: true,
          env: { HOST: 'localhost', PORT: '8080' },
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('url') as { tag: 'ok'; val: string | undefined }).val).toBe('https://localhost:8080')
    })

    it('should use default value for missing env vars', () => {
      const instance = manifestConfigImplementation.create({
        manifests: {
          content: { key: '${MISSING}' },
        },
        interpolation: {
          enabled: true,
          env: {},
          defaultValue: 'fallback',
        },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('key') as { tag: 'ok'; val: string | undefined }).val).toBe('fallback')
    })
  })

  describe('Multiple Manifests', () => {
    it('should merge multiple manifests', () => {
      const instance = manifestConfigImplementation.create({
        manifests: [
          { content: { key1: 'value1' } },
          { content: { key2: 'value2' } },
        ],
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('key1') as { tag: 'ok'; val: string | undefined }).val).toBe('value1')
      expect((get('key2') as { tag: 'ok'; val: string | undefined }).val).toBe('value2')
    })

    it('should override keys from later manifests', () => {
      const instance = manifestConfigImplementation.create({
        manifests: [
          { content: { key: 'first' } },
          { content: { key: 'second' } },
        ],
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('key') as { tag: 'ok'; val: string | undefined }).val).toBe('second')
    })
  })

  describe('parseManifestConfig helper', () => {
    it('should parse manifest to Map', () => {
      const result = parseManifestConfig('{"key": "value", "nested": {"key": "nested"}}')
      expect(result.get('key')).toBe('value')
      expect(result.get('nested.key')).toBe('nested')
    })
  })
})

// =============================================================================
// Env Bridge Config Tests
// =============================================================================

describe('Env Bridge Config', () => {
  describe('envBridgeConfigImplementation', () => {
    it('should have correct metadata', () => {
      expect(envBridgeConfigImplementation.name).toBe('env-bridge')
      expect(envBridgeConfigImplementation.description).toContain('environment')
    })

    it('should throw if no mappings or prefixes provided', () => {
      expect(() => {
        envBridgeConfigImplementation.create({})
      }).toThrow('mappings or prefixes')
    })
  })

  describe('Explicit Mappings', () => {
    it('should map env var to config key', () => {
      const instance = envBridgeConfigImplementation.create({
        mappings: [{ envVar: 'DATABASE_URL', configKey: 'db.url' }],
        env: { DATABASE_URL: 'postgres://localhost' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('db.url') as { tag: 'ok'; val: string | undefined }).val).toBe('postgres://localhost')
    })

    it('should use env var name as config key if not specified', () => {
      const instance = envBridgeConfigImplementation.create({
        mappings: [{ envVar: 'API_KEY' }],
        env: { API_KEY: 'secret123' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('API_KEY') as { tag: 'ok'; val: string | undefined }).val).toBe('secret123')
    })

    it('should use default value if env var not set', () => {
      const instance = envBridgeConfigImplementation.create({
        mappings: [{ envVar: 'MISSING', configKey: 'key', default: 'fallback' }],
        env: {},
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('key') as { tag: 'ok'; val: string | undefined }).val).toBe('fallback')
    })

    it('should apply transform function', () => {
      const instance = envBridgeConfigImplementation.create({
        mappings: [{
          envVar: 'PORT',
          configKey: 'port',
          transform: (v) => `http://localhost:${v}`,
        }],
        env: { PORT: '8080' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('port') as { tag: 'ok'; val: string | undefined }).val).toBe('http://localhost:8080')
    })
  })

  describe('Prefix-based Mappings', () => {
    it('should discover env vars by prefix', () => {
      const instance = envBridgeConfigImplementation.create({
        prefixes: [{ prefix: 'APP_' }],
        env: {
          APP_HOST: 'localhost',
          APP_PORT: '8080',
          OTHER_KEY: 'ignored',
        },
      })

      const imports = instance.getImports()
      const getAll = imports['get-all'] as () => ConfigResult<Array<[string, string]>>

      const result = getAll()
      const entries = (result as { tag: 'ok'; val: Array<[string, string]> }).val
      expect(entries).toHaveLength(2)
      expect(entries.find(([k]) => k === 'HOST')).toBeDefined()
      expect(entries.find(([k]) => k === 'PORT')).toBeDefined()
    })

    it('should strip prefix by default', () => {
      const instance = envBridgeConfigImplementation.create({
        prefixes: [{ prefix: 'MY_APP_' }],
        env: { MY_APP_KEY: 'value' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('KEY') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
      expect((get('MY_APP_KEY') as { tag: 'ok'; val: string | undefined }).val).toBeUndefined()
    })

    it('should keep prefix when stripPrefix is false', () => {
      const instance = envBridgeConfigImplementation.create({
        prefixes: [{ prefix: 'MY_', stripPrefix: false }],
        env: { MY_KEY: 'value' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('MY_KEY') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
    })

    it('should apply key transformation', () => {
      const instance = envBridgeConfigImplementation.create({
        prefixes: [{ prefix: 'APP_', keyTransform: 'lowercase' }],
        env: { APP_DATABASE_URL: 'postgres://localhost' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('database_url') as { tag: 'ok'; val: string | undefined }).val).toBe('postgres://localhost')
    })

    it('should transform to camelCase', () => {
      const instance = envBridgeConfigImplementation.create({
        prefixes: [{ prefix: 'APP_', keyTransform: 'camelCase' }],
        env: { APP_DATABASE_URL: 'value' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('databaseUrl') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
    })

    it('should add config prefix', () => {
      const instance = envBridgeConfigImplementation.create({
        prefixes: [{ prefix: 'APP_', configPrefix: 'config.' }],
        env: { APP_KEY: 'value' },
      })

      const imports = instance.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      expect((get('config.KEY') as { tag: 'ok'; val: string | undefined }).val).toBe('value')
    })

    it('should exclude specific env vars', () => {
      const instance = envBridgeConfigImplementation.create({
        prefixes: [{
          prefix: 'APP_',
          exclude: ['APP_SECRET'],
        }],
        env: {
          APP_KEY: 'value',
          APP_SECRET: 'hidden',
        },
      })

      const imports = instance.getImports()
      const getAll = imports['get-all'] as () => ConfigResult<Array<[string, string]>>

      const result = getAll()
      const entries = (result as { tag: 'ok'; val: Array<[string, string]> }).val
      expect(entries).toHaveLength(1)
      expect(entries[0]![0]).toBe('KEY')
    })
  })

  describe('Helper Functions', () => {
    it('envMapping should create mapping object', () => {
      const mapping = envMapping('DATABASE_URL', 'db.url', 'default')
      expect(mapping.envVar).toBe('DATABASE_URL')
      expect(mapping.configKey).toBe('db.url')
      expect(mapping.default).toBe('default')
    })

    it('envPrefix should create prefix mapping', () => {
      const prefix = envPrefix('APP_', { keyTransform: 'lowercase' })
      expect(prefix.prefix).toBe('APP_')
      expect(prefix.keyTransform).toBe('lowercase')
    })
  })
})

// =============================================================================
// Fixed Config Tests
// =============================================================================

describe('Fixed Config', () => {
  describe('fixedConfigImplementation', () => {
    it('should have correct metadata', () => {
      expect(fixedConfigImplementation.name).toBe('fixed')
      expect(fixedConfigImplementation.description).toContain('Immutable')
    })

    it('should create instance with values', () => {
      const instance = fixedConfigImplementation.create({
        values: { key: 'value' },
      })
      expect(instance).toBeDefined()
    })
  })

  describe('createFixedConfig', () => {
    it('should create from record', () => {
      const config = createFixedConfig({ key1: 'value1', key2: 'value2' })
      expect(config.size).toBe(2)
    })

    it('should create from entries array', () => {
      const config = createFixedConfig([['key1', 'value1'], ['key2', 'value2']])
      expect(config.size).toBe(2)
    })

    it('should set name', () => {
      const config = createFixedConfig({ key: 'value' }, 'test-config')
      const snapshot = config.toSnapshot()
      expect(snapshot.name).toBe('test-config')
    })
  })

  describe('Value Access', () => {
    it('should get individual values', () => {
      const config = createFixedConfig({ key: 'value' })
      const imports = config.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      const result = get('key')
      expect(result.tag).toBe('ok')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBe('value')
    })

    it('should return undefined for missing keys', () => {
      const config = createFixedConfig({ key: 'value' })
      const imports = config.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>

      const result = get('missing')
      expect(result.tag).toBe('ok')
      expect((result as { tag: 'ok'; val: string | undefined }).val).toBeUndefined()
    })

    it('should get all values in sorted order', () => {
      const config = createFixedConfig({ c: '3', a: '1', b: '2' })
      const imports = config.getImports()
      const getAll = imports['get-all'] as () => ConfigResult<Array<[string, string]>>

      const result = getAll()
      const entries = (result as { tag: 'ok'; val: Array<[string, string]> }).val
      expect(entries.map(([k]) => k)).toEqual(['a', 'b', 'c'])
    })

    it('should check key existence', () => {
      const config = createFixedConfig({ key: 'value' })
      expect(config.has('key')).toBe(true)
      expect(config.has('missing')).toBe(false)
    })

    it('should return sorted keys', () => {
      const config = createFixedConfig({ z: '1', a: '2', m: '3' })
      expect(config.keys()).toEqual(['a', 'm', 'z'])
    })
  })

  describe('Snapshot Serialization', () => {
    it('should export to snapshot', () => {
      const config = createFixedConfig({ key: 'value' }, 'test')
      const snapshot = config.toSnapshot()

      expect(snapshot.version).toBe(1)
      expect(snapshot.name).toBe('test')
      expect(snapshot.entries).toContainEqual(['key', 'value'])
      expect(snapshot.createdAt).toBeDefined()
    })

    it('should include metadata in snapshot', () => {
      const config = createFixedConfig({ key: 'value' })
      const snapshot = config.toSnapshot({ environment: 'test' })

      expect(snapshot.metadata).toEqual({ environment: 'test' })
    })

    it('should export to JSON', () => {
      const config = createFixedConfig({ key: 'value' })
      const json = config.toJSON()

      expect(() => JSON.parse(json)).not.toThrow()
      const parsed = JSON.parse(json)
      expect(parsed.version).toBe(1)
    })
  })

  describe('loadFixedConfig', () => {
    it('should load from snapshot', () => {
      const original = createFixedConfig({ key: 'value' }, 'test')
      const snapshot = original.toSnapshot()

      const loaded = loadFixedConfig(snapshot)
      expect(loaded.has('key')).toBe(true)
      expect(loaded.size).toBe(1)
    })

    it('should throw on unsupported version', () => {
      const invalidSnapshot = {
        version: 99 as const,
        entries: [],
      }

      expect(() => {
        loadFixedConfig(invalidSnapshot as unknown as ConfigSnapshot)
      }).toThrow('Unsupported snapshot version')
    })
  })

  describe('parseFixedConfig', () => {
    it('should parse JSON snapshot', () => {
      const original = createFixedConfig({ key: 'value' })
      const json = original.toJSON()

      const loaded = parseFixedConfig(json)
      expect(loaded.has('key')).toBe(true)
    })
  })

  describe('emptyFixedConfig', () => {
    it('should create empty config', () => {
      const config = emptyFixedConfig()
      expect(config.size).toBe(0)
    })

    it('should accept name', () => {
      const config = emptyFixedConfig('empty-test')
      const snapshot = config.toSnapshot()
      expect(snapshot.name).toBe('empty-test')
    })
  })

  describe('Comparison and Diff', () => {
    it('should compare equal configs', () => {
      const config1 = createFixedConfig({ a: '1', b: '2' })
      const config2 = createFixedConfig({ a: '1', b: '2' })

      expect(config1.equals(config2)).toBe(true)
    })

    it('should detect unequal configs', () => {
      const config1 = createFixedConfig({ a: '1' })
      const config2 = createFixedConfig({ a: '2' })

      expect(config1.equals(config2)).toBe(false)
    })

    it('should detect size difference', () => {
      const config1 = createFixedConfig({ a: '1' })
      const config2 = createFixedConfig({ a: '1', b: '2' })

      expect(config1.equals(config2)).toBe(false)
    })

    it('should compute diff', () => {
      const config1 = createFixedConfig({ a: '1', b: '2', c: '3' })
      const config2 = createFixedConfig({ a: '1', b: '99', d: '4' })

      const diff = config1.diff(config2)

      expect(diff.added).toContainEqual(['d', '4'])
      expect(diff.removed).toContainEqual(['c', '3'])
      expect(diff.changed).toContainEqual(['b', { from: '2', to: '99' }])
    })
  })

  describe('mergeFixedConfigs', () => {
    it('should merge multiple configs', () => {
      const config1 = createFixedConfig({ a: '1' })
      const config2 = createFixedConfig({ b: '2' })
      const config3 = createFixedConfig({ c: '3' })

      const merged = mergeFixedConfigs(config1, config2, config3)

      expect(merged.size).toBe(3)
      expect(merged.has('a')).toBe(true)
      expect(merged.has('b')).toBe(true)
      expect(merged.has('c')).toBe(true)
    })

    it('should override values from later configs', () => {
      const config1 = createFixedConfig({ key: 'first' })
      const config2 = createFixedConfig({ key: 'second' })

      const merged = mergeFixedConfigs(config1, config2)

      const imports = merged.getImports()
      const get = imports['get'] as (key: string) => ConfigResult<string | undefined>
      expect((get('key') as { tag: 'ok'; val: string | undefined }).val).toBe('second')
    })
  })

  describe('assertConfigsEqual', () => {
    it('should not throw for equal configs', () => {
      const config1 = createFixedConfig({ a: '1' })
      const config2 = createFixedConfig({ a: '1' })

      expect(() => assertConfigsEqual(config1, config2)).not.toThrow()
    })

    it('should throw for unequal configs with details', () => {
      const config1 = createFixedConfig({ a: '1', b: '2' })
      const config2 = createFixedConfig({ a: '99', c: '3' })

      expect(() => assertConfigsEqual(config1, config2)).toThrow('Config mismatch')
    })
  })
})
