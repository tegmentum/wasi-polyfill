/**
 * In-memory filesystem implementation for wasi:filesystem/types
 *
 * Provides a safe, virtual filesystem entirely in memory.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  contextFromConfig,
  globalResourceContext,
} from '../../core/resource-context.js'
import { HandleRegistry } from '../../../shared/registry.js'
import { PollableRegistry, createReadyPollable, globalPollableRegistry } from '../io/pollable.js'
import { MemoryInputStream, globalStreamRegistry } from '../io/streams.js'
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
  SymlinkNode,
  FsNode,
  now,
} from './types.js'
import type { OutputStream, InputStream, StreamError } from '../io/streams.js'

/** Maximum symlink chain depth before reporting a loop. */
const MAX_SYMLINK_DEPTH = 40

/**
 * Grow a file node's content to at least `newSize` bytes, amortizing
 * reallocation by capacity-doubling the backing ArrayBuffer. `node.content`
 * stays a view whose `.length` equals the logical file size, so every reader
 * that treats `content.length` as the size (stat, read, slice) is unaffected;
 * only the backing buffer may be larger. Newly exposed bytes are zero-filled
 * to honor POSIX hole/extend semantics. No-op when already large enough.
 *
 * Without this, streaming appends reallocate to the exact size on every write,
 * making N sequential appends O(N^2); doubling makes them amortized O(N).
 */
function growFile(node: FileNode, newSize: number): void {
  const view = node.content
  const oldSize = view.length
  if (newSize <= oldSize) return
  const buf = view.buffer
  // Reuse the existing backing buffer when it has spare capacity.
  if (view.byteOffset === 0 && buf.byteLength >= newSize) {
    const grown = new Uint8Array(buf, 0, newSize)
    grown.fill(0, oldSize, newSize)
    node.content = grown
    return
  }
  // Otherwise allocate a larger (doubled) buffer and copy the live bytes.
  let capacity = buf.byteLength || 64
  while (capacity < newSize) capacity *= 2
  const next = new Uint8Array(capacity)
  next.set(view)
  node.content = next.subarray(0, newSize)
}

/** Map an internal node to its WASI descriptor type. */
function descriptorTypeOf(node: FsNode): DescriptorType {
  switch (node.type) {
    case 'file':
      return 'regular-file'
    case 'directory':
      return 'directory'
    case 'symlink':
      return 'symbolic-link'
  }
}

/**
 * Output stream that writes directly into a FileNode's content buffer.
 * Used by writeViaStream / appendViaStream.
 */
class FileWriteStream implements OutputStream {
  handle = 0
  private readonly node: FileNode
  private offset: number
  private closed = false

  /** Pass startOffset = -1 for append mode */
  constructor(node: FileNode, startOffset: number) {
    this.node = node
    this.offset = startOffset === -1 ? node.content.length : startOffset
  }

  isClosed(): boolean { return this.closed }
  close(): void { this.closed = true }

  checkWrite(): bigint | StreamError {
    if (this.closed) return { tag: 'closed' }
    return 65536n
  }

  write(contents: Uint8Array): StreamError | undefined {
    if (this.closed) return { tag: 'closed' }
    const end = this.offset + contents.length
    growFile(this.node, end)
    this.node.content.set(contents, this.offset)
    this.offset += contents.length
    return undefined
  }

  blockingWriteAndFlush(contents: Uint8Array): StreamError | undefined {
    const error = this.write(contents)
    if (error) return error
    return this.flush()
  }

  flush(): StreamError | undefined {
    if (this.closed) return { tag: 'closed' }
    return undefined
  }

  blockingFlush(): StreamError | undefined {
    return this.flush()
  }

  subscribe(registry: PollableRegistry): number {
    return createReadyPollable(registry)
  }

  writeZeroes(len: bigint): StreamError | undefined {
    return this.write(new Uint8Array(Number(len)))
  }

  splice(src: InputStream, len: bigint): bigint | StreamError {
    const data = src.read(len)
    if (!(data instanceof Uint8Array)) return data
    const error = this.write(data)
    if (error) return error
    return BigInt(data.length)
  }
}

/**
 * Descriptor handle manager
 */
class DescriptorRegistry extends HandleRegistry<Descriptor> {
  constructor() {
    super(3) // Handles 0, 1, 2 are reserved for stdio.
  }

  override register(descriptor: Descriptor): number {
    const handle = super.register(descriptor)
    descriptor.handle = handle
    return handle
  }

  override drop(handle: number): boolean {
    this.get(handle)?.close()
    return super.drop(handle)
  }

  override clear(): void {
    this.forEach((descriptor) => descriptor.close())
    super.clear()
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
    from?: DirectoryNode,
    followFinal = false,
    depth = 0
  ): FilesystemResult<{ parent: DirectoryNode; name: string; node?: FsNode }> {
    if (depth > MAX_SYMLINK_DEPTH) {
      return err(FilesystemErrorCode.Loop)
    }
    const parts = this.normalizePath(path).split('/').filter(Boolean)
    if (parts.length === 0) {
      return ok({ parent: this.root, name: '', node: this.root })
    }

    let current: DirectoryNode = from ?? this.root
    const name = parts.pop()!

    for (const part of parts) {
      // '.'/'..' are already resolved by normalizePath; skip defensively.
      if (part === '.' || part === '..') continue

      let child = current.children.get(part)
      if (!child) {
        return err(FilesystemErrorCode.NoEntry)
      }
      // Intermediate symlinks are always followed (POSIX semantics).
      if (child.type === 'symlink') {
        const target = this.followLink(child, current, depth)
        if (target.tag === 'err') return target
        child = target.val
      }
      if (child.type !== 'directory') {
        return err(FilesystemErrorCode.NotDirectory)
      }
      current = child
    }

    let node = current.children.get(name)
    if (followFinal && node && node.type === 'symlink') {
      const target = this.followLink(node, current, depth)
      if (target.tag === 'err') return target
      node = target.val
    }
    const result: { parent: DirectoryNode; name: string; node?: FsNode } = { parent: current, name }
    if (node !== undefined) {
      result.node = node
    }
    return ok(result)
  }

  /**
   * Resolve a symlink node to the node it points at, following chains and
   * guarding against loops. Targets are resolved relative to the link's
   * directory (or the root for absolute targets).
   */
  private followLink(
    link: SymlinkNode,
    parent: DirectoryNode,
    depth: number
  ): FilesystemResult<FsNode> {
    if (depth >= MAX_SYMLINK_DEPTH) {
      return err(FilesystemErrorCode.Loop)
    }
    const from = link.target.startsWith('/') ? this.root : parent
    const resolved = this.resolvePath(link.target, from, true, depth + 1)
    if (resolved.tag === 'err') return resolved
    if (!resolved.val.node) {
      return err(FilesystemErrorCode.NoEntry)
    }
    return ok(resolved.val.node)
  }

  /**
   * Normalize a path: collapse double slashes and resolve '.'/'..'.
   *
   * '..' is clamped at the root so a path can never escape the filesystem
   * (defense-in-depth), and 'a/../b' correctly resolves to '/b' instead of
   * leaving a stray '..' component for the traversal to ignore.
   */
  private normalizePath(path: string): string {
    const stack: string[] = []
    for (const part of path.split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        stack.pop()
        continue
      }
      stack.push(part)
    }
    return '/' + stack.join('/')
  }

  /**
   * Get node at path
   */
  getNode(
    path: string,
    from?: DirectoryNode,
    followFinal = false
  ): FilesystemResult<FsNode> {
    if (path === '/' || path === '') {
      return ok(this.root)
    }

    const result = this.resolvePath(path, from, followFinal)
    if (result.tag === 'err') return result

    if (!result.val.node) {
      return err(FilesystemErrorCode.NoEntry)
    }

    return ok(result.val.node)
  }

  /**
   * Create a symbolic link at `linkPath` pointing at `target` (stored verbatim).
   */
  symlink(
    target: string,
    linkPath: string,
    from?: DirectoryNode
  ): FilesystemResult<void> {
    const result = this.resolvePath(linkPath, from)
    if (result.tag === 'err') return result

    const { parent, name, node } = result.val
    if (node) {
      return err(FilesystemErrorCode.Exist)
    }

    const timestamp = now()
    const link: SymlinkNode = {
      type: 'symlink',
      target,
      created: timestamp,
      modified: timestamp,
      accessed: timestamp,
    }
    parent.children.set(name, link)
    parent.modified = now()
    return ok(undefined)
  }

  /**
   * Read the target of a symbolic link (does not follow it).
   */
  readlink(path: string, from?: DirectoryNode): FilesystemResult<string> {
    const result = this.resolvePath(path, from)
    if (result.tag === 'err') return result

    const { node } = result.val
    if (!node) return err(FilesystemErrorCode.NoEntry)
    if (node.type !== 'symlink') {
      return err(FilesystemErrorCode.Invalid)
    }
    return ok(node.target)
  }

  /**
   * Create a hard link: point `newPath` at the same node as `oldPath`.
   */
  hardLink(
    oldPath: string,
    newPath: string,
    followOld: boolean,
    fromOld?: DirectoryNode,
    fromNew?: DirectoryNode
  ): FilesystemResult<void> {
    const oldResult = this.resolvePath(oldPath, fromOld, followOld)
    if (oldResult.tag === 'err') return oldResult
    if (!oldResult.val.node) return err(FilesystemErrorCode.NoEntry)
    const target = oldResult.val.node
    if (target.type === 'directory') {
      return err(FilesystemErrorCode.NotPermitted)
    }

    const newResult = this.resolvePath(newPath, fromNew)
    if (newResult.tag === 'err') return newResult
    const { parent, name, node: existing } = newResult.val
    if (existing) return err(FilesystemErrorCode.Exist)

    parent.children.set(name, target)
    parent.modified = now()
    return ok(undefined)
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

    const { parent, name } = result.val
    let node = result.val.node

    // Opening follows a final symlink to its target (POSIX open semantics).
    if (node && node.type === 'symlink') {
      const followed = this.followLink(node, parent, 0)
      if (followed.tag === 'err') return followed
      node = followed.val
    }

    if (node) {
      if (flags.exclusive) {
        return err(FilesystemErrorCode.Exist)
      }
      if (node.type === 'directory') {
        return err(FilesystemErrorCode.IsDirectory)
      }
      if (node.type !== 'file') {
        return err(FilesystemErrorCode.Invalid)
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

  /**
   * Create a directory and all intermediate directories (like mkdir -p).
   * Returns the final directory node.
   */
  mkdirp(path: string): FilesystemResult<DirectoryNode> {
    const parts = this.normalizePath(path).split('/').filter(Boolean)
    let current = this.root
    for (const part of parts) {
      const existing = current.children.get(part)
      if (existing) {
        if (existing.type !== 'directory') {
          return err(FilesystemErrorCode.NotDirectory)
        }
        current = existing
      } else {
        const timestamp = now()
        const newDir: DirectoryNode = {
          type: 'directory',
          children: new Map(),
          created: timestamp,
          modified: timestamp,
          accessed: timestamp,
        }
        current.children.set(part, newDir)
        current.modified = timestamp
        current = newDir
      }
    }
    return ok(current)
  }

  /**
   * Write a file at the given path, creating intermediate directories
   * as needed.  Overwrites any existing file at that path.
   */
  writeFile(path: string, content: Uint8Array): FilesystemResult<FileNode> {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash > 0) {
      const dirPath = normalized.slice(0, lastSlash)
      const dirResult = this.mkdirp(dirPath)
      if (dirResult.tag === 'err') return dirResult as FilesystemResult<FileNode>
    }
    const result = this.createFile(path, { create: true, truncate: true } as OpenFlags)
    if (result.tag === 'err') return result
    result.val.content = content
    result.val.modified = now()
    return result
  }

  /**
   * Build a pre-populated filesystem from a map of path → content.
   * Creates all intermediate directories automatically.
   *
   * @example
   * ```typescript
   * const fs = MemoryFileSystem.fromEntries({
   *   '/machine/cpu/vcpu0.bin': cpuBytes,
   *   '/machine/manifest.json': manifestBytes,
   * })
   * ```
   */
  static fromEntries(entries: Record<string, Uint8Array>): MemoryFileSystem {
    const fs = new MemoryFileSystem()
    for (const [path, content] of Object.entries(entries)) {
      const result = fs.writeFile(path, content)
      if (result.tag === 'err') {
        throw new Error(`Failed to write ${path}: ${result.val}`)
      }
    }
    return fs
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

    return ok(descriptorTypeOf(this.node))
  }

  /**
   * Get file stats
   */
  stat(): FilesystemResult<DescriptorStat> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    this.node.accessed = now()

    return ok({
      type: descriptorTypeOf(this.node),
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

    // Expand (capacity-doubling) if needed; zero-fills any gap before `start`.
    growFile(this.node, end)

    this.node.content.set(buffer, start)
    this.node.modified = now()

    return ok(BigInt(buffer.length))
  }

  /**
   * Get file content from offset as an InputStream handle.
   */
  readViaStream(offset: bigint): FilesystemResult<number> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'file') {
      return err(FilesystemErrorCode.IsDirectory)
    }

    if (!this.flags.read) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    const start = Math.min(Number(offset), this.node.content.length)
    const data = this.node.content.slice(start)
    const stream = new MemoryInputStream(data)
    const streamHandle = globalStreamRegistry.register(stream)

    this.node.accessed = now()

    return ok(streamHandle)
  }

  /**
   * Get an OutputStream handle that writes to this file at offset.
   */
  writeViaStream(offset: bigint): FilesystemResult<number> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'file') {
      return err(FilesystemErrorCode.IsDirectory)
    }

    if (!this.flags.write) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    const stream = new FileWriteStream(this.node, Number(offset))
    const streamHandle = globalStreamRegistry.register(stream)
    return ok(streamHandle)
  }

  /**
   * Get an OutputStream handle that appends to this file.
   */
  appendViaStream(): FilesystemResult<number> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'file') {
      return err(FilesystemErrorCode.IsDirectory)
    }

    if (!this.flags.write) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    const stream = new FileWriteStream(this.node, -1)
    const streamHandle = globalStreamRegistry.register(stream)
    return ok(streamHandle)
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
        type: descriptorTypeOf(child),
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
  statAt(pathFlags: PathFlags, path: string): FilesystemResult<DescriptorStat> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    const nodeResult = this.fs.getNode(path, this.node, pathFlags.symlinkFollow)
    if (nodeResult.tag === 'err') return nodeResult

    const node = nodeResult.val
    node.accessed = now()

    return ok({
      type: descriptorTypeOf(node),
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
    pathFlags: PathFlags,
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
      const nodeResult = this.fs.getNode(path, this.node, pathFlags.symlinkFollow)
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
   * Create a symbolic link `newPath` (relative to this directory) -> `target`.
   */
  symlinkAt(target: string, newPath: string): FilesystemResult<void> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check
    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }
    if (!this.flags.mutateDirectory) {
      return err(FilesystemErrorCode.NotPermitted)
    }
    return this.fs.symlink(target, newPath, this.node)
  }

  /**
   * Read the target of a symbolic link relative to this directory.
   */
  readlinkAt(path: string): FilesystemResult<string> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check
    if (this.node.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }
    return this.fs.readlink(path, this.node)
  }

  /**
   * Create a hard link from `oldPath` (under `oldDescriptor`) to `newPath`
   * (under this directory).
   */
  linkAt(
    oldPathFlags: PathFlags,
    oldPath: string,
    oldDescriptor: Descriptor,
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
    const oldDir = oldDescriptor.getNode()
    if (oldDir.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }
    return this.fs.hardLink(
      oldPath,
      newPath,
      oldPathFlags.symlinkFollow ?? false,
      oldDir,
      this.node
    )
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
class DirectoryEntryStreamRegistry extends HandleRegistry<DirectoryEntryStreamImpl> {
  override register(stream: DirectoryEntryStreamImpl): number {
    const handle = super.register(stream)
    stream.handle = handle
    return handle
  }
}

// Global registries
const globalDescriptorRegistry = new DescriptorRegistry()
const globalDirectoryStreamRegistry = new DirectoryEntryStreamRegistry()

/**
 * Filesystem types plugin instance
 */
export class FilesystemTypesInstance implements PluginInstance {
  private readonly fs: MemoryFileSystem
  private readonly descriptorRegistry: DescriptorRegistry
  private readonly directoryStreamRegistry: DirectoryEntryStreamRegistry
  private readonly pollableRegistry: PollableRegistry

  constructor(prepopulatedFs?: MemoryFileSystem) {
    this.fs = prepopulatedFs ?? new MemoryFileSystem()
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

  /**
   * Resolve a descriptor handle and run `fn` with it, returning a
   * `BadDescriptor` error when the handle is unknown. Centralizes the
   * lookup-and-guard that every descriptor method repeated.
   */
  private withDescriptor<T>(
    handle: number,
    fn: (descriptor: Descriptor) => FilesystemResult<T>
  ): FilesystemResult<T> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return fn(descriptor)
  }

  private readViaStream(handle: number, offset: bigint): FilesystemResult<number> {
    return this.withDescriptor(handle, (descriptor) => descriptor.readViaStream(offset))
  }

  private writeViaStream(handle: number, offset: bigint): FilesystemResult<number> {
    return this.withDescriptor(handle, (descriptor) => descriptor.writeViaStream(offset))
  }

  private appendViaStream(handle: number): FilesystemResult<number> {
    return this.withDescriptor(handle, (descriptor) => descriptor.appendViaStream())
  }

  private advise(
    handle: number,
    _offset: bigint,
    _length: bigint,
    _advice: Advice
  ): FilesystemResult<void> {
    // Validate the handle; advisory is a no-op for in-memory fs.
    return this.withDescriptor(handle, () => ok(undefined))
  }

  private syncData(handle: number): FilesystemResult<void> {
    return this.withDescriptor(handle, (descriptor) => descriptor.syncData())
  }

  private getFlags(handle: number): FilesystemResult<DescriptorFlags> {
    return this.withDescriptor(handle, (descriptor) => descriptor.getFlags())
  }

  private getType(handle: number): FilesystemResult<DescriptorType> {
    return this.withDescriptor(handle, (descriptor) => descriptor.getType())
  }

  private setSize(handle: number, size: bigint): FilesystemResult<void> {
    return this.withDescriptor(handle, (descriptor) => {
      const node = descriptor.getNode()
      if (node.type !== 'file') return err(FilesystemErrorCode.IsDirectory)
      if (!descriptor.isWritable()) return err(FilesystemErrorCode.NotPermitted)

      const newSize = Number(size)
      if (newSize < node.content.length) {
        // Shrink with a copy so the (possibly oversized) backing buffer is freed.
        node.content = node.content.slice(0, newSize)
      } else if (newSize > node.content.length) {
        growFile(node, newSize)
      }
      node.modified = now()

      return ok(undefined)
    })
  }

  private setTimes(
    handle: number,
    dataAccessTimestamp: NewTimestamp,
    dataModificationTimestamp: NewTimestamp
  ): FilesystemResult<void> {
    return this.withDescriptor(handle, (descriptor) => descriptor.setTimes(dataAccessTimestamp, dataModificationTimestamp))
  }

  private read(
    handle: number,
    length: bigint,
    offset: bigint
  ): FilesystemResult<[Uint8Array, boolean]> {
    return this.withDescriptor(handle, (descriptor) => descriptor.read(length, offset))
  }

  private write(handle: number, buffer: Uint8Array, offset: bigint): FilesystemResult<bigint> {
    return this.withDescriptor(handle, (descriptor) => descriptor.write(buffer, offset))
  }

  private readDirectory(handle: number): FilesystemResult<number> {
    return this.withDescriptor(handle, (descriptor) => {
      const entriesResult = descriptor.readDirectory()
      if (entriesResult.tag === 'err') return entriesResult

      const stream = new DirectoryEntryStreamImpl(entriesResult.val)
      const streamHandle = this.directoryStreamRegistry.register(stream)

      return ok(streamHandle)
    })
  }

  private sync(handle: number): FilesystemResult<void> {
    return this.withDescriptor(handle, (descriptor) => descriptor.sync())
  }

  private createDirectoryAt(handle: number, path: string): FilesystemResult<void> {
    return this.withDescriptor(handle, (descriptor) => descriptor.createDirectoryAt(path))
  }

  private stat(handle: number): FilesystemResult<DescriptorStat> {
    return this.withDescriptor(handle, (descriptor) => descriptor.stat())
  }

  private statAt(handle: number, pathFlags: PathFlags, path: string): FilesystemResult<DescriptorStat> {
    return this.withDescriptor(handle, (descriptor) => descriptor.statAt(pathFlags, path))
  }

  private setTimesAt(
    handle: number,
    _pathFlags: PathFlags,
    path: string,
    dataAccessTimestamp: NewTimestamp,
    dataModificationTimestamp: NewTimestamp
  ): FilesystemResult<void> {
    return this.withDescriptor(handle, (descriptor) => {
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
    })
  }

  private linkAt(
    handle: number,
    oldPathFlags: PathFlags,
    oldPath: string,
    newDescriptor: number,
    newPath: string
  ): FilesystemResult<void> {
    return this.withDescriptor(handle, (oldDescriptor) =>
      this.withDescriptor(newDescriptor, (target) =>
        target.linkAt(oldPathFlags, oldPath, oldDescriptor, newPath)
      )
    )
  }

  private openAt(
    handle: number,
    pathFlags: PathFlags,
    path: string,
    openFlags: OpenFlags,
    descriptorFlags: DescriptorFlags
  ): FilesystemResult<number> {
    return this.withDescriptor(handle, (descriptor) => {
      const result = descriptor.openAt(pathFlags, path, openFlags, descriptorFlags)
      if (result.tag === 'err') return result

      const newHandle = this.descriptorRegistry.register(result.val)
      return ok(newHandle)
    })
  }

  private readlinkAt(handle: number, path: string): FilesystemResult<string> {
    return this.withDescriptor(handle, (descriptor) => descriptor.readlinkAt(path))
  }

  private removeDirectoryAt(handle: number, path: string): FilesystemResult<void> {
    return this.withDescriptor(handle, (descriptor) => descriptor.removeDirectoryAt(path))
  }

  private renameAt(
    handle: number,
    oldPath: string,
    newHandle: number,
    newPath: string
  ): FilesystemResult<void> {
    return this.withDescriptor(handle, (oldDescriptor) =>
      this.withDescriptor(newHandle, (newDescriptor) =>
        oldDescriptor.renameAt(oldPath, newDescriptor, newPath)
      )
    )
  }

  private symlinkAt(handle: number, oldPath: string, newPath: string): FilesystemResult<void> {
    // WASI symlink-at(old-path, new-path): old-path is the link *target*.
    return this.withDescriptor(handle, (descriptor) => descriptor.symlinkAt(oldPath, newPath))
  }

  private unlinkFileAt(handle: number, path: string): FilesystemResult<void> {
    return this.withDescriptor(handle, (descriptor) => descriptor.unlinkFileAt(path))
  }

  private isSameObject(handle: number, otherHandle: number): boolean {
    const descriptor = this.descriptorRegistry.get(handle)
    const other = this.descriptorRegistry.get(otherHandle)
    if (!descriptor || !other) return false
    return descriptor.getNode() === other.getNode()
  }

  private metadataHash(handle: number): FilesystemResult<MetadataHashValue> {
    return this.withDescriptor(handle, (descriptor) => descriptor.metadataHash())
  }

  private metadataHashAt(
    handle: number,
    pathFlags: PathFlags,
    path: string
  ): FilesystemResult<MetadataHashValue> {
    return this.withDescriptor(handle, (descriptor) => descriptor.metadataHashAt(pathFlags, path))
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

/**
 * ResourceContext key for the per-polyfill filesystem instance. fs/types and
 * preopens of one polyfill share it (same context + key); different polyfills
 * get isolated filesystems (no shared file data or descriptor handles).
 */
const FS_INSTANCE_KEY = Symbol('wasi:filesystem/instance')

// Optional pre-populated filesystem consumed by the first filesystem instance
// created in any context. Set via setGlobalFilesystem() before instantiation.
let pendingFilesystem: MemoryFileSystem | null = null

/** Take the pending pre-populated filesystem (one-shot). */
function consumePendingFilesystem(): MemoryFileSystem | undefined {
  const fs = pendingFilesystem ?? undefined
  pendingFilesystem = null
  return fs
}

/**
 * Resolve the filesystem instance for a plugin config (per-polyfill via its
 * ResourceContext, else the global context). Shared by fs/types and preopens.
 */
export function resolveFilesystemTypesInstance(
  config: PluginConfig
): FilesystemTypesInstance {
  return contextFromConfig(config).get(FS_INSTANCE_KEY, () => {
    // Per-config seeding (context-correct): prefer an explicit `prepopulatedFs`,
    // else the one-shot global pending (setGlobalFilesystem). The global pending
    // is consumed by whichever context resolves first, so it is unreliable when
    // several components instantiate (e.g. an extension preloaded before the
    // host); `options.prepopulatedFs` / `options.mkdirs` target *this* context's
    // filesystem deterministically.
    const provided =
      (config.options?.['prepopulatedFs'] as MemoryFileSystem | undefined) ??
      consumePendingFilesystem()
    const instance = new FilesystemTypesInstance(provided)
    // Pre-create directories so guests whose `mkdir` is non-recursive (e.g.
    // DuckDB creating ~/.duckdb/extension_data on LOAD) find their parents.
    const mkdirs = config.options?.['mkdirs']
    if (Array.isArray(mkdirs)) {
      const fs = instance.getFileSystem()
      for (const dir of mkdirs) {
        if (typeof dir === 'string') fs.mkdirp(dir)
      }
    }
    return instance
  })
}

/**
 * Set a pre-populated MemoryFileSystem to be used as the global
 * filesystem.  Must be called BEFORE any filesystem plugin is
 * instantiated (before `getImports()` or `instantiate()`).
 *
 * This is the primary integration point for use cases like
 * WasmMachine snapshot restore, where the filesystem needs to be
 * pre-populated with snapshot segments, firmware images, etc.
 *
 * @example
 * ```typescript
 * const fs = MemoryFileSystem.fromEntries({
 *   '/snapshots/machine/snap-1/manifest.json': manifestBytes,
 *   '/snapshots/machine/snap-1/cpu/vcpu0.bin': cpuBytes,
 * })
 * setGlobalFilesystem(fs)
 *
 * // Now create the polyfill — it will use the pre-populated FS
 * const polyfill = new Polyfill()
 * ```
 */
export function setGlobalFilesystem(fs: MemoryFileSystem): void {
  if (globalResourceContext.has(FS_INSTANCE_KEY)) {
    throw new Error(
      'setGlobalFilesystem must be called before any filesystem plugin is instantiated'
    )
  }
  pendingFilesystem = fs
}

/**
 * Reset the global filesystem state.  Useful for tests or
 * re-initialization.
 */
export function resetGlobalFilesystem(): void {
  globalResourceContext.delete(FS_INSTANCE_KEY)
  pendingFilesystem = null
}

/**
 * Memory filesystem implementation
 */
export const memoryFilesystemImplementation: Implementation = {
  name: 'memory',
  description: 'In-memory virtual filesystem',
  create(config: PluginConfig): PluginInstance {
    // Per-polyfill via the resource context; preopens resolves the same one.
    return resolveFilesystemTypesInstance(config)
  },
}

/**
 * Get the global filesystem instance (for preopens / external callers).
 * Returns the global context's instance, or null if none has been created.
 */
export function getGlobalFilesystemInstance(): FilesystemTypesInstance | null {
  if (!globalResourceContext.has(FS_INSTANCE_KEY)) {
    return null
  }
  return globalResourceContext.get(
    FS_INSTANCE_KEY,
    () => new FilesystemTypesInstance()
  )
}
