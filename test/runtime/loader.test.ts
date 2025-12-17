/**
 * Tests for the runtime component loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ComponentLoader,
  createComponentLoader,
} from '../../src/wasip2/runtime/loader.js'
import { randomPlugin } from '../../src/wasip2/plugins/random/index.js'
import { monotonicClockPlugin } from '../../src/wasip2/plugins/clocks/index.js'

describe('ComponentLoader', () => {
  let loader: ComponentLoader

  beforeEach(() => {
    loader = createComponentLoader({ devMode: true })
    // Register some plugins for testing
    loader.getPolyfill().registerPlugin(randomPlugin)
    loader.getPolyfill().registerPlugin(monotonicClockPlugin)
  })

  afterEach(() => {
    loader.destroy()
  })

  describe('createComponentLoader', () => {
    it('should create a loader with default options', () => {
      const defaultLoader = createComponentLoader()
      expect(defaultLoader).toBeInstanceOf(ComponentLoader)
      defaultLoader.destroy()
    })

    it('should create a loader in dev mode', () => {
      const devLoader = createComponentLoader({ devMode: true })
      expect(devLoader).toBeInstanceOf(ComponentLoader)
      // Dev mode should allow all interfaces
      expect(devLoader.getPolyfill().isAllowed('wasi:random@0.2.0')).toBe(true)
      devLoader.destroy()
    })

    it('should accept a custom polyfill', () => {
      const existingLoader = createComponentLoader({ devMode: true })
      const polyfill = existingLoader.getPolyfill()

      const newLoader = createComponentLoader({ polyfill })
      expect(newLoader.getPolyfill()).toBe(polyfill)

      // Only destroy the original - the new one doesn't own the polyfill
      newLoader.destroy()
      existingLoader.destroy()
    })
  })

  describe('isComponent', () => {
    it('should return true for valid component bytes', () => {
      const component = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d,
        0x0d, 0x00, 0x01, 0x00,
      ])
      expect(loader.isComponent(component)).toBe(true)
    })

    it('should return false for core module bytes', () => {
      const coreModule = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d,
        0x01, 0x00, 0x00, 0x00,
      ])
      expect(loader.isComponent(coreModule)).toBe(false)
    })

    it('should return false for invalid bytes', () => {
      expect(loader.isComponent(new Uint8Array([0x00, 0x00]))).toBe(false)
    })
  })

  describe('parseComponent', () => {
    it('should parse component info', async () => {
      const component = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d,
        0x0d, 0x00, 0x01, 0x00,
      ])

      const info = await loader.parseComponent(component)
      expect(info.isComponent).toBe(true)
      expect(Array.isArray(info.imports)).toBe(true)
    })

    it('should report non-component for core modules', async () => {
      const coreModule = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d,
        0x01, 0x00, 0x00, 0x00,
      ])

      const info = await loader.parseComponent(coreModule)
      expect(info.isComponent).toBe(false)
    })
  })

  describe('registerPlugins', () => {
    it('should register plugins with the polyfill', () => {
      const newLoader = createComponentLoader({ devMode: true })

      // Register plugins (may already be registered via global registry)
      newLoader.registerPlugins([randomPlugin])

      // After registering, plugin should definitely be available
      expect(newLoader.getPolyfill().hasPlugin('wasi:random@0.2.0')).toBe(true)

      newLoader.destroy()
    })
  })

  describe('load', () => {
    it('should throw for non-component bytes', async () => {
      const invalid = new Uint8Array([0x00, 0x00, 0x00, 0x00])

      await expect(loader.load(invalid)).rejects.toThrow(
        'Not a valid WebAssembly component'
      )
    })

    it('should throw for core module attempting component load', async () => {
      // This is a minimal core module
      const coreModule = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d,
        0x01, 0x00, 0x00, 0x00,
      ])

      await expect(loader.load(coreModule)).rejects.toThrow(
        'Not a valid WebAssembly component'
      )
    })
  })

  describe('getPolyfill', () => {
    it('should return the polyfill instance', () => {
      expect(loader.getPolyfill()).toBeDefined()
      expect(typeof loader.getPolyfill().getImports).toBe('function')
    })
  })

  describe('destroy', () => {
    it('should not throw when called multiple times', () => {
      const disposableLoader = createComponentLoader({ devMode: true })

      expect(() => disposableLoader.destroy()).not.toThrow()
      expect(() => disposableLoader.destroy()).not.toThrow()
    })

    it('should not destroy polyfill if not owned', () => {
      const ownedLoader = createComponentLoader({ devMode: true })
      const polyfill = ownedLoader.getPolyfill()

      const borrowedLoader = createComponentLoader({ polyfill })
      borrowedLoader.destroy()

      // The polyfill should still be usable
      expect(() => polyfill.isAllowed('wasi:random@0.2.0')).not.toThrow()

      ownedLoader.destroy()
    })
  })
})
