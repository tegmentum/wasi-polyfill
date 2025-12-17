/**
 * Replay/Record framework for deterministic testing
 *
 * Provides the ability to record provider calls and replay them
 * for reproducible tests.
 */

import type {
  Provider,
  ProviderContext,
} from '../provider.js'
import { formatInterfaceString } from '../../core/types.js'

/**
 * Cassette format version
 */
export const CASSETTE_VERSION = 1

/**
 * Recorded call entry
 */
export interface RecordedCall {
  /** Sequence number */
  seq: number
  /** Timestamp of the call */
  timestamp: number
  /** Provider ID */
  providerId: string
  /** Interface */
  interface: string
  /** Method name */
  method: string
  /** Serialized arguments */
  args: SerializedValue[]
  /** Serialized result (undefined if error) */
  result?: SerializedValue
  /** Error message if call failed */
  error?: string
  /** Duration in milliseconds */
  durationMs: number
}

/**
 * Serialized value for storage
 */
export type SerializedValue =
  | { type: 'null' }
  | { type: 'undefined' }
  | { type: 'boolean'; value: boolean }
  | { type: 'number'; value: number }
  | { type: 'bigint'; value: string }
  | { type: 'string'; value: string }
  | { type: 'bytes'; value: string } // base64 encoded
  | { type: 'array'; value: SerializedValue[] }
  | { type: 'object'; value: Record<string, SerializedValue> }
  | { type: 'error'; message: string }

/**
 * Cassette (recorded session)
 */
export interface Cassette {
  /** Format version */
  version: number
  /** When recording started */
  startTime: number
  /** When recording ended */
  endTime?: number
  /** Recorded calls */
  calls: RecordedCall[]
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * Serialize a value for storage
 */
export function serializeValue(value: unknown): SerializedValue {
  if (value === null) {
    return { type: 'null' }
  }

  if (value === undefined) {
    return { type: 'undefined' }
  }

  if (typeof value === 'boolean') {
    return { type: 'boolean', value }
  }

  if (typeof value === 'number') {
    return { type: 'number', value }
  }

  if (typeof value === 'bigint') {
    return { type: 'bigint', value: value.toString() }
  }

  if (typeof value === 'string') {
    return { type: 'string', value }
  }

  if (value instanceof Uint8Array) {
    return { type: 'bytes', value: bytesToBase64(value) }
  }

  if (value instanceof Error) {
    return { type: 'error', message: value.message }
  }

  if (Array.isArray(value)) {
    return { type: 'array', value: value.map(serializeValue) }
  }

  if (typeof value === 'object') {
    const serialized: Record<string, SerializedValue> = {}
    for (const [k, v] of Object.entries(value)) {
      serialized[k] = serializeValue(v)
    }
    return { type: 'object', value: serialized }
  }

  // Fallback: convert to string
  return { type: 'string', value: String(value) }
}

/**
 * Deserialize a value from storage
 */
export function deserializeValue(serialized: SerializedValue): unknown {
  switch (serialized.type) {
    case 'null':
      return null
    case 'undefined':
      return undefined
    case 'boolean':
      return serialized.value
    case 'number':
      return serialized.value
    case 'bigint':
      return BigInt(serialized.value)
    case 'string':
      return serialized.value
    case 'bytes':
      return base64ToBytes(serialized.value)
    case 'array':
      return serialized.value.map(deserializeValue)
    case 'object': {
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(serialized.value)) {
        result[k] = deserializeValue(v)
      }
      return result
    }
    case 'error':
      return new Error(serialized.message)
    default:
      return undefined
  }
}

/**
 * Convert bytes to base64
 */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  // Browser fallback
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]
    if (byte !== undefined) {
      binary += String.fromCharCode(byte)
    }
  }
  return btoa(binary)
}

/**
 * Convert base64 to bytes
 */
function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'))
  }
  // Browser fallback
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Cassette recorder
 */
export class CassetteRecorder {
  private cassette: Cassette
  private seq: number = 0

  constructor(metadata?: Record<string, unknown>) {
    this.cassette = {
      version: CASSETTE_VERSION,
      startTime: Date.now(),
      calls: [],
    }
    if (metadata !== undefined) {
      this.cassette.metadata = metadata
    }
  }

  /**
   * Record a call
   */
  record(
    providerId: string,
    interfaceStr: string,
    method: string,
    args: unknown[],
    result: unknown | undefined,
    error: Error | undefined,
    durationMs: number
  ): void {
    const call: RecordedCall = {
      seq: this.seq++,
      timestamp: Date.now(),
      providerId,
      interface: interfaceStr,
      method,
      args: args.map(serializeValue),
      durationMs,
    }
    if (result !== undefined) {
      call.result = serializeValue(result)
    }
    if (error !== undefined) {
      call.error = error.message
    }
    this.cassette.calls.push(call)
  }

  /**
   * Finish recording and return the cassette
   */
  finish(): Cassette {
    this.cassette.endTime = Date.now()
    return this.cassette
  }

  /**
   * Get current cassette (without finishing)
   */
  getCassette(): Cassette {
    return { ...this.cassette, calls: [...this.cassette.calls] }
  }

  /**
   * Export cassette as JSON
   */
  toJSON(): string {
    return JSON.stringify(this.finish(), null, 2)
  }

  /**
   * Export cassette as NDJSON (one call per line)
   */
  toNDJSON(): string {
    const lines: string[] = [
      JSON.stringify({
        version: this.cassette.version,
        startTime: this.cassette.startTime,
        metadata: this.cassette.metadata,
      }),
    ]

    for (const call of this.cassette.calls) {
      lines.push(JSON.stringify(call))
    }

    lines.push(JSON.stringify({ endTime: Date.now() }))

    return lines.join('\n')
  }
}

/**
 * Cassette player for replay
 */
export class CassettePlayer {
  private cassette: Cassette
  private position: Map<string, number> = new Map()
  readonly strict: boolean

  constructor(cassette: Cassette, strict: boolean = true) {
    this.cassette = cassette
    this.strict = strict
  }

  /**
   * Load cassette from JSON
   */
  static fromJSON(json: string): CassettePlayer {
    return new CassettePlayer(JSON.parse(json) as Cassette)
  }

  /**
   * Load cassette from NDJSON
   */
  static fromNDJSON(ndjson: string): CassettePlayer {
    const lines = ndjson.trim().split('\n')
    const firstLine = lines[0]
    const lastLine = lines[lines.length - 1]
    if (!firstLine || !lastLine) {
      throw new Error('Invalid NDJSON: missing header or footer')
    }
    const header = JSON.parse(firstLine) as { version: number; startTime: number; metadata?: Record<string, unknown> }
    const footer = JSON.parse(lastLine) as { endTime: number }
    const calls: RecordedCall[] = []

    for (let i = 1; i < lines.length - 1; i++) {
      const line = lines[i]
      if (line) {
        calls.push(JSON.parse(line) as RecordedCall)
      }
    }

    const cassette: Cassette = {
      version: header.version,
      startTime: header.startTime,
      endTime: footer.endTime,
      calls,
    }
    if (header.metadata !== undefined) {
      cassette.metadata = header.metadata
    }
    return new CassettePlayer(cassette)
  }

  /**
   * Get the next recorded call for a method
   */
  next(providerId: string, method: string): RecordedCall | undefined {
    const key = `${providerId}:${method}`
    const pos = this.position.get(key) ?? 0

    // Find the next matching call
    for (let i = pos; i < this.cassette.calls.length; i++) {
      const call = this.cassette.calls[i]
      if (call !== undefined && call.providerId === providerId && call.method === method) {
        this.position.set(key, i + 1)
        return call
      }
    }

    return undefined
  }

  /**
   * Replay a recorded call
   */
  replay(call: RecordedCall): unknown {
    if (call.error) {
      throw new Error(call.error)
    }

    if (call.result === undefined) {
      return undefined
    }

    return deserializeValue(call.result)
  }

  /**
   * Check if all calls have been replayed
   */
  isComplete(): boolean {
    // Check if we've consumed all calls
    let consumed = 0
    for (const pos of this.position.values()) {
      consumed = Math.max(consumed, pos)
    }
    return consumed >= this.cassette.calls.length
  }

  /**
   * Get remaining calls
   */
  remaining(): RecordedCall[] {
    let maxPos = 0
    for (const pos of this.position.values()) {
      maxPos = Math.max(maxPos, pos)
    }
    return this.cassette.calls.slice(maxPos)
  }

  /**
   * Reset playback position
   */
  reset(): void {
    this.position.clear()
  }

  /**
   * Get cassette metadata
   */
  getMetadata(): Record<string, unknown> | undefined {
    return this.cassette.metadata
  }
}

/**
 * Recording wrapper configuration
 */
export interface RecordingWrapperConfig {
  /** Recorder to use */
  recorder: CassetteRecorder
  /** Methods to exclude from recording */
  excludeMethods?: string[]
}

/**
 * Create a recording wrapper for a provider
 */
export function createRecordingWrapper(
  provider: Provider,
  config: RecordingWrapperConfig
): Provider {
  const { recorder, excludeMethods = [] } = config

  const interfaceStr = formatInterfaceString(provider.witInterface)
  const excludeSet = new Set(excludeMethods)

  // Get the original imports
  const originalImports = provider.getImports()

  // Wrap each method
  const wrappedImports: Record<string, unknown> = {}

  for (const [methodName, method] of Object.entries(originalImports)) {
    if (typeof method !== 'function') {
      wrappedImports[methodName] = method
      continue
    }

    if (excludeSet.has(methodName)) {
      wrappedImports[methodName] = method
      continue
    }

    // Create wrapped method
    wrappedImports[methodName] = (...args: unknown[]) => {
      const startTime = performance.now()

      try {
        const result = (method as (...args: unknown[]) => unknown)(...args)

        // Handle async results
        if (result instanceof Promise) {
          return result
            .then((asyncResult) => {
              const durationMs = performance.now() - startTime
              recorder.record(
                provider.id,
                interfaceStr,
                methodName,
                args,
                asyncResult,
                undefined,
                durationMs
              )
              return asyncResult
            })
            .catch((error) => {
              const durationMs = performance.now() - startTime
              recorder.record(
                provider.id,
                interfaceStr,
                methodName,
                args,
                undefined,
                error instanceof Error ? error : new Error(String(error)),
                durationMs
              )
              throw error
            })
        }

        // Sync result
        const durationMs = performance.now() - startTime
        recorder.record(
          provider.id,
          interfaceStr,
          methodName,
          args,
          result,
          undefined,
          durationMs
        )

        return result
      } catch (error) {
        const durationMs = performance.now() - startTime
        recorder.record(
          provider.id,
          interfaceStr,
          methodName,
          args,
          undefined,
          error instanceof Error ? error : new Error(String(error)),
          durationMs
        )
        throw error
      }
    }
  }

  // Return wrapped provider
  return {
    id: provider.id,
    witInterface: provider.witInterface,
    state: provider.state,
    capabilities: () => provider.capabilities(),
    init: (ctx: ProviderContext) => provider.init(ctx),
    getImports: () => wrappedImports,
    close: () => provider.close(),
  }
}

/**
 * Replay wrapper configuration
 */
export interface ReplayWrapperConfig {
  /** Player to use */
  player: CassettePlayer
  /** Methods to exclude from replay (will call real implementation) */
  excludeMethods?: string[]
  /** Whether to throw on missing recordings */
  strict?: boolean
}

/**
 * Create a replay wrapper for a provider
 */
export function createReplayWrapper(
  provider: Provider,
  config: ReplayWrapperConfig
): Provider {
  const { player, excludeMethods = [], strict = true } = config

  const excludeSet = new Set(excludeMethods)

  // Get the original imports
  const originalImports = provider.getImports()

  // Wrap each method
  const wrappedImports: Record<string, unknown> = {}

  for (const [methodName, method] of Object.entries(originalImports)) {
    if (typeof method !== 'function') {
      wrappedImports[methodName] = method
      continue
    }

    if (excludeSet.has(methodName)) {
      wrappedImports[methodName] = method
      continue
    }

    // Create wrapped method that replays from cassette
    wrappedImports[methodName] = (...args: unknown[]) => {
      const recorded = player.next(provider.id, methodName)

      if (!recorded) {
        if (strict) {
          throw new Error(
            `No recorded call for ${provider.id}.${methodName}. ` +
            `Remaining calls: ${player.remaining().length}`
          )
        }
        // Fall back to real implementation
        return (method as (...args: unknown[]) => unknown)(...args)
      }

      // Replay the recorded result
      return player.replay(recorded)
    }
  }

  // Return wrapped provider
  return {
    id: provider.id,
    witInterface: provider.witInterface,
    state: provider.state,
    capabilities: () => provider.capabilities(),
    init: (ctx: ProviderContext) => provider.init(ctx),
    getImports: () => wrappedImports,
    close: () => provider.close(),
  }
}

/**
 * Wrap a provider for recording
 */
export function withRecording(
  provider: Provider,
  recorder: CassetteRecorder,
  options?: Partial<Omit<RecordingWrapperConfig, 'recorder'>>
): Provider {
  return createRecordingWrapper(provider, { recorder, ...options })
}

/**
 * Wrap a provider for replay
 */
export function withReplay(
  provider: Provider,
  player: CassettePlayer,
  options?: Partial<Omit<ReplayWrapperConfig, 'player'>>
): Provider {
  return createReplayWrapper(provider, { player, ...options })
}
