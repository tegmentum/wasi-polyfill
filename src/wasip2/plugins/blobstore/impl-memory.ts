/**
 * In-memory blobstore implementation
 *
 * Provides a simple in-memory blob storage for testing
 * and non-persistent use cases.
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
 * Configuration for in-memory blobstore
 */
export interface MemoryBlobstoreConfig extends PluginConfig, BlobstoreConfig {
  /**
   * Initial data to populate containers with
   * Map of container name -> object name -> data
   */
  initialData?: Map<ContainerName, Map<ObjectName, Uint8Array>>
}

/**
 * Stored object with metadata
 */
interface StoredObject {
  data: Uint8Array
  createdAt: Timestamp
}

/**
 * In-memory container implementation
 */
class MemoryContainer {
  readonly name: ContainerName
  readonly createdAt: Timestamp
  private objects: Map<ObjectName, StoredObject> = new Map()
  private readonly config: Required<BlobstoreConfig>

  constructor(name: ContainerName, config: Required<BlobstoreConfig>) {
    this.name = name
    this.createdAt = BigInt(Date.now())
    this.config = config
  }

  getInfo(): ContainerMetadata {
    return {
      name: this.name,
      createdAt: this.createdAt,
    }
  }

  hasObject(name: ObjectName): boolean {
    return this.objects.has(name)
  }

  getObjectInfo(name: ObjectName): BlobstoreResult<ObjectMetadata> {
    const obj = this.objects.get(name)
    if (!obj) {
      return blobErr(`Object not found: ${name}`)
    }

    return blobOk({
      name,
      container: this.name,
      createdAt: obj.createdAt,
      size: BigInt(obj.data.length),
    })
  }

  getData(name: ObjectName, start?: bigint, end?: bigint): BlobstoreResult<Uint8Array> {
    const obj = this.objects.get(name)
    if (!obj) {
      return blobErr(`Object not found: ${name}`)
    }

    const startNum = start !== undefined ? Number(start) : 0
    const endNum = end !== undefined ? Number(end) : obj.data.length

    if (startNum < 0 || endNum < 0 || startNum > obj.data.length || endNum > obj.data.length) {
      return blobErr(`Invalid byte range: ${startNum}-${endNum}`)
    }

    // Return a copy of the slice
    return blobOk(obj.data.slice(startNum, endNum))
  }

  writeData(name: ObjectName, data: Uint8Array): BlobstoreResult<void> {
    // Check size limit
    if (data.length > this.config.maxObjectSize) {
      return blobErr(
        `Object size ${data.length} exceeds maximum ${this.config.maxObjectSize}`
      )
    }

    // Check object count for new objects
    if (!this.objects.has(name) && this.objects.size >= this.config.maxObjectsPerContainer) {
      return blobErr(
        `Container would exceed maximum object count ${this.config.maxObjectsPerContainer}`
      )
    }

    // Store a copy of the data
    this.objects.set(name, {
      data: new Uint8Array(data),
      createdAt: BigInt(Date.now()),
    })

    return blobOk(undefined)
  }

  deleteObject(name: ObjectName): BlobstoreResult<void> {
    this.objects.delete(name)
    return blobOk(undefined)
  }

  deleteObjects(names: ObjectName[]): BlobstoreResult<void> {
    for (const name of names) {
      this.objects.delete(name)
    }
    return blobOk(undefined)
  }

  listObjects(): ObjectName[] {
    return Array.from(this.objects.keys()).sort()
  }

  clear(): void {
    this.objects.clear()
  }

  get objectCount(): number {
    return this.objects.size
  }

  /**
   * Populate from initial data
   */
  populate(data: Map<ObjectName, Uint8Array>): void {
    for (const [name, bytes] of data) {
      this.objects.set(name, {
        data: new Uint8Array(bytes),
        createdAt: this.createdAt,
      })
    }
  }
}

/**
 * In-memory blobstore instance
 */
class MemoryBlobstoreInstance implements PluginInstance {
  private readonly containers: Map<ContainerName, MemoryContainer> = new Map()
  private readonly containerHandles: Map<number, MemoryContainer> = new Map()
  private nextHandle = 1
  private readonly config: Required<BlobstoreConfig>

  constructor(config: MemoryBlobstoreConfig) {
    this.config = {
      maxObjectSize: config.maxObjectSize ?? DEFAULT_BLOBSTORE_CONFIG.maxObjectSize,
      maxObjectsPerContainer:
        config.maxObjectsPerContainer ?? DEFAULT_BLOBSTORE_CONFIG.maxObjectsPerContainer,
      maxContainers: config.maxContainers ?? DEFAULT_BLOBSTORE_CONFIG.maxContainers,
    }

    // Initialize with provided data
    if (config.initialData) {
      for (const [containerName, objects] of config.initialData) {
        const container = new MemoryContainer(containerName, this.config)
        container.populate(objects)
        this.containers.set(containerName, container)
      }
    }
  }

  getImports(): Record<string, unknown> {
    return {
      // Container management
      'create-container': this.createContainer.bind(this),
      'get-container': this.getContainer.bind(this),
      'delete-container': this.deleteContainer.bind(this),
      'container-exists': this.containerExists.bind(this),
      // Object operations
      'copy-object': this.copyObject.bind(this),
      'move-object': this.moveObject.bind(this),
      // Container resource methods
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
      // Resource drop
      '[resource-drop]container': this.dropContainer.bind(this),
    }
  }

  destroy(): void {
    this.containers.clear()
    this.containerHandles.clear()
  }

  /**
   * Create a new container
   */
  private createContainer(name: ContainerName): BlobstoreResult<number> {
    if (this.containers.has(name)) {
      return blobErr(`Container already exists: ${name}`)
    }

    if (this.containers.size >= this.config.maxContainers) {
      return blobErr(`Maximum container count ${this.config.maxContainers} exceeded`)
    }

    const container = new MemoryContainer(name, this.config)
    this.containers.set(name, container)

    const handle = this.nextHandle++
    this.containerHandles.set(handle, container)
    return blobOk(handle)
  }

  /**
   * Get an existing container
   */
  private getContainer(name: ContainerName): BlobstoreResult<number> {
    const container = this.containers.get(name)
    if (!container) {
      return blobErr(`Container not found: ${name}`)
    }

    const handle = this.nextHandle++
    this.containerHandles.set(handle, container)
    return blobOk(handle)
  }

  /**
   * Delete a container
   */
  private deleteContainer(name: ContainerName): BlobstoreResult<void> {
    if (!this.containers.has(name)) {
      return blobErr(`Container not found: ${name}`)
    }

    this.containers.delete(name)
    return blobOk(undefined)
  }

  /**
   * Check if container exists
   */
  private containerExists(name: ContainerName): BlobstoreResult<boolean> {
    return blobOk(this.containers.has(name))
  }

  /**
   * Copy an object
   */
  private copyObject(src: ObjectId, dest: ObjectId): BlobstoreResult<void> {
    const srcContainer = this.containers.get(src.container)
    if (!srcContainer) {
      return blobErr(`Source container not found: ${src.container}`)
    }

    const destContainer = this.containers.get(dest.container)
    if (!destContainer) {
      return blobErr(`Destination container not found: ${dest.container}`)
    }

    const dataResult = srcContainer.getData(src.object)
    if (dataResult.tag === 'err') {
      return dataResult
    }

    return destContainer.writeData(dest.object, dataResult.val)
  }

  /**
   * Move an object
   */
  private moveObject(src: ObjectId, dest: ObjectId): BlobstoreResult<void> {
    const copyResult = this.copyObject(src, dest)
    if (copyResult.tag === 'err') {
      return copyResult
    }

    const srcContainer = this.containers.get(src.container)!
    return srcContainer.deleteObject(src.object)
  }

  /**
   * Get container by handle
   */
  private getContainerByHandle(handle: number): MemoryContainer | undefined {
    return this.containerHandles.get(handle)
  }

  /**
   * Container.name method
   */
  private containerName(handle: number): BlobstoreResult<ContainerName> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return blobOk(container.name)
  }

  /**
   * Container.info method
   */
  private containerInfo(handle: number): BlobstoreResult<ContainerMetadata> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return blobOk(container.getInfo())
  }

  /**
   * Container.has-object method
   */
  private containerHasObject(handle: number, name: ObjectName): BlobstoreResult<boolean> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return blobOk(container.hasObject(name))
  }

  /**
   * Container.object-info method
   */
  private containerObjectInfo(handle: number, name: ObjectName): BlobstoreResult<ObjectMetadata> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.getObjectInfo(name)
  }

  /**
   * Container.get-data method
   */
  private containerGetData(
    handle: number,
    name: ObjectName,
    start?: bigint,
    end?: bigint
  ): BlobstoreResult<Uint8Array> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.getData(name, start, end)
  }

  /**
   * Container.write-data method
   */
  private containerWriteData(
    handle: number,
    name: ObjectName,
    data: Uint8Array
  ): BlobstoreResult<void> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.writeData(name, data)
  }

  /**
   * Container.delete-object method
   */
  private containerDeleteObject(handle: number, name: ObjectName): BlobstoreResult<void> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.deleteObject(name)
  }

  /**
   * Container.delete-objects method
   */
  private containerDeleteObjects(handle: number, names: ObjectName[]): BlobstoreResult<void> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.deleteObjects(names)
  }

  /**
   * Container.list-objects method
   */
  private containerListObjects(handle: number): BlobstoreResult<ObjectName[]> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return blobOk(container.listObjects())
  }

  /**
   * Container.clear method
   */
  private containerClear(handle: number): BlobstoreResult<void> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    container.clear()
    return blobOk(undefined)
  }

  /**
   * Drop container handle
   */
  private dropContainer(handle: number): void {
    this.containerHandles.delete(handle)
  }

  /**
   * Get container directly for testing
   */
  getContainerByName(name: ContainerName): MemoryContainer | undefined {
    return this.containers.get(name)
  }
}

/**
 * In-memory blobstore implementation
 *
 * Provides a simple in-memory blob storage suitable for:
 * - Testing
 * - Short-lived data
 * - Development environments
 *
 * Note: Data is not persisted across instance destruction.
 */
export const memoryBlobstoreImplementation: Implementation = {
  name: 'memory',
  description: 'In-memory blob storage (non-persistent)',
  create(config: PluginConfig): PluginInstance {
    return new MemoryBlobstoreInstance(config as MemoryBlobstoreConfig)
  },
}

/**
 * Create a memory blobstore and return both instance and direct access
 */
export function createMemoryBlobstore(
  config?: MemoryBlobstoreConfig
): { instance: PluginInstance; store: MemoryBlobstoreInstance } {
  const instance = new MemoryBlobstoreInstance(config ?? {})
  return { instance, store: instance }
}
