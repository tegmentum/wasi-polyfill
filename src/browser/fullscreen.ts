/**
 * browser:fullscreen - Fullscreen interface
 *
 * Provides a capability-scoped interface to the Fullscreen API
 * for entering and exiting fullscreen mode in WebAssembly components.
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
import type { NodeHandle } from './dom.js'

// =============================================================================
// Fullscreen Types
// =============================================================================

/**
 * Fullscreen change event.
 */
export interface FullscreenChangeEvent {
  /** Whether now in fullscreen mode */
  isFullscreen: boolean
  /** Handle of the fullscreen element (if any) */
  element: NodeHandle | null
  /** Timestamp of the change */
  timestamp: number
}

/**
 * Fullscreen error event.
 */
export interface FullscreenErrorEvent {
  /** Error message */
  message: string
  /** Timestamp of the error */
  timestamp: number
}

/**
 * Fullscreen options.
 */
export interface FullscreenRequestOptions {
  /** Navigation UI preference */
  navigationUI?: 'auto' | 'show' | 'hide'
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the Fullscreen manager.
 */
export interface FullscreenOptions {
  /** Maximum queued events (default: 20) */
  maxQueuedEvents?: number
  /** Node handle lookup function */
  getNodeForHandle?: (handle: NodeHandle) => Element | null
  /** Handle creation function for elements */
  getHandleForNode?: (node: Element) => NodeHandle | null
}

// =============================================================================
// Browser Fullscreen Manager
// =============================================================================

/**
 * Browser Fullscreen implementation.
 *
 * Provides fullscreen control with capability-scoped access suitable
 * for use across the WASM boundary.
 */
export class BrowserFullscreen {
  private changeEvents: FullscreenChangeEvent[] = []
  private errorEvents: FullscreenErrorEvent[] = []
  private maxQueuedEvents: number
  private changeListener: (() => void) | null = null
  private errorListener: (() => void) | null = null
  private getNodeForHandle: ((handle: NodeHandle) => Element | null) | null
  private getHandleForNode: ((node: Element) => NodeHandle | null) | null

  constructor(options: FullscreenOptions = {}) {
    this.maxQueuedEvents = options.maxQueuedEvents ?? 20
    this.getNodeForHandle = options.getNodeForHandle ?? null
    this.getHandleForNode = options.getHandleForNode ?? null
    this.setupEventListeners()
  }

  /**
   * Set up fullscreen event listeners.
   */
  private setupEventListeners(): void {
    if (typeof document === 'undefined') {
      return
    }

    this.changeListener = () => {
      if (this.changeEvents.length >= this.maxQueuedEvents) {
        this.changeEvents.shift()
      }

      const element = document.fullscreenElement
      let handle: NodeHandle | null = null

      if (element && this.getHandleForNode) {
        handle = this.getHandleForNode(element)
      }

      this.changeEvents.push({
        isFullscreen: element !== null,
        element: handle,
        timestamp: Date.now(),
      })
    }

    this.errorListener = () => {
      if (this.errorEvents.length >= this.maxQueuedEvents) {
        this.errorEvents.shift()
      }

      this.errorEvents.push({
        message: 'Fullscreen request failed',
        timestamp: Date.now(),
      })
    }

    document.addEventListener('fullscreenchange', this.changeListener)
    document.addEventListener('fullscreenerror', this.errorListener)
  }

  /**
   * Check if Fullscreen API is supported.
   */
  isSupported(): boolean {
    return typeof document !== 'undefined' && 'fullscreenEnabled' in document
  }

  /**
   * Check if fullscreen is currently enabled (allowed by policy).
   */
  isEnabled(): boolean {
    if (typeof document === 'undefined') {
      return false
    }
    return document.fullscreenEnabled === true
  }

  /**
   * Check if currently in fullscreen mode.
   */
  isFullscreen(): boolean {
    if (typeof document === 'undefined') {
      return false
    }
    return document.fullscreenElement !== null
  }

  /**
   * Get the current fullscreen element handle.
   *
   * @returns Element handle or null if not in fullscreen
   */
  getFullscreenElement(): NodeHandle | null {
    if (typeof document === 'undefined' || !document.fullscreenElement) {
      return null
    }

    if (this.getHandleForNode) {
      return this.getHandleForNode(document.fullscreenElement)
    }

    return null
  }

  /**
   * Request fullscreen for an element or the document element.
   *
   * @param element - Optional element handle (defaults to document element)
   * @param options - Fullscreen options
   * @returns Success or error
   */
  async requestFullscreen(
    element?: NodeHandle,
    options?: FullscreenRequestOptions
  ): Promise<Result<void, BrowserError>> {
    if (!this.isSupported()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Fullscreen API is not supported'
      )
    }

    if (!this.isEnabled()) {
      return browserErr(
        BrowserErrorCode.DENIED,
        'Fullscreen is not allowed by document policy'
      )
    }

    let targetElement: Element | null = document.documentElement

    if (element !== undefined && this.getNodeForHandle) {
      targetElement = this.getNodeForHandle(element)
      if (!targetElement) {
        return browserErr(
          BrowserErrorCode.NOT_FOUND,
          `Element ${element} not found`
        )
      }
    }

    try {
      await targetElement!.requestFullscreen(options)
      return ok(undefined)
    } catch (e) {
      if (e instanceof TypeError) {
        return browserErr(
          BrowserErrorCode.INVALID_ARGUMENT,
          'Element cannot be made fullscreen'
        )
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to request fullscreen: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Exit fullscreen mode.
   *
   * @returns Success or error
   */
  async exitFullscreen(): Promise<Result<void, BrowserError>> {
    if (!this.isSupported()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Fullscreen API is not supported'
      )
    }

    if (!this.isFullscreen()) {
      return ok(undefined) // Already not in fullscreen
    }

    try {
      await document.exitFullscreen()
      return ok(undefined)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to exit fullscreen: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Read queued fullscreen change events.
   *
   * @param maxCount - Maximum events to return (default: all)
   * @returns Array of change events
   */
  readChangeEvents(maxCount?: number): FullscreenChangeEvent[] {
    const count = maxCount !== undefined
      ? Math.min(maxCount, this.changeEvents.length)
      : this.changeEvents.length

    return this.changeEvents.splice(0, count)
  }

  /**
   * Read queued fullscreen error events.
   *
   * @param maxCount - Maximum events to return (default: all)
   * @returns Array of error events
   */
  readErrorEvents(maxCount?: number): FullscreenErrorEvent[] {
    const count = maxCount !== undefined
      ? Math.min(maxCount, this.errorEvents.length)
      : this.errorEvents.length

    return this.errorEvents.splice(0, count)
  }

  /**
   * Get the number of queued change events.
   */
  getQueuedChangeCount(): number {
    return this.changeEvents.length
  }

  /**
   * Get the number of queued error events.
   */
  getQueuedErrorCount(): number {
    return this.errorEvents.length
  }

  /**
   * Clean up event listeners.
   */
  destroy(): void {
    if (typeof document === 'undefined') {
      return
    }

    if (this.changeListener) {
      document.removeEventListener('fullscreenchange', this.changeListener)
      this.changeListener = null
    }

    if (this.errorListener) {
      document.removeEventListener('fullscreenerror', this.errorListener)
      this.errorListener = null
    }

    this.changeEvents.length = 0
    this.errorEvents.length = 0
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultFullscreen: BrowserFullscreen | null = null

/**
 * Get the default Fullscreen manager instance.
 */
export function getDefaultFullscreen(options?: FullscreenOptions): BrowserFullscreen {
  if (!defaultFullscreen) {
    defaultFullscreen = new BrowserFullscreen(options)
  }
  return defaultFullscreen
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Check if Fullscreen API is supported.
 */
export function isFullscreenSupported(): boolean {
  return getDefaultFullscreen().isSupported()
}

/**
 * Check if currently in fullscreen mode.
 */
export function isFullscreen(): boolean {
  return getDefaultFullscreen().isFullscreen()
}

/**
 * Request fullscreen mode.
 */
export async function requestFullscreen(
  element?: NodeHandle,
  options?: FullscreenRequestOptions
): Promise<Result<void, BrowserError>> {
  return getDefaultFullscreen().requestFullscreen(element, options)
}

/**
 * Exit fullscreen mode.
 */
export async function exitFullscreen(): Promise<Result<void, BrowserError>> {
  return getDefaultFullscreen().exitFullscreen()
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:fullscreen imports object.
 */
export function getBrowserFullscreenImports(options?: FullscreenOptions): Record<string, unknown> {
  const fs = options ? new BrowserFullscreen(options) : getDefaultFullscreen()

  return {
    'browser:fullscreen/fullscreen': {
      // Support checks
      'is-supported': () => fs.isSupported(),
      'is-enabled': () => fs.isEnabled(),

      // State
      'is-fullscreen': () => fs.isFullscreen(),
      'get-fullscreen-element': () => fs.getFullscreenElement(),

      // Actions
      'request-fullscreen': (element?: NodeHandle, options?: FullscreenRequestOptions) =>
        fs.requestFullscreen(element, options),
      'exit-fullscreen': () => fs.exitFullscreen(),

      // Events
      'read-change-events': (maxCount?: number) => fs.readChangeEvents(maxCount),
      'read-error-events': (maxCount?: number) => fs.readErrorEvents(maxCount),
      'get-queued-change-count': () => fs.getQueuedChangeCount(),
      'get-queued-error-count': () => fs.getQueuedErrorCount(),
    },
  }
}
