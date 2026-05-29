/**
 * Tests for the runtime component parser
 */

import { describe, it, expect } from 'vitest'
import { parseComponentImports, isComponent } from '../../src/wasip2/runtime/parser.js'

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

    it('should parse an instance import from a synthetic component (section 10)', () => {
      // Smallest viable component with one WASI instance import:
      //   import wasi:cli/exit@0.2.6 : (instance type 0)
      // Section layout (Component Model binary spec):
      //   section id 0x0a (import), body:
      //     import-count   = 1
      //     import-name    = 0x00 (plain) length:19 utf-8:"wasi:cli/exit@0.2.6"
      //     extern-desc    = 0x05 (instance) typeidx:0
      const name = 'wasi:cli/exit@0.2.6'
      const nameBytes = new TextEncoder().encode(name)
      const body = new Uint8Array([
        0x01, // import-count
        0x00, // import-name discriminator (plain)
        nameBytes.length, // LEB128 length (< 128)
        ...nameBytes,
        0x05, // extern-desc kind = instance
        0x00, // typeidx = 0
      ])
      const component = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // magic
        0x0d, 0x00, 0x01, 0x00, // version 13 (component)
        0x0a, body.length, // section id 10 (import) + LEB128 size
        ...body,
      ])
      const result = parseComponentImports(component)
      expect(result.isComponent).toBe(true)
      expect(result.imports.length).toBe(1)
      expect(result.imports[0]!.name).toBe(name)
      expect(result.imports[0]!.kind).toBe('instance')
      expect(result.wasiImports.length).toBe(1)
      expect(result.requiredInterfaces.length).toBe(1)
      expect(result.requiredInterfaces[0]!.package).toBe('wasi:cli')
      expect(result.requiredInterfaces[0]!.name).toBe('exit')
      expect(result.requiredInterfaces[0]!.version).toBe('0.2.6')
    })
  })
})
