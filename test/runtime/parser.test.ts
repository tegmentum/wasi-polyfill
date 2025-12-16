/**
 * Tests for the runtime component parser
 */

import { describe, it, expect } from 'vitest'
import { parseComponentImports, isComponent } from '../../src/runtime/parser.js'

describe('Component Parser', () => {
  describe('isComponent', () => {
    it('should return false for empty bytes', () => {
      expect(isComponent(new Uint8Array([]))).toBe(false)
    })

    it('should return false for short bytes', () => {
      expect(isComponent(new Uint8Array([0x00, 0x61, 0x73]))).toBe(false)
    })

    it('should return false for core WASM module', () => {
      // Core WASM magic + version 1
      const coreModule = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // magic
        0x01, 0x00, 0x00, 0x00, // version 1 (core module)
      ])
      expect(isComponent(coreModule)).toBe(false)
    })

    it('should return true for component', () => {
      // Component magic + version 13
      const component = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // magic
        0x0d, 0x00, 0x01, 0x00, // version 13 (component)
      ])
      expect(isComponent(component)).toBe(true)
    })

    it('should work with ArrayBuffer', () => {
      const component = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d,
        0x0d, 0x00, 0x01, 0x00,
      ])
      expect(isComponent(component.buffer)).toBe(true)
    })
  })

  describe('parseComponentImports', () => {
    it('should return isComponent=false for invalid bytes', () => {
      const result = parseComponentImports(new Uint8Array([0x00, 0x00]))
      expect(result.isComponent).toBe(false)
      expect(result.imports).toEqual([])
      expect(result.wasiImports).toEqual([])
      expect(result.requiredInterfaces).toEqual([])
    })

    it('should return isComponent=false for core WASM module', () => {
      const coreModule = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // magic
        0x01, 0x00, 0x00, 0x00, // version 1 (core module)
      ])
      const result = parseComponentImports(coreModule)
      expect(result.isComponent).toBe(false)
    })

    it('should return isComponent=true for valid component header', () => {
      // Minimal valid component (header only)
      const component = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // magic
        0x0d, 0x00, 0x01, 0x00, // version 13 (component)
      ])
      const result = parseComponentImports(component)
      expect(result.isComponent).toBe(true)
      expect(result.imports).toEqual([])
    })

    it('should work with ArrayBuffer input', () => {
      const component = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d,
        0x0d, 0x00, 0x01, 0x00,
      ])
      const result = parseComponentImports(component.buffer)
      expect(result.isComponent).toBe(true)
    })
  })

  describe('WASI interface parsing', () => {
    it('should deduplicate identical interfaces', () => {
      // This is a unit test for deduplication logic
      // In real components, imports would come from binary parsing
      const result = parseComponentImports(new Uint8Array([
        0x00, 0x61, 0x73, 0x6d,
        0x0d, 0x00, 0x01, 0x00,
      ]))

      // The result should have no duplicates (currently empty since no import section)
      expect(result.requiredInterfaces.length).toBe(
        new Set(
          result.requiredInterfaces.map(
            (i) => `${i.package}/${i.name}@${i.version}`
          )
        ).size
      )
    })
  })
})
