/**
 * browser:* - Browser Host Interfaces
 *
 * Capability-scoped interfaces for WebAssembly components to access
 * browser functionality (DOM, canvas, storage, networking, etc.).
 *
 * @example
 * ```typescript
 * import { getBrowserImports } from '@tegmentum/wasi-polyfill/browser'
 *
 * // Get all browser imports
 * const imports = getBrowserImports()
 *
 * // Or get specific interface imports
 * import { getBrowserConsoleImports } from '@tegmentum/wasi-polyfill/browser'
 * const consoleImports = getBrowserConsoleImports()
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Phase 0: Types, Runtime, Console
// =============================================================================

// Types
export {
  // Error types
  BrowserErrorCode,
  type BrowserError,
  BrowserException,
  createBrowserError,
  mapErrorToBrowserError,
  // Result type
  type Result,
  ok,
  err,
  browserErr,
  // HTTP types
  type Header,
  type Headers,
  headersToObject,
  objectToHeaders,
  nativeHeadersToHeaders,
  headersToNativeHeaders,
  // URL type
  type Url,
  validateUrl,
  // Byte types
  type Bytes,
  stringToBytes,
  bytesToString,
  concatBytes,
  // Permission types
  PermissionState,
  mapPermissionState,
  // Async types
  type FutureResult,
  type StreamResult,
  type Future,
  type Stream,
  type StreamWriter,
  // Event types
  type BrowserEvent,
  type MouseEventData,
  type KeyboardEventData,
  mapMouseEvent,
  mapKeyboardEvent,
  // Geometry types
  type Rect,
  type Point,
  type Size,
  // Color types
  type Color,
  colorToCss,
  cssToColor,
  // Imports
  getBrowserTypesImports,
} from './types.js'

// Runtime
export {
  // Environment detection
  isSecureContext,
  isMainThread,
  isWorker,
  isServiceWorker,
  isBrowser,
  isWasmGcEnabled,
  // Feature detection
  type BrowserFeature,
  supports,
  getSupportedFeatures,
  // User agent
  type UserAgentHints,
  getUserAgentHints,
  // Capability checking
  checkRequirements,
  requireFeature,
  // Runtime info
  type RuntimeInfo,
  getRuntimeInfo,
  // User gesture
  recordUserGesture,
  hasRecentUserGesture,
  requireUserGesture,
  // Imports
  getBrowserRuntimeImports,
} from './runtime.js'

// Console
export {
  // Log level
  LogLevel,
  // Log parts
  type LogPart,
  // Logger
  type ConsoleLoggerConfig,
  ConsoleLogger,
  getDefaultLogger,
  configureDefaultLogger,
  // Standalone functions
  log,
  logStructured,
  time,
  timeEnd,
  timeLog,
  trace,
  debug,
  info,
  warn,
  error,
  // Imports
  getBrowserConsoleImports,
} from './console.js'

// =============================================================================
// Phase 1: Fetch, Storage, Performance
// =============================================================================

export {
  // Fetch
  type FetchRequest,
  type FetchResponse,
  type FetchOptions,
  BrowserFetch,
  fetch as browserFetch,
  getBrowserFetchImports,
} from './fetch.js'

export {
  // Storage
  type StorageOptions,
  BrowserStorage,
  getStorage,
  getBrowserStorageImports,
} from './storage.js'

export {
  // Performance
  type PerformanceMark,
  type PerformanceMeasure,
  BrowserPerformance,
  now as performanceNow,
  mark,
  measure,
  getBrowserPerformanceImports,
} from './performance.js'

// =============================================================================
// Phase 2: DOM, Events
// =============================================================================

export {
  // DOM
  type NodeHandle,
  type ElementHandle,
  type DocumentHandle,
  NodeType,
  type ElementInfo,
  type DomOptions,
  BrowserDom,
  getDefaultDom,
  getBrowserDomImports,
} from './dom.js'

export {
  // Events
  type SubscriptionHandle,
  type SubscribeOptions,
  type EventData,
  type TouchPoint,
  type TouchEventData,
  type WheelEventData,
  type FocusEventData,
  type InputEventData,
  type EventStreamResult,
  type EventsOptions,
  BrowserEvents,
  getDefaultEvents,
  subscribeDocument,
  subscribeWindow,
  readEvents,
  unsubscribe,
  getBrowserEventsImports,
} from './events.js'

// =============================================================================
// Phase 3: Canvas
// =============================================================================

export {
  // Canvas
  type CanvasHandle,
  type Context2DHandle,
  type LineCap,
  type LineJoin,
  type TextAlign,
  type TextBaseline,
  type CompositeOperation,
  type ImageData,
  type DrawCommand,
  type CanvasOptions,
  BrowserCanvas,
  getDefaultCanvas,
  getBrowserCanvasImports,
} from './canvas.js'

// =============================================================================
// Phase 4: Clipboard, Geolocation, Notifications, Media
// =============================================================================

export {
  // Clipboard
  type ClipboardItemType,
  type ClipboardItemData,
  type ClipboardOptions,
  BrowserClipboard,
  getDefaultClipboard,
  readText,
  writeText,
  getBrowserClipboardImports,
} from './clipboard.js'

export {
  // Geolocation
  type GeolocationCoordinates,
  type GeolocationPosition,
  type PositionOptions,
  type WatchHandle,
  type PositionEvent,
  type GeolocationOptions,
  BrowserGeolocation,
  getDefaultGeolocation,
  getCurrentPosition,
  getBrowserGeolocationImports,
} from './geolocation.js'

export {
  // Notifications
  type NotificationHandle,
  type NotificationDirection,
  type NotificationOptions,
  type NotificationAction,
  type NotificationEvent,
  type NotificationsConfig,
  BrowserNotifications,
  getDefaultNotifications,
  requestPermission,
  showNotification,
  getBrowserNotificationsImports,
} from './notifications.js'

export {
  // Media
  type MediaStreamHandle,
  type TrackHandle,
  type MediaTrackKind,
  type MediaTrackState,
  type AudioConstraints,
  type VideoConstraints,
  type MediaConstraints,
  type TrackInfo,
  type StreamInfo,
  type DeviceInfo,
  type MediaOptions,
  BrowserMedia,
  getDefaultMedia,
  getBrowserMediaImports,
} from './media.js'

// =============================================================================
// Phase 5: Service Worker (Experimental)
// =============================================================================

export {
  // Service Worker
  type RegistrationHandle,
  type ServiceWorkerHandle,
  type ServiceWorkerState,
  type UpdateViaCache,
  type RegistrationOptions,
  type ServiceWorkerInfo,
  type RegistrationInfo,
  type RegistrationEvent,
  type ServiceWorkerOptions,
  BrowserServiceWorker,
  getDefaultServiceWorker,
  register,
  getRegistrations,
  getBrowserServiceWorkerImports,
} from './service-worker.js'

// =============================================================================
// Phase 6: Worker (Parallel Computation)
// =============================================================================

export {
  // Handle types
  type WorkerHandle,
  type SharedBufferHandle,
  type MessagePortHandle,
  // Worker types
  WorkerType,
  WorkerState,
  type WorkerDescriptor,
  type WorkerInfo,
  type WorkerMessage,
  type WorkerError,
  // Shared memory types
  type SharedBufferDescriptor,
  type SharedBufferInfo,
  // Message port types
  type MessagePortInfo,
  // Configuration
  type BrowserWorkerOptions,
  // Manager
  BrowserWorker,
  getDefaultWorkerManager,
  // Standalone functions
  supportsWorkers,
  supportsSharedMemory,
  spawn,
  spawnInline,
  terminate,
  postMessage,
  readMessages,
  createSharedBuffer,
  // Imports
  getBrowserWorkerImports,
} from './worker.js'

// =============================================================================
// wasmGC-Enhanced Tier (Experimental)
// =============================================================================

export {
  // Types
  type NodeRef,
  type ElementRef,
  type EventRef,
  type EventPropertyValue,
  type GcEnhancedOptions,
  // GC-Enhanced DOM
  GcEnhancedDom,
  getDefaultGcDom,
  // GC-Enhanced Events
  GcEnhancedEvents,
  getDefaultGcEvents,
  // Feature detection
  supportsGcDom,
  supportsGcEvents,
  // Imports
  getBrowserGcEnhancedImports,
} from './gc-enhanced.js'

// =============================================================================
// WebGPU Interface
// =============================================================================

export {
  // Handle types
  type AdapterHandle,
  type DeviceHandle,
  type QueueHandle,
  type BufferHandle,
  type TextureHandle,
  type TextureViewHandle,
  type SamplerHandle,
  type ShaderModuleHandle,
  type BindGroupLayoutHandle,
  type BindGroupHandle,
  type PipelineLayoutHandle,
  type RenderPipelineHandle,
  type ComputePipelineHandle,
  type CommandEncoderHandle,
  type RenderPassEncoderHandle,
  type ComputePassEncoderHandle,
  type CommandBufferHandle,
  type QuerySetHandle,
  type CanvasContextHandle,
  // Error codes
  WebGPUErrorCode,
  createWebGPUError,
  mapGPUError,
  // GPU limits and features
  type GPULimitsRecord,
  type GPUFeaturesSet,
  type GPUFeatureName,
  mapGPULimits,
  mapGPUFeatures,
  featuresToArray,
  // Adapter types
  type GPUPowerPreference,
  type AdapterOptions,
  type AdapterInfo,
  mapAdapterInfo,
  // Device types
  type DeviceDescriptor,
  type DeviceLostInfo,
  // Buffer types
  type BufferUsageFlag,
  type BufferDescriptor,
  type BufferMapMode,
  bufferUsageToNative,
  // Texture types
  type TextureFormat,
  type TextureUsageFlag,
  type TextureDimension,
  type TextureViewDimension,
  type TextureAspect,
  type TextureSize,
  type TextureDescriptor,
  type TextureViewDescriptor,
  textureUsageToNative,
  // Sampler types
  type FilterMode,
  type MipmapFilterMode,
  type AddressMode,
  type CompareFunction,
  type SamplerDescriptor,
  // Shader types
  type ShaderModuleDescriptor,
  type CompilationMessage,
  mapCompilationMessage,
  // Bind group types
  type ShaderStageFlag,
  type BufferBindingType,
  type SamplerBindingType,
  type TextureSampleType,
  type StorageTextureAccess,
  type BindGroupLayoutEntry,
  type BindGroupEntryResource,
  type BindGroupEntry,
  shaderStageToNative,
  // Pipeline types
  type PrimitiveTopology,
  type FrontFace,
  type CullMode,
  type IndexFormat,
  type BlendFactor,
  type BlendOperation,
  type ColorWriteFlag,
  type VertexFormat,
  type VertexStepMode,
  type VertexAttribute,
  type VertexBufferLayout,
  type BlendComponent,
  type BlendState,
  type ColorTargetState,
  type StencilOperation,
  type StencilFaceState,
  type DepthStencilState,
  type MultisampleState,
  type PrimitiveState,
  type ProgrammableStage,
  type VertexState,
  type FragmentState,
  type RenderPipelineDescriptor,
  type ComputePipelineDescriptor,
  colorWriteToNative,
  // Command types
  type LoadOp,
  type StoreOp,
  type GPUColorValue,
  type RenderPassColorAttachment,
  type RenderPassDepthStencilAttachment,
  type RenderPassDescriptor,
  type ComputePassDescriptor,
  type ImageCopyBuffer,
  type ImageCopyTexture,
  type CopySize,
  // Canvas context types
  type CanvasAlphaMode,
  type CanvasColorSpace,
  type CanvasContextConfiguration,
  // Command batching types
  type RenderCommand,
  type ComputeCommand,
  // Managers
  BrowserWebGPUAdapter,
  BrowserWebGPUDevice,
  BrowserWebGPUBuffer,
  BrowserWebGPUTexture,
  BrowserWebGPUSampler,
  BrowserWebGPUShader,
  BrowserWebGPUBindGroup,
  BrowserWebGPUPipeline,
  BrowserWebGPUCommand,
  BrowserWebGPUQueue,
  BrowserWebGPUCanvasContext,
  HandleTable,
  // Default instances
  getDefaultAdapterManager,
  getDefaultDeviceManager,
  getDefaultBufferManager,
  getDefaultTextureManager,
  getDefaultSamplerManager,
  getDefaultShaderManager,
  getDefaultBindGroupManager,
  getDefaultPipelineManager,
  getDefaultCommandManager,
  getDefaultQueueManager,
  getDefaultCanvasContextManager,
  // Support check
  isWebGPUSupported,
  getPreferredCanvasFormat,
  // Combined imports
  getBrowserWebGPUImports,
  // Individual imports
  getBrowserWebGPUAdapterImports,
  getBrowserWebGPUDeviceImports,
  getBrowserWebGPUBufferImports,
  getBrowserWebGPUTextureImports,
  getBrowserWebGPUSamplerImports,
  getBrowserWebGPUShaderImports,
  getBrowserWebGPUBindGroupImports,
  getBrowserWebGPUPipelineImports,
  getBrowserWebGPUCommandImports,
  getBrowserWebGPUQueueImports,
  getBrowserWebGPUCanvasContextImports,
} from './webgpu/index.js'

// =============================================================================
// New Browser APIs
// =============================================================================

export {
  // WebSocket
  type WebSocketHandle,
  WebSocketState,
  WebSocketMessageType,
  type WebSocketMessage,
  type WebSocketError as WebSocketErrorEvent,
  type WebSocketClose,
  type WebSocketInfo,
  type WebSocketConnectOptions,
  type WebSocketOptions,
  BrowserWebSocket,
  getDefaultWebSocket,
  isWebSocketSupported,
  connect as wsConnect,
  send as wsSend,
  readMessages as wsReadMessages,
  close as wsClose,
  getBrowserWebSocketImports,
} from './websocket.js'

export {
  // BroadcastChannel
  type ChannelHandle,
  type BroadcastMessage,
  type ChannelInfo,
  type BroadcastChannelOptions,
  BrowserBroadcastChannel,
  getDefaultBroadcastChannel,
  isBroadcastChannelSupported,
  createChannel,
  postMessage as bcPostMessage,
  readMessages as bcReadMessages,
  closeChannel,
  getBrowserBroadcastChannelImports,
} from './broadcast-channel.js'

export {
  // Animation
  type AnimationFrameHandle,
  type IdleCallbackHandle,
  type AnimationFrameData,
  type IdleDeadline,
  type IdleCallbackData,
  type IdleCallbackOptions,
  type AnimationOptions,
  BrowserAnimation,
  getDefaultAnimation,
  isAnimationFrameSupported,
  isIdleCallbackSupported,
  requestFrame,
  cancelFrame,
  requestIdle,
  cancelIdle,
  getFrameTime,
  getBrowserAnimationImports,
} from './animation.js'

export {
  // History
  type HistoryState,
  type NavigationEntry,
  type PopStateEvent,
  type HistoryOptions,
  BrowserHistory,
  getDefaultHistory,
  isHistorySupported,
  pushState,
  replaceState,
  back,
  forward,
  go,
  getLength,
  getState,
  getBrowserHistoryImports,
} from './history.js'

export {
  // Screen
  type OrientationType,
  type OrientationLockType,
  type ScreenInfo,
  type OrientationChangeEvent,
  type ScreenOptions,
  BrowserScreen,
  getDefaultScreen,
  isScreenSupported,
  getScreenInfo,
  getOrientation,
  lockOrientation,
  unlockOrientation,
  getBrowserScreenImports,
} from './screen.js'

export {
  // Fullscreen
  type FullscreenChangeEvent,
  type FullscreenErrorEvent,
  type FullscreenRequestOptions,
  type FullscreenOptions,
  BrowserFullscreen,
  getDefaultFullscreen,
  isFullscreenSupported,
  isFullscreen,
  requestFullscreen,
  exitFullscreen,
  getBrowserFullscreenImports,
} from './fullscreen.js'

export {
  // Vibration
  type VibrationPattern,
  type VibrationOptions,
  BrowserVibration,
  getDefaultVibration,
  isVibrationSupported,
  vibrate,
  cancelVibration,
  getBrowserVibrationImports,
} from './vibration.js'

// =============================================================================
// Combined Imports
// =============================================================================

// Internal imports for getBrowserImports
import { getBrowserTypesImports as _getTypesImports } from './types.js'
import { getBrowserRuntimeImports as _getRuntimeImports } from './runtime.js'
import { getBrowserConsoleImports as _getConsoleImports } from './console.js'
import { getBrowserFetchImports as _getFetchImports } from './fetch.js'
import { getBrowserStorageImports as _getStorageImports } from './storage.js'
import { getBrowserPerformanceImports as _getPerformanceImports } from './performance.js'
import { getBrowserDomImports as _getDomImports } from './dom.js'
import { getBrowserEventsImports as _getEventsImports } from './events.js'
import { getBrowserCanvasImports as _getCanvasImports } from './canvas.js'
import { getBrowserClipboardImports as _getClipboardImports } from './clipboard.js'
import { getBrowserGeolocationImports as _getGeolocationImports } from './geolocation.js'
import { getBrowserNotificationsImports as _getNotificationsImports } from './notifications.js'
import { getBrowserMediaImports as _getMediaImports } from './media.js'
import { getBrowserServiceWorkerImports as _getServiceWorkerImports } from './service-worker.js'
import { getBrowserWorkerImports as _getWorkerImports } from './worker.js'
import { getBrowserGcEnhancedImports as _getGcEnhancedImports } from './gc-enhanced.js'
import { getBrowserWebGPUImports as _getWebGPUImports } from './webgpu/index.js'
import { getBrowserWebSocketImports as _getWebSocketImports } from './websocket.js'
import { getBrowserBroadcastChannelImports as _getBroadcastChannelImports } from './broadcast-channel.js'
import { getBrowserAnimationImports as _getAnimationImports } from './animation.js'
import { getBrowserHistoryImports as _getHistoryImports } from './history.js'
import { getBrowserScreenImports as _getScreenImports } from './screen.js'
import { getBrowserFullscreenImports as _getFullscreenImports } from './fullscreen.js'
import { getBrowserVibrationImports as _getVibrationImports } from './vibration.js'

/**
 * A capability-scoped browser interface that a component may be granted.
 * `browser:types` and `browser:runtime` are pure host-side utilities (error
 * mapping, feature detection) and are always available.
 */
export type BrowserCapability =
  | 'console'
  | 'fetch'
  | 'storage'
  | 'performance'
  | 'dom'
  | 'events'
  | 'canvas'
  | 'clipboard'
  | 'geolocation'
  | 'notifications'
  | 'media'
  | 'service-worker'
  | 'worker'
  | 'gc-enhanced'
  | 'webgpu'
  | 'websocket'
  | 'broadcast-channel'
  | 'animation'
  | 'history'
  | 'screen'
  | 'fullscreen'
  | 'vibration'

/**
 * Configuration for browser imports.
 */
export interface BrowserImportsConfig {
  /**
   * Capability allow-list. When omitted, every interface is provided (the
   * historical default). When set, only the listed interfaces are wired up —
   * a component cannot reach DOM, clipboard, media, network, etc. unless that
   * capability is explicitly granted.
   */
  capabilities?: readonly BrowserCapability[]
  /** Console logger configuration */
  console?: import('./console.js').ConsoleLoggerConfig
  /** Storage database name */
  storageDatabaseName?: string
  /** Custom fetch function */
  fetch?: typeof globalThis.fetch
  /** DOM options */
  dom?: import('./dom.js').DomOptions
  /** Events options */
  events?: import('./events.js').EventsOptions
  /** Canvas options */
  canvas?: import('./canvas.js').CanvasOptions
  /** Clipboard options */
  clipboard?: import('./clipboard.js').ClipboardOptions
  /** Geolocation options */
  geolocation?: import('./geolocation.js').GeolocationOptions
  /** Notifications config */
  notifications?: import('./notifications.js').NotificationsConfig
  /** Media options */
  media?: import('./media.js').MediaOptions
  /** Service worker options */
  serviceWorker?: import('./service-worker.js').ServiceWorkerOptions
  /** Worker options */
  worker?: import('./worker.js').BrowserWorkerOptions
  /** GC-enhanced tier options */
  gcEnhanced?: import('./gc-enhanced.js').GcEnhancedOptions
  /** WebSocket options */
  websocket?: import('./websocket.js').WebSocketOptions
  /** BroadcastChannel options */
  broadcastChannel?: import('./broadcast-channel.js').BroadcastChannelOptions
  /** Animation options */
  animation?: import('./animation.js').AnimationOptions
  /** History options */
  history?: import('./history.js').HistoryOptions
  /** Screen options */
  screen?: import('./screen.js').ScreenOptions
  /** Fullscreen options */
  fullscreen?: import('./fullscreen.js').FullscreenOptions
  /** Vibration options */
  vibration?: import('./vibration.js').VibrationOptions
}

/**
 * Get all browser:* imports.
 *
 * This combines all available browser interface imports into
 * a single object suitable for WebAssembly instantiation.
 */
export function getBrowserImports(config: BrowserImportsConfig = {}): Record<string, unknown> {
  const caps = config.capabilities
  // No allow-list => everything granted (backward compatible). Otherwise only
  // the listed capabilities are wired.
  const granted = (cap: BrowserCapability): boolean =>
    caps === undefined || caps.includes(cap)
  const when = (cap: BrowserCapability, imports: Record<string, unknown>) =>
    granted(cap) ? imports : {}

  return {
    // Pure host-side utilities — always available.
    ..._getTypesImports(),
    ..._getRuntimeImports(),
    // Capability-gated interfaces.
    ...when('console', _getConsoleImports(config.console)),
    ...when('fetch', _getFetchImports(config.fetch)),
    ...when('storage', _getStorageImports(config.storageDatabaseName)),
    ...when('performance', _getPerformanceImports()),
    ...when('dom', _getDomImports(config.dom)),
    ...when('events', _getEventsImports(config.events)),
    ...when('canvas', _getCanvasImports(config.canvas)),
    ...when('clipboard', _getClipboardImports(config.clipboard)),
    ...when('geolocation', _getGeolocationImports(config.geolocation)),
    ...when('notifications', _getNotificationsImports(config.notifications)),
    ...when('media', _getMediaImports(config.media)),
    ...when('service-worker', _getServiceWorkerImports(config.serviceWorker)),
    ...when('worker', _getWorkerImports(config.worker)),
    ...when('gc-enhanced', _getGcEnhancedImports(config.gcEnhanced)),
    ...when('webgpu', _getWebGPUImports()),
    ...when('websocket', _getWebSocketImports(config.websocket)),
    ...when('broadcast-channel', _getBroadcastChannelImports(config.broadcastChannel)),
    ...when('animation', _getAnimationImports(config.animation)),
    ...when('history', _getHistoryImports(config.history)),
    ...when('screen', _getScreenImports(config.screen)),
    ...when('fullscreen', _getFullscreenImports(config.fullscreen)),
    ...when('vibration', _getVibrationImports(config.vibration)),
  }
}

// =============================================================================
// Lazy Loading Helpers
// =============================================================================

/**
 * Lazily load WebGPU imports.
 *
 * Use this instead of the synchronous `getBrowserWebGPUImports` when you want
 * to defer loading of the WebGPU module until it's actually needed.
 * This reduces initial bundle size when WebGPU is optional.
 *
 * @example
 * ```typescript
 * // Only load WebGPU when needed
 * const webgpuImports = await getWebGPUImportsLazy()
 * ```
 */
export async function getWebGPUImportsLazy(): Promise<Record<string, unknown>> {
  const { getBrowserWebGPUImports } = await import('./webgpu/index.js')
  return getBrowserWebGPUImports()
}

/**
 * Lazily load GC-enhanced DOM/Events imports.
 *
 * Use this when the wasmGC tier is optional and you want to avoid
 * loading the module until it's confirmed to be needed.
 *
 * @example
 * ```typescript
 * // Only load GC-enhanced tier when wasmGC is available
 * if (await isWasmGcSupported()) {
 *   const gcImports = await getGcEnhancedImportsLazy()
 * }
 * ```
 */
export async function getGcEnhancedImportsLazy(
  options?: import('./gc-enhanced.js').GcEnhancedOptions
): Promise<Record<string, unknown>> {
  const { getBrowserGcEnhancedImports } = await import('./gc-enhanced.js')
  return getBrowserGcEnhancedImports(options)
}

/**
 * Lazily load Canvas imports.
 *
 * Use this when canvas functionality is optional and you want to
 * defer loading until actually needed.
 *
 * @example
 * ```typescript
 * // Only load canvas when needed
 * const canvasImports = await getCanvasImportsLazy()
 * ```
 */
export async function getCanvasImportsLazy(
  options?: import('./canvas.js').CanvasOptions
): Promise<Record<string, unknown>> {
  const { getBrowserCanvasImports } = await import('./canvas.js')
  return getBrowserCanvasImports(options)
}

/**
 * Lazily load Media imports.
 *
 * Use this when media functionality is optional and you want to
 * defer loading until actually needed.
 *
 * @example
 * ```typescript
 * // Only load media when needed
 * const mediaImports = await getMediaImportsLazy()
 * ```
 */
export async function getMediaImportsLazy(
  options?: import('./media.js').MediaOptions
): Promise<Record<string, unknown>> {
  const { getBrowserMediaImports } = await import('./media.js')
  return getBrowserMediaImports(options)
}

/**
 * Get a minimal set of browser imports.
 *
 * Returns only the essential imports (types, runtime, console) for
 * applications that need minimal browser functionality.
 * Use lazy loading helpers to add additional imports as needed.
 *
 * @example
 * ```typescript
 * // Start with minimal imports
 * const imports = getMinimalBrowserImports()
 *
 * // Add WebGPU only if needed
 * if (needsWebGPU) {
 *   Object.assign(imports, await getWebGPUImportsLazy())
 * }
 * ```
 */
export function getMinimalBrowserImports(config: Pick<BrowserImportsConfig, 'console'> = {}): Record<string, unknown> {
  return {
    ..._getTypesImports(),
    ..._getRuntimeImports(),
    ..._getConsoleImports(config.console),
  }
}

/**
 * Get core browser imports without heavy modules.
 *
 * Returns imports for types, runtime, console, fetch, storage, and performance.
 * Does not include WebGPU, Canvas, Media, or other heavy modules.
 *
 * @example
 * ```typescript
 * // Get core imports
 * const imports = getCoreBrowserImports()
 *
 * // Optionally add canvas
 * if (needsCanvas) {
 *   Object.assign(imports, await getCanvasImportsLazy())
 * }
 * ```
 */
export function getCoreBrowserImports(
  config: Pick<BrowserImportsConfig, 'console' | 'storageDatabaseName' | 'fetch'> = {}
): Record<string, unknown> {
  return {
    // Phase 0
    ..._getTypesImports(),
    ..._getRuntimeImports(),
    ..._getConsoleImports(config.console),
    // Phase 1
    ..._getFetchImports(config.fetch),
    ..._getStorageImports(config.storageDatabaseName),
    ..._getPerformanceImports(),
  }
}
