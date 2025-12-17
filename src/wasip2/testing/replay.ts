/**
 * Record/Replay framework for deterministic testing
 *
 * Provides a cassette-based recording and replay system for WASI operations.
 * This enables deterministic testing of components that interact with
 * external services (HTTP, DNS, filesystem, etc.)
 *
 * Features:
 * - Record mode: Capture actual responses to create cassettes
 * - Replay mode: Return recorded responses for deterministic tests
 * - Golden snapshot format: Standard JSON format for cassettes
 * - Partial matching: Match requests by configurable criteria
 */

/**
 * Cassette format version
 */
export const CASSETTE_FORMAT_VERSION = 1

/**
 * Operation type being recorded/replayed
 */
export type OperationType =
  | 'http-request'
  | 'dns-lookup'
  | 'random-bytes'
  | 'clock-now'
  | 'filesystem-read'
  | 'filesystem-write'
  | 'keyvalue-get'
  | 'keyvalue-set'
  | 'blobstore-get'
  | 'blobstore-put'

/**
 * A single recorded interaction
 */
export interface CassetteInteraction<TRequest = unknown, TResponse = unknown> {
  /**
   * Unique ID for this interaction
   */
  id: string

  /**
   * Operation type
   */
  type: OperationType

  /**
   * Timestamp when recorded (ISO 8601)
   */
  recordedAt: string

  /**
   * Request/input data
   */
  request: TRequest

  /**
   * Response/output data
   */
  response: TResponse

  /**
   * Duration in milliseconds (for timing simulation)
   */
  durationMs?: number

  /**
   * Error if the operation failed
   */
  error?: {
    code: string
    message: string
  }

  /**
   * Custom metadata
   */
  metadata?: Record<string, unknown>
}

/**
 * HTTP request/response for cassette
 */
export interface HttpCassetteRequest {
  method: string
  url: string
  headers: Record<string, string[]>
  body?: string // Base64 encoded if binary
  bodyEncoding?: 'utf8' | 'base64'
}

export interface HttpCassetteResponse {
  status: number
  statusText?: string
  headers: Record<string, string[]>
  body?: string
  bodyEncoding?: 'utf8' | 'base64'
}

/**
 * DNS lookup for cassette
 */
export interface DnsCassetteRequest {
  hostname: string
  recordType: 'A' | 'AAAA' | 'ANY'
}

export interface DnsCassetteResponse {
  addresses: string[]
  ttl?: number
}

/**
 * Random bytes for cassette
 */
export interface RandomCassetteRequest {
  length: number
}

export interface RandomCassetteResponse {
  bytes: string // Base64 encoded
}

/**
 * A cassette containing recorded interactions
 */
export interface Cassette {
  /**
   * Format version
   */
  version: number

  /**
   * Cassette name/identifier
   */
  name: string

  /**
   * When the cassette was created (ISO 8601)
   */
  createdAt: string

  /**
   * Description of what this cassette contains
   */
  description?: string

  /**
   * Recorded interactions in order
   */
  interactions: CassetteInteraction[]

  /**
   * Cassette metadata
   */
  metadata?: Record<string, unknown>
}

/**
 * Request matching strategy
 */
export type MatchStrategy = 'exact' | 'fuzzy' | 'ignore'

/**
 * Request matching configuration
 */
export interface MatchConfig {
  /**
   * How to match URLs/paths
   */
  url?: MatchStrategy

  /**
   * How to match headers (by header name)
   */
  headers?: Record<string, MatchStrategy>

  /**
   * How to match request body
   */
  body?: MatchStrategy

  /**
   * How to match method
   */
  method?: MatchStrategy

  /**
   * Custom matcher function
   */
  custom?: (recorded: unknown, actual: unknown) => boolean
}

/**
 * Replay mode options
 */
export interface ReplayOptions {
  /**
   * What to do when no matching interaction is found
   */
  onMiss?: 'error' | 'passthrough' | 'record'

  /**
   * Request matching configuration
   */
  matching?: MatchConfig

  /**
   * Whether to simulate recorded timing
   */
  simulateTiming?: boolean

  /**
   * Maximum timing delay to simulate (ms)
   */
  maxSimulatedDelay?: number
}

/**
 * Recording options
 */
export interface RecordOptions {
  /**
   * Maximum body size to record (bytes)
   */
  maxBodySize?: number

  /**
   * Headers to redact in recordings
   */
  redactHeaders?: string[]

  /**
   * Whether to record timing information
   */
  recordTiming?: boolean
}

/**
 * Cassette recorder
 *
 * Records interactions for later replay
 */
export class CassetteRecorder {
  private readonly interactions: CassetteInteraction[] = []
  private readonly options: Required<RecordOptions>
  private interactionId = 0

  constructor(
    private readonly name: string,
    options?: RecordOptions
  ) {
    this.options = {
      maxBodySize: options?.maxBodySize ?? 1024 * 1024, // 1MB
      redactHeaders: options?.redactHeaders ?? ['authorization', 'cookie', 'x-api-key'],
      recordTiming: options?.recordTiming ?? true,
    }
  }

  /**
   * Record an HTTP interaction
   */
  recordHttp(
    request: HttpCassetteRequest,
    response: HttpCassetteResponse,
    durationMs?: number,
    error?: { code: string; message: string }
  ): void {
    // Redact sensitive headers
    const redactedRequestHeaders = this.redactHeaders(request.headers)
    const redactedResponseHeaders = this.redactHeaders(response.headers)

    const interaction: CassetteInteraction = {
      id: `http-${++this.interactionId}`,
      type: 'http-request',
      recordedAt: new Date().toISOString(),
      request: { ...request, headers: redactedRequestHeaders },
      response: { ...response, headers: redactedResponseHeaders },
    }

    if (this.options.recordTiming && durationMs !== undefined) {
      interaction.durationMs = durationMs
    }
    if (error !== undefined) {
      interaction.error = error
    }

    this.interactions.push(interaction)
  }

  /**
   * Record a DNS lookup
   */
  recordDns(
    request: DnsCassetteRequest,
    response: DnsCassetteResponse,
    durationMs?: number,
    error?: { code: string; message: string }
  ): void {
    const interaction: CassetteInteraction = {
      id: `dns-${++this.interactionId}`,
      type: 'dns-lookup',
      recordedAt: new Date().toISOString(),
      request,
      response,
    }

    if (this.options.recordTiming && durationMs !== undefined) {
      interaction.durationMs = durationMs
    }
    if (error !== undefined) {
      interaction.error = error
    }

    this.interactions.push(interaction)
  }

  /**
   * Record random bytes
   */
  recordRandom(length: number, bytes: Uint8Array): void {
    this.interactions.push({
      id: `random-${++this.interactionId}`,
      type: 'random-bytes',
      recordedAt: new Date().toISOString(),
      request: { length },
      response: { bytes: this.encodeBase64(bytes) },
    })
  }

  /**
   * Record a generic interaction
   */
  record<TRequest, TResponse>(
    type: OperationType,
    request: TRequest,
    response: TResponse,
    options?: {
      durationMs?: number
      error?: { code: string; message: string }
      metadata?: Record<string, unknown>
    }
  ): void {
    const interaction: CassetteInteraction<TRequest, TResponse> = {
      id: `${type}-${++this.interactionId}`,
      type,
      recordedAt: new Date().toISOString(),
      request,
      response,
    }

    if (this.options.recordTiming && options?.durationMs !== undefined) {
      interaction.durationMs = options.durationMs
    }
    if (options?.error !== undefined) {
      interaction.error = options.error
    }
    if (options?.metadata !== undefined) {
      interaction.metadata = options.metadata
    }

    this.interactions.push(interaction)
  }

  /**
   * Export the cassette
   */
  toCassette(description?: string): Cassette {
    const cassette: Cassette = {
      version: CASSETTE_FORMAT_VERSION,
      name: this.name,
      createdAt: new Date().toISOString(),
      interactions: [...this.interactions],
    }
    if (description !== undefined) {
      cassette.description = description
    }
    return cassette
  }

  /**
   * Export to JSON string
   */
  toJSON(pretty?: boolean): string {
    return JSON.stringify(this.toCassette(), null, pretty ? 2 : undefined)
  }

  /**
   * Clear all recorded interactions
   */
  clear(): void {
    this.interactions.length = 0
    this.interactionId = 0
  }

  private redactHeaders(headers: Record<string, string[]>): Record<string, string[]> {
    const redacted: Record<string, string[]> = {}
    for (const [key, values] of Object.entries(headers)) {
      if (this.options.redactHeaders.includes(key.toLowerCase())) {
        redacted[key] = ['[REDACTED]']
      } else {
        redacted[key] = values
      }
    }
    return redacted
  }

  private encodeBase64(bytes: Uint8Array): string {
    if (typeof btoa === 'function') {
      return btoa(String.fromCharCode(...bytes))
    }
    return Buffer.from(bytes).toString('base64')
  }
}

/**
 * Cassette player
 *
 * Replays recorded interactions
 */
export class CassettePlayer {
  private readonly interactions: CassetteInteraction[]
  private readonly options: Required<ReplayOptions>
  private playbackIndex = 0
  private readonly usedInteractions: Set<string> = new Set()

  constructor(
    private readonly cassette: Cassette,
    options?: ReplayOptions
  ) {
    this.interactions = cassette.interactions
    this.options = {
      onMiss: options?.onMiss ?? 'error',
      matching: options?.matching ?? {},
      simulateTiming: options?.simulateTiming ?? false,
      maxSimulatedDelay: options?.maxSimulatedDelay ?? 1000,
    }
  }

  /**
   * Find matching HTTP interaction
   */
  findHttp(request: HttpCassetteRequest): CassetteInteraction<HttpCassetteRequest, HttpCassetteResponse> | undefined {
    return this.findInteraction('http-request', request) as CassetteInteraction<HttpCassetteRequest, HttpCassetteResponse> | undefined
  }

  /**
   * Find matching DNS interaction
   */
  findDns(request: DnsCassetteRequest): CassetteInteraction<DnsCassetteRequest, DnsCassetteResponse> | undefined {
    return this.findInteraction('dns-lookup', request) as CassetteInteraction<DnsCassetteRequest, DnsCassetteResponse> | undefined
  }

  /**
   * Find matching random interaction
   */
  findRandom(length: number): CassetteInteraction<RandomCassetteRequest, RandomCassetteResponse> | undefined {
    return this.findInteraction('random-bytes', { length }) as CassetteInteraction<RandomCassetteRequest, RandomCassetteResponse> | undefined
  }

  /**
   * Find a matching interaction
   */
  findInteraction<TRequest, TResponse>(
    type: OperationType,
    request: TRequest
  ): CassetteInteraction<TRequest, TResponse> | undefined {
    // Find matching interaction by type
    for (const interaction of this.interactions) {
      if (interaction.type !== type) continue
      if (this.usedInteractions.has(interaction.id)) continue

      if (this.matchesRequest(interaction.request, request)) {
        this.usedInteractions.add(interaction.id)
        return interaction as CassetteInteraction<TRequest, TResponse>
      }
    }

    return undefined
  }

  /**
   * Get next interaction of a type (sequential playback)
   */
  next<TRequest, TResponse>(
    type: OperationType
  ): CassetteInteraction<TRequest, TResponse> | undefined {
    while (this.playbackIndex < this.interactions.length) {
      const interaction = this.interactions[this.playbackIndex++]
      if (interaction && interaction.type === type) {
        return interaction as CassetteInteraction<TRequest, TResponse>
      }
    }
    return undefined
  }

  /**
   * Reset playback position
   */
  reset(): void {
    this.playbackIndex = 0
    this.usedInteractions.clear()
  }

  /**
   * Check if all interactions have been used
   */
  get isComplete(): boolean {
    return this.usedInteractions.size === this.interactions.length
  }

  /**
   * Get unused interactions
   */
  getUnused(): CassetteInteraction[] {
    return this.interactions.filter(i => !this.usedInteractions.has(i.id))
  }

  /**
   * Handle miss based on configured behavior
   */
  handleMiss(type: OperationType, request: unknown): never | undefined {
    switch (this.options.onMiss) {
      case 'error':
        throw new Error(
          `No matching ${type} interaction found in cassette '${this.cassette.name}' for request: ${JSON.stringify(request)}`
        )
      case 'passthrough':
        return undefined
      case 'record':
        // Caller should handle recording
        return undefined
    }
  }

  /**
   * Simulate timing delay if enabled
   */
  async simulateDelay(interaction: CassetteInteraction): Promise<void> {
    if (!this.options.simulateTiming || !interaction.durationMs) {
      return
    }

    const delay = Math.min(interaction.durationMs, this.options.maxSimulatedDelay)
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  private matchesRequest(recorded: unknown, actual: unknown): boolean {
    // Use custom matcher if provided
    if (this.options.matching.custom) {
      return this.options.matching.custom(recorded, actual)
    }

    // Default: deep equality check
    return JSON.stringify(recorded) === JSON.stringify(actual)
  }
}

/**
 * Load a cassette from JSON
 */
export function loadCassette(json: string): Cassette {
  const cassette = JSON.parse(json) as Cassette

  if (cassette.version !== CASSETTE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported cassette format version: ${cassette.version}. Expected: ${CASSETTE_FORMAT_VERSION}`
    )
  }

  return cassette
}

/**
 * Create an empty cassette
 */
export function createCassette(name: string, description?: string): Cassette {
  const cassette: Cassette = {
    version: CASSETTE_FORMAT_VERSION,
    name,
    createdAt: new Date().toISOString(),
    interactions: [],
  }
  if (description !== undefined) {
    cassette.description = description
  }
  return cassette
}

/**
 * Merge multiple cassettes
 */
export function mergeCassettes(cassettes: Cassette[], name: string): Cassette {
  const merged: Cassette = {
    version: CASSETTE_FORMAT_VERSION,
    name,
    createdAt: new Date().toISOString(),
    description: `Merged from: ${cassettes.map(c => c.name).join(', ')}`,
    interactions: [],
  }

  for (const cassette of cassettes) {
    merged.interactions.push(...cassette.interactions)
  }

  return merged
}

/**
 * Validate a cassette
 */
export function validateCassette(cassette: Cassette): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (cassette.version !== CASSETTE_FORMAT_VERSION) {
    errors.push(`Invalid version: ${cassette.version}`)
  }

  if (!cassette.name) {
    errors.push('Missing cassette name')
  }

  if (!Array.isArray(cassette.interactions)) {
    errors.push('Interactions must be an array')
  } else {
    const ids = new Set<string>()
    for (const interaction of cassette.interactions) {
      if (!interaction.id) {
        errors.push('Interaction missing id')
      } else if (ids.has(interaction.id)) {
        errors.push(`Duplicate interaction id: ${interaction.id}`)
      } else {
        ids.add(interaction.id)
      }

      if (!interaction.type) {
        errors.push('Interaction missing type')
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
