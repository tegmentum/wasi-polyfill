/**
 * wasi:frame-buffer types
 *
 * Types for frame buffer management with software rendering support.
 *
 * @packageDocumentation
 */

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle to a frame buffer resource.
 */
export type FrameBufferHandle = number

// =============================================================================
// Format Types
// =============================================================================

/**
 * Pixel format for frame buffers.
 */
export type PixelFormat =
  | 'rgba8'
  | 'bgra8'
  | 'rgb8'
  | 'bgr8'
  | 'rgba16'
  | 'rgb565'
  | 'rgba5551'
  | 'rgba4444'

/**
 * Bytes per pixel for each format.
 */
export const BYTES_PER_PIXEL: Record<PixelFormat, number> = {
  'rgba8': 4,
  'bgra8': 4,
  'rgb8': 3,
  'bgr8': 3,
  'rgba16': 8,
  'rgb565': 2,
  'rgba5551': 2,
  'rgba4444': 2,
}

// =============================================================================
// Descriptor Types
// =============================================================================

/**
 * Frame buffer creation descriptor.
 */
export interface FrameBufferDescriptor {
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
  /** Pixel format (default: rgba8) */
  format?: PixelFormat
  /** Initial data to copy */
  data?: Uint8Array
}

/**
 * Blit (copy) region descriptor.
 */
export interface BlitDescriptor {
  /** Source x coordinate */
  srcX: number
  /** Source y coordinate */
  srcY: number
  /** Destination x coordinate */
  dstX: number
  /** Destination y coordinate */
  dstY: number
  /** Width of region to copy */
  width: number
  /** Height of region to copy */
  height: number
}

// =============================================================================
// Frame Buffer State
// =============================================================================

/**
 * Internal frame buffer state.
 */
export interface FrameBuffer {
  /** Unique handle */
  handle: FrameBufferHandle
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
  /** Pixel format */
  format: PixelFormat
  /** Pixel data */
  data: Uint8Array
  /** Optional canvas for browser implementation */
  canvas?: HTMLCanvasElement | OffscreenCanvas
  /** Optional 2D context */
  context?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  /** Image data for canvas operations */
  imageData?: ImageData
  /** Dirty flag for optimized present */
  dirty: boolean
}

// =============================================================================
// Frame Buffer Registry
// =============================================================================

/**
 * Registry for managing frame buffer resources.
 */
export class FrameBufferRegistry {
  private buffers = new Map<FrameBufferHandle, FrameBuffer>()
  private nextHandle = 1

  /**
   * Create a new frame buffer.
   */
  createBuffer(descriptor: FrameBufferDescriptor): FrameBufferHandle {
    const handle = this.nextHandle++
    const format = descriptor.format ?? 'rgba8'
    const bytesPerPixel = BYTES_PER_PIXEL[format]
    const dataSize = descriptor.width * descriptor.height * bytesPerPixel

    const buffer: FrameBuffer = {
      handle,
      width: descriptor.width,
      height: descriptor.height,
      format,
      data: descriptor.data
        ? new Uint8Array(descriptor.data)
        : new Uint8Array(dataSize),
      dirty: true,
    }

    this.buffers.set(handle, buffer)
    return handle
  }

  /**
   * Get a buffer by handle.
   */
  getBuffer(handle: FrameBufferHandle): FrameBuffer | undefined {
    return this.buffers.get(handle)
  }

  /**
   * Delete a buffer.
   */
  deleteBuffer(handle: FrameBufferHandle): boolean {
    const buffer = this.buffers.get(handle)
    if (buffer?.canvas && 'remove' in buffer.canvas) {
      (buffer.canvas as HTMLCanvasElement).remove()
    }
    return this.buffers.delete(handle)
  }

  /**
   * Get pixel at coordinates.
   */
  getPixel(handle: FrameBufferHandle, x: number, y: number): Uint8Array | null {
    const buffer = this.buffers.get(handle)
    if (!buffer) return null

    if (x < 0 || x >= buffer.width || y < 0 || y >= buffer.height) {
      return null
    }

    const bytesPerPixel = BYTES_PER_PIXEL[buffer.format]
    const offset = (y * buffer.width + x) * bytesPerPixel
    return buffer.data.slice(offset, offset + bytesPerPixel)
  }

  /**
   * Set pixel at coordinates.
   */
  setPixel(handle: FrameBufferHandle, x: number, y: number, color: Uint8Array): boolean {
    const buffer = this.buffers.get(handle)
    if (!buffer) return false

    if (x < 0 || x >= buffer.width || y < 0 || y >= buffer.height) {
      return false
    }

    const bytesPerPixel = BYTES_PER_PIXEL[buffer.format]
    const offset = (y * buffer.width + x) * bytesPerPixel
    buffer.data.set(color.slice(0, bytesPerPixel), offset)
    buffer.dirty = true
    return true
  }

  /**
   * Fill a rectangular region with a color.
   */
  fillRect(
    handle: FrameBufferHandle,
    x: number,
    y: number,
    width: number,
    height: number,
    color: Uint8Array
  ): boolean {
    const buffer = this.buffers.get(handle)
    if (!buffer) return false

    const bytesPerPixel = BYTES_PER_PIXEL[buffer.format]
    const colorBytes = color.slice(0, bytesPerPixel)

    for (let row = y; row < y + height && row < buffer.height; row++) {
      if (row < 0) continue
      for (let col = x; col < x + width && col < buffer.width; col++) {
        if (col < 0) continue
        const offset = (row * buffer.width + col) * bytesPerPixel
        buffer.data.set(colorBytes, offset)
      }
    }

    buffer.dirty = true
    return true
  }

  /**
   * Copy a region within the same buffer.
   */
  blit(handle: FrameBufferHandle, desc: BlitDescriptor): boolean {
    const buffer = this.buffers.get(handle)
    if (!buffer) return false

    const bytesPerPixel = BYTES_PER_PIXEL[buffer.format]
    const rowSize = desc.width * bytesPerPixel

    // Use temporary storage to handle overlapping regions
    const tempRows: Uint8Array[] = []
    for (let row = 0; row < desc.height; row++) {
      const srcY = desc.srcY + row
      if (srcY < 0 || srcY >= buffer.height) continue

      const srcOffset = (srcY * buffer.width + desc.srcX) * bytesPerPixel
      const srcEnd = Math.min(srcOffset + rowSize, buffer.data.length)
      tempRows[row] = buffer.data.slice(srcOffset, srcEnd)
    }

    // Copy to destination
    for (let row = 0; row < desc.height; row++) {
      const dstY = desc.dstY + row
      if (dstY < 0 || dstY >= buffer.height) continue
      if (!tempRows[row]) continue

      const dstOffset = (dstY * buffer.width + desc.dstX) * bytesPerPixel
      buffer.data.set(tempRows[row]!, dstOffset)
    }

    buffer.dirty = true
    return true
  }

  /**
   * Copy data from one buffer to another.
   */
  copyBuffer(
    srcHandle: FrameBufferHandle,
    dstHandle: FrameBufferHandle,
    desc?: BlitDescriptor
  ): boolean {
    const src = this.buffers.get(srcHandle)
    const dst = this.buffers.get(dstHandle)
    if (!src || !dst) return false

    if (!desc) {
      // Full buffer copy
      if (src.width !== dst.width || src.height !== dst.height || src.format !== dst.format) {
        return false
      }
      dst.data.set(src.data)
    } else {
      // Partial copy
      const bytesPerPixel = BYTES_PER_PIXEL[src.format]
      for (let row = 0; row < desc.height; row++) {
        const srcY = desc.srcY + row
        const dstY = desc.dstY + row
        if (srcY < 0 || srcY >= src.height || dstY < 0 || dstY >= dst.height) continue

        const srcOffset = (srcY * src.width + desc.srcX) * bytesPerPixel
        const dstOffset = (dstY * dst.width + desc.dstX) * bytesPerPixel
        const copyWidth = Math.min(desc.width, src.width - desc.srcX, dst.width - desc.dstX)
        const rowBytes = copyWidth * bytesPerPixel

        dst.data.set(src.data.slice(srcOffset, srcOffset + rowBytes), dstOffset)
      }
    }

    dst.dirty = true
    return true
  }

  /**
   * Clear a buffer to a specific color.
   */
  clear(handle: FrameBufferHandle, color?: Uint8Array): boolean {
    const buffer = this.buffers.get(handle)
    if (!buffer) return false

    if (!color) {
      buffer.data.fill(0)
    } else {
      const bytesPerPixel = BYTES_PER_PIXEL[buffer.format]
      const colorBytes = color.slice(0, bytesPerPixel)
      const pixelCount = buffer.width * buffer.height

      for (let i = 0; i < pixelCount; i++) {
        buffer.data.set(colorBytes, i * bytesPerPixel)
      }
    }

    buffer.dirty = true
    return true
  }

  /**
   * Get raw data bytes.
   */
  getData(handle: FrameBufferHandle): Uint8Array | null {
    const buffer = this.buffers.get(handle)
    return buffer?.data ?? null
  }

  /**
   * Set raw data bytes.
   */
  setData(handle: FrameBufferHandle, data: Uint8Array): boolean {
    const buffer = this.buffers.get(handle)
    if (!buffer) return false

    const bytesPerPixel = BYTES_PER_PIXEL[buffer.format]
    const expectedSize = buffer.width * buffer.height * bytesPerPixel

    if (data.length !== expectedSize) {
      return false
    }

    buffer.data.set(data)
    buffer.dirty = true
    return true
  }
}

// =============================================================================
// Format Conversion Utilities
// =============================================================================

/**
 * Convert RGBA8 to BGRA8.
 */
export function rgbaToBgra(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i += 4) {
    result[i] = data[i + 2]!     // B <- R
    result[i + 1] = data[i + 1]! // G
    result[i + 2] = data[i]!     // R <- B
    result[i + 3] = data[i + 3]! // A
  }
  return result
}

/**
 * Convert BGRA8 to RGBA8.
 */
export function bgraToRgba(data: Uint8Array): Uint8Array {
  return rgbaToBgra(data) // Same swap operation
}

/**
 * Convert RGB8 to RGBA8.
 */
export function rgbToRgba(data: Uint8Array): Uint8Array {
  const pixelCount = data.length / 3
  const result = new Uint8Array(pixelCount * 4)
  for (let i = 0; i < pixelCount; i++) {
    result[i * 4] = data[i * 3]!
    result[i * 4 + 1] = data[i * 3 + 1]!
    result[i * 4 + 2] = data[i * 3 + 2]!
    result[i * 4 + 3] = 255
  }
  return result
}

// =============================================================================
// Default Registry
// =============================================================================

let defaultRegistry: FrameBufferRegistry | null = null

/**
 * Get the default frame buffer registry.
 */
export function getDefaultFrameBufferRegistry(): FrameBufferRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new FrameBufferRegistry()
  }
  return defaultRegistry
}
