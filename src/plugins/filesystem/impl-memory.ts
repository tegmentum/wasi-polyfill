/**
 * In-memory filesystem implementation for wasi:filesystem/types
 *
 * Provides a safe, virtual filesystem entirely in memory.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { PollableRegistry, createReadyPollable, globalPollableRegistry } from '../io/pollable.js'
import {
  DescriptorType,
  DescriptorFlags,
  OpenFlags,
  PathFlags,
  DescriptorStat,
  DirectoryEntry,
  FilesystemErrorCode,
  FilesystemResult,
  ok,
  err,
  NewTimestamp,
  Advice,
  MetadataHashValue,
  FileNode,
  DirectoryNode,
  FsNode,
  now,
} from './types.js'

/**
 * Descriptor handle manager
 */
class DescriptorRegistry {
  private nextHandle = 3 // Start at 3 (0, 1, 2 reserved for stdio)
  private readonly descriptors: Map<number, Descriptor> = new Map()

  register(descriptor: Descriptor): number {
    const handle = this.nextHandle++
    descriptor.handle = handle
    this.descriptors.set(handle, descriptor)
    return handle
  }

  get(handle: number): Descriptor | undefined {
    return this.descriptors.get(handle)
  }

  drop(handle: number): void {
    const descriptor = this.descriptors.get(handle)
    if (descriptor) {
      descriptor.close()
      this.descriptors.delete(handle)
    }
  }

  clear(): void {
    for (const descriptor of this.descriptors.values()) {
      descriptor.close()
    }
    this.descriptors.clear()
  }
}

/**
 * In-memory filesystem
 */
export class MemoryFileSystem {
  private root: DirectoryNode

  constructor() {
    const timestamp = now()
    this.root = {
      type: 'directory',
      children: new Map(),
      created: timestamp,
      modified: timestamp,
      accessed: timestamp,
    }
  }

  /**
   * Resolve a path to its parent directory and final component
   */
  private resolvePath(
    path: string,
    from?: DirectoryNode
  ): FilesystemResult<{ parent: DirectoryNode; name: string; node?: FsNode }> {
    const parts = this.normalizePath(path).split('/').filter(Boolean)
    if (parts.length === 0) {
      return ok({ parent: this.root, name: '', node: this.root })
    }

    let current: DirectoryNode = from ?? this.root
    const name = parts.pop()!

    for (const part of parts) {
      if (part === '.') continue
      if (part === '..') {
        // In this simple implementation, we don't track parents
        // Just stay at current for '..'
        continue
      }

      const child = current.children.get(part)
      if (!child) {
        return err(FilesystemErrorCode.NoEntry)
      }
      if (child.type !== 'directory') {
        return err(FilesystemErrorCode.NotDirectory)
      }
      current = child
    }

    const node = current.children.get(name)
    const result: { parent: DirectoryNode; name: string; node?: FsNode } = { parent: current, name }
    if (node !== undefined) {
      result.node = node
    }
    return ok(result)
  }

  /**
   * Normalize a path (remove double slashes, etc.)
   */
  private normalizePath(path: string): string {
    return '/' + path.split('/').filter(Boolean).join('/')
  }

  /**
   * Get node at path
   */
  getNode(path: string, from?: DirectoryNode): FilesystemResult<FsNode> {
    if (path === '/' || path === '') {
      return ok(this.root)
    }

    const result = this.resolvePath(path, from)
    if (result.tag === 'err') return result

    if (!result.val.node) {
      return err(FilesystemErrorCode.NoEntry)
    }

    return ok(result.val.node)
  }

  /**
   * Create a file
   */
  createFile(
    path: string,
    flags: OpenFlags,
    from?: DirectoryNode
  ): FilesystemResult<FileNode> {
    const result = this.resolvePath(path, from)
    if (result.tag === 'err') return result

    const { parent, name, node } = result.val

    if (node) {
      if (flags.exclusive) {
        return err(FilesystemErrorCode.Exist)
      }
      if (node.type === 'directory') {
        return err(FilesystemErrorCode.IsDirectory)
      }
      if (flags.truncate) {
        node.content = new Uint8Array(0)
        node.modified = now()
      }
      return ok(node)
    }

    if (!flags.create) {
      return err(FilesystemErrorCode.NoEntry)
    }

    const timestamp = now()
    const newFile: FileNode = {
      type: 'file',
      content: new Uint8Array(0),
      created: timestamp,
      modified: timestamp,
      accessed: timestamp,
    }

    parent.children.set(name, newFile)
    parent.modified = now()

    return ok(newFile)
  }

  /**
   * Create a directory
   */
  createDirectory(path: string, from?: DirectoryNode): FilesystemResult<DirectoryNode> {
    const result = this.resolvePath(path, from)
    if (result.tag === 'err') return result

    const { parent, name, node } = result.val

    if (node) {
      return err(FilesystemErrorCode.Exist)
    }

    const timestamp = now()
    const newDir: DirectoryNode = {
      type: 'directory',
      children: new Map(),
      created: timestamp,
      modified: timestamp,
      accessed: timestamp,
    }

    parent.children.set(name, newDir)
    parent.modified = now()

    return ok(newDir)
  }

  /**
   * Remove a file or empty directory
   */
  remove(path: string, from?: DirectoryNode): FilesystemResult<void> {
    const result = this.resolvePath(path, from)
    if (result.tag === 'err') return result

    const { parent, name, node } = result.val

    if (!node) {
      return err(FilesystemErrorCode.NoEntry)
    }

    if (node.type === 'directory' && node.children.size > 0) {
      return err(FilesystemErrorCode.NotEmpty)
    }

    parent.children.delete(name)
    parent.modified = now()

    return ok(undefined)
  }

  /**
   * Rename/move a file or directory
   */
  rename(
    oldPath: string,
    newPath: string,
    fromOld?: DirectoryNode,
    fromNew?: DirectoryNode
  ): FilesystemResult<void> {
    const oldResult = this.resolvePath(oldPath, fromOld)
    if (oldResult.tag === 'err') return oldResult

    const { parent: oldParent, name: oldName, node: oldNode } = oldResult.val

    if (!oldNode) {
      return err(FilesystemErrorCode.NoEntry)
    }

    const newResult = this.resolvePath(newPath, fromNew)
    if (newResult.tag === 'err') return newResult

    const { parent: newParent, name: newName, node: existingNode } = newResult.val

    if (existingNode) {
      if (existingNode.type === 'directory') {
        if (oldNode.type !== 'directory') {
          return err(FilesystemErrorCode.IsDirectory)
        }
        if (existingNode.children.size > 0) {
          return err(FilesystemErrorCode.NotEmpty)
        }
      } else if (oldNode.type === 'directory') {
        return err(FilesystemErrorCode.NotDirectory)
      }
    }

    // Move the node
    oldParent.children.delete(oldName)
    oldParent.modified = now()
    newParent.children.set(newName, oldNode)
    newParent.modified = now()

    return ok(undefined)
  }

  /**
   * Get the root directory
   */
  getRoot(): DirectoryNode {
    return this.root
  }
}

/**
 * File or directory descriptor
 */
export class Descriptor {
  handle = 0
  private closed = false

  constructor(
    private readonly fs: MemoryFileSystem,
    private readonly node: FsNode,
    _path: string,
    private readonly flags: DescriptorFlags,
    private readonly pollableRegistry: PollableRegistry
  ) {
    // path is passed for future debugging purposes but not stored
  }

  isClosed(): boolean {
    return this.closed
  }

  close(): void {
    this.closed = true
  }

  private checkClosed(): FilesystemResult<void> {
    if (this.closed) {
      return err(FilesystemErrorCode.BadDescriptor)
    }
    return ok(undefined)
  }

  /**
   * Get file type
   */
  getType(): FilesystemResult<DescriptorType> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    return ok(this.node.type === 'file' ? 'regular-file' : 'directory')
  }

  /**
   * Get file stats
   */
  stat(): FilesystemResult<DescriptorStat> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    this.node.accessed = now()

    return ok({
      type: this.node.type === 'file' ? 'regular-file' : 'directory',
      linkCount: 1n,
      size: this.node.type === 'file' ? BigInt(this.node.content.length) : 0n,
      dataAccessTimestamp: this.node.accessed,
      dataModificationTimestamp: this.node.modified,
      statusChangeTimestamp: this.node.modified,
    })
  }

  /**
   * Set file times
   */
  setTimes(
    dataAccessTimestamp: NewTimestamp,
    dataModificationTimestamp: NewTimestamp
  ): FilesystemResult<void> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (!this.flags.write) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    if (dataAccessTimestamp.tag === 'timestamp') {
      this.node.accessed = dataAccessTimestamp.val
    } else if (dataAccessTimestamp.tag === 'now') {
      this.node.accessed = now()
    }

    if (dataModificationTimestamp.tag === 'timestamp') {
      this.node.modified = dataModificationTimestamp.val
    } else if (dataModificationTimestamp.tag === 'now') {
      this.node.modified = now()
    }

    return ok(undefined)
  }

  /**
   * Read bytes from file
   */
  read(length: bigint, offset: bigint): FilesystemResult<[Uint8Array, boolean]> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'file') {
      return err(FilesystemErrorCode.IsDirectory)
    }

    if (!this.flags.read) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    const start = Number(offset)
    const end = Math.min(start + Number(length), this.node.content.length)
    const data = this.node.content.slice(start, end)
    const eof = end >= this.node.content.length

    this.node.accessed = now()

    return ok([data, eof])
  }

  /**
   * Write bytes to file
   */
  write(buffer: Uint8Array, offset: bigint): FilesystemResult<bigint> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'file') {
      return err(FilesystemErrorCode.IsDirectory)
    }

    if (!this.flags.write) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    const start = Number(offset)
    const end = start + buffer.length

    // Expand file if needed
    if (end > this.node.content.length) {
      const newContent = new Uint8Array(end)
      newContent.set(this.node.content)
      this.node.content = newContent
    }

    this.node.content.set(buffer, start)
    this.node.modified = now()

    return ok(BigInt(buffer.length))
  }

  /**
   * Read directory entries
   */
  readDirectory(): FilesystemResult<DirectoryEntry[]> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    const entries: DirectoryEntry[] = []
    for (const [name, child] of this.node.children) {
      entries.push({
        type: child.type === 'file' ? 'regular-file' : 'directory',
        name,
      })
    }

    this.node.accessed = now()

    return ok(entries)
  }

  /**
   * Create directory at path relative to this descriptor
   */
  createDirectoryAt(path: string): FilesystemResult<void> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    if (!this.flags.mutateDirectory) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    const result = this.fs.createDirectory(path, this.node)
    if (result.tag === 'err') return result

    return ok(undefined)
  }

  /**
   * Get stat at path relative to this descriptor
   */
  statAt(_pathFlags: PathFlags, path: string): FilesystemResult<DescriptorStat> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    const nodeResult = this.fs.getNode(path, this.node)
    if (nodeResult.tag === 'err') return nodeResult

    const node = nodeResult.val
    node.accessed = now()

    return ok({
      type: node.type === 'file' ? 'regular-file' : 'directory',
      linkCount: 1n,
      size: node.type === 'file' ? BigInt(node.content.length) : 0n,
      dataAccessTimestamp: node.accessed,
      dataModificationTimestamp: node.modified,
      statusChangeTimestamp: node.modified,
    })
  }

  /**
   * Open file at path relative to this descriptor
   */
  openAt(
    _pathFlags: PathFlags,
    path: string,
    openFlags: OpenFlags,
    descriptorFlags: DescriptorFlags
  ): FilesystemResult<Descriptor> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    // Check if opening as directory
    if (openFlags.directory) {
      const nodeResult = this.fs.getNode(path, this.node)
      if (nodeResult.tag === 'err') {
        if (openFlags.create) {
          const createResult = this.fs.createDirectory(path, this.node)
          if (createResult.tag === 'err') return createResult
          return ok(
            new Descriptor(this.fs, createResult.val, path, descriptorFlags, this.pollableRegistry)
          )
        }
        return nodeResult
      }
      if (nodeResult.val.type !== 'directory') {
        return err(FilesystemErrorCode.NotDirectory)
      }
      return ok(
        new Descriptor(this.fs, nodeResult.val, path, descriptorFlags, this.pollableRegistry)
      )
    }

    // Opening as file
    const fileResult = this.fs.createFile(path, openFlags, this.node)
    if (fileResult.tag === 'err') return fileResult

    return ok(
      new Descriptor(this.fs, fileResult.val, path, descriptorFlags, this.pollableRegistry)
    )
  }

  /**
   * Remove directory at path
   */
  removeDirectoryAt(path: string): FilesystemResult<void> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    if (!this.flags.mutateDirectory) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    const nodeResult = this.fs.getNode(path, this.node)
    if (nodeResult.tag === 'err') return nodeResult

    if (nodeResult.val.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    return this.fs.remove(path, this.node)
  }

  /**
   * Unlink file at path
   */
  unlinkFileAt(path: string): FilesystemResult<void> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    if (!this.flags.mutateDirectory) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    const nodeResult = this.fs.getNode(path, this.node)
    if (nodeResult.tag === 'err') return nodeResult

    if (nodeResult.val.type !== 'file') {
      return err(FilesystemErrorCode.IsDirectory)
    }

    return this.fs.remove(path, this.node)
  }

  /**
   * Rename path relative to descriptors
   */
  renameAt(
    oldPath: string,
    newDescriptor: Descriptor,
    newPath: string
  ): FilesystemResult<void> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    if (!this.flags.mutateDirectory) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    const newDir = newDescriptor.node
    if (newDir.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    return this.fs.rename(oldPath, newPath, this.node, newDir)
  }

  /**
   * Sync file data to storage
   */
  sync(): FilesystemResult<void> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check
    // In-memory fs is always synced
    return ok(undefined)
  }

  /**
   * Sync file data (not metadata) to storage
   */
  syncData(): FilesystemResult<void> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check
    // In-memory fs is always synced
    return ok(undefined)
  }

  /**
   * Get metadata hash
   */
  metadataHash(): FilesystemResult<MetadataHashValue> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    // Simple hash based on timestamps and size
    const modified = this.node.modified.seconds
    const size = this.node.type === 'file' ? BigInt(this.node.content.length) : 0n

    return ok({
      lower: modified ^ size,
      upper: this.node.created.seconds,
    })
  }

  /**
   * Get metadata hash at path
   */
  metadataHashAt(_pathFlags: PathFlags, path: string): FilesystemResult<MetadataHashValue> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    const nodeResult = this.fs.getNode(path, this.node)
    if (nodeResult.tag === 'err') return nodeResult

    const node = nodeResult.val
    const modified = node.modified.seconds
    const size = node.type === 'file' ? BigInt(node.content.length) : 0n

    return ok({
      lower: modified ^ size,
      upper: node.created.seconds,
    })
  }

  /**
   * Subscribe for readiness (always ready for memory fs)
   */
  subscribe(): number {
    return createReadyPollable(this.pollableRegistry)
  }

  /**
   * Get underlying node (for internal use)
   */
  getNode(): FsNode {
    return this.node
  }

  /**
   * Get flags
   */
  getFlags(): FilesystemResult<DescriptorFlags> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check
    return ok({ ...this.flags })
  }

  /**
   * Check if readable
   */
  isReadable(): boolean {
    return !this.closed && !!this.flags.read
  }

  /**
   * Check if writable
   */
  isWritable(): boolean {
    return !this.closed && !!this.flags.write
  }
}

/**
 * Directory entry stream for iteration
 */
class DirectoryEntryStreamImpl {
  handle = 0
  private position = 0

  constructor(private readonly entries: DirectoryEntry[]) {}

  readEntry(): FilesystemResult<DirectoryEntry | undefined> {
    if (this.position >= this.entries.length) {
      return ok(undefined)
    }
    const entry = this.entries[this.position++]
    return ok(entry)
  }
}

/**
 * Directory entry stream registry
 */
class DirectoryEntryStreamRegistry {
  private nextHandle = 1
  private readonly streams: Map<number, DirectoryEntryStreamImpl> = new Map()

  register(stream: DirectoryEntryStreamImpl): number {
    const handle = this.nextHandle++
    stream.handle = handle
    this.streams.set(handle, stream)
    return handle
  }

  get(handle: number): DirectoryEntryStreamImpl | undefined {
    return this.streams.get(handle)
  }

  drop(handle: number): void {
    this.streams.delete(handle)
  }
}

// Global registries
const globalDescriptorRegistry = new DescriptorRegistry()
const globalDirectoryStreamRegistry = new DirectoryEntryStreamRegistry()

/**
 * Filesystem types plugin instance
 */
class FilesystemTypesInstance implements PluginInstance {
  private readonly fs: MemoryFileSystem
  private readonly descriptorRegistry: DescriptorRegistry
  private readonly directoryStreamRegistry: DirectoryEntryStreamRegistry
  private readonly pollableRegistry: PollableRegistry

  constructor() {
    this.fs = new MemoryFileSystem()
    this.descriptorRegistry = globalDescriptorRegistry
    this.directoryStreamRegistry = globalDirectoryStreamRegistry
    this.pollableRegistry = globalPollableRegistry
  }

  getImports(): Record<string, unknown> {
    return {
      // Descriptor resource methods
      '[resource-drop]descriptor': this.dropDescriptor.bind(this),
      '[method]descriptor.read-via-stream': this.readViaStream.bind(this),
      '[method]descriptor.write-via-stream': this.writeViaStream.bind(this),
      '[method]descriptor.append-via-stream': this.appendViaStream.bind(this),
      '[method]descriptor.advise': this.advise.bind(this),
      '[method]descriptor.sync-data': this.syncData.bind(this),
      '[method]descriptor.get-flags': this.getFlags.bind(this),
      '[method]descriptor.get-type': this.getType.bind(this),
      '[method]descriptor.set-size': this.setSize.bind(this),
      '[method]descriptor.set-times': this.setTimes.bind(this),
      '[method]descriptor.read': this.read.bind(this),
      '[method]descriptor.write': this.write.bind(this),
      '[method]descriptor.read-directory': this.readDirectory.bind(this),
      '[method]descriptor.sync': this.sync.bind(this),
      '[method]descriptor.create-directory-at': this.createDirectoryAt.bind(this),
      '[method]descriptor.stat': this.stat.bind(this),
      '[method]descriptor.stat-at': this.statAt.bind(this),
      '[method]descriptor.set-times-at': this.setTimesAt.bind(this),
      '[method]descriptor.link-at': this.linkAt.bind(this),
      '[method]descriptor.open-at': this.openAt.bind(this),
      '[method]descriptor.readlink-at': this.readlinkAt.bind(this),
      '[method]descriptor.remove-directory-at': this.removeDirectoryAt.bind(this),
      '[method]descriptor.rename-at': this.renameAt.bind(this),
      '[method]descriptor.symlink-at': this.symlinkAt.bind(this),
      '[method]descriptor.unlink-file-at': this.unlinkFileAt.bind(this),
      '[method]descriptor.is-same-object': this.isSameObject.bind(this),
      '[method]descriptor.metadata-hash': this.metadataHash.bind(this),
      '[method]descriptor.metadata-hash-at': this.metadataHashAt.bind(this),

      // Directory entry stream methods
      '[resource-drop]directory-entry-stream': this.dropDirectoryStream.bind(this),
      '[method]directory-entry-stream.read-directory-entry':
        this.readDirectoryEntry.bind(this),

      // Static functions
      'filesystem-error-code': this.filesystemErrorCode.bind(this),
    }
  }

  destroy(): void {
    this.descriptorRegistry.clear()
  }

  /**
   * Get the filesystem (for preopens plugin)
   */
  getFileSystem(): MemoryFileSystem {
    return this.fs
  }

  /**
   * Create a descriptor (for preopens plugin)
   */
  createDescriptor(path: string, flags: DescriptorFlags): Descriptor {
    const nodeResult = this.fs.getNode(path)
    if (nodeResult.tag === 'err') {
      // Create root directory if path is /
      if (path === '/') {
        const root = this.fs.getRoot()
        const descriptor = new Descriptor(this.fs, root, path, flags, this.pollableRegistry)
        this.descriptorRegistry.register(descriptor)
        return descriptor
      }
      throw new Error(`Path not found: ${path}`)
    }
    const descriptor = new Descriptor(this.fs, nodeResult.val, path, flags, this.pollableRegistry)
    this.descriptorRegistry.register(descriptor)
    return descriptor
  }

  // Implementation of all methods...

  private dropDescriptor(handle: number): void {
    this.descriptorRegistry.drop(handle)
  }

  private readViaStream(_handle: number, _offset: bigint): FilesystemResult<number> {
    // Stream-based read not implemented for memory fs
    return err(FilesystemErrorCode.Unsupported)
  }

  private writeViaStream(_handle: number, _offset: bigint): FilesystemResult<number> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private appendViaStream(_handle: number): FilesystemResult<number> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private advise(
    handle: number,
    _offset: bigint,
    _length: bigint,
    _advice: Advice
  ): FilesystemResult<void> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    // Advisory only, no-op for in-memory fs
    return ok(undefined)
  }

  private syncData(handle: number): FilesystemResult<void> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.syncData()
  }

  private getFlags(handle: number): FilesystemResult<DescriptorFlags> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.getFlags()
  }

  private getType(handle: number): FilesystemResult<DescriptorType> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.getType()
  }

  private setSize(handle: number, size: bigint): FilesystemResult<void> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const node = descriptor.getNode()
    if (node.type !== 'file') return err(FilesystemErrorCode.IsDirectory)
    if (!descriptor.isWritable()) return err(FilesystemErrorCode.NotPermitted)

    const newSize = Number(size)
    if (newSize < node.content.length) {
      node.content = node.content.slice(0, newSize)
    } else if (newSize > node.content.length) {
      const newContent = new Uint8Array(newSize)
      newContent.set(node.content)
      node.content = newContent
    }
    node.modified = now()

    return ok(undefined)
  }

  private setTimes(
    handle: number,
    dataAccessTimestamp: NewTimestamp,
    dataModificationTimestamp: NewTimestamp
  ): FilesystemResult<void> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.setTimes(dataAccessTimestamp, dataModificationTimestamp)
  }

  private read(
    handle: number,
    length: bigint,
    offset: bigint
  ): FilesystemResult<[Uint8Array, boolean]> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.read(length, offset)
  }

  private write(handle: number, buffer: Uint8Array, offset: bigint): FilesystemResult<bigint> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.write(buffer, offset)
  }

  private readDirectory(handle: number): FilesystemResult<number> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const entriesResult = descriptor.readDirectory()
    if (entriesResult.tag === 'err') return entriesResult

    const stream = new DirectoryEntryStreamImpl(entriesResult.val)
    const streamHandle = this.directoryStreamRegistry.register(stream)

    return ok(streamHandle)
  }

  private sync(handle: number): FilesystemResult<void> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.sync()
  }

  private createDirectoryAt(handle: number, path: string): FilesystemResult<void> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.createDirectoryAt(path)
  }

  private stat(handle: number): FilesystemResult<DescriptorStat> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.stat()
  }

  private statAt(handle: number, pathFlags: PathFlags, path: string): FilesystemResult<DescriptorStat> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.statAt(pathFlags, path)
  }

  private setTimesAt(
    handle: number,
    _pathFlags: PathFlags,
    path: string,
    dataAccessTimestamp: NewTimestamp,
    dataModificationTimestamp: NewTimestamp
  ): FilesystemResult<void> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    // For simplicity, get the node and set times directly
    const node = descriptor.getNode()
    if (node.type !== 'directory') return err(FilesystemErrorCode.NotDirectory)

    const targetResult = this.fs.getNode(path, node)
    if (targetResult.tag === 'err') return targetResult

    const target = targetResult.val
    if (dataAccessTimestamp.tag === 'timestamp') {
      target.accessed = dataAccessTimestamp.val
    } else if (dataAccessTimestamp.tag === 'now') {
      target.accessed = now()
    }

    if (dataModificationTimestamp.tag === 'timestamp') {
      target.modified = dataModificationTimestamp.val
    } else if (dataModificationTimestamp.tag === 'now') {
      target.modified = now()
    }

    return ok(undefined)
  }

  private linkAt(
    _handle: number,
    _oldPathFlags: PathFlags,
    _oldPath: string,
    _newDescriptor: number,
    _newPath: string
  ): FilesystemResult<void> {
    // Hard links not supported in memory fs
    return err(FilesystemErrorCode.Unsupported)
  }

  private openAt(
    handle: number,
    pathFlags: PathFlags,
    path: string,
    openFlags: OpenFlags,
    descriptorFlags: DescriptorFlags
  ): FilesystemResult<number> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const result = descriptor.openAt(pathFlags, path, openFlags, descriptorFlags)
    if (result.tag === 'err') return result

    const newHandle = this.descriptorRegistry.register(result.val)
    return ok(newHandle)
  }

  private readlinkAt(_handle: number, _path: string): FilesystemResult<string> {
    // Symlinks not supported in memory fs
    return err(FilesystemErrorCode.Unsupported)
  }

  private removeDirectoryAt(handle: number, path: string): FilesystemResult<void> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.removeDirectoryAt(path)
  }

  private renameAt(
    handle: number,
    oldPath: string,
    newHandle: number,
    newPath: string
  ): FilesystemResult<void> {
    const oldDescriptor = this.descriptorRegistry.get(handle)
    if (!oldDescriptor) return err(FilesystemErrorCode.BadDescriptor)

    const newDescriptor = this.descriptorRegistry.get(newHandle)
    if (!newDescriptor) return err(FilesystemErrorCode.BadDescriptor)

    return oldDescriptor.renameAt(oldPath, newDescriptor, newPath)
  }

  private symlinkAt(_handle: number, _oldPath: string, _newPath: string): FilesystemResult<void> {
    // Symlinks not supported in memory fs
    return err(FilesystemErrorCode.Unsupported)
  }

  private unlinkFileAt(handle: number, path: string): FilesystemResult<void> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.unlinkFileAt(path)
  }

  private isSameObject(handle: number, otherHandle: number): boolean {
    const descriptor = this.descriptorRegistry.get(handle)
    const other = this.descriptorRegistry.get(otherHandle)
    if (!descriptor || !other) return false
    return descriptor.getNode() === other.getNode()
  }

  private metadataHash(handle: number): FilesystemResult<MetadataHashValue> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.metadataHash()
  }

  private metadataHashAt(
    handle: number,
    pathFlags: PathFlags,
    path: string
  ): FilesystemResult<MetadataHashValue> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.metadataHashAt(pathFlags, path)
  }

  private dropDirectoryStream(handle: number): void {
    this.directoryStreamRegistry.drop(handle)
  }

  private readDirectoryEntry(handle: number): FilesystemResult<DirectoryEntry | undefined> {
    const stream = this.directoryStreamRegistry.get(handle)
    if (!stream) return err(FilesystemErrorCode.BadDescriptor)
    return stream.readEntry()
  }

  private filesystemErrorCode(error: Error): FilesystemErrorCode | undefined {
    if (error instanceof Error && 'code' in error) {
      return (error as { code: FilesystemErrorCode }).code
    }
    return undefined
  }
}

// Global instance for singleton access
let globalFilesystemInstance: FilesystemTypesInstance | null = null

/**
 * Memory filesystem implementation
 */
export const memoryFilesystemImplementation: Implementation = {
  name: 'memory',
  description: 'In-memory virtual filesystem',
  create(_config: PluginConfig): PluginInstance {
    // Use singleton pattern so preopens can access the same filesystem
    if (!globalFilesystemInstance) {
      globalFilesystemInstance = new FilesystemTypesInstance()
    }
    return globalFilesystemInstance
  },
}

/**
 * Get the global filesystem instance (for preopens)
 */
export function getGlobalFilesystemInstance(): FilesystemTypesInstance | null {
  return globalFilesystemInstance
}
