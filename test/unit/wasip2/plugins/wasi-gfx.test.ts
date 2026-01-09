/**
 * wasi-gfx plugin tests
 *
 * Tests for the graphics-context, surface, webgpu, and frame-buffer plugins.
 */

import { describe, it, expect } from 'vitest'

// Import graphics-context
import {
  GRAPHICS_CONTEXT_INTERFACE,
  defaultGraphicsContextImplementation,
  graphicsContextPlugin,
  GraphicsContextRegistry,
  getDefaultRegistry,
} from '../../../../src/wasip2/plugins/graphics-context/index.js'

// Import surface
import {
  SURFACE_INTERFACE,
  browserSurfaceImplementation,
  headlessSurfaceImplementation,
  surfacePlugin,
  SurfaceRegistry,
  EventQueue,
} from '../../../../src/wasip2/plugins/surface/index.js'

// Import webgpu
import {
  WEBGPU_INTERFACE,
  browserWebGPUImplementation,
  webgpuPlugin,
} from '../../../../src/wasip2/plugins/webgpu/index.js'

// Import frame-buffer
import {
  FRAME_BUFFER_INTERFACE,
  browserCanvasImplementation,
  headlessFrameBufferImplementation,
  frameBufferPlugin,
  FrameBufferRegistry,
  BYTES_PER_PIXEL,
  rgbaToBgra,
  bgraToRgba,
  rgbToRgba,
} from '../../../../src/wasip2/plugins/frame-buffer/index.js'

// Import combined wasi-gfx
import {
  wasiGfxPlugins,
  wasiGfxBrowserConfig,
  wasiGfxHeadlessConfig,
} from '../../../../src/wasip2/plugins/wasi-gfx/index.js'

describe('wasi:graphics-context', () => {
  describe('interface', () => {
    it('should have correct interface definition', () => {
      expect(GRAPHICS_CONTEXT_INTERFACE.package).toBe('wasi:graphics-context')
      expect(GRAPHICS_CONTEXT_INTERFACE.name).toBe('graphics-context')
      expect(GRAPHICS_CONTEXT_INTERFACE.version).toBe('0.0.1')
    })
  })

  describe('implementation', () => {
    it('should have default implementation', () => {
      expect(defaultGraphicsContextImplementation.name).toBe('default')
      expect(defaultGraphicsContextImplementation.description).toBeDefined()
    })

    it('should create plugin instance', () => {
      const instance = graphicsContextPlugin.create({})
      expect(instance).toBeDefined()
      expect(instance.getImports).toBeDefined()
      expect(instance.destroy).toBeDefined()
    })
  })

  describe('GraphicsContextRegistry', () => {
    it('should create and manage contexts', () => {
      const registry = new GraphicsContextRegistry()

      const handle = registry.createContext({ width: 100, height: 100 })
      expect(handle).toBeGreaterThan(0)

      const context = registry.getContext(handle)
      expect(context).toBeDefined()
      expect(context?.config.width).toBe(100)
      expect(context?.config.height).toBe(100)
    })

    it('should create and manage buffers', () => {
      const registry = new GraphicsContextRegistry()

      const handle = registry.createBuffer({
        width: 64,
        height: 64,
        format: 'rgba8unorm',
      })
      expect(handle).toBeGreaterThan(0)

      const buffer = registry.getBuffer(handle)
      expect(buffer).toBeDefined()
      expect(buffer?.width).toBe(64)
      expect(buffer?.height).toBe(64)
      expect(buffer?.format).toBe('rgba8unorm')
    })
  })
})

describe('wasi:surface', () => {
  describe('interface', () => {
    it('should have correct interface definition', () => {
      expect(SURFACE_INTERFACE.package).toBe('wasi:surface')
      expect(SURFACE_INTERFACE.name).toBe('surface')
      expect(SURFACE_INTERFACE.version).toBe('0.0.1')
    })
  })

  describe('implementations', () => {
    it('should have browser implementation', () => {
      expect(browserSurfaceImplementation.name).toBe('browser')
      expect(browserSurfaceImplementation.description).toBeDefined()
    })

    it('should have headless implementation', () => {
      expect(headlessSurfaceImplementation.name).toBe('headless')
      expect(headlessSurfaceImplementation.description).toBeDefined()
    })
  })

  describe('SurfaceRegistry', () => {
    it('should create and manage surfaces', () => {
      const registry = new SurfaceRegistry()

      const handle = registry.createSurface({ width: 800, height: 600 })
      expect(handle).toBeGreaterThan(0)

      const surface = registry.getSurface(handle)
      expect(surface).toBeDefined()
      expect(surface?.width).toBe(800)
      expect(surface?.height).toBe(600)
    })

    it('should delete surfaces', () => {
      const registry = new SurfaceRegistry()

      const handle = registry.createSurface({})
      expect(registry.getSurface(handle)).toBeDefined()

      registry.deleteSurface(handle)
      expect(registry.getSurface(handle)).toBeUndefined()
    })
  })

  describe('EventQueue', () => {
    it('should push and pop events', () => {
      const queue = new EventQueue<{ value: number }>()

      expect(queue.isEmpty()).toBe(true)

      queue.push({ value: 1 })
      queue.push({ value: 2 })

      expect(queue.isEmpty()).toBe(false)
      expect(queue.pop()?.value).toBe(1)
      expect(queue.pop()?.value).toBe(2)
      expect(queue.isEmpty()).toBe(true)
    })

    it('should peek without removing', () => {
      const queue = new EventQueue<{ value: number }>()

      queue.push({ value: 42 })

      expect(queue.peek()?.value).toBe(42)
      expect(queue.peek()?.value).toBe(42)
      expect(queue.pop()?.value).toBe(42)
      expect(queue.peek()).toBeNull()
    })

    it('should notify subscribers on push', () => {
      const queue = new EventQueue<number>()
      let notified = false

      queue.subscribe(() => { notified = true })
      queue.push(1)

      expect(notified).toBe(true)
    })

    it('should unsubscribe correctly', () => {
      const queue = new EventQueue<number>()
      let count = 0

      const unsubscribe = queue.subscribe(() => { count++ })
      queue.push(1)
      expect(count).toBe(1)

      unsubscribe()
      queue.push(2)
      expect(count).toBe(1)
    })
  })
})

describe('wasi:webgpu', () => {
  describe('interface', () => {
    it('should have correct interface definition', () => {
      expect(WEBGPU_INTERFACE.package).toBe('wasi:webgpu')
      expect(WEBGPU_INTERFACE.name).toBe('webgpu')
      expect(WEBGPU_INTERFACE.version).toBe('0.0.1')
    })
  })

  describe('implementation', () => {
    it('should have browser implementation', () => {
      expect(browserWebGPUImplementation.name).toBe('browser')
      expect(browserWebGPUImplementation.description).toBeDefined()
    })

    it('should create plugin instance', () => {
      const instance = webgpuPlugin.create({})
      expect(instance).toBeDefined()
      expect(instance.getImports).toBeDefined()
    })
  })
})

describe('wasi:frame-buffer', () => {
  describe('interface', () => {
    it('should have correct interface definition', () => {
      expect(FRAME_BUFFER_INTERFACE.package).toBe('wasi:frame-buffer')
      expect(FRAME_BUFFER_INTERFACE.name).toBe('frame-buffer')
      expect(FRAME_BUFFER_INTERFACE.version).toBe('0.0.1')
    })
  })

  describe('implementations', () => {
    it('should have browser-canvas implementation', () => {
      expect(browserCanvasImplementation.name).toBe('browser-canvas')
      expect(browserCanvasImplementation.description).toBeDefined()
    })

    it('should have headless implementation', () => {
      expect(headlessFrameBufferImplementation.name).toBe('headless')
      expect(headlessFrameBufferImplementation.description).toBeDefined()
    })
  })

  describe('FrameBufferRegistry', () => {
    it('should create and manage buffers', () => {
      const registry = new FrameBufferRegistry()

      const handle = registry.createBuffer({ width: 100, height: 100, format: 'rgba8' })
      expect(handle).toBeGreaterThan(0)

      const buffer = registry.getBuffer(handle)
      expect(buffer).toBeDefined()
      expect(buffer?.width).toBe(100)
      expect(buffer?.height).toBe(100)
      expect(buffer?.format).toBe('rgba8')
    })

    it('should get and set pixels', () => {
      const registry = new FrameBufferRegistry()

      const handle = registry.createBuffer({ width: 10, height: 10, format: 'rgba8' })

      const color = new Uint8Array([255, 0, 0, 255])
      registry.setPixel(handle, 5, 5, color)

      const pixel = registry.getPixel(handle, 5, 5)
      expect(pixel?.[0]).toBe(255) // R
      expect(pixel?.[1]).toBe(0)   // G
      expect(pixel?.[2]).toBe(0)   // B
      expect(pixel?.[3]).toBe(255) // A
    })

    it('should fill rectangles', () => {
      const registry = new FrameBufferRegistry()

      const handle = registry.createBuffer({ width: 10, height: 10, format: 'rgba8' })

      const color = new Uint8Array([0, 255, 0, 255])
      registry.fillRect(handle, 2, 2, 4, 4, color)

      const pixel = registry.getPixel(handle, 3, 3)
      expect(pixel?.[1]).toBe(255) // G
    })

    it('should clear buffers', () => {
      const registry = new FrameBufferRegistry()

      const handle = registry.createBuffer({ width: 10, height: 10, format: 'rgba8' })

      const color = new Uint8Array([255, 128, 64, 255])
      registry.clear(handle, color)

      // Check random pixel
      const pixel = registry.getPixel(handle, 7, 3)
      expect(pixel?.[0]).toBe(255)
      expect(pixel?.[1]).toBe(128)
      expect(pixel?.[2]).toBe(64)
      expect(pixel?.[3]).toBe(255)
    })
  })

  describe('BYTES_PER_PIXEL', () => {
    it('should have correct bytes per pixel', () => {
      expect(BYTES_PER_PIXEL['rgba8']).toBe(4)
      expect(BYTES_PER_PIXEL['bgra8']).toBe(4)
      expect(BYTES_PER_PIXEL['rgb8']).toBe(3)
      expect(BYTES_PER_PIXEL['rgb565']).toBe(2)
    })
  })

  describe('format conversion', () => {
    it('should convert RGBA to BGRA', () => {
      const rgba = new Uint8Array([255, 128, 64, 255])
      const bgra = rgbaToBgra(rgba)

      expect(bgra[0]).toBe(64)  // B
      expect(bgra[1]).toBe(128) // G
      expect(bgra[2]).toBe(255) // R
      expect(bgra[3]).toBe(255) // A
    })

    it('should convert BGRA to RGBA', () => {
      const bgra = new Uint8Array([64, 128, 255, 255])
      const rgba = bgraToRgba(bgra)

      expect(rgba[0]).toBe(255) // R
      expect(rgba[1]).toBe(128) // G
      expect(rgba[2]).toBe(64)  // B
      expect(rgba[3]).toBe(255) // A
    })

    it('should convert RGB to RGBA', () => {
      const rgb = new Uint8Array([100, 150, 200])
      const rgba = rgbToRgba(rgb)

      expect(rgba[0]).toBe(100)
      expect(rgba[1]).toBe(150)
      expect(rgba[2]).toBe(200)
      expect(rgba[3]).toBe(255) // Alpha should be fully opaque
    })
  })
})

describe('wasi-gfx combined', () => {
  it('should have all plugins', () => {
    expect(wasiGfxPlugins.length).toBe(4)
  })

  it('should have browser config', () => {
    expect(wasiGfxBrowserConfig.graphicsContext).toBe('default')
    expect(wasiGfxBrowserConfig.surface).toBe('browser')
    expect(wasiGfxBrowserConfig.webgpu).toBe('browser')
    expect(wasiGfxBrowserConfig.frameBuffer).toBe('browser-canvas')
  })

  it('should have headless config', () => {
    expect(wasiGfxHeadlessConfig.graphicsContext).toBe('default')
    expect(wasiGfxHeadlessConfig.surface).toBe('headless')
    expect(wasiGfxHeadlessConfig.frameBuffer).toBe('headless')
  })
})
