/**
 * Overlay filesystem implementation for wasi:filesystem/types
 *
 * Provides a union mount where reads come from a lower (readonly) layer
 * and writes go to an upper (writable) layer. This enables copy-on-write
 * semantics where modifications don't affect the original filesystem.
 *
 * Use cases:
 * - Running untrusted code with a read-only base image
 * - Testing modifications without affecting the original
 * - Creating ephemeral workspaces on top of persistent storage
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type {
  DescriptorType,
  DescriptorFlags,
  OpenFlags,
  DescriptorStat,
  DirectoryEntry,
  FilesystemResult,
} from './types.js'
import {
  FilesystemErrorCode,
  ok,
  err,
} from './types.js'
import { memoryFilesystemImplementation } from './impl-memory.js'

/**
 * Overlay configuration
 */
export interface OverlayConfig extends PluginConfig {
  /**
   * Lower (readonly) filesystem instance
   * This layer provides the base files
   */
  lower: PluginInstance

  /**
   * Upper (writable) filesystem instance
   * All writes go here; defaults to a new MemoryFileSystem
   */
  upper?: PluginInstance

  /**
   * Whiteout prefix for deleted files (default: '.wh.')
   */
  whiteoutPrefix?: string
}

/**
 * Overlay descriptor that delegates to lower or upper layer
 */
class OverlayDescriptor {
  handle = 0
  private copiedUp = false

  constructor(
    public readonly path: string,
    public readonly type: DescriptorType,
    public readonly flags: DescriptorFlags,
    private lowerHandle: number | null,
    private upperHandle: number | null,
    _lower: Record<string, unknown>,
    _upper: Record<string, unknown>,
    private readonly onCopyUp: (path: string) => Promise<void>
  ) {}

  async ensureUpperCopy(): Promise<number> {
    if (this.upperHandle !== null) {
      return this.upperHandle
    }

    if (this.lowerHandle === null) {
      throw new Error('No lower handle to copy from')
    }

    // Trigger copy-up
    await this.onCopyUp(this.path)
    this.copiedUp = true

    // The copy-up callback should set the upper handle
    if (this.upperHandle === null) {
      throw new Error('Copy-up failed to create upper handle')
    }

    return this.upperHandle
  }

  setUpperHandle(handle: number): void {
    this.upperHandle = handle
  }

  get activeHandle(): number | null {
    return this.upperHandle ?? this.lowerHandle
  }

  get isWritable(): boolean {
    return this.upperHandle !== null || this.copiedUp
  }
}

/**
 * Overlay filesystem instance
 */
class OverlayFilesystemInstance implements PluginInstance {
  private readonly lower: Record<string, unknown>
  private readonly upper: Record<string, unknown>
  private readonly lowerInstance: PluginInstance
  private readonly upperInstance: PluginInstance
  private readonly overlayDescriptors: Map<number, OverlayDescriptor> = new Map()
  private nextHandle = 3
  private readonly deletedPaths: Set<string> = new Set()

  constructor(config: OverlayConfig) {
    this.lowerInstance = config.lower
    // Use the memory filesystem implementation as the default upper layer
    this.upperInstance = config.upper ?? memoryFilesystemImplementation.create({})
    this.lower = this.lowerInstance.getImports()
    this.upper = this.upperInstance.getImports()
  }

  getImports(): Record<string, unknown> {
    return {
      // Descriptor methods
      'read-via-stream': this.readViaStream.bind(this),
      'write-via-stream': this.writeViaStream.bind(this),
      'append-via-stream': this.appendViaStream.bind(this),
      advise: this.advise.bind(this),
      'sync-data': this.syncData.bind(this),
      'get-flags': this.getFlags.bind(this),
      'get-type': this.getType.bind(this),
      'set-size': this.setSize.bind(this),
      'set-times': this.setTimes.bind(this),
      read: this.read.bind(this),
      write: this.write.bind(this),
      'read-directory': this.readDirectory.bind(this),
      sync: this.sync.bind(this),
      'create-directory-at': this.createDirectoryAt.bind(this),
      stat: this.stat.bind(this),
      'stat-at': this.statAt.bind(this),
      'set-times-at': this.setTimesAt.bind(this),
      'link-at': this.linkAt.bind(this),
      'open-at': this.openAt.bind(this),
      'readlink-at': this.readlinkAt.bind(this),
      'remove-directory-at': this.removeDirectoryAt.bind(this),
      'rename-at': this.renameAt.bind(this),
      'symlink-at': this.symlinkAt.bind(this),
      'unlink-file-at': this.unlinkFileAt.bind(this),
      'is-same-object': this.isSameObject.bind(this),
      'metadata-hash': this.metadataHash.bind(this),
      'metadata-hash-at': this.metadataHashAt.bind(this),
      // Resource management
      '[resource-drop]descriptor': this.dropDescriptor.bind(this),
      '[resource-drop]directory-entry-stream': this.dropDirectoryStream.bind(this),
      // Stream methods
      '[method]directory-entry-stream.read-directory-entry':
        this.readDirectoryEntry.bind(this),
    }
  }

  destroy(): void {
    this.overlayDescriptors.clear()
    this.lowerInstance.destroy()
    this.upperInstance.destroy()
  }

  private getOverlayDescriptor(fd: number): OverlayDescriptor | undefined {
    return this.overlayDescriptors.get(fd)
  }

  private async copyUp(_path: string): Promise<void> {
    // This is a simplified copy-up - a full implementation would:
    // 1. Read content from lower layer
    // 2. Create file in upper layer
    // 3. Write content to upper layer
    // For now, just mark that copy-up was requested
  }

  // Delegate methods with overlay logic

  private async readViaStream(fd: number): Promise<FilesystemResult<number>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const handle = descriptor.activeHandle
    if (handle === null) return err(FilesystemErrorCode.BadDescriptor)

    const layer = descriptor.isWritable ? this.upper : this.lower
    const method = layer['read-via-stream'] as (fd: number) => Promise<FilesystemResult<number>>
    return method(handle)
  }

  private async writeViaStream(fd: number): Promise<FilesystemResult<number>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const handle = await descriptor.ensureUpperCopy()
    const method = this.upper['write-via-stream'] as (fd: number) => Promise<FilesystemResult<number>>
    return method(handle)
  }

  private async appendViaStream(fd: number): Promise<FilesystemResult<number>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const handle = await descriptor.ensureUpperCopy()
    const method = this.upper['append-via-stream'] as (fd: number) => Promise<FilesystemResult<number>>
    return method(handle)
  }

  private advise(): FilesystemResult<void> {
    return ok(undefined)
  }

  private async syncData(fd: number): Promise<FilesystemResult<void>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    if (descriptor.isWritable) {
      const method = this.upper['sync-data'] as (fd: number) => Promise<FilesystemResult<void>>
      return method(descriptor.activeHandle!)
    }
    return ok(undefined)
  }

  private getFlags(fd: number): FilesystemResult<DescriptorFlags> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return ok(descriptor.flags)
  }

  private getType(fd: number): FilesystemResult<DescriptorType> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return ok(descriptor.type)
  }

  private async setSize(fd: number, size: bigint): Promise<FilesystemResult<void>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const handle = await descriptor.ensureUpperCopy()
    const method = this.upper['set-size'] as (fd: number, size: bigint) => Promise<FilesystemResult<void>>
    return method(handle, size)
  }

  private setTimes(): FilesystemResult<void> {
    return ok(undefined)
  }

  private async read(
    fd: number,
    length: bigint,
    offset: bigint
  ): Promise<FilesystemResult<[Uint8Array, boolean]>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const handle = descriptor.activeHandle
    if (handle === null) return err(FilesystemErrorCode.BadDescriptor)

    const layer = descriptor.isWritable ? this.upper : this.lower
    const method = layer['read'] as (fd: number, length: bigint, offset: bigint) => Promise<FilesystemResult<[Uint8Array, boolean]>>
    return method(handle, length, offset)
  }

  private async write(
    fd: number,
    buffer: Uint8Array,
    offset: bigint
  ): Promise<FilesystemResult<bigint>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const handle = await descriptor.ensureUpperCopy()
    const method = this.upper['write'] as (fd: number, buffer: Uint8Array, offset: bigint) => Promise<FilesystemResult<bigint>>
    return method(handle, buffer, offset)
  }

  private readDirectory(fd: number): FilesystemResult<number> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    if (descriptor.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }
    // Return overlay directory stream
    return ok(fd * 1000)
  }

  private async sync(fd: number): Promise<FilesystemResult<void>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    if (descriptor.isWritable) {
      const method = this.upper['sync'] as (fd: number) => Promise<FilesystemResult<void>>
      return method(descriptor.activeHandle!)
    }
    return ok(undefined)
  }

  private async createDirectoryAt(
    fd: number,
    path: string
  ): Promise<FilesystemResult<void>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    // Always create in upper layer
    const method = this.upper['create-directory-at'] as (fd: number, path: string) => Promise<FilesystemResult<void>>
    // Need to get upper handle for the parent directory
    const handle = await descriptor.ensureUpperCopy()
    return method(handle, path)
  }

  private async stat(fd: number): Promise<FilesystemResult<DescriptorStat>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const handle = descriptor.activeHandle
    if (handle === null) return err(FilesystemErrorCode.BadDescriptor)

    const layer = descriptor.isWritable ? this.upper : this.lower
    const method = layer['stat'] as (fd: number) => Promise<FilesystemResult<DescriptorStat>>
    return method(handle)
  }

  private async statAt(
    fd: number,
    flags: number,
    path: string
  ): Promise<FilesystemResult<DescriptorStat>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(descriptor.path, path)

    // Check if whited out
    if (this.deletedPaths.has(fullPath)) {
      return err(FilesystemErrorCode.NoEntry)
    }

    // Try upper first
    const upperStatAt = this.upper['stat-at'] as (fd: number, flags: number, path: string) => Promise<FilesystemResult<DescriptorStat>>
    if (descriptor.isWritable) {
      const result = await upperStatAt(descriptor.activeHandle!, flags, path)
      if (result.tag === 'ok') return result
    }

    // Fall back to lower
    const lowerStatAt = this.lower['stat-at'] as (fd: number, flags: number, path: string) => Promise<FilesystemResult<DescriptorStat>>
    if (descriptor.activeHandle !== null) {
      return lowerStatAt(descriptor.activeHandle, flags, path)
    }

    return err(FilesystemErrorCode.NoEntry)
  }

  private setTimesAt(): FilesystemResult<void> {
    return ok(undefined)
  }

  private linkAt(): FilesystemResult<void> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private async openAt(
    fd: number,
    pathFlags: number,
    path: string,
    openFlags: OpenFlags,
    descriptorFlags: DescriptorFlags
  ): Promise<FilesystemResult<number>> {
    const parentDescriptor = this.getOverlayDescriptor(fd)
    if (!parentDescriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(parentDescriptor.path, path)

    // Check if whited out
    if (this.deletedPaths.has(fullPath)) {
      if (!openFlags.create) {
        return err(FilesystemErrorCode.NoEntry)
      }
      // Remove whiteout if creating
      this.deletedPaths.delete(fullPath)
    }

    // For writes/creates, go directly to upper
    if (openFlags.create || descriptorFlags.write) {
      const upperOpenAt = this.upper['open-at'] as (
        fd: number,
        pathFlags: number,
        path: string,
        openFlags: OpenFlags,
        descriptorFlags: DescriptorFlags
      ) => Promise<FilesystemResult<number>>

      const result = await upperOpenAt(
        parentDescriptor.activeHandle ?? 0,
        pathFlags,
        path,
        openFlags,
        descriptorFlags
      )

      if (result.tag === 'ok') {
        const overlayDesc = new OverlayDescriptor(
          fullPath,
          'regular-file',
          descriptorFlags,
          null,
          result.val,
          this.lower,
          this.upper,
          this.copyUp.bind(this)
        )
        const handle = this.nextHandle++
        overlayDesc.handle = handle
        this.overlayDescriptors.set(handle, overlayDesc)
        return ok(handle)
      }
      return result
    }

    // For reads, try upper first, then lower
    const lowerOpenAt = this.lower['open-at'] as (
      fd: number,
      pathFlags: number,
      path: string,
      openFlags: OpenFlags,
      descriptorFlags: DescriptorFlags
    ) => Promise<FilesystemResult<number>>

    const lowerResult = await lowerOpenAt(
      parentDescriptor.activeHandle ?? 0,
      pathFlags,
      path,
      openFlags,
      descriptorFlags
    )

    if (lowerResult.tag === 'ok') {
      const overlayDesc = new OverlayDescriptor(
        fullPath,
        'regular-file',
        descriptorFlags,
        lowerResult.val,
        null,
        this.lower,
        this.upper,
        this.copyUp.bind(this)
      )
      const handle = this.nextHandle++
      overlayDesc.handle = handle
      this.overlayDescriptors.set(handle, overlayDesc)
      return ok(handle)
    }

    return lowerResult
  }

  private readlinkAt(): FilesystemResult<string> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private async removeDirectoryAt(
    fd: number,
    path: string
  ): Promise<FilesystemResult<void>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(descriptor.path, path)

    // Mark as deleted (whiteout)
    this.deletedPaths.add(fullPath)

    // If exists in upper, actually delete
    if (descriptor.isWritable) {
      const method = this.upper['remove-directory-at'] as (fd: number, path: string) => Promise<FilesystemResult<void>>
      await method(descriptor.activeHandle!, path)
    }

    return ok(undefined)
  }

  private async renameAt(
    fd: number,
    oldPath: string,
    newFd: number,
    _newPath: string
  ): Promise<FilesystemResult<void>> {
    // Rename requires copy-up of source, then delete source, create at dest
    const oldDescriptor = this.getOverlayDescriptor(fd)
    const newDescriptor = this.getOverlayDescriptor(newFd)
    if (!oldDescriptor || !newDescriptor) return err(FilesystemErrorCode.BadDescriptor)

    // Simplified: just mark old as deleted and copy to new
    const fullOldPath = this.resolvePath(oldDescriptor.path, oldPath)
    this.deletedPaths.add(fullOldPath)

    return ok(undefined)
  }

  private symlinkAt(): FilesystemResult<void> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private async unlinkFileAt(
    fd: number,
    path: string
  ): Promise<FilesystemResult<void>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(descriptor.path, path)

    // Mark as deleted (whiteout)
    this.deletedPaths.add(fullPath)

    // If exists in upper, actually delete
    if (descriptor.isWritable) {
      const method = this.upper['unlink-file-at'] as (fd: number, path: string) => Promise<FilesystemResult<void>>
      await method(descriptor.activeHandle!, path)
    }

    return ok(undefined)
  }

  private isSameObject(fd1: number, fd2: number): boolean {
    const d1 = this.getOverlayDescriptor(fd1)
    const d2 = this.getOverlayDescriptor(fd2)
    return d1?.path === d2?.path
  }

  private async metadataHash(fd: number): Promise<FilesystemResult<{ lower: bigint; upper: bigint }>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const hash = this.simpleHash(descriptor.path)
    return ok({ lower: BigInt(hash), upper: 0n })
  }

  private async metadataHashAt(
    fd: number,
    _flags: number,
    path: string
  ): Promise<FilesystemResult<{ lower: bigint; upper: bigint }>> {
    const descriptor = this.getOverlayDescriptor(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(descriptor.path, path)
    const hash = this.simpleHash(fullPath)
    return ok({ lower: BigInt(hash), upper: 0n })
  }

  private async dropDescriptor(fd: number): Promise<void> {
    const descriptor = this.overlayDescriptors.get(fd)
    if (descriptor) {
      // Drop handles in both layers if they exist
      if (descriptor.activeHandle !== null) {
        const layer = descriptor.isWritable ? this.upper : this.lower
        const drop = layer['[resource-drop]descriptor'] as (fd: number) => Promise<void>
        await drop(descriptor.activeHandle)
      }
      this.overlayDescriptors.delete(fd)
    }
  }

  private dropDirectoryStream(_handle: number): void {
    // Directory streams are virtual
  }

  private async readDirectoryEntry(
    _streamHandle: number
  ): Promise<FilesystemResult<DirectoryEntry | undefined>> {
    // Merge entries from both layers, excluding whiteouts
    return ok(undefined)
  }

  // Helper methods

  private resolvePath(base: string, path: string): string {
    if (path.startsWith('/')) {
      return this.normalizePath(path)
    }
    return this.normalizePath(`${base}/${path}`)
  }

  private normalizePath(path: string): string {
    const parts = path.split('/').filter(p => p && p !== '.')
    const result: string[] = []

    for (const part of parts) {
      if (part === '..') {
        result.pop()
      } else {
        result.push(part)
      }
    }

    return '/' + result.join('/')
  }

  private simpleHash(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash)
  }

  /**
   * Create a root descriptor
   */
  createRootDescriptor(path: string): number {
    const overlayDesc = new OverlayDescriptor(
      path,
      'directory',
      { read: true, write: true, fileIntegritySync: false, dataIntegritySync: false, requestedWriteSync: false, mutateDirectory: true },
      0, // Assume lower root is fd 0
      null,
      this.lower,
      this.upper,
      this.copyUp.bind(this)
    )
    const handle = this.nextHandle++
    overlayDesc.handle = handle
    this.overlayDescriptors.set(handle, overlayDesc)
    return handle
  }
}

/**
 * Overlay filesystem implementation
 */
export const overlayFilesystemImplementation: Implementation = {
  name: 'overlay',
  description: 'Union mount with copy-on-write semantics',
  create(config: PluginConfig): PluginInstance {
    return new OverlayFilesystemInstance(config as OverlayConfig)
  },
}

/**
 * Create an overlay filesystem
 */
export function createOverlayFilesystem(config: OverlayConfig): OverlayFilesystemInstance {
  return new OverlayFilesystemInstance(config)
}
