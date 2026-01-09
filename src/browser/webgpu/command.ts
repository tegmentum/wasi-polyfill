/**
 * browser:webgpu/command - GPU command encoding
 *
 * Provides functions for encoding GPU commands including render and compute passes.
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
  type CommandEncoderHandle,
  type CommandBufferHandle,
  type RenderPassEncoderHandle,
  type ComputePassEncoderHandle,
  type RenderPipelineHandle,
  type ComputePipelineHandle,
  type BindGroupHandle,
  type BufferHandle,
  type RenderPassDescriptor,
  type ComputePassDescriptor,
  type ImageCopyBuffer,
  type ImageCopyTexture,
  type CopySize,
  type IndexFormat,
  type GPUColorValue,
  type RenderCommand,
  type ComputeCommand,
  WebGPUErrorCode,
  createWebGPUError,
} from './types.js'
import { HandleTable } from './adapter.js'
import { getDefaultDeviceManager, type BrowserWebGPUDevice } from './device.js'
import { getDefaultBufferManager, type BrowserWebGPUBuffer } from './buffer.js'
import { getDefaultTextureManager, type BrowserWebGPUTexture } from './texture.js'
import { getDefaultPipelineManager, type BrowserWebGPUPipeline } from './pipeline.js'
import { getDefaultBindGroupManager, type BrowserWebGPUBindGroup } from './bind-group.js'

// =============================================================================
// Command Manager
// =============================================================================

/**
 * Browser WebGPU command manager.
 */
export class BrowserWebGPUCommand {
  private commandEncoders = new HandleTable<GPUCommandEncoder>()
  private commandBuffers = new HandleTable<GPUCommandBuffer>()
  private renderPassEncoders = new HandleTable<GPURenderPassEncoder>()
  private computePassEncoders = new HandleTable<GPUComputePassEncoder>()
  private deviceManager: BrowserWebGPUDevice
  private bufferManager: BrowserWebGPUBuffer
  private textureManager: BrowserWebGPUTexture
  private pipelineManager: BrowserWebGPUPipeline
  private bindGroupManager: BrowserWebGPUBindGroup

  constructor(
    deviceManager?: BrowserWebGPUDevice,
    bufferManager?: BrowserWebGPUBuffer,
    textureManager?: BrowserWebGPUTexture,
    pipelineManager?: BrowserWebGPUPipeline,
    bindGroupManager?: BrowserWebGPUBindGroup
  ) {
    this.deviceManager = deviceManager ?? getDefaultDeviceManager()
    this.bufferManager = bufferManager ?? getDefaultBufferManager()
    this.textureManager = textureManager ?? getDefaultTextureManager()
    this.pipelineManager = pipelineManager ?? getDefaultPipelineManager()
    this.bindGroupManager = bindGroupManager ?? getDefaultBindGroupManager()
  }

  // ===========================================================================
  // Command Encoder
  // ===========================================================================

  /**
   * Create a command encoder.
   */
  createCommandEncoder(
    deviceHandle: DeviceHandle,
    label?: string
  ): Result<CommandEncoderHandle, BrowserError> {
    const device = this.deviceManager.getNativeDevice(deviceHandle)
    if (!device) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Device not found'
      )
    }

    try {
      const descriptor: GPUCommandEncoderDescriptor = {}
      if (label) {
        descriptor.label = label
      }

      const encoder = device.createCommandEncoder(descriptor)
      return ok(this.commandEncoders.getHandle(encoder))
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to create command encoder'
      )
    }
  }

  /**
   * Finish encoding and get command buffer.
   */
  finishCommandEncoder(
    handle: CommandEncoderHandle,
    label?: string
  ): Result<CommandBufferHandle, BrowserError> {
    const encoder = this.commandEncoders.getObject(handle)
    if (!encoder) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Command encoder not found'
      )
    }

    try {
      const descriptor: GPUCommandBufferDescriptor = {}
      if (label) {
        descriptor.label = label
      }

      const commandBuffer = encoder.finish(descriptor)
      this.commandEncoders.release(handle)
      return ok(this.commandBuffers.getHandle(commandBuffer))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to finish command encoder'
      )
    }
  }

  // ===========================================================================
  // Render Pass
  // ===========================================================================

  /**
   * Begin a render pass.
   */
  beginRenderPass(
    encoderHandle: CommandEncoderHandle,
    descriptor: RenderPassDescriptor
  ): Result<RenderPassEncoderHandle, BrowserError> {
    const encoder = this.commandEncoders.getObject(encoderHandle)
    if (!encoder) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Command encoder not found'
      )
    }

    try {
      const colorAttachments: (GPURenderPassColorAttachment | null)[] = []

      for (const attachment of descriptor.colorAttachments) {
        if (attachment === null) {
          colorAttachments.push(null)
          continue
        }

        const view = this.textureManager.getNativeTextureView(attachment.view)
        if (!view) {
          return browserErr(
            BrowserErrorCode.NOT_FOUND,
            'Texture view not found for color attachment'
          )
        }

        const nativeAttachment: GPURenderPassColorAttachment = {
          view,
          loadOp: attachment.loadOp,
          storeOp: attachment.storeOp,
        }

        if (attachment.resolveTarget !== undefined) {
          const resolveView = this.textureManager.getNativeTextureView(attachment.resolveTarget)
          if (!resolveView) {
            return browserErr(
              BrowserErrorCode.NOT_FOUND,
              'Resolve texture view not found'
            )
          }
          nativeAttachment.resolveTarget = resolveView
        }

        if (attachment.clearValue !== undefined) {
          nativeAttachment.clearValue = attachment.clearValue
        }

        colorAttachments.push(nativeAttachment)
      }

      const nativeDescriptor: GPURenderPassDescriptor = {
        colorAttachments,
      }

      if (descriptor.depthStencilAttachment) {
        const depthView = this.textureManager.getNativeTextureView(descriptor.depthStencilAttachment.view)
        if (!depthView) {
          return browserErr(
            BrowserErrorCode.NOT_FOUND,
            'Depth texture view not found'
          )
        }

        nativeDescriptor.depthStencilAttachment = {
          view: depthView,
          depthClearValue: descriptor.depthStencilAttachment.depthClearValue,
          depthLoadOp: descriptor.depthStencilAttachment.depthLoadOp,
          depthStoreOp: descriptor.depthStencilAttachment.depthStoreOp,
          depthReadOnly: descriptor.depthStencilAttachment.depthReadOnly,
          stencilClearValue: descriptor.depthStencilAttachment.stencilClearValue,
          stencilLoadOp: descriptor.depthStencilAttachment.stencilLoadOp,
          stencilStoreOp: descriptor.depthStencilAttachment.stencilStoreOp,
          stencilReadOnly: descriptor.depthStencilAttachment.stencilReadOnly,
        }
      }

      if (descriptor.label) {
        nativeDescriptor.label = descriptor.label
      }

      const pass = encoder.beginRenderPass(nativeDescriptor)
      return ok(this.renderPassEncoders.getHandle(pass))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to begin render pass'
      )
    }
  }

  /**
   * End a render pass.
   */
  endRenderPass(handle: RenderPassEncoderHandle): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(handle)
    if (!pass) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Render pass not found'
      )
    }

    try {
      pass.end()
      this.renderPassEncoders.release(handle)
      return ok(undefined)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to end render pass'
      )
    }
  }

  // ===========================================================================
  // Render Pass Operations
  // ===========================================================================

  /**
   * Set render pipeline.
   */
  setRenderPipeline(
    passHandle: RenderPassEncoderHandle,
    pipelineHandle: RenderPipelineHandle
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    const pipeline = this.pipelineManager.getNativeRenderPipeline(pipelineHandle)
    if (!pipeline) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pipeline not found')
    }

    pass.setPipeline(pipeline)
    return ok(undefined)
  }

  /**
   * Set bind group for render pass.
   */
  setRenderBindGroup(
    passHandle: RenderPassEncoderHandle,
    index: number,
    bindGroupHandle: BindGroupHandle,
    dynamicOffsets?: number[]
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    const bindGroup = this.bindGroupManager.getNativeBindGroup(bindGroupHandle)
    if (!bindGroup) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Bind group not found')
    }

    if (dynamicOffsets) {
      pass.setBindGroup(index, bindGroup, dynamicOffsets)
    } else {
      pass.setBindGroup(index, bindGroup)
    }
    return ok(undefined)
  }

  /**
   * Set vertex buffer.
   */
  setVertexBuffer(
    passHandle: RenderPassEncoderHandle,
    slot: number,
    bufferHandle: BufferHandle,
    offset?: number,
    size?: number
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    const buffer = this.bufferManager.getNativeBuffer(bufferHandle)
    if (!buffer) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Buffer not found')
    }

    pass.setVertexBuffer(slot, buffer, offset, size)
    return ok(undefined)
  }

  /**
   * Set index buffer.
   */
  setIndexBuffer(
    passHandle: RenderPassEncoderHandle,
    bufferHandle: BufferHandle,
    format: IndexFormat,
    offset?: number,
    size?: number
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    const buffer = this.bufferManager.getNativeBuffer(bufferHandle)
    if (!buffer) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Buffer not found')
    }

    pass.setIndexBuffer(buffer, format, offset, size)
    return ok(undefined)
  }

  /**
   * Set viewport.
   */
  setViewport(
    passHandle: RenderPassEncoderHandle,
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    pass.setViewport(x, y, width, height, minDepth, maxDepth)
    return ok(undefined)
  }

  /**
   * Set scissor rect.
   */
  setScissorRect(
    passHandle: RenderPassEncoderHandle,
    x: number,
    y: number,
    width: number,
    height: number
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    pass.setScissorRect(x, y, width, height)
    return ok(undefined)
  }

  /**
   * Set blend constant.
   */
  setBlendConstant(
    passHandle: RenderPassEncoderHandle,
    color: GPUColorValue
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    pass.setBlendConstant(color)
    return ok(undefined)
  }

  /**
   * Set stencil reference.
   */
  setStencilReference(
    passHandle: RenderPassEncoderHandle,
    reference: number
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    pass.setStencilReference(reference)
    return ok(undefined)
  }

  /**
   * Draw.
   */
  draw(
    passHandle: RenderPassEncoderHandle,
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    pass.draw(vertexCount, instanceCount, firstVertex, firstInstance)
    return ok(undefined)
  }

  /**
   * Draw indexed.
   */
  drawIndexed(
    passHandle: RenderPassEncoderHandle,
    indexCount: number,
    instanceCount?: number,
    firstIndex?: number,
    baseVertex?: number,
    firstInstance?: number
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    pass.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance)
    return ok(undefined)
  }

  /**
   * Draw indirect.
   */
  drawIndirect(
    passHandle: RenderPassEncoderHandle,
    indirectBufferHandle: BufferHandle,
    indirectOffset: number
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    const buffer = this.bufferManager.getNativeBuffer(indirectBufferHandle)
    if (!buffer) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Indirect buffer not found')
    }

    pass.drawIndirect(buffer, indirectOffset)
    return ok(undefined)
  }

  /**
   * Draw indexed indirect.
   */
  drawIndexedIndirect(
    passHandle: RenderPassEncoderHandle,
    indirectBufferHandle: BufferHandle,
    indirectOffset: number
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    const buffer = this.bufferManager.getNativeBuffer(indirectBufferHandle)
    if (!buffer) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Indirect buffer not found')
    }

    pass.drawIndexedIndirect(buffer, indirectOffset)
    return ok(undefined)
  }

  // ===========================================================================
  // Compute Pass
  // ===========================================================================

  /**
   * Begin a compute pass.
   */
  beginComputePass(
    encoderHandle: CommandEncoderHandle,
    descriptor?: ComputePassDescriptor
  ): Result<ComputePassEncoderHandle, BrowserError> {
    const encoder = this.commandEncoders.getObject(encoderHandle)
    if (!encoder) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Command encoder not found'
      )
    }

    try {
      const nativeDescriptor: GPUComputePassDescriptor = {}
      if (descriptor?.label) {
        nativeDescriptor.label = descriptor.label
      }

      const pass = encoder.beginComputePass(nativeDescriptor)
      return ok(this.computePassEncoders.getHandle(pass))
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to begin compute pass'
      )
    }
  }

  /**
   * End a compute pass.
   */
  endComputePass(handle: ComputePassEncoderHandle): Result<void, BrowserError> {
    const pass = this.computePassEncoders.getObject(handle)
    if (!pass) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Compute pass not found'
      )
    }

    try {
      pass.end()
      this.computePassEncoders.release(handle)
      return ok(undefined)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to end compute pass'
      )
    }
  }

  // ===========================================================================
  // Compute Pass Operations
  // ===========================================================================

  /**
   * Set compute pipeline.
   */
  setComputePipeline(
    passHandle: ComputePassEncoderHandle,
    pipelineHandle: ComputePipelineHandle
  ): Result<void, BrowserError> {
    const pass = this.computePassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Compute pass not found')
    }

    const pipeline = this.pipelineManager.getNativeComputePipeline(pipelineHandle)
    if (!pipeline) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Compute pipeline not found')
    }

    pass.setPipeline(pipeline)
    return ok(undefined)
  }

  /**
   * Set bind group for compute pass.
   */
  setComputeBindGroup(
    passHandle: ComputePassEncoderHandle,
    index: number,
    bindGroupHandle: BindGroupHandle,
    dynamicOffsets?: number[]
  ): Result<void, BrowserError> {
    const pass = this.computePassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Compute pass not found')
    }

    const bindGroup = this.bindGroupManager.getNativeBindGroup(bindGroupHandle)
    if (!bindGroup) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Bind group not found')
    }

    if (dynamicOffsets) {
      pass.setBindGroup(index, bindGroup, dynamicOffsets)
    } else {
      pass.setBindGroup(index, bindGroup)
    }
    return ok(undefined)
  }

  /**
   * Dispatch workgroups.
   */
  dispatchWorkgroups(
    passHandle: ComputePassEncoderHandle,
    countX: number,
    countY?: number,
    countZ?: number
  ): Result<void, BrowserError> {
    const pass = this.computePassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Compute pass not found')
    }

    pass.dispatchWorkgroups(countX, countY, countZ)
    return ok(undefined)
  }

  /**
   * Dispatch workgroups indirect.
   */
  dispatchWorkgroupsIndirect(
    passHandle: ComputePassEncoderHandle,
    indirectBufferHandle: BufferHandle,
    indirectOffset: number
  ): Result<void, BrowserError> {
    const pass = this.computePassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Compute pass not found')
    }

    const buffer = this.bufferManager.getNativeBuffer(indirectBufferHandle)
    if (!buffer) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Indirect buffer not found')
    }

    pass.dispatchWorkgroupsIndirect(buffer, indirectOffset)
    return ok(undefined)
  }

  // ===========================================================================
  // Copy Operations
  // ===========================================================================

  /**
   * Copy buffer to buffer.
   */
  copyBufferToBuffer(
    encoderHandle: CommandEncoderHandle,
    sourceHandle: BufferHandle,
    sourceOffset: number,
    destinationHandle: BufferHandle,
    destinationOffset: number,
    size: number
  ): Result<void, BrowserError> {
    const encoder = this.commandEncoders.getObject(encoderHandle)
    if (!encoder) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Command encoder not found')
    }

    const source = this.bufferManager.getNativeBuffer(sourceHandle)
    if (!source) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Source buffer not found')
    }

    const destination = this.bufferManager.getNativeBuffer(destinationHandle)
    if (!destination) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Destination buffer not found')
    }

    encoder.copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size)
    return ok(undefined)
  }

  /**
   * Copy buffer to texture.
   */
  copyBufferToTexture(
    encoderHandle: CommandEncoderHandle,
    source: ImageCopyBuffer,
    destination: ImageCopyTexture,
    copySize: CopySize
  ): Result<void, BrowserError> {
    const encoder = this.commandEncoders.getObject(encoderHandle)
    if (!encoder) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Command encoder not found')
    }

    const buffer = this.bufferManager.getNativeBuffer(source.buffer)
    if (!buffer) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Source buffer not found')
    }

    const texture = this.textureManager.getNativeTexture(destination.texture)
    if (!texture) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Destination texture not found')
    }

    encoder.copyBufferToTexture(
      {
        buffer,
        offset: source.offset,
        bytesPerRow: source.bytesPerRow,
        rowsPerImage: source.rowsPerImage,
      },
      {
        texture,
        mipLevel: destination.mipLevel,
        origin: destination.origin,
        aspect: destination.aspect,
      },
      copySize
    )
    return ok(undefined)
  }

  /**
   * Copy texture to buffer.
   */
  copyTextureToBuffer(
    encoderHandle: CommandEncoderHandle,
    source: ImageCopyTexture,
    destination: ImageCopyBuffer,
    copySize: CopySize
  ): Result<void, BrowserError> {
    const encoder = this.commandEncoders.getObject(encoderHandle)
    if (!encoder) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Command encoder not found')
    }

    const texture = this.textureManager.getNativeTexture(source.texture)
    if (!texture) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Source texture not found')
    }

    const buffer = this.bufferManager.getNativeBuffer(destination.buffer)
    if (!buffer) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Destination buffer not found')
    }

    encoder.copyTextureToBuffer(
      {
        texture,
        mipLevel: source.mipLevel,
        origin: source.origin,
        aspect: source.aspect,
      },
      {
        buffer,
        offset: destination.offset,
        bytesPerRow: destination.bytesPerRow,
        rowsPerImage: destination.rowsPerImage,
      },
      copySize
    )
    return ok(undefined)
  }

  /**
   * Copy texture to texture.
   */
  copyTextureToTexture(
    encoderHandle: CommandEncoderHandle,
    source: ImageCopyTexture,
    destination: ImageCopyTexture,
    copySize: CopySize
  ): Result<void, BrowserError> {
    const encoder = this.commandEncoders.getObject(encoderHandle)
    if (!encoder) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Command encoder not found')
    }

    const srcTexture = this.textureManager.getNativeTexture(source.texture)
    if (!srcTexture) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Source texture not found')
    }

    const dstTexture = this.textureManager.getNativeTexture(destination.texture)
    if (!dstTexture) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Destination texture not found')
    }

    encoder.copyTextureToTexture(
      {
        texture: srcTexture,
        mipLevel: source.mipLevel,
        origin: source.origin,
        aspect: source.aspect,
      },
      {
        texture: dstTexture,
        mipLevel: destination.mipLevel,
        origin: destination.origin,
        aspect: destination.aspect,
      },
      copySize
    )
    return ok(undefined)
  }

  // ===========================================================================
  // Batched Commands
  // ===========================================================================

  /**
   * Execute batched render commands.
   */
  executeRenderCommands(
    passHandle: RenderPassEncoderHandle,
    commands: RenderCommand[]
  ): Result<void, BrowserError> {
    const pass = this.renderPassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pass not found')
    }

    for (const cmd of commands) {
      switch (cmd.type) {
        case 'set-pipeline': {
          const pipeline = this.pipelineManager.getNativeRenderPipeline(cmd.pipeline)
          if (!pipeline) {
            return browserErr(BrowserErrorCode.NOT_FOUND, 'Render pipeline not found')
          }
          pass.setPipeline(pipeline)
          break
        }

        case 'set-bind-group': {
          const bindGroup = this.bindGroupManager.getNativeBindGroup(cmd.bindGroup)
          if (!bindGroup) {
            return browserErr(BrowserErrorCode.NOT_FOUND, 'Bind group not found')
          }
          if (cmd.dynamicOffsets) {
            pass.setBindGroup(cmd.index, bindGroup, cmd.dynamicOffsets)
          } else {
            pass.setBindGroup(cmd.index, bindGroup)
          }
          break
        }

        case 'set-vertex-buffer': {
          const buffer = this.bufferManager.getNativeBuffer(cmd.buffer)
          if (!buffer) {
            return browserErr(BrowserErrorCode.NOT_FOUND, 'Buffer not found')
          }
          pass.setVertexBuffer(cmd.slot, buffer, cmd.offset, cmd.size)
          break
        }

        case 'set-index-buffer': {
          const buffer = this.bufferManager.getNativeBuffer(cmd.buffer)
          if (!buffer) {
            return browserErr(BrowserErrorCode.NOT_FOUND, 'Buffer not found')
          }
          pass.setIndexBuffer(buffer, cmd.format, cmd.offset, cmd.size)
          break
        }

        case 'set-viewport':
          pass.setViewport(cmd.x, cmd.y, cmd.width, cmd.height, cmd.minDepth, cmd.maxDepth)
          break

        case 'set-scissor-rect':
          pass.setScissorRect(cmd.x, cmd.y, cmd.width, cmd.height)
          break

        case 'set-blend-constant':
          pass.setBlendConstant(cmd.color)
          break

        case 'set-stencil-reference':
          pass.setStencilReference(cmd.reference)
          break

        case 'draw':
          pass.draw(cmd.vertexCount, cmd.instanceCount, cmd.firstVertex, cmd.firstInstance)
          break

        case 'draw-indexed':
          pass.drawIndexed(cmd.indexCount, cmd.instanceCount, cmd.firstIndex, cmd.baseVertex, cmd.firstInstance)
          break

        case 'draw-indirect': {
          const buffer = this.bufferManager.getNativeBuffer(cmd.indirectBuffer)
          if (!buffer) {
            return browserErr(BrowserErrorCode.NOT_FOUND, 'Indirect buffer not found')
          }
          pass.drawIndirect(buffer, cmd.indirectOffset)
          break
        }

        case 'draw-indexed-indirect': {
          const buffer = this.bufferManager.getNativeBuffer(cmd.indirectBuffer)
          if (!buffer) {
            return browserErr(BrowserErrorCode.NOT_FOUND, 'Indirect buffer not found')
          }
          pass.drawIndexedIndirect(buffer, cmd.indirectOffset)
          break
        }
      }
    }

    return ok(undefined)
  }

  /**
   * Execute batched compute commands.
   */
  executeComputeCommands(
    passHandle: ComputePassEncoderHandle,
    commands: ComputeCommand[]
  ): Result<void, BrowserError> {
    const pass = this.computePassEncoders.getObject(passHandle)
    if (!pass) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Compute pass not found')
    }

    for (const cmd of commands) {
      switch (cmd.type) {
        case 'set-pipeline': {
          const pipeline = this.pipelineManager.getNativeComputePipeline(cmd.pipeline)
          if (!pipeline) {
            return browserErr(BrowserErrorCode.NOT_FOUND, 'Compute pipeline not found')
          }
          pass.setPipeline(pipeline)
          break
        }

        case 'set-bind-group': {
          const bindGroup = this.bindGroupManager.getNativeBindGroup(cmd.bindGroup)
          if (!bindGroup) {
            return browserErr(BrowserErrorCode.NOT_FOUND, 'Bind group not found')
          }
          if (cmd.dynamicOffsets) {
            pass.setBindGroup(cmd.index, bindGroup, cmd.dynamicOffsets)
          } else {
            pass.setBindGroup(cmd.index, bindGroup)
          }
          break
        }

        case 'dispatch-workgroups':
          pass.dispatchWorkgroups(cmd.countX, cmd.countY, cmd.countZ)
          break

        case 'dispatch-workgroups-indirect': {
          const buffer = this.bufferManager.getNativeBuffer(cmd.indirectBuffer)
          if (!buffer) {
            return browserErr(BrowserErrorCode.NOT_FOUND, 'Indirect buffer not found')
          }
          pass.dispatchWorkgroupsIndirect(buffer, cmd.indirectOffset)
          break
        }
      }
    }

    return ok(undefined)
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  /**
   * Get the native command buffer from a handle.
   */
  getNativeCommandBuffer(handle: CommandBufferHandle): GPUCommandBuffer | null {
    return this.commandBuffers.getObject(handle)
  }

  /**
   * Release a command buffer handle.
   */
  releaseCommandBuffer(handle: CommandBufferHandle): void {
    this.commandBuffers.release(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultCommandManager: BrowserWebGPUCommand | null = null

/**
 * Get the default command manager instance.
 */
export function getDefaultCommandManager(): BrowserWebGPUCommand {
  if (!defaultCommandManager) {
    defaultCommandManager = new BrowserWebGPUCommand()
  }
  return defaultCommandManager
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/command imports object.
 */
export function getBrowserWebGPUCommandImports(): Record<string, unknown> {
  let manager: BrowserWebGPUCommand | null = null

  const getManager = (): BrowserWebGPUCommand => {
    if (!manager) {
      manager = getDefaultCommandManager()
    }
    return manager
  }

  return {
    'browser:webgpu/command': {
      'create-command-encoder': (deviceHandle: DeviceHandle, label?: string) =>
        getManager().createCommandEncoder(deviceHandle, label),
      'finish-command-encoder': (handle: CommandEncoderHandle, label?: string) =>
        getManager().finishCommandEncoder(handle, label),
      'begin-render-pass': (encoderHandle: CommandEncoderHandle, descriptor: RenderPassDescriptor) =>
        getManager().beginRenderPass(encoderHandle, descriptor),
      'end-render-pass': (handle: RenderPassEncoderHandle) =>
        getManager().endRenderPass(handle),
      'begin-compute-pass': (encoderHandle: CommandEncoderHandle, descriptor?: ComputePassDescriptor) =>
        getManager().beginComputePass(encoderHandle, descriptor),
      'end-compute-pass': (handle: ComputePassEncoderHandle) =>
        getManager().endComputePass(handle),
      'set-render-pipeline': (passHandle: RenderPassEncoderHandle, pipelineHandle: RenderPipelineHandle) =>
        getManager().setRenderPipeline(passHandle, pipelineHandle),
      'set-render-bind-group': (passHandle: RenderPassEncoderHandle, index: number, bindGroupHandle: BindGroupHandle, dynamicOffsets?: number[]) =>
        getManager().setRenderBindGroup(passHandle, index, bindGroupHandle, dynamicOffsets),
      'set-vertex-buffer': (passHandle: RenderPassEncoderHandle, slot: number, bufferHandle: BufferHandle, offset?: number, size?: number) =>
        getManager().setVertexBuffer(passHandle, slot, bufferHandle, offset, size),
      'set-index-buffer': (passHandle: RenderPassEncoderHandle, bufferHandle: BufferHandle, format: IndexFormat, offset?: number, size?: number) =>
        getManager().setIndexBuffer(passHandle, bufferHandle, format, offset, size),
      'set-viewport': (passHandle: RenderPassEncoderHandle, x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number) =>
        getManager().setViewport(passHandle, x, y, width, height, minDepth, maxDepth),
      'set-scissor-rect': (passHandle: RenderPassEncoderHandle, x: number, y: number, width: number, height: number) =>
        getManager().setScissorRect(passHandle, x, y, width, height),
      'set-blend-constant': (passHandle: RenderPassEncoderHandle, color: GPUColorValue) =>
        getManager().setBlendConstant(passHandle, color),
      'set-stencil-reference': (passHandle: RenderPassEncoderHandle, reference: number) =>
        getManager().setStencilReference(passHandle, reference),
      draw: (passHandle: RenderPassEncoderHandle, vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number) =>
        getManager().draw(passHandle, vertexCount, instanceCount, firstVertex, firstInstance),
      'draw-indexed': (passHandle: RenderPassEncoderHandle, indexCount: number, instanceCount?: number, firstIndex?: number, baseVertex?: number, firstInstance?: number) =>
        getManager().drawIndexed(passHandle, indexCount, instanceCount, firstIndex, baseVertex, firstInstance),
      'draw-indirect': (passHandle: RenderPassEncoderHandle, indirectBufferHandle: BufferHandle, indirectOffset: number) =>
        getManager().drawIndirect(passHandle, indirectBufferHandle, indirectOffset),
      'draw-indexed-indirect': (passHandle: RenderPassEncoderHandle, indirectBufferHandle: BufferHandle, indirectOffset: number) =>
        getManager().drawIndexedIndirect(passHandle, indirectBufferHandle, indirectOffset),
      'set-compute-pipeline': (passHandle: ComputePassEncoderHandle, pipelineHandle: ComputePipelineHandle) =>
        getManager().setComputePipeline(passHandle, pipelineHandle),
      'set-compute-bind-group': (passHandle: ComputePassEncoderHandle, index: number, bindGroupHandle: BindGroupHandle, dynamicOffsets?: number[]) =>
        getManager().setComputeBindGroup(passHandle, index, bindGroupHandle, dynamicOffsets),
      'dispatch-workgroups': (passHandle: ComputePassEncoderHandle, countX: number, countY?: number, countZ?: number) =>
        getManager().dispatchWorkgroups(passHandle, countX, countY, countZ),
      'dispatch-workgroups-indirect': (passHandle: ComputePassEncoderHandle, indirectBufferHandle: BufferHandle, indirectOffset: number) =>
        getManager().dispatchWorkgroupsIndirect(passHandle, indirectBufferHandle, indirectOffset),
      'copy-buffer-to-buffer': (encoderHandle: CommandEncoderHandle, sourceHandle: BufferHandle, sourceOffset: number, destinationHandle: BufferHandle, destinationOffset: number, size: number) =>
        getManager().copyBufferToBuffer(encoderHandle, sourceHandle, sourceOffset, destinationHandle, destinationOffset, size),
      'copy-buffer-to-texture': (encoderHandle: CommandEncoderHandle, source: ImageCopyBuffer, destination: ImageCopyTexture, copySize: CopySize) =>
        getManager().copyBufferToTexture(encoderHandle, source, destination, copySize),
      'copy-texture-to-buffer': (encoderHandle: CommandEncoderHandle, source: ImageCopyTexture, destination: ImageCopyBuffer, copySize: CopySize) =>
        getManager().copyTextureToBuffer(encoderHandle, source, destination, copySize),
      'copy-texture-to-texture': (encoderHandle: CommandEncoderHandle, source: ImageCopyTexture, destination: ImageCopyTexture, copySize: CopySize) =>
        getManager().copyTextureToTexture(encoderHandle, source, destination, copySize),
      'execute-render-commands': (passHandle: RenderPassEncoderHandle, commands: RenderCommand[]) =>
        getManager().executeRenderCommands(passHandle, commands),
      'execute-compute-commands': (passHandle: ComputePassEncoderHandle, commands: ComputeCommand[]) =>
        getManager().executeComputeCommands(passHandle, commands),
      'release-command-buffer': (handle: CommandBufferHandle) =>
        getManager().releaseCommandBuffer(handle),
    },
  }
}
