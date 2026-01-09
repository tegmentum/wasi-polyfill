/**
 * browser:animation - Animation frame and idle callback interface
 *
 * Provides a capability-scoped interface to requestAnimationFrame and
 * requestIdleCallback APIs for scheduling work in WebAssembly components.
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
// Handle Types
// =============================================================================

/**
 * Handle to an animation frame request.
 */
export type AnimationFrameHandle = number

/**
 * Handle to an idle callback request.
 */
export type IdleCallbackHandle = number

// =============================================================================
// Frame Types
// =============================================================================

/**
 * Animation frame data.
 */
export interface AnimationFrameData {
  /** Handle to identify this frame request */
  handle: AnimationFrameHandle
  /** High-resolution timestamp when the frame callback was invoked */
  timestamp: number
  /** Delta time since the last frame in milliseconds */
  deltaTime: number
}

/**
 * Idle callback deadline information.
 */
export interface IdleDeadline {
  /** Time remaining in the idle period (milliseconds) */
  timeRemaining: number
  /** Whether the callback was invoked due to timeout */
  didTimeout: boolean
}

/**
 * Idle callback data.
 */
export interface IdleCallbackData {
  /** Handle to identify this idle request */
  handle: IdleCallbackHandle
  /** Deadline information */
  deadline: IdleDeadline
  /** Timestamp when the callback was invoked */
  timestamp: number
}

/**
 * Options for idle callbacks.
 */
export interface IdleCallbackOptions {
  /** Maximum time to wait before forcing the callback (milliseconds) */
  timeout?: number
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the Animation manager.
 */
export interface AnimationOptions {
  /** Maximum pending animation frame requests (default: 100) */
  maxPendingFrames?: number
  /** Maximum pending idle callbacks (default: 50) */
  maxPendingIdle?: number
}

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Pending frame request entry.
 */
interface PendingFrame {
  handle: AnimationFrameHandle
  rafId: number
  timestamp: number | null
  resolved: boolean
}

/**
 * Pending idle callback entry.
 */
interface PendingIdle {
  handle: IdleCallbackHandle
  callbackId: number
  data: IdleCallbackData | null
  resolved: boolean
}

// =============================================================================
// Browser Animation Manager
// =============================================================================

/**
 * Browser Animation implementation.
 *
 * Manages animation frame and idle callback requests with handle-based
 * access suitable for use across the WASM boundary.
 */
export class BrowserAnimation {
  private nextFrameHandle = 1
  private nextIdleHandle = 1
  private pendingFrames = new Map<AnimationFrameHandle, PendingFrame>()
  private pendingIdle = new Map<IdleCallbackHandle, PendingIdle>()
  private completedFrames: AnimationFrameData[] = []
  private completedIdle: IdleCallbackData[] = []
  private lastFrameTime = 0
  private maxPendingFrames: number
  private maxPendingIdle: number

  constructor(options: AnimationOptions = {}) {
    this.maxPendingFrames = options.maxPendingFrames ?? 100
    this.maxPendingIdle = options.maxPendingIdle ?? 50
  }

  /**
   * Check if requestAnimationFrame is supported.
   */
  isAnimationFrameSupported(): boolean {
    return typeof requestAnimationFrame !== 'undefined'
  }

  /**
   * Check if requestIdleCallback is supported.
   */
  isIdleCallbackSupported(): boolean {
    return typeof requestIdleCallback !== 'undefined'
  }

  /**
   * Request an animation frame.
   *
   * @returns Handle to the request or error
   */
  requestAnimationFrame(): Result<AnimationFrameHandle, BrowserError> {
    if (!this.isAnimationFrameSupported()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'requestAnimationFrame is not supported'
      )
    }

    if (this.pendingFrames.size >= this.maxPendingFrames) {
      return browserErr(
        BrowserErrorCode.BUSY,
        `Maximum pending frames (${this.maxPendingFrames}) reached`
      )
    }

    const handle = this.nextFrameHandle++

    const entry: PendingFrame = {
      handle,
      rafId: 0,
      timestamp: null,
      resolved: false,
    }

    entry.rafId = requestAnimationFrame((timestamp) => {
      if (!entry.resolved) {
        entry.resolved = true
        entry.timestamp = timestamp

        const deltaTime = this.lastFrameTime > 0
          ? timestamp - this.lastFrameTime
          : 0
        this.lastFrameTime = timestamp

        this.completedFrames.push({
          handle,
          timestamp,
          deltaTime,
        })

        this.pendingFrames.delete(handle)
      }
    })

    this.pendingFrames.set(handle, entry)
    return ok(handle)
  }

  /**
   * Cancel a pending animation frame request.
   *
   * @param handle - The frame handle to cancel
   * @returns Success or error
   */
  cancelAnimationFrame(handle: AnimationFrameHandle): Result<void, BrowserError> {
    const entry = this.pendingFrames.get(handle)
    if (!entry) {
      return ok(undefined) // Already completed or cancelled
    }

    if (!entry.resolved) {
      cancelAnimationFrame(entry.rafId)
      entry.resolved = true
    }

    this.pendingFrames.delete(handle)
    return ok(undefined)
  }

  /**
   * Read completed animation frames.
   *
   * @param maxCount - Maximum frames to return (default: all)
   * @returns Array of completed frame data
   */
  readCompletedFrames(maxCount?: number): AnimationFrameData[] {
    const count = maxCount !== undefined
      ? Math.min(maxCount, this.completedFrames.length)
      : this.completedFrames.length

    return this.completedFrames.splice(0, count)
  }

  /**
   * Check if an animation frame request is pending.
   *
   * @param handle - The frame handle
   * @returns True if the request is pending
   */
  isFramePending(handle: AnimationFrameHandle): boolean {
    const entry = this.pendingFrames.get(handle)
    return entry !== undefined && !entry.resolved
  }

  /**
   * Get the number of pending animation frame requests.
   */
  getPendingFrameCount(): number {
    return this.pendingFrames.size
  }

  /**
   * Get the current high-resolution time.
   */
  getFrameTime(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  /**
   * Request an idle callback.
   *
   * @param options - Idle callback options
   * @returns Handle to the request or error
   */
  requestIdleCallback(options?: IdleCallbackOptions): Result<IdleCallbackHandle, BrowserError> {
    if (!this.isIdleCallbackSupported()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'requestIdleCallback is not supported'
      )
    }

    if (this.pendingIdle.size >= this.maxPendingIdle) {
      return browserErr(
        BrowserErrorCode.BUSY,
        `Maximum pending idle callbacks (${this.maxPendingIdle}) reached`
      )
    }

    const handle = this.nextIdleHandle++

    const entry: PendingIdle = {
      handle,
      callbackId: 0,
      data: null,
      resolved: false,
    }

    const idleOptions = options?.timeout !== undefined
      ? { timeout: options.timeout }
      : undefined

    entry.callbackId = requestIdleCallback((deadline) => {
      if (!entry.resolved) {
        entry.resolved = true

        const data: IdleCallbackData = {
          handle,
          deadline: {
            timeRemaining: deadline.timeRemaining(),
            didTimeout: deadline.didTimeout,
          },
          timestamp: this.getFrameTime(),
        }

        entry.data = data
        this.completedIdle.push(data)
        this.pendingIdle.delete(handle)
      }
    }, idleOptions)

    this.pendingIdle.set(handle, entry)
    return ok(handle)
  }

  /**
   * Cancel a pending idle callback.
   *
   * @param handle - The idle callback handle to cancel
   * @returns Success or error
   */
  cancelIdleCallback(handle: IdleCallbackHandle): Result<void, BrowserError> {
    const entry = this.pendingIdle.get(handle)
    if (!entry) {
      return ok(undefined) // Already completed or cancelled
    }

    if (!entry.resolved) {
      cancelIdleCallback(entry.callbackId)
      entry.resolved = true
    }

    this.pendingIdle.delete(handle)
    return ok(undefined)
  }

  /**
   * Read completed idle callbacks.
   *
   * @param maxCount - Maximum callbacks to return (default: all)
   * @returns Array of completed idle callback data
   */
  readCompletedIdleCallbacks(maxCount?: number): IdleCallbackData[] {
    const count = maxCount !== undefined
      ? Math.min(maxCount, this.completedIdle.length)
      : this.completedIdle.length

    return this.completedIdle.splice(0, count)
  }

  /**
   * Check if an idle callback is pending.
   *
   * @param handle - The idle callback handle
   * @returns True if the callback is pending
   */
  isIdlePending(handle: IdleCallbackHandle): boolean {
    const entry = this.pendingIdle.get(handle)
    return entry !== undefined && !entry.resolved
  }

  /**
   * Get the number of pending idle callbacks.
   */
  getPendingIdleCount(): number {
    return this.pendingIdle.size
  }

  /**
   * Cancel all pending requests and clean up.
   */
  destroy(): void {
    // Cancel pending animation frames
    for (const entry of this.pendingFrames.values()) {
      if (!entry.resolved) {
        cancelAnimationFrame(entry.rafId)
      }
    }
    this.pendingFrames.clear()
    this.completedFrames.length = 0

    // Cancel pending idle callbacks
    for (const entry of this.pendingIdle.values()) {
      if (!entry.resolved) {
        cancelIdleCallback(entry.callbackId)
      }
    }
    this.pendingIdle.clear()
    this.completedIdle.length = 0
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultAnimation: BrowserAnimation | null = null

/**
 * Get the default Animation manager instance.
 */
export function getDefaultAnimation(options?: AnimationOptions): BrowserAnimation {
  if (!defaultAnimation) {
    defaultAnimation = new BrowserAnimation(options)
  }
  return defaultAnimation
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Check if requestAnimationFrame is supported.
 */
export function isAnimationFrameSupported(): boolean {
  return getDefaultAnimation().isAnimationFrameSupported()
}

/**
 * Check if requestIdleCallback is supported.
 */
export function isIdleCallbackSupported(): boolean {
  return getDefaultAnimation().isIdleCallbackSupported()
}

/**
 * Request an animation frame.
 */
export function requestFrame(): Result<AnimationFrameHandle, BrowserError> {
  return getDefaultAnimation().requestAnimationFrame()
}

/**
 * Cancel an animation frame request.
 */
export function cancelFrame(handle: AnimationFrameHandle): Result<void, BrowserError> {
  return getDefaultAnimation().cancelAnimationFrame(handle)
}

/**
 * Request an idle callback.
 */
export function requestIdle(options?: IdleCallbackOptions): Result<IdleCallbackHandle, BrowserError> {
  return getDefaultAnimation().requestIdleCallback(options)
}

/**
 * Cancel an idle callback.
 */
export function cancelIdle(handle: IdleCallbackHandle): Result<void, BrowserError> {
  return getDefaultAnimation().cancelIdleCallback(handle)
}

/**
 * Get the current high-resolution time.
 */
export function getFrameTime(): number {
  return getDefaultAnimation().getFrameTime()
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:animation imports object.
 */
export function getBrowserAnimationImports(options?: AnimationOptions): Record<string, unknown> {
  const anim = options ? new BrowserAnimation(options) : getDefaultAnimation()

  return {
    'browser:animation/animation': {
      // Support checks
      'is-animation-frame-supported': () => anim.isAnimationFrameSupported(),
      'is-idle-callback-supported': () => anim.isIdleCallbackSupported(),

      // Animation frames
      'request-animation-frame': () => anim.requestAnimationFrame(),
      'cancel-animation-frame': (handle: AnimationFrameHandle) =>
        anim.cancelAnimationFrame(handle),
      'read-completed-frames': (maxCount?: number) =>
        anim.readCompletedFrames(maxCount),
      'is-frame-pending': (handle: AnimationFrameHandle) =>
        anim.isFramePending(handle),
      'get-pending-frame-count': () => anim.getPendingFrameCount(),

      // Idle callbacks
      'request-idle-callback': (options?: IdleCallbackOptions) =>
        anim.requestIdleCallback(options),
      'cancel-idle-callback': (handle: IdleCallbackHandle) =>
        anim.cancelIdleCallback(handle),
      'read-completed-idle-callbacks': (maxCount?: number) =>
        anim.readCompletedIdleCallbacks(maxCount),
      'is-idle-pending': (handle: IdleCallbackHandle) =>
        anim.isIdlePending(handle),
      'get-pending-idle-count': () => anim.getPendingIdleCount(),

      // Time
      'get-frame-time': () => anim.getFrameTime(),
    },
  }
}
