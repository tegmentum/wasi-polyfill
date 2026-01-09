/**
 * wasi:graphics-context plugin exports
 *
 * @packageDocumentation
 */

export {
  // Types
  type ContextHandle,
  type AbstractBufferHandle,
  type AbstractBufferData,
  type BufferFormat,
  type GraphicsContextConfig,
  type GraphicsContext,
  // Registry
  GraphicsContextRegistry,
  getDefaultRegistry,
} from './types.js'

export {
  // Interface
  GRAPHICS_CONTEXT_INTERFACE,
  // Implementations
  defaultGraphicsContextImplementation,
  // Plugin
  graphicsContextPlugin,
  graphicsContextPlugins,
} from './plugin.js'
