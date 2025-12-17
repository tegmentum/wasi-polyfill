/**
 * Replay blobstore implementation
 *
 * Provides deterministic blob storage operations using the cassette
 * record/replay framework. Useful for:
 * - Deterministic testing of components that use blob storage
 * - Snapshot testing with recorded data
 * - Integration tests without external dependencies
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type { Cassette } from '../../testing/replay.js'
import { CassetteRecorder, CassettePlayer } from '../../testing/replay.js'
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
 * Blobstore cassette request types
 */
export interface BlobCassetteGetData {
  operation: 'get-data'
  container: ContainerName
  object: ObjectName
  start?: string
  end?: string
}

export interface BlobCassettePutData {
  operation: 'put-data'
  container: ContainerName
  object: ObjectName
  data: string // Base64 encoded
}

export interface BlobCassetteDelete {
  operation: 'delete'
  container: ContainerName
  object: ObjectName
}

export interface BlobCassetteExists {
  operation: 'exists'
  container: ContainerName
  object: ObjectName
}

export interface BlobCassetteListObjects {
  operation: 'list-objects'
  container: ContainerName
}

export interface BlobCassetteObjectInfo {
  operation: 'object-info'
  container: ContainerName
  object: ObjectName
}

export type BlobCassetteRequest =
  | BlobCassetteGetData
  | BlobCassettePutData
  | BlobCassetteDelete
  | BlobCassetteExists
  | BlobCassetteListObjects
  | BlobCassetteObjectInfo

/**
 * Blobstore cassette response types
 */
export interface BlobCassetteGetDataResponse {
  data?: string // Base64 encoded, undefined if not found
  error?: string
}

export interface BlobCassettePutDataResponse {
  success: true
  error?: string
}

export interface BlobCassetteDeleteResponse {
  success: true
}

export interface BlobCassetteExistsResponse {
  exists: boolean
}

export interface BlobCassetteListObjectsResponse {
  objects: ObjectName[]
}

export interface BlobCassetteObjectInfoResponse {
  info?: {
    name: ObjectName
    container: ContainerName
    createdAt: string
    size: string
  }
  error?: string
}

export type BlobCassetteResponse =
  | BlobCassetteGetDataResponse
  | BlobCassettePutDataResponse
  | BlobCassetteDeleteResponse
  | BlobCassetteExistsResponse
  | BlobCassetteListObjectsResponse
  | BlobCassetteObjectInfoResponse

/**
 * Fallback store interface for record/passthrough modes
 */
export interface FallbackBlobstore {
  hasObject(container: ContainerName, object: ObjectName): Promise<BlobstoreResult<boolean>>
  getObjectInfo(container: ContainerName, object: ObjectName): Promise<BlobstoreResult<ObjectMetadata>>
  getData(container: ContainerName, object: ObjectName, start?: bigint, end?: bigint): Promise<BlobstoreResult<Uint8Array>>
  writeData(container: ContainerName, object: ObjectName, data: Uint8Array): Promise<BlobstoreResult<void>>
  deleteObject(container: ContainerName, object: ObjectName): Promise<BlobstoreResult<void>>
  listObjects(container: ContainerName): Promise<BlobstoreResult<ObjectName[]>>
}

/**
 * Configuration for replay blobstore
 */
export interface ReplayBlobstoreConfig extends PluginConfig, BlobstoreConfig {
  /**
   * Cassette to replay from
   */
  cassette?: Cassette

  /**
   * Recorder to use (for record mode)
   */
  recorder?: CassetteRecorder

  /**
   * Mode of operation
   * @default 'replay'
   */
  mode?: 'replay' | 'record' | 'passthrough'

  /**
   * Fallback store for passthrough/record modes
   */
  fallbackStore?: FallbackBlobstore

  /**
   * What to do when a replay miss occurs
   * @default 'error'
   */
  onMiss?: 'error' | 'fallback'
}

/**
 * Encode bytes to base64
 */
function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    return btoa(String.fromCharCode(...bytes))
  }
  return Buffer.from(bytes).toString('base64')
}

/**
 * Decode base64 to bytes
 */
function decodeBase64(str: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(str)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  return new Uint8Array(Buffer.from(str, 'base64'))
}

/**
 * Replay container implementation
 */
class ReplayContainer {
  readonly name: ContainerName
  readonly createdAt: Timestamp

  constructor(
    name: ContainerName,
    private readonly player: CassettePlayer | null,
    private readonly recorder: CassetteRecorder | null,
    private readonly mode: 'replay' | 'record' | 'passthrough',
    private readonly onMiss: 'error' | 'fallback',
    private readonly fallbackStore?: FallbackBlobstore
  ) {
    this.name = name
    this.createdAt = BigInt(Date.now())
  }

  getInfo(): ContainerMetadata {
    return {
      name: this.name,
      createdAt: this.createdAt,
    }
  }

  async hasObject(objectName: ObjectName): Promise<BlobstoreResult<boolean>> {
    const request: BlobCassetteExists = {
      operation: 'exists',
      container: this.name,
      object: objectName,
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<BlobCassetteRequest, BlobCassetteExistsResponse>(
        'blobstore-get',
        request
      )

      if (interaction) {
        return blobOk(interaction.response.exists)
      }

      if (this.onMiss === 'error') {
        return blobErr(`No matching blobstore-exists interaction for ${this.name}/${objectName}`)
      }
    }

    if (this.fallbackStore) {
      const result = await this.fallbackStore.hasObject(this.name, objectName)

      if (this.mode === 'record' && this.recorder && result.tag === 'ok') {
        const response: BlobCassetteExistsResponse = { exists: result.val }
        this.recorder.record('blobstore-get', request, response)
      }

      return result
    }

    return blobOk(false)
  }

  async getObjectInfo(objectName: ObjectName): Promise<BlobstoreResult<ObjectMetadata>> {
    const request: BlobCassetteObjectInfo = {
      operation: 'object-info',
      container: this.name,
      object: objectName,
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<BlobCassetteRequest, BlobCassetteObjectInfoResponse>(
        'blobstore-get',
        request
      )

      if (interaction && interaction.response.info) {
        return blobOk({
          name: interaction.response.info.name,
          container: interaction.response.info.container,
          createdAt: BigInt(interaction.response.info.createdAt),
          size: BigInt(interaction.response.info.size),
        })
      }

      if (interaction && interaction.response.error) {
        return blobErr(interaction.response.error)
      }

      if (this.onMiss === 'error') {
        return blobErr(`No matching blobstore-object-info interaction for ${this.name}/${objectName}`)
      }
    }

    if (this.fallbackStore) {
      const result = await this.fallbackStore.getObjectInfo(this.name, objectName)

      if (this.mode === 'record' && this.recorder) {
        const response: BlobCassetteObjectInfoResponse = result.tag === 'ok'
          ? {
              info: {
                name: result.val.name,
                container: result.val.container,
                createdAt: result.val.createdAt.toString(),
                size: result.val.size.toString(),
              },
            }
          : { error: result.val }
        this.recorder.record('blobstore-get', request, response)
      }

      return result
    }

    return blobErr(`Object not found: ${objectName}`)
  }

  async getData(objectName: ObjectName, start?: bigint, end?: bigint): Promise<BlobstoreResult<Uint8Array>> {
    const request: BlobCassetteGetData = {
      operation: 'get-data',
      container: this.name,
      object: objectName,
    }
    if (start !== undefined) {
      request.start = start.toString()
    }
    if (end !== undefined) {
      request.end = end.toString()
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<BlobCassetteRequest, BlobCassetteGetDataResponse>(
        'blobstore-get',
        request
      )

      if (interaction) {
        if (interaction.response.error) {
          return blobErr(interaction.response.error)
        }
        if (interaction.response.data) {
          return blobOk(decodeBase64(interaction.response.data))
        }
        return blobErr(`Object not found: ${objectName}`)
      }

      if (this.onMiss === 'error') {
        return blobErr(`No matching blobstore-get-data interaction for ${this.name}/${objectName}`)
      }
    }

    if (this.fallbackStore) {
      const result = await this.fallbackStore.getData(this.name, objectName, start, end)

      if (this.mode === 'record' && this.recorder) {
        const response: BlobCassetteGetDataResponse = result.tag === 'ok'
          ? { data: encodeBase64(result.val) }
          : { error: result.val }
        this.recorder.record('blobstore-get', request, response)
      }

      return result
    }

    return blobErr(`Object not found: ${objectName}`)
  }

  async writeData(objectName: ObjectName, data: Uint8Array): Promise<BlobstoreResult<void>> {
    const request: BlobCassettePutData = {
      operation: 'put-data',
      container: this.name,
      object: objectName,
      data: encodeBase64(data),
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<BlobCassetteRequest, BlobCassettePutDataResponse>(
        'blobstore-put',
        request
      )

      if (interaction) {
        if (interaction.response.error) {
          return blobErr(interaction.response.error)
        }
        return blobOk(undefined)
      }

      if (this.onMiss === 'error') {
        return blobErr(`No matching blobstore-put-data interaction for ${this.name}/${objectName}`)
      }
    }

    if (this.fallbackStore) {
      const result = await this.fallbackStore.writeData(this.name, objectName, data)

      if (this.mode === 'record' && this.recorder) {
        const response: BlobCassettePutDataResponse = result.tag === 'ok'
          ? { success: true }
          : { success: true, error: result.val }
        this.recorder.record('blobstore-put', request, response)
      }

      return result
    }

    return blobOk(undefined)
  }

  async deleteObject(objectName: ObjectName): Promise<BlobstoreResult<void>> {
    const request: BlobCassetteDelete = {
      operation: 'delete',
      container: this.name,
      object: objectName,
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<BlobCassetteRequest, BlobCassetteDeleteResponse>(
        'blobstore-put',
        request
      )

      if (interaction) {
        return blobOk(undefined)
      }

      if (this.onMiss === 'error') {
        return blobErr(`No matching blobstore-delete interaction for ${this.name}/${objectName}`)
      }
    }

    if (this.fallbackStore) {
      const result = await this.fallbackStore.deleteObject(this.name, objectName)

      if (this.mode === 'record' && this.recorder && result.tag === 'ok') {
        const response: BlobCassetteDeleteResponse = { success: true }
        this.recorder.record('blobstore-put', request, response)
      }

      return result
    }

    return blobOk(undefined)
  }

  async deleteObjects(names: ObjectName[]): Promise<BlobstoreResult<void>> {
    for (const name of names) {
      const result = await this.deleteObject(name)
      if (result.tag === 'err') {
        return result
      }
    }
    return blobOk(undefined)
  }

  async listObjects(): Promise<BlobstoreResult<ObjectName[]>> {
    const request: BlobCassetteListObjects = {
      operation: 'list-objects',
      container: this.name,
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<BlobCassetteRequest, BlobCassetteListObjectsResponse>(
        'blobstore-get',
        request
      )

      if (interaction) {
        return blobOk(interaction.response.objects)
      }

      if (this.onMiss === 'error') {
        return blobErr(`No matching blobstore-list-objects interaction for ${this.name}`)
      }
    }

    if (this.fallbackStore) {
      const result = await this.fallbackStore.listObjects(this.name)

      if (this.mode === 'record' && this.recorder && result.tag === 'ok') {
        const response: BlobCassetteListObjectsResponse = { objects: result.val }
        this.recorder.record('blobstore-get', request, response)
      }

      return result
    }

    return blobOk([])
  }

  async clear(): Promise<BlobstoreResult<void>> {
    const listResult = await this.listObjects()
    if (listResult.tag === 'err') {
      return listResult
    }
    return this.deleteObjects(listResult.val)
  }
}

/**
 * Replay blobstore instance
 */
class ReplayBlobstoreInstance implements PluginInstance {
  private readonly containers: Map<ContainerName, ReplayContainer> = new Map()
  private readonly containerHandles: Map<number, ReplayContainer> = new Map()
  private nextHandle = 1
  private readonly player: CassettePlayer | null
  private readonly recorder: CassetteRecorder | null
  private readonly mode: 'replay' | 'record' | 'passthrough'
  private readonly onMiss: 'error' | 'fallback'
  private readonly fallbackStore?: FallbackBlobstore
  private readonly config: Required<BlobstoreConfig>

  constructor(config: ReplayBlobstoreConfig) {
    this.mode = config.mode ?? 'replay'
    this.onMiss = config.onMiss ?? 'error'
    if (config.fallbackStore !== undefined) {
      this.fallbackStore = config.fallbackStore
    }

    if (config.cassette) {
      this.player = new CassettePlayer(config.cassette)
    } else {
      this.player = null
    }

    this.recorder = config.recorder ?? null

    this.config = {
      maxObjectSize: config.maxObjectSize ?? DEFAULT_BLOBSTORE_CONFIG.maxObjectSize,
      maxObjectsPerContainer: config.maxObjectsPerContainer ?? DEFAULT_BLOBSTORE_CONFIG.maxObjectsPerContainer,
      maxContainers: config.maxContainers ?? DEFAULT_BLOBSTORE_CONFIG.maxContainers,
    }
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
  }

  private createContainer(name: ContainerName): BlobstoreResult<number> {
    if (this.containers.has(name)) {
      return blobErr(`Container already exists: ${name}`)
    }

    if (this.containers.size >= this.config.maxContainers) {
      return blobErr(`Maximum container count ${this.config.maxContainers} exceeded`)
    }

    const container = new ReplayContainer(
      name,
      this.player,
      this.recorder,
      this.mode,
      this.onMiss,
      this.fallbackStore
    )
    this.containers.set(name, container)

    const handle = this.nextHandle++
    this.containerHandles.set(handle, container)
    return blobOk(handle)
  }

  private getContainer(name: ContainerName): BlobstoreResult<number> {
    let container = this.containers.get(name)
    if (!container) {
      // In replay mode, create container on-demand
      container = new ReplayContainer(
        name,
        this.player,
        this.recorder,
        this.mode,
        this.onMiss,
        this.fallbackStore
      )
      this.containers.set(name, container)
    }

    const handle = this.nextHandle++
    this.containerHandles.set(handle, container)
    return blobOk(handle)
  }

  private deleteContainer(name: ContainerName): BlobstoreResult<void> {
    this.containers.delete(name)
    return blobOk(undefined)
  }

  private containerExists(name: ContainerName): BlobstoreResult<boolean> {
    return blobOk(this.containers.has(name))
  }

  private async copyObject(src: ObjectId, dest: ObjectId): Promise<BlobstoreResult<void>> {
    const srcContainer = this.containers.get(src.container)
    if (!srcContainer) {
      return blobErr(`Source container not found: ${src.container}`)
    }

    let destContainer = this.containers.get(dest.container)
    if (!destContainer) {
      destContainer = new ReplayContainer(
        dest.container,
        this.player,
        this.recorder,
        this.mode,
        this.onMiss,
        this.fallbackStore
      )
      this.containers.set(dest.container, destContainer)
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

  private getContainerByHandle(handle: number): ReplayContainer | undefined {
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
    return container.hasObject(name)
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
    return container.listObjects()
  }

  private async containerClear(handle: number): Promise<BlobstoreResult<void>> {
    const container = this.getContainerByHandle(handle)
    if (!container) {
      return blobErr('Invalid container handle')
    }
    return container.clear()
  }

  private dropContainer(handle: number): void {
    this.containerHandles.delete(handle)
  }

  /**
   * Get the recorder for exporting cassette
   */
  getRecorder(): CassetteRecorder | null {
    return this.recorder
  }

  /**
   * Get the player for checking replay status
   */
  getPlayer(): CassettePlayer | null {
    return this.player
  }
}

/**
 * Replay blobstore implementation
 *
 * Uses cassette record/replay for deterministic testing.
 */
export const replayBlobstoreImplementation: Implementation = {
  name: 'replay',
  description: 'Cassette-based blobstore for deterministic testing',
  create(config: PluginConfig): PluginInstance {
    return new ReplayBlobstoreInstance(config as ReplayBlobstoreConfig)
  },
}

/**
 * Create a replay blobstore with recording enabled
 */
export function createRecordingBlobstore(
  name: string,
  fallbackStore: FallbackBlobstore,
  config?: Omit<ReplayBlobstoreConfig, 'mode' | 'recorder' | 'fallbackStore'>
): { instance: PluginInstance; recorder: CassetteRecorder } {
  const recorder = new CassetteRecorder(name)
  const instance = new ReplayBlobstoreInstance({
    ...config,
    mode: 'record',
    recorder,
    fallbackStore,
  })
  return { instance, recorder }
}

/**
 * Create a replay blobstore from a cassette
 */
export function createReplayBlobstore(
  cassette: Cassette,
  config?: Omit<ReplayBlobstoreConfig, 'cassette' | 'mode'>
): { instance: PluginInstance; player: CassettePlayer } {
  const player = new CassettePlayer(cassette)
  const instance = new ReplayBlobstoreInstance({
    ...config,
    mode: 'replay',
    cassette,
  })
  return { instance, player }
}
