/**
 * browser:webgpu/buffer - GPU buffer operations
 *
 * Provides functions for creating and managing GPU buffers.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  type Result,
  ok,
  browserErr,
} from '../types.js'
import {
  type DeviceHandle,
  type BufferHandle,
  type BufferDescriptor,
  type BufferMapMode,
  WebGPUErrorCode,
  createWebGPUError,
  bufferUsageToNative,
} from './types.js'
import { HandleTable } from './adapter.js'
import { getDefaultDeviceManager, type BrowserWebGPUDevice } from './device.js'

// =============================================================================
// Buffer Manager
// =============================================================================

/**
 * Browser WebGPU buffer manager.
 */
export class BrowserWebGPUBuffer {
  private buffers = new HandleTable<GPUBuffer>()
  private bufferToDevice = new Map<BufferHandle, DeviceHandle>()
  private deviceManager: BrowserWebGPUDevice

  constructor(deviceManager?: BrowserWebGPUDevice) {
    this.deviceManager = deviceManager ?? getDefaultDeviceManager()
  }

  /**
   * Create a buffer.
   */
  createBuffer(
    deviceHandle: DeviceHandle,
    descriptor: BufferDescriptor
  ): Result<BufferHandle, BrowserError> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    try {
      const nativeDescriptor: GPUBufferDescriptor = {
        size: descriptor.size,
        usage: bufferUsageToNative(descriptor.usage),
      }

      if (descriptor.mappedAtCreation !== undefined) {
        nativeDescriptor.mappedAtCreation = descriptor.mappedAtCreation
      }

      if (descriptor.label) {
        nativeDescriptor.label = descriptor.label
      }

      const buffer = device.createBuffer(nativeDescriptor)
      const handle = this.buffers.getHandle(buffer)
      this.bufferToDevice.set(handle, deviceHandle)

      return ok(handle)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('out of memory')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.OUT_OF_MEMORY, error.message) }
        }
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create buffer'
      )
    }
  }

  /**
   * Map buffer for CPU access.
   */
  async mapBuffer(
    handle: BufferHandle,
    mode: BufferMapMode,
    offset?: number,
    size?: number
  ): Promise<Result<void, BrowserError>> {
    const buffer = this.buffers.getObject(handle)
    if (!buffer) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Buffer not found'
      )
    }

    try {
      const mapMode = mode === 'read' ? GPUMapMode.READ : GPUMapMode.WRITE
      await buffer.mapAsync(mapMode, offset, size)
      return ok(undefined)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to map buffer'
      )
    }
  }

  /**
   * Get mapped range as bytes.
   */
  getMappedRange(
    handle: BufferHandle,
    offset?: number,
    size?: number
  ): Result<Uint8Array, BrowserError> {
    const buffer = this.buffers.getObject(handle)
    if (!buffer) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Buffer not found'
      )
    }

    try {
      const arrayBuffer = buffer.getMappedRange(offset, size)
      return ok(new Uint8Array(arrayBuffer))
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to get mapped range'
      )
    }
  }

  /**
   * Unmap buffer.
   */
  unmapBuffer(handle: BufferHandle): Result<void, BrowserError> {
    const buffer = this.buffers.getObject(handle)
    if (!buffer) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Buffer not found'
      )
    }

    try {
      buffer.unmap()
      return ok(undefined)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to unmap buffer'
      )
    }
  }

  /**
   * Get buffer size.
   */
  getBufferSize(handle: BufferHandle): Result<number, BrowserError> {
    const buffer = this.buffers.getObject(handle)
    if (!buffer) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Buffer not found'
      )
    }

    return ok(buffer.size)
  }

  /**
   * Get buffer usage flags.
   */
  getBufferUsage(handle: BufferHandle): Result<number, BrowserError> {
    const buffer = this.buffers.getObject(handle)
    if (!buffer) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Buffer not found'
      )
    }

    return ok(buffer.usage)
  }

  /**
   * Get buffer map state.
   */
  getBufferMapState(handle: BufferHandle): Result<'unmapped' | 'pending' | 'mapped', BrowserError> {
    const buffer = this.buffers.getObject(handle)
    if (!buffer) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Buffer not found'
      )
    }

    return ok(buffer.mapState)
  }

  /**
   * Destroy buffer.
   */
  destroyBuffer(handle: BufferHandle): Result<void, BrowserError> {
    const buffer = this.buffers.getObject(handle)
    if (!buffer) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Buffer not found'
      )
    }

    buffer.destroy()
    this.bufferToDevice.delete(handle)
    this.buffers.release(handle)

    return ok(undefined)
  }

  /**
   * Get the native buffer from a handle.
   * Used internally by other managers.
   */
  getNativeBuffer(handle: BufferHandle): GPUBuffer | null {
    return this.buffers.getObject(handle)
  }

  /**
   * Release a buffer handle.
   */
  releaseBuffer(handle: BufferHandle): void {
    this.bufferToDevice.delete(handle)
    this.buffers.release(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultBufferManager: BrowserWebGPUBuffer | null = null

/**
 * Get the default buffer manager instance.
 */
export function getDefaultBufferManager(): BrowserWebGPUBuffer {
  if (!defaultBufferManager) {
    defaultBufferManager = new BrowserWebGPUBuffer()
  }
  return defaultBufferManager
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/buffer imports object.
 */
export function getBrowserWebGPUBufferImports(): Record<string, unknown> {
  let manager: BrowserWebGPUBuffer | null = null

  const getManager = (): BrowserWebGPUBuffer => {
    if (!manager) {
      manager = getDefaultBufferManager()
    }
    return manager
  }

  return {
    'browser:webgpu/buffer': {
      'create-buffer': (deviceHandle: DeviceHandle, descriptor: BufferDescriptor) =>
        getManager().createBuffer(deviceHandle, descriptor),
      'map-buffer': (handle: BufferHandle, mode: BufferMapMode, offset?: number, size?: number) =>
        getManager().mapBuffer(handle, mode, offset, size),
      'get-mapped-range': (handle: BufferHandle, offset?: number, size?: number) =>
        getManager().getMappedRange(handle, offset, size),
      'unmap-buffer': (handle: BufferHandle) => getManager().unmapBuffer(handle),
      'get-buffer-size': (handle: BufferHandle) => getManager().getBufferSize(handle),
      'get-buffer-usage': (handle: BufferHandle) => getManager().getBufferUsage(handle),
      'get-buffer-map-state': (handle: BufferHandle) => getManager().getBufferMapState(handle),
      'destroy-buffer': (handle: BufferHandle) => getManager().destroyBuffer(handle),
      'release-buffer': (handle: BufferHandle) => getManager().releaseBuffer(handle),
    },
  }
}
