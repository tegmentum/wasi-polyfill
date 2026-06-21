import { describe, it, expect } from 'vitest'
import {
  parseInterfaceString,
  formatInterfaceString,
  interfaceKey,
  interfaceMatches,
} from '../../src/wasip2/core/types.js'

describe('interfaceKey', () => {
  it('produces a version-independent package/name key', () => {
    expect(
      interfaceKey({ package: 'wasi:keyvalue', name: 'store', version: '0.2.0' })
    ).toBe('wasi:keyvalue/store')
  })

  it('ignores the version (same key across versions)', () => {
    const a = interfaceKey({ package: 'wasi:io', name: 'streams', version: '0.2.0' })
    const b = interfaceKey({ package: 'wasi:io', name: 'streams', version: '0.2.3' })
    expect(a).toBe(b)
    expect(a).toBe('wasi:io/streams')
  })
})

describe('parseInterfaceString', () => {
  it('parses full interface string with subinterface', () => {
    const result = parseInterfaceString('wasi:random/random@0.2.0')
    expect(result).toEqual({
      package: 'wasi:random',
      name: 'random',
      version: '0.2.0',
    })
  })

  it('parses interface string without subinterface', () => {
    const result = parseInterfaceString('wasi:filesystem@0.2.0')
    expect(result).toEqual({
      package: 'wasi:filesystem',
      name: 'filesystem',
      version: '0.2.0',
    })
  })

  it('parses interface with hyphenated name', () => {
    const result = parseInterfaceString('wasi:clocks/monotonic-clock@0.2.0')
    expect(result).toEqual({
      package: 'wasi:clocks',
      name: 'monotonic-clock',
      version: '0.2.0',
    })
  })

  it('parses non-wasi namespaces', () => {
    expect(parseInterfaceString('openmct:platform/object-registry@0.1.0')).toEqual({
      package: 'openmct:platform',
      name: 'object-registry',
      version: '0.1.0',
    })
    expect(parseInterfaceString('openmct:platform/event-bus@0.1.0')).toEqual({
      package: 'openmct:platform',
      name: 'event-bus',
      version: '0.1.0',
    })
  })

  it('throws on invalid format', () => {
    expect(() => parseInterfaceString('invalid')).toThrow()
    expect(() => parseInterfaceString('wasi:random')).toThrow()
    expect(() => parseInterfaceString('no-colon/iface@0.1.0')).toThrow()
  })
})

describe('formatInterfaceString', () => {
  it('formats interface with different name', () => {
    const result = formatInterfaceString({
      package: 'wasi:clocks',
      name: 'monotonic-clock',
      version: '0.2.0',
    })
    expect(result).toBe('wasi:clocks/monotonic-clock@0.2.0')
  })

  it('formats interface with same name as package', () => {
    const result = formatInterfaceString({
      package: 'wasi:random',
      name: 'random',
      version: '0.2.0',
    })
    expect(result).toBe('wasi:random@0.2.0')
  })
})

describe('interfaceMatches', () => {
  const iface1 = { package: 'wasi:random', name: 'random', version: '0.2.0' }
  const iface2 = { package: 'wasi:random', name: 'random', version: '0.3.0' }
  const iface3 = { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' }

  it('matches same package and name regardless of version', () => {
    expect(interfaceMatches(iface1, iface2)).toBe(true)
  })

  it('does not match different interfaces', () => {
    expect(interfaceMatches(iface1, iface3)).toBe(false)
  })

  it('checks version when requested', () => {
    expect(interfaceMatches(iface1, iface2, true)).toBe(false)
    expect(interfaceMatches(iface1, iface1, true)).toBe(true)
  })
})
