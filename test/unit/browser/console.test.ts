/**
 * browser:console tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ConsoleLogger,
  LogLevel,
  getDefaultLogger,
  configureDefaultLogger,
  getBrowserConsoleImports,
  log,
  logStructured,
  time,
  timeEnd,
  timeLog,
  trace,
  debug,
  info,
  warn,
  error,
  type LogPart,
} from '../../../src/browser/console.js'
import { createMockConsole } from '../../browser/test-utils.js'

describe('browser:console', () => {
  describe('LogLevel', () => {
    it('has correct log levels', () => {
      expect(LogLevel.DEBUG).toBe('debug')
      expect(LogLevel.INFO).toBe('info')
      expect(LogLevel.WARN).toBe('warn')
      expect(LogLevel.ERROR).toBe('error')
      expect(LogLevel.TRACE).toBe('trace')
    })
  })

  describe('ConsoleLogger', () => {
    let mockConsole: Console & { getCalls(): Record<string, unknown[][]> }

    beforeEach(() => {
      mockConsole = createMockConsole()
    })

    it('logs at different levels', () => {
      const logger = new ConsoleLogger({ console: mockConsole, minLevel: LogLevel.TRACE })

      logger.trace('trace message')
      logger.debug('debug message')
      logger.info('info message')
      logger.warn('warn message')
      logger.error('error message')

      const calls = mockConsole.getCalls()
      expect(calls.trace.length).toBe(1)
      expect(calls.debug.length).toBe(1)
      expect(calls.info.length).toBe(1)
      expect(calls.warn.length).toBe(1)
      expect(calls.error.length).toBe(1)
    })

    it('respects minimum log level', () => {
      const logger = new ConsoleLogger({ console: mockConsole, minLevel: LogLevel.WARN })

      logger.debug('should not appear')
      logger.info('should not appear')
      logger.warn('should appear')
      logger.error('should appear')

      const calls = mockConsole.getCalls()
      expect(calls.debug.length).toBe(0)
      expect(calls.info.length).toBe(0)
      expect(calls.warn.length).toBe(1)
      expect(calls.error.length).toBe(1)
    })

    it('adds prefix to messages', () => {
      const logger = new ConsoleLogger({ console: mockConsole, prefix: '[TEST]' })

      logger.info('message')

      const calls = mockConsole.getCalls()
      expect(calls.info[0]![0]).toContain('[TEST]')
      expect(calls.info[0]![0]).toContain('message')
    })

    it('adds timestamps when enabled', () => {
      const logger = new ConsoleLogger({ console: mockConsole, timestamps: true })

      logger.info('message')

      const calls = mockConsole.getCalls()
      // Timestamps have ISO format like [2024-01-01T00:00:00.000Z]
      expect(calls.info[0]![0]).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('logs structured data', () => {
      const logger = new ConsoleLogger({ console: mockConsole })

      const parts: LogPart[] = [
        { tag: 'text', value: 'User:' },
        { tag: 'object', value: { name: 'John', age: 30 } },
      ]

      logger.logStructured(LogLevel.INFO, parts)

      const calls = mockConsole.getCalls()
      expect(calls.info.length).toBe(1)
    })

    it('handles timer operations', () => {
      // Mock performance.now
      let mockTime = 0
      const originalPerformance = globalThis.performance
      ;(globalThis as unknown as Record<string, unknown>).performance = {
        now: () => mockTime,
      }

      try {
        const logger = new ConsoleLogger({ console: mockConsole })

        logger.time('test-timer')
        mockTime = 100
        logger.timeEnd('test-timer')

        const calls = mockConsole.getCalls()
        expect(calls.info.length).toBe(1)
        expect(calls.info[0]![0]).toContain('test-timer')
        expect(calls.info[0]![0]).toContain('100')
      } finally {
        ;(globalThis as unknown as Record<string, unknown>).performance = originalPerformance
      }
    })

    it('warns when ending non-existent timer', () => {
      const logger = new ConsoleLogger({ console: mockConsole })

      logger.timeEnd('non-existent')

      const calls = mockConsole.getCalls()
      expect(calls.warn.length).toBe(1)
      expect(calls.warn[0]![0]).toContain('non-existent')
    })

    it('handles timeLog without ending timer', () => {
      let mockTime = 0
      const originalPerformance = globalThis.performance
      ;(globalThis as unknown as Record<string, unknown>).performance = {
        now: () => mockTime,
      }

      try {
        const logger = new ConsoleLogger({ console: mockConsole })

        logger.time('ongoing-timer')
        mockTime = 50
        logger.timeLog('ongoing-timer', 'checkpoint')
        mockTime = 100
        logger.timeEnd('ongoing-timer')

        const calls = mockConsole.getCalls()
        expect(calls.info.length).toBe(2)
        expect(calls.info[0]![0]).toContain('checkpoint')
      } finally {
        ;(globalThis as unknown as Record<string, unknown>).performance = originalPerformance
      }
    })

    it('handles group operations', () => {
      const logger = new ConsoleLogger({ console: mockConsole })

      logger.group('collapsed group')
      logger.groupExpanded('expanded group')
      logger.groupEnd()

      const calls = mockConsole.getCalls()
      expect(calls.groupCollapsed.length).toBe(1)
      expect(calls.group.length).toBe(1)
      expect(calls.groupEnd.length).toBe(1)
    })

    it('clears console', () => {
      const logger = new ConsoleLogger({ console: mockConsole })

      logger.clear()

      const calls = mockConsole.getCalls()
      expect(calls.clear.length).toBe(1)
    })

    it('handles count operations', () => {
      const logger = new ConsoleLogger({ console: mockConsole })

      logger.count('counter')
      logger.count('counter')
      logger.countReset('counter')

      const calls = mockConsole.getCalls()
      expect(calls.count.length).toBe(2)
      expect(calls.countReset.length).toBe(1)
    })

    it('logs tables', () => {
      const logger = new ConsoleLogger({ console: mockConsole })

      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]

      logger.table(data)
      logger.table(data, ['name'])

      const calls = mockConsole.getCalls()
      expect(calls.table.length).toBe(2)
    })

    it('handles assert', () => {
      const logger = new ConsoleLogger({ console: mockConsole })

      logger.assert(true, 'should not log')
      logger.assert(false, 'should log')

      // Note: assert only logs when condition is false
      expect(mockConsole.assert).toHaveBeenCalledTimes(2)
    })
  })

  describe('LogPart conversion', () => {
    let mockConsole: Console & { getCalls(): Record<string, unknown[][]> }

    beforeEach(() => {
      mockConsole = createMockConsole()
    })

    it('converts text parts', () => {
      const logger = new ConsoleLogger({ console: mockConsole })
      logger.logStructured(LogLevel.INFO, [{ tag: 'text', value: 'hello' }])
      expect(mockConsole.info).toHaveBeenCalled()
    })

    it('converts number parts', () => {
      const logger = new ConsoleLogger({ console: mockConsole })
      logger.logStructured(LogLevel.INFO, [{ tag: 'number', value: 42 }])
      expect(mockConsole.info).toHaveBeenCalled()
    })

    it('converts boolean parts', () => {
      const logger = new ConsoleLogger({ console: mockConsole })
      logger.logStructured(LogLevel.INFO, [{ tag: 'boolean', value: true }])
      expect(mockConsole.info).toHaveBeenCalled()
    })

    it('converts bytes parts', () => {
      const logger = new ConsoleLogger({ console: mockConsole })
      logger.logStructured(LogLevel.INFO, [{ tag: 'bytes', value: new Uint8Array([1, 2, 3]) }])
      expect(mockConsole.info).toHaveBeenCalled()
    })

    it('converts object parts', () => {
      const logger = new ConsoleLogger({ console: mockConsole })
      logger.logStructured(LogLevel.INFO, [{ tag: 'object', value: { foo: 'bar' } }])
      expect(mockConsole.info).toHaveBeenCalled()
    })

    it('converts array parts', () => {
      const logger = new ConsoleLogger({ console: mockConsole })
      logger.logStructured(LogLevel.INFO, [{ tag: 'array', value: [1, 2, 3] }])
      expect(mockConsole.info).toHaveBeenCalled()
    })

    it('converts null parts', () => {
      const logger = new ConsoleLogger({ console: mockConsole })
      logger.logStructured(LogLevel.INFO, [{ tag: 'null' }])
      expect(mockConsole.info).toHaveBeenCalled()
    })

    it('converts undefined parts', () => {
      const logger = new ConsoleLogger({ console: mockConsole })
      logger.logStructured(LogLevel.INFO, [{ tag: 'undefined' }])
      expect(mockConsole.info).toHaveBeenCalled()
    })
  })

  describe('Default logger', () => {
    it('returns same instance', () => {
      const logger1 = getDefaultLogger()
      const logger2 = getDefaultLogger()
      expect(logger1).toBe(logger2)
    })

    it('can be reconfigured', () => {
      const mockConsole = createMockConsole()
      configureDefaultLogger({ console: mockConsole, prefix: '[CUSTOM]' })

      const logger = getDefaultLogger()
      logger.info('test')

      const calls = mockConsole.getCalls()
      expect(calls.info[0]![0]).toContain('[CUSTOM]')
    })
  })

  describe('Standalone functions', () => {
    let mockConsole: Console & { getCalls(): Record<string, unknown[][]> }

    beforeEach(() => {
      mockConsole = createMockConsole()
      configureDefaultLogger({ console: mockConsole })
    })

    it('log function works', () => {
      log(LogLevel.INFO, 'test message')
      const calls = mockConsole.getCalls()
      expect(calls.info.length).toBe(1)
    })

    it('logStructured function works', () => {
      logStructured(LogLevel.INFO, [{ tag: 'text', value: 'test' }])
      const calls = mockConsole.getCalls()
      expect(calls.info.length).toBe(1)
    })

    it('timer functions work', () => {
      let mockTime = 0
      const originalPerformance = globalThis.performance
      ;(globalThis as unknown as Record<string, unknown>).performance = {
        now: () => mockTime,
      }

      try {
        time('test')
        mockTime = 50
        timeLog('test')
        mockTime = 100
        timeEnd('test')

        const calls = mockConsole.getCalls()
        expect(calls.info.length).toBe(2)
      } finally {
        ;(globalThis as unknown as Record<string, unknown>).performance = originalPerformance
      }
    })

    it('convenience functions work', () => {
      configureDefaultLogger({ console: mockConsole, minLevel: LogLevel.TRACE })

      trace('trace')
      debug('debug')
      info('info')
      warn('warn')
      error('error')

      const calls = mockConsole.getCalls()
      expect(calls.trace.length).toBe(1)
      expect(calls.debug.length).toBe(1)
      expect(calls.info.length).toBe(1)
      expect(calls.warn.length).toBe(1)
      expect(calls.error.length).toBe(1)
    })
  })

  describe('getBrowserConsoleImports', () => {
    it('returns valid imports object', () => {
      const imports = getBrowserConsoleImports()

      expect(imports['browser:console/console']).toBeDefined()
      expect(typeof imports['browser:console/console']).toBe('object')
    })

    it('includes all required functions', () => {
      const imports = getBrowserConsoleImports()
      const consoleImports = imports['browser:console/console'] as Record<string, unknown>

      expect(typeof consoleImports['log']).toBe('function')
      expect(typeof consoleImports['log-structured']).toBe('function')
      expect(typeof consoleImports['time']).toBe('function')
      expect(typeof consoleImports['time-end']).toBe('function')
      expect(typeof consoleImports['time-log']).toBe('function')
      expect(typeof consoleImports['group']).toBe('function')
      expect(typeof consoleImports['group-expanded']).toBe('function')
      expect(typeof consoleImports['group-end']).toBe('function')
      expect(typeof consoleImports['clear']).toBe('function')
      expect(typeof consoleImports['count']).toBe('function')
      expect(typeof consoleImports['count-reset']).toBe('function')
      expect(typeof consoleImports['table']).toBe('function')
      expect(typeof consoleImports['assert']).toBe('function')
      expect(typeof consoleImports['trace']).toBe('function')
      expect(typeof consoleImports['debug']).toBe('function')
      expect(typeof consoleImports['info']).toBe('function')
      expect(typeof consoleImports['warn']).toBe('function')
      expect(typeof consoleImports['error']).toBe('function')
    })

    it('uses custom config when provided', () => {
      const mockConsole = createMockConsole()
      const imports = getBrowserConsoleImports({ console: mockConsole, prefix: '[IMPORT]' })
      const consoleImports = imports['browser:console/console'] as Record<string, (...args: unknown[]) => void>

      consoleImports['info']('test message')

      const calls = mockConsole.getCalls()
      expect(calls.info[0]![0]).toContain('[IMPORT]')
    })
  })
})
