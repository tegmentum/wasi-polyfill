/**
 * Filesystem types for wasi:filesystem/types
 *
 * Type definitions matching the WASI filesystem interface.
 */

/**
 * File descriptor type
 */
export type DescriptorType =
  | 'unknown'
  | 'block-device'
  | 'character-device'
  | 'directory'
  | 'fifo'
  | 'symbolic-link'
  | 'regular-file'
  | 'socket'

/**
 * Descriptor flags
 */
export interface DescriptorFlags {
  read?: boolean
  write?: boolean
  fileIntegritySync?: boolean
  dataIntegritySync?: boolean
  requestedWriteSync?: boolean
  mutateDirectory?: boolean
}

/**
 * File open flags
 */
export interface OpenFlags {
  create?: boolean
  directory?: boolean
  exclusive?: boolean
  truncate?: boolean
}

/**
 * Path flags for path operations
 */
export interface PathFlags {
  symlinkFollow?: boolean
}

/**
 * File timestamp representation
 */
export interface Datetime {
  seconds: bigint
  nanoseconds: number
}

/**
 * File metadata/status
 */
export interface DescriptorStat {
  type: DescriptorType
  linkCount: bigint
  size: bigint
  dataAccessTimestamp?: Datetime
  dataModificationTimestamp?: Datetime
  statusChangeTimestamp?: Datetime
}

/**
 * Directory entry
 */
export interface DirectoryEntry {
  type: DescriptorType
  name: string
}

/**
 * Directory entry with full stat
 */
export interface DirectoryEntryStream {
  entries: DirectoryEntry[]
  position: number
}

/**
 * Filesystem error codes matching WASI error-code type
 */
export enum FilesystemErrorCode {
  Access = 'access',
  WouldBlock = 'would-block',
  Already = 'already',
  BadDescriptor = 'bad-descriptor',
  Busy = 'busy',
  Deadlock = 'deadlock',
  Quota = 'quota',
  Exist = 'exist',
  FileTooLarge = 'file-too-large',
  IllegalByteSequence = 'illegal-byte-sequence',
  InProgress = 'in-progress',
  Interrupted = 'interrupted',
  Invalid = 'invalid',
  Io = 'io',
  IsDirectory = 'is-directory',
  Loop = 'loop',
  TooManyLinks = 'too-many-links',
  MessageSize = 'message-size',
  NameTooLong = 'name-too-long',
  NoDevice = 'no-device',
  NoEntry = 'no-entry',
  NoLock = 'no-lock',
  InsufficientMemory = 'insufficient-memory',
  InsufficientSpace = 'insufficient-space',
  NotDirectory = 'not-directory',
  NotEmpty = 'not-empty',
  NotRecoverable = 'not-recoverable',
  Unsupported = 'unsupported',
  NoTty = 'no-tty',
  NoSuchDevice = 'no-such-device',
  Overflow = 'overflow',
  NotPermitted = 'not-permitted',
  Pipe = 'pipe',
  ReadOnly = 'read-only',
  InvalidSeek = 'invalid-seek',
  TextFileBusy = 'text-file-busy',
  CrossDevice = 'cross-device',
}

/**
 * Filesystem error type
 */
export class FilesystemError extends Error {
  constructor(
    public readonly code: FilesystemErrorCode,
    message?: string
  ) {
    super(message ?? `Filesystem error: ${code}`)
    this.name = 'FilesystemError'
  }
}

/**
 * Result type for filesystem operations
 */
export type FilesystemResult<T> =
  | { tag: 'ok'; val: T }
  | { tag: 'err'; val: FilesystemErrorCode }

/**
 * Helper to create ok result
 */
export function ok<T>(val: T): FilesystemResult<T> {
  return { tag: 'ok', val }
}

/**
 * Helper to create error result
 */
export function err<T>(code: FilesystemErrorCode): FilesystemResult<T> {
  return { tag: 'err', val: code }
}

/**
 * New timestamp option for set-times
 */
export type NewTimestamp =
  | { tag: 'no-change' }
  | { tag: 'now' }
  | { tag: 'timestamp'; val: Datetime }

/**
 * Advice for read/write operations
 */
export type Advice =
  | 'normal'
  | 'sequential'
  | 'random'
  | 'will-need'
  | 'dont-need'
  | 'no-reuse'

/**
 * File mode flags for access check
 */
export interface AccessType {
  read?: boolean
  write?: boolean
  execute?: boolean
}

/**
 * Metadata hash for file identity
 */
export interface MetadataHashValue {
  lower: bigint
  upper: bigint
}

/**
 * Seek position reference
 */
export type SeekFrom =
  | { tag: 'start'; val: bigint }
  | { tag: 'current'; val: bigint }
  | { tag: 'end'; val: bigint }

/**
 * Internal file node for in-memory filesystem
 */
export interface FileNode {
  type: 'file'
  content: Uint8Array
  created: Datetime
  modified: Datetime
  accessed: Datetime
}

/**
 * Internal directory node for in-memory filesystem
 */
export interface DirectoryNode {
  type: 'directory'
  children: Map<string, FsNode>
  created: Datetime
  modified: Datetime
  accessed: Datetime
}

/**
 * Union of file system node types
 */
export type FsNode = FileNode | DirectoryNode

/**
 * Get current timestamp
 */
export function now(): Datetime {
  const ms = Date.now()
  return {
    seconds: BigInt(Math.floor(ms / 1000)),
    nanoseconds: (ms % 1000) * 1_000_000,
  }
}
