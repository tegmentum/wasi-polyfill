/**
 * Error handling for wasi:io/error
 *
 * Provides the error resource type used by WASI I/O operations.
 */

/**
 * Error resource for wasi:io/error
 *
 * Wraps an error with a debug message for WASI components.
 */
export class IoError {
  readonly handle: number
  private readonly error: Error
  private readonly debugMessage: string

  constructor(handle: number, error: Error, debugMessage?: string) {
    this.handle = handle
    this.error = error
    this.debugMessage = debugMessage ?? error.message
  }

  /**
   * Get a human-readable debug message
   */
  toDebugString(): string {
    return this.debugMessage
  }

  /**
   * Get the underlying error
   */
  getError(): Error {
    return this.error
  }
}

/**
 * Error registry for managing error resources
 */
export class ErrorRegistry {
  private nextHandle = 1
  private readonly errors: Map<number, IoError> = new Map()

  /**
   * Create a new error and return its handle
   */
  create(error: Error, debugMessage?: string): number {
    const handle = this.nextHandle++
    const ioError = new IoError(handle, error, debugMessage)
    this.errors.set(handle, ioError)
    return handle
  }

  /**
   * Get an error by handle
   */
  get(handle: number): IoError | undefined {
    return this.errors.get(handle)
  }

  /**
   * Get the debug string for an error
   */
  toDebugString(handle: number): string {
    const error = this.errors.get(handle)
    return error?.toDebugString() ?? 'Unknown error'
  }

  /**
   * Drop an error
   */
  drop(handle: number): boolean {
    return this.errors.delete(handle)
  }

  /**
   * Clear all errors
   */
  clear(): void {
    this.errors.clear()
  }
}

/**
 * Global error registry
 */
export const globalErrorRegistry = new ErrorRegistry()
