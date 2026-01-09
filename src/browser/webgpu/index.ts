/**
 * browser:webgpu - WebGPU interface for WASM components
 *
 * Provides a capability-scoped interface for GPU compute and rendering
 * using the WebGPU API.
 *
 * @packageDocumentation
 */

// =============================================================================
// Type Exports
// =============================================================================

export * from './types.js'

// =============================================================================
// Module Exports
// =============================================================================

export {
  BrowserWebGPUAdapter,
  getDefaultAdapterManager,
  getBrowserWebGPUAdapterImports,
  HandleTable,
} from './adapter.js'

export {
  BrowserWebGPUDevice,
  getDefaultDeviceManager,
  getBrowserWebGPUDeviceImports,
} from './device.js'

export {
  BrowserWebGPUBuffer,
  getDefaultBufferManager,
  getBrowserWebGPUBufferImports,
} from './buffer.js'

export {
  BrowserWebGPUTexture,
  getDefaultTextureManager,
  getBrowserWebGPUTextureImports,
} from './texture.js'

export {
  BrowserWebGPUSampler,
  getDefaultSamplerManager,
  getBrowserWebGPUSamplerImports,
} from './sampler.js'

export {
  BrowserWebGPUShader,
  getDefaultShaderManager,
  getBrowserWebGPUShaderImports,
} from './shader.js'

export {
  BrowserWebGPUBindGroup,
  getDefaultBindGroupManager,
  getBrowserWebGPUBindGroupImports,
} from './bind-group.js'

export {
  BrowserWebGPUPipeline,
  getDefaultPipelineManager,
  getBrowserWebGPUPipelineImports,
} from './pipeline.js'

export {
  BrowserWebGPUCommand,
  getDefaultCommandManager,
  getBrowserWebGPUCommandImports,
} from './command.js'

export {
  BrowserWebGPUQueue,
  getDefaultQueueManager,
  getBrowserWebGPUQueueImports,
} from './queue.js'

export {
  BrowserWebGPUCanvasContext,
  getDefaultCanvasContextManager,
  getBrowserWebGPUCanvasContextImports,
} from './canvas-context.js'

// =============================================================================
// Combined Imports
// =============================================================================

import { getBrowserWebGPUAdapterImports } from './adapter.js'
import { getBrowserWebGPUDeviceImports } from './device.js'
import { getBrowserWebGPUBufferImports } from './buffer.js'
import { getBrowserWebGPUTextureImports } from './texture.js'
import { getBrowserWebGPUSamplerImports } from './sampler.js'
import { getBrowserWebGPUShaderImports } from './shader.js'
import { getBrowserWebGPUBindGroupImports } from './bind-group.js'
import { getBrowserWebGPUPipelineImports } from './pipeline.js'
import { getBrowserWebGPUCommandImports } from './command.js'
import { getBrowserWebGPUQueueImports } from './queue.js'
import { getBrowserWebGPUCanvasContextImports } from './canvas-context.js'

/**
 * Get all browser:webgpu imports.
 */
export function getBrowserWebGPUImports(): Record<string, unknown> {
  return {
    ...getBrowserWebGPUAdapterImports(),
    ...getBrowserWebGPUDeviceImports(),
    ...getBrowserWebGPUBufferImports(),
    ...getBrowserWebGPUTextureImports(),
    ...getBrowserWebGPUSamplerImports(),
    ...getBrowserWebGPUShaderImports(),
    ...getBrowserWebGPUBindGroupImports(),
    ...getBrowserWebGPUPipelineImports(),
    ...getBrowserWebGPUCommandImports(),
    ...getBrowserWebGPUQueueImports(),
    ...getBrowserWebGPUCanvasContextImports(),
  }
}

// =============================================================================
// WebGPU Support Check
// =============================================================================

/**
 * Check if WebGPU is supported in the current environment.
 */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

/**
 * Get the preferred canvas format for this environment.
 */
export function getPreferredCanvasFormat(): string | null {
  if (!isWebGPUSupported()) {
    return null
  }
  return navigator.gpu.getPreferredCanvasFormat()
}
