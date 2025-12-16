/**
 * wasi:filesystem plugin
 *
 * Provides filesystem functionality with multiple backends:
 * - In-memory filesystem (default, safe)
 * - Origin Private File System (OPFS) for browser persistent storage
 *
 * Security note: This plugin defaults to no preopens (empty filesystem).
 * Explicit configuration is required to grant access to paths.
 *
 * Interfaces:
 * - wasi:filesystem/types - File descriptor operations, paths, metadata
 * - wasi:filesystem/preopens - Pre-opened directories
 */

// Plugin exports
export {
  filesystemTypesPlugin,
  filesystemPreopensPlugin,
  filesystemPlugins,
  FILESYSTEM_TYPES_INTERFACE,
  FILESYSTEM_PREOPENS_INTERFACE,
} from './plugin.js'

// Types
export type {
  DescriptorType,
  DescriptorFlags,
  OpenFlags,
  PathFlags,
  Datetime,
  DescriptorStat,
  DirectoryEntry,
  FilesystemResult,
  NewTimestamp,
  Advice,
  MetadataHashValue,
  AccessType,
  SeekFrom,
  FileNode,
  DirectoryNode,
  FsNode,
} from './types.js'

export {
  FilesystemErrorCode,
  FilesystemError,
  ok,
  err,
  now,
} from './types.js'

// Implementations
export {
  memoryFilesystemImplementation,
  MemoryFileSystem,
  Descriptor,
  getGlobalFilesystemInstance,
} from './impl-memory.js'

// OPFS Implementation
export type { OpfsConfig } from './impl-opfs.js'
export {
  opfsFilesystemImplementation,
  OpfsDescriptor,
  isOpfsAvailable,
  getGlobalOpfsFilesystemInstance,
} from './impl-opfs.js'

export type { PreopensConfig } from './preopens.js'
export {
  memoryPreopensImplementation,
  emptyPreopensImplementation,
} from './preopens.js'
