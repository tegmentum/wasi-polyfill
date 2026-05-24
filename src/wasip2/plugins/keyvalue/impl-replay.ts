/**
 * Replay key-value store implementation
 *
 * Provides deterministic key-value operations using the cassette
 * record/replay framework. Useful for:
 * - Deterministic testing of components that use key-value storage
 * - Snapshot testing with recorded data
 * - Integration tests without external dependencies
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type { Cassette } from '../../testing/replay.js'
import { CassetteRecorder, CassettePlayer } from '../../testing/replay.js'
import {
  type KeyValueResult,
  type KeyResponse,
  type StoreConfig,
  noSuchStore,
  accessDenied,
  otherError,
  kvOk,
  kvErr,
} from './types.js'

/**
 * Key-value cassette request types
 */
export interface KvCassetteGet {
  operation: 'get'
  bucket: string
  key: string
}

export interface KvCassetteSet {
  operation: 'set'
  bucket: string
  key: string
  value: string // Base64 encoded
}

export interface KvCassetteDelete {
  operation: 'delete'
  bucket: string
  key: string
}

export interface KvCassetteExists {
  operation: 'exists'
  bucket: string
  key: string
}

export interface KvCassetteListKeys {
  operation: 'list-keys'
  bucket: string
  cursor?: string
}

export type KvCassetteRequest =
  | KvCassetteGet
  | KvCassetteSet
  | KvCassetteDelete
  | KvCassetteExists
  | KvCassetteListKeys

/**
 * Key-value cassette response types
 */
export interface KvCassetteGetResponse {
  value?: string // Base64 encoded, undefined if not found
}

export interface KvCassetteSetResponse {
  success: true
}

export interface KvCassetteDeleteResponse {
  success: true
}

export interface KvCassetteExistsResponse {
  exists: boolean
}

export interface KvCassetteListKeysResponse {
  keys: string[]
  cursor?: string
}

export type KvCassetteResponse =
  | KvCassetteGetResponse
  | KvCassetteSetResponse
  | KvCassetteDeleteResponse
  | KvCassetteExistsResponse
  | KvCassetteListKeysResponse

/**
 * Configuration for replay key-value store
 */
export interface ReplayStoreConfig extends PluginConfig, StoreConfig {
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
  fallbackStore?: {
    get(bucket: string, key: string): KeyValueResult<Uint8Array | undefined>
    set(bucket: string, key: string, value: Uint8Array): KeyValueResult<void>
    delete(bucket: string, key: string): KeyValueResult<void>
    exists(bucket: string, key: string): KeyValueResult<boolean>
    listKeys(bucket: string, cursor?: string): KeyValueResult<KeyResponse>
  }

  /**
   * What to do when a replay miss occurs
   * @default 'error'
   */
  onMiss?: 'error' | 'fallback'

  /**
   * Allowed bucket identifiers
   */
  allowedBuckets?: string[]
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
 * Replay bucket implementation
 */
class ReplayBucket {
  constructor(
    private readonly identifier: string,
    private readonly player: CassettePlayer | null,
    private readonly recorder: CassetteRecorder | null,
    private readonly mode: 'replay' | 'record' | 'passthrough',
    private readonly onMiss: 'error' | 'fallback',
    private readonly fallbackStore?: ReplayStoreConfig['fallbackStore']
  ) {}

  get(key: string): KeyValueResult<Uint8Array | undefined> {
    const request: KvCassetteGet = {
      operation: 'get',
      bucket: this.identifier,
      key,
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<KvCassetteRequest, KvCassetteGetResponse>(
        'keyvalue-get',
        request
      )

      if (interaction) {
        const response = interaction.response
        if (response.value) {
          return kvOk(decodeBase64(response.value))
        }
        return kvOk(undefined)
      }

      if (this.onMiss === 'error') {
        return kvErr(otherError(`No matching keyvalue-get interaction for bucket=${this.identifier}, key=${key}`))
      }
    }

    // Fallback or record mode
    if (this.fallbackStore) {
      const result = this.fallbackStore.get(this.identifier, key)

      if (this.mode === 'record' && this.recorder && result.ok) {
        const response: KvCassetteGetResponse = {}
        if (result.value !== undefined) {
          response.value = encodeBase64(result.value)
        }
        this.recorder.record('keyvalue-get', request, response)
      }

      return result
    }

    return kvOk(undefined)
  }

  set(key: string, value: Uint8Array): KeyValueResult<void> {
    const request: KvCassetteSet = {
      operation: 'set',
      bucket: this.identifier,
      key,
      value: encodeBase64(value),
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<KvCassetteRequest, KvCassetteSetResponse>(
        'keyvalue-set',
        request
      )

      if (interaction) {
        return kvOk(undefined)
      }

      if (this.onMiss === 'error') {
        return kvErr(otherError(`No matching keyvalue-set interaction for bucket=${this.identifier}, key=${key}`))
      }
    }

    // Fallback or record mode
    if (this.fallbackStore) {
      const result = this.fallbackStore.set(this.identifier, key, value)

      if (this.mode === 'record' && this.recorder && result.ok) {
        const response: KvCassetteSetResponse = { success: true }
        this.recorder.record('keyvalue-set', request, response)
      }

      return result
    }

    return kvOk(undefined)
  }

  delete(key: string): KeyValueResult<void> {
    const request: KvCassetteDelete = {
      operation: 'delete',
      bucket: this.identifier,
      key,
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<KvCassetteRequest, KvCassetteDeleteResponse>(
        'keyvalue-set', // Note: using keyvalue-set for delete to match OperationType
        request
      )

      if (interaction) {
        return kvOk(undefined)
      }

      if (this.onMiss === 'error') {
        return kvErr(otherError(`No matching keyvalue-delete interaction for bucket=${this.identifier}, key=${key}`))
      }
    }

    // Fallback or record mode
    if (this.fallbackStore) {
      const result = this.fallbackStore.delete(this.identifier, key)

      if (this.mode === 'record' && this.recorder && result.ok) {
        const response: KvCassetteDeleteResponse = { success: true }
        this.recorder.record('keyvalue-set', request, response)
      }

      return result
    }

    return kvOk(undefined)
  }

  exists(key: string): KeyValueResult<boolean> {
    const request: KvCassetteExists = {
      operation: 'exists',
      bucket: this.identifier,
      key,
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<KvCassetteRequest, KvCassetteExistsResponse>(
        'keyvalue-get',
        request
      )

      if (interaction) {
        return kvOk(interaction.response.exists)
      }

      if (this.onMiss === 'error') {
        return kvErr(otherError(`No matching keyvalue-exists interaction for bucket=${this.identifier}, key=${key}`))
      }
    }

    // Fallback or record mode
    if (this.fallbackStore) {
      const result = this.fallbackStore.exists(this.identifier, key)

      if (this.mode === 'record' && this.recorder && result.ok) {
        const response: KvCassetteExistsResponse = { exists: result.value }
        this.recorder.record('keyvalue-get', request, response)
      }

      return result
    }

    return kvOk(false)
  }

  listKeys(cursor?: string): KeyValueResult<KeyResponse> {
    const request: KvCassetteListKeys = {
      operation: 'list-keys',
      bucket: this.identifier,
    }
    if (cursor !== undefined) {
      request.cursor = cursor
    }

    if (this.mode === 'replay' && this.player) {
      const interaction = this.player.findInteraction<KvCassetteRequest, KvCassetteListKeysResponse>(
        'keyvalue-get',
        request
      )

      if (interaction) {
        const responseVal: KeyResponse = { keys: interaction.response.keys }
        if (interaction.response.cursor !== undefined) {
          responseVal.cursor = interaction.response.cursor
        }
        return kvOk(responseVal)
      }

      if (this.onMiss === 'error') {
        return kvErr(otherError(`No matching keyvalue-list-keys interaction for bucket=${this.identifier}`))
      }
    }

    // Fallback or record mode
    if (this.fallbackStore) {
      const result = this.fallbackStore.listKeys(this.identifier, cursor)

      if (this.mode === 'record' && this.recorder && result.ok) {
        const response: KvCassetteListKeysResponse = { keys: result.value.keys }
        if (result.value.cursor !== undefined) {
          response.cursor = result.value.cursor
        }
        this.recorder.record('keyvalue-get', request, response)
      }

      return result
    }

    return kvOk({ keys: [] })
  }
}

/**
 * Replay store instance
 */
class ReplayStoreInstance implements PluginInstance {
  private readonly buckets: Map<string, ReplayBucket> = new Map()
  private readonly bucketHandles: Map<number, ReplayBucket> = new Map()
  private nextHandle = 1
  private readonly player: CassettePlayer | null
  private readonly recorder: CassetteRecorder | null
  private readonly mode: 'replay' | 'record' | 'passthrough'
  private readonly onMiss: 'error' | 'fallback'
  private readonly fallbackStore?: ReplayStoreConfig['fallbackStore']
  private readonly allowedBuckets?: Set<string>

  constructor(config: ReplayStoreConfig) {
    this.mode = config.mode ?? 'replay'
    this.onMiss = config.onMiss ?? 'error'
    this.fallbackStore = config.fallbackStore

    if (config.cassette) {
      this.player = new CassettePlayer(config.cassette)
    } else {
      this.player = null
    }

    this.recorder = config.recorder ?? null

    if (config.allowedBuckets) {
      this.allowedBuckets = new Set(config.allowedBuckets)
    }
  }

  getImports(): Record<string, unknown> {
    return {
      open: this.open.bind(this),
      '[method]bucket.get': this.bucketGet.bind(this),
      '[method]bucket.set': this.bucketSet.bind(this),
      '[method]bucket.delete': this.bucketDelete.bind(this),
      '[method]bucket.exists': this.bucketExists.bind(this),
      '[method]bucket.list-keys': this.bucketListKeys.bind(this),
      '[resource-drop]bucket': this.dropBucket.bind(this),
    }
  }

  destroy(): void {
    this.buckets.clear()
    this.bucketHandles.clear()
  }

  private open(identifier: string): KeyValueResult<number> {
    if (this.allowedBuckets && !this.allowedBuckets.has(identifier)) {
      return kvErr(accessDenied())
    }

    let bucket = this.buckets.get(identifier)
    if (!bucket) {
      bucket = new ReplayBucket(
        identifier,
        this.player,
        this.recorder,
        this.mode,
        this.onMiss,
        this.fallbackStore
      )
      this.buckets.set(identifier, bucket)
    }

    const handle = this.nextHandle++
    this.bucketHandles.set(handle, bucket)
    return kvOk(handle)
  }

  private getBucket(handle: number): ReplayBucket | undefined {
    return this.bucketHandles.get(handle)
  }

  private bucketGet(handle: number, key: string): KeyValueResult<Uint8Array | undefined> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.get(key)
  }

  private bucketSet(handle: number, key: string, value: Uint8Array): KeyValueResult<void> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.set(key, value)
  }

  private bucketDelete(handle: number, key: string): KeyValueResult<void> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.delete(key)
  }

  private bucketExists(handle: number, key: string): KeyValueResult<boolean> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.exists(key)
  }

  private bucketListKeys(handle: number, cursor?: string): KeyValueResult<KeyResponse> {
    const bucket = this.getBucket(handle)
    if (!bucket) {
      return kvErr(noSuchStore())
    }
    return bucket.listKeys(cursor)
  }

  private dropBucket(handle: number): void {
    this.bucketHandles.delete(handle)
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
 * Replay key-value store implementation
 *
 * Uses cassette record/replay for deterministic testing.
 */
export const replayStoreImplementation: Implementation = {
  name: 'replay',
  description: 'Cassette-based key-value store for deterministic testing',
  create(config: PluginConfig): PluginInstance {
    return new ReplayStoreInstance(config as ReplayStoreConfig)
  },
}

/**
 * Create a replay store with recording enabled
 */
export function createRecordingStore(
  name: string,
  fallbackStore: ReplayStoreConfig['fallbackStore'],
  config?: Omit<ReplayStoreConfig, 'mode' | 'recorder' | 'fallbackStore'>
): { instance: PluginInstance; recorder: CassetteRecorder } {
  const recorder = new CassetteRecorder(name)
  const instanceConfig: ReplayStoreConfig = {
    ...(config ?? {}),
    mode: 'record',
    recorder,
  }
  if (fallbackStore !== undefined) {
    instanceConfig.fallbackStore = fallbackStore
  }
  const instance = new ReplayStoreInstance(instanceConfig)
  return { instance, recorder }
}

/**
 * Create a replay store from a cassette
 */
export function createReplayStore(
  cassette: Cassette,
  config?: Omit<ReplayStoreConfig, 'cassette' | 'mode'>
): { instance: PluginInstance; player: CassettePlayer } {
  const player = new CassettePlayer(cassette)
  const instance = new ReplayStoreInstance({
    ...config,
    mode: 'replay',
    cassette,
  })
  return { instance, player }
}
