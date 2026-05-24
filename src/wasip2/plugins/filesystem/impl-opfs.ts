/**
 * Origin Private File System (OPFS) implementation for wasi:filesystem/types
 *
 * Provides persistent filesystem storage in browsers using the OPFS API.
 * OPFS is a sandboxed, origin-specific filesystem that persists across sessions.
 *
 * Note: OPFS is only available in secure contexts (HTTPS) and modern browsers.
 * The synchronous access handle API is only available in Web Workers.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  contextFromConfig,
  globalResourceContext,
} from '../../core/resource-context.js'
import { HandleRegistry } from '../../../shared/registry.js'
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
  Datetime,
  now,
} from './types.js'

/**
 * OPFS configuration
 */
export interface OpfsConfig {
  /**
   * Root directory name within OPFS (default: 'wasi-root')
   */
  rootDirName?: string
}

/**
 * Check if OPFS is available in the current environment
 */
export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function'
  )
}

/**
 * OPFS descriptor handle manager
 */
class OpfsDescriptorRegistry {
  private nextHandle = 3 // Start at 3 (0, 1, 2 reserved for stdio)
  private readonly descriptors: Map<number, OpfsDescriptor> = new Map()

  register(descriptor: OpfsDescriptor): number {
    const handle = this.nextHandle++
    descriptor.handle = handle
    this.descriptors.set(handle, descriptor)
    return handle
  }

  get(handle: number): OpfsDescriptor | undefined {
    return this.descriptors.get(handle)
  }

  async drop(handle: number): Promise<void> {
    const descriptor = this.descriptors.get(handle)
    if (descriptor) {
      await descriptor.close()
      this.descriptors.delete(handle)
    }
  }

  async clear(): Promise<void> {
    for (const descriptor of this.descriptors.values()) {
      await descriptor.close()
    }
    this.descriptors.clear()
  }
}

/**
 * Convert FileSystem timestamps to WASI datetime
 */
function fileTimeToDatetime(time: number): Datetime {
  const ms = time
  const seconds = BigInt(Math.floor(ms / 1000))
  const nanoseconds = (ms % 1000) * 1_000_000
  return { seconds, nanoseconds }
}

/** Canonical root-relative key for the times store (`/a//b/` -> `a/b`). */
function timesKey(...parts: string[]): string {
  return parts
    .join('/')
    .split('/')
    .filter(Boolean)
    .join('/')
}

/** Resolve a NewTimestamp to a Datetime, or undefined for `no-change`. */
function resolveNewTimestamp(ts: NewTimestamp): Datetime | undefined {
  if (ts.tag === 'timestamp') return ts.val
  if (ts.tag === 'now') return now()
  return undefined
}

/**
 * In-memory access/modification time overrides for OPFS, which has no native
 * set-times API (file `lastModified` is read-only and only bumped by writes).
 * Without this, `set-times` would silently no-op while pretending to succeed;
 * here it is recorded and reflected by `stat`/`stat-at` for the session. Scoped
 * to one OPFS filesystem instance, keyed by root-relative path.
 */
export class OpfsTimesStore {
  private readonly times = new Map<string, { atim?: Datetime; mtim?: Datetime }>()

  set(key: string, atim: Datetime | undefined, mtim: Datetime | undefined): void {
    if (atim === undefined && mtim === undefined) return
    const entry = this.times.get(key) ?? {}
    if (atim !== undefined) entry.atim = atim
    if (mtim !== undefined) entry.mtim = mtim
    this.times.set(key, entry)
  }

  get(key: string): { atim?: Datetime; mtim?: Datetime } | undefined {
    return this.times.get(key)
  }
}

/**
 * OPFS-backed descriptor
 */
export class OpfsDescriptor {
  handle = 0
  private closed = false
  private fileHandle: FileSystemFileHandle | null = null
  private dirHandle: FileSystemDirectoryHandle | null = null

  constructor(
    private readonly rootHandle: FileSystemDirectoryHandle,
    nodeHandle: FileSystemFileHandle | FileSystemDirectoryHandle,
    readonly descriptorPath: string,
    private readonly flags: DescriptorFlags,
    private readonly pollableRegistry: PollableRegistry,
    private readonly isDirectory: boolean,
    private readonly timesStore: OpfsTimesStore = new OpfsTimesStore()
  ) {
    if (isDirectory) {
      this.dirHandle = nodeHandle as FileSystemDirectoryHandle
    } else {
      this.fileHandle = nodeHandle as FileSystemFileHandle
    }
  }

  isClosed(): boolean {
    return this.closed
  }

  async close(): Promise<void> {
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
    return ok(this.isDirectory ? 'directory' : 'regular-file')
  }

  /**
   * Get file stats
   */
  async stat(): Promise<FilesystemResult<DescriptorStat>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    try {
      if (this.isDirectory) {
        const timestamp = now()
        return ok({
          type: 'directory',
          linkCount: 1n,
          size: 0n,
          dataAccessTimestamp: timestamp,
          dataModificationTimestamp: timestamp,
          statusChangeTimestamp: timestamp,
        })
      }

      const file = await this.fileHandle!.getFile()
      const timestamp = fileTimeToDatetime(file.lastModified)
      const override = this.timesStore.get(timesKey(this.descriptorPath))

      return ok({
        type: 'regular-file',
        linkCount: 1n,
        size: BigInt(file.size),
        dataAccessTimestamp: override?.atim ?? timestamp,
        dataModificationTimestamp: override?.mtim ?? timestamp,
        statusChangeTimestamp: override?.mtim ?? timestamp,
      })
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Set file times (limited support in OPFS)
   */
  setTimes(
    dataAccessTimestamp: NewTimestamp,
    dataModificationTimestamp: NewTimestamp
  ): FilesystemResult<void> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    // OPFS has no native set-times; record an in-memory override so stat()
    // reflects it for this session (instead of silently ignoring the call).
    this.timesStore.set(
      timesKey(this.descriptorPath),
      resolveNewTimestamp(dataAccessTimestamp),
      resolveNewTimestamp(dataModificationTimestamp)
    )
    return ok(undefined)
  }

  /**
   * Read bytes from file
   */
  async read(length: bigint, offset: bigint): Promise<FilesystemResult<[Uint8Array, boolean]>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.isDirectory) {
      return err(FilesystemErrorCode.IsDirectory)
    }

    if (!this.flags.read) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    try {
      const file = await this.fileHandle!.getFile()
      const start = Number(offset)
      const end = Math.min(start + Number(length), file.size)
      const slice = file.slice(start, end)
      const buffer = await slice.arrayBuffer()
      const data = new Uint8Array(buffer)
      const eof = end >= file.size

      return ok([data, eof])
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Write bytes to file
   */
  async write(buffer: Uint8Array, offset: bigint): Promise<FilesystemResult<bigint>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.isDirectory) {
      return err(FilesystemErrorCode.IsDirectory)
    }

    if (!this.flags.write) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    try {
      const writable = await this.fileHandle!.createWritable({ keepExistingData: true })
      await writable.seek(Number(offset))
      // Convert to ArrayBuffer to satisfy FileSystemWriteChunkType
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer
      await writable.write(arrayBuffer)
      await writable.close()

      return ok(BigInt(buffer.length))
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Truncate or extend the file to `size` bytes.
   *
   * Uses `FileSystemWritableFileStream.truncate`, which resizes in place
   * (zero-filling on growth) without reading the file — O(1) in the file size,
   * unlike the previous read-all-then-rewrite approach.
   */
  async setSize(size: bigint): Promise<FilesystemResult<void>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (this.isDirectory) return err(FilesystemErrorCode.IsDirectory)
    if (!this.flags.write) return err(FilesystemErrorCode.NotPermitted)

    try {
      const writable = await this.fileHandle!.createWritable({ keepExistingData: true })
      await writable.truncate(Number(size))
      await writable.close()
      return ok(undefined)
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Read directory entries
   */
  async readDirectory(): Promise<FilesystemResult<DirectoryEntry[]>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (!this.isDirectory) {
      return err(FilesystemErrorCode.NotDirectory)
    }

    try {
      const entries: DirectoryEntry[] = []

      for await (const [name, handle] of (this.dirHandle as any).entries()) {
        entries.push({
          type: handle.kind === 'file' ? 'regular-file' : 'directory',
          name,
        })
      }

      return ok(entries)
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Create directory at path relative to this descriptor
   */
  async createDirectoryAt(path: string): Promise<FilesystemResult<void>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (!this.isDirectory) {
      return err(FilesystemErrorCode.NotDirectory)
    }

    if (!this.flags.mutateDirectory) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    try {
      await this.getOrCreateDir(this.dirHandle!, path, true)
      return ok(undefined)
    } catch (e) {
      if ((e as Error).name === 'NotFoundError') {
        return err(FilesystemErrorCode.NoEntry)
      }
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Get stat at path relative to this descriptor
   */
  async statAt(_pathFlags: PathFlags, path: string): Promise<FilesystemResult<DescriptorStat>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (!this.isDirectory) {
      return err(FilesystemErrorCode.NotDirectory)
    }

    try {
      const handle = await this.resolveHandle(this.dirHandle!, path)
      const timestamp = now()

      if (handle.kind === 'directory') {
        return ok({
          type: 'directory',
          linkCount: 1n,
          size: 0n,
          dataAccessTimestamp: timestamp,
          dataModificationTimestamp: timestamp,
          statusChangeTimestamp: timestamp,
        })
      }

      const file = await (handle as FileSystemFileHandle).getFile()
      const fileTime = fileTimeToDatetime(file.lastModified)
      const override = this.timesStore.get(timesKey(this.descriptorPath, path))

      return ok({
        type: 'regular-file',
        linkCount: 1n,
        size: BigInt(file.size),
        dataAccessTimestamp: override?.atim ?? fileTime,
        dataModificationTimestamp: override?.mtim ?? fileTime,
        statusChangeTimestamp: override?.mtim ?? fileTime,
      })
    } catch (e) {
      if ((e as Error).name === 'NotFoundError') {
        return err(FilesystemErrorCode.NoEntry)
      }
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Open file at path relative to this descriptor
   */
  async openAt(
    _pathFlags: PathFlags,
    path: string,
    openFlags: OpenFlags,
    descriptorFlags: DescriptorFlags
  ): Promise<FilesystemResult<OpfsDescriptor>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (!this.isDirectory) {
      return err(FilesystemErrorCode.NotDirectory)
    }

    try {
      if (openFlags.directory) {
        const dirHandle = await this.getOrCreateDir(this.dirHandle!, path, !!openFlags.create)
        return ok(
          new OpfsDescriptor(
            this.rootHandle,
            dirHandle,
            timesKey(this.descriptorPath, path),
            descriptorFlags,
            this.pollableRegistry,
            true,
            this.timesStore
          )
        )
      }

      // Opening as file
      const { dir, name } = this.parsePath(path)
      const parentDir = dir ? await this.getOrCreateDir(this.dirHandle!, dir, false) : this.dirHandle!

      // O_CREAT|O_EXCL must fail if the file already exists. OPFS's
      // getFileHandle({create:true}) is get-or-create and would otherwise both
      // succeed and (having created the entry) defeat a later check — so probe
      // for prior existence first.
      if (openFlags.create && openFlags.exclusive) {
        let alreadyExists = true
        try {
          await parentDir.getFileHandle(name, { create: false })
        } catch (e) {
          if ((e as Error).name === 'NotFoundError') {
            alreadyExists = false
          } else if ((e as Error).name === 'TypeMismatchError') {
            return err(FilesystemErrorCode.IsDirectory)
          } else {
            throw e
          }
        }
        if (alreadyExists) {
          return err(FilesystemErrorCode.Exist)
        }
      }

      let fileHandle: FileSystemFileHandle
      try {
        fileHandle = await parentDir.getFileHandle(name, { create: !!openFlags.create })
      } catch (e) {
        if ((e as Error).name === 'NotFoundError') {
          return err(FilesystemErrorCode.NoEntry)
        }
        if ((e as Error).name === 'TypeMismatchError') {
          return err(FilesystemErrorCode.IsDirectory)
        }
        throw e
      }

      if (openFlags.truncate) {
        const writable = await fileHandle.createWritable()
        await writable.truncate(0)
        await writable.close()
      }

      return ok(
        new OpfsDescriptor(
          this.rootHandle,
          fileHandle,
          timesKey(this.descriptorPath, path),
          descriptorFlags,
          this.pollableRegistry,
          false,
          this.timesStore
        )
      )
    } catch (e) {
      if ((e as Error).name === 'NotFoundError') {
        return err(FilesystemErrorCode.NoEntry)
      }
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Remove directory at path
   */
  async removeDirectoryAt(path: string): Promise<FilesystemResult<void>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (!this.isDirectory) {
      return err(FilesystemErrorCode.NotDirectory)
    }

    if (!this.flags.mutateDirectory) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    try {
      const { dir, name } = this.parsePath(path)
      const parentDir = dir ? await this.getOrCreateDir(this.dirHandle!, dir, false) : this.dirHandle!

      // Check if it's actually a directory
      try {
        await parentDir.getDirectoryHandle(name)
      } catch {
        return err(FilesystemErrorCode.NotDirectory)
      }

      await parentDir.removeEntry(name)
      return ok(undefined)
    } catch (e) {
      if ((e as Error).name === 'NotFoundError') {
        return err(FilesystemErrorCode.NoEntry)
      }
      if ((e as Error).name === 'InvalidModificationError') {
        return err(FilesystemErrorCode.NotEmpty)
      }
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Unlink file at path
   */
  async unlinkFileAt(path: string): Promise<FilesystemResult<void>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (!this.isDirectory) {
      return err(FilesystemErrorCode.NotDirectory)
    }

    if (!this.flags.mutateDirectory) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    try {
      const { dir, name } = this.parsePath(path)
      const parentDir = dir ? await this.getOrCreateDir(this.dirHandle!, dir, false) : this.dirHandle!

      // Check if it's actually a file
      try {
        await parentDir.getFileHandle(name)
      } catch {
        return err(FilesystemErrorCode.IsDirectory)
      }

      await parentDir.removeEntry(name)
      return ok(undefined)
    } catch (e) {
      if ((e as Error).name === 'NotFoundError') {
        return err(FilesystemErrorCode.NoEntry)
      }
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Rename path relative to descriptors
   */
  async renameAt(
    oldPath: string,
    newDescriptor: OpfsDescriptor,
    newPath: string
  ): Promise<FilesystemResult<void>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (!this.isDirectory) {
      return err(FilesystemErrorCode.NotDirectory)
    }

    if (!this.flags.mutateDirectory) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    // OPFS doesn't have a native rename - we need to copy and delete
    try {
      const oldHandle = await this.resolveHandle(this.dirHandle!, oldPath)
      const { dir: newDir, name: newName } = this.parsePath(newPath)
      const newParent = newDir
        ? await this.getOrCreateDir(newDescriptor.dirHandle!, newDir, false)
        : newDescriptor.dirHandle!

      if (oldHandle.kind === 'file') {
        // OPFS has no atomic rename, so copy-then-delete. The source is kept
        // intact until the copy is fully written; if deleting the source then
        // fails, roll back the copy so we don't leave a duplicate.
        const oldFile = await (oldHandle as FileSystemFileHandle).getFile()
        const newFileHandle = await newParent.getFileHandle(newName, { create: true })
        const writable = await newFileHandle.createWritable()
        await writable.write(await oldFile.arrayBuffer())
        await writable.close()

        // Delete old file
        const { dir: oldDir, name: oldName } = this.parsePath(oldPath)
        const oldParent = oldDir
          ? await this.getOrCreateDir(this.dirHandle!, oldDir, false)
          : this.dirHandle!
        try {
          await oldParent.removeEntry(oldName)
        } catch (deleteErr) {
          // Roll back the copy so the rename is all-or-nothing.
          try {
            await newParent.removeEntry(newName)
          } catch {
            // best effort
          }
          throw deleteErr
        }
      } else {
        // For directories, we'd need to recursively copy - not fully implemented
        return err(FilesystemErrorCode.Unsupported)
      }

      return ok(undefined)
    } catch (e) {
      if ((e as Error).name === 'NotFoundError') {
        return err(FilesystemErrorCode.NoEntry)
      }
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Sync file data to storage
   */
  async sync(): Promise<FilesystemResult<void>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check
    // OPFS operations are already persisted when writables are closed
    return ok(undefined)
  }

  /**
   * Sync file data to storage
   */
  async syncData(): Promise<FilesystemResult<void>> {
    return this.sync()
  }

  /**
   * Get metadata hash
   */
  async metadataHash(): Promise<FilesystemResult<MetadataHashValue>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    try {
      if (this.isDirectory) {
        const timestamp = now()
        return ok({
          lower: timestamp.seconds,
          upper: 0n,
        })
      }

      const file = await this.fileHandle!.getFile()
      const modified = BigInt(file.lastModified)
      const size = BigInt(file.size)

      return ok({
        lower: modified ^ size,
        upper: modified,
      })
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Get metadata hash at path
   */
  async metadataHashAt(_pathFlags: PathFlags, path: string): Promise<FilesystemResult<MetadataHashValue>> {
    const check = this.checkClosed()
    if (check.tag === 'err') return check

    if (!this.isDirectory) {
      return err(FilesystemErrorCode.NotDirectory)
    }

    try {
      const handle = await this.resolveHandle(this.dirHandle!, path)

      if (handle.kind === 'directory') {
        const timestamp = now()
        return ok({
          lower: timestamp.seconds,
          upper: 0n,
        })
      }

      const file = await (handle as FileSystemFileHandle).getFile()
      const modified = BigInt(file.lastModified)
      const size = BigInt(file.size)

      return ok({
        lower: modified ^ size,
        upper: modified,
      })
    } catch (e) {
      if ((e as Error).name === 'NotFoundError') {
        return err(FilesystemErrorCode.NoEntry)
      }
      return err(FilesystemErrorCode.Io)
    }
  }

  /**
   * Subscribe for readiness
   */
  subscribe(): number {
    return createReadyPollable(this.pollableRegistry)
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

  /**
   * Get underlying handle kind
   */
  getIsDirectory(): boolean {
    return this.isDirectory
  }

  /**
   * Get directory handle (for internal use)
   */
  getDirectoryHandle(): FileSystemDirectoryHandle | null {
    return this.dirHandle
  }

  // Helper methods

  private parsePath(path: string): { dir: string; name: string } {
    const normalized = path.replace(/^\/+|\/+$/g, '')
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash === -1) {
      return { dir: '', name: normalized }
    }
    return {
      dir: normalized.substring(0, lastSlash),
      name: normalized.substring(lastSlash + 1),
    }
  }

  private async getOrCreateDir(
    base: FileSystemDirectoryHandle,
    path: string,
    create: boolean
  ): Promise<FileSystemDirectoryHandle> {
    const parts = path.split('/').filter(Boolean)
    let current = base

    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create })
    }

    return current
  }

  private async resolveHandle(
    base: FileSystemDirectoryHandle,
    path: string
  ): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
    const { dir, name } = this.parsePath(path)
    const parent = dir ? await this.getOrCreateDir(base, dir, false) : base

    // Try file first, then directory
    try {
      return await parent.getFileHandle(name)
    } catch {
      return await parent.getDirectoryHandle(name)
    }
  }
}

/**
 * Directory entry stream for OPFS iteration
 */
class OpfsDirectoryEntryStream {
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
 * OPFS directory entry stream registry
 */
class OpfsDirectoryEntryStreamRegistry extends HandleRegistry<OpfsDirectoryEntryStream> {
  override register(stream: OpfsDirectoryEntryStream): number {
    const handle = super.register(stream)
    stream.handle = handle
    return handle
  }
}

/**
 * OPFS Filesystem plugin instance
 */
class OpfsFilesystemInstance implements PluginInstance {
  private rootHandle: FileSystemDirectoryHandle | null = null
  // Per-instance descriptor handle space (isolated per polyfill via the
  // ResourceContext). Pollables stay on the global registry (handle-unique +
  // content-isolated, so a shared registry is cross-talk-free).
  private readonly descriptorRegistry = new OpfsDescriptorRegistry()
  private readonly directoryStreamRegistry = new OpfsDirectoryEntryStreamRegistry()
  private readonly pollableRegistry: PollableRegistry = globalPollableRegistry
  /** Session-scoped set-times overrides (OPFS has no native set-times). */
  private readonly timesStore = new OpfsTimesStore()
  private readonly rootDirName: string
  private initPromise: Promise<void> | null = null

  constructor(config: OpfsConfig = {}) {
    this.rootDirName = config.rootDirName ?? 'wasi-root'
  }

  private async ensureInitialized(): Promise<void> {
    if (this.rootHandle) return

    if (!this.initPromise) {
      this.initPromise = this.initialize()
    }
    await this.initPromise
  }

  private async initialize(): Promise<void> {
    if (!isOpfsAvailable()) {
      throw new Error('OPFS is not available in this environment')
    }

    const opfsRoot = await navigator.storage.getDirectory()
    this.rootHandle = await opfsRoot.getDirectoryHandle(this.rootDirName, { create: true })
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

  async destroy(): Promise<void> {
    await this.descriptorRegistry.clear()
  }

  /**
   * Create a descriptor for preopens
   */
  async createDescriptor(path: string, flags: DescriptorFlags): Promise<OpfsDescriptor> {
    await this.ensureInitialized()

    let handle: FileSystemDirectoryHandle
    if (path === '/' || path === '') {
      handle = this.rootHandle!
    } else {
      const parts = path.split('/').filter(Boolean)
      handle = this.rootHandle!
      for (const part of parts) {
        handle = await handle.getDirectoryHandle(part, { create: true })
      }
    }

    const descriptor = new OpfsDescriptor(
      this.rootHandle!,
      handle,
      timesKey(path),
      flags,
      this.pollableRegistry,
      true,
      this.timesStore
    )
    this.descriptorRegistry.register(descriptor)
    return descriptor
  }

  /**
   * Get root handle (for preopens)
   */
  async getRootHandle(): Promise<FileSystemDirectoryHandle> {
    await this.ensureInitialized()
    return this.rootHandle!
  }

  // Implementation methods

  private dropDescriptor(handle: number): void {
    // Async drop - fire and forget
    this.descriptorRegistry.drop(handle).catch(() => {})
  }

  private readViaStream(_handle: number, _offset: bigint): FilesystemResult<number> {
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
    return ok(undefined)
  }

  private async syncData(handle: number): Promise<FilesystemResult<void>> {
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

  private async setSize(handle: number, size: bigint): Promise<FilesystemResult<void>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.setSize(size)
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

  private async read(
    handle: number,
    length: bigint,
    offset: bigint
  ): Promise<FilesystemResult<[Uint8Array, boolean]>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.read(length, offset)
  }

  private async write(
    handle: number,
    buffer: Uint8Array,
    offset: bigint
  ): Promise<FilesystemResult<bigint>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.write(buffer, offset)
  }

  private async readDirectory(handle: number): Promise<FilesystemResult<number>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const entriesResult = await descriptor.readDirectory()
    if (entriesResult.tag === 'err') return entriesResult

    const stream = new OpfsDirectoryEntryStream(entriesResult.val)
    const streamHandle = this.directoryStreamRegistry.register(stream)

    return ok(streamHandle)
  }

  private async sync(handle: number): Promise<FilesystemResult<void>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.sync()
  }

  private async createDirectoryAt(handle: number, path: string): Promise<FilesystemResult<void>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.createDirectoryAt(path)
  }

  private async stat(handle: number): Promise<FilesystemResult<DescriptorStat>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.stat()
  }

  private async statAt(
    handle: number,
    pathFlags: PathFlags,
    path: string
  ): Promise<FilesystemResult<DescriptorStat>> {
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

    // OPFS has no native set-times; record a session override (stat-at reflects it).
    this.timesStore.set(
      timesKey(descriptor.descriptorPath, path),
      resolveNewTimestamp(dataAccessTimestamp),
      resolveNewTimestamp(dataModificationTimestamp)
    )
    return ok(undefined)
  }

  private linkAt(
    _handle: number,
    _oldPathFlags: PathFlags,
    _oldPath: string,
    _newDescriptor: number,
    _newPath: string
  ): FilesystemResult<void> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private async openAt(
    handle: number,
    pathFlags: PathFlags,
    path: string,
    openFlags: OpenFlags,
    descriptorFlags: DescriptorFlags
  ): Promise<FilesystemResult<number>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const result = await descriptor.openAt(pathFlags, path, openFlags, descriptorFlags)
    if (result.tag === 'err') return result

    const newHandle = this.descriptorRegistry.register(result.val)
    return ok(newHandle)
  }

  private readlinkAt(_handle: number, _path: string): FilesystemResult<string> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private async removeDirectoryAt(handle: number, path: string): Promise<FilesystemResult<void>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.removeDirectoryAt(path)
  }

  private async renameAt(
    handle: number,
    oldPath: string,
    newHandle: number,
    newPath: string
  ): Promise<FilesystemResult<void>> {
    const oldDescriptor = this.descriptorRegistry.get(handle)
    if (!oldDescriptor) return err(FilesystemErrorCode.BadDescriptor)

    const newDescriptor = this.descriptorRegistry.get(newHandle)
    if (!newDescriptor) return err(FilesystemErrorCode.BadDescriptor)

    return oldDescriptor.renameAt(oldPath, newDescriptor, newPath)
  }

  private symlinkAt(
    _handle: number,
    _oldPath: string,
    _newPath: string
  ): FilesystemResult<void> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private async unlinkFileAt(handle: number, path: string): Promise<FilesystemResult<void>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.unlinkFileAt(path)
  }

  private isSameObject(handle: number, otherHandle: number): boolean {
    const descriptor = this.descriptorRegistry.get(handle)
    const other = this.descriptorRegistry.get(otherHandle)
    if (!descriptor || !other) return false
    // For OPFS, we compare by path (simplified comparison)
    return descriptor === other
  }

  private async metadataHash(handle: number): Promise<FilesystemResult<MetadataHashValue>> {
    const descriptor = this.descriptorRegistry.get(handle)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.metadataHash()
  }

  private async metadataHashAt(
    handle: number,
    pathFlags: PathFlags,
    path: string
  ): Promise<FilesystemResult<MetadataHashValue>> {
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

/** ResourceContext key for the per-polyfill OPFS filesystem instance. */
const OPFS_INSTANCE_KEY = Symbol('wasi:filesystem/opfs-instance')

/**
 * OPFS filesystem implementation
 *
 * Provides persistent storage using the Origin Private File System API.
 * Data persists across browser sessions within the same origin.
 *
 * Configuration options:
 * - rootDirName: Root directory name within OPFS (default: 'wasi-root')
 */
export const opfsFilesystemImplementation: Implementation = {
  name: 'opfs',
  description: 'Origin Private File System (persistent browser storage)',
  create(config: PluginConfig): PluginInstance {
    const opfsConfig: OpfsConfig = {}

    const rootDirName = config.options?.['rootDirName'] as string | undefined
    if (rootDirName !== undefined) {
      opfsConfig.rootDirName = rootDirName
    }

    // Per-polyfill instance (descriptor handle space isolated via the context).
    // The underlying OPFS storage is the real browser disk and remains shared.
    return contextFromConfig(config).get(
      OPFS_INSTANCE_KEY,
      () => new OpfsFilesystemInstance(opfsConfig)
    )
  },
}

/**
 * Get the global OPFS filesystem instance (for preopens / external callers).
 */
export function getGlobalOpfsFilesystemInstance(): OpfsFilesystemInstance | null {
  if (!globalResourceContext.has(OPFS_INSTANCE_KEY)) {
    return null
  }
  return globalResourceContext.get(
    OPFS_INSTANCE_KEY,
    () => new OpfsFilesystemInstance()
  )
}
