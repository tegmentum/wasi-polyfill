/**
 * wasi:webgpu plugin
 *
 * Provides WebGPU interface for GPU compute and rendering,
 * wrapping the browser:webgpu implementation.
 *
 * @packageDocumentation
 */

import type { WasiPlugin, WasiInterface, Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import type {
  GpuAdapterHandle,
  GpuDeviceHandle,
  GpuQueueHandle,
  GpuBufferHandle,
  GpuTextureHandle,
  GpuTextureViewHandle,
  GpuSamplerHandle,
  GpuBindGroupLayoutHandle,
  GpuBindGroupHandle,
  GpuPipelineLayoutHandle,
  GpuShaderModuleHandle,
  GpuRenderPipelineHandle,
  GpuComputePipelineHandle,
  GpuCommandEncoderHandle,
  GpuCommandBufferHandle,
  GpuRenderPassEncoderHandle,
  GpuComputePassEncoderHandle,
  GpuRequestAdapterOptions,
  GpuDeviceDescriptor,
  GpuBufferDescriptor,
  GpuTextureDescriptor,
  GpuSamplerDescriptor,
  GpuBindGroupLayoutDescriptor,
  GpuBindGroupDescriptor,
  GpuPipelineLayoutDescriptor,
  GpuShaderModuleDescriptor,
  GpuComputePipelineDescriptor,
  GpuRenderPipelineDescriptor,
  GpuRenderPassDescriptor,
  GpuTextureFormat,
} from './types.js'

// Import browser:webgpu managers
import {
  getDefaultAdapterManager,
  getDefaultDeviceManager,
  getDefaultBufferManager,
  getDefaultTextureManager,
  getDefaultSamplerManager,
  getDefaultShaderManager,
  getDefaultBindGroupManager,
  getDefaultPipelineManager,
  getDefaultCommandManager,
  getDefaultQueueManager,
  getPreferredCanvasFormat,
} from '../../../browser/webgpu/index.js'

// =============================================================================
// Interface Definition
// =============================================================================

/**
 * WASI webgpu interface definition
 */
export const WEBGPU_INTERFACE: WasiInterface = {
  package: 'wasi:webgpu',
  name: 'webgpu',
  version: '0.0.1',
}

// =============================================================================
// Type Helpers
// =============================================================================

// Use 'any' for complex type mappings between wasi:webgpu and browser:webgpu
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

/**
 * Helper to unwrap Result types from browser:webgpu.
 */
function unwrapResult<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok) {
    const error = result.error as { message?: string } | undefined
    throw new Error(error?.message ?? 'WebGPU operation failed')
  }
  return result.value as T
}

/**
 * Helper to unwrap async Result types.
 */
async function unwrapAsync<T>(promise: Promise<{ ok: boolean; value?: T; error?: unknown }>): Promise<T> {
  const result = await promise
  return unwrapResult(result)
}

// =============================================================================
// Browser Implementation
// =============================================================================

/**
 * Create browser-based WebGPU implementation.
 * This wraps the browser:webgpu managers to provide the wasi:webgpu interface.
 */
function createBrowserImplementation(): AnyRecord {
  // Use 'any' casting to bypass strict type checking between wasi:webgpu and browser:webgpu
  // The runtime behavior is correct, but the types don't align perfectly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapterManager = getDefaultAdapterManager() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceManager = getDefaultDeviceManager() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bufferManager = getDefaultBufferManager() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textureManager = getDefaultTextureManager() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const samplerManager = getDefaultSamplerManager() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shaderManager = getDefaultShaderManager() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bindGroupManager = getDefaultBindGroupManager() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipelineManager = getDefaultPipelineManager() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commandManager = getDefaultCommandManager() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queueManager = getDefaultQueueManager() as any

  return {
    // =========================================================================
    // GPU Resource (Entry Point)
    // =========================================================================

    '[resource-new]gpu': (): number => {
      return 1 // GPU is a singleton
    },

    '[resource-drop]gpu': (): void => {
      // Nothing to drop
    },

    '[method]gpu.request-adapter': async (
      _handle: number,
      options?: GpuRequestAdapterOptions
    ): Promise<GpuAdapterHandle | null> => {
      const result = await adapterManager.requestAdapter(options as AnyRecord)
      if (!result.ok) return null
      return result.value
    },

    '[method]gpu.get-preferred-canvas-format': (): GpuTextureFormat => {
      return (getPreferredCanvasFormat() ?? 'bgra8unorm') as GpuTextureFormat
    },

    // =========================================================================
    // GPU Adapter Resource
    // =========================================================================

    '[resource-drop]gpu-adapter': (handle: GpuAdapterHandle): void => {
      adapterManager.releaseAdapter(handle)
    },

    '[method]gpu-adapter.features': (handle: GpuAdapterHandle): number => {
      return handle // Return adapter handle as features handle
    },

    '[method]gpu-adapter.limits': (handle: GpuAdapterHandle): number => {
      return handle
    },

    '[method]gpu-adapter.info': (handle: GpuAdapterHandle): number => {
      return handle
    },

    '[method]gpu-adapter.is-fallback-adapter': (handle: GpuAdapterHandle): boolean => {
      const result = adapterManager.isFallbackAdapter(handle)
      return result.ok ? result.value : false
    },

    '[method]gpu-adapter.request-device': async (
      handle: GpuAdapterHandle,
      descriptor?: GpuDeviceDescriptor
    ): Promise<{ tag: 'ok'; val: GpuDeviceHandle } | { tag: 'err'; val: unknown }> => {
      try {
        const device = await unwrapAsync(deviceManager.requestDevice(handle, descriptor as AnyRecord))
        return { tag: 'ok', val: device as GpuDeviceHandle }
      } catch {
        return { tag: 'err', val: { tag: 'none' } }
      }
    },

    // =========================================================================
    // GPU Supported Limits Resource
    // =========================================================================

    '[method]gpu-supported-limits.max-texture-dimension1-d': (handle: number): number => {
      const result = adapterManager.getAdapterLimits(handle)
      return result.ok ? (result.value['maxTextureDimension1D'] ?? 8192) : 8192
    },

    '[method]gpu-supported-limits.max-texture-dimension2-d': (handle: number): number => {
      const result = adapterManager.getAdapterLimits(handle)
      return result.ok ? (result.value['maxTextureDimension2D'] ?? 8192) : 8192
    },

    '[method]gpu-supported-limits.max-texture-dimension3-d': (handle: number): number => {
      const result = adapterManager.getAdapterLimits(handle)
      return result.ok ? (result.value['maxTextureDimension3D'] ?? 2048) : 2048
    },

    '[method]gpu-supported-limits.max-bind-groups': (handle: number): number => {
      const result = adapterManager.getAdapterLimits(handle)
      return result.ok ? (result.value['maxBindGroups'] ?? 4) : 4
    },

    // =========================================================================
    // GPU Supported Features Resource
    // =========================================================================

    '[method]gpu-supported-features.has': (handle: number, value: string): boolean => {
      const result = adapterManager.getAdapterFeatures(handle)
      if (!result.ok) return false
      return result.value.includes(value)
    },

    // =========================================================================
    // GPU Device Resource
    // =========================================================================

    '[resource-drop]gpu-device': (handle: GpuDeviceHandle): void => {
      deviceManager.destroyDevice(handle)
    },

    '[method]gpu-device.features': (handle: GpuDeviceHandle): number => {
      return handle
    },

    '[method]gpu-device.limits': (handle: GpuDeviceHandle): number => {
      return handle
    },

    '[method]gpu-device.queue': (handle: GpuDeviceHandle): GpuQueueHandle => {
      const result = deviceManager.getDeviceQueue(handle)
      return result.ok ? result.value : 0
    },

    '[method]gpu-device.destroy': (handle: GpuDeviceHandle): void => {
      deviceManager.destroyDevice(handle)
    },

    '[method]gpu-device.create-buffer': (
      handle: GpuDeviceHandle,
      descriptor: GpuBufferDescriptor
    ): GpuBufferHandle => {
      const result = bufferManager.createBuffer(handle, {
        size: Number(descriptor.size),
        usage: mapBufferUsage(descriptor.usage),
        mappedAtCreation: descriptor.mappedAtCreation,
        label: descriptor.label,
      } as AnyRecord)
      return unwrapResult(result)
    },

    '[method]gpu-device.create-texture': (
      handle: GpuDeviceHandle,
      descriptor: GpuTextureDescriptor
    ): GpuTextureHandle => {
      const result = textureManager.createTexture(handle, {
        size: descriptor.size,
        mipLevelCount: descriptor.mipLevelCount,
        sampleCount: descriptor.sampleCount,
        dimension: descriptor.dimension,
        format: descriptor.format,
        usage: mapTextureUsage(descriptor.usage),
        viewFormats: descriptor.viewFormats,
        label: descriptor.label,
      } as AnyRecord)
      return unwrapResult(result)
    },

    '[method]gpu-device.create-sampler': (
      handle: GpuDeviceHandle,
      descriptor?: GpuSamplerDescriptor
    ): GpuSamplerHandle => {
      const result = samplerManager.createSampler(handle, (descriptor ?? {}) as AnyRecord)
      return unwrapResult(result)
    },

    '[method]gpu-device.create-bind-group-layout': (
      handle: GpuDeviceHandle,
      descriptor: GpuBindGroupLayoutDescriptor
    ): GpuBindGroupLayoutHandle => {
      const result = bindGroupManager.createBindGroupLayout(handle, descriptor as AnyRecord)
      return unwrapResult(result)
    },

    '[method]gpu-device.create-pipeline-layout': (
      handle: GpuDeviceHandle,
      descriptor: GpuPipelineLayoutDescriptor
    ): GpuPipelineLayoutHandle => {
      const result = bindGroupManager.createPipelineLayout(handle, {
        bindGroupLayouts: descriptor.bindGroupLayouts.filter((l): l is number => l !== null),
        label: descriptor.label,
      } as AnyRecord)
      return unwrapResult(result)
    },

    '[method]gpu-device.create-bind-group': (
      handle: GpuDeviceHandle,
      descriptor: GpuBindGroupDescriptor
    ): GpuBindGroupHandle => {
      const result = bindGroupManager.createBindGroup(handle, {
        layout: descriptor.layout,
        entries: descriptor.entries.map(entry => ({
          binding: entry.binding,
          resource: mapBindingResource(entry.resource),
        })),
        label: descriptor.label,
      } as AnyRecord)
      return unwrapResult(result)
    },

    '[method]gpu-device.create-shader-module': (
      handle: GpuDeviceHandle,
      descriptor: GpuShaderModuleDescriptor
    ): GpuShaderModuleHandle => {
      const result = shaderManager.createShaderModule(handle, {
        code: descriptor.code,
        label: descriptor.label ?? undefined,
      } as AnyRecord)
      return unwrapResult(result)
    },

    '[method]gpu-device.create-compute-pipeline': async (
      handle: GpuDeviceHandle,
      descriptor: GpuComputePipelineDescriptor
    ): Promise<GpuComputePipelineHandle> => {
      const result = await pipelineManager.createComputePipeline(handle, {
        compute: {
          module: descriptor.compute.module,
          entryPoint: descriptor.compute.entryPoint ?? 'main',
          constants: descriptor.compute.constants,
        },
        layout: descriptor.layout.tag === 'auto' ? 'auto' : descriptor.layout.val,
        label: descriptor.label,
      } as AnyRecord)
      return unwrapResult(result)
    },

    '[method]gpu-device.create-render-pipeline': async (
      handle: GpuDeviceHandle,
      descriptor: GpuRenderPipelineDescriptor
    ): Promise<GpuRenderPipelineHandle> => {
      const result = await pipelineManager.createRenderPipeline(handle, {
        vertex: {
          module: descriptor.vertex.module,
          entryPoint: descriptor.vertex.entryPoint ?? 'main',
          constants: descriptor.vertex.constants,
          buffers: descriptor.vertex.buffers?.filter((b): b is NonNullable<typeof b> => b !== null),
        },
        primitive: descriptor.primitive,
        depthStencil: descriptor.depthStencil,
        multisample: descriptor.multisample,
        fragment: descriptor.fragment ? {
          module: descriptor.fragment.module,
          entryPoint: descriptor.fragment.entryPoint ?? 'main',
          constants: descriptor.fragment.constants,
          targets: descriptor.fragment.targets.filter((t): t is NonNullable<typeof t> => t !== null),
        } : undefined,
        layout: descriptor.layout.tag === 'auto' ? 'auto' : descriptor.layout.val,
        label: descriptor.label,
      } as AnyRecord)
      return unwrapResult(result)
    },

    '[method]gpu-device.create-command-encoder': (
      handle: GpuDeviceHandle,
      descriptor?: { label?: string }
    ): GpuCommandEncoderHandle => {
      const result = commandManager.createCommandEncoder(handle, descriptor?.label)
      return unwrapResult(result)
    },

    '[method]gpu-device.create-query-set': (
      _handle: GpuDeviceHandle,
      _descriptor: AnyRecord
    ): { tag: 'ok'; val: number } | { tag: 'err'; val: unknown } => {
      // Query sets not yet implemented
      return { tag: 'ok', val: 1 }
    },

    // =========================================================================
    // GPU Buffer Resource
    // =========================================================================

    '[resource-drop]gpu-buffer': (handle: GpuBufferHandle): void => {
      bufferManager.destroyBuffer(handle)
    },

    '[method]gpu-buffer.size': (handle: GpuBufferHandle): bigint => {
      const result = bufferManager.getBufferSize(handle)
      return BigInt(result.ok ? result.value : 0)
    },

    '[method]gpu-buffer.map-state': (handle: GpuBufferHandle): string => {
      const result = bufferManager.getBufferMapState(handle)
      return result.ok ? result.value : 'unmapped'
    },

    '[method]gpu-buffer.map-async': async (
      handle: GpuBufferHandle,
      mode: number,
      offset?: bigint,
      size?: bigint
    ): Promise<{ tag: 'ok' } | { tag: 'err'; val: unknown }> => {
      const modeStr = (mode & 1) ? 'read' : 'write'
      const result = await bufferManager.mapBuffer(
        handle,
        modeStr as 'read' | 'write',
        offset !== undefined ? Number(offset) : undefined,
        size !== undefined ? Number(size) : undefined
      )
      return result.ok ? { tag: 'ok' } : { tag: 'err', val: { tag: 'invalid-state' } }
    },

    '[method]gpu-buffer.get-mapped-range-get-with-copy': (
      handle: GpuBufferHandle,
      offset?: bigint,
      size?: bigint
    ): { tag: 'ok'; val: Uint8Array } | { tag: 'err'; val: unknown } => {
      const result = bufferManager.getMappedRange(
        handle,
        offset !== undefined ? Number(offset) : undefined,
        size !== undefined ? Number(size) : undefined
      )
      return result.ok
        ? { tag: 'ok', val: result.value }
        : { tag: 'err', val: { tag: 'invalid-state' } }
    },

    '[method]gpu-buffer.get-mapped-range-set-with-copy': (
      handle: GpuBufferHandle,
      data: Uint8Array,
      offset?: bigint
    ): { tag: 'ok' } | { tag: 'err'; val: unknown } => {
      const result = bufferManager.getMappedRange(
        handle,
        offset !== undefined ? Number(offset) : undefined,
        data.length
      )
      if (!result.ok) {
        return { tag: 'err', val: { tag: 'invalid-state' } }
      }
      result.value.set(data)
      return { tag: 'ok' }
    },

    '[method]gpu-buffer.unmap': (
      handle: GpuBufferHandle
    ): { tag: 'ok' } | { tag: 'err'; val: unknown } => {
      const result = bufferManager.unmapBuffer(handle)
      return result.ok ? { tag: 'ok' } : { tag: 'err', val: { tag: 'invalid-state' } }
    },

    '[method]gpu-buffer.destroy': (handle: GpuBufferHandle): void => {
      bufferManager.destroyBuffer(handle)
    },

    // =========================================================================
    // GPU Texture Resource
    // =========================================================================

    '[resource-drop]gpu-texture': (handle: GpuTextureHandle): void => {
      textureManager.destroyTexture(handle)
    },

    '[method]gpu-texture.create-view': (
      handle: GpuTextureHandle,
      descriptor?: AnyRecord
    ): GpuTextureViewHandle => {
      const result = textureManager.createTextureView(handle, descriptor ?? {})
      return unwrapResult(result)
    },

    '[method]gpu-texture.destroy': (handle: GpuTextureHandle): void => {
      textureManager.destroyTexture(handle)
    },

    '[method]gpu-texture.width': (handle: GpuTextureHandle): number => {
      const result = textureManager.getTextureWidth(handle)
      return result.ok ? result.value : 0
    },

    '[method]gpu-texture.height': (handle: GpuTextureHandle): number => {
      const result = textureManager.getTextureHeight(handle)
      return result.ok ? result.value : 0
    },

    '[method]gpu-texture.format': (handle: GpuTextureHandle): GpuTextureFormat => {
      const result = textureManager.getTextureFormat(handle)
      return (result.ok ? result.value : 'rgba8unorm') as GpuTextureFormat
    },

    // =========================================================================
    // GPU Command Encoder Resource
    // =========================================================================

    '[resource-drop]gpu-command-encoder': (handle: GpuCommandEncoderHandle): void => {
      // Command encoders are consumed when finished
      void handle
    },

    '[method]gpu-command-encoder.begin-render-pass': (
      handle: GpuCommandEncoderHandle,
      descriptor: GpuRenderPassDescriptor
    ): GpuRenderPassEncoderHandle => {
      const result = commandManager.beginRenderPass(handle, {
        colorAttachments: descriptor.colorAttachments
          .filter((a): a is NonNullable<typeof a> => a !== null)
          .map(a => ({
            view: a.view,
            resolveTarget: a.resolveTarget,
            clearValue: a.clearValue,
            loadOp: a.loadOp,
            storeOp: a.storeOp,
          })),
        depthStencilAttachment: descriptor.depthStencilAttachment,
        label: descriptor.label,
      } as AnyRecord)
      return unwrapResult(result)
    },

    '[method]gpu-command-encoder.begin-compute-pass': (
      handle: GpuCommandEncoderHandle,
      descriptor?: AnyRecord
    ): GpuComputePassEncoderHandle => {
      const result = commandManager.beginComputePass(handle, descriptor)
      return unwrapResult(result)
    },

    '[method]gpu-command-encoder.finish': (
      handle: GpuCommandEncoderHandle,
      descriptor?: { label?: string }
    ): GpuCommandBufferHandle => {
      const result = commandManager.finishCommandEncoder(handle, descriptor?.label)
      return unwrapResult(result)
    },

    '[method]gpu-command-encoder.copy-buffer-to-buffer': (
      handle: GpuCommandEncoderHandle,
      source: GpuBufferHandle,
      sourceOffset: bigint,
      destination: GpuBufferHandle,
      destinationOffset: bigint,
      size: bigint
    ): void => {
      commandManager.copyBufferToBuffer(
        handle,
        source,
        Number(sourceOffset),
        destination,
        Number(destinationOffset),
        Number(size)
      )
    },

    // =========================================================================
    // GPU Render Pass Encoder Resource
    // =========================================================================

    '[resource-drop]gpu-render-pass-encoder': (handle: GpuRenderPassEncoderHandle): void => {
      void handle
    },

    '[method]gpu-render-pass-encoder.set-pipeline': (
      handle: GpuRenderPassEncoderHandle,
      pipeline: GpuRenderPipelineHandle
    ): void => {
      commandManager.renderPassSetPipeline(handle, pipeline)
    },

    '[method]gpu-render-pass-encoder.set-bind-group': (
      handle: GpuRenderPassEncoderHandle,
      index: number,
      bindGroup: GpuBindGroupHandle | null,
      dynamicOffsets?: number[]
    ): { tag: 'ok' } | { tag: 'err'; val: unknown } => {
      if (bindGroup !== null) {
        commandManager.renderPassSetBindGroup(handle, index, bindGroup, dynamicOffsets)
      }
      return { tag: 'ok' }
    },

    '[method]gpu-render-pass-encoder.set-vertex-buffer': (
      handle: GpuRenderPassEncoderHandle,
      slot: number,
      buffer: GpuBufferHandle | null,
      offset?: bigint,
      size?: bigint
    ): void => {
      if (buffer !== null) {
        commandManager.renderPassSetVertexBuffer(
          handle,
          slot,
          buffer,
          offset !== undefined ? Number(offset) : undefined,
          size !== undefined ? Number(size) : undefined
        )
      }
    },

    '[method]gpu-render-pass-encoder.set-index-buffer': (
      handle: GpuRenderPassEncoderHandle,
      buffer: GpuBufferHandle,
      indexFormat: string,
      offset?: bigint,
      size?: bigint
    ): void => {
      commandManager.renderPassSetIndexBuffer(
        handle,
        buffer,
        indexFormat as 'uint16' | 'uint32',
        offset !== undefined ? Number(offset) : undefined,
        size !== undefined ? Number(size) : undefined
      )
    },

    '[method]gpu-render-pass-encoder.draw': (
      handle: GpuRenderPassEncoderHandle,
      vertexCount: number,
      instanceCount?: number,
      firstVertex?: number,
      firstInstance?: number
    ): void => {
      commandManager.renderPassDraw(handle, vertexCount, instanceCount, firstVertex, firstInstance)
    },

    '[method]gpu-render-pass-encoder.draw-indexed': (
      handle: GpuRenderPassEncoderHandle,
      indexCount: number,
      instanceCount?: number,
      firstIndex?: number,
      baseVertex?: number,
      firstInstance?: number
    ): void => {
      commandManager.renderPassDrawIndexed(
        handle,
        indexCount,
        instanceCount,
        firstIndex,
        baseVertex,
        firstInstance
      )
    },

    '[method]gpu-render-pass-encoder.end': (handle: GpuRenderPassEncoderHandle): void => {
      commandManager.endRenderPass(handle)
    },

    // =========================================================================
    // GPU Compute Pass Encoder Resource
    // =========================================================================

    '[resource-drop]gpu-compute-pass-encoder': (handle: GpuComputePassEncoderHandle): void => {
      void handle
    },

    '[method]gpu-compute-pass-encoder.set-pipeline': (
      handle: GpuComputePassEncoderHandle,
      pipeline: GpuComputePipelineHandle
    ): void => {
      commandManager.computePassSetPipeline(handle, pipeline)
    },

    '[method]gpu-compute-pass-encoder.set-bind-group': (
      handle: GpuComputePassEncoderHandle,
      index: number,
      bindGroup: GpuBindGroupHandle | null,
      dynamicOffsets?: number[]
    ): { tag: 'ok' } | { tag: 'err'; val: unknown } => {
      if (bindGroup !== null) {
        commandManager.computePassSetBindGroup(handle, index, bindGroup, dynamicOffsets)
      }
      return { tag: 'ok' }
    },

    '[method]gpu-compute-pass-encoder.dispatch-workgroups': (
      handle: GpuComputePassEncoderHandle,
      workgroupCountX: number,
      workgroupCountY?: number,
      workgroupCountZ?: number
    ): void => {
      commandManager.computePassDispatchWorkgroups(
        handle,
        workgroupCountX,
        workgroupCountY,
        workgroupCountZ
      )
    },

    '[method]gpu-compute-pass-encoder.end': (handle: GpuComputePassEncoderHandle): void => {
      commandManager.endComputePass(handle)
    },

    // =========================================================================
    // GPU Queue Resource
    // =========================================================================

    '[resource-drop]gpu-queue': (): void => {
      // Queue is managed by device
    },

    '[method]gpu-queue.submit': (
      handle: GpuQueueHandle,
      commandBuffers: GpuCommandBufferHandle[]
    ): void => {
      queueManager.submit(handle, commandBuffers)
    },

    '[method]gpu-queue.on-submitted-work-done': async (handle: GpuQueueHandle): Promise<void> => {
      await queueManager.onSubmittedWorkDone(handle)
    },

    '[method]gpu-queue.write-buffer-with-copy': (
      handle: GpuQueueHandle,
      buffer: GpuBufferHandle,
      bufferOffset: bigint,
      data: Uint8Array,
      dataOffset?: bigint,
      size?: bigint
    ): { tag: 'ok' } | { tag: 'err'; val: unknown } => {
      const result = queueManager.writeBuffer(
        handle,
        buffer,
        Number(bufferOffset),
        data,
        dataOffset !== undefined ? Number(dataOffset) : undefined,
        size !== undefined ? Number(size) : undefined
      )
      return result.ok ? { tag: 'ok' } : { tag: 'err', val: { tag: 'buffer-destroyed' } }
    },

    // =========================================================================
    // Usage Flags
    // =========================================================================

    '[static]gpu-buffer-usage.MAP-READ': (): number => 0x0001,
    '[static]gpu-buffer-usage.MAP-WRITE': (): number => 0x0002,
    '[static]gpu-buffer-usage.COPY-SRC': (): number => 0x0004,
    '[static]gpu-buffer-usage.COPY-DST': (): number => 0x0008,
    '[static]gpu-buffer-usage.INDEX': (): number => 0x0010,
    '[static]gpu-buffer-usage.VERTEX': (): number => 0x0020,
    '[static]gpu-buffer-usage.UNIFORM': (): number => 0x0040,
    '[static]gpu-buffer-usage.STORAGE': (): number => 0x0080,
    '[static]gpu-buffer-usage.INDIRECT': (): number => 0x0100,
    '[static]gpu-buffer-usage.QUERY-RESOLVE': (): number => 0x0200,

    '[static]gpu-texture-usage.COPY-SRC': (): number => 0x01,
    '[static]gpu-texture-usage.COPY-DST': (): number => 0x02,
    '[static]gpu-texture-usage.TEXTURE-BINDING': (): number => 0x04,
    '[static]gpu-texture-usage.STORAGE-BINDING': (): number => 0x08,
    '[static]gpu-texture-usage.RENDER-ATTACHMENT': (): number => 0x10,

    '[static]gpu-shader-stage.VERTEX': (): number => 0x1,
    '[static]gpu-shader-stage.FRAGMENT': (): number => 0x2,
    '[static]gpu-shader-stage.COMPUTE': (): number => 0x4,

    '[static]gpu-color-write.RED': (): number => 0x1,
    '[static]gpu-color-write.GREEN': (): number => 0x2,
    '[static]gpu-color-write.BLUE': (): number => 0x4,
    '[static]gpu-color-write.ALPHA': (): number => 0x8,
    '[static]gpu-color-write.ALL': (): number => 0xF,

    '[static]gpu-map-mode.READ': (): number => 0x1,
    '[static]gpu-map-mode.WRITE': (): number => 0x2,
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Map buffer usage flags to array format.
 */
function mapBufferUsage(usage: number): string[] {
  const flags: string[] = []
  if (usage & 0x0001) flags.push('map-read')
  if (usage & 0x0002) flags.push('map-write')
  if (usage & 0x0004) flags.push('copy-src')
  if (usage & 0x0008) flags.push('copy-dst')
  if (usage & 0x0010) flags.push('index')
  if (usage & 0x0020) flags.push('vertex')
  if (usage & 0x0040) flags.push('uniform')
  if (usage & 0x0080) flags.push('storage')
  if (usage & 0x0100) flags.push('indirect')
  if (usage & 0x0200) flags.push('query-resolve')
  return flags
}

/**
 * Map texture usage flags to array format.
 */
function mapTextureUsage(usage: number): string[] {
  const flags: string[] = []
  if (usage & 0x01) flags.push('copy-src')
  if (usage & 0x02) flags.push('copy-dst')
  if (usage & 0x04) flags.push('texture-binding')
  if (usage & 0x08) flags.push('storage-binding')
  if (usage & 0x10) flags.push('render-attachment')
  return flags
}

/**
 * Map binding resource from wasi format.
 */
function mapBindingResource(resource: { tag: string; val: unknown }): unknown {
  switch (resource.tag) {
    case 'gpu-buffer-binding':
      return { type: 'buffer', ...(resource.val as AnyRecord) }
    case 'gpu-sampler':
      return { type: 'sampler', sampler: resource.val }
    case 'gpu-texture-view':
      return { type: 'texture-view', textureView: resource.val }
    default:
      throw new Error(`Unknown binding resource type: ${resource.tag}`)
  }
}

// =============================================================================
// Implementations
// =============================================================================

/**
 * Browser-based WebGPU implementation.
 */
export const browserWebGPUImplementation: Implementation = {
  name: 'browser',
  description: 'WebGPU implementation using native browser WebGPU API',
  create(_config: PluginConfig): PluginInstance {
    const imports = createBrowserImplementation()

    return {
      getImports(): Record<string, unknown> {
        return {
          'wasi:webgpu/webgpu@0.0.1': imports,
        }
      },
      destroy(): void {
        // Cleanup handled by managers
      },
    }
  },
}

// =============================================================================
// Plugin Export
// =============================================================================

/**
 * wasi:webgpu/webgpu plugin
 *
 * Provides WebGPU interface for GPU compute and rendering.
 *
 * Implementations:
 * - browser: Uses native WebGPU via browser:webgpu (default)
 */
export const webgpuPlugin: WasiPlugin = createPlugin(
  WEBGPU_INTERFACE,
  {
    browser: browserWebGPUImplementation,
  },
  'browser'
)

/**
 * All WebGPU plugins
 */
export const webgpuPlugins: WasiPlugin[] = [
  webgpuPlugin,
]
