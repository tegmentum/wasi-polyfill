/**
 * browser:webgpu/types - WebGPU type definitions
 *
 * Provides type definitions for the WebGPU interface including
 * handle types, error codes, limits, features, and descriptors.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  createBrowserError,
} from '../types.js'

// =============================================================================
// Handle Types
// =============================================================================

/** Handle to a GPU adapter */
export type AdapterHandle = number

/** Handle to a GPU device */
export type DeviceHandle = number

/** Handle to a GPU queue */
export type QueueHandle = number

/** Handle to a GPU buffer */
export type BufferHandle = number

/** Handle to a GPU texture */
export type TextureHandle = number

/** Handle to a GPU texture view */
export type TextureViewHandle = number

/** Handle to a GPU sampler */
export type SamplerHandle = number

/** Handle to a GPU shader module */
export type ShaderModuleHandle = number

/** Handle to a GPU bind group layout */
export type BindGroupLayoutHandle = number

/** Handle to a GPU bind group */
export type BindGroupHandle = number

/** Handle to a GPU pipeline layout */
export type PipelineLayoutHandle = number

/** Handle to a GPU render pipeline */
export type RenderPipelineHandle = number

/** Handle to a GPU compute pipeline */
export type ComputePipelineHandle = number

/** Handle to a GPU command encoder */
export type CommandEncoderHandle = number

/** Handle to a GPU render pass encoder */
export type RenderPassEncoderHandle = number

/** Handle to a GPU compute pass encoder */
export type ComputePassEncoderHandle = number

/** Handle to a GPU command buffer */
export type CommandBufferHandle = number

/** Handle to a GPU query set */
export type QuerySetHandle = number

/** Handle to a GPU canvas context */
export type CanvasContextHandle = number

// =============================================================================
// Error Codes
// =============================================================================

/**
 * WebGPU-specific error codes.
 */
export enum WebGPUErrorCode {
  // Inherit from BrowserErrorCode
  DENIED = 'denied',
  NOT_SUPPORTED = 'not-supported',
  INVALID_ARGUMENT = 'invalid-argument',
  NOT_FOUND = 'not-found',

  // WebGPU-specific
  ADAPTER_NOT_FOUND = 'adapter-not-found',
  DEVICE_LOST = 'device-lost',
  OUT_OF_MEMORY = 'out-of-memory',
  VALIDATION_ERROR = 'validation-error',
  INTERNAL_ERROR = 'internal-error',
  SHADER_COMPILATION_ERROR = 'shader-compilation-error',
  PIPELINE_CREATION_ERROR = 'pipeline-creation-error',
}

/**
 * Create a WebGPU error.
 */
export function createWebGPUError(
  code: WebGPUErrorCode | BrowserErrorCode,
  message: string,
  details?: unknown
): BrowserError {
  return createBrowserError(code as BrowserErrorCode, message, details)
}

/**
 * Map a GPUError to a BrowserError.
 */
export function mapGPUError(error: GPUError): BrowserError {
  if (error instanceof GPUValidationError) {
    return createWebGPUError(
      WebGPUErrorCode.VALIDATION_ERROR,
      error.message
    )
  }
  if (error instanceof GPUOutOfMemoryError) {
    return createWebGPUError(
      WebGPUErrorCode.OUT_OF_MEMORY,
      error.message
    )
  }
  if (error instanceof GPUInternalError) {
    return createWebGPUError(
      WebGPUErrorCode.INTERNAL_ERROR,
      error.message
    )
  }
  return createWebGPUError(
    WebGPUErrorCode.INTERNAL_ERROR,
    error.message
  )
}

// =============================================================================
// GPU Limits
// =============================================================================

/**
 * GPU device limits.
 */
export interface GPULimitsRecord {
  maxTextureDimension1D: number
  maxTextureDimension2D: number
  maxTextureDimension3D: number
  maxTextureArrayLayers: number
  maxBindGroups: number
  maxBindGroupsPlusVertexBuffers: number
  maxBindingsPerBindGroup: number
  maxDynamicUniformBuffersPerPipelineLayout: number
  maxDynamicStorageBuffersPerPipelineLayout: number
  maxSampledTexturesPerShaderStage: number
  maxSamplersPerShaderStage: number
  maxStorageBuffersPerShaderStage: number
  maxStorageTexturesPerShaderStage: number
  maxUniformBuffersPerShaderStage: number
  maxUniformBufferBindingSize: number
  maxStorageBufferBindingSize: number
  maxVertexBuffers: number
  maxBufferSize: number
  maxVertexAttributes: number
  maxVertexBufferArrayStride: number
  maxInterStageShaderComponents: number
  maxInterStageShaderVariables: number
  maxColorAttachments: number
  maxColorAttachmentBytesPerSample: number
  maxComputeWorkgroupStorageSize: number
  maxComputeInvocationsPerWorkgroup: number
  maxComputeWorkgroupSizeX: number
  maxComputeWorkgroupSizeY: number
  maxComputeWorkgroupSizeZ: number
  maxComputeWorkgroupsPerDimension: number
}

/**
 * Convert native GPUSupportedLimits to our type.
 */
export function mapGPULimits(limits: GPUSupportedLimits): GPULimitsRecord {
  return {
    maxTextureDimension1D: limits.maxTextureDimension1D,
    maxTextureDimension2D: limits.maxTextureDimension2D,
    maxTextureDimension3D: limits.maxTextureDimension3D,
    maxTextureArrayLayers: limits.maxTextureArrayLayers,
    maxBindGroups: limits.maxBindGroups,
    maxBindGroupsPlusVertexBuffers: limits.maxBindGroupsPlusVertexBuffers,
    maxBindingsPerBindGroup: limits.maxBindingsPerBindGroup,
    maxDynamicUniformBuffersPerPipelineLayout: limits.maxDynamicUniformBuffersPerPipelineLayout,
    maxDynamicStorageBuffersPerPipelineLayout: limits.maxDynamicStorageBuffersPerPipelineLayout,
    maxSampledTexturesPerShaderStage: limits.maxSampledTexturesPerShaderStage,
    maxSamplersPerShaderStage: limits.maxSamplersPerShaderStage,
    maxStorageBuffersPerShaderStage: limits.maxStorageBuffersPerShaderStage,
    maxStorageTexturesPerShaderStage: limits.maxStorageTexturesPerShaderStage,
    maxUniformBuffersPerShaderStage: limits.maxUniformBuffersPerShaderStage,
    maxUniformBufferBindingSize: limits.maxUniformBufferBindingSize,
    maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
    maxVertexBuffers: limits.maxVertexBuffers,
    maxBufferSize: limits.maxBufferSize,
    maxVertexAttributes: limits.maxVertexAttributes,
    maxVertexBufferArrayStride: limits.maxVertexBufferArrayStride,
    maxInterStageShaderComponents: limits.maxInterStageShaderComponents,
    maxInterStageShaderVariables: limits.maxInterStageShaderVariables,
    maxColorAttachments: limits.maxColorAttachments,
    maxColorAttachmentBytesPerSample: limits.maxColorAttachmentBytesPerSample,
    maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
    maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
    maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
    maxComputeWorkgroupSizeY: limits.maxComputeWorkgroupSizeY,
    maxComputeWorkgroupSizeZ: limits.maxComputeWorkgroupSizeZ,
    maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
  }
}

// =============================================================================
// GPU Features
// =============================================================================

/**
 * Known GPU features.
 */
export type GPUFeatureName =
  | 'depth-clip-control'
  | 'depth32float-stencil8'
  | 'texture-compression-bc'
  | 'texture-compression-etc2'
  | 'texture-compression-astc'
  | 'timestamp-query'
  | 'indirect-first-instance'
  | 'shader-f16'
  | 'rg11b10ufloat-renderable'
  | 'bgra8unorm-storage'
  | 'float32-filterable'

/**
 * GPU features as a set of feature names.
 */
export type GPUFeaturesSet = Set<GPUFeatureName>

/**
 * Convert native GPUSupportedFeatures to our type.
 */
export function mapGPUFeatures(features: GPUSupportedFeatures): GPUFeaturesSet {
  const result = new Set<GPUFeatureName>()
  for (const feature of features) {
    result.add(feature as GPUFeatureName)
  }
  return result
}

/**
 * Convert features set to array for serialization.
 */
export function featuresToArray(features: GPUFeaturesSet): GPUFeatureName[] {
  return Array.from(features)
}

// =============================================================================
// Adapter Types
// =============================================================================

/**
 * GPU power preference.
 */
export type GPUPowerPreference = 'low-power' | 'high-performance'

/**
 * Adapter request options.
 */
export interface AdapterOptions {
  powerPreference?: GPUPowerPreference
  forceFallbackAdapter?: boolean
}

/**
 * Adapter info.
 */
export interface AdapterInfo {
  vendor: string
  architecture: string
  device: string
  description: string
}

/**
 * Map native GPUAdapterInfo to our type.
 */
export function mapAdapterInfo(info: GPUAdapterInfo): AdapterInfo {
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  }
}

// =============================================================================
// Device Types
// =============================================================================

/**
 * Device descriptor for requesting a device.
 */
export interface DeviceDescriptor {
  requiredFeatures?: GPUFeatureName[]
  requiredLimits?: Partial<GPULimitsRecord>
  defaultQueue?: { label?: string }
  label?: string
}

/**
 * Device lost info.
 */
export interface DeviceLostInfo {
  reason: 'unknown' | 'destroyed'
  message: string
}

// =============================================================================
// Buffer Types
// =============================================================================

/**
 * Buffer usage flags.
 */
export type BufferUsageFlag =
  | 'map-read'
  | 'map-write'
  | 'copy-src'
  | 'copy-dst'
  | 'index'
  | 'vertex'
  | 'uniform'
  | 'storage'
  | 'indirect'
  | 'query-resolve'

/**
 * Convert buffer usage flags to native GPUBufferUsageFlags.
 */
export function bufferUsageToNative(usage: BufferUsageFlag[]): GPUBufferUsageFlags {
  let flags = 0
  for (const flag of usage) {
    switch (flag) {
      case 'map-read': flags |= GPUBufferUsage.MAP_READ; break
      case 'map-write': flags |= GPUBufferUsage.MAP_WRITE; break
      case 'copy-src': flags |= GPUBufferUsage.COPY_SRC; break
      case 'copy-dst': flags |= GPUBufferUsage.COPY_DST; break
      case 'index': flags |= GPUBufferUsage.INDEX; break
      case 'vertex': flags |= GPUBufferUsage.VERTEX; break
      case 'uniform': flags |= GPUBufferUsage.UNIFORM; break
      case 'storage': flags |= GPUBufferUsage.STORAGE; break
      case 'indirect': flags |= GPUBufferUsage.INDIRECT; break
      case 'query-resolve': flags |= GPUBufferUsage.QUERY_RESOLVE; break
    }
  }
  return flags
}

/**
 * Buffer descriptor.
 */
export interface BufferDescriptor {
  size: number
  usage: BufferUsageFlag[]
  mappedAtCreation?: boolean
  label?: string
}

/**
 * Buffer map mode.
 */
export type BufferMapMode = 'read' | 'write'

// =============================================================================
// Texture Types
// =============================================================================

/**
 * Texture format.
 */
export type TextureFormat =
  // 8-bit formats
  | 'r8unorm' | 'r8snorm' | 'r8uint' | 'r8sint'
  // 16-bit formats
  | 'r16uint' | 'r16sint' | 'r16float'
  | 'rg8unorm' | 'rg8snorm' | 'rg8uint' | 'rg8sint'
  // 32-bit formats
  | 'r32uint' | 'r32sint' | 'r32float'
  | 'rg16uint' | 'rg16sint' | 'rg16float'
  | 'rgba8unorm' | 'rgba8unorm-srgb' | 'rgba8snorm' | 'rgba8uint' | 'rgba8sint'
  | 'bgra8unorm' | 'bgra8unorm-srgb'
  // Packed 32-bit formats
  | 'rgb9e5ufloat' | 'rgb10a2uint' | 'rgb10a2unorm' | 'rg11b10ufloat'
  // 64-bit formats
  | 'rg32uint' | 'rg32sint' | 'rg32float'
  | 'rgba16uint' | 'rgba16sint' | 'rgba16float'
  // 128-bit formats
  | 'rgba32uint' | 'rgba32sint' | 'rgba32float'
  // Depth/stencil formats
  | 'stencil8' | 'depth16unorm' | 'depth24plus' | 'depth24plus-stencil8' | 'depth32float' | 'depth32float-stencil8'

/**
 * Texture usage flags.
 */
export type TextureUsageFlag =
  | 'copy-src'
  | 'copy-dst'
  | 'texture-binding'
  | 'storage-binding'
  | 'render-attachment'

/**
 * Convert texture usage flags to native GPUTextureUsageFlags.
 */
export function textureUsageToNative(usage: TextureUsageFlag[]): GPUTextureUsageFlags {
  let flags = 0
  for (const flag of usage) {
    switch (flag) {
      case 'copy-src': flags |= GPUTextureUsage.COPY_SRC; break
      case 'copy-dst': flags |= GPUTextureUsage.COPY_DST; break
      case 'texture-binding': flags |= GPUTextureUsage.TEXTURE_BINDING; break
      case 'storage-binding': flags |= GPUTextureUsage.STORAGE_BINDING; break
      case 'render-attachment': flags |= GPUTextureUsage.RENDER_ATTACHMENT; break
    }
  }
  return flags
}

/**
 * Texture dimension.
 */
export type TextureDimension = '1d' | '2d' | '3d'

/**
 * Texture view dimension.
 */
export type TextureViewDimension = '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d'

/**
 * Texture aspect.
 */
export type TextureAspect = 'all' | 'stencil-only' | 'depth-only'

/**
 * Texture size.
 */
export interface TextureSize {
  width: number
  height: number
  depthOrArrayLayers?: number
}

/**
 * Texture descriptor.
 */
export interface TextureDescriptor {
  size: TextureSize
  mipLevelCount?: number
  sampleCount?: number
  dimension?: TextureDimension
  format: TextureFormat
  usage: TextureUsageFlag[]
  viewFormats?: TextureFormat[]
  label?: string
}

/**
 * Texture view descriptor.
 */
export interface TextureViewDescriptor {
  format?: TextureFormat
  dimension?: TextureViewDimension
  aspect?: TextureAspect
  baseMipLevel?: number
  mipLevelCount?: number
  baseArrayLayer?: number
  arrayLayerCount?: number
  label?: string
}

// =============================================================================
// Sampler Types
// =============================================================================

/**
 * Filter mode.
 */
export type FilterMode = 'nearest' | 'linear'

/**
 * Mipmap filter mode.
 */
export type MipmapFilterMode = 'nearest' | 'linear'

/**
 * Address mode.
 */
export type AddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat'

/**
 * Compare function.
 */
export type CompareFunction = 'never' | 'less' | 'equal' | 'less-equal' | 'greater' | 'not-equal' | 'greater-equal' | 'always'

/**
 * Sampler descriptor.
 */
export interface SamplerDescriptor {
  addressModeU?: AddressMode
  addressModeV?: AddressMode
  addressModeW?: AddressMode
  magFilter?: FilterMode
  minFilter?: FilterMode
  mipmapFilter?: MipmapFilterMode
  lodMinClamp?: number
  lodMaxClamp?: number
  compare?: CompareFunction
  maxAnisotropy?: number
  label?: string
}

// =============================================================================
// Shader Types
// =============================================================================

/**
 * Shader module descriptor.
 */
export interface ShaderModuleDescriptor {
  code: string
  label?: string
}

/**
 * Compilation message.
 */
export interface CompilationMessage {
  message: string
  type: 'error' | 'warning' | 'info'
  lineNum?: number
  linePos?: number
  offset?: number
  length?: number
}

/**
 * Map native GPUCompilationMessage to our type.
 */
export function mapCompilationMessage(msg: GPUCompilationMessage): CompilationMessage {
  return {
    message: msg.message,
    type: msg.type,
    lineNum: msg.lineNum,
    linePos: msg.linePos,
    offset: msg.offset,
    length: msg.length,
  }
}

// =============================================================================
// Bind Group Types
// =============================================================================

/**
 * Shader stage visibility.
 */
export type ShaderStageFlag = 'vertex' | 'fragment' | 'compute'

/**
 * Convert shader stage flags to native GPUShaderStageFlags.
 */
export function shaderStageToNative(stages: ShaderStageFlag[]): GPUShaderStageFlags {
  let flags = 0
  for (const stage of stages) {
    switch (stage) {
      case 'vertex': flags |= GPUShaderStage.VERTEX; break
      case 'fragment': flags |= GPUShaderStage.FRAGMENT; break
      case 'compute': flags |= GPUShaderStage.COMPUTE; break
    }
  }
  return flags
}

/**
 * Buffer binding type.
 */
export type BufferBindingType = 'uniform' | 'storage' | 'read-only-storage'

/**
 * Sampler binding type.
 */
export type SamplerBindingType = 'filtering' | 'non-filtering' | 'comparison'

/**
 * Texture sample type.
 */
export type TextureSampleType = 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint'

/**
 * Storage texture access.
 */
export type StorageTextureAccess = 'write-only' | 'read-only' | 'read-write'

/**
 * Bind group layout entry.
 */
export interface BindGroupLayoutEntry {
  binding: number
  visibility: ShaderStageFlag[]
  buffer?: {
    type?: BufferBindingType
    hasDynamicOffset?: boolean
    minBindingSize?: number
  }
  sampler?: {
    type?: SamplerBindingType
  }
  texture?: {
    sampleType?: TextureSampleType
    viewDimension?: TextureViewDimension
    multisampled?: boolean
  }
  storageTexture?: {
    access?: StorageTextureAccess
    format: TextureFormat
    viewDimension?: TextureViewDimension
  }
}

/**
 * Bind group entry resource.
 */
export type BindGroupEntryResource =
  | { type: 'buffer'; buffer: BufferHandle; offset?: number; size?: number }
  | { type: 'sampler'; sampler: SamplerHandle }
  | { type: 'texture-view'; textureView: TextureViewHandle }

/**
 * Bind group entry.
 */
export interface BindGroupEntry {
  binding: number
  resource: BindGroupEntryResource
}

// =============================================================================
// Pipeline Types
// =============================================================================

/**
 * Primitive topology.
 */
export type PrimitiveTopology = 'point-list' | 'line-list' | 'line-strip' | 'triangle-list' | 'triangle-strip'

/**
 * Front face winding.
 */
export type FrontFace = 'ccw' | 'cw'

/**
 * Cull mode.
 */
export type CullMode = 'none' | 'front' | 'back'

/**
 * Index format.
 */
export type IndexFormat = 'uint16' | 'uint32'

/**
 * Blend factor.
 */
export type BlendFactor =
  | 'zero' | 'one'
  | 'src' | 'one-minus-src'
  | 'src-alpha' | 'one-minus-src-alpha'
  | 'dst' | 'one-minus-dst'
  | 'dst-alpha' | 'one-minus-dst-alpha'
  | 'src-alpha-saturated'
  | 'constant' | 'one-minus-constant'

/**
 * Blend operation.
 */
export type BlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max'

/**
 * Color write mask flags.
 */
export type ColorWriteFlag = 'red' | 'green' | 'blue' | 'alpha' | 'all'

/**
 * Convert color write flags to native GPUColorWriteFlags.
 */
export function colorWriteToNative(flags: ColorWriteFlag[]): GPUColorWriteFlags {
  let result = 0
  for (const flag of flags) {
    switch (flag) {
      case 'red': result |= GPUColorWrite.RED; break
      case 'green': result |= GPUColorWrite.GREEN; break
      case 'blue': result |= GPUColorWrite.BLUE; break
      case 'alpha': result |= GPUColorWrite.ALPHA; break
      case 'all': result |= GPUColorWrite.ALL; break
    }
  }
  return result
}

/**
 * Vertex format.
 */
export type VertexFormat =
  | 'uint8x2' | 'uint8x4' | 'sint8x2' | 'sint8x4'
  | 'unorm8x2' | 'unorm8x4' | 'snorm8x2' | 'snorm8x4'
  | 'uint16x2' | 'uint16x4' | 'sint16x2' | 'sint16x4'
  | 'unorm16x2' | 'unorm16x4' | 'snorm16x2' | 'snorm16x4'
  | 'float16x2' | 'float16x4'
  | 'float32' | 'float32x2' | 'float32x3' | 'float32x4'
  | 'uint32' | 'uint32x2' | 'uint32x3' | 'uint32x4'
  | 'sint32' | 'sint32x2' | 'sint32x3' | 'sint32x4'
  | 'unorm10-10-10-2'

/**
 * Vertex step mode.
 */
export type VertexStepMode = 'vertex' | 'instance'

/**
 * Vertex attribute.
 */
export interface VertexAttribute {
  format: VertexFormat
  offset: number
  shaderLocation: number
}

/**
 * Vertex buffer layout.
 */
export interface VertexBufferLayout {
  arrayStride: number
  stepMode?: VertexStepMode
  attributes: VertexAttribute[]
}

/**
 * Blend component.
 */
export interface BlendComponent {
  srcFactor?: BlendFactor
  dstFactor?: BlendFactor
  operation?: BlendOperation
}

/**
 * Blend state.
 */
export interface BlendState {
  color: BlendComponent
  alpha: BlendComponent
}

/**
 * Color target state.
 */
export interface ColorTargetState {
  format: TextureFormat
  blend?: BlendState
  writeMask?: ColorWriteFlag[]
}

/**
 * Stencil operation.
 */
export type StencilOperation = 'keep' | 'zero' | 'replace' | 'invert' | 'increment-clamp' | 'decrement-clamp' | 'increment-wrap' | 'decrement-wrap'

/**
 * Stencil face state.
 */
export interface StencilFaceState {
  compare?: CompareFunction
  failOp?: StencilOperation
  depthFailOp?: StencilOperation
  passOp?: StencilOperation
}

/**
 * Depth stencil state.
 */
export interface DepthStencilState {
  format: TextureFormat
  depthWriteEnabled?: boolean
  depthCompare?: CompareFunction
  stencilFront?: StencilFaceState
  stencilBack?: StencilFaceState
  stencilReadMask?: number
  stencilWriteMask?: number
  depthBias?: number
  depthBiasSlopeScale?: number
  depthBiasClamp?: number
}

/**
 * Multisample state.
 */
export interface MultisampleState {
  count?: number
  mask?: number
  alphaToCoverageEnabled?: boolean
}

/**
 * Primitive state.
 */
export interface PrimitiveState {
  topology?: PrimitiveTopology
  stripIndexFormat?: IndexFormat
  frontFace?: FrontFace
  cullMode?: CullMode
  unclippedDepth?: boolean
}

/**
 * Programmable stage descriptor.
 */
export interface ProgrammableStage {
  module: ShaderModuleHandle
  entryPoint: string
  constants?: Record<string, number>
}

/**
 * Vertex state.
 */
export interface VertexState extends ProgrammableStage {
  buffers?: VertexBufferLayout[]
}

/**
 * Fragment state.
 */
export interface FragmentState extends ProgrammableStage {
  targets: ColorTargetState[]
}

/**
 * Render pipeline descriptor.
 */
export interface RenderPipelineDescriptor {
  layout: PipelineLayoutHandle | 'auto'
  vertex: VertexState
  fragment?: FragmentState
  primitive?: PrimitiveState
  depthStencil?: DepthStencilState
  multisample?: MultisampleState
  label?: string
}

/**
 * Compute pipeline descriptor.
 */
export interface ComputePipelineDescriptor {
  layout: PipelineLayoutHandle | 'auto'
  compute: ProgrammableStage
  label?: string
}

// =============================================================================
// Command Types
// =============================================================================

/**
 * Load operation.
 */
export type LoadOp = 'load' | 'clear'

/**
 * Store operation.
 */
export type StoreOp = 'store' | 'discard'

/**
 * Color value.
 */
export interface GPUColorValue {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Render pass color attachment.
 */
export interface RenderPassColorAttachment {
  view: TextureViewHandle
  resolveTarget?: TextureViewHandle
  clearValue?: GPUColorValue
  loadOp: LoadOp
  storeOp: StoreOp
}

/**
 * Render pass depth stencil attachment.
 */
export interface RenderPassDepthStencilAttachment {
  view: TextureViewHandle
  depthClearValue?: number
  depthLoadOp?: LoadOp
  depthStoreOp?: StoreOp
  depthReadOnly?: boolean
  stencilClearValue?: number
  stencilLoadOp?: LoadOp
  stencilStoreOp?: StoreOp
  stencilReadOnly?: boolean
}

/**
 * Render pass descriptor.
 */
export interface RenderPassDescriptor {
  colorAttachments: (RenderPassColorAttachment | null)[]
  depthStencilAttachment?: RenderPassDepthStencilAttachment
  label?: string
}

/**
 * Compute pass descriptor.
 */
export interface ComputePassDescriptor {
  label?: string
}

/**
 * Image copy buffer.
 */
export interface ImageCopyBuffer {
  buffer: BufferHandle
  offset?: number
  bytesPerRow: number
  rowsPerImage?: number
}

/**
 * Image copy texture.
 */
export interface ImageCopyTexture {
  texture: TextureHandle
  mipLevel?: number
  origin?: [number, number, number]
  aspect?: TextureAspect
}

/**
 * Copy size.
 */
export interface CopySize {
  width: number
  height?: number
  depthOrArrayLayers?: number
}

// =============================================================================
// Canvas Context Types
// =============================================================================

/**
 * Canvas alpha mode.
 */
export type CanvasAlphaMode = 'opaque' | 'premultiplied'

/**
 * Canvas color space.
 */
export type CanvasColorSpace = 'srgb' | 'display-p3'

/**
 * Canvas context configuration.
 */
export interface CanvasContextConfiguration {
  device: DeviceHandle
  format: TextureFormat
  usage?: TextureUsageFlag[]
  viewFormats?: TextureFormat[]
  colorSpace?: CanvasColorSpace
  alphaMode?: CanvasAlphaMode
}

// =============================================================================
// Command Batching Types
// =============================================================================

/**
 * Batched render command.
 */
export type RenderCommand =
  | { type: 'set-pipeline'; pipeline: RenderPipelineHandle }
  | { type: 'set-bind-group'; index: number; bindGroup: BindGroupHandle; dynamicOffsets?: number[] }
  | { type: 'set-vertex-buffer'; slot: number; buffer: BufferHandle; offset?: number; size?: number }
  | { type: 'set-index-buffer'; buffer: BufferHandle; format: IndexFormat; offset?: number; size?: number }
  | { type: 'set-viewport'; x: number; y: number; width: number; height: number; minDepth: number; maxDepth: number }
  | { type: 'set-scissor-rect'; x: number; y: number; width: number; height: number }
  | { type: 'set-blend-constant'; color: GPUColorValue }
  | { type: 'set-stencil-reference'; reference: number }
  | { type: 'draw'; vertexCount: number; instanceCount?: number; firstVertex?: number; firstInstance?: number }
  | { type: 'draw-indexed'; indexCount: number; instanceCount?: number; firstIndex?: number; baseVertex?: number; firstInstance?: number }
  | { type: 'draw-indirect'; indirectBuffer: BufferHandle; indirectOffset: number }
  | { type: 'draw-indexed-indirect'; indirectBuffer: BufferHandle; indirectOffset: number }

/**
 * Batched compute command.
 */
export type ComputeCommand =
  | { type: 'set-pipeline'; pipeline: ComputePipelineHandle }
  | { type: 'set-bind-group'; index: number; bindGroup: BindGroupHandle; dynamicOffsets?: number[] }
  | { type: 'dispatch-workgroups'; countX: number; countY?: number; countZ?: number }
  | { type: 'dispatch-workgroups-indirect'; indirectBuffer: BufferHandle; indirectOffset: number }
