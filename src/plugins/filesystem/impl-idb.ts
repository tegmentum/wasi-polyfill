/**
 * IndexedDB filesystem implementation for wasi:filesystem/types
 *
 * Provides persistent filesystem storage in browsers using IndexedDB.
 * This is a fallback for environments where OPFS is not available.
 *
 * Note: IndexedDB is available in most browsers but has different
 * performance characteristics than OPFS.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { PollableRegistry } from '../io/pollable.js'
import type {
  DescriptorType,
  DescriptorFlags,
  OpenFlags,
  DescriptorStat,
  DirectoryEntry,
  Datetime,
} from './types.js'
import {
  FilesystemErrorCode,
  ok,
  err,
} from './types.js'
import type { FilesystemResult } from './types.js'

/**
 * IDB configuration
 */
export interface IdbConfig extends PluginConfig {
  /**
   * Database name (default: 'wasi-filesystem')
   */
  dbName?: string

  /**
   * Object store name (default: 'files')
   */
  storeName?: string

  /**
   * Database version (default: 1)
   */
  dbVersion?: number
}

/**
 * File entry stored in IndexedDB
 */
interface IdbFileEntry {
  path: string
  type: 'file' | 'directory'
  data?: Uint8Array
  size: number
  created: number
  modified: number
  accessed: number
}

/**
 * Check if IndexedDB is available
 */
export function isIdbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * IDB descriptor handle
 */
export class IdbDescriptor {
  handle = 0
  private position = 0n

  constructor(
    private readonly db: IDBDatabase,
    private readonly storeName: string,
    public readonly path: string,
    public readonly type: DescriptorType,
    public readonly flags: DescriptorFlags
  ) {}

  async readAt(length: bigint, offset: bigint): Promise<FilesystemResult<[Uint8Array, boolean]>> {
    if (this.type !== 'regular-file') {
      return err(FilesystemErrorCode.InvalidSeek)
    }

    try {
      const entry = await this.getEntry()
      if (!entry || entry.type !== 'file') {
        return err(FilesystemErrorCode.NoEntry)
      }

      const data = entry.data ?? new Uint8Array(0)
      const start = Number(offset)
      const end = Math.min(start + Number(length), data.length)
      const chunk = data.slice(start, end)
      const eof = end >= data.length

      return ok([chunk, eof])
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  async read(length: bigint): Promise<FilesystemResult<[Uint8Array, boolean]>> {
    const result = await this.readAt(length, this.position)
    if (result.tag === 'ok') {
      this.position += BigInt(result.val[0].length)
    }
    return result
  }

  async writeAt(buffer: Uint8Array, offset: bigint): Promise<FilesystemResult<bigint>> {
    if (this.type !== 'regular-file') {
      return err(FilesystemErrorCode.InvalidSeek)
    }

    if (!this.flags.write) {
      return err(FilesystemErrorCode.NotPermitted)
    }

    try {
      const entry = await this.getEntry()
      if (!entry) {
        return err(FilesystemErrorCode.NoEntry)
      }

      const existingData = entry.data ?? new Uint8Array(0)
      const start = Number(offset)
      const newSize = Math.max(existingData.length, start + buffer.length)
      const newData = new Uint8Array(newSize)

      // Copy existing data
      newData.set(existingData)
      // Write new data at offset
      newData.set(buffer, start)

      entry.data = newData
      entry.size = newData.length
      entry.modified = Date.now()

      await this.putEntry(entry)

      return ok(BigInt(buffer.length))
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  async write(buffer: Uint8Array): Promise<FilesystemResult<bigint>> {
    const result = await this.writeAt(buffer, this.position)
    if (result.tag === 'ok') {
      this.position += result.val
    }
    return result
  }

  async seek(offset: bigint, from: 'start' | 'current' | 'end'): Promise<FilesystemResult<bigint>> {
    if (this.type !== 'regular-file') {
      return err(FilesystemErrorCode.InvalidSeek)
    }

    try {
      const entry = await this.getEntry()
      const size = BigInt(entry?.size ?? 0)

      let newPosition: bigint
      switch (from) {
        case 'start':
          newPosition = offset
          break
        case 'current':
          newPosition = this.position + offset
          break
        case 'end':
          newPosition = size + offset
          break
      }

      if (newPosition < 0n) {
        return err(FilesystemErrorCode.InvalidSeek)
      }

      this.position = newPosition
      return ok(this.position)
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  async stat(): Promise<FilesystemResult<DescriptorStat>> {
    try {
      const entry = await this.getEntry()
      if (!entry) {
        return err(FilesystemErrorCode.NoEntry)
      }

      return ok({
        type: entry.type === 'file' ? 'regular-file' : 'directory',
        linkCount: 1n,
        size: BigInt(entry.size),
        dataAccessTimestamp: this.msToDatetime(entry.accessed),
        dataModificationTimestamp: this.msToDatetime(entry.modified),
        statusChangeTimestamp: this.msToDatetime(entry.modified),
      })
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  async setSize(size: bigint): Promise<FilesystemResult<void>> {
    if (this.type !== 'regular-file') {
      return err(FilesystemErrorCode.InvalidSeek)
    }

    try {
      const entry = await this.getEntry()
      if (!entry) {
        return err(FilesystemErrorCode.NoEntry)
      }

      const newSize = Number(size)
      const existingData = entry.data ?? new Uint8Array(0)
      const newData = new Uint8Array(newSize)

      // Copy existing data up to new size
      newData.set(existingData.slice(0, Math.min(existingData.length, newSize)))

      entry.data = newData
      entry.size = newSize
      entry.modified = Date.now()

      await this.putEntry(entry)

      return ok(undefined)
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  async sync(): Promise<FilesystemResult<void>> {
    // IndexedDB transactions auto-commit, so sync is a no-op
    return ok(undefined)
  }

  async close(): Promise<void> {
    // Nothing to clean up for IDB
  }

  private getEntry(): Promise<IdbFileEntry | undefined> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.get(this.path)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  private putEntry(entry: IdbFileEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.put(entry)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private msToDatetime(ms: number): Datetime {
    const seconds = BigInt(Math.floor(ms / 1000))
    const nanoseconds = (ms % 1000) * 1_000_000
    return { seconds, nanoseconds }
  }
}

/**
 * IDB descriptor registry
 */
class IdbDescriptorRegistry {
  private nextHandle = 3
  private readonly descriptors: Map<number, IdbDescriptor> = new Map()

  register(descriptor: IdbDescriptor): number {
    const handle = this.nextHandle++
    descriptor.handle = handle
    this.descriptors.set(handle, descriptor)
    return handle
  }

  get(handle: number): IdbDescriptor | undefined {
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
 * IDB filesystem instance
 */
class IdbFilesystemInstance implements PluginInstance {
  private db: IDBDatabase | null = null
  private readonly registry = new IdbDescriptorRegistry()
  private readonly dbName: string
  private readonly storeName: string
  private readonly dbVersion: number
  private initPromise: Promise<void> | null = null

  constructor(config: IdbConfig) {
    this.dbName = config.dbName ?? 'wasi-filesystem'
    this.storeName = config.storeName ?? 'files'
    this.dbVersion = config.dbVersion ?? 1
  }

  private async init(): Promise<void> {
    if (this.db) return
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'path' })
        }
      }
    })

    return this.initPromise
  }

  getImports(): Record<string, unknown> {
    return {
      // Descriptor methods
      'read-via-stream': this.readViaStream.bind(this),
      'write-via-stream': this.writeViaStream.bind(this),
      'append-via-stream': this.appendViaStream.bind(this),
      'advise': this.advise.bind(this),
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
    this.registry.clear()
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  // Implementation methods...

  private async readViaStream(fd: number): Promise<FilesystemResult<number>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    // Return a pollable for the stream
    const pollableRegistry = new PollableRegistry()
    return ok(pollableRegistry.create(Promise.resolve()))
  }

  private async writeViaStream(fd: number): Promise<FilesystemResult<number>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    const pollableRegistry = new PollableRegistry()
    return ok(pollableRegistry.create(Promise.resolve()))
  }

  private async appendViaStream(fd: number): Promise<FilesystemResult<number>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    const pollableRegistry = new PollableRegistry()
    return ok(pollableRegistry.create(Promise.resolve()))
  }

  private advise(): FilesystemResult<void> {
    return ok(undefined)
  }

  private async syncData(fd: number): Promise<FilesystemResult<void>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.sync()
  }

  private getFlags(fd: number): FilesystemResult<DescriptorFlags> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return ok(descriptor.flags)
  }

  private getType(fd: number): FilesystemResult<DescriptorType> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return ok(descriptor.type)
  }

  private async setSize(fd: number, size: bigint): Promise<FilesystemResult<void>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.setSize(size)
  }

  private setTimes(): FilesystemResult<void> {
    return ok(undefined)
  }

  private async read(
    fd: number,
    length: bigint,
    offset: bigint
  ): Promise<FilesystemResult<[Uint8Array, boolean]>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.readAt(length, offset)
  }

  private async write(
    fd: number,
    buffer: Uint8Array,
    offset: bigint
  ): Promise<FilesystemResult<bigint>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.writeAt(buffer, offset)
  }

  private readDirectory(fd: number): FilesystemResult<number> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    if (descriptor.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }
    // Return a directory stream handle
    return ok(fd * 1000) // Simple handle scheme
  }

  private async sync(fd: number): Promise<FilesystemResult<void>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.sync()
  }

  private async createDirectoryAt(
    fd: number,
    path: string
  ): Promise<FilesystemResult<void>> {
    await this.init()
    if (!this.db) return err(FilesystemErrorCode.Io)

    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(descriptor.path, path)

    const entry: IdbFileEntry = {
      path: fullPath,
      type: 'directory',
      size: 0,
      created: Date.now(),
      modified: Date.now(),
      accessed: Date.now(),
    }

    try {
      await this.putEntry(entry)
      return ok(undefined)
    } catch {
      return err(FilesystemErrorCode.Io)
    }
  }

  private async stat(fd: number): Promise<FilesystemResult<DescriptorStat>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)
    return descriptor.stat()
  }

  private async statAt(
    fd: number,
    _flags: number,
    path: string
  ): Promise<FilesystemResult<DescriptorStat>> {
    await this.init()
    if (!this.db) return err(FilesystemErrorCode.Io)

    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(descriptor.path, path)
    const entry = await this.getEntry(fullPath)

    if (!entry) {
      return err(FilesystemErrorCode.NoEntry)
    }

    return ok({
      type: entry.type === 'file' ? 'regular-file' : 'directory',
      linkCount: 1n,
      size: BigInt(entry.size),
      dataAccessTimestamp: this.msToDatetime(entry.accessed),
      dataModificationTimestamp: this.msToDatetime(entry.modified),
      statusChangeTimestamp: this.msToDatetime(entry.modified),
    })
  }

  private setTimesAt(): FilesystemResult<void> {
    return ok(undefined)
  }

  private linkAt(): FilesystemResult<void> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private async openAt(
    fd: number,
    _pathFlags: number,
    path: string,
    openFlags: OpenFlags,
    descriptorFlags: DescriptorFlags
  ): Promise<FilesystemResult<number>> {
    await this.init()
    if (!this.db) return err(FilesystemErrorCode.Io)

    const parentDescriptor = this.registry.get(fd)
    if (!parentDescriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(parentDescriptor.path, path)
    let entry = await this.getEntry(fullPath)

    // Handle create flag
    if (!entry && openFlags.create) {
      const now = Date.now()
      const newEntry: IdbFileEntry = {
        path: fullPath,
        type: openFlags.directory ? 'directory' : 'file',
        size: 0,
        created: now,
        modified: now,
        accessed: now,
      }
      if (!openFlags.directory) {
        newEntry.data = new Uint8Array(0)
      }
      entry = newEntry
      await this.putEntry(entry)
    }

    if (!entry) {
      return err(FilesystemErrorCode.NoEntry)
    }

    // Handle exclusive flag
    if (openFlags.exclusive && entry) {
      return err(FilesystemErrorCode.Exist)
    }

    // Handle truncate flag
    if (openFlags.truncate && entry.type === 'file') {
      entry.data = new Uint8Array(0)
      entry.size = 0
      entry.modified = Date.now()
      await this.putEntry(entry)
    }

    const type: DescriptorType = entry.type === 'file' ? 'regular-file' : 'directory'
    const descriptor = new IdbDescriptor(this.db, this.storeName, fullPath, type, descriptorFlags)
    const handle = this.registry.register(descriptor)

    return ok(handle)
  }

  private readlinkAt(): FilesystemResult<string> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private async removeDirectoryAt(
    fd: number,
    path: string
  ): Promise<FilesystemResult<void>> {
    await this.init()
    if (!this.db) return err(FilesystemErrorCode.Io)

    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(descriptor.path, path)
    const entry = await this.getEntry(fullPath)

    if (!entry) {
      return err(FilesystemErrorCode.NoEntry)
    }

    if (entry.type !== 'directory') {
      return err(FilesystemErrorCode.NotDirectory)
    }

    // Check if directory is empty
    const children = await this.listDirectory(fullPath)
    if (children.length > 0) {
      return err(FilesystemErrorCode.NotEmpty)
    }

    await this.deleteEntry(fullPath)
    return ok(undefined)
  }

  private async renameAt(
    fd: number,
    oldPath: string,
    newFd: number,
    newPath: string
  ): Promise<FilesystemResult<void>> {
    await this.init()
    if (!this.db) return err(FilesystemErrorCode.Io)

    const oldDescriptor = this.registry.get(fd)
    const newDescriptor = this.registry.get(newFd)
    if (!oldDescriptor || !newDescriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullOldPath = this.resolvePath(oldDescriptor.path, oldPath)
    const fullNewPath = this.resolvePath(newDescriptor.path, newPath)

    const entry = await this.getEntry(fullOldPath)
    if (!entry) {
      return err(FilesystemErrorCode.NoEntry)
    }

    entry.path = fullNewPath
    entry.modified = Date.now()

    await this.putEntry(entry)
    await this.deleteEntry(fullOldPath)

    return ok(undefined)
  }

  private symlinkAt(): FilesystemResult<void> {
    return err(FilesystemErrorCode.Unsupported)
  }

  private async unlinkFileAt(
    fd: number,
    path: string
  ): Promise<FilesystemResult<void>> {
    await this.init()
    if (!this.db) return err(FilesystemErrorCode.Io)

    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(descriptor.path, path)
    const entry = await this.getEntry(fullPath)

    if (!entry) {
      return err(FilesystemErrorCode.NoEntry)
    }

    if (entry.type !== 'file') {
      return err(FilesystemErrorCode.IsDirectory)
    }

    await this.deleteEntry(fullPath)
    return ok(undefined)
  }

  private isSameObject(fd1: number, fd2: number): boolean {
    const d1 = this.registry.get(fd1)
    const d2 = this.registry.get(fd2)
    return d1?.path === d2?.path
  }

  private async metadataHash(fd: number): Promise<FilesystemResult<{ lower: bigint; upper: bigint }>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    // Simple hash based on path and modification time
    const hash = this.simpleHash(descriptor.path)
    return ok({ lower: BigInt(hash), upper: 0n })
  }

  private async metadataHashAt(
    fd: number,
    _flags: number,
    path: string
  ): Promise<FilesystemResult<{ lower: bigint; upper: bigint }>> {
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    const fullPath = this.resolvePath(descriptor.path, path)
    const hash = this.simpleHash(fullPath)
    return ok({ lower: BigInt(hash), upper: 0n })
  }

  private async dropDescriptor(fd: number): Promise<void> {
    await this.registry.drop(fd)
  }

  private dropDirectoryStream(_handle: number): void {
    // Directory streams are virtual in this implementation
  }

  private async readDirectoryEntry(
    streamHandle: number
  ): Promise<FilesystemResult<DirectoryEntry | undefined>> {
    // Extract fd from stream handle
    const fd = Math.floor(streamHandle / 1000)
    const descriptor = this.registry.get(fd)
    if (!descriptor) return err(FilesystemErrorCode.BadDescriptor)

    await this.init()
    if (!this.db) return err(FilesystemErrorCode.Io)

    // This is a simplified implementation - a real one would track position
    const children = await this.listDirectory(descriptor.path)
    const entry = children[0]
    if (!entry) {
      return ok(undefined)
    }

    return ok({
      type: entry.type === 'file' ? 'regular-file' : 'directory',
      name: entry.path.split('/').pop() ?? '',
    })
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

  private getEntry(path: string): Promise<IdbFileEntry | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve(undefined)
        return
      }
      const transaction = this.db.transaction(this.storeName, 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.get(path)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  private putEntry(entry: IdbFileEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }
      const transaction = this.db.transaction(this.storeName, 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.put(entry)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private deleteEntry(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }
      const transaction = this.db.transaction(this.storeName, 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.delete(path)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private listDirectory(dirPath: string): Promise<IdbFileEntry[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve([])
        return
      }
      const transaction = this.db.transaction(this.storeName, 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.getAll()

      request.onsuccess = () => {
        const entries = (request.result as IdbFileEntry[]).filter(e => {
          const parent = e.path.substring(0, e.path.lastIndexOf('/')) || '/'
          return parent === dirPath
        })
        resolve(entries)
      }
      request.onerror = () => reject(request.error)
    })
  }

  private msToDatetime(ms: number): Datetime {
    const seconds = BigInt(Math.floor(ms / 1000))
    const nanoseconds = (ms % 1000) * 1_000_000
    return { seconds, nanoseconds }
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
   * Create a root descriptor for preopens
   */
  async createRootDescriptor(path: string): Promise<number> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    // Ensure root directory exists
    const entry = await this.getEntry(path)
    if (!entry) {
      await this.putEntry({
        path,
        type: 'directory',
        size: 0,
        created: Date.now(),
        modified: Date.now(),
        accessed: Date.now(),
      })
    }

    const descriptor = new IdbDescriptor(
      this.db,
      this.storeName,
      path,
      'directory',
      { read: true, write: true, fileIntegritySync: false, dataIntegritySync: false, requestedWriteSync: false, mutateDirectory: true }
    )

    return this.registry.register(descriptor)
  }
}

/**
 * IndexedDB filesystem implementation
 */
export const idbFilesystemImplementation: Implementation = {
  name: 'idb',
  description: 'IndexedDB-based persistent filesystem',
  create(config: PluginConfig): PluginInstance {
    return new IdbFilesystemInstance(config as IdbConfig)
  },
}

/**
 * Create an IDB filesystem and return the instance
 */
export function createIdbFilesystem(config?: IdbConfig): IdbFilesystemInstance {
  return new IdbFilesystemInstance(config ?? {})
}
