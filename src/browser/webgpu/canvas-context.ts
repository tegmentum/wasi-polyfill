/**
 * browser:webgpu/canvas-context - GPU canvas context
 *
 * Provides functions for configuring and using GPU canvas contexts.
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
import type { CanvasHandle } from '../canvas.js'
import {
  type CanvasContextHandle,
  type DeviceHandle,
  type TextureHandle,
  type TextureFormat,
  type CanvasContextConfiguration,
  WebGPUErrorCode,
  createWebGPUError,
  textureUsageToNative,
} from './types.js'
import { HandleTable } from './adapter.js'
import { getDefaultDeviceManager, type BrowserWebGPUDevice } from './device.js'
import { getDefaultTextureManager, type BrowserWebGPUTexture } from './texture.js'

// =============================================================================
// Canvas Context Manager
// =============================================================================

/**
 * Browser WebGPU canvas context manager.
 */
export class BrowserWebGPUCanvasContext {
  private contexts = new HandleTable<GPUCanvasContext>()
  private contextToCanvas = new Map<CanvasContextHandle, CanvasHandle>()
  private contextToDevice = new Map<CanvasContextHandle, DeviceHandle>()
  private deviceManager: BrowserWebGPUDevice
  private textureManager: BrowserWebGPUTexture

  constructor(
    deviceManager?: BrowserWebGPUDevice,
    textureManager?: BrowserWebGPUTexture
  ) {
    this.deviceManager = deviceManager ?? getDefaultDeviceManager()
    this.textureManager = textureManager ?? getDefaultTextureManager()
  }

  /**
   * Get WebGPU context from a canvas element.
   */
  getContext(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    canvasHandle: CanvasHandle
  ): Result<CanvasContextHandle, BrowserError> {
    try {
      const context = canvas.getContext('webgpu') as GPUCanvasContext | null
      if (!context) {
        return browserErr(
          BrowserErrorCode.NOT_SUPPORTED,
          'WebGPU context not supported on this canvas'
        )
      }

      const handle = this.contexts.getHandle(context)
      this.contextToCanvas.set(handle, canvasHandle)
      return ok(handle)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to get WebGPU context'
      )
    }
  }

  /**
   * Configure the context.
   */
  configure(
    contextHandle: CanvasContextHandle,
    config: CanvasContextConfiguration
  ): Result<void, BrowserError> {
    const context = this.contexts.getObject(contextHandle)
    if (!context) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Canvas context not found'
      )
    }

    const device = this.deviceManager.getNativeDevice(config.device)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    try {
      const nativeConfig: GPUCanvasConfiguration = {
        device,
        format: config.format,
      }

      if (config.usage) {
        nativeConfig.usage = textureUsageToNative(config.usage)
      }

      if (config.viewFormats) {
        nativeConfig.viewFormats = config.viewFormats
      }

      if (config.colorSpace) {
        nativeConfig.colorSpace = config.colorSpace
      }

      if (config.alphaMode) {
        nativeConfig.alphaMode = config.alphaMode
      }

      context.configure(nativeConfig)
      this.contextToDevice.set(contextHandle, config.device)
      return ok(undefined)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to configure context'
      )
    }
  }

  /**
   * Unconfigure the context.
   */
  unconfigure(contextHandle: CanvasContextHandle): Result<void, BrowserError> {
    const context = this.contexts.getObject(contextHandle)
    if (!context) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Canvas context not found'
      )
    }

    try {
      context.unconfigure()
      this.contextToDevice.delete(contextHandle)
      return ok(undefined)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to unconfigure context'
      )
    }
  }

  /**
   * Get current texture for rendering.
   */
  getCurrentTexture(contextHandle: CanvasContextHandle): Result<TextureHandle, BrowserError> {
    const context = this.contexts.getObject(contextHandle)
    if (!context) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Canvas context not found'
      )
    }

    const deviceHandle = this.contextToDevice.get(contextHandle)
    if (deviceHandle === undefined) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Context not configured'
      )
    }

    try {
      const texture = context.getCurrentTexture()
      // Register the texture with the texture manager
      const handle = this.textureManager.registerTexture(texture, deviceHandle)
      return ok(handle)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('lost')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.DEVICE_LOST, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to get current texture'
      )
    }
  }

  /**
   * Get preferred format for this adapter.
   */
  getPreferredCanvasFormat(): TextureFormat {
    return navigator.gpu.getPreferredCanvasFormat() as TextureFormat
  }

  /**
   * Release a context handle.
   */
  releaseContext(handle: CanvasContextHandle): void {
    this.contextToCanvas.delete(handle)
    this.contextToDevice.delete(handle)
    this.contexts.release(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultCanvasContextManager: BrowserWebGPUCanvasContext | null = null

/**
 * Get the default canvas context manager instance.
 */
export function getDefaultCanvasContextManager(): BrowserWebGPUCanvasContext {
  if (!defaultCanvasContextManager) {
    defaultCanvasContextManager = new BrowserWebGPUCanvasContext()
  }
  return defaultCanvasContextManager
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/canvas-context imports object.
 */
export function getBrowserWebGPUCanvasContextImports(): Record<string, unknown> {
  let manager: BrowserWebGPUCanvasContext | null = null

  const getManager = (): BrowserWebGPUCanvasContext => {
    if (!manager) {
      manager = getDefaultCanvasContextManager()
    }
    return manager
  }

  return {
    'browser:webgpu/canvas-context': {
      configure: (contextHandle: CanvasContextHandle, config: CanvasContextConfiguration) =>
        getManager().configure(contextHandle, config),
      unconfigure: (contextHandle: CanvasContextHandle) =>
        getManager().unconfigure(contextHandle),
      'get-current-texture': (contextHandle: CanvasContextHandle) =>
        getManager().getCurrentTexture(contextHandle),
      'get-preferred-canvas-format': () =>
        getManager().getPreferredCanvasFormat(),
      'release-context': (handle: CanvasContextHandle) =>
        getManager().releaseContext(handle),
    },
  }
}
