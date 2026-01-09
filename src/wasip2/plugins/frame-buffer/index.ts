/**
 * wasi:frame-buffer plugin exports
 *
 * @packageDocumentation
 */

export {
  // Types
  type FrameBufferHandle,
  type PixelFormat,
  type FrameBufferDescriptor,
  type BlitDescriptor,
  type FrameBuffer,
  // Constants
  BYTES_PER_PIXEL,
  // Classes
  FrameBufferRegistry,
  // Functions
  getDefaultFrameBufferRegistry,
  rgbaToBgra,
  bgraToRgba,
  rgbToRgba,
} from './types.js'

export {
  // Interface
  FRAME_BUFFER_INTERFACE,
  // Implementations
  browserCanvasImplementation,
  headlessFrameBufferImplementation,
  // Plugin
  frameBufferPlugin,
  frameBufferPlugins,
} from './plugin.js'
