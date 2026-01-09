/**
 * wasi:frame-buffer plugin
 *
 * Provides software rendering via frame buffers with optional
 * browser:canvas acceleration for display.
 *
 * @packageDocumentation
 */

import type { WasiPlugin, WasiInterface, Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import {
  type FrameBufferHandle,
  type FrameBufferDescriptor,
  type BlitDescriptor,
  type PixelFormat,
  FrameBufferRegistry,
  getDefaultFrameBufferRegistry,
  BYTES_PER_PIXEL,
  rgbToRgba,
  bgraToRgba,
} from './types.js'
import { getDefaultRegistry as getGraphicsContextRegistry } from '../graphics-context/types.js'

// =============================================================================
// Interface Definition
// =============================================================================

/**
 * WASI frame-buffer interface definition
 */
export const FRAME_BUFFER_INTERFACE: WasiInterface = {
  package: 'wasi:frame-buffer',
  name: 'frame-buffer',
  version: '0.0.1',
}

// =============================================================================
// Browser Canvas Implementation
// =============================================================================

/**
 * Create browser canvas-based frame buffer implementation.
 * Uses HTML Canvas 2D API for rendering and display.
 */
function createBrowserCanvasImplementation(
  registry: FrameBufferRegistry
): Record<string, unknown> {
  return {
    // Frame buffer resource
    '[resource-new]frame-buffer': (descriptor: FrameBufferDescriptor): FrameBufferHandle => {
      const handle = registry.createBuffer(descriptor)
      const buffer = registry.getBuffer(handle)!

      // Create canvas for browser display
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas')
        canvas.width = buffer.width
        canvas.height = buffer.height
        canvas.style.display = 'block'
        buffer.canvas = canvas

        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          buffer.context = ctx
          buffer.imageData = ctx.createImageData(buffer.width, buffer.height)
        }
      } else if (typeof OffscreenCanvas !== 'undefined') {
        // Use OffscreenCanvas in workers
        const canvas = new OffscreenCanvas(buffer.width, buffer.height)
        buffer.canvas = canvas
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          buffer.context = ctx as OffscreenCanvasRenderingContext2D
          buffer.imageData = ctx.createImageData(buffer.width, buffer.height)
        }
      }

      return handle
    },

    '[resource-drop]frame-buffer': (handle: FrameBufferHandle): void => {
      registry.deleteBuffer(handle)
    },

    '[method]frame-buffer.width': (handle: FrameBufferHandle): number => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')
      return buffer.width
    },

    '[method]frame-buffer.height': (handle: FrameBufferHandle): number => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')
      return buffer.height
    },

    '[method]frame-buffer.format': (handle: FrameBufferHandle): PixelFormat => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')
      return buffer.format
    },

    '[method]frame-buffer.get-pixel': (
      handle: FrameBufferHandle,
      x: number,
      y: number
    ): Uint8Array | null => {
      return registry.getPixel(handle, x, y)
    },

    '[method]frame-buffer.set-pixel': (
      handle: FrameBufferHandle,
      x: number,
      y: number,
      color: Uint8Array
    ): void => {
      registry.setPixel(handle, x, y, color)
    },

    '[method]frame-buffer.fill-rect': (
      handle: FrameBufferHandle,
      x: number,
      y: number,
      width: number,
      height: number,
      color: Uint8Array
    ): void => {
      registry.fillRect(handle, x, y, width, height, color)
    },

    '[method]frame-buffer.blit': (
      handle: FrameBufferHandle,
      srcX: number,
      srcY: number,
      dstX: number,
      dstY: number,
      width: number,
      height: number
    ): void => {
      registry.blit(handle, { srcX, srcY, dstX, dstY, width, height })
    },

    '[method]frame-buffer.copy-from': (
      handle: FrameBufferHandle,
      srcHandle: FrameBufferHandle,
      desc?: BlitDescriptor
    ): void => {
      registry.copyBuffer(srcHandle, handle, desc)
    },

    '[method]frame-buffer.clear': (
      handle: FrameBufferHandle,
      color?: Uint8Array
    ): void => {
      registry.clear(handle, color)
    },

    '[method]frame-buffer.get-data': (handle: FrameBufferHandle): Uint8Array | null => {
      return registry.getData(handle)
    },

    '[method]frame-buffer.set-data': (
      handle: FrameBufferHandle,
      data: Uint8Array
    ): void => {
      registry.setData(handle, data)
    },

    '[method]frame-buffer.present': (handle: FrameBufferHandle): void => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')

      if (!buffer.dirty) return

      // Update canvas with buffer data
      if (buffer.context && buffer.imageData) {
        // Convert frame buffer data to RGBA for canvas
        let rgbaData: Uint8Array

        switch (buffer.format) {
          case 'bgra8':
            rgbaData = bgraToRgba(buffer.data)
            break
          case 'rgb8':
            rgbaData = rgbToRgba(buffer.data)
            break
          case 'rgba8':
          default:
            rgbaData = buffer.data
            break
        }

        buffer.imageData.data.set(rgbaData)
        buffer.context.putImageData(buffer.imageData, 0, 0)
        buffer.dirty = false
      }
    },

    '[method]frame-buffer.get-canvas': (handle: FrameBufferHandle): unknown => {
      const buffer = registry.getBuffer(handle)
      return buffer?.canvas ?? null
    },

    // Convert to abstract buffer for graphics context
    '[method]frame-buffer.to-abstract-buffer': (handle: FrameBufferHandle): number => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')

      const graphicsRegistry = getGraphicsContextRegistry()
      const bufferData: {
        width: number
        height: number
        format: 'rgba8unorm' | 'bgra8unorm'
        data: Uint8Array
        canvasContext?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
      } = {
        width: buffer.width,
        height: buffer.height,
        format: buffer.format === 'bgra8' ? 'bgra8unorm' : 'rgba8unorm',
        data: buffer.data,
      }
      if (buffer.context) {
        bufferData.canvasContext = buffer.context
      }
      return graphicsRegistry.createBuffer(bufferData)
    },

    // Create from abstract buffer
    'from-abstract-buffer': (
      abstractHandle: number,
      format?: PixelFormat
    ): FrameBufferHandle => {
      const graphicsRegistry = getGraphicsContextRegistry()
      const abstractBuffer = graphicsRegistry.getBuffer(abstractHandle)
      if (!abstractBuffer) throw new Error('Abstract buffer not found')

      const desc: FrameBufferDescriptor = {
        width: abstractBuffer.width,
        height: abstractBuffer.height,
        format: format ?? 'rgba8',
      }
      if (abstractBuffer.data instanceof Uint8Array) {
        desc.data = abstractBuffer.data
      } else if (abstractBuffer.data) {
        desc.data = new Uint8Array(abstractBuffer.data)
      }
      return registry.createBuffer(desc)
    },

    // Resize buffer
    '[method]frame-buffer.resize': (
      handle: FrameBufferHandle,
      width: number,
      height: number
    ): void => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')

      const bytesPerPixel = BYTES_PER_PIXEL[buffer.format]
      const newData = new Uint8Array(width * height * bytesPerPixel)

      // Copy existing data with proper clipping
      const copyWidth = Math.min(buffer.width, width)
      const copyHeight = Math.min(buffer.height, height)

      for (let y = 0; y < copyHeight; y++) {
        const srcOffset = y * buffer.width * bytesPerPixel
        const dstOffset = y * width * bytesPerPixel
        newData.set(
          buffer.data.slice(srcOffset, srcOffset + copyWidth * bytesPerPixel),
          dstOffset
        )
      }

      buffer.width = width
      buffer.height = height
      buffer.data = newData
      buffer.dirty = true

      // Resize canvas if present
      if (buffer.canvas) {
        buffer.canvas.width = width
        buffer.canvas.height = height
        if (buffer.context) {
          buffer.imageData = buffer.context.createImageData(width, height)
        }
      }
    },
  }
}

// =============================================================================
// Headless Implementation
// =============================================================================

/**
 * Create headless frame buffer implementation.
 * Pure in-memory buffers without canvas display.
 */
function createHeadlessImplementation(
  registry: FrameBufferRegistry
): Record<string, unknown> {
  return {
    // Frame buffer resource
    '[resource-new]frame-buffer': (descriptor: FrameBufferDescriptor): FrameBufferHandle => {
      return registry.createBuffer(descriptor)
    },

    '[resource-drop]frame-buffer': (handle: FrameBufferHandle): void => {
      registry.deleteBuffer(handle)
    },

    '[method]frame-buffer.width': (handle: FrameBufferHandle): number => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')
      return buffer.width
    },

    '[method]frame-buffer.height': (handle: FrameBufferHandle): number => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')
      return buffer.height
    },

    '[method]frame-buffer.format': (handle: FrameBufferHandle): PixelFormat => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')
      return buffer.format
    },

    '[method]frame-buffer.get-pixel': (
      handle: FrameBufferHandle,
      x: number,
      y: number
    ): Uint8Array | null => {
      return registry.getPixel(handle, x, y)
    },

    '[method]frame-buffer.set-pixel': (
      handle: FrameBufferHandle,
      x: number,
      y: number,
      color: Uint8Array
    ): void => {
      registry.setPixel(handle, x, y, color)
    },

    '[method]frame-buffer.fill-rect': (
      handle: FrameBufferHandle,
      x: number,
      y: number,
      width: number,
      height: number,
      color: Uint8Array
    ): void => {
      registry.fillRect(handle, x, y, width, height, color)
    },

    '[method]frame-buffer.blit': (
      handle: FrameBufferHandle,
      srcX: number,
      srcY: number,
      dstX: number,
      dstY: number,
      width: number,
      height: number
    ): void => {
      registry.blit(handle, { srcX, srcY, dstX, dstY, width, height })
    },

    '[method]frame-buffer.copy-from': (
      handle: FrameBufferHandle,
      srcHandle: FrameBufferHandle,
      desc?: BlitDescriptor
    ): void => {
      registry.copyBuffer(srcHandle, handle, desc)
    },

    '[method]frame-buffer.clear': (
      handle: FrameBufferHandle,
      color?: Uint8Array
    ): void => {
      registry.clear(handle, color)
    },

    '[method]frame-buffer.get-data': (handle: FrameBufferHandle): Uint8Array | null => {
      return registry.getData(handle)
    },

    '[method]frame-buffer.set-data': (
      handle: FrameBufferHandle,
      data: Uint8Array
    ): void => {
      registry.setData(handle, data)
    },

    '[method]frame-buffer.present': (_handle: FrameBufferHandle): void => {
      // No-op in headless mode
    },

    '[method]frame-buffer.get-canvas': (_handle: FrameBufferHandle): null => {
      return null
    },

    '[method]frame-buffer.to-abstract-buffer': (handle: FrameBufferHandle): number => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')

      const graphicsRegistry = getGraphicsContextRegistry()
      return graphicsRegistry.createBuffer({
        width: buffer.width,
        height: buffer.height,
        format: buffer.format === 'bgra8' ? 'bgra8unorm' : 'rgba8unorm',
        data: buffer.data,
      })
    },

    'from-abstract-buffer': (
      abstractHandle: number,
      format?: PixelFormat
    ): FrameBufferHandle => {
      const graphicsRegistry = getGraphicsContextRegistry()
      const abstractBuffer = graphicsRegistry.getBuffer(abstractHandle)
      if (!abstractBuffer) throw new Error('Abstract buffer not found')

      const desc: FrameBufferDescriptor = {
        width: abstractBuffer.width,
        height: abstractBuffer.height,
        format: format ?? 'rgba8',
      }
      if (abstractBuffer.data instanceof Uint8Array) {
        desc.data = abstractBuffer.data
      } else if (abstractBuffer.data) {
        desc.data = new Uint8Array(abstractBuffer.data)
      }
      return registry.createBuffer(desc)
    },

    '[method]frame-buffer.resize': (
      handle: FrameBufferHandle,
      width: number,
      height: number
    ): void => {
      const buffer = registry.getBuffer(handle)
      if (!buffer) throw new Error('Frame buffer not found')

      const bytesPerPixel = BYTES_PER_PIXEL[buffer.format]
      const newData = new Uint8Array(width * height * bytesPerPixel)

      const copyWidth = Math.min(buffer.width, width)
      const copyHeight = Math.min(buffer.height, height)

      for (let y = 0; y < copyHeight; y++) {
        const srcOffset = y * buffer.width * bytesPerPixel
        const dstOffset = y * width * bytesPerPixel
        newData.set(
          buffer.data.slice(srcOffset, srcOffset + copyWidth * bytesPerPixel),
          dstOffset
        )
      }

      buffer.width = width
      buffer.height = height
      buffer.data = newData
      buffer.dirty = true
    },
  }
}

// =============================================================================
// Implementations
// =============================================================================

/**
 * Browser canvas-based frame buffer implementation.
 * Uses HTML Canvas 2D for display.
 */
export const browserCanvasImplementation: Implementation = {
  name: 'browser-canvas',
  description: 'Frame buffer with HTML Canvas 2D for rendering and display',
  create(_config: PluginConfig): PluginInstance {
    const registry = getDefaultFrameBufferRegistry()
    const imports = createBrowserCanvasImplementation(registry)

    return {
      getImports(): Record<string, unknown> {
        return {
          'wasi:frame-buffer/frame-buffer@0.0.1': imports,
        }
      },
      destroy(): void {
        // Registry cleanup handled elsewhere
      },
    }
  },
}

/**
 * Headless frame buffer implementation.
 * In-memory only, for testing or server-side use.
 */
export const headlessFrameBufferImplementation: Implementation = {
  name: 'headless',
  description: 'In-memory frame buffer for testing and server-side use',
  create(_config: PluginConfig): PluginInstance {
    const registry = new FrameBufferRegistry()
    const imports = createHeadlessImplementation(registry)

    return {
      getImports(): Record<string, unknown> {
        return {
          'wasi:frame-buffer/frame-buffer@0.0.1': imports,
        }
      },
      destroy(): void {
        // Cleanup handled by registry
      },
    }
  },
}

// =============================================================================
// Plugin Export
// =============================================================================

/**
 * wasi:frame-buffer/frame-buffer plugin
 *
 * Provides software rendering via frame buffers with optional
 * browser:canvas acceleration for display.
 *
 * Implementations:
 * - browser-canvas: Uses HTML Canvas 2D for rendering and display (default)
 * - headless: In-memory only, for testing or server-side use
 */
export const frameBufferPlugin: WasiPlugin = createPlugin(
  FRAME_BUFFER_INTERFACE,
  {
    'browser-canvas': browserCanvasImplementation,
    'headless': headlessFrameBufferImplementation,
  },
  'browser-canvas'
)

/**
 * All frame buffer plugins
 */
export const frameBufferPlugins: WasiPlugin[] = [
  frameBufferPlugin,
]
