/**
 * browser:webgpu/pipeline - GPU pipeline operations
 *
 * Provides functions for creating render and compute pipelines.
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
  type RenderPipelineHandle,
  type ComputePipelineHandle,
  type BindGroupLayoutHandle,
  type RenderPipelineDescriptor,
  type ComputePipelineDescriptor,
  WebGPUErrorCode,
  createWebGPUError,
  colorWriteToNative,
} from './types.js'
import { HandleTable } from './adapter.js'
import { getDefaultDeviceManager, type BrowserWebGPUDevice } from './device.js'
import { getDefaultShaderManager, type BrowserWebGPUShader } from './shader.js'
import { getDefaultBindGroupManager, type BrowserWebGPUBindGroup } from './bind-group.js'

// =============================================================================
// Pipeline Manager
// =============================================================================

/**
 * Browser WebGPU pipeline manager.
 */
export class BrowserWebGPUPipeline {
  private renderPipelines = new HandleTable<GPURenderPipeline>()
  private computePipelines = new HandleTable<GPUComputePipeline>()
  private deviceManager: BrowserWebGPUDevice
  private shaderManager: BrowserWebGPUShader
  private bindGroupManager: BrowserWebGPUBindGroup

  constructor(
    deviceManager?: BrowserWebGPUDevice,
    shaderManager?: BrowserWebGPUShader,
    bindGroupManager?: BrowserWebGPUBindGroup
  ) {
    this.deviceManager = deviceManager ?? getDefaultDeviceManager()
    this.shaderManager = shaderManager ?? getDefaultShaderManager()
    this.bindGroupManager = bindGroupManager ?? getDefaultBindGroupManager()
  }

  /**
   * Create a render pipeline.
   */
  async createRenderPipeline(
    deviceHandle: DeviceHandle,
    descriptor: RenderPipelineDescriptor
  ): Promise<Result<RenderPipelineHandle, BrowserError>> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    // Get vertex shader module
    const vertexModule = this.shaderManager.getNativeShaderModule(descriptor.vertex.module)
    if (!vertexModule) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Vertex shader module not found'
      )
    }

    // Get pipeline layout if not 'auto'
    let layout: GPUPipelineLayout | 'auto' = 'auto'
    if (descriptor.layout !== 'auto') {
      const pipelineLayout = this.bindGroupManager.getNativePipelineLayout(descriptor.layout)
      if (!pipelineLayout) {
        return browserErr(
          BrowserErrorCode.NOT_FOUND,
          'Pipeline layout not found'
        )
      }
      layout = pipelineLayout
    }

    try {
      const nativeDescriptor: GPURenderPipelineDescriptor = {
        layout,
        vertex: {
          module: vertexModule,
          entryPoint: descriptor.vertex.entryPoint,
        },
      }

      // Vertex buffers
      if (descriptor.vertex.buffers) {
        nativeDescriptor.vertex.buffers = descriptor.vertex.buffers.map((buffer) => ({
          arrayStride: buffer.arrayStride,
          stepMode: buffer.stepMode,
          attributes: buffer.attributes.map((attr) => ({
            format: attr.format,
            offset: attr.offset,
            shaderLocation: attr.shaderLocation,
          })),
        }))
      }

      // Vertex constants
      if (descriptor.vertex.constants) {
        nativeDescriptor.vertex.constants = descriptor.vertex.constants
      }

      // Fragment shader
      if (descriptor.fragment) {
        const fragmentModule = this.shaderManager.getNativeShaderModule(descriptor.fragment.module)
        if (!fragmentModule) {
          return browserErr(
            BrowserErrorCode.NOT_FOUND,
            'Fragment shader module not found'
          )
        }

        nativeDescriptor.fragment = {
          module: fragmentModule,
          entryPoint: descriptor.fragment.entryPoint,
          targets: descriptor.fragment.targets.map((target) => {
            const nativeTarget: GPUColorTargetState = {
              format: target.format,
            }

            if (target.blend) {
              nativeTarget.blend = {
                color: {
                  srcFactor: target.blend.color.srcFactor,
                  dstFactor: target.blend.color.dstFactor,
                  operation: target.blend.color.operation,
                },
                alpha: {
                  srcFactor: target.blend.alpha.srcFactor,
                  dstFactor: target.blend.alpha.dstFactor,
                  operation: target.blend.alpha.operation,
                },
              }
            }

            if (target.writeMask) {
              nativeTarget.writeMask = colorWriteToNative(target.writeMask)
            }

            return nativeTarget
          }),
        }

        if (descriptor.fragment.constants) {
          nativeDescriptor.fragment.constants = descriptor.fragment.constants
        }
      }

      // Primitive state
      if (descriptor.primitive) {
        nativeDescriptor.primitive = {
          topology: descriptor.primitive.topology,
          stripIndexFormat: descriptor.primitive.stripIndexFormat,
          frontFace: descriptor.primitive.frontFace,
          cullMode: descriptor.primitive.cullMode,
          unclippedDepth: descriptor.primitive.unclippedDepth,
        }
      }

      // Depth stencil state
      if (descriptor.depthStencil) {
        nativeDescriptor.depthStencil = {
          format: descriptor.depthStencil.format,
          depthWriteEnabled: descriptor.depthStencil.depthWriteEnabled,
          depthCompare: descriptor.depthStencil.depthCompare,
          stencilFront: descriptor.depthStencil.stencilFront,
          stencilBack: descriptor.depthStencil.stencilBack,
          stencilReadMask: descriptor.depthStencil.stencilReadMask,
          stencilWriteMask: descriptor.depthStencil.stencilWriteMask,
          depthBias: descriptor.depthStencil.depthBias,
          depthBiasSlopeScale: descriptor.depthStencil.depthBiasSlopeScale,
          depthBiasClamp: descriptor.depthStencil.depthBiasClamp,
        }
      }

      // Multisample state
      if (descriptor.multisample) {
        nativeDescriptor.multisample = {
          count: descriptor.multisample.count,
          mask: descriptor.multisample.mask,
          alphaToCoverageEnabled: descriptor.multisample.alphaToCoverageEnabled,
        }
      }

      // Label
      if (descriptor.label) {
        nativeDescriptor.label = descriptor.label
      }

      const pipeline = await device.createRenderPipelineAsync(nativeDescriptor)
      return ok(this.renderPipelines.getHandle(pipeline))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.PIPELINE_CREATION_ERROR, error.message) }
        }
        if (error.message.includes('shader')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.SHADER_COMPILATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create render pipeline'
      )
    }
  }

  /**
   * Create a render pipeline synchronously.
   */
  createRenderPipelineSync(
    deviceHandle: DeviceHandle,
    descriptor: RenderPipelineDescriptor
  ): Result<RenderPipelineHandle, BrowserError> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    // Get vertex shader module
    const vertexModule = this.shaderManager.getNativeShaderModule(descriptor.vertex.module)
    if (!vertexModule) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Vertex shader module not found'
      )
    }

    // Get pipeline layout if not 'auto'
    let layout: GPUPipelineLayout | 'auto' = 'auto'
    if (descriptor.layout !== 'auto') {
      const pipelineLayout = this.bindGroupManager.getNativePipelineLayout(descriptor.layout)
      if (!pipelineLayout) {
        return browserErr(
          BrowserErrorCode.NOT_FOUND,
          'Pipeline layout not found'
        )
      }
      layout = pipelineLayout
    }

    try {
      const nativeDescriptor: GPURenderPipelineDescriptor = {
        layout,
        vertex: {
          module: vertexModule,
          entryPoint: descriptor.vertex.entryPoint,
        },
      }

      // Vertex buffers
      if (descriptor.vertex.buffers) {
        nativeDescriptor.vertex.buffers = descriptor.vertex.buffers.map((buffer) => ({
          arrayStride: buffer.arrayStride,
          stepMode: buffer.stepMode,
          attributes: buffer.attributes.map((attr) => ({
            format: attr.format,
            offset: attr.offset,
            shaderLocation: attr.shaderLocation,
          })),
        }))
      }

      // Vertex constants
      if (descriptor.vertex.constants) {
        nativeDescriptor.vertex.constants = descriptor.vertex.constants
      }

      // Fragment shader
      if (descriptor.fragment) {
        const fragmentModule = this.shaderManager.getNativeShaderModule(descriptor.fragment.module)
        if (!fragmentModule) {
          return browserErr(
            BrowserErrorCode.NOT_FOUND,
            'Fragment shader module not found'
          )
        }

        nativeDescriptor.fragment = {
          module: fragmentModule,
          entryPoint: descriptor.fragment.entryPoint,
          targets: descriptor.fragment.targets.map((target) => {
            const nativeTarget: GPUColorTargetState = {
              format: target.format,
            }

            if (target.blend) {
              nativeTarget.blend = {
                color: {
                  srcFactor: target.blend.color.srcFactor,
                  dstFactor: target.blend.color.dstFactor,
                  operation: target.blend.color.operation,
                },
                alpha: {
                  srcFactor: target.blend.alpha.srcFactor,
                  dstFactor: target.blend.alpha.dstFactor,
                  operation: target.blend.alpha.operation,
                },
              }
            }

            if (target.writeMask) {
              nativeTarget.writeMask = colorWriteToNative(target.writeMask)
            }

            return nativeTarget
          }),
        }

        if (descriptor.fragment.constants) {
          nativeDescriptor.fragment.constants = descriptor.fragment.constants
        }
      }

      // Primitive state
      if (descriptor.primitive) {
        nativeDescriptor.primitive = {
          topology: descriptor.primitive.topology,
          stripIndexFormat: descriptor.primitive.stripIndexFormat,
          frontFace: descriptor.primitive.frontFace,
          cullMode: descriptor.primitive.cullMode,
          unclippedDepth: descriptor.primitive.unclippedDepth,
        }
      }

      // Depth stencil state
      if (descriptor.depthStencil) {
        nativeDescriptor.depthStencil = {
          format: descriptor.depthStencil.format,
          depthWriteEnabled: descriptor.depthStencil.depthWriteEnabled,
          depthCompare: descriptor.depthStencil.depthCompare,
          stencilFront: descriptor.depthStencil.stencilFront,
          stencilBack: descriptor.depthStencil.stencilBack,
          stencilReadMask: descriptor.depthStencil.stencilReadMask,
          stencilWriteMask: descriptor.depthStencil.stencilWriteMask,
          depthBias: descriptor.depthStencil.depthBias,
          depthBiasSlopeScale: descriptor.depthStencil.depthBiasSlopeScale,
          depthBiasClamp: descriptor.depthStencil.depthBiasClamp,
        }
      }

      // Multisample state
      if (descriptor.multisample) {
        nativeDescriptor.multisample = {
          count: descriptor.multisample.count,
          mask: descriptor.multisample.mask,
          alphaToCoverageEnabled: descriptor.multisample.alphaToCoverageEnabled,
        }
      }

      // Label
      if (descriptor.label) {
        nativeDescriptor.label = descriptor.label
      }

      const pipeline = device.createRenderPipeline(nativeDescriptor)
      return ok(this.renderPipelines.getHandle(pipeline))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.PIPELINE_CREATION_ERROR, error.message) }
        }
        if (error.message.includes('shader')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.SHADER_COMPILATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create render pipeline'
      )
    }
  }

  /**
   * Create a compute pipeline.
   */
  async createComputePipeline(
    deviceHandle: DeviceHandle,
    descriptor: ComputePipelineDescriptor
  ): Promise<Result<ComputePipelineHandle, BrowserError>> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    // Get compute shader module
    const computeModule = this.shaderManager.getNativeShaderModule(descriptor.compute.module)
    if (!computeModule) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Compute shader module not found'
      )
    }

    // Get pipeline layout if not 'auto'
    let layout: GPUPipelineLayout | 'auto' = 'auto'
    if (descriptor.layout !== 'auto') {
      const pipelineLayout = this.bindGroupManager.getNativePipelineLayout(descriptor.layout)
      if (!pipelineLayout) {
        return browserErr(
          BrowserErrorCode.NOT_FOUND,
          'Pipeline layout not found'
        )
      }
      layout = pipelineLayout
    }

    try {
      const nativeDescriptor: GPUComputePipelineDescriptor = {
        layout,
        compute: {
          module: computeModule,
          entryPoint: descriptor.compute.entryPoint,
        },
      }

      if (descriptor.compute.constants) {
        nativeDescriptor.compute.constants = descriptor.compute.constants
      }

      if (descriptor.label) {
        nativeDescriptor.label = descriptor.label
      }

      const pipeline = await device.createComputePipelineAsync(nativeDescriptor)
      return ok(this.computePipelines.getHandle(pipeline))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.PIPELINE_CREATION_ERROR, error.message) }
        }
        if (error.message.includes('shader')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.SHADER_COMPILATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create compute pipeline'
      )
    }
  }

  /**
   * Create a compute pipeline synchronously.
   */
  createComputePipelineSync(
    deviceHandle: DeviceHandle,
    descriptor: ComputePipelineDescriptor
  ): Result<ComputePipelineHandle, BrowserError> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    // Get compute shader module
    const computeModule = this.shaderManager.getNativeShaderModule(descriptor.compute.module)
    if (!computeModule) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Compute shader module not found'
      )
    }

    // Get pipeline layout if not 'auto'
    let layout: GPUPipelineLayout | 'auto' = 'auto'
    if (descriptor.layout !== 'auto') {
      const pipelineLayout = this.bindGroupManager.getNativePipelineLayout(descriptor.layout)
      if (!pipelineLayout) {
        return browserErr(
          BrowserErrorCode.NOT_FOUND,
          'Pipeline layout not found'
        )
      }
      layout = pipelineLayout
    }

    try {
      const nativeDescriptor: GPUComputePipelineDescriptor = {
        layout,
        compute: {
          module: computeModule,
          entryPoint: descriptor.compute.entryPoint,
        },
      }

      if (descriptor.compute.constants) {
        nativeDescriptor.compute.constants = descriptor.compute.constants
      }

      if (descriptor.label) {
        nativeDescriptor.label = descriptor.label
      }

      const pipeline = device.createComputePipeline(nativeDescriptor)
      return ok(this.computePipelines.getHandle(pipeline))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.PIPELINE_CREATION_ERROR, error.message) }
        }
        if (error.message.includes('shader')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.SHADER_COMPILATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create compute pipeline'
      )
    }
  }

  /**
   * Get bind group layout from a render pipeline.
   */
  getRenderPipelineBindGroupLayout(
    handle: RenderPipelineHandle,
    index: number
  ): Result<BindGroupLayoutHandle, BrowserError> {
    const pipeline = this.renderPipelines.getObject(handle)
    if (!pipeline) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Render pipeline not found'
      )
    }

    try {
      const layout = pipeline.getBindGroupLayout(index)
      return ok(this.bindGroupManager.registerBindGroupLayout(layout))
    } catch (error) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        error instanceof Error ? error.message : 'Failed to get bind group layout'
      )
    }
  }

  /**
   * Get bind group layout from a compute pipeline.
   */
  getComputePipelineBindGroupLayout(
    handle: ComputePipelineHandle,
    index: number
  ): Result<BindGroupLayoutHandle, BrowserError> {
    const pipeline = this.computePipelines.getObject(handle)
    if (!pipeline) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Compute pipeline not found'
      )
    }

    try {
      const layout = pipeline.getBindGroupLayout(index)
      return ok(this.bindGroupManager.registerBindGroupLayout(layout))
    } catch (error) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        error instanceof Error ? error.message : 'Failed to get bind group layout'
      )
    }
  }

  /**
   * Get the native render pipeline from a handle.
   */
  getNativeRenderPipeline(handle: RenderPipelineHandle): GPURenderPipeline | null {
    return this.renderPipelines.getObject(handle)
  }

  /**
   * Get the native compute pipeline from a handle.
   */
  getNativeComputePipeline(handle: ComputePipelineHandle): GPUComputePipeline | null {
    return this.computePipelines.getObject(handle)
  }

  /**
   * Release a render pipeline handle.
   */
  releaseRenderPipeline(handle: RenderPipelineHandle): void {
    this.renderPipelines.release(handle)
  }

  /**
   * Release a compute pipeline handle.
   */
  releaseComputePipeline(handle: ComputePipelineHandle): void {
    this.computePipelines.release(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultPipelineManager: BrowserWebGPUPipeline | null = null

/**
 * Get the default pipeline manager instance.
 */
export function getDefaultPipelineManager(): BrowserWebGPUPipeline {
  if (!defaultPipelineManager) {
    defaultPipelineManager = new BrowserWebGPUPipeline()
  }
  return defaultPipelineManager
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/pipeline imports object.
 */
export function getBrowserWebGPUPipelineImports(): Record<string, unknown> {
  let manager: BrowserWebGPUPipeline | null = null

  const getManager = (): BrowserWebGPUPipeline => {
    if (!manager) {
      manager = getDefaultPipelineManager()
    }
    return manager
  }

  return {
    'browser:webgpu/pipeline': {
      'create-render-pipeline': (deviceHandle: DeviceHandle, descriptor: RenderPipelineDescriptor) =>
        getManager().createRenderPipeline(deviceHandle, descriptor),
      'create-render-pipeline-sync': (deviceHandle: DeviceHandle, descriptor: RenderPipelineDescriptor) =>
        getManager().createRenderPipelineSync(deviceHandle, descriptor),
      'create-compute-pipeline': (deviceHandle: DeviceHandle, descriptor: ComputePipelineDescriptor) =>
        getManager().createComputePipeline(deviceHandle, descriptor),
      'create-compute-pipeline-sync': (deviceHandle: DeviceHandle, descriptor: ComputePipelineDescriptor) =>
        getManager().createComputePipelineSync(deviceHandle, descriptor),
      'get-render-pipeline-bind-group-layout': (handle: RenderPipelineHandle, index: number) =>
        getManager().getRenderPipelineBindGroupLayout(handle, index),
      'get-compute-pipeline-bind-group-layout': (handle: ComputePipelineHandle, index: number) =>
        getManager().getComputePipelineBindGroupLayout(handle, index),
      'release-render-pipeline': (handle: RenderPipelineHandle) =>
        getManager().releaseRenderPipeline(handle),
      'release-compute-pipeline': (handle: ComputePipelineHandle) =>
        getManager().releaseComputePipeline(handle),
    },
  }
}
