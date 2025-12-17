/**
 * Tests for the runtime bindgen
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  RuntimeBindgen,
  createRuntimeBindgen,
} from '../../src/wasip2/runtime/bindgen.js'
import { randomPlugin } from '../../src/wasip2/plugins/random/index.js'
import { monotonicClockPlugin } from '../../src/wasip2/plugins/clocks/index.js'

describe('RuntimeBindgen', () => {
  let bindgen: RuntimeBindgen

  beforeEach(() => {
    bindgen = createRuntimeBindgen({ devMode: true })
    // Register plugins
    bindgen.getPolyfill().registerPlugin(randomPlugin)
    bindgen.getPolyfill().registerPlugin(monotonicClockPlugin)
  })

  afterEach(() => {
    bindgen.destroy()
  })

  describe('createRuntimeBindgen', () => {
    it('should create a bindgen with default options', () => {
      const defaultBindgen = createRuntimeBindgen()
      expect(defaultBindgen).toBeInstanceOf(RuntimeBindgen)
      defaultBindgen.destroy()
    })

    it('should create a bindgen in dev mode', () => {
      const devBindgen = createRuntimeBindgen({ devMode: true })
      expect(devBindgen).toBeInstanceOf(RuntimeBindgen)
      expect(devBindgen.getPolyfill().isAllowed('wasi:random@0.2.0')).toBe(true)
      devBindgen.destroy()
    })

    it('should accept a custom polyfill', () => {
      const existingBindgen = createRuntimeBindgen({ devMode: true })
      const polyfill = existingBindgen.getPolyfill()

      const newBindgen = createRuntimeBindgen({ polyfill })
      expect(newBindgen.getPolyfill()).toBe(polyfill)

      newBindgen.destroy()
      existingBindgen.destroy()
    })
  })

  describe('isJcoAvailable', () => {
    it('should return a boolean', async () => {
      const available = await bindgen.isJcoAvailable()
      expect(typeof available).toBe('boolean')
    })

    it('should cache the result', async () => {
      const first = await bindgen.isJcoAvailable()
      const second = await bindgen.isJcoAvailable()
      expect(first).toBe(second)
    })
  })

  describe('getPolyfill', () => {
    it('should return the polyfill instance', () => {
      expect(bindgen.getPolyfill()).toBeDefined()
      expect(typeof bindgen.getPolyfill().getImports).toBe('function')
    })
  })

  describe('instantiate', () => {
    it('should handle core modules without component header', async () => {
      // A minimal core WASM module (empty module)
      const coreModule = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // magic
        0x01, 0x00, 0x00, 0x00, // version 1 (core module)
      ])

      const result = await bindgen.instantiate(coreModule)
      expect(result).toBeDefined()
      expect(result.componentInfo.isComponent).toBe(false)
      expect(result.usedJco).toBe(false)
      result.destroy()
    })

    it('should fail gracefully for invalid component', async () => {
      // Invalid bytes
      const invalid = new Uint8Array([0x00, 0x00, 0x00, 0x00])

      await expect(bindgen.instantiate(invalid)).rejects.toThrow()
    })
  })

  describe('destroy', () => {
    it('should not throw when called multiple times', () => {
      const disposableBindgen = createRuntimeBindgen({ devMode: true })

      expect(() => disposableBindgen.destroy()).not.toThrow()
      expect(() => disposableBindgen.destroy()).not.toThrow()
    })

    it('should not destroy polyfill if not owned', () => {
      const ownedBindgen = createRuntimeBindgen({ devMode: true })
      const polyfill = ownedBindgen.getPolyfill()

      const borrowedBindgen = createRuntimeBindgen({ polyfill })
      borrowedBindgen.destroy()

      // The polyfill should still be usable
      expect(() => polyfill.isAllowed('wasi:random@0.2.0')).not.toThrow()

      ownedBindgen.destroy()
    })
  })

  describe('options', () => {
    it('should accept additional imports', () => {
      const customBindgen = createRuntimeBindgen({
        devMode: true,
        additionalImports: {
          'custom:namespace': {
            myFunction: () => 42,
          },
        },
      })

      expect(customBindgen).toBeInstanceOf(RuntimeBindgen)
      customBindgen.destroy()
    })

    it('should accept jco options', () => {
      const customBindgen = createRuntimeBindgen({
        devMode: true,
        jcoOptions: {
          name: 'my-component',
          minify: true,
        },
      })

      expect(customBindgen).toBeInstanceOf(RuntimeBindgen)
      customBindgen.destroy()
    })
  })
})
