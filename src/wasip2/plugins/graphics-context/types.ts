/**
 * wasi:graphics-context types
 *
 * Core types for the graphics context interface that connects
 * graphics APIs (webgpu or frame-buffer) to surfaces.
 *
 * @packageDocumentation
 */

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle to a graphics context resource.
 */
export type ContextHandle = number

/**
 * Handle to an abstract buffer resource.
 */
export type AbstractBufferHandle = number

// =============================================================================
// Buffer Types
// =============================================================================

/**
 * Abstract buffer data - can be backed by different implementations.
 */
export interface AbstractBufferData {
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
  /** Pixel format */
  format: BufferFormat
  /** The actual buffer data (may be lazy) */
  data?: Uint8Array | ArrayBuffer
  /** Native texture handle (for WebGPU) */
  nativeTexture?: unknown
  /** Canvas context (for canvas-based implementations) */
  canvasContext?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
}

/**
 * Buffer pixel format.
 */
export type BufferFormat =
  | 'rgba8unorm'
  | 'bgra8unorm'
  | 'rgba8unorm-srgb'
  | 'bgra8unorm-srgb'

// =============================================================================
// Context Configuration
// =============================================================================

/**
 * Graphics context configuration.
 */
export interface GraphicsContextConfig {
  /** Initial width */
  width?: number
  /** Initial height */
  height?: number
  /** Preferred buffer format */
  format?: BufferFormat
  /** Enable alpha channel */
  alpha?: boolean
}

// =============================================================================
// Resource Registry
// =============================================================================

/**
 * Registry for managing graphics context resources.
 */
export class GraphicsContextRegistry {
  private contexts = new Map<ContextHandle, GraphicsContext>()
  private buffers = new Map<AbstractBufferHandle, AbstractBufferData>()
  private nextContextHandle = 1
  private nextBufferHandle = 1

  /**
   * Create a new context.
   */
  createContext(config?: GraphicsContextConfig): ContextHandle {
    const handle = this.nextContextHandle++
    const context: GraphicsContext = {
      handle,
      config: config ?? {},
      currentBuffer: null,
      connected: false,
    }
    this.contexts.set(handle, context)
    return handle
  }

  /**
   * Get a context by handle.
   */
  getContext(handle: ContextHandle): GraphicsContext | undefined {
    return this.contexts.get(handle)
  }

  /**
   * Delete a context.
   */
  deleteContext(handle: ContextHandle): boolean {
    return this.contexts.delete(handle)
  }

  /**
   * Create an abstract buffer.
   */
  createBuffer(data: AbstractBufferData): AbstractBufferHandle {
    const handle = this.nextBufferHandle++
    this.buffers.set(handle, data)
    return handle
  }

  /**
   * Get a buffer by handle.
   */
  getBuffer(handle: AbstractBufferHandle): AbstractBufferData | undefined {
    return this.buffers.get(handle)
  }

  /**
   * Delete a buffer.
   */
  deleteBuffer(handle: AbstractBufferHandle): boolean {
    return this.buffers.delete(handle)
  }

  /**
   * Set the current buffer for a context.
   */
  setCurrentBuffer(contextHandle: ContextHandle, bufferHandle: AbstractBufferHandle): void {
    const context = this.contexts.get(contextHandle)
    if (context) {
      context.currentBuffer = bufferHandle
    }
  }

  /**
   * Get the current buffer for a context.
   */
  getCurrentBuffer(contextHandle: ContextHandle): AbstractBufferHandle | null {
    const context = this.contexts.get(contextHandle)
    return context?.currentBuffer ?? null
  }
}

/**
 * Graphics context state.
 */
export interface GraphicsContext {
  handle: ContextHandle
  config: GraphicsContextConfig
  currentBuffer: AbstractBufferHandle | null
  connected: boolean
}

// =============================================================================
// Default Registry
// =============================================================================

let defaultRegistry: GraphicsContextRegistry | null = null

/**
 * Get the default graphics context registry.
 */
export function getDefaultRegistry(): GraphicsContextRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new GraphicsContextRegistry()
  }
  return defaultRegistry
}
