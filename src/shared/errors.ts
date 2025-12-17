/**
 * Error types for the WASIP2 polyfill
 */

/**
 * WASI error codes following the WASI Preview 2 specification
 */
export enum WasiErrorCode {
  /** Operation succeeded */
  Success = 0,
  /** Access denied */
  Access = 1,
  /** Resource would block */
  WouldBlock = 2,
  /** Connection aborted */
  ConnectionAborted = 3,
  /** Connection refused */
  ConnectionRefused = 4,
  /** Connection reset */
  ConnectionReset = 5,
  /** Resource exists */
  Exist = 6,
  /** Invalid argument */
  Invalid = 7,
  /** Invalid seek */
  InvalidSeek = 8,
  /** Is a directory */
  IsDirectory = 9,
  /** Message size */
  MessageSize = 10,
  /** Name too long */
  NameTooLong = 11,
  /** No entity */
  NoEntry = 12,
  /** Not a directory */
  NotDirectory = 13,
  /** Directory not empty */
  NotEmpty = 14,
  /** Not recoverable */
  NotRecoverable = 15,
  /** Unsupported operation */
  Unsupported = 16,
  /** Out of memory */
  OutOfMemory = 17,
  /** Permission denied */
  PermissionDenied = 18,
  /** Pipe closed */
  Pipe = 19,
  /** Read only file system */
  ReadOnly = 20,
  /** Resource busy */
  Busy = 21,
  /** Timed out */
  TimedOut = 22,
  /** Too many links */
  TooManyLinks = 23,
  /** Cross device */
  CrossDevice = 24,
}

/**
 * Base error class for WASI errors
 */
export class WasiError extends Error {
  readonly code: WasiErrorCode

  constructor(code: WasiErrorCode, message?: string) {
    super(message ?? WasiError.messageForCode(code))
    this.name = 'WasiError'
    this.code = code
  }

  static messageForCode(code: WasiErrorCode): string {
    switch (code) {
      case WasiErrorCode.Success:
        return 'Operation succeeded'
      case WasiErrorCode.Access:
        return 'Access denied'
      case WasiErrorCode.WouldBlock:
        return 'Resource would block'
      case WasiErrorCode.ConnectionAborted:
        return 'Connection aborted'
      case WasiErrorCode.ConnectionRefused:
        return 'Connection refused'
      case WasiErrorCode.ConnectionReset:
        return 'Connection reset'
      case WasiErrorCode.Exist:
        return 'Resource already exists'
      case WasiErrorCode.Invalid:
        return 'Invalid argument'
      case WasiErrorCode.InvalidSeek:
        return 'Invalid seek'
      case WasiErrorCode.IsDirectory:
        return 'Is a directory'
      case WasiErrorCode.MessageSize:
        return 'Message size'
      case WasiErrorCode.NameTooLong:
        return 'Name too long'
      case WasiErrorCode.NoEntry:
        return 'No such file or directory'
      case WasiErrorCode.NotDirectory:
        return 'Not a directory'
      case WasiErrorCode.NotEmpty:
        return 'Directory not empty'
      case WasiErrorCode.NotRecoverable:
        return 'Not recoverable'
      case WasiErrorCode.Unsupported:
        return 'Unsupported operation'
      case WasiErrorCode.OutOfMemory:
        return 'Out of memory'
      case WasiErrorCode.PermissionDenied:
        return 'Permission denied'
      case WasiErrorCode.Pipe:
        return 'Broken pipe'
      case WasiErrorCode.ReadOnly:
        return 'Read-only file system'
      case WasiErrorCode.Busy:
        return 'Resource busy'
      case WasiErrorCode.TimedOut:
        return 'Operation timed out'
      case WasiErrorCode.TooManyLinks:
        return 'Too many links'
      case WasiErrorCode.CrossDevice:
        return 'Cross-device link'
      default:
        return `Unknown error (${code})`
    }
  }
}

/**
 * Error thrown when a required plugin is not found
 */
export class PluginNotFoundError extends Error {
  readonly interface: string

  constructor(interfaceName: string) {
    super(`Plugin not found for interface: ${interfaceName}`)
    this.name = 'PluginNotFoundError'
    this.interface = interfaceName
  }
}

/**
 * Error thrown when an interface is not allowed by policy
 */
export class PolicyDeniedError extends Error {
  readonly interface: string

  constructor(interfaceName: string) {
    super(`Interface denied by policy: ${interfaceName}`)
    this.name = 'PolicyDeniedError'
    this.interface = interfaceName
  }
}

/**
 * Error thrown when an implementation is not found
 */
export class ImplementationNotFoundError extends Error {
  readonly interface: string
  readonly implementation: string

  constructor(interfaceName: string, implementationName: string) {
    super(
      `Implementation "${implementationName}" not found for interface: ${interfaceName}`
    )
    this.name = 'ImplementationNotFoundError'
    this.interface = interfaceName
    this.implementation = implementationName
  }
}

/**
 * Error thrown when a manifest is invalid
 */
export class ManifestError extends Error {
  constructor(message: string) {
    super(`Invalid manifest: ${message}`)
    this.name = 'ManifestError'
  }
}
