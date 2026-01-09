/**
 * browser:webgpu/shader - GPU shader module operations
 *
 * Provides functions for creating and managing GPU shader modules.
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
  type ShaderModuleHandle,
  type ShaderModuleDescriptor,
  type CompilationMessage,
  WebGPUErrorCode,
  createWebGPUError,
  mapCompilationMessage,
} from './types.js'
import { HandleTable } from './adapter.js'
import { getDefaultDeviceManager, type BrowserWebGPUDevice } from './device.js'

// =============================================================================
// Shader Manager
// =============================================================================

/**
 * Browser WebGPU shader manager.
 */
export class BrowserWebGPUShader {
  private shaders = new HandleTable<GPUShaderModule>()
  private shaderToDevice = new Map<ShaderModuleHandle, DeviceHandle>()
  private deviceManager: BrowserWebGPUDevice

  constructor(deviceManager?: BrowserWebGPUDevice) {
    this.deviceManager = deviceManager ?? getDefaultDeviceManager()
  }

  /**
   * Create a shader module from WGSL code.
   */
  createShaderModule(
    deviceHandle: DeviceHandle,
    descriptor: ShaderModuleDescriptor
  ): Result<ShaderModuleHandle, BrowserError> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    try {
      const nativeDescriptor: GPUShaderModuleDescriptor = {
        code: descriptor.code,
      }

      if (descriptor.label) {
        nativeDescriptor.label = descriptor.label
      }

      const shader = device.createShaderModule(nativeDescriptor)
      const handle = this.shaders.getHandle(shader)
      this.shaderToDevice.set(handle, deviceHandle)

      return ok(handle)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.SHADER_COMPILATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create shader module'
      )
    }
  }

  /**
   * Get compilation info (async - may need to wait for compilation).
   */
  async getCompilationInfo(
    handle: ShaderModuleHandle
  ): Promise<Result<CompilationMessage[], BrowserError>> {
    const shader = this.shaders.getObject(handle)
    if (!shader) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Shader module not found'
      )
    }

    try {
      const info = await shader.getCompilationInfo()
      const messages = info.messages.map(mapCompilationMessage)
      return ok(messages)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to get compilation info'
      )
    }
  }

  /**
   * Get the native shader module from a handle.
   * Used internally by other managers.
   */
  getNativeShaderModule(handle: ShaderModuleHandle): GPUShaderModule | null {
    return this.shaders.getObject(handle)
  }

  /**
   * Release a shader module handle.
   */
  releaseShaderModule(handle: ShaderModuleHandle): void {
    this.shaderToDevice.delete(handle)
    this.shaders.release(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultShaderManager: BrowserWebGPUShader | null = null

/**
 * Get the default shader manager instance.
 */
export function getDefaultShaderManager(): BrowserWebGPUShader {
  if (!defaultShaderManager) {
    defaultShaderManager = new BrowserWebGPUShader()
  }
  return defaultShaderManager
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/shader imports object.
 */
export function getBrowserWebGPUShaderImports(): Record<string, unknown> {
  let manager: BrowserWebGPUShader | null = null

  const getManager = (): BrowserWebGPUShader => {
    if (!manager) {
      manager = getDefaultShaderManager()
    }
    return manager
  }

  return {
    'browser:webgpu/shader': {
      'create-shader-module': (deviceHandle: DeviceHandle, descriptor: ShaderModuleDescriptor) =>
        getManager().createShaderModule(deviceHandle, descriptor),
      'get-compilation-info': (handle: ShaderModuleHandle) =>
        getManager().getCompilationInfo(handle),
      'release-shader-module': (handle: ShaderModuleHandle) =>
        getManager().releaseShaderModule(handle),
    },
  }
}
