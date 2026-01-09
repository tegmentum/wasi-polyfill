/**
 * WASI I/O 0.3.0 Interface Tests
 */

import { describe, it, expect } from 'vitest'
import {
  ErrorContextImpl,
  createErrorContext,
  errorContextFromError,
  mapErrorToCode,
  getIoImports,
} from '../../src/wasip3/interfaces/io.js'

describe('WASIP3 I/O Interface', () => {
  describe('ErrorContextImpl', () => {
    it('stores and returns debug message', () => {
      const ctx = new ErrorContextImpl('test error message')
      expect(ctx.getDebugMessage()).toBe('test error message')
    })

    it('handles empty message', () => {
      const ctx = new ErrorContextImpl('')
      expect(ctx.getDebugMessage()).toBe('')
    })

    it('handles unicode characters', () => {
      const ctx = new ErrorContextImpl('Error: 文件未找到 🚫')
      expect(ctx.getDebugMessage()).toBe('Error: 文件未找到 🚫')
    })
  })

  describe('createErrorContext', () => {
    it('maps SUCCESS code', () => {
      const ctx = createErrorContext(0)
      expect(ctx.getDebugMessage()).toBe('success')
    })

    it('maps ACCESS code', () => {
      const ctx = createErrorContext(1)
      expect(ctx.getDebugMessage()).toBe('access denied')
    })

    it('maps WOULD_BLOCK code', () => {
      const ctx = createErrorContext(2)
      expect(ctx.getDebugMessage()).toBe('operation would block')
    })

    it('maps IO code', () => {
      const ctx = createErrorContext(14)
      expect(ctx.getDebugMessage()).toBe('I/O error')
    })

    it('maps NO_ENTRY code', () => {
      const ctx = createErrorContext(21)
      expect(ctx.getDebugMessage()).toBe('no such file or directory')
    })

    it('maps NOT_DIRECTORY code', () => {
      const ctx = createErrorContext(25)
      expect(ctx.getDebugMessage()).toBe('not a directory')
    })

    it('maps READ_ONLY code', () => {
      const ctx = createErrorContext(34)
      expect(ctx.getDebugMessage()).toBe('read-only file system')
    })

    it('handles unknown error codes', () => {
      const ctx = createErrorContext(999 as any)
      expect(ctx.getDebugMessage()).toBe('unknown error: 999')
    })
  })

  describe('errorContextFromError', () => {
    it('extracts message from Error', () => {
      const error = new Error('Something went wrong')
      const ctx = errorContextFromError(error)
      expect(ctx.getDebugMessage()).toBe('Something went wrong')
    })

    it('handles TypeError', () => {
      const error = new TypeError('Invalid type')
      const ctx = errorContextFromError(error)
      expect(ctx.getDebugMessage()).toBe('Invalid type')
    })

    it('converts string to context', () => {
      const ctx = errorContextFromError('string error')
      expect(ctx.getDebugMessage()).toBe('string error')
    })

    it('converts number to context', () => {
      const ctx = errorContextFromError(42)
      expect(ctx.getDebugMessage()).toBe('42')
    })

    it('converts null to context', () => {
      const ctx = errorContextFromError(null)
      expect(ctx.getDebugMessage()).toBe('null')
    })

    it('converts undefined to context', () => {
      const ctx = errorContextFromError(undefined)
      expect(ctx.getDebugMessage()).toBe('undefined')
    })

    it('converts object to context', () => {
      const ctx = errorContextFromError({ custom: 'error' })
      expect(ctx.getDebugMessage()).toBe('[object Object]')
    })
  })

  describe('mapErrorToCode', () => {
    it('maps "not found" error to NO_ENTRY', () => {
      const error = new Error('File not found')
      expect(mapErrorToCode(error)).toBe(21)
    })

    it('maps "no such file" error to NO_ENTRY', () => {
      const error = new Error('No such file or directory')
      expect(mapErrorToCode(error)).toBe(21)
    })

    it('maps "permission" error to ACCESS', () => {
      const error = new Error('Permission denied')
      expect(mapErrorToCode(error)).toBe(1)
    })

    it('maps "access" error to ACCESS', () => {
      const error = new Error('Access denied')
      expect(mapErrorToCode(error)).toBe(1)
    })

    it('maps "exists" error to EXIST', () => {
      const error = new Error('File already exists')
      expect(mapErrorToCode(error)).toBe(8)
    })

    it('maps "directory" error to IS_DIRECTORY', () => {
      const error = new Error('Is a directory')
      expect(mapErrorToCode(error)).toBe(15)
    })

    it('maps "busy" error to BUSY', () => {
      const error = new Error('Resource busy')
      expect(mapErrorToCode(error)).toBe(5)
    })

    it('maps "invalid" error to INVALID', () => {
      const error = new Error('Invalid argument')
      expect(mapErrorToCode(error)).toBe(13)
    })

    it('defaults to IO for unknown errors', () => {
      const error = new Error('Unknown error occurred')
      expect(mapErrorToCode(error)).toBe(14)
    })

    it('defaults to IO for non-Error', () => {
      expect(mapErrorToCode('string')).toBe(14)
      expect(mapErrorToCode(null)).toBe(14)
      expect(mapErrorToCode(undefined)).toBe(14)
    })

    it('handles case insensitivity', () => {
      expect(mapErrorToCode(new Error('NOT FOUND'))).toBe(21)
      expect(mapErrorToCode(new Error('PERMISSION DENIED'))).toBe(1)
    })
  })

  describe('getIoImports', () => {
    it('returns import object', () => {
      const imports = getIoImports()
      expect(imports).toHaveProperty('wasi:io/error@0.3.0')
    })

    it('creates error context resource', () => {
      const imports = getIoImports()
      const ioError = imports['wasi:io/error@0.3.0'] as Record<string, Function>

      const handle = ioError['[resource-new]error-context']('test message')
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('gets debug message from error context', () => {
      const imports = getIoImports()
      const ioError = imports['wasi:io/error@0.3.0'] as Record<string, Function>

      const handle = ioError['[resource-new]error-context']('test message')
      const message = ioError['[method]error-context.get-debug-message'](handle)
      expect(message).toBe('test message')
    })

    it('returns unknown error for invalid handle', () => {
      const imports = getIoImports()
      const ioError = imports['wasi:io/error@0.3.0'] as Record<string, Function>

      const message = ioError['[method]error-context.get-debug-message'](9999)
      expect(message).toBe('unknown error')
    })

    it('drops error context resource', () => {
      const imports = getIoImports()
      const ioError = imports['wasi:io/error@0.3.0'] as Record<string, Function>

      const handle = ioError['[resource-new]error-context']('test message')
      expect(ioError['[method]error-context.get-debug-message'](handle)).toBe('test message')

      ioError['[resource-drop]error-context'](handle)
      expect(ioError['[method]error-context.get-debug-message'](handle)).toBe('unknown error')
    })

    it('allocates unique handles', () => {
      const imports = getIoImports()
      const ioError = imports['wasi:io/error@0.3.0'] as Record<string, Function>

      const handle1 = ioError['[resource-new]error-context']('message 1')
      const handle2 = ioError['[resource-new]error-context']('message 2')
      const handle3 = ioError['[resource-new]error-context']('message 3')

      expect(handle1).not.toBe(handle2)
      expect(handle2).not.toBe(handle3)
      expect(handle1).not.toBe(handle3)

      expect(ioError['[method]error-context.get-debug-message'](handle1)).toBe('message 1')
      expect(ioError['[method]error-context.get-debug-message'](handle2)).toBe('message 2')
      expect(ioError['[method]error-context.get-debug-message'](handle3)).toBe('message 3')
    })
  })
})
