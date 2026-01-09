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
  type WorkerOptions,
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

/**
 * Configuration for browser imports.
 */
export interface BrowserImportsConfig {
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
  worker?: import('./worker.js').WorkerOptions
  /** GC-enhanced tier options */
  gcEnhanced?: import('./gc-enhanced.js').GcEnhancedOptions
}

/**
 * Get all browser:* imports.
 *
 * This combines all available browser interface imports into
 * a single object suitable for WebAssembly instantiation.
 */
export function getBrowserImports(config: BrowserImportsConfig = {}): Record<string, unknown> {
  return {
    // Phase 0
    ..._getTypesImports(),
    ..._getRuntimeImports(),
    ..._getConsoleImports(config.console),
    // Phase 1
    ..._getFetchImports(config.fetch),
    ..._getStorageImports(config.storageDatabaseName),
    ..._getPerformanceImports(),
    // Phase 2
    ..._getDomImports(config.dom),
    ..._getEventsImports(config.events),
    // Phase 3
    ..._getCanvasImports(config.canvas),
    // Phase 4
    ..._getClipboardImports(config.clipboard),
    ..._getGeolocationImports(config.geolocation),
    ..._getNotificationsImports(config.notifications),
    ..._getMediaImports(config.media),
    // Phase 5
    ..._getServiceWorkerImports(config.serviceWorker),
    // Phase 6
    ..._getWorkerImports(config.worker),
    // wasmGC-enhanced tier
    ..._getGcEnhancedImports(config.gcEnhanced),
    // WebGPU
    ..._getWebGPUImports(),
  }
}
