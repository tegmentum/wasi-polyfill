/**
 * browser:webgpu/device - GPU device management
 *
 * Provides functions for creating and managing GPU devices.
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
  type AdapterHandle,
  type DeviceHandle,
  type QueueHandle,
  type DeviceDescriptor,
  type DeviceLostInfo,
  type GPULimitsRecord,
  type GPUFeatureName,
  WebGPUErrorCode,
  createWebGPUError,
  mapGPULimits,
  featuresToArray,
  mapGPUFeatures,
} from './types.js'
import { HandleTable, getDefaultAdapterManager, type BrowserWebGPUAdapter } from './adapter.js'

// =============================================================================
// Device Manager
// =============================================================================

/**
 * Browser WebGPU device manager.
 */
export class BrowserWebGPUDevice {
  private devices = new HandleTable<GPUDevice>()
  private queues = new HandleTable<GPUQueue>()
  private deviceToQueue = new Map<DeviceHandle, QueueHandle>()
  private deviceLostPromises = new Map<DeviceHandle, Promise<GPUDeviceLostInfo>>()
  private adapterManager: BrowserWebGPUAdapter

  constructor(adapterManager?: BrowserWebGPUAdapter) {
    this.adapterManager = adapterManager ?? getDefaultAdapterManager()
  }

  /**
   * Request a device from an adapter.
   */
  async requestDevice(
    adapterHandle: AdapterHandle,
    descriptor?: DeviceDescriptor
  ): Promise<Result<DeviceHandle, BrowserError>> {
    const adapter = this.adapterManager.getNativeAdapter(adapterHandle)
    if (!adapter) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Adapter not found'
      )
    }

    try {
      const nativeDescriptor: GPUDeviceDescriptor = {}

      if (descriptor?.requiredFeatures) {
        nativeDescriptor.requiredFeatures = descriptor.requiredFeatures as GPUFeatureName[]
      }

      if (descriptor?.requiredLimits) {
        nativeDescriptor.requiredLimits = descriptor.requiredLimits
      }

      if (descriptor?.defaultQueue) {
        nativeDescriptor.defaultQueue = descriptor.defaultQueue
      }

      if (descriptor?.label) {
        nativeDescriptor.label = descriptor.label
      }

      const device = await adapter.requestDevice(nativeDescriptor)
      const deviceHandle = this.devices.getHandle(device)

      // Store the queue handle
      const queueHandle = this.queues.getHandle(device.queue)
      this.deviceToQueue.set(deviceHandle, queueHandle)

      // Store the device lost promise
      this.deviceLostPromises.set(deviceHandle, device.lost)

      return ok(deviceHandle)
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
        error instanceof Error ? error.message : 'Failed to request device'
      )
    }
  }

  /**
   * Get device features.
   */
  getDeviceFeatures(handle: DeviceHandle): Result<string[], BrowserError> {
    const device = this.devices.getObject(handle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    return ok(featuresToArray(mapGPUFeatures(device.features)))
  }

  /**
   * Get device limits.
   */
  getDeviceLimits(handle: DeviceHandle): Result<GPULimitsRecord, BrowserError> {
    const device = this.devices.getObject(handle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    return ok(mapGPULimits(device.limits))
  }

  /**
   * Get the device queue handle.
   */
  getDeviceQueue(handle: DeviceHandle): Result<QueueHandle, BrowserError> {
    const queueHandle = this.deviceToQueue.get(handle)
    if (queueHandle === undefined) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    return ok(queueHandle)
  }

  /**
   * Wait for device lost.
   */
  async waitForDeviceLost(handle: DeviceHandle): Promise<Result<DeviceLostInfo, BrowserError>> {
    const lostPromise = this.deviceLostPromises.get(handle)
    if (!lostPromise) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    const info = await lostPromise
    return ok({
      reason: info.reason as 'unknown' | 'destroyed',
      message: info.message,
    })
  }

  /**
   * Destroy a device.
   */
  destroyDevice(handle: DeviceHandle): Result<void, BrowserError> {
    const device = this.devices.getObject(handle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    device.destroy()

    // Clean up handles
    const queueHandle = this.deviceToQueue.get(handle)
    if (queueHandle !== undefined) {
      this.queues.release(queueHandle)
      this.deviceToQueue.delete(handle)
    }
    this.deviceLostPromises.delete(handle)
    this.devices.release(handle)

    return ok(undefined)
  }

  /**
   * Push error scope for validation.
   */
  pushErrorScope(handle: DeviceHandle, filter: 'validation' | 'out-of-memory' | 'internal'): Result<void, BrowserError> {
    const device = this.devices.getObject(handle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    device.pushErrorScope(filter)
    return ok(undefined)
  }

  /**
   * Pop error scope and get any error.
   */
  async popErrorScope(handle: DeviceHandle): Promise<Result<BrowserError | null, BrowserError>> {
    const device = this.devices.getObject(handle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    const error = await device.popErrorScope()
    if (!error) {
      return ok(null)
    }

    if (error instanceof GPUValidationError) {
      return ok(createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message))
    }
    if (error instanceof GPUOutOfMemoryError) {
      return ok(createWebGPUError(WebGPUErrorCode.OUT_OF_MEMORY, error.message))
    }
    if (error instanceof GPUInternalError) {
      return ok(createWebGPUError(WebGPUErrorCode.INTERNAL_ERROR, error.message))
    }

    return ok(createWebGPUError(WebGPUErrorCode.INTERNAL_ERROR, error.message))
  }

  /**
   * Get the native device from a handle.
   * Used internally by other managers.
   */
  getNativeDevice(handle: DeviceHandle): GPUDevice | null {
    return this.devices.getObject(handle)
  }

  /**
   * Get the native queue from a handle.
   * Used internally by other managers.
   */
  getNativeQueue(handle: QueueHandle): GPUQueue | null {
    return this.queues.getObject(handle)
  }

  /**
   * Release a device handle.
   */
  releaseDevice(handle: DeviceHandle): void {
    const queueHandle = this.deviceToQueue.get(handle)
    if (queueHandle !== undefined) {
      this.queues.release(queueHandle)
      this.deviceToQueue.delete(handle)
    }
    this.deviceLostPromises.delete(handle)
    this.devices.release(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultDeviceManager: BrowserWebGPUDevice | null = null

/**
 * Get the default device manager instance.
 */
export function getDefaultDeviceManager(): BrowserWebGPUDevice {
  if (!defaultDeviceManager) {
    defaultDeviceManager = new BrowserWebGPUDevice()
  }
  return defaultDeviceManager
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/device imports object.
 */
export function getBrowserWebGPUDeviceImports(): Record<string, unknown> {
  let manager: BrowserWebGPUDevice | null = null

  const getManager = (): BrowserWebGPUDevice => {
    if (!manager) {
      manager = getDefaultDeviceManager()
    }
    return manager
  }

  return {
    'browser:webgpu/device': {
      'request-device': (adapterHandle: AdapterHandle, descriptor?: DeviceDescriptor) =>
        getManager().requestDevice(adapterHandle, descriptor),
      'get-device-features': (handle: DeviceHandle) => getManager().getDeviceFeatures(handle),
      'get-device-limits': (handle: DeviceHandle) => getManager().getDeviceLimits(handle),
      'get-device-queue': (handle: DeviceHandle) => getManager().getDeviceQueue(handle),
      'wait-for-device-lost': (handle: DeviceHandle) => getManager().waitForDeviceLost(handle),
      'destroy-device': (handle: DeviceHandle) => getManager().destroyDevice(handle),
      'push-error-scope': (handle: DeviceHandle, filter: 'validation' | 'out-of-memory' | 'internal') =>
        getManager().pushErrorScope(handle, filter),
      'pop-error-scope': (handle: DeviceHandle) => getManager().popErrorScope(handle),
      'release-device': (handle: DeviceHandle) => getManager().releaseDevice(handle),
    },
  }
}
