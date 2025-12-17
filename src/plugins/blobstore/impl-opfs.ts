/**
 * OPFS (Origin Private File System) blobstore implementation
 *
 * Provides persistent blob storage using the Origin Private File System API.
 * This is the recommended persistent storage backend for browsers.
 *
 * Features:
 * - Persistent storage across page reloads
 * - Good performance for large blobs
 * - Works in Web Workers
 * - Browser-native API (no polyfills needed)
 *
 * Note: OPFS may not be available in all browsers or contexts.
 * Use isOpfsBlobstoreAvailable() to check availability.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  type ContainerName,
  type ObjectName,
  type Timestamp,
  type BlobstoreResult,
  type ContainerMetadata,
  type ObjectMetadata,
  type ObjectId,
  type BlobstoreConfig,
  DEFAULT_BLOBSTORE_CONFIG,
  blobOk,
  blobErr,
} from './types.js'

/**
 * Configuration for OPFS blobstore
 */
export interface OpfsBlobstoreConfig extends PluginConfig, BlobstoreConfig {
  /**
   * Root directory name in OPFS
   * @default 'wasi-blobstore'
   */
  rootDir?: string
}

/**
 * Check if OPFS is available
 */
export function isOpfsBlobstoreAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    'getDirectory' in navigator.storage
  )
}

/**
 * OPFS container implementation
 */
class OpfsContainer {
  readonly name: ContainerName
  readonly createdAt: Timestamp
  private dirHandle: FileSystemDirectoryHandle | null = null
  private readonly config: Required<BlobstoreConfig>
  private readonly rootHandle: FileSystemDirectoryHandle

  constructor(
    name: ContainerName,
    rootHandle: FileSystemDirectoryHandle,
    config: Required<BlobstoreConfig>
  ) {
    this.name = name
    this.createdAt = BigInt(Date.now())
    this.rootHandle = rootHandle
    this.config = config
  }

  async initialize(): Promise<void> {
    if (!this.dirHandle) {
      this.dirHandle = await this.rootHandle.getDirectoryHandle(this.name, { create: true })
    }
  }

  getInfo(): ContainerMetadata {
    return {
      name: this.name,
      createdAt: this.createdAt,
    }
  }

  async hasObject(name: ObjectName): Promise<boolean> {
    await this.initialize()
    try {
      await this.dirHandle!.getFileHandle(name)
      return true
    } catch {
      return false
    }
  }

  async getObjectInfo(name: ObjectName): Promise<BlobstoreResult<ObjectMetadata>> {
    await this.initialize()
    try {
      const fileHandle = await this.dirHandle!.getFileHandle(name)
      const file = await fileHandle.getFile()

      return blobOk({
        name,
        container: this.name,
        createdAt: BigInt(file.lastModified),
        size: BigInt(file.size),
      })
    } catch {
      return blobErr(`Object not found: ${name}`)
    }
  }

  async getData(name: ObjectName, start?: bigint, end?: bigint): Promise<BlobstoreResult<Uint8Array>> {
    await this.initialize()
    try {
      const fileHandle = await this.dirHandle!.getFileHandle(name)
      const file = await fileHandle.getFile()

      const startNum = start !== undefined ? Number(start) : 0
      const endNum = end !== undefined ? Number(end) : file.size

      if (startNum < 0 || endNum < 0 || startNum > file.size || endNum > file.size) {
        return blobErr(`Invalid byte range: ${startNum}-${endNum}`)
      }

      const slice = file.slice(startNum, endNum)
      const buffer = await slice.arrayBuffer()
      return blobOk(new Uint8Array(buffer))
    } catch {
      return blobErr(`Object not found: ${name}`)
    }
  }

  async writeData(name: ObjectName, data: Uint8Array): Promise<BlobstoreResult<void>> {
    await this.initialize()

    // Check size limit
    if (data.length > this.config.maxObjectSize) {
      return blobErr(
        `Object size ${data.length} exceeds maximum ${this.config.maxObjectSize}`
      )
    }

    try {
      // Check object count for new objects
      const exists = await this.hasObject(name)
      if (!exists) {
        const objects = await this.listObjects()
        if (objects.length >= this.config.maxObjectsPerContainer) {
          return blobErr(
            `Container would exceed maximum object count ${this.config.maxObjectsPerContainer}`
          )
        }
      }

      const fileHandle = await this.dirHandle!.getFileHandle(name, { create: true })

      // Use createWritable for sync access handle if available
      const writable = await fileHandle.createWritable()
      try {
        // Copy the data to ensure it's a plain ArrayBuffer-backed Uint8Array
        await writable.write(data.slice())
      } finally {
        await writable.close()
      }

      return blobOk(undefined)
    } catch (error) {
      return blobErr(`Failed to write object: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async deleteObject(name: ObjectName): Promise<BlobstoreResult<void>> {
    await this.initialize()
    try {
      await this.dirHandle!.removeEntry(name)
      return blobOk(undefined)
    } catch {
      // Ignore if not found
      return blobOk(undefined)
    }
  }

  async deleteObjects(names: ObjectName[]): Promise<BlobstoreResult<void>> {
    for (const name of names) {
      await this.deleteObject(name)
    }
    return blobOk(undefined)
  }

  async listObjects(): Promise<ObjectName[]> {
    await this.initialize()
    const objects: ObjectName[] = []

    // Use the async iterator protocol for directory entries
    const dirHandle = this.dirHandle as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>
    for await (const [name, handle] of dirHandle) {
      if (handle.kind === 'file') {
        objects.push(name)
      }
    }

    return objects.sort()
  }

  async clear(): Promise<void> {
    await this.initialize()
    const objects = await this.listObjects()
    for (const name of objects) {
      await this.deleteObject(name)
    }
  }
}

/**
 * OPFS blobstore instance
 */
class OpfsBlobstoreInstance implements PluginInstance {
  private rootHandle: FileSystemDirectoryHandle | null = null
  private readonly containers: Map<ContainerName, OpfsContainer> = new Map()
  private readonly containerHandles: Map<number, OpfsContainer> = new Map()
  private nextHandle = 1
  private readonly config: Required<BlobstoreConfig>
  private readonly rootDir: string
  private initPromise: Promise<void> | null = null

  constructor(config: OpfsBlobstoreConfig) {
    this.config = {
      maxObjectSize: config.maxObjectSize ?? DEFAULT_BLOBSTORE_CONFIG.maxObjectSize,
      maxObjectsPerContainer:
        config.maxObjectsPerContainer ?? DEFAULT_BLOBSTORE_CONFIG.maxObjectsPerContainer,
      maxContainers: config.maxContainers ?? DEFAULT_BLOBSTORE_CONFIG.maxContainers,
    }
    this.rootDir = config.rootDir ?? 'wasi-blobstore'
  }

  private async initialize(): Promise<void> {
    if (this.rootHandle) return
    if (this.initPromise) {
      await this.initPromise
      return
    }

    this.initPromise = (async () => {
      const opfsRoot = await navigator.storage.getDirectory()
      this.rootHandle = await opfsRoot.getDirectoryHandle(this.rootDir, { create: true })

      // Load existing containers using async iterator protocol
      const rootDir = this.rootHandle as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>
      for await (const [name, handle] of rootDir) {
        if (handle.kind === 'directory') {
          const container = new OpfsContainer(name, this.rootHandle, this.config)
          this.containers.set(name, container)
        }
      }
    })()

    await this.initPromise
  }

  getImports(): Record<string, unknown> {
    return {
      'create-container': this.createContainer.bind(this),
      'get-container': this.getContainer.bind(this),
      'delete-container': this.deleteContainer.bind(this),
      'container-exists': this.containerExists.bind(this),
      'copy-object': this.copyObject.bind(this),
      'move-object': this.moveObject.bind(this),
      '[method]container.name': this.containerName.bind(this),
      '[method]container.info': this.containerInfo.bind(this),
      '[method]container.has-object': this.containerHasObject.bind(this),
      '[method]container.object-info': this.containerObjectInfo.bind(this),
      '[method]container.get-data': this.containerGetData.bind(this),
      '[method]container.write-data': this.containerWriteData.bind(this),
      '[method]container.delete-object': this.containerDeleteObject.bind(this),
      '[method]container.delete-objects': this.containerDeleteObjects.bind(this),
      '[method]container.list-objects': this.containerListObjects.bind(this),
      '[method]container.clear': this.containerClear.bind(this),
      '[resource-drop]container': this.dropContainer.bind(this),
    }
  }

  destroy(): void {
    this.containers.clear()
    this.containerHandles.clear()
    this.rootHandle = null
  }

  private async createContainer(name: ContainerName): Promise<BlobstoreResult<number>> {
    await this.initialize()

    if (this.containers.has(name)) {
      return blobErr(`Container already exists: ${name}`)
    }

    if (this.containers.size >= this.config.maxContainers) {
      return blobErr(`Maximum container count ${this.config.maxContainers} exceeded`)
    }

    const container = new OpfsContainer(name, this.rootHandle!, this.config)
    await container.initialize()
    this.containers.set(name, container)

    const handle = this.nextHandle++
    this.containerHandles.set(handle, container)
    return blobOk(handle)
  }

  private async getContainer(name: ContainerName): Promise<BlobstoreResult<number>> {
    await this.initialize()

    const container = this.containers.get(name)
    if (!container) {
      return blobErr(`Container not found: ${name}`)
    }

    const handle = this.nextHandle++
    this.containerHandles.set(handle, container)
    return blobOk(handle)
  }

  private async deleteContainer(name: ContainerName): Promise<BlobstoreResult<void>> {
    await this.initialize()

    if (!this.containers.has(name)) {
      return blobErr(`Container not found: ${name}`)
    }

    try {
      await this.rootHandle!.removeEntry(name, { recursive: true })
      this.containers.delete(name)
      return blobOk(undefined)
    } catch (error) {
      return blobErr(`Failed to delete container: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async containerExists(name: ContainerName): Promise<BlobstoreResult<boolean>> {
    await this.initialize()
    return blobOk(this.containers.has(name))
  }

  private async copyObject(src: ObjectId, dest: ObjectId): Promise<BlobstoreResult<void>> {
    await this.initialize()

    const srcContainer = this.containers.get(src.container)
    if (!srcContainer) {
      return blobErr(`Source container not found: ${src.container}`)
    }

    const destContainer = this.containers.get(dest.container)
    if (!destContainer) {
      return blobErr(`Destination container not found: ${dest.container}`)
    }

    const dataResult = await srcContainer.getData(src.object)
    if (dataResult.tag === 'err') {
      return dataResult
    }

    return destContainer.writeData(dest.object, dataResult.val)
  }

  private async moveObject(src: ObjectId, dest: ObjectId): Promise<BlobstoreResult<void>> {
    const copyResult = await this.copyObject(src, dest)
    if (copyResult.tag === 'err') {
      return copyResult
    }

    const srcContainer = this.containers.get(src.container)!
    return srcContainer.deleteObject(src.object)
  }

  private getContainerByHandle(handle: number): OpfsContainer | undefined {
    return this.containerHandles.get(handle)
  }

  private containerName(handle: number): BlobstoreResult<ContainerName> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return blobOk(container.name)
  }

  private containerInfo(handle: number): BlobstoreResult<ContainerMetadata> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return blobOk(container.getInfo())
  }

  private async containerHasObject(handle: number, name: ObjectName): Promise<BlobstoreResult<boolean>> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return blobOk(await container.hasObject(name))
  }

  private async containerObjectInfo(handle: number, name: ObjectName): Promise<BlobstoreResult<ObjectMetadata>> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.getObjectInfo(name)
  }

  private async containerGetData(
    handle: number,
    name: ObjectName,
    start?: bigint,
    end?: bigint
  ): Promise<BlobstoreResult<Uint8Array>> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.getData(name, start, end)
  }

  private async containerWriteData(
    handle: number,
    name: ObjectName,
    data: Uint8Array
  ): Promise<BlobstoreResult<void>> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.writeData(name, data)
  }

  private async containerDeleteObject(handle: number, name: ObjectName): Promise<BlobstoreResult<void>> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.deleteObject(name)
  }

  private async containerDeleteObjects(handle: number, names: ObjectName[]): Promise<BlobstoreResult<void>> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.deleteObjects(names)
  }

  private async containerListObjects(handle: number): Promise<BlobstoreResult<ObjectName[]>> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return blobOk(await container.listObjects())
  }

  private async containerClear(handle: number): Promise<BlobstoreResult<void>> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    await container.clear()
    return blobOk(undefined)
  }

  private dropContainer(handle: number): void {
    this.containerHandles.delete(handle)
  }
}

/**
 * OPFS blobstore implementation
 *
 * Provides persistent blob storage using the Origin Private File System.
 * Suitable for browser environments needing persistent large blob storage.
 */
export const opfsBlobstoreImplementation: Implementation = {
  name: 'opfs',
  description: 'Origin Private File System blobstore (persistent)',
  create(config: PluginConfig): PluginInstance {
    return new OpfsBlobstoreInstance(config as OpfsBlobstoreConfig)
  },
}

/**
 * Create an OPFS blobstore for direct use
 */
export function createOpfsBlobstore(config?: OpfsBlobstoreConfig): OpfsBlobstoreInstance {
  return new OpfsBlobstoreInstance(config ?? {})
}
