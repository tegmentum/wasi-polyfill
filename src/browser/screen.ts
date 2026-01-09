/**
 * browser:screen - Screen information interface
 *
 * Provides a capability-scoped interface to the Screen API
 * for accessing display information in WebAssembly components.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  type Result,
  ok,
  browserErr,
} from './types.js'

// =============================================================================
// Type Augmentation
// =============================================================================

// ScreenOrientation.lock() is not yet in the default TypeScript lib
declare global {
  interface ScreenOrientation {
    lock(orientation: OrientationLockType): Promise<void>
  }
}

// =============================================================================
// Screen Types
// =============================================================================

/**
 * Screen orientation type.
 */
export type OrientationType =
  | 'portrait-primary'
  | 'portrait-secondary'
  | 'landscape-primary'
  | 'landscape-secondary'

/**
 * Screen orientation lock type.
 */
export type OrientationLockType =
  | 'any'
  | 'natural'
  | 'landscape'
  | 'portrait'
  | 'portrait-primary'
  | 'portrait-secondary'
  | 'landscape-primary'
  | 'landscape-secondary'

/**
 * Screen information.
 */
export interface ScreenInfo {
  /** Full screen width in pixels */
  width: number
  /** Full screen height in pixels */
  height: number
  /** Available screen width (excluding taskbars, etc.) */
  availWidth: number
  /** Available screen height (excluding taskbars, etc.) */
  availHeight: number
  /** Color depth in bits per pixel */
  colorDepth: number
  /** Pixel depth in bits per pixel */
  pixelDepth: number
  /** Device pixel ratio */
  devicePixelRatio: number
  /** Current orientation type */
  orientation: OrientationType
  /** Current orientation angle in degrees */
  orientationAngle: number
}

/**
 * Orientation change event.
 */
export interface OrientationChangeEvent {
  /** New orientation type */
  type: OrientationType
  /** New orientation angle */
  angle: number
  /** Timestamp of the change */
  timestamp: number
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the Screen manager.
 */
export interface ScreenOptions {
  /** Maximum queued orientation events (default: 20) */
  maxQueuedEvents?: number
}

// =============================================================================
// Browser Screen Manager
// =============================================================================

/**
 * Browser Screen implementation.
 *
 * Provides access to screen information with capability-scoped access
 * suitable for use across the WASM boundary.
 */
export class BrowserScreen {
  private orientationEvents: OrientationChangeEvent[] = []
  private maxQueuedEvents: number
  private orientationListener: (() => void) | null = null

  constructor(options: ScreenOptions = {}) {
    this.maxQueuedEvents = options.maxQueuedEvents ?? 20
    this.setupEventListener()
  }

  /**
   * Set up orientation change listener.
   */
  private setupEventListener(): void {
    if (typeof screen === 'undefined' || !screen.orientation) {
      return
    }

    this.orientationListener = () => {
      if (this.orientationEvents.length >= this.maxQueuedEvents) {
        this.orientationEvents.shift()
      }

      this.orientationEvents.push({
        type: screen.orientation.type as OrientationType,
        angle: screen.orientation.angle,
        timestamp: Date.now(),
      })
    }

    screen.orientation.addEventListener('change', this.orientationListener)
  }

  /**
   * Check if Screen API is supported.
   */
  isSupported(): boolean {
    return typeof screen !== 'undefined'
  }

  /**
   * Check if Screen Orientation API is supported.
   */
  isOrientationSupported(): boolean {
    return typeof screen !== 'undefined' && screen.orientation !== undefined
  }

  /**
   * Get screen information.
   *
   * @returns Screen info or error
   */
  getInfo(): Result<ScreenInfo, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'Screen API is not supported')
    }

    const orientationType: OrientationType = screen.orientation?.type as OrientationType
      ?? 'landscape-primary'
    const orientationAngle: number = screen.orientation?.angle ?? 0

    return ok({
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      devicePixelRatio: typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1,
      orientation: orientationType,
      orientationAngle,
    })
  }

  /**
   * Get current orientation.
   *
   * @returns Orientation info or error
   */
  getOrientation(): Result<{ type: OrientationType; angle: number }, BrowserError> {
    if (!this.isOrientationSupported()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Screen Orientation API is not supported'
      )
    }

    return ok({
      type: screen.orientation.type as OrientationType,
      angle: screen.orientation.angle,
    })
  }

  /**
   * Lock screen orientation.
   *
   * @param orientation - The orientation to lock to
   * @returns Success or error
   */
  async lockOrientation(
    orientation: OrientationLockType
  ): Promise<Result<void, BrowserError>> {
    if (!this.isOrientationSupported()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Screen Orientation API is not supported'
      )
    }

    try {
      await screen.orientation.lock(orientation)
      return ok(undefined)
    } catch (e) {
      if (e instanceof DOMException) {
        if (e.name === 'NotSupportedError') {
          return browserErr(
            BrowserErrorCode.NOT_SUPPORTED,
            'Orientation lock is not supported on this device'
          )
        }
        if (e.name === 'SecurityError') {
          return browserErr(
            BrowserErrorCode.SECURITY,
            'Orientation lock requires fullscreen mode'
          )
        }
        if (e.name === 'AbortError') {
          return browserErr(BrowserErrorCode.ABORTED, 'Orientation lock was aborted')
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to lock orientation: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Unlock screen orientation.
   *
   * @returns Success or error
   */
  unlockOrientation(): Result<void, BrowserError> {
    if (!this.isOrientationSupported()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Screen Orientation API is not supported'
      )
    }

    try {
      screen.orientation.unlock()
      return ok(undefined)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to unlock orientation: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Read queued orientation change events.
   *
   * @param maxCount - Maximum events to return (default: all)
   * @returns Array of orientation events
   */
  readOrientationEvents(maxCount?: number): OrientationChangeEvent[] {
    const count = maxCount !== undefined
      ? Math.min(maxCount, this.orientationEvents.length)
      : this.orientationEvents.length

    return this.orientationEvents.splice(0, count)
  }

  /**
   * Get the number of queued orientation events.
   */
  getQueuedEventCount(): number {
    return this.orientationEvents.length
  }

  /**
   * Clean up event listeners.
   */
  destroy(): void {
    if (this.orientationListener && typeof screen !== 'undefined' && screen.orientation) {
      screen.orientation.removeEventListener('change', this.orientationListener)
      this.orientationListener = null
    }
    this.orientationEvents.length = 0
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultScreen: BrowserScreen | null = null

/**
 * Get the default Screen manager instance.
 */
export function getDefaultScreen(options?: ScreenOptions): BrowserScreen {
  if (!defaultScreen) {
    defaultScreen = new BrowserScreen(options)
  }
  return defaultScreen
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Check if Screen API is supported.
 */
export function isScreenSupported(): boolean {
  return getDefaultScreen().isSupported()
}

/**
 * Get screen information.
 */
export function getScreenInfo(): Result<ScreenInfo, BrowserError> {
  return getDefaultScreen().getInfo()
}

/**
 * Get current orientation.
 */
export function getOrientation(): Result<{ type: OrientationType; angle: number }, BrowserError> {
  return getDefaultScreen().getOrientation()
}

/**
 * Lock screen orientation.
 */
export async function lockOrientation(
  orientation: OrientationLockType
): Promise<Result<void, BrowserError>> {
  return getDefaultScreen().lockOrientation(orientation)
}

/**
 * Unlock screen orientation.
 */
export function unlockOrientation(): Result<void, BrowserError> {
  return getDefaultScreen().unlockOrientation()
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:screen imports object.
 */
export function getBrowserScreenImports(options?: ScreenOptions): Record<string, unknown> {
  const scr = options ? new BrowserScreen(options) : getDefaultScreen()

  return {
    'browser:screen/screen': {
      // Support checks
      'is-supported': () => scr.isSupported(),
      'is-orientation-supported': () => scr.isOrientationSupported(),

      // Screen info
      'get-info': () => scr.getInfo(),
      'get-orientation': () => scr.getOrientation(),

      // Orientation lock
      'lock-orientation': (orientation: OrientationLockType) =>
        scr.lockOrientation(orientation),
      'unlock-orientation': () => scr.unlockOrientation(),

      // Events
      'read-orientation-events': (maxCount?: number) =>
        scr.readOrientationEvents(maxCount),
      'get-queued-event-count': () => scr.getQueuedEventCount(),
    },
  }
}
