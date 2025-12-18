/**
 * WASI I/O 0.3.0 interface
 *
 * In P3, streams and futures are built-in types, so wasi:io is simplified
 * to just the error-context resource and basic error handling.
 *
 * @packageDocumentation
 */

import type { ErrorContext, WasiErrorCode } from '../types.js'

/**
 * Error context implementation.
 *
 * Provides richer error information across component boundaries.
 */
export class ErrorContextImpl implements ErrorContext {
  constructor(private message: string) {}

  getDebugMessage(): string {
    return this.message
  }
}

/**
 * Create an error context from an error code.
 *
 * @param code - WASI error code
 * @returns Error context with debug message
 */
export function createErrorContext(code: WasiErrorCode): ErrorContext {
  const messages: Record<WasiErrorCode, string> = {
    0: 'success',
    1: 'access denied',
    2: 'operation would block',
    3: 'operation already in progress',
    4: 'bad file descriptor',
    5: 'resource busy',
    6: 'resource deadlock would occur',
    7: 'disk quota exceeded',
    8: 'file exists',
    9: 'file too large',
    10: 'illegal byte sequence',
    11: 'operation in progress',
    12: 'interrupted system call',
    13: 'invalid argument',
    14: 'I/O error',
    15: 'is a directory',
    16: 'too many levels of symbolic links',
    17: 'too many links',
    18: 'message too long',
    19: 'file name too long',
    20: 'no such device',
    21: 'no such file or directory',
    22: 'no locks available',
    23: 'not enough space',
    24: 'no space left on device',
    25: 'not a directory',
    26: 'directory not empty',
    27: 'state not recoverable',
    28: 'operation not supported',
    29: 'not a terminal',
    30: 'no such device or address',
    31: 'value too large for defined data type',
    32: 'operation not permitted',
    33: 'broken pipe',
    34: 'read-only file system',
    35: 'invalid seek',
    36: 'text file busy',
    37: 'cross-device link',
  }

  return new ErrorContextImpl(messages[code] ?? `unknown error: ${code}`)
}

/**
 * Create an error context from a JavaScript error.
 *
 * @param error - JavaScript error
 * @returns Error context with debug message
 */
export function errorContextFromError(error: unknown): ErrorContext {
  if (error instanceof Error) {
    return new ErrorContextImpl(error.message)
  }
  return new ErrorContextImpl(String(error))
}

/**
 * Map a JavaScript error to a WASI error code.
 *
 * @param error - JavaScript error
 * @returns WASI error code
 */
export function mapErrorToCode(error: unknown): WasiErrorCode {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('not found') || message.includes('no such file')) {
      return 21 // NO_ENTRY
    }
    if (message.includes('permission') || message.includes('access')) {
      return 1 // ACCESS
    }
    if (message.includes('exists')) {
      return 8 // EXIST
    }
    if (message.includes('directory')) {
      return 15 // IS_DIRECTORY or 25 // NOT_DIRECTORY
    }
    if (message.includes('busy')) {
      return 5 // BUSY
    }
    if (message.includes('invalid')) {
      return 13 // INVALID
    }
  }

  return 14 // IO - generic I/O error
}

/**
 * Get the wasi:io@0.3.0 imports.
 *
 * @returns Import object for wasi:io@0.3.0
 */
export function getIoImports(): Record<string, unknown> {
  // Resource handle counter
  let nextHandle = 1
  const errorContexts = new Map<number, ErrorContext>()

  return {
    'wasi:io/error@0.3.0': {
      // Error context resource
      '[resource-new]error-context': (message: string): number => {
        const handle = nextHandle++
        errorContexts.set(handle, new ErrorContextImpl(message))
        return handle
      },

      '[resource-drop]error-context': (handle: number): void => {
        errorContexts.delete(handle)
      },

      '[method]error-context.get-debug-message': (handle: number): string => {
        const ctx = errorContexts.get(handle)
        return ctx?.getDebugMessage() ?? 'unknown error'
      },
    },
  }
}
