/**
 * wasi-gfx plugin collection
 *
 * Combined exports for all WASI graphics interfaces:
 * - wasi:graphics-context - Core context connecting graphics to surfaces
 * - wasi:surface - Windowing with event handling
 * - wasi:webgpu - WebGPU interface for GPU compute and rendering
 * - wasi:frame-buffer - Software rendering with frame buffers
 *
 * @packageDocumentation
 */

import type { WasiPlugin } from '../../core/types.js'

// Re-export graphics-context
export {
  // Types
  type ContextHandle,
  type AbstractBufferHandle,
  type AbstractBufferData,
  type BufferFormat,
  type GraphicsContextConfig,
  type GraphicsContext,
  // Classes
  GraphicsContextRegistry,
  // Functions
  getDefaultRegistry as getDefaultGraphicsContextRegistry,
  // Interface
  GRAPHICS_CONTEXT_INTERFACE,
  // Implementations
  defaultGraphicsContextImplementation,
  // Plugin
  graphicsContextPlugin,
  graphicsContextPlugins,
} from '../graphics-context/index.js'

// Re-export surface
export {
  // Types
  type SurfaceHandle,
  type ResizeEvent,
  type FrameEvent,
  type PointerEvent,
  type KeyEvent,
  type Key,
  type CreateDesc,
  type Surface,
  // Classes
  EventQueue,
  SurfaceRegistry,
  // Functions
  getDefaultSurfaceRegistry,
  mapDomKeyToWasiKey,
  // Interface
  SURFACE_INTERFACE,
  // Implementations
  browserSurfaceImplementation,
  headlessSurfaceImplementation,
  // Plugin
  surfacePlugin,
  surfacePlugins,
} from '../surface/index.js'

// Re-export webgpu types (subset to avoid massive re-export)
export {
  // Handle Types
  type GpuHandle,
  type GpuAdapterHandle,
  type GpuDeviceHandle,
  type GpuQueueHandle,
  type GpuBufferHandle,
  type GpuTextureHandle,
  type GpuTextureViewHandle,
  type GpuShaderModuleHandle,
  type GpuRenderPipelineHandle,
  type GpuComputePipelineHandle,
  type GpuCommandEncoderHandle,
  type GpuCommandBufferHandle,
  // Enum Types
  type GpuTextureFormat,
  type GpuPowerPreference,
  type GpuFeatureName,
  // Descriptor Types
  type GpuBufferDescriptor,
  type GpuTextureDescriptor,
  type GpuRenderPipelineDescriptor,
  type GpuComputePipelineDescriptor,
  // Interface
  WEBGPU_INTERFACE,
  // Implementations
  browserWebGPUImplementation,
  // Plugin
  webgpuPlugin,
  webgpuPlugins,
} from '../webgpu/index.js'

// Re-export frame-buffer
export {
  // Types
  type FrameBufferHandle,
  type PixelFormat,
  type FrameBufferDescriptor,
  type BlitDescriptor,
  type FrameBuffer,
  // Constants
  BYTES_PER_PIXEL,
  // Classes
  FrameBufferRegistry,
  // Functions
  getDefaultFrameBufferRegistry,
  rgbaToBgra,
  bgraToRgba,
  rgbToRgba,
  // Interface
  FRAME_BUFFER_INTERFACE,
  // Implementations
  browserCanvasImplementation,
  headlessFrameBufferImplementation,
  // Plugin
  frameBufferPlugin,
  frameBufferPlugins,
} from '../frame-buffer/index.js'

// Import all plugins for combined collection
import { graphicsContextPlugins } from '../graphics-context/index.js'
import { surfacePlugins } from '../surface/index.js'
import { webgpuPlugins } from '../webgpu/index.js'
import { frameBufferPlugins } from '../frame-buffer/index.js'

/**
 * All wasi-gfx plugins combined.
 *
 * Includes:
 * - Graphics context
 * - Surface
 * - WebGPU
 * - Frame buffer
 */
export const wasiGfxPlugins: WasiPlugin[] = [
  ...graphicsContextPlugins,
  ...surfacePlugins,
  ...webgpuPlugins,
  ...frameBufferPlugins,
]

/**
 * Default wasi-gfx configuration for browser environments.
 */
export const wasiGfxBrowserConfig = {
  graphicsContext: 'default',
  surface: 'browser',
  webgpu: 'browser',
  frameBuffer: 'browser-canvas',
} as const

/**
 * Default wasi-gfx configuration for headless/testing environments.
 */
export const wasiGfxHeadlessConfig = {
  graphicsContext: 'default',
  surface: 'headless',
  webgpu: 'browser', // WebGPU still requires browser environment
  frameBuffer: 'headless',
} as const
