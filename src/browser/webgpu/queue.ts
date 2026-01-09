/**
 * browser:webgpu/queue - GPU queue operations
 *
 * Provides functions for submitting commands and writing to buffers/textures.
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
  type QueueHandle,
  type CommandBufferHandle,
  type BufferHandle,
  type ImageCopyTexture,
  type CopySize,
  WebGPUErrorCode,
  createWebGPUError,
} from './types.js'
import { getDefaultDeviceManager, type BrowserWebGPUDevice } from './device.js'
import { getDefaultBufferManager, type BrowserWebGPUBuffer } from './buffer.js'
import { getDefaultTextureManager, type BrowserWebGPUTexture } from './texture.js'
import { getDefaultCommandManager, type BrowserWebGPUCommand } from './command.js'

// =============================================================================
// Queue Manager
// =============================================================================

/**
 * Browser WebGPU queue manager.
 */
export class BrowserWebGPUQueue {
  private deviceManager: BrowserWebGPUDevice
  private bufferManager: BrowserWebGPUBuffer
  private textureManager: BrowserWebGPUTexture
  private commandManager: BrowserWebGPUCommand

  constructor(
    deviceManager?: BrowserWebGPUDevice,
    bufferManager?: BrowserWebGPUBuffer,
    textureManager?: BrowserWebGPUTexture,
    commandManager?: BrowserWebGPUCommand
  ) {
    this.deviceManager = deviceManager ?? getDefaultDeviceManager()
    this.bufferManager = bufferManager ?? getDefaultBufferManager()
    this.textureManager = textureManager ?? getDefaultTextureManager()
    this.commandManager = commandManager ?? getDefaultCommandManager()
  }

  /**
   * Submit command buffers.
   */
  submit(
    queueHandle: QueueHandle,
    commandBufferHandles: CommandBufferHandle[]
  ): Result<void, BrowserError> {
    const queue = this.deviceManager.getNativeQueue(queueHandle)
    if (!queue) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Queue not found'
      )
    }

    const commandBuffers: GPUCommandBuffer[] = []
    for (const handle of commandBufferHandles) {
      const buffer = this.commandManager.getNativeCommandBuffer(handle)
      if (!buffer) {
        return browserErr(
          BrowserErrorCode.NOT_FOUND,
          `Command buffer ${handle} not found`
        )
      }
      commandBuffers.push(buffer)
    }

    try {
      queue.submit(commandBuffers)

      // Release command buffer handles after submission
      for (const handle of commandBufferHandles) {
        this.commandManager.releaseCommandBuffer(handle)
      }

      return ok(undefined)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to submit commands'
      )
    }
  }

  /**
   * Wait for all submitted work to complete.
   */
  async onSubmittedWorkDone(queueHandle: QueueHandle): Promise<Result<void, BrowserError>> {
    const queue = this.deviceManager.getNativeQueue(queueHandle)
    if (!queue) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Queue not found'
      )
    }

    try {
      await queue.onSubmittedWorkDone()
      return ok(undefined)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to wait for submitted work'
      )
    }
  }

  /**
   * Write to buffer (convenience method).
   */
  writeBuffer(
    queueHandle: QueueHandle,
    bufferHandle: BufferHandle,
    bufferOffset: number,
    data: Uint8Array,
    dataOffset?: number,
    size?: number
  ): Result<void, BrowserError> {
    const queue = this.deviceManager.getNativeQueue(queueHandle)
    if (!queue) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Queue not found'
      )
    }

    const buffer = this.bufferManager.getNativeBuffer(bufferHandle)
    if (!buffer) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Buffer not found'
      )
    }

    try {
      queue.writeBuffer(buffer, bufferOffset, data, dataOffset, size)
      return ok(undefined)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to write buffer'
      )
    }
  }

  /**
   * Write to texture (convenience method).
   */
  writeTexture(
    queueHandle: QueueHandle,
    destination: ImageCopyTexture,
    data: Uint8Array,
    dataLayout: { offset?: number; bytesPerRow: number; rowsPerImage?: number },
    size: CopySize
  ): Result<void, BrowserError> {
    const queue = this.deviceManager.getNativeQueue(queueHandle)
    if (!queue) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Queue not found'
      )
    }

    const texture = this.textureManager.getNativeTexture(destination.texture)
    if (!texture) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Texture not found'
      )
    }

    try {
      queue.writeTexture(
        {
          texture,
          mipLevel: destination.mipLevel,
          origin: destination.origin,
          aspect: destination.aspect,
        },
        data,
        dataLayout,
        size
      )
      return ok(undefined)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          return { ok: false, error: createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, error.message) }
        }
      }
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to write texture'
      )
    }
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultQueueManager: BrowserWebGPUQueue | null = null

/**
 * Get the default queue manager instance.
 */
export function getDefaultQueueManager(): BrowserWebGPUQueue {
  if (!defaultQueueManager) {
    defaultQueueManager = new BrowserWebGPUQueue()
  }
  return defaultQueueManager
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/queue imports object.
 */
export function getBrowserWebGPUQueueImports(): Record<string, unknown> {
  let manager: BrowserWebGPUQueue | null = null

  const getManager = (): BrowserWebGPUQueue => {
    if (!manager) {
      manager = getDefaultQueueManager()
    }
    return manager
  }

  return {
    'browser:webgpu/queue': {
      submit: (queueHandle: QueueHandle, commandBuffers: CommandBufferHandle[]) =>
        getManager().submit(queueHandle, commandBuffers),
      'on-submitted-work-done': (queueHandle: QueueHandle) =>
        getManager().onSubmittedWorkDone(queueHandle),
      'write-buffer': (queueHandle: QueueHandle, bufferHandle: BufferHandle, bufferOffset: number, data: Uint8Array, dataOffset?: number, size?: number) =>
        getManager().writeBuffer(queueHandle, bufferHandle, bufferOffset, data, dataOffset, size),
      'write-texture': (queueHandle: QueueHandle, destination: ImageCopyTexture, data: Uint8Array, dataLayout: { offset?: number; bytesPerRow: number; rowsPerImage?: number }, size: CopySize) =>
        getManager().writeTexture(queueHandle, destination, data, dataLayout, size),
    },
  }
}
