/**
 * Integration tests for the jco compatibility layer (buildJcoImports).
 *
 * Verifies that the polyfill's jcoCompat mode produces imports matching
 * what jco-transpiled components expect: PascalCase resource classes with
 * camelCase prototype methods, return-value wrapping, argument unwrapping, etc.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { registerCorePlugins } from '../../src/wasip2/core/index.js'
import { Polyfill, createJcoPolyfill } from '../../src/wasip2/core/polyfill.js'
import { AllowAllPolicy, createPolicy } from '../../src/wasip2/core/policy.js'

/**
 * Every interface registered by registerCorePlugins().
 */
const ALL_INTERFACES = [
  'wasi:cli/environment@0.2.0',
  'wasi:cli/stdin@0.2.0',
  'wasi:cli/stdout@0.2.0',
  'wasi:cli/stderr@0.2.0',
  'wasi:cli/exit@0.2.0',
  'wasi:cli/terminal-input@0.2.0',
  'wasi:cli/terminal-output@0.2.0',
  'wasi:cli/terminal-stdin@0.2.0',
  'wasi:cli/terminal-stdout@0.2.0',
  'wasi:cli/terminal-stderr@0.2.0',
  'wasi:io/poll@0.2.0',
  'wasi:io/streams@0.2.0',
  'wasi:io/error@0.2.0',
  'wasi:clocks/monotonic-clock@0.2.0',
  'wasi:clocks/wall-clock@0.2.0',
  'wasi:random/random@0.2.0',
  'wasi:random/insecure@0.2.0',
  'wasi:random/insecure-seed@0.2.0',
  'wasi:filesystem/types@0.2.0',
  'wasi:filesystem/preopens@0.2.0',
]

const symbolCabiRep = Symbol.for('cabiRep')

describe('jco compatibility', () => {
  let polyfill: Polyfill
  let imports: Record<string, Record<string, unknown>>

  beforeAll(async () => {
    await registerCorePlugins()
    polyfill = new Polyfill({ policy: new AllowAllPolicy() })
    const result = await polyfill.forInterfaces(ALL_INTERFACES, {
      jcoCompat: true,
    })
    imports = result.imports
  })

  afterAll(() => {
    polyfill.destroy()
  })

  // ---------------------------------------------------------------------------
  // 1. Import key format
  // ---------------------------------------------------------------------------
  describe('import key format', () => {
    it('keys are unversioned (no @version suffix)', () => {
      for (const key of Object.keys(imports)) {
        expect(key).not.toMatch(/@\d/)
      }
    })

    it('expected interface keys are present', () => {
      expect(imports['wasi:cli/environment']).toBeDefined()
      expect(imports['wasi:cli/stdin']).toBeDefined()
      expect(imports['wasi:io/streams']).toBeDefined()
      expect(imports['wasi:io/poll']).toBeDefined()
      expect(imports['wasi:io/error']).toBeDefined()
      expect(imports['wasi:filesystem/types']).toBeDefined()
      expect(imports['wasi:filesystem/preopens']).toBeDefined()
      expect(imports['wasi:clocks/monotonic-clock']).toBeDefined()
      expect(imports['wasi:clocks/wall-clock']).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Resource classes exist and are constructable
  // ---------------------------------------------------------------------------
  describe('resource classes exist and are constructable', () => {
    it.each([
      ['wasi:filesystem/types', 'Descriptor'],
      ['wasi:filesystem/types', 'DirectoryEntryStream'],
      ['wasi:io/streams', 'InputStream'],
      ['wasi:io/streams', 'OutputStream'],
      ['wasi:io/poll', 'Pollable'],
      ['wasi:io/error', 'Error'],
      ['wasi:cli/terminal-input', 'TerminalInput'],
      ['wasi:cli/terminal-output', 'TerminalOutput'],
    ])('%s → %s', (ifaceKey, className) => {
      const iface = imports[ifaceKey] as Record<string, unknown>
      const cls = iface[className] as { prototype: object }
      expect(typeof cls).toBe('function')
      expect(cls.prototype).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Classes have prototype methods (camelCased)
  // ---------------------------------------------------------------------------
  describe('classes have prototype methods (camelCased)', () => {
    it('Descriptor.prototype.readViaStream', () => {
      const { Descriptor } = imports['wasi:filesystem/types'] as Record<
        string,
        { prototype: Record<string, unknown> }
      >
      expect(typeof Descriptor.prototype.readViaStream).toBe('function')
    })

    it('Descriptor.prototype.stat', () => {
      const { Descriptor } = imports['wasi:filesystem/types'] as Record<
        string,
        { prototype: Record<string, unknown> }
      >
      expect(typeof Descriptor.prototype.stat).toBe('function')
    })

    it('InputStream.prototype.read', () => {
      const { InputStream } = imports['wasi:io/streams'] as Record<
        string,
        { prototype: Record<string, unknown> }
      >
      expect(typeof InputStream.prototype.read).toBe('function')
    })

    it('OutputStream.prototype.write', () => {
      const { OutputStream } = imports['wasi:io/streams'] as Record<
        string,
        { prototype: Record<string, unknown> }
      >
      expect(typeof OutputStream.prototype.write).toBe('function')
    })

    it('InputStream.prototype.subscribe', () => {
      const { InputStream } = imports['wasi:io/streams'] as Record<
        string,
        { prototype: Record<string, unknown> }
      >
      expect(typeof InputStream.prototype.subscribe).toBe('function')
    })

    it('OutputStream.prototype.subscribe', () => {
      const { OutputStream } = imports['wasi:io/streams'] as Record<
        string,
        { prototype: Record<string, unknown> }
      >
      expect(typeof OutputStream.prototype.subscribe).toBe('function')
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Plain functions are camelCased
  // ---------------------------------------------------------------------------
  describe('plain functions are camelCased', () => {
    it('wasi:cli/environment → getEnvironment, getArguments', () => {
      const env = imports['wasi:cli/environment'] as Record<string, unknown>
      expect(typeof env.getEnvironment).toBe('function')
      expect(typeof env.getArguments).toBe('function')
    })

    it('wasi:cli/stdin → getStdin', () => {
      const stdin = imports['wasi:cli/stdin'] as Record<string, unknown>
      expect(typeof stdin.getStdin).toBe('function')
    })

    it('wasi:filesystem/preopens → getDirectories', () => {
      const preopens = imports['wasi:filesystem/preopens'] as Record<
        string,
        unknown
      >
      expect(typeof preopens.getDirectories).toBe('function')
    })

    it('wasi:io/poll → poll', () => {
      const poll = imports['wasi:io/poll'] as Record<string, unknown>
      expect(typeof poll.poll).toBe('function')
    })

    it('wasi:clocks/monotonic-clock → subscribeDuration', () => {
      const clocks = imports['wasi:clocks/monotonic-clock'] as Record<
        string,
        unknown
      >
      expect(typeof clocks.subscribeDuration).toBe('function')
    })
  })

  // ---------------------------------------------------------------------------
  // 5. _isHostProvided can be set on all exports
  // ---------------------------------------------------------------------------
  describe('_isHostProvided can be set on all exports', () => {
    it('every exported value accepts _isHostProvided = true', () => {
      for (const [ifaceKey, iface] of Object.entries(imports)) {
        for (const [name, value] of Object.entries(
          iface as Record<string, unknown>
        )) {
          expect(
            typeof value === 'function' || typeof value === 'object',
            `${ifaceKey}:${name} should be a function or object`,
          ).toBe(true)
          expect(() => {
            ;(value as Record<string, unknown>)._isHostProvided = true
          }).not.toThrow()
        }
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 6. Return value wrapping
  // ---------------------------------------------------------------------------
  describe('return value wrapping', () => {
    it('getStdin() returns instanceof InputStream', () => {
      const { InputStream } = imports['wasi:io/streams'] as Record<
        string,
        new (...args: unknown[]) => unknown
      >
      const { getStdin } = imports['wasi:cli/stdin'] as Record<
        string,
        () => unknown
      >
      const result = getStdin()
      expect(result).toBeInstanceOf(InputStream)
    })

    it('getDirectories() returns array of [instanceof Descriptor, string]', () => {
      const { Descriptor } = imports['wasi:filesystem/types'] as Record<
        string,
        new (...args: unknown[]) => unknown
      >
      const { getDirectories } = imports['wasi:filesystem/preopens'] as Record<
        string,
        () => [unknown, string][]
      >
      const result = getDirectories()
      expect(Array.isArray(result)).toBe(true)
      // With default empty preopens, array may be empty. If entries exist,
      // each should be [Descriptor instance, string].
      for (const [desc, path] of result) {
        expect(desc).toBeInstanceOf(Descriptor)
        expect(typeof path).toBe('string')
      }
    })

    it('getTerminalStdin() returns undefined (option type, no terminal)', () => {
      const { getTerminalStdin } = imports[
        'wasi:cli/terminal-stdin'
      ] as Record<string, () => unknown>
      const result = getTerminalStdin()
      expect(result).toBeUndefined()
    })

    it('subscribeDuration() returns instanceof Pollable', () => {
      const { Pollable } = imports['wasi:io/poll'] as Record<
        string,
        new (...args: unknown[]) => unknown
      >
      const { subscribeDuration } = imports[
        'wasi:clocks/monotonic-clock'
      ] as Record<string, (...args: unknown[]) => unknown>
      const result = subscribeDuration(1_000_000n)
      expect(result).toBeInstanceOf(Pollable)
    })

    it('InputStream.prototype.subscribe() returns instanceof Pollable', () => {
      const { InputStream } = imports['wasi:io/streams'] as Record<
        string,
        new (...args: unknown[]) => unknown
      >
      const { Pollable } = imports['wasi:io/poll'] as Record<
        string,
        new (...args: unknown[]) => unknown
      >
      const { getStdin } = imports['wasi:cli/stdin'] as Record<
        string,
        () => unknown
      >

      const stdinStream = getStdin() as { subscribe: () => unknown }
      expect(stdinStream).toBeInstanceOf(InputStream)

      const pollable = stdinStream.subscribe()
      expect(pollable).toBeInstanceOf(Pollable)
    })
  })

  // ---------------------------------------------------------------------------
  // 7. Argument unwrapping
  // ---------------------------------------------------------------------------
  describe('argument unwrapping', () => {
    it('poll() unwraps cabiRep from Pollable instances', async () => {
      const { subscribeDuration } = imports[
        'wasi:clocks/monotonic-clock'
      ] as Record<string, (...args: unknown[]) => unknown>
      const { poll } = imports['wasi:io/poll'] as Record<
        string,
        (pollables: unknown[]) => Promise<number[]>
      >

      // Create two Pollable instances via subscribeDuration (0ns = immediately ready)
      const p1 = subscribeDuration(0n) as Record<symbol, unknown>
      const p2 = subscribeDuration(0n) as Record<symbol, unknown>

      // Both should carry a cabiRep handle
      expect(p1[symbolCabiRep]).toBeDefined()
      expect(p2[symbolCabiRep]).toBeDefined()

      // poll() should unwrap cabiRep from each Pollable and pass raw handles
      const ready = await poll([p1, p2])
      expect(Array.isArray(ready)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // 8. getArguments() returns configured args
  // ---------------------------------------------------------------------------
  describe('getArguments() with configured args', () => {
    it('returns the args from policy configuration', async () => {
      const argPolyfill = new Polyfill({
        policy: createPolicy({
          defaultAllow: true,
          args: ['python', '-c', 'print("hello")'],
        }),
      })
      try {
        const result = await argPolyfill.forInterfaces(
          ['wasi:cli/environment@0.2.0'],
          { jcoCompat: true }
        )
        const env = result.imports['wasi:cli/environment'] as Record<
          string,
          (...args: unknown[]) => unknown
        >
        const args = env.getArguments()
        expect(args).toEqual(['python', '-c', 'print("hello")'])
      } finally {
        argPolyfill.destroy()
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 9. getStdout/getStderr return OutputStream instances
  // ---------------------------------------------------------------------------
  describe('stdout/stderr return OutputStream instances', () => {
    it('getStdout() returns instanceof OutputStream', () => {
      const { OutputStream } = imports['wasi:io/streams'] as Record<
        string,
        new (...args: unknown[]) => unknown
      >
      const { getStdout } = imports['wasi:cli/stdout'] as Record<
        string,
        () => unknown
      >
      const result = getStdout()
      expect(result).toBeInstanceOf(OutputStream)
    })

    it('getStderr() returns instanceof OutputStream', () => {
      const { OutputStream } = imports['wasi:io/streams'] as Record<
        string,
        new (...args: unknown[]) => unknown
      >
      const { getStderr } = imports['wasi:cli/stderr'] as Record<
        string,
        () => unknown
      >
      const result = getStderr()
      expect(result).toBeInstanceOf(OutputStream)
    })
  })

  // ---------------------------------------------------------------------------
  // 10. Blocking stream methods return synchronously
  // ---------------------------------------------------------------------------
  describe('blocking stream methods return synchronously', () => {
    it('OutputStream.blockingWriteAndFlush returns synchronously', () => {
      const { getStdout } = imports['wasi:cli/stdout'] as Record<
        string,
        () => unknown
      >
      const stdout = getStdout() as Record<string, (...args: unknown[]) => unknown>

      // Call blockingWriteAndFlush with a small payload
      const result = stdout.blockingWriteAndFlush(new Uint8Array([104, 105]))
      expect(result).not.toBeInstanceOf(Promise)
    })
  })

  // ---------------------------------------------------------------------------
  // createJcoPolyfill defaults to jco-compat mode
  // ---------------------------------------------------------------------------
  describe('createJcoPolyfill default jcoCompat', () => {
    it('produces unversioned keys without per-call jcoCompat', async () => {
      await registerCorePlugins()
      const p = createJcoPolyfill()
      // Note: no { jcoCompat: true } passed here — it must default on.
      const { imports: jcoImports } = await p.forInterfaces([
        'wasi:io/streams@0.2.0',
        'wasi:cli/stdout@0.2.0',
      ])
      expect(jcoImports['wasi:io/streams']).toBeDefined()
      for (const key of Object.keys(jcoImports)) {
        expect(key).not.toMatch(/@\d/)
      }
      p.destroy()
    })
  })
})
