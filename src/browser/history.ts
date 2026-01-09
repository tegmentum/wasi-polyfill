/**
 * browser:history - History and navigation interface
 *
 * Provides a capability-scoped interface to the History API
 * for navigation and state management in WebAssembly components.
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
// State Types
// =============================================================================

/**
 * History state entry.
 */
export interface HistoryState {
  /** State data (must be serializable) */
  data: unknown
  /** Page title (mostly unused by browsers) */
  title?: string
  /** URL to associate with the state (must be same origin) */
  url?: string
}

/**
 * Navigation entry information.
 */
export interface NavigationEntry {
  /** Current state data */
  state: unknown
  /** Current URL */
  url: string
  /** Current history length */
  length: number
}

/**
 * PopState event data.
 */
export interface PopStateEvent {
  /** State associated with the new location */
  state: unknown
  /** Timestamp of the event */
  timestamp: number
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the History manager.
 */
export interface HistoryOptions {
  /** Maximum queued popstate events (default: 50) */
  maxQueuedEvents?: number
}

// =============================================================================
// Browser History Manager
// =============================================================================

/**
 * Browser History implementation.
 *
 * Manages browser history with capability-scoped access suitable
 * for use across the WASM boundary.
 */
export class BrowserHistory {
  private popStateEvents: PopStateEvent[] = []
  private maxQueuedEvents: number
  private popStateListener: ((event: globalThis.PopStateEvent) => void) | null = null

  constructor(options: HistoryOptions = {}) {
    this.maxQueuedEvents = options.maxQueuedEvents ?? 50
    this.setupEventListener()
  }

  /**
   * Set up the popstate event listener.
   */
  private setupEventListener(): void {
    if (typeof window === 'undefined') {
      return
    }

    this.popStateListener = (event: globalThis.PopStateEvent) => {
      if (this.popStateEvents.length >= this.maxQueuedEvents) {
        this.popStateEvents.shift()
      }

      this.popStateEvents.push({
        state: event.state,
        timestamp: Date.now(),
      })
    }

    window.addEventListener('popstate', this.popStateListener)
  }

  /**
   * Check if History API is supported.
   */
  isSupported(): boolean {
    return typeof history !== 'undefined' && typeof history.pushState === 'function'
  }

  /**
   * Push a new state onto the history stack.
   *
   * @param state - The state to push
   * @returns Success or error
   */
  pushState(state: HistoryState): Result<void, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'History API is not supported')
    }

    try {
      history.pushState(state.data, state.title ?? '', state.url)
      return ok(undefined)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'SecurityError') {
        return browserErr(
          BrowserErrorCode.SECURITY,
          'Cannot push state with cross-origin URL'
        )
      }
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Failed to push state: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Replace the current state in the history stack.
   *
   * @param state - The state to replace with
   * @returns Success or error
   */
  replaceState(state: HistoryState): Result<void, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'History API is not supported')
    }

    try {
      history.replaceState(state.data, state.title ?? '', state.url)
      return ok(undefined)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'SecurityError') {
        return browserErr(
          BrowserErrorCode.SECURITY,
          'Cannot replace state with cross-origin URL'
        )
      }
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Failed to replace state: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Navigate back in history.
   *
   * @returns Success or error
   */
  back(): Result<void, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'History API is not supported')
    }

    try {
      history.back()
      return ok(undefined)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Failed to navigate back: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Navigate forward in history.
   *
   * @returns Success or error
   */
  forward(): Result<void, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'History API is not supported')
    }

    try {
      history.forward()
      return ok(undefined)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Failed to navigate forward: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Navigate to a specific position in history.
   *
   * @param delta - Number of steps to go (negative = back, positive = forward)
   * @returns Success or error
   */
  go(delta: number): Result<void, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'History API is not supported')
    }

    if (!Number.isInteger(delta)) {
      return browserErr(BrowserErrorCode.INVALID_ARGUMENT, 'Delta must be an integer')
    }

    try {
      history.go(delta)
      return ok(undefined)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Failed to navigate: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Get the current navigation entry information.
   *
   * @returns Navigation entry or error
   */
  getCurrentEntry(): Result<NavigationEntry, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'History API is not supported')
    }

    return ok({
      state: history.state,
      url: location.href,
      length: history.length,
    })
  }

  /**
   * Get the history length.
   *
   * @returns History length
   */
  getLength(): number {
    if (typeof history === 'undefined') {
      return 0
    }
    return history.length
  }

  /**
   * Get the current state.
   *
   * @returns Current state or null
   */
  getState(): unknown {
    if (typeof history === 'undefined') {
      return null
    }
    return history.state
  }

  /**
   * Read queued popstate events.
   *
   * @param maxCount - Maximum events to return (default: all)
   * @returns Array of popstate events
   */
  readPopStateEvents(maxCount?: number): PopStateEvent[] {
    const count = maxCount !== undefined
      ? Math.min(maxCount, this.popStateEvents.length)
      : this.popStateEvents.length

    return this.popStateEvents.splice(0, count)
  }

  /**
   * Get the number of queued popstate events.
   */
  getQueuedEventCount(): number {
    return this.popStateEvents.length
  }

  /**
   * Clean up event listeners.
   */
  destroy(): void {
    if (this.popStateListener && typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.popStateListener)
      this.popStateListener = null
    }
    this.popStateEvents.length = 0
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultHistory: BrowserHistory | null = null

/**
 * Get the default History manager instance.
 */
export function getDefaultHistory(options?: HistoryOptions): BrowserHistory {
  if (!defaultHistory) {
    defaultHistory = new BrowserHistory(options)
  }
  return defaultHistory
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Check if History API is supported.
 */
export function isHistorySupported(): boolean {
  return getDefaultHistory().isSupported()
}

/**
 * Push a new state onto the history stack.
 */
export function pushState(state: HistoryState): Result<void, BrowserError> {
  return getDefaultHistory().pushState(state)
}

/**
 * Replace the current state.
 */
export function replaceState(state: HistoryState): Result<void, BrowserError> {
  return getDefaultHistory().replaceState(state)
}

/**
 * Navigate back.
 */
export function back(): Result<void, BrowserError> {
  return getDefaultHistory().back()
}

/**
 * Navigate forward.
 */
export function forward(): Result<void, BrowserError> {
  return getDefaultHistory().forward()
}

/**
 * Navigate by delta.
 */
export function go(delta: number): Result<void, BrowserError> {
  return getDefaultHistory().go(delta)
}

/**
 * Get history length.
 */
export function getLength(): number {
  return getDefaultHistory().getLength()
}

/**
 * Get current state.
 */
export function getState(): unknown {
  return getDefaultHistory().getState()
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:history imports object.
 */
export function getBrowserHistoryImports(options?: HistoryOptions): Record<string, unknown> {
  const hist = options ? new BrowserHistory(options) : getDefaultHistory()

  return {
    'browser:history/history': {
      // Support check
      'is-supported': () => hist.isSupported(),

      // State management
      'push-state': (state: HistoryState) => hist.pushState(state),
      'replace-state': (state: HistoryState) => hist.replaceState(state),

      // Navigation
      back: () => hist.back(),
      forward: () => hist.forward(),
      go: (delta: number) => hist.go(delta),

      // State access
      'get-current-entry': () => hist.getCurrentEntry(),
      'get-length': () => hist.getLength(),
      'get-state': () => hist.getState(),

      // Events
      'read-popstate-events': (maxCount?: number) => hist.readPopStateEvents(maxCount),
      'get-queued-event-count': () => hist.getQueuedEventCount(),
    },
  }
}
