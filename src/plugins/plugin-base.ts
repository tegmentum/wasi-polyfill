/**
 * Base plugin abstraction
 */

import type {
  WasiInterface,
  WasiPlugin,
  PluginConfig,
  PluginInstance,
  Implementation,
} from '../core/types.js'
import { ImplementationNotFoundError } from '../util/errors.js'
import { formatInterfaceString } from '../core/types.js'

/**
 * Abstract base class for WASI plugins
 *
 * Provides common functionality for plugin implementations.
 */
export abstract class BasePlugin implements WasiPlugin {
  abstract readonly witInterface: WasiInterface
  abstract readonly implementations: Map<string, Implementation>
  abstract readonly defaultImplementation: string

  create(config: PluginConfig): PluginInstance {
    const implName = config.implementation ?? this.defaultImplementation
    const impl = this.implementations.get(implName)

    if (!impl) {
      throw new ImplementationNotFoundError(
        formatInterfaceString(this.witInterface),
        implName
      )
    }

    return impl.create(config)
  }
}

/**
 * Helper to create a simple plugin from implementations
 */
export function createPlugin(
  witInterface: WasiInterface,
  implementations: Record<string, Implementation>,
  defaultImplementation: string
): WasiPlugin {
  const implMap = new Map(Object.entries(implementations))

  return {
    witInterface,
    implementations: implMap,
    defaultImplementation,
    create(config: PluginConfig): PluginInstance {
      const implName = config.implementation ?? defaultImplementation
      const impl = implMap.get(implName)

      if (!impl) {
        throw new ImplementationNotFoundError(
          formatInterfaceString(witInterface),
          implName
        )
      }

      return impl.create(config)
    },
  }
}
