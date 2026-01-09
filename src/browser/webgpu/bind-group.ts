/**
 * browser:webgpu/bind-group - GPU bind group operations
 *
 * Provides functions for creating bind group layouts and bind groups.
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
  type BindGroupLayoutHandle,
  type BindGroupHandle,
  type PipelineLayoutHandle,
  type BindGroupLayoutEntry,
  type BindGroupEntry,
  WebGPUErrorCode,
  createWebGPUError,
  shaderStageToNative,
} from './types.js'
import { HandleTable } from './adapter.js'
import { getDefaultDeviceManager, type BrowserWebGPUDevice } from './device.js'
import { getDefaultBufferManager, type BrowserWebGPUBuffer } from './buffer.js'
import { getDefaultSamplerManager, type BrowserWebGPUSampler } from './sampler.js'
import { getDefaultTextureManager, type BrowserWebGPUTexture } from './texture.js'

// =============================================================================
// Bind Group Manager
// =============================================================================

/**
 * Browser WebGPU bind group manager.
 */
export class BrowserWebGPUBindGroup {
  private bindGroupLayouts = new HandleTable<GPUBindGroupLayout>()
  private bindGroups = new HandleTable<GPUBindGroup>()
  private pipelineLayouts = new HandleTable<GPUPipelineLayout>()
  private deviceManager: BrowserWebGPUDevice
  private bufferManager: BrowserWebGPUBuffer
  private samplerManager: BrowserWebGPUSampler
  private textureManager: BrowserWebGPUTexture

  constructor(
    deviceManager?: BrowserWebGPUDevice,
    bufferManager?: BrowserWebGPUBuffer,
    samplerManager?: BrowserWebGPUSampler,
    textureManager?: BrowserWebGPUTexture
  ) {
    this.deviceManager = deviceManager ?? getDefaultDeviceManager()
    this.bufferManager = bufferManager ?? getDefaultBufferManager()
    this.samplerManager = samplerManager ?? getDefaultSamplerManager()
    this.textureManager = textureManager ?? getDefaultTextureManager()
  }

  /**
   * Create a bind group layout.
   */
  createBindGroupLayout(
    deviceHandle: DeviceHandle,
    entries: BindGroupLayoutEntry[],
    label?: string
  ): Result<BindGroupLayoutHandle, BrowserError> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    try {
      const nativeEntries: GPUBindGroupLayoutEntry[] = entries.map((entry) => {
        const nativeEntry: GPUBindGroupLayoutEntry = {
          binding: entry.binding,
          visibility: shaderStageToNative(entry.visibility),
        }

        if (entry.buffer) {
          nativeEntry.buffer = {
            type: entry.buffer.type,
            hasDynamicOffset: entry.buffer.hasDynamicOffset,
            minBindingSize: entry.buffer.minBindingSize,
          }
        }

        if (entry.sampler) {
          nativeEntry.sampler = {
            type: entry.sampler.type,
          }
        }

        if (entry.texture) {
          nativeEntry.texture = {
            sampleType: entry.texture.sampleType,
            viewDimension: entry.texture.viewDimension,
            multisampled: entry.texture.multisampled,
          }
        }

        if (entry.storageTexture) {
          nativeEntry.storageTexture = {
            access: entry.storageTexture.access,
            format: entry.storageTexture.format,
            viewDimension: entry.storageTexture.viewDimension,
          }
        }

        return nativeEntry
      })

      const descriptor: GPUBindGroupLayoutDescriptor = {
        entries: nativeEntries,
      }

      if (label) {
        descriptor.label = label
      }

      const layout = device.createBindGroupLayout(descriptor)
      return ok(this.bindGroupLayouts.getHandle(layout))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create bind group layout'
      )
    }
  }

  /**
   * Create a pipeline layout.
   */
  createPipelineLayout(
    deviceHandle: DeviceHandle,
    bindGroupLayoutHandles: BindGroupLayoutHandle[],
    label?: string
  ): Result<PipelineLayoutHandle, BrowserError> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    const bindGroupLayouts: GPUBindGroupLayout[] = []
    for (const handle of bindGroupLayoutHandles) {
      const layout = this.bindGroupLayouts.getObject(handle)
      if (!layout) {
        return browserErr(
          BrowserErrorCode.NOT_FOUND,
          `Bind group layout ${handle} not found`
        )
      }
      bindGroupLayouts.push(layout)
    }

    try {
      const descriptor: GPUPipelineLayoutDescriptor = {
        bindGroupLayouts,
      }

      if (label) {
        descriptor.label = label
      }

      const layout = device.createPipelineLayout(descriptor)
      return ok(this.pipelineLayouts.getHandle(layout))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create pipeline layout'
      )
    }
  }

  /**
   * Create a bind group.
   */
  createBindGroup(
    deviceHandle: DeviceHandle,
    layoutHandle: BindGroupLayoutHandle,
    entries: BindGroupEntry[],
    label?: string
  ): Result<BindGroupHandle, BrowserError> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    const layout = this.bindGroupLayouts.getObject(layoutHandle)
    if (!layout) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Bind group layout not found'
      )
    }

    try {
      const nativeEntries: GPUBindGroupEntry[] = []

      for (const entry of entries) {
        let resource: GPUBindingResource

        switch (entry.resource.type) {
          case 'buffer': {
            const buffer = this.bufferManager.getNativeBuffer(entry.resource.buffer)
            if (!buffer) {
              return browserErr(
                BrowserErrorCode.NOT_FOUND,
                `Buffer ${entry.resource.buffer} not found`
              )
            }
            resource = {
              buffer,
              offset: entry.resource.offset,
              size: entry.resource.size,
            }
            break
          }

          case 'sampler': {
            const sampler = this.samplerManager.getNativeSampler(entry.resource.sampler)
            if (!sampler) {
              return browserErr(
                BrowserErrorCode.NOT_FOUND,
                `Sampler ${entry.resource.sampler} not found`
              )
            }
            resource = sampler
            break
          }

          case 'texture-view': {
            const textureView = this.textureManager.getNativeTextureView(entry.resource.textureView)
            if (!textureView) {
              return browserErr(
                BrowserErrorCode.NOT_FOUND,
                `Texture view ${entry.resource.textureView} not found`
              )
            }
            resource = textureView
            break
          }

          default:
            return browserErr(
              BrowserErrorCode.INVALID_ARGUMENT,
              'Invalid bind group entry resource type'
            )
        }

        nativeEntries.push({
          binding: entry.binding,
          resource,
        })
      }

      const descriptor: GPUBindGroupDescriptor = {
        layout,
        entries: nativeEntries,
      }

      if (label) {
        descriptor.label = label
      }

      const bindGroup = device.createBindGroup(descriptor)
      return ok(this.bindGroups.getHandle(bindGroup))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create bind group'
      )
    }
  }

  /**
   * Get the native bind group layout from a handle.
   */
  getNativeBindGroupLayout(handle: BindGroupLayoutHandle): GPUBindGroupLayout | null {
    return this.bindGroupLayouts.getObject(handle)
  }

  /**
   * Get the native bind group from a handle.
   */
  getNativeBindGroup(handle: BindGroupHandle): GPUBindGroup | null {
    return this.bindGroups.getObject(handle)
  }

  /**
   * Get the native pipeline layout from a handle.
   */
  getNativePipelineLayout(handle: PipelineLayoutHandle): GPUPipelineLayout | null {
    return this.pipelineLayouts.getObject(handle)
  }

  /**
   * Register an external bind group layout (e.g., from pipeline).
   */
  registerBindGroupLayout(layout: GPUBindGroupLayout): BindGroupLayoutHandle {
    return this.bindGroupLayouts.getHandle(layout)
  }

  /**
   * Release a bind group layout handle.
   */
  releaseBindGroupLayout(handle: BindGroupLayoutHandle): void {
    this.bindGroupLayouts.release(handle)
  }

  /**
   * Release a bind group handle.
   */
  releaseBindGroup(handle: BindGroupHandle): void {
    this.bindGroups.release(handle)
  }

  /**
   * Release a pipeline layout handle.
   */
  releasePipelineLayout(handle: PipelineLayoutHandle): void {
    this.pipelineLayouts.release(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultBindGroupManager: BrowserWebGPUBindGroup | null = null

/**
 * Get the default bind group manager instance.
 */
export function getDefaultBindGroupManager(): BrowserWebGPUBindGroup {
  if (!defaultBindGroupManager) {
    defaultBindGroupManager = new BrowserWebGPUBindGroup()
  }
  return defaultBindGroupManager
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/bind-group imports object.
 */
export function getBrowserWebGPUBindGroupImports(): Record<string, unknown> {
  let manager: BrowserWebGPUBindGroup | null = null

  const getManager = (): BrowserWebGPUBindGroup => {
    if (!manager) {
      manager = getDefaultBindGroupManager()
    }
    return manager
  }

  return {
    'browser:webgpu/bind-group': {
      'create-bind-group-layout': (
        deviceHandle: DeviceHandle,
        entries: BindGroupLayoutEntry[],
        label?: string
      ) => getManager().createBindGroupLayout(deviceHandle, entries, label),
      'create-pipeline-layout': (
        deviceHandle: DeviceHandle,
        bindGroupLayouts: BindGroupLayoutHandle[],
        label?: string
      ) => getManager().createPipelineLayout(deviceHandle, bindGroupLayouts, label),
      'create-bind-group': (
        deviceHandle: DeviceHandle,
        layout: BindGroupLayoutHandle,
        entries: BindGroupEntry[],
        label?: string
      ) => getManager().createBindGroup(deviceHandle, layout, entries, label),
      'release-bind-group-layout': (handle: BindGroupLayoutHandle) =>
        getManager().releaseBindGroupLayout(handle),
      'release-bind-group': (handle: BindGroupHandle) =>
        getManager().releaseBindGroup(handle),
      'release-pipeline-layout': (handle: PipelineLayoutHandle) =>
        getManager().releasePipelineLayout(handle),
    },
  }
}
