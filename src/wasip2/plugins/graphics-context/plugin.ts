/**
 * wasi:graphics-context plugin
 *
 * Provides the core graphics context interface that connects
 * graphics APIs to surfaces.
 *
 * @packageDocumentation
 */

import type { WasiPlugin, WasiInterface, Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import {
  type ContextHandle,
  type AbstractBufferHandle,
  type AbstractBufferData,
  GraphicsContextRegistry,
  getDefaultRegistry,
} from './types.js'

// =============================================================================
// Interface Definition
// =============================================================================

/**
 * WASI graphics-context interface definition
 */
export const GRAPHICS_CONTEXT_INTERFACE: WasiInterface = {
  package: 'wasi:graphics-context',
  name: 'graphics-context',
  version: '0.0.1',
}

// =============================================================================
// Default Implementation
// =============================================================================

/**
 * Create the default graphics context implementation.
 */
function createDefaultImplementation(registry: GraphicsContextRegistry): Record<string, unknown> {
  return {
    // Context resource
    '[resource-new]context': (): ContextHandle => {
      return registry.createContext()
    },

    '[resource-drop]context': (handle: ContextHandle): void => {
      registry.deleteContext(handle)
    },

    '[method]context.get-current-buffer': (handle: ContextHandle): AbstractBufferHandle => {
      const context = registry.getContext(handle)
      if (!context) {
        throw new Error('Context not found')
      }

      // If no buffer exists, create one
      let bufferHandle = context.currentBuffer
      if (bufferHandle === null) {
        const bufferData: AbstractBufferData = {
          width: context.config.width ?? 800,
          height: context.config.height ?? 600,
          format: context.config.format ?? 'rgba8unorm',
        }
        bufferHandle = registry.createBuffer(bufferData)
        registry.setCurrentBuffer(handle, bufferHandle)
      }

      return bufferHandle
    },

    '[method]context.present': (handle: ContextHandle): void => {
      const context = registry.getContext(handle)
      if (!context) {
        throw new Error('Context not found')
      }

      // Present is a no-op in the default implementation
      // Actual presentation happens when connected to a surface
    },

    // Abstract buffer resource (no methods defined in WIT, just exists as a resource)
    '[resource-drop]abstract-buffer': (handle: AbstractBufferHandle): void => {
      registry.deleteBuffer(handle)
    },
  }
}

/**
 * Default implementation using in-memory buffers.
 */
export const defaultGraphicsContextImplementation: Implementation = {
  name: 'default',
  description: 'In-memory buffer management for graphics contexts',
  create(_config: PluginConfig): PluginInstance {
    const registry = getDefaultRegistry()
    const imports = createDefaultImplementation(registry)

    return {
      getImports(): Record<string, unknown> {
        return {
          'wasi:graphics-context/graphics-context@0.0.1': imports,
        }
      },
      destroy(): void {
        // Registry cleanup handled elsewhere
      },
    }
  },
}

// =============================================================================
// Plugin Export
// =============================================================================

/**
 * wasi:graphics-context/graphics-context plugin
 *
 * Provides the core graphics context for connecting graphics APIs to surfaces.
 *
 * Implementations:
 * - default: In-memory buffer management
 */
export const graphicsContextPlugin: WasiPlugin = createPlugin(
  GRAPHICS_CONTEXT_INTERFACE,
  {
    default: defaultGraphicsContextImplementation,
  },
  'default'
)

/**
 * All graphics context plugins
 */
export const graphicsContextPlugins: WasiPlugin[] = [
  graphicsContextPlugin,
]
