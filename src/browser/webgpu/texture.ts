/**
 * browser:webgpu/texture - GPU texture operations
 *
 * Provides functions for creating and managing GPU textures.
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
  type TextureHandle,
  type TextureViewHandle,
  type TextureDescriptor,
  type TextureViewDescriptor,
  type TextureFormat,
  WebGPUErrorCode,
  createWebGPUError,
  textureUsageToNative,
} from './types.js'
import { HandleTable } from './adapter.js'
import { getDefaultDeviceManager, type BrowserWebGPUDevice } from './device.js'

// =============================================================================
// Texture Manager
// =============================================================================

/**
 * Browser WebGPU texture manager.
 */
export class BrowserWebGPUTexture {
  private textures = new HandleTable<GPUTexture>()
  private textureViews = new HandleTable<GPUTextureView>()
  private textureToDevice = new Map<TextureHandle, DeviceHandle>()
  private viewToTexture = new Map<TextureViewHandle, TextureHandle>()
  private deviceManager: BrowserWebGPUDevice

  constructor(deviceManager?: BrowserWebGPUDevice) {
    this.deviceManager = deviceManager ?? getDefaultDeviceManager()
  }

  /**
   * Create a texture.
   */
  createTexture(
    deviceHandle: DeviceHandle,
    descriptor: TextureDescriptor
  ): Result<TextureHandle, BrowserError> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    try {
      const nativeDescriptor: GPUTextureDescriptor = {
        size: {
          width: descriptor.size.width,
          height: descriptor.size.height,
          depthOrArrayLayers: descriptor.size.depthOrArrayLayers ?? 1,
        },
        format: descriptor.format,
        usage: textureUsageToNative(descriptor.usage),
      }

      if (descriptor.mipLevelCount !== undefined) {
        nativeDescriptor.mipLevelCount = descriptor.mipLevelCount
      }

      if (descriptor.sampleCount !== undefined) {
        nativeDescriptor.sampleCount = descriptor.sampleCount
      }

      if (descriptor.dimension !== undefined) {
        nativeDescriptor.dimension = descriptor.dimension
      }

      if (descriptor.viewFormats !== undefined) {
        nativeDescriptor.viewFormats = descriptor.viewFormats
      }

      if (descriptor.label) {
        nativeDescriptor.label = descriptor.label
      }

      const texture = device.createTexture(nativeDescriptor)
      const handle = this.textures.getHandle(texture)
      this.textureToDevice.set(handle, deviceHandle)

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
        error instanceof Error ? error.message : 'Failed to create texture'
      )
    }
  }

  /**
   * Create a texture view.
   */
  createTextureView(
    textureHandle: TextureHandle,
    descriptor?: TextureViewDescriptor
  ): Result<TextureViewHandle, BrowserError> {
    const texture = this.textures.getObject(textureHandle)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    try {
      let nativeDescriptor: GPUTextureViewDescriptor | undefined

      if (descriptor) {
        nativeDescriptor = {}

        if (descriptor.format !== undefined) {
          nativeDescriptor.format = descriptor.format
        }

        if (descriptor.dimension !== undefined) {
          nativeDescriptor.dimension = descriptor.dimension
        }

        if (descriptor.aspect !== undefined) {
          nativeDescriptor.aspect = descriptor.aspect
        }

        if (descriptor.baseMipLevel !== undefined) {
          nativeDescriptor.baseMipLevel = descriptor.baseMipLevel
        }

        if (descriptor.mipLevelCount !== undefined) {
          nativeDescriptor.mipLevelCount = descriptor.mipLevelCount
        }

        if (descriptor.baseArrayLayer !== undefined) {
          nativeDescriptor.baseArrayLayer = descriptor.baseArrayLayer
        }

        if (descriptor.arrayLayerCount !== undefined) {
          nativeDescriptor.arrayLayerCount = descriptor.arrayLayerCount
        }

        if (descriptor.label) {
          nativeDescriptor.label = descriptor.label
        }
      }

      const view = texture.createView(nativeDescriptor)
      const handle = this.textureViews.getHandle(view)
      this.viewToTexture.set(handle, textureHandle)

      return ok(handle)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create texture view'
      )
    }
  }

  /**
   * Get texture width.
   */
  getTextureWidth(handle: TextureHandle): Result<number, BrowserError> {
    const texture = this.textures.getObject(handle)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    return ok(texture.width)
  }

  /**
   * Get texture height.
   */
  getTextureHeight(handle: TextureHandle): Result<number, BrowserError> {
    const texture = this.textures.getObject(handle)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    return ok(texture.height)
  }

  /**
   * Get texture depth or array layers.
   */
  getTextureDepthOrArrayLayers(handle: TextureHandle): Result<number, BrowserError> {
    const texture = this.textures.getObject(handle)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    return ok(texture.depthOrArrayLayers)
  }

  /**
   * Get texture mip level count.
   */
  getTextureMipLevelCount(handle: TextureHandle): Result<number, BrowserError> {
    const texture = this.textures.getObject(handle)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    return ok(texture.mipLevelCount)
  }

  /**
   * Get texture sample count.
   */
  getTextureSampleCount(handle: TextureHandle): Result<number, BrowserError> {
    const texture = this.textures.getObject(handle)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    return ok(texture.sampleCount)
  }

  /**
   * Get texture dimension.
   */
  getTextureDimension(handle: TextureHandle): Result<string, BrowserError> {
    const texture = this.textures.getObject(handle)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    return ok(texture.dimension)
  }

  /**
   * Get texture format.
   */
  getTextureFormat(handle: TextureHandle): Result<TextureFormat, BrowserError> {
    const texture = this.textures.getObject(handle)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    return ok(texture.format as TextureFormat)
  }

  /**
   * Get texture usage.
   */
  getTextureUsage(handle: TextureHandle): Result<number, BrowserError> {
    const texture = this.textures.getObject(handle)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    return ok(texture.usage)
  }

  /**
   * Destroy texture.
   */
  destroyTexture(handle: TextureHandle): Result<void, BrowserError> {
    const texture = this.textures.getObject(handle)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    texture.destroy()
    this.textureToDevice.delete(handle)
    this.textures.release(handle)

    return ok(undefined)
  }

  /**
   * Get the native texture from a handle.
   * Used internally by other managers.
   */
  getNativeTexture(handle: TextureHandle): GPUTexture | null {
    return this.textures.getObject(handle)
  }

  /**
   * Get the native texture view from a handle.
   * Used internally by other managers.
   */
  getNativeTextureView(handle: TextureViewHandle): GPUTextureView | null {
    return this.textureViews.getObject(handle)
  }

  /**
   * Register an external texture (e.g., from canvas context).
   */
  registerTexture(texture: GPUTexture, deviceHandle: DeviceHandle): TextureHandle {
    const handle = this.textures.getHandle(texture)
    this.textureToDevice.set(handle, deviceHandle)
    return handle
  }

  /**
   * Release a texture handle.
   */
  releaseTexture(handle: TextureHandle): void {
    this.textureToDevice.delete(handle)
    this.textures.release(handle)
  }

  /**
   * Release a texture view handle.
   */
  releaseTextureView(handle: TextureViewHandle): void {
    this.viewToTexture.delete(handle)
    this.textureViews.release(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultTextureManager: BrowserWebGPUTexture | null = null

/**
 * Get the default texture manager instance.
 */
export function getDefaultTextureManager(): BrowserWebGPUTexture {
  if (!defaultTextureManager) {
    defaultTextureManager = new BrowserWebGPUTexture()
  }
  return defaultTextureManager
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/texture imports object.
 */
export function getBrowserWebGPUTextureImports(): Record<string, unknown> {
  let manager: BrowserWebGPUTexture | null = null

  const getManager = (): BrowserWebGPUTexture => {
    if (!manager) {
      manager = getDefaultTextureManager()
    }
    return manager
  }

  return {
    'browser:webgpu/texture': {
      'create-texture': (deviceHandle: DeviceHandle, descriptor: TextureDescriptor) =>
        getManager().createTexture(deviceHandle, descriptor),
      'create-texture-view': (textureHandle: TextureHandle, descriptor?: TextureViewDescriptor) =>
        getManager().createTextureView(textureHandle, descriptor),
      'get-texture-width': (handle: TextureHandle) => getManager().getTextureWidth(handle),
      'get-texture-height': (handle: TextureHandle) => getManager().getTextureHeight(handle),
      'get-texture-depth-or-array-layers': (handle: TextureHandle) => getManager().getTextureDepthOrArrayLayers(handle),
      'get-texture-mip-level-count': (handle: TextureHandle) => getManager().getTextureMipLevelCount(handle),
      'get-texture-sample-count': (handle: TextureHandle) => getManager().getTextureSampleCount(handle),
      'get-texture-dimension': (handle: TextureHandle) => getManager().getTextureDimension(handle),
      'get-texture-format': (handle: TextureHandle) => getManager().getTextureFormat(handle),
      'get-texture-usage': (handle: TextureHandle) => getManager().getTextureUsage(handle),
      'destroy-texture': (handle: TextureHandle) => getManager().destroyTexture(handle),
      'release-texture': (handle: TextureHandle) => getManager().releaseTexture(handle),
      'release-texture-view': (handle: TextureViewHandle) => getManager().releaseTextureView(handle),
    },
  }
}
