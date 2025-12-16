import { describe, it, expect, vi } from 'vitest'
import {
  loggingPlugin,
  consoleLogImplementation,
  bufferLogImplementation,
  createBufferLogger,
  LOG_LEVEL_VALUES,
  levelFromNumber,
  shouldLog,
  shouldLogContext,
  type LogLevel,
} from '../../src/plugins/logging/index.js'

describe('wasi:logging/logging', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(loggingPlugin.witInterface.package).toBe('wasi:logging')
      expect(loggingPlugin.witInterface.name).toBe('logging')
      expect(loggingPlugin.witInterface.version).toBe('0.1.0-draft')
    })

    it('has console as default implementation', () => {
      expect(loggingPlugin.defaultImplementation).toBe('console')
    })

    it('has both console and buffer implementations', () => {
      expect(loggingPlugin.implementations.has('console')).toBe(true)
      expect(loggingPlugin.implementations.has('buffer')).toBe(true)
    })
  })

  describe('log level utilities', () => {
    it('LOG_LEVEL_VALUES has correct ordering', () => {
      expect(LOG_LEVEL_VALUES.trace).toBe(0)
      expect(LOG_LEVEL_VALUES.debug).toBe(1)
      expect(LOG_LEVEL_VALUES.info).toBe(2)
      expect(LOG_LEVEL_VALUES.warn).toBe(3)
      expect(LOG_LEVEL_VALUES.error).toBe(4)
      expect(LOG_LEVEL_VALUES.critical).toBe(5)
    })

    it('levelFromNumber converts correctly', () => {
      expect(levelFromNumber(0)).toBe('trace')
      expect(levelFromNumber(1)).toBe('debug')
      expect(levelFromNumber(2)).toBe('info')
      expect(levelFromNumber(3)).toBe('warn')
      expect(levelFromNumber(4)).toBe('error')
      expect(levelFromNumber(5)).toBe('critical')
    })

    it('levelFromNumber defaults to info for unknown values', () => {
      expect(levelFromNumber(-1)).toBe('info')
      expect(levelFromNumber(100)).toBe('info')
    })

    it('shouldLog filters by minimum level', () => {
      // At info level
      expect(shouldLog('trace', 'info')).toBe(false)
      expect(shouldLog('debug', 'info')).toBe(false)
      expect(shouldLog('info', 'info')).toBe(true)
      expect(shouldLog('warn', 'info')).toBe(true)
      expect(shouldLog('error', 'info')).toBe(true)
      expect(shouldLog('critical', 'info')).toBe(true)

      // At trace level (log everything)
      expect(shouldLog('trace', 'trace')).toBe(true)
      expect(shouldLog('debug', 'trace')).toBe(true)

      // At error level
      expect(shouldLog('info', 'error')).toBe(false)
      expect(shouldLog('warn', 'error')).toBe(false)
      expect(shouldLog('error', 'error')).toBe(true)
      expect(shouldLog('critical', 'error')).toBe(true)
    })
  })

  describe('context filtering', () => {
    it('logs all contexts by default', () => {
      expect(shouldLogContext('test', {})).toBe(true)
      expect(shouldLogContext('http', {})).toBe(true)
      expect(shouldLogContext('', {})).toBe(true)
    })

    it('respects include patterns', () => {
      const config = { includeContexts: ['http', 'db'] }
      expect(shouldLogContext('http', config)).toBe(true)
      expect(shouldLogContext('db', config)).toBe(true)
      expect(shouldLogContext('cache', config)).toBe(false)
    })

    it('respects exclude patterns', () => {
      const config = { excludeContexts: ['verbose', 'trace'] }
      expect(shouldLogContext('http', config)).toBe(true)
      expect(shouldLogContext('verbose', config)).toBe(false)
      expect(shouldLogContext('trace', config)).toBe(false)
    })

    it('exclude takes precedence over include', () => {
      const config = {
        includeContexts: ['http', 'verbose'],
        excludeContexts: ['verbose'],
      }
      expect(shouldLogContext('http', config)).toBe(true)
      expect(shouldLogContext('verbose', config)).toBe(false)
    })

    it('supports wildcard patterns', () => {
      const config = { includeContexts: ['http*'] }
      expect(shouldLogContext('http', config)).toBe(true)
      expect(shouldLogContext('http.server', config)).toBe(true)
      expect(shouldLogContext('db', config)).toBe(false)
    })

    it('supports * to match all', () => {
      const config = { includeContexts: ['*'] }
      expect(shouldLogContext('anything', config)).toBe(true)
      expect(shouldLogContext('', config)).toBe(true)
    })
  })
})

describe('console implementation', () => {
  it('has correct metadata', () => {
    expect(consoleLogImplementation.name).toBe('console')
    expect(consoleLogImplementation.description).toContain('console')
  })

  it('logs to console methods', () => {
    const mockConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const instance = consoleLogImplementation.create({
      console: mockConsole as unknown as Console,
    })
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    // Test each level
    imports.log(0, 'test', 'trace message') // trace -> debug
    imports.log(1, 'test', 'debug message')
    imports.log(2, 'test', 'info message')
    imports.log(3, 'test', 'warn message')
    imports.log(4, 'test', 'error message')
    imports.log(5, 'test', 'critical message') // critical -> error

    expect(mockConsole.debug).toHaveBeenCalledTimes(2) // trace + debug
    expect(mockConsole.info).toHaveBeenCalledTimes(1)
    expect(mockConsole.warn).toHaveBeenCalledTimes(1)
    expect(mockConsole.error).toHaveBeenCalledTimes(2) // error + critical
  })

  it('respects minimum level filter', () => {
    const mockConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const instance = consoleLogImplementation.create({
      minLevel: 'warn' as LogLevel,
      console: mockConsole as unknown as Console,
    })
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(0, 'test', 'trace')
    imports.log(1, 'test', 'debug')
    imports.log(2, 'test', 'info')
    imports.log(3, 'test', 'warn')
    imports.log(4, 'test', 'error')

    expect(mockConsole.debug).not.toHaveBeenCalled()
    expect(mockConsole.info).not.toHaveBeenCalled()
    expect(mockConsole.warn).toHaveBeenCalledTimes(1)
    expect(mockConsole.error).toHaveBeenCalledTimes(1)
  })

  it('includes context in output when enabled', () => {
    const mockConsole = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const instance = consoleLogImplementation.create({
      showContext: true,
      console: mockConsole as unknown as Console,
    })
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(2, 'http.server', 'Request received')

    expect(mockConsole.info).toHaveBeenCalledWith(
      expect.stringContaining('[http.server]')
    )
  })

  it('excludes context when disabled', () => {
    const mockConsole = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const instance = consoleLogImplementation.create({
      showContext: false,
      console: mockConsole as unknown as Console,
    })
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(2, 'http.server', 'Request received')

    const call = mockConsole.info.mock.calls[0][0]
    expect(call).not.toContain('[http.server]')
    expect(call).toContain('Request received')
  })

  it('respects context filters', () => {
    const mockConsole = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const instance = consoleLogImplementation.create({
      includeContexts: ['http*'],
      console: mockConsole as unknown as Console,
    })
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(2, 'http.server', 'HTTP request')
    imports.log(2, 'db.query', 'DB query')

    expect(mockConsole.info).toHaveBeenCalledTimes(1)
    expect(mockConsole.info).toHaveBeenCalledWith(
      expect.stringContaining('HTTP request')
    )
  })
})

describe('buffer implementation', () => {
  it('has correct metadata', () => {
    expect(bufferLogImplementation.name).toBe('buffer')
    expect(bufferLogImplementation.description).toContain('buffer')
  })

  it('captures log entries', () => {
    const { instance, buffer } = createBufferLogger()
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(2, 'test', 'Hello world')

    expect(buffer.count).toBe(1)
    const entries = buffer.getEntries()
    expect(entries[0].level).toBe('info')
    expect(entries[0].context).toBe('test')
    expect(entries[0].message).toBe('Hello world')
  })

  it('captures multiple entries in order', () => {
    const { instance, buffer } = createBufferLogger()
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(2, 'a', 'First')
    imports.log(3, 'b', 'Second')
    imports.log(4, 'c', 'Third')

    expect(buffer.count).toBe(3)
    const entries = buffer.getEntries()
    expect(entries[0].message).toBe('First')
    expect(entries[1].message).toBe('Second')
    expect(entries[2].message).toBe('Third')
  })

  it('records timestamps', () => {
    const { instance, buffer } = createBufferLogger()
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(2, 'test', 'Message')

    const entries = buffer.getEntries()
    expect(typeof entries[0].timestamp).toBe('bigint')
    expect(entries[0].timestamp).toBeGreaterThan(0n)
  })

  it('respects maxEntries limit', () => {
    const { instance, buffer } = createBufferLogger({ maxEntries: 3 })
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(2, 'test', 'One')
    imports.log(2, 'test', 'Two')
    imports.log(2, 'test', 'Three')
    imports.log(2, 'test', 'Four')
    imports.log(2, 'test', 'Five')

    expect(buffer.count).toBe(3)
    const entries = buffer.getEntries()
    expect(entries[0].message).toBe('Three')
    expect(entries[1].message).toBe('Four')
    expect(entries[2].message).toBe('Five')
  })

  it('filters by minimum level', () => {
    const { instance, buffer } = createBufferLogger({ minLevel: 'warn' })
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(0, 'test', 'trace')
    imports.log(1, 'test', 'debug')
    imports.log(2, 'test', 'info')
    imports.log(3, 'test', 'warn')
    imports.log(4, 'test', 'error')

    expect(buffer.count).toBe(2)
    const entries = buffer.getEntries()
    expect(entries[0].level).toBe('warn')
    expect(entries[1].level).toBe('error')
  })

  it('filters by context', () => {
    const { instance, buffer } = createBufferLogger({
      includeContexts: ['http*'],
    })
    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(2, 'http.server', 'Request')
    imports.log(2, 'db.query', 'Query')
    imports.log(2, 'http.client', 'Response')

    expect(buffer.count).toBe(2)
    const entries = buffer.getEntries()
    expect(entries[0].context).toBe('http.server')
    expect(entries[1].context).toBe('http.client')
  })

  describe('query methods', () => {
    it('getEntriesByLevel filters correctly', () => {
      const { instance, buffer } = createBufferLogger()
      const imports = instance.getImports() as {
        log: (level: number, context: string, message: string) => void
      }

      imports.log(2, 'a', 'Info 1')
      imports.log(3, 'b', 'Warn')
      imports.log(2, 'c', 'Info 2')
      imports.log(4, 'd', 'Error')

      const infoEntries = buffer.getEntriesByLevel('info')
      expect(infoEntries).toHaveLength(2)
      expect(infoEntries[0].message).toBe('Info 1')
      expect(infoEntries[1].message).toBe('Info 2')
    })

    it('getEntriesByContext filters correctly', () => {
      const { instance, buffer } = createBufferLogger()
      const imports = instance.getImports() as {
        log: (level: number, context: string, message: string) => void
      }

      imports.log(2, 'http', 'HTTP 1')
      imports.log(2, 'db', 'DB')
      imports.log(2, 'http', 'HTTP 2')

      const httpEntries = buffer.getEntriesByContext('http')
      expect(httpEntries).toHaveLength(2)
      expect(httpEntries[0].message).toBe('HTTP 1')
      expect(httpEntries[1].message).toBe('HTTP 2')
    })

    it('getEntriesAtLevel filters by minimum', () => {
      const { instance, buffer } = createBufferLogger()
      const imports = instance.getImports() as {
        log: (level: number, context: string, message: string) => void
      }

      imports.log(1, 'a', 'Debug')
      imports.log(2, 'b', 'Info')
      imports.log(3, 'c', 'Warn')
      imports.log(4, 'd', 'Error')

      const warnAndAbove = buffer.getEntriesAtLevel('warn')
      expect(warnAndAbove).toHaveLength(2)
      expect(warnAndAbove[0].level).toBe('warn')
      expect(warnAndAbove[1].level).toBe('error')
    })

    it('hasErrors detects errors', () => {
      const { instance, buffer } = createBufferLogger()
      const imports = instance.getImports() as {
        log: (level: number, context: string, message: string) => void
      }

      imports.log(2, 'test', 'Info')
      expect(buffer.hasErrors).toBe(false)

      imports.log(4, 'test', 'Error!')
      expect(buffer.hasErrors).toBe(true)
    })

    it('hasErrors detects critical', () => {
      const { instance, buffer } = createBufferLogger()
      const imports = instance.getImports() as {
        log: (level: number, context: string, message: string) => void
      }

      imports.log(5, 'test', 'Critical!')
      expect(buffer.hasErrors).toBe(true)
    })

    it('clear removes all entries', () => {
      const { instance, buffer } = createBufferLogger()
      const imports = instance.getImports() as {
        log: (level: number, context: string, message: string) => void
      }

      imports.log(2, 'test', 'Message')
      expect(buffer.count).toBe(1)

      buffer.clear()
      expect(buffer.count).toBe(0)
    })
  })

  describe('formatting and export', () => {
    it('format returns formatted strings', () => {
      const { instance, buffer } = createBufferLogger()
      const imports = instance.getImports() as {
        log: (level: number, context: string, message: string) => void
      }

      imports.log(2, 'http', 'Request received')
      imports.log(3, 'db', 'Slow query')

      const formatted = buffer.format()
      expect(formatted).toHaveLength(2)
      expect(formatted[0]).toContain('[INFO]')
      expect(formatted[0]).toContain('[http]')
      expect(formatted[0]).toContain('Request received')
      expect(formatted[1]).toContain('[WARN]')
      expect(formatted[1]).toContain('[db]')
    })

    it('format can include timestamps', () => {
      const { instance, buffer } = createBufferLogger()
      const imports = instance.getImports() as {
        log: (level: number, context: string, message: string) => void
      }

      imports.log(2, 'test', 'Message')

      const withTimestamp = buffer.format({ showTimestamp: true })
      expect(withTimestamp[0]).toMatch(/^\[/)
    })

    it('toJSON exports entries', () => {
      const { instance, buffer } = createBufferLogger()
      const imports = instance.getImports() as {
        log: (level: number, context: string, message: string) => void
      }

      imports.log(2, 'test', 'Message')

      const json = buffer.toJSON()
      expect(json).toHaveLength(1)
      expect(json[0].level).toBe('info')
      expect(json[0].context).toBe('test')
      expect(json[0].message).toBe('Message')
    })

    it('toJSON returns a copy', () => {
      const { instance, buffer } = createBufferLogger()
      const imports = instance.getImports() as {
        log: (level: number, context: string, message: string) => void
      }

      imports.log(2, 'test', 'Message')

      const json1 = buffer.toJSON()
      imports.log(2, 'test', 'Another')
      const json2 = buffer.toJSON()

      expect(json1).toHaveLength(1)
      expect(json2).toHaveLength(2)
    })
  })
})

describe('plugin integration', () => {
  it('can create console instance via plugin', () => {
    const mockConsole = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const instance = loggingPlugin.create({
      implementation: 'console',
      console: mockConsole as unknown as Console,
    })

    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    imports.log(2, 'test', 'Hello')

    expect(mockConsole.info).toHaveBeenCalled()
  })

  it('can create buffer instance via plugin', () => {
    const instance = loggingPlugin.create({
      implementation: 'buffer',
    })

    const imports = instance.getImports() as {
      log: (level: number, context: string, message: string) => void
    }

    // Just verify it doesn't throw
    imports.log(2, 'test', 'Hello')
  })
})
