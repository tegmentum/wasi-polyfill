/**
 * browser:geolocation - Location services interface
 *
 * Provides a capability-scoped interface to the Geolocation API
 * for accessing device location information.
 *
 * Note: Geolocation requires a secure context (HTTPS) and
 * explicit user permission.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  mapErrorToBrowserError,
  type Result,
  ok,
  browserErr,
  PermissionState,
  mapPermissionState,
} from './types.js'
import { isSecureContext, supports } from './runtime.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Geographic coordinates.
 */
export interface GeolocationCoordinates {
  /** Latitude in decimal degrees */
  latitude: number
  /** Longitude in decimal degrees */
  longitude: number
  /** Altitude in meters (null if unavailable) */
  altitude: number | null
  /** Accuracy of latitude/longitude in meters */
  accuracy: number
  /** Accuracy of altitude in meters (null if unavailable) */
  altitudeAccuracy: number | null
  /** Heading in degrees from true north (null if unavailable) */
  heading: number | null
  /** Speed in meters per second (null if unavailable) */
  speed: number | null
}

/**
 * Geographic position.
 */
export interface GeolocationPosition {
  /** Coordinates */
  coords: GeolocationCoordinates
  /** Timestamp when position was acquired (ms since epoch) */
  timestamp: number
}

/**
 * Position options.
 */
export interface PositionOptions {
  /** Enable high accuracy mode (may use more battery) */
  enableHighAccuracy?: boolean
  /** Maximum age of cached position in milliseconds */
  maximumAge?: number
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * Watch handle for position tracking.
 */
export type WatchHandle = number

/**
 * Position event from watch.
 */
export type PositionEvent =
  | { type: 'position'; position: GeolocationPosition }
  | { type: 'error'; error: BrowserError }

/**
 * Geolocation options.
 */
export interface GeolocationOptions {
  /** Default position options */
  defaultOptions?: PositionOptions
}

// =============================================================================
// Browser Geolocation
// =============================================================================

/**
 * Browser geolocation implementation.
 */
export class BrowserGeolocation {
  private defaultOptions: PositionOptions
  private watches = new Map<WatchHandle, {
    nativeId: number
    queue: PositionEvent[]
    resolvers: Array<(events: PositionEvent[]) => void>
    closed: boolean
  }>()
  private watchCounter = 1

  constructor(options: GeolocationOptions = {}) {
    this.defaultOptions = options.defaultOptions ?? {}
  }

  /**
   * Check geolocation requirements.
   */
  private checkRequirements(): Result<void, BrowserError> {
    if (!isSecureContext()) {
      return browserErr(
        BrowserErrorCode.INSECURE_CONTEXT,
        'Geolocation requires a secure context (HTTPS)'
      )
    }

    if (!supports('browser:geolocation')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Geolocation API is not supported in this environment'
      )
    }

    return ok(undefined)
  }

  /**
   * Convert native coordinates to our type.
   */
  private mapCoordinates(coords: GeolocationCoordinates): GeolocationCoordinates {
    return {
      latitude: coords.latitude,
      longitude: coords.longitude,
      altitude: coords.altitude,
      accuracy: coords.accuracy,
      altitudeAccuracy: coords.altitudeAccuracy,
      heading: coords.heading,
      speed: coords.speed,
    }
  }

  /**
   * Query geolocation permission.
   */
  async queryPermission(): Promise<Result<PermissionState, BrowserError>> {
    if (!supports('browser:permissions')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Permissions API is not supported'
      )
    }

    try {
      const result = await navigator.permissions.query({ name: 'geolocation' })
      return ok(mapPermissionState(result.state))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get the current position.
   */
  async getCurrentPosition(options?: PositionOptions): Promise<Result<GeolocationPosition, BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    const opts = { ...this.defaultOptions, ...options }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve(ok({
            coords: this.mapCoordinates(position.coords),
            timestamp: position.timestamp,
          }))
        },
        (error) => {
          resolve({ ok: false, error: this.mapGeolocationError(error) })
        },
        opts
      )
    })
  }

  /**
   * Map native geolocation error to BrowserError.
   */
  private mapGeolocationError(error: GeolocationPositionError): BrowserError {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return {
          code: BrowserErrorCode.DENIED,
          message: 'Geolocation permission denied',
        }
      case error.POSITION_UNAVAILABLE:
        return {
          code: BrowserErrorCode.NOT_FOUND,
          message: 'Position unavailable',
        }
      case error.TIMEOUT:
        return {
          code: BrowserErrorCode.TIMEOUT,
          message: 'Geolocation request timed out',
        }
      default:
        return {
          code: BrowserErrorCode.UNKNOWN,
          message: error.message,
        }
    }
  }

  /**
   * Watch position changes.
   */
  watchPosition(options?: PositionOptions): Result<WatchHandle, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    const handle = this.watchCounter++
    const opts = { ...this.defaultOptions, ...options }

    const watchState = {
      nativeId: 0,
      queue: [] as PositionEvent[],
      resolvers: [] as Array<(events: PositionEvent[]) => void>,
      closed: false,
    }

    watchState.nativeId = navigator.geolocation.watchPosition(
      (position) => {
        if (watchState.closed) return

        const event: PositionEvent = {
          type: 'position',
          position: {
            coords: this.mapCoordinates(position.coords),
            timestamp: position.timestamp,
          },
        }

        if (watchState.resolvers.length > 0) {
          const resolver = watchState.resolvers.shift()!
          resolver([event])
        } else {
          watchState.queue.push(event)
        }
      },
      (error) => {
        if (watchState.closed) return

        const event: PositionEvent = {
          type: 'error',
          error: this.mapGeolocationError(error),
        }

        if (watchState.resolvers.length > 0) {
          const resolver = watchState.resolvers.shift()!
          resolver([event])
        } else {
          watchState.queue.push(event)
        }
      },
      opts
    )

    this.watches.set(handle, watchState)
    return ok(handle)
  }

  /**
   * Read events from a watch.
   */
  async readWatch(handle: WatchHandle): Promise<PositionEvent[]> {
    const state = this.watches.get(handle)
    if (!state || state.closed) {
      return []
    }

    if (state.queue.length > 0) {
      const events = state.queue.splice(0)
      return events
    }

    return new Promise((resolve) => {
      state.resolvers.push(resolve)
    })
  }

  /**
   * Poll for watch events without waiting.
   */
  pollWatch(handle: WatchHandle): Result<PositionEvent[], BrowserError> {
    const state = this.watches.get(handle)
    if (!state) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Watch not found')
    }

    if (state.closed) {
      return ok([])
    }

    const events = state.queue.splice(0)
    return ok(events)
  }

  /**
   * Clear a position watch.
   */
  clearWatch(handle: WatchHandle): Result<void, BrowserError> {
    const state = this.watches.get(handle)
    if (!state) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Watch not found')
    }

    navigator.geolocation.clearWatch(state.nativeId)
    state.closed = true

    // Resolve any waiting readers with empty array
    for (const resolver of state.resolvers) {
      resolver([])
    }
    state.resolvers = []

    this.watches.delete(handle)
    return ok(undefined)
  }

  /**
   * Clear all watches.
   */
  clearAllWatches(): void {
    for (const handle of this.watches.keys()) {
      this.clearWatch(handle)
    }
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultGeolocation: BrowserGeolocation | null = null

/**
 * Get the default geolocation instance.
 */
export function getDefaultGeolocation(): BrowserGeolocation {
  if (!defaultGeolocation) {
    defaultGeolocation = new BrowserGeolocation()
  }
  return defaultGeolocation
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Get current position.
 */
export async function getCurrentPosition(options?: PositionOptions): Promise<Result<GeolocationPosition, BrowserError>> {
  return getDefaultGeolocation().getCurrentPosition(options)
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:geolocation imports object.
 */
export function getBrowserGeolocationImports(options?: GeolocationOptions): Record<string, unknown> {
  let geolocation: BrowserGeolocation | null = null

  const getGeolocation = (): BrowserGeolocation => {
    if (!geolocation) {
      geolocation = options ? new BrowserGeolocation(options) : getDefaultGeolocation()
    }
    return geolocation
  }

  return {
    'browser:geolocation/geolocation': {
      // Permissions
      'query-permission': () => getGeolocation().queryPermission(),

      // One-shot position
      'get-current-position': (opts?: PositionOptions) => getGeolocation().getCurrentPosition(opts),

      // Watching
      'watch-position': (opts?: PositionOptions) => getGeolocation().watchPosition(opts),
      'read-watch': (handle: WatchHandle) => getGeolocation().readWatch(handle),
      'poll-watch': (handle: WatchHandle) => getGeolocation().pollWatch(handle),
      'clear-watch': (handle: WatchHandle) => getGeolocation().clearWatch(handle),
      'clear-all-watches': () => getGeolocation().clearAllWatches(),
    },
  }
}
