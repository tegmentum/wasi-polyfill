/**
 * browser:webgpu/sampler - GPU sampler operations
 *
 * Provides functions for creating GPU samplers.
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
  type SamplerHandle,
  type SamplerDescriptor,
  WebGPUErrorCode,
  createWebGPUError,
} from './types.js'
import { HandleTable } from './adapter.js'
import { getDefaultDeviceManager, type BrowserWebGPUDevice } from './device.js'

// =============================================================================
// Sampler Manager
// =============================================================================

/**
 * Browser WebGPU sampler manager.
 */
export class BrowserWebGPUSampler {
  private samplers = new HandleTable<GPUSampler>()
  private samplerToDevice = new Map<SamplerHandle, DeviceHandle>()
  private deviceManager: BrowserWebGPUDevice

  constructor(deviceManager?: BrowserWebGPUDevice) {
    this.deviceManager = deviceManager ?? getDefaultDeviceManager()
  }

  /**
   * Create a sampler.
   */
  createSampler(
    deviceHandle: DeviceHandle,
    descriptor?: SamplerDescriptor
  ): Result<SamplerHandle, BrowserError> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    try {
      let nativeDescriptor: GPUSamplerDescriptor | undefined

      if (descriptor) {
        nativeDescriptor = {}

        if (descriptor.addressModeU !== undefined) {
          nativeDescriptor.addressModeU = descriptor.addressModeU
        }

        if (descriptor.addressModeV !== undefined) {
          nativeDescriptor.addressModeV = descriptor.addressModeV
        }

        if (descriptor.addressModeW !== undefined) {
          nativeDescriptor.addressModeW = descriptor.addressModeW
        }

        if (descriptor.magFilter !== undefined) {
          nativeDescriptor.magFilter = descriptor.magFilter
        }

        if (descriptor.minFilter !== undefined) {
          nativeDescriptor.minFilter = descriptor.minFilter
        }

        if (descriptor.mipmapFilter !== undefined) {
          nativeDescriptor.mipmapFilter = descriptor.mipmapFilter
        }

        if (descriptor.lodMinClamp !== undefined) {
          nativeDescriptor.lodMinClamp = descriptor.lodMinClamp
        }

        if (descriptor.lodMaxClamp !== undefined) {
          nativeDescriptor.lodMaxClamp = descriptor.lodMaxClamp
        }

        if (descriptor.compare !== undefined) {
          nativeDescriptor.compare = descriptor.compare
        }

        if (descriptor.maxAnisotropy !== undefined) {
          nativeDescriptor.maxAnisotropy = descriptor.maxAnisotropy
        }

        if (descriptor.label) {
          nativeDescriptor.label = descriptor.label
        }
      }

      const sampler = device.createSampler(nativeDescriptor)
      const handle = this.samplers.getHandle(sampler)
      this.samplerToDevice.set(handle, deviceHandle)

      return ok(handle)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create sampler'
      )
    }
  }

  /**
   * Get the native sampler from a handle.
   * Used internally by other managers.
   */
  getNativeSampler(handle: SamplerHandle): GPUSampler | null {
    return this.samplers.getObject(handle)
  }

  /**
   * Release a sampler handle.
   */
  releaseSampler(handle: SamplerHandle): void {
    this.samplerToDevice.delete(handle)
    this.samplers.release(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultSamplerManager: BrowserWebGPUSampler | null = null

/**
 * Get the default sampler manager instance.
 */
export function getDefaultSamplerManager(): BrowserWebGPUSampler {
  if (!defaultSamplerManager) {
    defaultSamplerManager = new BrowserWebGPUSampler()
  }
  return defaultSamplerManager
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/sampler imports object.
 */
export function getBrowserWebGPUSamplerImports(): Record<string, unknown> {
  let manager: BrowserWebGPUSampler | null = null

  const getManager = (): BrowserWebGPUSampler => {
    if (!manager) {
      manager = getDefaultSamplerManager()
    }
    return manager
  }

  return {
    'browser:webgpu/sampler': {
      'create-sampler': (deviceHandle: DeviceHandle, descriptor?: SamplerDescriptor) =>
        getManager().createSampler(deviceHandle, descriptor),
      'release-sampler': (handle: SamplerHandle) => getManager().releaseSampler(handle),
    },
  }
}
