/**
 * Tests for build-time introspection utilities
 */

import { describe, it, expect } from 'vitest'
import {
  parseInterfaceString,
  formatInterfaceString,
  getSubsystem,
  toManifest,
  type IntrospectResult,
} from '../../src/build/introspect.js'

describe('Build Introspection', () => {
  describe('parseInterfaceString', () => {
    it('should parse full interface string with version', () => {
      const result = parseInterfaceString('wasi:filesystem/types@0.2.0')
      expect(result).toEqual({
        package: 'wasi:filesystem',
        name: 'types',
        version: '0.2.0',
      })
    })

    it('should parse interface string without version', () => {
      const result = parseInterfaceString('wasi:cli/environment')
      expect(result).toEqual({
        package: 'wasi:cli',
        name: 'environment',
        version: '0.2.0', // Default version
      })
    })

    it('should handle various WASI interfaces', () => {
      expect(parseInterfaceString('wasi:random/random@0.2.0')).toEqual({
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      })

      expect(parseInterfaceString('wasi:io/streams@0.2.0')).toEqual({
        package: 'wasi:io',
        name: 'streams',
        version: '0.2.0',
      })

      expect(parseInterfaceString('wasi:clocks/monotonic-clock@0.2.0')).toEqual({
        package: 'wasi:clocks',
        name: 'monotonic-clock',
        version: '0.2.0',
      })
    })

    it('should return null for invalid strings', () => {
      expect(parseInterfaceString('')).toBeNull()
      expect(parseInterfaceString('invalid')).toBeNull()
      expect(parseInterfaceString('no-colon/interface')).toBeNull()
    })
  })

  describe('formatInterfaceString', () => {
    it('should format interface back to string', () => {
      const iface = {
        package: 'wasi:filesystem',
        name: 'types',
        version: '0.2.0',
      }
      expect(formatInterfaceString(iface)).toBe('wasi:filesystem/types@0.2.0')
    })

    it('should be inverse of parseInterfaceString', () => {
      const original = 'wasi:cli/environment@0.2.0'
      const parsed = parseInterfaceString(original)
      expect(parsed).not.toBeNull()
      expect(formatInterfaceString(parsed!)).toBe(original)
    })
  })

  describe('getSubsystem', () => {
    it('should extract subsystem from interface', () => {
      expect(
        getSubsystem({ package: 'wasi:filesystem', name: 'types', version: '0.2.0' })
      ).toBe('filesystem')

      expect(
        getSubsystem({ package: 'wasi:cli', name: 'environment', version: '0.2.0' })
      ).toBe('cli')

      expect(
        getSubsystem({ package: 'wasi:random', name: 'random', version: '0.2.0' })
      ).toBe('random')

      expect(
        getSubsystem({ package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' })
      ).toBe('clocks')
    })
  })

  describe('toManifest', () => {
    it('should convert introspection result to manifest', () => {
      const result: IntrospectResult = {
        imports: [
          { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
          { package: 'wasi:filesystem', name: 'types', version: '0.2.0' },
        ],
        exports: [{ package: 'wasi:http', name: 'handler', version: '0.2.0' }],
        wasiSubsystems: ['cli', 'filesystem'],
      }

      const manifest = toManifest(result)

      expect(manifest.version).toBe(1)
      expect(manifest.imports).toEqual(result.imports)
      expect(manifest.exports).toEqual(result.exports)
      expect(manifest.wasiSubsystems).toEqual(result.wasiSubsystems)
      expect(manifest.capabilities).toBeUndefined()
    })

    it('should include capabilities when present', () => {
      const result: IntrospectResult = {
        imports: [{ package: 'wasi:cli', name: 'environment', version: '0.2.0' }],
        exports: [],
        wasiSubsystems: ['cli'],
        capabilities: {
          env: true,
          args: true,
        },
      }

      const manifest = toManifest(result)

      expect(manifest.capabilities).toEqual({
        env: true,
        args: true,
      })
    })

    it('should handle empty result', () => {
      const result: IntrospectResult = {
        imports: [],
        exports: [],
        wasiSubsystems: [],
      }

      const manifest = toManifest(result)

      expect(manifest.version).toBe(1)
      expect(manifest.imports).toEqual([])
      expect(manifest.exports).toEqual([])
      expect(manifest.wasiSubsystems).toEqual([])
    })
  })
})
