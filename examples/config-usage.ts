/**
 * Config plugin usage examples for @tegmentum/wasip2-polyfill
 *
 * This example demonstrates how to use the config plugin with
 * different sources: static values, remote URLs, layered configs,
 * manifests, and environment variable bridging.
 */

import { createDevPolyfill, Polyfill } from '@tegmentum/wasip2-polyfill'
import {
  configRuntimePlugin,
  configStorePlugin,
  configPlugins,
  runtimeConfigImplementation,
  remoteConfigImplementation,
  layeredConfigImplementation,
  manifestConfigImplementation,
  envBridgeConfigImplementation,
  fixedConfigImplementation,
  MutableConfigStore,
  createRemoteConfigSource,
  createLayeredConfig,
  createSimpleLayeredConfig,
  ManifestConfigSource,
  createManifestSource,
  EnvBridgeConfigSource,
  createEnvBridgeSource,
  envMapping,
  envPrefix,
  createFixedConfig,
  emptyFixedConfig,
  mergeFixedConfigs,
} from '@tegmentum/wasip2-polyfill/plugins/config'

// ============================================================================
// Example 1: Static Runtime Config
// ============================================================================

async function staticConfigUsage() {
  const polyfill = createDevPolyfill()

  // Register config plugin with static values
  polyfill.registerPlugin(configRuntimePlugin, {
    implementation: 'runtime',
    // Static configuration values
    values: {
      'app.name': 'My Application',
      'app.version': '1.0.0',
      'feature.dark-mode': 'true',
      'api.endpoint': 'https://api.example.com',
      'api.timeout': '30000',
    },
  })

  const result = await polyfill.forInterfaces([
    'wasi:config/runtime@0.2.0-draft',
  ])

  console.log('Static config loaded')

  // Access the config functions
  const imports = result.imports['wasi:config/runtime@0.2.0-draft']
  const get = imports['get'] as (
    key: string
  ) => { tag: 'ok'; val: string } | { tag: 'err'; val: unknown }

  // Get a config value
  const appName = get('app.name')
  if (appName.tag === 'ok') {
    console.log('App name:', appName.val)
  }

  polyfill.destroy()
}

// ============================================================================
// Example 2: Mutable Config Store
// ============================================================================

async function mutableConfigUsage() {
  const polyfill = createDevPolyfill()

  // Create a mutable store that can be updated at runtime
  const store = new MutableConfigStore({
    'debug.enabled': 'false',
    'feature.flags': 'feature-a,feature-b',
  })

  polyfill.registerPlugin(configRuntimePlugin, {
    implementation: 'runtime',
    store,
  })

  const result = await polyfill.forInterfaces([
    'wasi:config/runtime@0.2.0-draft',
  ])

  // Update config at runtime (e.g., from admin panel)
  store.set('debug.enabled', 'true')
  store.set('new.key', 'new-value')

  // Delete a config key
  store.delete('feature.flags')

  // Get all keys
  const keys = store.keys()
  console.log('Config keys:', keys)

  polyfill.destroy()
}

// ============================================================================
// Example 3: Remote Config from URL
// ============================================================================

async function remoteConfigUsage() {
  const polyfill = createDevPolyfill()

  // Create a remote config source
  const remoteSource = createRemoteConfigSource({
    url: 'https://config.example.com/app-config.json',
    format: 'json', // 'json' | 'env' | 'properties'
    // Refresh interval (optional)
    refreshIntervalMs: 60000, // Refresh every minute
    // Authentication (optional)
    headers: {
      Authorization: 'Bearer config-token',
    },
    // Fallback values if remote fails
    fallback: {
      'app.name': 'Default App',
    },
  })

  polyfill.registerPlugin(configRuntimePlugin, {
    implementation: 'remote',
    source: remoteSource,
  })

  const result = await polyfill.forInterfaces([
    'wasi:config/runtime@0.2.0-draft',
  ])

  console.log('Remote config loaded')

  // The config is automatically refreshed in the background
  // Use remoteSource.refresh() to manually trigger a refresh

  polyfill.destroy()
}

// ============================================================================
// Example 4: Layered Config (Multiple Sources)
// ============================================================================

async function layeredConfigUsage() {
  const polyfill = createDevPolyfill()

  // Create a layered config with multiple sources (higher priority last)
  const layeredConfig = createLayeredConfig([
    // Layer 0: Default values (lowest priority)
    {
      name: 'defaults',
      values: {
        'log.level': 'info',
        'cache.enabled': 'true',
        'cache.ttl': '3600',
      },
    },
    // Layer 1: Remote config (medium priority)
    {
      name: 'remote',
      source: createRemoteConfigSource({
        url: 'https://config.example.com/config.json',
      }),
    },
    // Layer 2: Local overrides (highest priority)
    {
      name: 'overrides',
      values: {
        'log.level': 'debug', // Override remote/default
      },
    },
  ])

  polyfill.registerPlugin(configRuntimePlugin, {
    implementation: 'layered',
    config: layeredConfig,
  })

  const result = await polyfill.forInterfaces([
    'wasi:config/runtime@0.2.0-draft',
  ])

  console.log('Layered config loaded')

  // Config resolution order (last wins):
  // 1. defaults
  // 2. remote
  // 3. overrides

  polyfill.destroy()
}

// ============================================================================
// Example 5: Simple Layered Config Helper
// ============================================================================

async function simpleLayeredConfigUsage() {
  const polyfill = createDevPolyfill()

  // Simple helper for common pattern: defaults + remote + overrides
  const layeredConfig = createSimpleLayeredConfig({
    defaults: {
      'app.mode': 'production',
      'api.retries': '3',
    },
    remoteUrl: 'https://config.example.com/config.json',
    overrides: {
      'app.mode': 'development', // Override for local dev
    },
  })

  polyfill.registerPlugin(configRuntimePlugin, {
    implementation: 'layered',
    config: layeredConfig,
  })

  const result = await polyfill.forInterfaces([
    'wasi:config/runtime@0.2.0-draft',
  ])

  console.log('Simple layered config loaded')

  polyfill.destroy()
}

// ============================================================================
// Example 6: Manifest-Based Config (TOML/YAML/JSON)
// ============================================================================

async function manifestConfigUsage() {
  const polyfill = createDevPolyfill()

  // Load config from a manifest file
  const manifestSource = createManifestSource({
    // Can be a URL or inline content
    url: '/config/app-config.toml',
    format: 'toml', // 'json' | 'yaml' | 'toml'
    // Key path to extract (dot-separated)
    rootPath: 'app.settings',
    // Variable interpolation
    interpolation: {
      env: {
        NODE_ENV: 'production',
        API_KEY: 'secret-key',
      },
    },
  })

  polyfill.registerPlugin(configRuntimePlugin, {
    implementation: 'manifest',
    source: manifestSource,
  })

  const result = await polyfill.forInterfaces([
    'wasi:config/runtime@0.2.0-draft',
  ])

  console.log('Manifest config loaded')

  // Example TOML file:
  // [app.settings]
  // name = "My App"
  // version = "1.0.0"
  // api_key = "${API_KEY}"
  // mode = "${NODE_ENV}"

  polyfill.destroy()
}

// ============================================================================
// Example 7: Environment Variable Bridge
// ============================================================================

async function envBridgeConfigUsage() {
  const polyfill = createDevPolyfill()

  // Bridge environment variables to WASI config
  const envSource = createEnvBridgeSource({
    // Explicit mappings: env var -> config key
    mappings: [
      envMapping('DATABASE_URL', 'db.connection-string'),
      envMapping('API_KEY', 'api.key'),
      envMapping('LOG_LEVEL', 'log.level', 'info'), // with default
    ],
    // Prefix-based mappings
    prefixes: [
      envPrefix('APP_', 'app.'), // APP_NAME -> app.name
      envPrefix('FEATURE_', 'feature.'), // FEATURE_DARK_MODE -> feature.dark-mode
    ],
    // Transform function for keys (optional)
    keyTransform: (key) => key.toLowerCase().replace(/_/g, '-'),
  })

  polyfill.registerPlugin(configRuntimePlugin, {
    implementation: 'env-bridge',
    source: envSource,
  })

  const result = await polyfill.forInterfaces([
    'wasi:config/runtime@0.2.0-draft',
  ])

  console.log('Env bridge config loaded')

  // This bridges environment variables to WASI config interface
  // Useful for 12-factor apps and container deployments

  polyfill.destroy()
}

// ============================================================================
// Example 8: Fixed Config (Immutable Snapshot)
// ============================================================================

async function fixedConfigUsage() {
  const polyfill = createDevPolyfill()

  // Create an immutable config snapshot
  const fixedConfig = createFixedConfig({
    'app.name': 'Production App',
    'app.version': '2.0.0',
    'feature.enabled': 'true',
  })

  polyfill.registerPlugin(configRuntimePlugin, {
    implementation: 'fixed',
    config: fixedConfig,
  })

  const result = await polyfill.forInterfaces([
    'wasi:config/runtime@0.2.0-draft',
  ])

  console.log('Fixed config loaded')

  // Merge multiple fixed configs
  const base = createFixedConfig({ 'a': '1', 'b': '2' })
  const overrides = createFixedConfig({ 'b': '3', 'c': '4' })
  const merged = mergeFixedConfigs(base, overrides)
  // Result: { a: '1', b: '3', c: '4' }

  polyfill.destroy()
}

// ============================================================================
// Example 9: Config Store (Key-Value Style)
// ============================================================================

async function configStoreUsage() {
  const polyfill = createDevPolyfill()

  // Register config store plugin (different interface than runtime)
  polyfill.registerPlugin(configStorePlugin, {
    implementation: 'runtime',
    values: {
      'namespace:key1': 'value1',
      'namespace:key2': 'value2',
      'other:key1': 'value3',
    },
  })

  const result = await polyfill.forInterfaces(['wasi:config/store@0.2.0-draft'])

  console.log('Config store loaded')

  // The store interface provides:
  // - open(name: string) -> result<bucket, error>
  // - bucket.get(key: string) -> result<option<string>, error>
  // - bucket.set(key: string, value: string) -> result<_, error>
  // - bucket.delete(key: string) -> result<_, error>
  // - bucket.exists(key: string) -> result<bool, error>
  // - bucket.get-keys() -> result<list<string>, error>

  polyfill.destroy()
}

// ============================================================================
// Example 10: Development vs Production Config
// ============================================================================

async function envSpecificConfigUsage() {
  const isDev = process.env.NODE_ENV !== 'production'

  const polyfill = createDevPolyfill()

  if (isDev) {
    // Development: use local config with verbose logging
    polyfill.registerPlugin(configRuntimePlugin, {
      implementation: 'runtime',
      values: {
        'log.level': 'debug',
        'api.endpoint': 'http://localhost:3000',
        'cache.enabled': 'false',
        'mock.data': 'true',
      },
    })
  } else {
    // Production: use remote config with fallbacks
    const layered = createLayeredConfig([
      {
        name: 'defaults',
        values: {
          'log.level': 'warn',
          'cache.enabled': 'true',
        },
      },
      {
        name: 'remote',
        source: createRemoteConfigSource({
          url: process.env.CONFIG_URL || 'https://config.example.com/prod.json',
        }),
      },
    ])

    polyfill.registerPlugin(configRuntimePlugin, {
      implementation: 'layered',
      config: layered,
    })
  }

  const result = await polyfill.forInterfaces([
    'wasi:config/runtime@0.2.0-draft',
  ])

  console.log('Environment-specific config loaded')

  polyfill.destroy()
}

// Run examples
export {
  staticConfigUsage,
  mutableConfigUsage,
  remoteConfigUsage,
  layeredConfigUsage,
  simpleLayeredConfigUsage,
  manifestConfigUsage,
  envBridgeConfigUsage,
  fixedConfigUsage,
  configStoreUsage,
  envSpecificConfigUsage,
}
