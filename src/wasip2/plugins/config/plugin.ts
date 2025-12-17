/**
 * wasi:config plugin definitions
 *
 * Provides configuration access for WASI components.
 *
 * Interface: wasi:config/store@0.2.0-draft
 *
 * Functions:
 * - get(key: string) -> result<option<string>, error>
 * - get-all() -> result<list<tuple<string, string>>, error>
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { runtimeConfigImplementation } from './impl-runtime.js'

/**
 * WASI config store interface definition
 *
 * Note: The interface is currently at draft status (0.2.0-draft).
 * We use 0.2.0 for compatibility with preview2 components.
 */
export const CONFIG_STORE_INTERFACE: WasiInterface = {
  package: 'wasi:config',
  name: 'store',
  version: '0.2.0-draft',
}

/**
 * Alternative interface name used by some runtimes
 */
export const CONFIG_RUNTIME_INTERFACE: WasiInterface = {
  package: 'wasi:config',
  name: 'runtime',
  version: '0.2.0-draft',
}

/**
 * wasi:config/store plugin
 *
 * Provides read-only access to configuration key-value pairs.
 *
 * Implementations:
 * - runtime: In-memory configuration store (default)
 *
 * Usage:
 * ```typescript
 * const plugin = configStorePlugin.create({
 *   values: {
 *     'database.url': 'postgres://localhost:5432/mydb',
 *     'api.timeout': '30000',
 *     'feature.dark-mode': 'true',
 *   }
 * })
 * ```
 */
export const configStorePlugin: WasiPlugin = createPlugin(
  CONFIG_STORE_INTERFACE,
  {
    runtime: runtimeConfigImplementation,
  },
  'runtime'
)

/**
 * wasi:config/runtime plugin (alias)
 *
 * Some runtimes use 'runtime' instead of 'store' as the interface name.
 * This provides compatibility with those runtimes.
 */
export const configRuntimePlugin: WasiPlugin = createPlugin(
  CONFIG_RUNTIME_INTERFACE,
  {
    runtime: runtimeConfigImplementation,
  },
  'runtime'
)

/**
 * All config plugins for convenient registration
 */
export const configPlugins: WasiPlugin[] = [
  configStorePlugin,
  configRuntimePlugin,
]
