/**
 * browser:runtime - Runtime capability discovery
 *
 * Provides functions to detect browser capabilities, environment,
 * and feature availability for browser:* interfaces.
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
// Environment Detection
// =============================================================================

/**
 * Check if running in a secure context (HTTPS or localhost).
 */
export function isSecureContext(): boolean {
  if (typeof globalThis.isSecureContext === 'boolean') {
    return globalThis.isSecureContext
  }
  // Fallback for older environments
  if (typeof globalThis.location !== 'undefined') {
    const protocol = globalThis.location.protocol
    return protocol === 'https:' || globalThis.location.hostname === 'localhost'
  }
  return false
}

/**
 * Check if running on the main thread (not a worker).
 */
export function isMainThread(): boolean {
  return typeof globalThis.document !== 'undefined'
}

/**
 * Check if running in a Web Worker.
 */
export function isWorker(): boolean {
  const g = globalThis as typeof globalThis & {
    WorkerGlobalScope?: { new (): unknown }
    self?: unknown
  }
  return typeof g.WorkerGlobalScope !== 'undefined' &&
    g.self instanceof (g.WorkerGlobalScope as { new (): unknown })
}

/**
 * Check if running in a Service Worker.
 */
export function isServiceWorker(): boolean {
  const g = globalThis as typeof globalThis & {
    ServiceWorkerGlobalScope?: { new (): unknown }
    self?: unknown
  }
  return typeof g.ServiceWorkerGlobalScope !== 'undefined' &&
    g.self instanceof (g.ServiceWorkerGlobalScope as { new (): unknown })
}

/**
 * Check if running in a browser environment.
 */
export function isBrowser(): boolean {
  return typeof globalThis.window !== 'undefined' ||
    typeof globalThis.self !== 'undefined'
}

/** Memoized result of {@link isWasmGcEnabled} (feature support can't change). */
let wasmGcSupport: boolean | undefined

/**
 * Check if the WebAssembly GC proposal is available, by validating a tiny
 * module whose type section declares a GC struct type — `WebAssembly.validate`
 * only accepts it on engines that implement GC. The result is memoized.
 */
export function isWasmGcEnabled(): boolean {
  if (wasmGcSupport !== undefined) return wasmGcSupport
  try {
    if (typeof WebAssembly === 'undefined' || typeof WebAssembly.validate !== 'function') {
      wasmGcSupport = false
      return false
    }
    // \0asm v1 + a type section declaring `struct { i8 }` (0x5f = struct,
    // 0x78 = i8 packed field, 0x00 = immutable). Validates only under GC.
    const gcProbe = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x5f,
      0x01, 0x78, 0x00,
    ])
    wasmGcSupport = WebAssembly.validate(gcProbe)
    return wasmGcSupport
  } catch {
    wasmGcSupport = false
    return false
  }
}

// =============================================================================
// Feature Detection
// =============================================================================

/**
 * Known browser features that can be detected.
 */
export type BrowserFeature =
  | 'browser:console'
  | 'browser:dom'
  | 'browser:events'
  | 'browser:canvas'
  | 'browser:canvas-offscreen'
  | 'browser:storage'
  | 'browser:storage-indexeddb'
  | 'browser:fetch'
  | 'browser:fetch-streaming'
  | 'browser:network-websocket'
  | 'browser:network-sse'
  | 'browser:clipboard'
  | 'browser:clipboard-read'
  | 'browser:clipboard-write'
  | 'browser:geolocation'
  | 'browser:media'
  | 'browser:media-capture'
  | 'browser:audio'
  | 'browser:audio-worklet'
  | 'browser:video'
  | 'browser:notifications'
  | 'browser:service-worker'
  | 'browser:performance'
  | 'browser:permissions'
  | 'wasm-gc'

/**
 * Check if a specific feature is supported.
 */
export function supports(feature: BrowserFeature | string): boolean {
  switch (feature) {
    // Core features
    case 'browser:console':
      return typeof globalThis.console !== 'undefined'

    case 'browser:dom':
      return isMainThread() && typeof globalThis.document !== 'undefined'

    case 'browser:events':
      return typeof globalThis.addEventListener !== 'undefined'

    // Canvas
    case 'browser:canvas':
      return isMainThread() && typeof globalThis.HTMLCanvasElement !== 'undefined'

    case 'browser:canvas-offscreen':
      return typeof globalThis.OffscreenCanvas !== 'undefined'

    // Storage
    case 'browser:storage':
      return typeof globalThis.indexedDB !== 'undefined'

    case 'browser:storage-indexeddb':
      return typeof globalThis.indexedDB !== 'undefined'

    // Fetch
    case 'browser:fetch':
      return typeof globalThis.fetch !== 'undefined'

    case 'browser:fetch-streaming':
      return typeof globalThis.ReadableStream !== 'undefined' &&
        typeof globalThis.fetch !== 'undefined'

    // Network
    case 'browser:network-websocket':
      return typeof globalThis.WebSocket !== 'undefined'

    case 'browser:network-sse':
      return typeof globalThis.EventSource !== 'undefined'

    // Clipboard
    case 'browser:clipboard':
      return isSecureContext() &&
        typeof globalThis.navigator?.clipboard !== 'undefined'

    case 'browser:clipboard-read':
      return isSecureContext() &&
        typeof globalThis.navigator?.clipboard?.readText === 'function'

    case 'browser:clipboard-write':
      return isSecureContext() &&
        typeof globalThis.navigator?.clipboard?.writeText === 'function'

    // Geolocation
    case 'browser:geolocation':
      return isSecureContext() &&
        typeof globalThis.navigator?.geolocation !== 'undefined'

    // Media
    case 'browser:media':
      return typeof globalThis.MediaStream !== 'undefined'

    case 'browser:media-capture':
      return isSecureContext() &&
        typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function'

    // Audio
    case 'browser:audio':
      return typeof globalThis.AudioContext !== 'undefined' ||
        typeof (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined'

    case 'browser:audio-worklet':
      return typeof globalThis.AudioWorklet !== 'undefined'

    // Video
    case 'browser:video':
      return isMainThread() && typeof globalThis.HTMLVideoElement !== 'undefined'

    // Notifications
    case 'browser:notifications':
      return isSecureContext() &&
        typeof globalThis.Notification !== 'undefined'

    // Service Worker
    case 'browser:service-worker':
      return isSecureContext() &&
        typeof globalThis.navigator?.serviceWorker !== 'undefined'

    // Performance
    case 'browser:performance':
      return typeof globalThis.performance !== 'undefined'

    // Permissions
    case 'browser:permissions':
      return typeof globalThis.navigator?.permissions !== 'undefined'

    // wasmGC
    case 'wasm-gc':
      return isWasmGcEnabled()

    default:
      // Unknown feature
      return false
  }
}

/**
 * Get all supported features.
 */
export function getSupportedFeatures(): BrowserFeature[] {
  const allFeatures: BrowserFeature[] = [
    'browser:console',
    'browser:dom',
    'browser:events',
    'browser:canvas',
    'browser:canvas-offscreen',
    'browser:storage',
    'browser:storage-indexeddb',
    'browser:fetch',
    'browser:fetch-streaming',
    'browser:network-websocket',
    'browser:network-sse',
    'browser:clipboard',
    'browser:clipboard-read',
    'browser:clipboard-write',
    'browser:geolocation',
    'browser:media',
    'browser:media-capture',
    'browser:audio',
    'browser:audio-worklet',
    'browser:video',
    'browser:notifications',
    'browser:service-worker',
    'browser:performance',
    'browser:permissions',
    'wasm-gc',
  ]

  return allFeatures.filter(supports)
}

// =============================================================================
// User Agent Hints
// =============================================================================

/**
 * User agent hints (privacy-aware subset).
 */
export interface UserAgentHints {
  /** Browser brand (e.g., "Chrome", "Firefox", "Safari") */
  brand?: string
  /** Browser version (major only for privacy) */
  version?: string
  /** Platform (e.g., "Windows", "macOS", "Linux", "Android", "iOS") */
  platform?: string
  /** Is mobile device */
  mobile?: boolean
}

/**
 * Get user agent hints.
 *
 * This provides a privacy-aware subset of user agent information.
 * Full user agent parsing is intentionally avoided.
 */
export function getUserAgentHints(): UserAgentHints {
  const hints: UserAgentHints = {}

  // Try User-Agent Client Hints API first (modern browsers)
  const nav = globalThis.navigator as Navigator & {
    userAgentData?: {
      brands?: Array<{ brand: string; version: string }>
      mobile?: boolean
      platform?: string
    }
  }

  if (nav?.userAgentData) {
    const data = nav.userAgentData

    // Get first non-"Not A Brand" brand
    const brand = data.brands?.find(b =>
      !b.brand.includes('Not') && !b.brand.includes('Brand')
    )
    if (brand) {
      hints.brand = brand.brand
      const majorVersion = brand.version.split('.')[0]
      if (majorVersion !== undefined) hints.version = majorVersion
    }

    if (data.mobile !== undefined) hints.mobile = data.mobile
    if (data.platform !== undefined) hints.platform = data.platform
  } else if (nav?.userAgent) {
    // Fallback to basic UA parsing (very limited)
    const ua = nav.userAgent

    // Detect platform
    if (ua.includes('Windows')) hints.platform = 'Windows'
    else if (ua.includes('Mac')) hints.platform = 'macOS'
    else if (ua.includes('Linux')) hints.platform = 'Linux'
    else if (ua.includes('Android')) hints.platform = 'Android'
    else if (ua.includes('iPhone') || ua.includes('iPad')) hints.platform = 'iOS'

    // Detect mobile
    hints.mobile = /Mobile|Android|iPhone|iPad/.test(ua)

    // Detect browser (very basic)
    if (ua.includes('Firefox/')) {
      hints.brand = 'Firefox'
    } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
      hints.brand = 'Safari'
    } else if (ua.includes('Chrome/')) {
      hints.brand = 'Chrome'
    }
  }

  return hints
}

// =============================================================================
// Capability Checking
// =============================================================================

/**
 * Check if the current context meets requirements for a feature.
 */
export function checkRequirements(
  feature: BrowserFeature
): Result<void, BrowserError> {
  // Check basic support
  if (!supports(feature)) {
    return browserErr(
      BrowserErrorCode.NOT_SUPPORTED,
      `Feature '${feature}' is not supported in this environment`
    )
  }

  // Check secure context requirements
  const secureContextRequired: BrowserFeature[] = [
    'browser:clipboard',
    'browser:clipboard-read',
    'browser:clipboard-write',
    'browser:geolocation',
    'browser:media-capture',
    'browser:notifications',
    'browser:service-worker',
  ]

  if (secureContextRequired.includes(feature) && !isSecureContext()) {
    return browserErr(
      BrowserErrorCode.INSECURE_CONTEXT,
      `Feature '${feature}' requires a secure context (HTTPS)`
    )
  }

  // Check main thread requirements
  const mainThreadRequired: BrowserFeature[] = [
    'browser:dom',
    'browser:canvas',
    'browser:video',
  ]

  if (mainThreadRequired.includes(feature) && !isMainThread()) {
    return browserErr(
      BrowserErrorCode.WRONG_THREAD,
      `Feature '${feature}' can only be used on the main thread`
    )
  }

  return ok(undefined)
}

/**
 * Require a feature, throwing if not available.
 */
export function requireFeature(feature: BrowserFeature): void {
  const result = checkRequirements(feature)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
}

// =============================================================================
// Runtime Info
// =============================================================================

/**
 * Runtime information.
 */
export interface RuntimeInfo {
  /** Is secure context */
  secureContext: boolean
  /** Is main thread */
  mainThread: boolean
  /** Is worker */
  worker: boolean
  /** Is service worker */
  serviceWorker: boolean
  /** Is browser environment */
  browser: boolean
  /** wasmGC enabled */
  wasmGcEnabled: boolean
  /** User agent hints */
  userAgentHints: UserAgentHints
  /** Supported features */
  supportedFeatures: BrowserFeature[]
}

/**
 * Get full runtime information.
 */
export function getRuntimeInfo(): RuntimeInfo {
  return {
    secureContext: isSecureContext(),
    mainThread: isMainThread(),
    worker: isWorker(),
    serviceWorker: isServiceWorker(),
    browser: isBrowser(),
    wasmGcEnabled: isWasmGcEnabled(),
    userAgentHints: getUserAgentHints(),
    supportedFeatures: getSupportedFeatures(),
  }
}

// =============================================================================
// User Gesture Detection
// =============================================================================

let lastUserGestureTime = 0
const USER_GESTURE_TIMEOUT = 5000 // 5 seconds

/**
 * Record a user gesture (call from event handlers).
 */
export function recordUserGesture(): void {
  lastUserGestureTime = Date.now()
}

/**
 * Check if we're within a recent user gesture.
 *
 * Note: This is best-effort. Browser implementations vary.
 */
export function hasRecentUserGesture(): boolean {
  return Date.now() - lastUserGestureTime < USER_GESTURE_TIMEOUT
}

/**
 * Require a user gesture, returning an error if not present.
 */
export function requireUserGesture(): Result<void, BrowserError> {
  if (!hasRecentUserGesture()) {
    return browserErr(
      BrowserErrorCode.NO_USER_GESTURE,
      'This operation requires a user gesture (click, tap, or key press)'
    )
  }
  return ok(undefined)
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:runtime imports object.
 */
export function getBrowserRuntimeImports(): Record<string, unknown> {
  return {
    'browser:runtime/runtime': {
      // Environment detection
      'is-secure-context': isSecureContext,
      'is-main-thread': isMainThread,
      'is-worker': isWorker,
      'is-service-worker': isServiceWorker,
      'is-browser': isBrowser,
      'wasm-gc-enabled': isWasmGcEnabled,

      // Feature detection
      supports,
      'get-supported-features': getSupportedFeatures,

      // User agent
      'get-user-agent-hints': getUserAgentHints,

      // Capability checking
      'check-requirements': checkRequirements,
      'require-feature': requireFeature,

      // Runtime info
      'get-runtime-info': getRuntimeInfo,

      // User gesture
      'record-user-gesture': recordUserGesture,
      'has-recent-user-gesture': hasRecentUserGesture,
      'require-user-gesture': requireUserGesture,
    },
  }
}
