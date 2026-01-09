/**
 * WASI CLI 0.3.0 Interface Tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  CliExitError,
  createStdinFromString,
  createStdinFromLines,
  createCollectingWriter,
  createConsoleWriter,
  getCliImports,
  type CliConfig,
  type ExitStatus,
} from '../../src/wasip3/interfaces/cli.js'

describe('WASIP3 CLI Interface', () => {
  describe('CliExitError', () => {
    it('creates error with ok status', () => {
      const status: ExitStatus = { tag: 'ok' }
      const error = new CliExitError(status)

      expect(error.name).toBe('CliExitError')
      expect(error.status).toBe(status)
      expect(error.code).toBe(0)
      expect(error.message).toBe('Component exited with code 0')
    })

    it('creates error with err status', () => {
      const status: ExitStatus = { tag: 'err', val: 1 }
      const error = new CliExitError(status)

      expect(error.code).toBe(1)
      expect(error.message).toBe('Component exited with code 1')
    })

    it('handles various exit codes', () => {
      expect(new CliExitError({ tag: 'err', val: 0 }).code).toBe(0)
      expect(new CliExitError({ tag: 'err', val: 1 }).code).toBe(1)
      expect(new CliExitError({ tag: 'err', val: 127 }).code).toBe(127)
      expect(new CliExitError({ tag: 'err', val: 255 }).code).toBe(255)
    })

    it('is instanceof Error', () => {
      const error = new CliExitError({ tag: 'ok' })
      expect(error instanceof Error).toBe(true)
      expect(error instanceof CliExitError).toBe(true)
    })
  })

  describe('createStdinFromString', () => {
    it('creates stream from string', async () => {
      const stream = createStdinFromString('hello world')

      const result = await stream.read()
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        const decoder = new TextDecoder()
        expect(decoder.decode(result.values[0])).toBe('hello world')
      }
    })

    it('returns end after first read', async () => {
      const stream = createStdinFromString('test')

      await stream.read() // consume
      const result = await stream.read()
      expect(result.status).toBe('end')
    })

    it('handles empty string', async () => {
      const stream = createStdinFromString('')

      const result = await stream.read()
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(result.values[0]!.length).toBe(0)
      }
    })

    it('handles unicode characters', async () => {
      const stream = createStdinFromString('你好世界 🌍')

      const result = await stream.read()
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        const decoder = new TextDecoder()
        expect(decoder.decode(result.values[0])).toBe('你好世界 🌍')
      }
    })

    it('close() marks stream as consumed', async () => {
      const stream = createStdinFromString('test')
      stream.close()

      const result = await stream.read()
      expect(result.status).toBe('end')
    })

    it('cancel() marks stream as consumed', async () => {
      const stream = createStdinFromString('test')
      stream.cancel()

      const result = await stream.read()
      expect(result.status).toBe('end')
    })
  })

  describe('createStdinFromLines', () => {
    it('creates stream from lines', async () => {
      const stream = createStdinFromLines(['line1', 'line2', 'line3'])

      const decoder = new TextDecoder()

      const r1 = await stream.read()
      expect(r1.status).toBe('values')
      if (r1.status === 'values') {
        expect(decoder.decode(r1.values[0])).toBe('line1\n')
      }

      const r2 = await stream.read()
      expect(r2.status).toBe('values')
      if (r2.status === 'values') {
        expect(decoder.decode(r2.values[0])).toBe('line2\n')
      }

      const r3 = await stream.read()
      expect(r3.status).toBe('values')
      if (r3.status === 'values') {
        expect(decoder.decode(r3.values[0])).toBe('line3\n')
      }
    })

    it('returns end after all lines consumed', async () => {
      const stream = createStdinFromLines(['one', 'two'])

      await stream.read()
      await stream.read()
      const result = await stream.read()

      expect(result.status).toBe('end')
    })

    it('handles empty lines array', async () => {
      const stream = createStdinFromLines([])

      const result = await stream.read()
      expect(result.status).toBe('end')
    })

    it('handles empty line strings', async () => {
      const stream = createStdinFromLines(['', ''])

      const decoder = new TextDecoder()

      const r1 = await stream.read()
      if (r1.status === 'values') {
        expect(decoder.decode(r1.values[0])).toBe('\n')
      }
    })

    it('close() prevents further reads', async () => {
      const stream = createStdinFromLines(['a', 'b', 'c'])

      await stream.read()
      stream.close()

      const result = await stream.read()
      expect(result.status).toBe('end')
    })

    it('cancel() prevents further reads', async () => {
      const stream = createStdinFromLines(['a', 'b', 'c'])

      await stream.read()
      stream.cancel()

      const result = await stream.read()
      expect(result.status).toBe('end')
    })
  })

  describe('createCollectingWriter', () => {
    it('collects written output', async () => {
      const { writer, getOutput } = createCollectingWriter()
      const encoder = new TextEncoder()

      await writer.write([encoder.encode('Hello, ')])
      await writer.write([encoder.encode('World!')])

      expect(getOutput()).toBe('Hello, World!')
    })

    it('handles multiple values in single write', async () => {
      const { writer, getOutput } = createCollectingWriter()
      const encoder = new TextEncoder()

      await writer.write([encoder.encode('a'), encoder.encode('b'), encoder.encode('c')])

      expect(getOutput()).toBe('abc')
    })

    it('returns empty string before any writes', () => {
      const { getOutput } = createCollectingWriter()
      expect(getOutput()).toBe('')
    })

    it('returns ok status', async () => {
      const { writer } = createCollectingWriter()
      const encoder = new TextEncoder()

      const result = await writer.write([encoder.encode('test')])
      expect(result.status).toBe('ok')
      expect(result.count).toBe(1)
    })

    it('returns correct count for multiple values', async () => {
      const { writer } = createCollectingWriter()
      const encoder = new TextEncoder()

      const result = await writer.write([
        encoder.encode('a'),
        encoder.encode('b'),
        encoder.encode('c'),
      ])
      expect(result.count).toBe(3)
    })

    it('handles unicode characters', async () => {
      const { writer, getOutput } = createCollectingWriter()
      const encoder = new TextEncoder()

      await writer.write([encoder.encode('日本語 🇯🇵')])

      expect(getOutput()).toBe('日本語 🇯🇵')
    })

    it('close() does not affect output', async () => {
      const { writer, getOutput } = createCollectingWriter()
      const encoder = new TextEncoder()

      await writer.write([encoder.encode('test')])
      writer.close()

      expect(getOutput()).toBe('test')
    })

    it('cancel() does not affect output', async () => {
      const { writer, getOutput } = createCollectingWriter()
      const encoder = new TextEncoder()

      await writer.write([encoder.encode('test')])
      writer.cancel()

      expect(getOutput()).toBe('test')
    })
  })

  describe('createConsoleWriter', () => {
    it('creates writer without prefix', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const writer = createConsoleWriter()
      const encoder = new TextEncoder()

      await writer.write([encoder.encode('test\n')])

      expect(consoleSpy).toHaveBeenCalledWith('test')
      consoleSpy.mockRestore()
    })

    it('creates writer with prefix', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const writer = createConsoleWriter('[prefix] ')
      const encoder = new TextEncoder()

      await writer.write([encoder.encode('message\n')])

      expect(consoleSpy).toHaveBeenCalledWith('[prefix] message')
      consoleSpy.mockRestore()
    })

    it('buffers incomplete lines', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const writer = createConsoleWriter()
      const encoder = new TextEncoder()

      await writer.write([encoder.encode('partial')])
      expect(consoleSpy).not.toHaveBeenCalled()

      await writer.write([encoder.encode(' text\n')])
      expect(consoleSpy).toHaveBeenCalledWith('partial text')

      consoleSpy.mockRestore()
    })

    it('flushes on close', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const writer = createConsoleWriter()
      const encoder = new TextEncoder()

      await writer.write([encoder.encode('no newline')])
      expect(consoleSpy).not.toHaveBeenCalled()

      writer.close()
      expect(consoleSpy).toHaveBeenCalledWith('no newline')

      consoleSpy.mockRestore()
    })

    it('handles multiple lines in single write', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const writer = createConsoleWriter()
      const encoder = new TextEncoder()

      await writer.write([encoder.encode('line1\nline2\nline3\n')])

      expect(consoleSpy).toHaveBeenCalledTimes(3)
      expect(consoleSpy).toHaveBeenNthCalledWith(1, 'line1')
      expect(consoleSpy).toHaveBeenNthCalledWith(2, 'line2')
      expect(consoleSpy).toHaveBeenNthCalledWith(3, 'line3')

      consoleSpy.mockRestore()
    })

    it('returns ok status', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const writer = createConsoleWriter()
      const encoder = new TextEncoder()

      const result = await writer.write([encoder.encode('test\n')])
      expect(result.status).toBe('ok')
      expect(result.count).toBe(1)

      vi.restoreAllMocks()
    })
  })

  describe('getCliImports', () => {
    it('returns import object with all CLI interfaces', () => {
      const config: CliConfig = { args: [], env: {} }
      const imports = getCliImports(config)

      expect(imports).toHaveProperty('wasi:cli/environment@0.3.0')
      expect(imports).toHaveProperty('wasi:cli/exit@0.3.0')
      expect(imports).toHaveProperty('wasi:cli/stdin@0.3.0')
      expect(imports).toHaveProperty('wasi:cli/stdout@0.3.0')
      expect(imports).toHaveProperty('wasi:cli/stderr@0.3.0')
      expect(imports).toHaveProperty('wasi:cli/terminal-input@0.3.0')
      expect(imports).toHaveProperty('wasi:cli/terminal-output@0.3.0')
      expect(imports).toHaveProperty('wasi:cli/terminal-stdin@0.3.0')
      expect(imports).toHaveProperty('wasi:cli/terminal-stdout@0.3.0')
      expect(imports).toHaveProperty('wasi:cli/terminal-stderr@0.3.0')
    })

    describe('environment imports', () => {
      it('returns arguments', () => {
        const config: CliConfig = { args: ['prog', 'arg1', 'arg2'], env: {} }
        const imports = getCliImports(config)
        const env = imports['wasi:cli/environment@0.3.0'] as Record<string, Function>

        expect(env['get-arguments']()).toEqual(['prog', 'arg1', 'arg2'])
      })

      it('returns environment variables', () => {
        const config: CliConfig = { args: [], env: { HOME: '/home', PATH: '/bin' } }
        const imports = getCliImports(config)
        const env = imports['wasi:cli/environment@0.3.0'] as Record<string, Function>

        expect(env['get-environment']()).toEqual([
          ['HOME', '/home'],
          ['PATH', '/bin'],
        ])
      })

      it('returns undefined for initial-cwd', () => {
        const config: CliConfig = { args: [], env: {} }
        const imports = getCliImports(config)
        const env = imports['wasi:cli/environment@0.3.0'] as Record<string, Function>

        expect(env['initial-cwd']()).toBeUndefined()
      })
    })

    describe('exit import', () => {
      it('throws CliExitError on exit', () => {
        const config: CliConfig = { args: [], env: {} }
        const imports = getCliImports(config)
        const exit = imports['wasi:cli/exit@0.3.0'] as Record<string, Function>

        expect(() => exit.exit({ tag: 'ok' })).toThrow(CliExitError)
      })

      it('includes exit code in error', () => {
        const config: CliConfig = { args: [], env: {} }
        const imports = getCliImports(config)
        const exit = imports['wasi:cli/exit@0.3.0'] as Record<string, Function>

        try {
          exit.exit({ tag: 'err', val: 42 })
        } catch (e) {
          expect(e).toBeInstanceOf(CliExitError)
          expect((e as CliExitError).code).toBe(42)
        }
      })
    })

    describe('stdin/stdout/stderr imports', () => {
      it('returns provided stdin stream', () => {
        const stdin = createStdinFromString('input')
        const config: CliConfig = { args: [], env: {}, stdin }
        const imports = getCliImports(config)
        const stdinIface = imports['wasi:cli/stdin@0.3.0'] as Record<string, Function>

        expect(stdinIface['get-stdin']()).toBe(stdin)
      })

      it('returns provided stdout writer', () => {
        const { writer } = createCollectingWriter()
        const config: CliConfig = { args: [], env: {}, stdout: writer }
        const imports = getCliImports(config)
        const stdoutIface = imports['wasi:cli/stdout@0.3.0'] as Record<string, Function>

        expect(stdoutIface['get-stdout']()).toBe(writer)
      })

      it('returns provided stderr writer', () => {
        const { writer } = createCollectingWriter()
        const config: CliConfig = { args: [], env: {}, stderr: writer }
        const imports = getCliImports(config)
        const stderrIface = imports['wasi:cli/stderr@0.3.0'] as Record<string, Function>

        expect(stderrIface['get-stderr']()).toBe(writer)
      })

      it('creates default streams when not provided', () => {
        const config: CliConfig = { args: [], env: {} }
        const imports = getCliImports(config)

        const stdinIface = imports['wasi:cli/stdin@0.3.0'] as Record<string, Function>
        const stdoutIface = imports['wasi:cli/stdout@0.3.0'] as Record<string, Function>
        const stderrIface = imports['wasi:cli/stderr@0.3.0'] as Record<string, Function>

        expect(stdinIface['get-stdin']()).toBeDefined()
        expect(stdoutIface['get-stdout']()).toBeDefined()
        expect(stderrIface['get-stderr']()).toBeDefined()
      })
    })

    describe('terminal imports', () => {
      it('returns undefined for terminal stdin', () => {
        const config: CliConfig = { args: [], env: {} }
        const imports = getCliImports(config)
        const term = imports['wasi:cli/terminal-stdin@0.3.0'] as Record<string, Function>

        expect(term['get-terminal-stdin']()).toBeUndefined()
      })

      it('returns undefined for terminal stdout', () => {
        const config: CliConfig = { args: [], env: {} }
        const imports = getCliImports(config)
        const term = imports['wasi:cli/terminal-stdout@0.3.0'] as Record<string, Function>

        expect(term['get-terminal-stdout']()).toBeUndefined()
      })

      it('returns undefined for terminal stderr', () => {
        const config: CliConfig = { args: [], env: {} }
        const imports = getCliImports(config)
        const term = imports['wasi:cli/terminal-stderr@0.3.0'] as Record<string, Function>

        expect(term['get-terminal-stderr']()).toBeUndefined()
      })
    })
  })
})
