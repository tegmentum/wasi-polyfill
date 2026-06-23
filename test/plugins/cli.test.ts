/**
 * Tests for wasi:cli plugins
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  environmentPlugin,
  stdinPlugin,
  stdoutPlugin,
  stderrPlugin,
  exitPlugin,
  terminalInputPlugin,
  terminalOutputPlugin,
  terminalStdinPlugin,
  terminalStdoutPlugin,
  terminalStderrPlugin,
  cliPlugins,
  virtualEnvironmentImplementation,
  browserEnvironmentImplementation,
  virtualStdinImplementation,
  virtualStdoutImplementation,
  virtualStderrImplementation,
  defaultExitImplementation,
  silentExitImplementation,
  noTerminalInputImplementation,
  noTerminalOutputImplementation,
  noTerminalStdinImplementation,
  noTerminalStdoutImplementation,
  noTerminalStderrImplementation,
  virtualTerminalStdinImplementation,
  virtualTerminalStdoutImplementation,
  virtualTerminalStderrImplementation,
  autoTerminalStdinImplementation,
  autoTerminalStdoutImplementation,
  autoTerminalStderrImplementation,
  globalTerminalRegistry,
  ComponentExitError,
  ENVIRONMENT_INTERFACE,
  STDIN_INTERFACE,
  STDOUT_INTERFACE,
  STDERR_INTERFACE,
  EXIT_INTERFACE,
  TERMINAL_INPUT_INTERFACE,
  TERMINAL_OUTPUT_INTERFACE,
  TERMINAL_STDIN_INTERFACE,
  TERMINAL_STDOUT_INTERFACE,
  TERMINAL_STDERR_INTERFACE,
  // Stdio Provider exports
  createConsoleStdio,
  createXtermStdio,
  createCustomStdio,
  createStdioProvider,
  QueueInputStream,
  WasiInputStreamWrapper,
  ConsoleOutputStream,
  EmptyInputStream,
  setGlobalStdioProvider,
  resetGlobalStdioState,
  isStdinTTY,
  isStdoutTTY,
  isStderrTTY,
} from '../../src/wasip2/plugins/cli/index.js'
import { globalStreamRegistry } from '../../src/wasip2/plugins/io/streams.js'

describe('CLI Plugins', () => {
  describe('Plugin Definitions', () => {
    it('should define environment plugin correctly', () => {
      expect(environmentPlugin.witInterface).toEqual(ENVIRONMENT_INTERFACE)
      expect(environmentPlugin.witInterface.package).toBe('wasi:cli')
      expect(environmentPlugin.witInterface.name).toBe('environment')
      expect(environmentPlugin.defaultImplementation).toBe('virtual')
    })

    it('should define stdin plugin correctly', () => {
      expect(stdinPlugin.witInterface).toEqual(STDIN_INTERFACE)
      expect(stdinPlugin.witInterface.package).toBe('wasi:cli')
      expect(stdinPlugin.witInterface.name).toBe('stdin')
      expect(stdinPlugin.defaultImplementation).toBe('virtual')
    })

    it('should define stdout plugin correctly', () => {
      expect(stdoutPlugin.witInterface).toEqual(STDOUT_INTERFACE)
      expect(stdoutPlugin.witInterface.package).toBe('wasi:cli')
      expect(stdoutPlugin.witInterface.name).toBe('stdout')
      expect(stdoutPlugin.defaultImplementation).toBe('virtual')
    })

    it('should define stderr plugin correctly', () => {
      expect(stderrPlugin.witInterface).toEqual(STDERR_INTERFACE)
      expect(stderrPlugin.witInterface.package).toBe('wasi:cli')
      expect(stderrPlugin.witInterface.name).toBe('stderr')
      expect(stderrPlugin.defaultImplementation).toBe('virtual')
    })

    it('should define exit plugin correctly', () => {
      expect(exitPlugin.witInterface).toEqual(EXIT_INTERFACE)
      expect(exitPlugin.witInterface.package).toBe('wasi:cli')
      expect(exitPlugin.witInterface.name).toBe('exit')
      expect(exitPlugin.defaultImplementation).toBe('default')
    })

    it('should define terminal-input plugin correctly', () => {
      expect(terminalInputPlugin.witInterface).toEqual(TERMINAL_INPUT_INTERFACE)
      expect(terminalInputPlugin.witInterface.package).toBe('wasi:cli')
      expect(terminalInputPlugin.witInterface.name).toBe('terminal-input')
      expect(terminalInputPlugin.defaultImplementation).toBe('none')
    })

    it('should define terminal-output plugin correctly', () => {
      expect(terminalOutputPlugin.witInterface).toEqual(TERMINAL_OUTPUT_INTERFACE)
      expect(terminalOutputPlugin.witInterface.package).toBe('wasi:cli')
      expect(terminalOutputPlugin.witInterface.name).toBe('terminal-output')
      expect(terminalOutputPlugin.defaultImplementation).toBe('none')
    })

    it('should define terminal-stdin plugin correctly', () => {
      expect(terminalStdinPlugin.witInterface).toEqual(TERMINAL_STDIN_INTERFACE)
      expect(terminalStdinPlugin.witInterface.package).toBe('wasi:cli')
      expect(terminalStdinPlugin.witInterface.name).toBe('terminal-stdin')
      expect(terminalStdinPlugin.defaultImplementation).toBe('none')
    })

    it('should define terminal-stdout plugin correctly', () => {
      expect(terminalStdoutPlugin.witInterface).toEqual(TERMINAL_STDOUT_INTERFACE)
      expect(terminalStdoutPlugin.witInterface.package).toBe('wasi:cli')
      expect(terminalStdoutPlugin.witInterface.name).toBe('terminal-stdout')
      expect(terminalStdoutPlugin.defaultImplementation).toBe('none')
    })

    it('should define terminal-stderr plugin correctly', () => {
      expect(terminalStderrPlugin.witInterface).toEqual(TERMINAL_STDERR_INTERFACE)
      expect(terminalStderrPlugin.witInterface.package).toBe('wasi:cli')
      expect(terminalStderrPlugin.witInterface.name).toBe('terminal-stderr')
      expect(terminalStderrPlugin.defaultImplementation).toBe('none')
    })

    it('should export all CLI plugins', () => {
      expect(cliPlugins).toHaveLength(10)
      expect(cliPlugins).toContain(environmentPlugin)
      expect(cliPlugins).toContain(stdinPlugin)
      expect(cliPlugins).toContain(stdoutPlugin)
      expect(cliPlugins).toContain(stderrPlugin)
      expect(cliPlugins).toContain(exitPlugin)
      expect(cliPlugins).toContain(terminalInputPlugin)
      expect(cliPlugins).toContain(terminalOutputPlugin)
      expect(cliPlugins).toContain(terminalStdinPlugin)
      expect(cliPlugins).toContain(terminalStdoutPlugin)
      expect(cliPlugins).toContain(terminalStderrPlugin)
    })
  })

  describe('Environment Plugin', () => {
    describe('Virtual Implementation', () => {
      it('should create an instance', () => {
        const instance = virtualEnvironmentImplementation.create({ interface: ENVIRONMENT_INTERFACE })
        expect(instance).toBeDefined()
        expect(instance.getImports).toBeDefined()
        expect(instance.destroy).toBeDefined()
      })

      it('should return empty environment and args by default', () => {
        const instance = virtualEnvironmentImplementation.create({ interface: ENVIRONMENT_INTERFACE })
        const imports = instance.getImports() as {
          'get-environment': () => Array<[string, string]>
          'get-arguments': () => string[]
          'initial-cwd': () => string | undefined
        }

        expect(imports['get-environment']()).toEqual([])
        expect(imports['get-arguments']()).toEqual([])
        expect(imports['initial-cwd']()).toBe('/')
      })

      it('should allow configuring environment variables', () => {
        const instance = virtualEnvironmentImplementation.create({
          interface: ENVIRONMENT_INTERFACE,
          options: {
            env: { FOO: 'bar', BAZ: 'qux' },
          },
        })
        const imports = instance.getImports() as {
          'get-environment': () => Array<[string, string]>
        }

        const env = imports['get-environment']()
        expect(env).toContainEqual(['FOO', 'bar'])
        expect(env).toContainEqual(['BAZ', 'qux'])
      })

      it('should allow configuring arguments', () => {
        const instance = virtualEnvironmentImplementation.create({
          interface: ENVIRONMENT_INTERFACE,
          options: {
            args: ['--flag', 'value', 'file.txt'],
          },
        })
        const imports = instance.getImports() as {
          'get-arguments': () => string[]
        }

        expect(imports['get-arguments']()).toEqual(['--flag', 'value', 'file.txt'])
      })

      it('should allow configuring working directory', () => {
        const instance = virtualEnvironmentImplementation.create({
          interface: ENVIRONMENT_INTERFACE,
          options: {
            cwd: '/home/user/project',
          },
        })
        const imports = instance.getImports() as {
          'initial-cwd': () => string | undefined
        }

        expect(imports['initial-cwd']()).toBe('/home/user/project')
      })

      it('should return a copy of arguments (not mutable reference)', () => {
        const instance = virtualEnvironmentImplementation.create({
          interface: ENVIRONMENT_INTERFACE,
          options: {
            args: ['arg1', 'arg2'],
          },
        })
        const imports = instance.getImports() as {
          'get-arguments': () => string[]
        }

        const args1 = imports['get-arguments']()
        const args2 = imports['get-arguments']()
        expect(args1).not.toBe(args2)
        expect(args1).toEqual(args2)
      })
    })

    describe('Browser Implementation', () => {
      it('should create an instance', () => {
        const instance = browserEnvironmentImplementation.create({ interface: ENVIRONMENT_INTERFACE })
        expect(instance).toBeDefined()
      })

      it('should allow configuring environment via options', () => {
        const instance = browserEnvironmentImplementation.create({
          interface: ENVIRONMENT_INTERFACE,
          options: {
            env: { TEST: 'value' },
          },
        })
        const imports = instance.getImports() as {
          'get-environment': () => Array<[string, string]>
        }

        const env = imports['get-environment']()
        expect(env).toContainEqual(['TEST', 'value'])
      })

      it('should return root as initial cwd', () => {
        const instance = browserEnvironmentImplementation.create({ interface: ENVIRONMENT_INTERFACE })
        const imports = instance.getImports() as {
          'initial-cwd': () => string | undefined
        }

        expect(imports['initial-cwd']()).toBe('/')
      })
    })
  })

  describe('Stdio Plugins', () => {
    describe('Stdin', () => {
      it('should create an instance', () => {
        const instance = virtualStdinImplementation.create({ interface: STDIN_INTERFACE })
        expect(instance).toBeDefined()
      })

      it('should return a stream handle', () => {
        const instance = virtualStdinImplementation.create({ interface: STDIN_INTERFACE })
        const imports = instance.getImports() as {
          'get-stdin': () => number
        }

        const handle = imports['get-stdin']()
        expect(typeof handle).toBe('number')
        expect(handle).toBeGreaterThan(0)
      })

      it('should allow configuring stdin content as string', () => {
        const instance = virtualStdinImplementation.create({
          interface: STDIN_INTERFACE,
          options: {
            stdinContent: 'Hello, World!',
          },
        })
        const imports = instance.getImports() as {
          'get-stdin': () => number
        }

        const handle = imports['get-stdin']()
        const stream = globalStreamRegistry.getInput(handle)
        expect(stream).toBeDefined()

        const data = stream!.read(100n)
        expect(data).toBeInstanceOf(Uint8Array)
        expect(new TextDecoder().decode(data as Uint8Array)).toBe('Hello, World!')
      })

      it('should allow configuring stdin content as Uint8Array', () => {
        const content = new TextEncoder().encode('Binary data')
        const instance = virtualStdinImplementation.create({
          interface: STDIN_INTERFACE,
          options: {
            stdinContent: content,
          },
        })
        const imports = instance.getImports() as {
          'get-stdin': () => number
        }

        const handle = imports['get-stdin']()
        const stream = globalStreamRegistry.getInput(handle)
        const data = stream!.read(100n)
        expect(new TextDecoder().decode(data as Uint8Array)).toBe('Binary data')
      })
    })

    describe('Stdout', () => {
      it('should create an instance', () => {
        const instance = virtualStdoutImplementation.create({ interface: STDOUT_INTERFACE })
        expect(instance).toBeDefined()
      })

      it('should return a stream handle', () => {
        const instance = virtualStdoutImplementation.create({ interface: STDOUT_INTERFACE })
        const imports = instance.getImports() as {
          'get-stdout': () => number
        }

        const handle = imports['get-stdout']()
        expect(typeof handle).toBe('number')
        expect(handle).toBeGreaterThan(0)
      })

      it('should call onStdout callback when writing', () => {
        const callback = vi.fn()
        const instance = virtualStdoutImplementation.create({
          interface: STDOUT_INTERFACE,
          options: {
            onStdout: callback,
          },
        })
        const imports = instance.getImports() as {
          'get-stdout': () => number
        }

        const handle = imports['get-stdout']()
        const stream = globalStreamRegistry.getOutput(handle)
        const data = new TextEncoder().encode('test output')
        stream!.write(data)

        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith(data)
      })
    })

    describe('Stderr', () => {
      it('should create an instance', () => {
        const instance = virtualStderrImplementation.create({ interface: STDERR_INTERFACE })
        expect(instance).toBeDefined()
      })

      it('should return a stream handle', () => {
        const instance = virtualStderrImplementation.create({ interface: STDERR_INTERFACE })
        const imports = instance.getImports() as {
          'get-stderr': () => number
        }

        const handle = imports['get-stderr']()
        expect(typeof handle).toBe('number')
        expect(handle).toBeGreaterThan(0)
      })

      it('should call onStderr callback when writing', () => {
        const callback = vi.fn()
        const instance = virtualStderrImplementation.create({
          interface: STDERR_INTERFACE,
          options: {
            onStderr: callback,
          },
        })
        const imports = instance.getImports() as {
          'get-stderr': () => number
        }

        const handle = imports['get-stderr']()
        const stream = globalStreamRegistry.getOutput(handle)
        const data = new TextEncoder().encode('error output')
        stream!.write(data)

        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith(data)
      })
    })
  })

  describe('Exit Plugin', () => {
    describe('ComponentExitError', () => {
      it('should create error for successful exit', () => {
        const error = new ComponentExitError({ ok: true, code: 0 })
        expect(error.message).toBe('Component exited successfully')
        expect(error.name).toBe('ComponentExitError')
        expect(error.status.ok).toBe(true)
        expect(error.status.code).toBe(0)
      })

      it('should create error for failed exit', () => {
        const error = new ComponentExitError({ ok: false, code: 1 })
        expect(error.message).toBe('Component exited with error code 1')
        expect(error.status.ok).toBe(false)
        expect(error.status.code).toBe(1)
      })
    })

    describe('Default Implementation', () => {
      it('should create an instance', () => {
        const instance = defaultExitImplementation.create({ interface: EXIT_INTERFACE })
        expect(instance).toBeDefined()
      })

      it('should throw ComponentExitError on exit with ok result', () => {
        const instance = defaultExitImplementation.create({ interface: EXIT_INTERFACE })
        const imports = instance.getImports() as {
          exit: (status: { tag: 'ok' } | { tag: 'err'; val: unknown }) => void
        }

        expect(() => imports.exit({ tag: 'ok' })).toThrow(ComponentExitError)
        try {
          imports.exit({ tag: 'ok' })
        } catch (e) {
          expect((e as ComponentExitError).status.ok).toBe(true)
          expect((e as ComponentExitError).status.code).toBe(0)
        }
      })

      it('should throw ComponentExitError on exit with err result', () => {
        const instance = defaultExitImplementation.create({ interface: EXIT_INTERFACE })
        const imports = instance.getImports() as {
          exit: (status: { tag: 'ok' } | { tag: 'err'; val: unknown }) => void
        }

        expect(() => imports.exit({ tag: 'err', val: 'some error' })).toThrow(ComponentExitError)
        try {
          imports.exit({ tag: 'err', val: 'some error' })
        } catch (e) {
          expect((e as ComponentExitError).status.ok).toBe(false)
          expect((e as ComponentExitError).status.code).toBe(1)
        }
      })

      it('should call onExit callback', () => {
        const onExit = vi.fn()
        const instance = defaultExitImplementation.create({
          interface: EXIT_INTERFACE,
          options: { onExit },
        })
        const imports = instance.getImports() as {
          exit: (status: { tag: 'ok' } | { tag: 'err'; val: unknown }) => void
        }

        try {
          imports.exit({ tag: 'ok' })
        } catch {
          // Expected
        }

        expect(onExit).toHaveBeenCalledTimes(1)
        expect(onExit).toHaveBeenCalledWith({ ok: true, code: 0 })
      })

      it('should allow disabling throw on exit', () => {
        const instance = defaultExitImplementation.create({
          interface: EXIT_INTERFACE,
          options: { throwOnExit: false },
        })
        const imports = instance.getImports() as {
          exit: (status: { tag: 'ok' } | { tag: 'err'; val: unknown }) => void
        }

        expect(() => imports.exit({ tag: 'ok' })).not.toThrow()
      })
    })

    describe('Silent Implementation', () => {
      it('should not throw on exit', () => {
        const instance = silentExitImplementation.create({ interface: EXIT_INTERFACE })
        const imports = instance.getImports() as {
          exit: (status: { tag: 'ok' } | { tag: 'err'; val: unknown }) => void
        }

        expect(() => imports.exit({ tag: 'ok' })).not.toThrow()
        expect(() => imports.exit({ tag: 'err', val: 'error' })).not.toThrow()
      })

      it('should still call onExit callback', () => {
        const onExit = vi.fn()
        const instance = silentExitImplementation.create({
          interface: EXIT_INTERFACE,
          options: { onExit },
        })
        const imports = instance.getImports() as {
          exit: (status: { tag: 'ok' } | { tag: 'err'; val: unknown }) => void
        }

        imports.exit({ tag: 'ok' })
        imports.exit({ tag: 'err', val: 'error' })

        expect(onExit).toHaveBeenCalledTimes(2)
        expect(onExit).toHaveBeenNthCalledWith(1, { ok: true, code: 0 })
        expect(onExit).toHaveBeenNthCalledWith(2, { ok: false, code: 1 })
      })
    })
  })

  describe('Terminal Plugins', () => {
    describe('Terminal Input', () => {
      it('should create an instance', () => {
        const instance = noTerminalInputImplementation.create({ interface: TERMINAL_INPUT_INTERFACE })
        expect(instance).toBeDefined()
      })

      it('should provide resource drop function', () => {
        const instance = noTerminalInputImplementation.create({ interface: TERMINAL_INPUT_INTERFACE })
        const imports = instance.getImports() as {
          '[resource-drop]terminal-input': (handle: number) => void
        }

        expect(imports['[resource-drop]terminal-input']).toBeDefined()
        expect(typeof imports['[resource-drop]terminal-input']).toBe('function')
      })
    })

    describe('Terminal Output', () => {
      it('should create an instance', () => {
        const instance = noTerminalOutputImplementation.create({ interface: TERMINAL_OUTPUT_INTERFACE })
        expect(instance).toBeDefined()
      })

      it('should provide resource drop function', () => {
        const instance = noTerminalOutputImplementation.create({ interface: TERMINAL_OUTPUT_INTERFACE })
        const imports = instance.getImports() as {
          '[resource-drop]terminal-output': (handle: number) => void
        }

        expect(imports['[resource-drop]terminal-output']).toBeDefined()
        expect(typeof imports['[resource-drop]terminal-output']).toBe('function')
      })
    })

    describe('Terminal Stdin', () => {
      describe('No Terminal Implementation', () => {
        it('should create an instance', () => {
          const instance = noTerminalStdinImplementation.create({ interface: TERMINAL_STDIN_INTERFACE })
          expect(instance).toBeDefined()
        })

        it('should return undefined (no terminal)', () => {
          const instance = noTerminalStdinImplementation.create({ interface: TERMINAL_STDIN_INTERFACE })
          const imports = instance.getImports() as {
            'get-terminal-stdin': () => number | undefined
          }

          expect(imports['get-terminal-stdin']()).toBeUndefined()
        })
      })

      describe('Virtual Terminal Implementation', () => {
        it('should create an instance', () => {
          const instance = virtualTerminalStdinImplementation.create({ interface: TERMINAL_STDIN_INTERFACE })
          expect(instance).toBeDefined()
        })

        it('should return a terminal handle', () => {
          const instance = virtualTerminalStdinImplementation.create({ interface: TERMINAL_STDIN_INTERFACE })
          const imports = instance.getImports() as {
            'get-terminal-stdin': () => number | undefined
          }

          const handle = imports['get-terminal-stdin']()
          expect(handle).toBeDefined()
          expect(typeof handle).toBe('number')
          expect(handle).toBeGreaterThan(0)

          // Verify handle is registered
          expect(globalTerminalRegistry.getInput(handle!)).toBeDefined()

          instance.destroy()
        })

        it('should clean up on destroy', () => {
          const instance = virtualTerminalStdinImplementation.create({ interface: TERMINAL_STDIN_INTERFACE })
          const imports = instance.getImports() as {
            'get-terminal-stdin': () => number | undefined
          }

          const handle = imports['get-terminal-stdin']()!
          instance.destroy()

          // Handle should be unregistered
          expect(globalTerminalRegistry.getInput(handle)).toBeUndefined()
        })
      })
    })

    describe('Terminal Stdout', () => {
      describe('No Terminal Implementation', () => {
        it('should create an instance', () => {
          const instance = noTerminalStdoutImplementation.create({ interface: TERMINAL_STDOUT_INTERFACE })
          expect(instance).toBeDefined()
        })

        it('should return undefined (no terminal)', () => {
          const instance = noTerminalStdoutImplementation.create({ interface: TERMINAL_STDOUT_INTERFACE })
          const imports = instance.getImports() as {
            'get-terminal-stdout': () => number | undefined
          }

          expect(imports['get-terminal-stdout']()).toBeUndefined()
        })
      })

      describe('Virtual Terminal Implementation', () => {
        it('should create an instance', () => {
          const instance = virtualTerminalStdoutImplementation.create({ interface: TERMINAL_STDOUT_INTERFACE })
          expect(instance).toBeDefined()
        })

        it('should return a terminal handle', () => {
          const instance = virtualTerminalStdoutImplementation.create({ interface: TERMINAL_STDOUT_INTERFACE })
          const imports = instance.getImports() as {
            'get-terminal-stdout': () => number | undefined
          }

          const handle = imports['get-terminal-stdout']()
          expect(handle).toBeDefined()
          expect(typeof handle).toBe('number')
          expect(handle).toBeGreaterThan(0)

          // Verify handle is registered
          expect(globalTerminalRegistry.getOutput(handle!)).toBeDefined()

          instance.destroy()
        })

        it('should clean up on destroy', () => {
          const instance = virtualTerminalStdoutImplementation.create({ interface: TERMINAL_STDOUT_INTERFACE })
          const imports = instance.getImports() as {
            'get-terminal-stdout': () => number | undefined
          }

          const handle = imports['get-terminal-stdout']()!
          instance.destroy()

          // Handle should be unregistered
          expect(globalTerminalRegistry.getOutput(handle)).toBeUndefined()
        })
      })
    })

    describe('Terminal Stderr', () => {
      describe('No Terminal Implementation', () => {
        it('should create an instance', () => {
          const instance = noTerminalStderrImplementation.create({ interface: TERMINAL_STDERR_INTERFACE })
          expect(instance).toBeDefined()
        })

        it('should return undefined (no terminal)', () => {
          const instance = noTerminalStderrImplementation.create({ interface: TERMINAL_STDERR_INTERFACE })
          const imports = instance.getImports() as {
            'get-terminal-stderr': () => number | undefined
          }

          expect(imports['get-terminal-stderr']()).toBeUndefined()
        })
      })

      describe('Virtual Terminal Implementation', () => {
        it('should create an instance', () => {
          const instance = virtualTerminalStderrImplementation.create({ interface: TERMINAL_STDERR_INTERFACE })
          expect(instance).toBeDefined()
        })

        it('should return a terminal handle', () => {
          const instance = virtualTerminalStderrImplementation.create({ interface: TERMINAL_STDERR_INTERFACE })
          const imports = instance.getImports() as {
            'get-terminal-stderr': () => number | undefined
          }

          const handle = imports['get-terminal-stderr']()
          expect(handle).toBeDefined()
          expect(typeof handle).toBe('number')
          expect(handle).toBeGreaterThan(0)

          // Verify handle is registered
          expect(globalTerminalRegistry.getOutput(handle!)).toBeDefined()

          instance.destroy()
        })

        it('should clean up on destroy', () => {
          const instance = virtualTerminalStderrImplementation.create({ interface: TERMINAL_STDERR_INTERFACE })
          const imports = instance.getImports() as {
            'get-terminal-stderr': () => number | undefined
          }

          const handle = imports['get-terminal-stderr']()!
          instance.destroy()

          // Handle should be unregistered
          expect(globalTerminalRegistry.getOutput(handle)).toBeUndefined()
        })
      })
    })
  })

  describe('Stdio Provider Architecture', () => {
    beforeEach(() => {
      resetGlobalStdioState()
    })

    describe('ConsoleOutputStream', () => {
      it('should have isTTY as false', () => {
        const stream = new ConsoleOutputStream('stdout')
        expect(stream.isTTY).toBe(false)
      })

      it('should buffer and flush on newline', async () => {
        const logs: string[] = []
        const originalLog = console.log
        console.log = (...args) => logs.push(args.join(' '))
        try {
          const stream = new ConsoleOutputStream('stdout')
          await stream.write(new TextEncoder().encode('Hello\nWorld\n'))
          expect(logs).toEqual(['Hello', 'World'])
        } finally {
          console.log = originalLog
        }
      })

      it('should flush remaining buffer on close', async () => {
        const logs: string[] = []
        const originalLog = console.log
        console.log = (...args) => logs.push(args.join(' '))
        try {
          const stream = new ConsoleOutputStream('stdout')
          await stream.write(new TextEncoder().encode('No newline'))
          expect(logs).toEqual([])
          await stream.close()
          expect(logs).toEqual(['No newline'])
        } finally {
          console.log = originalLog
        }
      })
    })

    describe('EmptyInputStream', () => {
      it('should have isTTY as false', () => {
        const stream = new EmptyInputStream()
        expect(stream.isTTY).toBe(false)
      })

      it('should return empty array (EOF) immediately', async () => {
        const stream = new EmptyInputStream()
        const data = await stream.read(1024)
        expect(data).toBeInstanceOf(Uint8Array)
        expect(data.length).toBe(0)
      })
    })

    describe('QueueInputStream', () => {
      it('should have configurable isTTY', () => {
        const ttyStream = new QueueInputStream(true)
        expect(ttyStream.isTTY).toBe(true)

        const nonTtyStream = new QueueInputStream(false)
        expect(nonTtyStream.isTTY).toBe(false)
      })

      it('should accept string and Uint8Array data', () => {
        const stream = new QueueInputStream()
        stream.push('Hello')
        stream.push(new Uint8Array([32, 87, 111, 114, 108, 100]))
        expect(stream.hasData()).toBe(true)
      })

      it('should return data synchronously via tryRead when available', () => {
        const stream = new QueueInputStream()
        stream.push('Hello')
        const data = stream.tryRead(100)
        expect(data).not.toBeNull()
        expect(new TextDecoder().decode(data!)).toBe('Hello')
      })

      it('should return null from tryRead when no data available', () => {
        const stream = new QueueInputStream()
        const data = stream.tryRead(100)
        expect(data).toBeNull()
      })

      it('should return EOF from tryRead when closed and empty', () => {
        const stream = new QueueInputStream()
        stream.close()
        const data = stream.tryRead(100)
        expect(data).not.toBeNull()
        expect(data!.length).toBe(0)
      })

      it('should return buffered data before EOF when closed', () => {
        const stream = new QueueInputStream()
        stream.push('Data')
        stream.close()

        const data = stream.tryRead(100)
        expect(new TextDecoder().decode(data!)).toBe('Data')

        const eof = stream.tryRead(100)
        expect(eof!.length).toBe(0)
      })

      it('should wait for data in async read', async () => {
        const stream = new QueueInputStream()

        const readPromise = stream.read(100)

        // Push data after starting the read
        setTimeout(() => stream.push('Async data'), 10)

        const data = await readPromise
        expect(new TextDecoder().decode(data)).toBe('Async data')
      })

      it('should split chunks when requesting less than available', () => {
        const stream = new QueueInputStream()
        stream.push('Hello World')

        const chunk1 = stream.tryRead(5)
        expect(new TextDecoder().decode(chunk1!)).toBe('Hello')

        const chunk2 = stream.tryRead(100)
        expect(new TextDecoder().decode(chunk2!)).toBe(' World')
      })
    })

    describe('WasiInputStreamWrapper.blockingRead', () => {
      // Regression guard: when wrapping an idle QueueInputStream (no
      // sync tryRead result, no SAB-backed waitForData), blockingRead
      // must fall through to the impl's async read() so the wasm
      // caller can suspend until data lands. Returning a sync empty
      // Uint8Array would be misread as EOF by the wasip1 adapter.
      it('returns a Promise that resolves with data pushed asynchronously', async () => {
        const queue = new QueueInputStream(false)
        const wrapper = new WasiInputStreamWrapper(queue)

        const result = wrapper.blockingRead(1024n)

        // The wrapper must NOT return a sync empty Uint8Array here —
        // that path is what the wasip1 adapter treats as EOF.
        expect(result).toBeInstanceOf(Promise)

        setTimeout(() => queue.push('queued data'), 10)

        const data = await (result as Promise<Uint8Array>)
        expect(data).toBeInstanceOf(Uint8Array)
        expect(new TextDecoder().decode(data as Uint8Array)).toBe('queued data')
      })

      it('returns synchronously when tryRead has data', () => {
        const queue = new QueueInputStream(false)
        queue.push('immediate')
        const wrapper = new WasiInputStreamWrapper(queue)

        const result = wrapper.blockingRead(1024n)

        // Sync fast path must still work — Promise allocation only
        // on the no-data path.
        expect(result).toBeInstanceOf(Uint8Array)
        expect(new TextDecoder().decode(result as Uint8Array)).toBe('immediate')
      })

      it('resolves to closed when the queue closes with no pending data', async () => {
        const queue = new QueueInputStream(false)
        const wrapper = new WasiInputStreamWrapper(queue)

        const result = wrapper.blockingRead(1024n)
        expect(result).toBeInstanceOf(Promise)

        setTimeout(() => queue.close(), 10)

        const resolved = await (result as Promise<Uint8Array | { tag: 'closed' }>)
        // Either the impl resolves with a zero-length Uint8Array
        // (which the wrapper translates to { tag: 'closed' }) or a
        // StreamError directly.
        expect(resolved).toEqual({ tag: 'closed' })
      })
    })

    describe('createConsoleStdio', () => {
      it('should create a stdio provider', () => {
        const provider = createConsoleStdio()
        expect(typeof provider).toBe('function')

        const streams = provider()
        expect(streams.stdin).toBeDefined()
        expect(streams.stdout).toBeDefined()
        expect(streams.stderr).toBeDefined()
        expect(streams.terminal).toBeUndefined()
      })

      it('should have non-TTY streams', () => {
        const streams = createConsoleStdio()()
        expect(streams.stdin.isTTY).toBe(false)
        expect(streams.stdout.isTTY).toBe(false)
        expect(streams.stderr.isTTY).toBe(false)
      })
    })

    describe('createCustomStdio', () => {
      it('should use provided streams', () => {
        const stdin = new QueueInputStream(false)
        const stdout = new ConsoleOutputStream('stdout')
        const stderr = new ConsoleOutputStream('stderr')

        const provider = createCustomStdio(stdin, stdout, stderr)
        const streams = provider()

        expect(streams.stdin).toBe(stdin)
        expect(streams.stdout).toBe(stdout)
        expect(streams.stderr).toBe(stderr)
      })

      it('should allow configuring TTY mode', () => {
        const stdin = new QueueInputStream()
        const stdout = new ConsoleOutputStream('stdout')
        const stderr = new ConsoleOutputStream('stderr')

        const provider = createCustomStdio(stdin, stdout, stderr, { isTTY: true })
        const streams = provider()

        expect(streams.terminal).toBeDefined()
        expect(streams.terminal!.isTTY).toBe(true)
      })
    })

    describe('createXtermStdio', () => {
      it('should create streams from xterm-like terminal', () => {
        const dataCallbacks: ((data: string) => void)[] = []
        const mockTerm = {
          write: vi.fn(),
          onData: vi.fn((callback: (data: string) => void) => {
            dataCallbacks.push(callback)
            return { dispose: vi.fn() }
          }),
        }

        const provider = createXtermStdio(mockTerm)
        const streams = provider()

        expect(streams.stdin.isTTY).toBe(true)
        expect(streams.stdout.isTTY).toBe(true)
        expect(streams.stderr.isTTY).toBe(true)
        expect(streams.terminal).toBeDefined()
        expect(streams.terminal!.isTTY).toBe(true)
      })

      it('should forward input from terminal', async () => {
        const dataCallbacks: ((data: string) => void)[] = []
        const mockTerm = {
          write: vi.fn(),
          onData: vi.fn((callback: (data: string) => void) => {
            dataCallbacks.push(callback)
            return { dispose: vi.fn() }
          }),
        }

        const provider = createXtermStdio(mockTerm)
        const streams = provider()

        // Simulate terminal input
        const readPromise = streams.stdin.read(100)
        dataCallbacks[0]!('typed input')

        const data = await readPromise
        expect(new TextDecoder().decode(data)).toBe('typed input')
      })
    })

    describe('createStdioProvider', () => {
      it('should default to console provider', () => {
        const provider = createStdioProvider()
        const streams = provider()
        expect(streams.stdin.isTTY).toBe(false)
        expect(streams.terminal).toBeUndefined()
      })

      it('should create console provider for console kind', () => {
        const provider = createStdioProvider({ kind: 'console' })
        const streams = provider()
        expect(streams.stdin.isTTY).toBe(false)
      })

      it('should create terminal provider for terminal kind', () => {
        const mockTerm = {
          write: vi.fn(),
          onData: vi.fn(() => ({ dispose: vi.fn() })),
        }
        const provider = createStdioProvider({ kind: 'terminal', term: mockTerm })
        const streams = provider()
        expect(streams.stdin.isTTY).toBe(true)
      })

      it('should create custom provider for custom kind', () => {
        const stdin = new QueueInputStream()
        const stdout = new ConsoleOutputStream('stdout')
        const stderr = new ConsoleOutputStream('stderr')

        const provider = createStdioProvider({
          kind: 'custom',
          stdin,
          stdout,
          stderr,
          isTTY: true,
        })
        const streams = provider()
        expect(streams.stdin).toBe(stdin)
        expect(streams.terminal!.isTTY).toBe(true)
      })
    })

    describe('Global Provider Integration', () => {
      it('should detect TTY from global provider', () => {
        // Default: console (not TTY)
        expect(isStdinTTY()).toBe(false)
        expect(isStdoutTTY()).toBe(false)
        expect(isStderrTTY()).toBe(false)
      })

      it('should update TTY detection when provider changes', () => {
        const mockTerm = {
          write: vi.fn(),
          onData: vi.fn(() => ({ dispose: vi.fn() })),
        }

        setGlobalStdioProvider(createXtermStdio(mockTerm))

        expect(isStdinTTY()).toBe(true)
        expect(isStdoutTTY()).toBe(true)
        expect(isStderrTTY()).toBe(true)
      })

      it('auto terminal implementations should use global TTY state', () => {
        // Default: console (not TTY)
        const noTtyInstance = autoTerminalStdinImplementation.create({
          interface: TERMINAL_STDIN_INTERFACE,
        })
        const noTtyImports = noTtyInstance.getImports() as {
          'get-terminal-stdin': () => number | undefined
        }
        expect(noTtyImports['get-terminal-stdin']()).toBeUndefined()
        noTtyInstance.destroy()

        // Reset and configure with TTY provider
        resetGlobalStdioState()
        const mockTerm = {
          write: vi.fn(),
          onData: vi.fn(() => ({ dispose: vi.fn() })),
        }
        setGlobalStdioProvider(createXtermStdio(mockTerm))

        const ttyInstance = autoTerminalStdinImplementation.create({
          interface: TERMINAL_STDIN_INTERFACE,
        })
        const ttyImports = ttyInstance.getImports() as {
          'get-terminal-stdin': () => number | undefined
        }
        expect(ttyImports['get-terminal-stdin']()).toBeDefined()
        ttyInstance.destroy()
      })
    })
  })
})
