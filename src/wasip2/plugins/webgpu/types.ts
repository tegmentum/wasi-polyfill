/**
 * wasi:webgpu types
 *
 * Type definitions for the WASI WebGPU interface.
 * These map to the WIT definitions from wasi-gfx.
 *
 * @packageDocumentation
 */

// =============================================================================
// Handle Types (matching browser:webgpu handles)
// =============================================================================

export type GpuHandle = number
export type GpuAdapterHandle = number
export type GpuDeviceHandle = number
export type GpuQueueHandle = number
export type GpuBufferHandle = number
export type GpuTextureHandle = number
export type GpuTextureViewHandle = number
export type GpuSamplerHandle = number
export type GpuBindGroupLayoutHandle = number
export type GpuBindGroupHandle = number
export type GpuPipelineLayoutHandle = number
export type GpuShaderModuleHandle = number
export type GpuRenderPipelineHandle = number
export type GpuComputePipelineHandle = number
export type GpuCommandEncoderHandle = number
export type GpuCommandBufferHandle = number
export type GpuRenderPassEncoderHandle = number
export type GpuComputePassEncoderHandle = number
export type GpuRenderBundleHandle = number
export type GpuRenderBundleEncoderHandle = number
export type GpuQuerySetHandle = number
export type GpuCanvasContextHandle = number

// =============================================================================
// Enum Types
// =============================================================================

export type GpuPowerPreference = 'low-power' | 'high-performance'

export type GpuFeatureName =
  | 'depth-clip-control'
  | 'depth32float-stencil8'
  | 'texture-compression-bc'
  | 'texture-compression-bc-sliced3d'
  | 'texture-compression-etc2'
  | 'texture-compression-astc'
  | 'texture-compression-astc-sliced3d'
  | 'timestamp-query'
  | 'indirect-first-instance'
  | 'shader-f16'
  | 'rg11b10ufloat-renderable'
  | 'bgra8unorm-storage'
  | 'float32-filterable'
  | 'float32-blendable'
  | 'clip-distances'
  | 'dual-source-blending'
  | 'subgroups'

export type GpuBufferMapState = 'unmapped' | 'pending' | 'mapped'

export type GpuTextureDimension = 'd1' | 'd2' | 'd3'

export type GpuTextureViewDimension = 'd1' | 'd2' | 'd2-array' | 'cube' | 'cube-array' | 'd3'

export type GpuTextureAspect = 'all' | 'stencil-only' | 'depth-only'

export type GpuTextureFormat =
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
  | 'stencil8' | 'depth16unorm' | 'depth24plus' | 'depth24plus-stencil8'
  | 'depth32float' | 'depth32float-stencil8'
  // BC compressed formats
  | 'bc1-rgba-unorm' | 'bc1-rgba-unorm-srgb' | 'bc2-rgba-unorm' | 'bc2-rgba-unorm-srgb'
  | 'bc3-rgba-unorm' | 'bc3-rgba-unorm-srgb' | 'bc4-r-unorm' | 'bc4-r-snorm'
  | 'bc5-rg-unorm' | 'bc5-rg-snorm' | 'bc6h-rgb-ufloat' | 'bc6h-rgb-float'
  | 'bc7-rgba-unorm' | 'bc7-rgba-unorm-srgb'
  // ETC2 compressed formats
  | 'etc2-rgb8unorm' | 'etc2-rgb8unorm-srgb' | 'etc2-rgb8a1unorm' | 'etc2-rgb8a1unorm-srgb'
  | 'etc2-rgba8unorm' | 'etc2-rgba8unorm-srgb'
  | 'eac-r11unorm' | 'eac-r11snorm' | 'eac-rg11unorm' | 'eac-rg11snorm'
  // ASTC compressed formats
  | 'astc4x4-unorm' | 'astc4x4-unorm-srgb' | 'astc5x4-unorm' | 'astc5x4-unorm-srgb'
  | 'astc5x5-unorm' | 'astc5x5-unorm-srgb' | 'astc6x5-unorm' | 'astc6x5-unorm-srgb'
  | 'astc6x6-unorm' | 'astc6x6-unorm-srgb' | 'astc8x5-unorm' | 'astc8x5-unorm-srgb'
  | 'astc8x6-unorm' | 'astc8x6-unorm-srgb' | 'astc8x8-unorm' | 'astc8x8-unorm-srgb'
  | 'astc10x5-unorm' | 'astc10x5-unorm-srgb' | 'astc10x6-unorm' | 'astc10x6-unorm-srgb'
  | 'astc10x8-unorm' | 'astc10x8-unorm-srgb' | 'astc10x10-unorm' | 'astc10x10-unorm-srgb'
  | 'astc12x10-unorm' | 'astc12x10-unorm-srgb' | 'astc12x12-unorm' | 'astc12x12-unorm-srgb'

export type GpuAddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat'

export type GpuFilterMode = 'nearest' | 'linear'

export type GpuMipmapFilterMode = 'nearest' | 'linear'

export type GpuCompareFunction = 'never' | 'less' | 'equal' | 'less-equal' | 'greater' | 'not-equal' | 'greater-equal' | 'always'

export type GpuBufferBindingType = 'uniform' | 'storage' | 'read-only-storage'

export type GpuSamplerBindingType = 'filtering' | 'non-filtering' | 'comparison'

export type GpuTextureSampleType = 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint'

export type GpuStorageTextureAccess = 'write-only' | 'read-only' | 'read-write'

export type GpuCompilationMessageType = 'error' | 'warning' | 'info'

export type GpuPrimitiveTopology = 'point-list' | 'line-list' | 'line-strip' | 'triangle-list' | 'triangle-strip'

export type GpuFrontFace = 'ccw' | 'cw'

export type GpuCullMode = 'none' | 'front' | 'back'

export type GpuBlendFactor =
  | 'zero' | 'one' | 'src' | 'one-minus-src' | 'src-alpha' | 'one-minus-src-alpha'
  | 'dst' | 'one-minus-dst' | 'dst-alpha' | 'one-minus-dst-alpha'
  | 'src-alpha-saturated' | 'constant' | 'one-minus-constant'
  | 'src1' | 'one-minus-src1' | 'src1-alpha' | 'one-minus-src1-alpha'

export type GpuBlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max'

export type GpuStencilOperation = 'keep' | 'zero' | 'replace' | 'invert' | 'increment-clamp' | 'decrement-clamp' | 'increment-wrap' | 'decrement-wrap'

export type GpuIndexFormat = 'uint16' | 'uint32'

export type GpuVertexFormat =
  | 'uint8' | 'uint8x2' | 'uint8x4' | 'sint8' | 'sint8x2' | 'sint8x4'
  | 'unorm8' | 'unorm8x2' | 'unorm8x4' | 'snorm8' | 'snorm8x2' | 'snorm8x4'
  | 'uint16' | 'uint16x2' | 'uint16x4' | 'sint16' | 'sint16x2' | 'sint16x4'
  | 'unorm16' | 'unorm16x2' | 'unorm16x4' | 'snorm16' | 'snorm16x2' | 'snorm16x4'
  | 'float16' | 'float16x2' | 'float16x4'
  | 'float32' | 'float32x2' | 'float32x3' | 'float32x4'
  | 'uint32' | 'uint32x2' | 'uint32x3' | 'uint32x4'
  | 'sint32' | 'sint32x2' | 'sint32x3' | 'sint32x4'
  | 'unorm1010102' | 'unorm8x4-bgra'

export type GpuVertexStepMode = 'vertex' | 'instance'

export type GpuLoadOp = 'load' | 'clear'

export type GpuStoreOp = 'store' | 'discard'

export type GpuQueryType = 'occlusion' | 'timestamp'

export type GpuCanvasAlphaMode = 'opaque' | 'premultiplied'

export type GpuDeviceLostReason = 'unknown' | 'destroyed'

export type GpuErrorFilter = 'validation' | 'out-of-memory' | 'internal'

// =============================================================================
// Record Types
// =============================================================================

export interface GpuRequestAdapterOptions {
  featureLevel?: string
  powerPreference?: GpuPowerPreference
  forceFallbackAdapter?: boolean
  xrCompatible?: boolean
}

export interface GpuDeviceDescriptor {
  requiredFeatures?: GpuFeatureName[]
  requiredLimits?: Record<string, bigint | null>
  defaultQueue?: GpuQueueDescriptor
  label?: string
}

export interface GpuQueueDescriptor {
  label?: string
}

export interface GpuBufferDescriptor {
  size: bigint
  usage: number
  mappedAtCreation?: boolean
  label?: string
}

export interface GpuTextureDescriptor {
  size: GpuExtent3D
  mipLevelCount?: number
  sampleCount?: number
  dimension?: GpuTextureDimension
  format: GpuTextureFormat
  usage: number
  viewFormats?: GpuTextureFormat[]
  label?: string
}

export interface GpuTextureViewDescriptor {
  format?: GpuTextureFormat
  dimension?: GpuTextureViewDimension
  usage?: number
  aspect?: GpuTextureAspect
  baseMipLevel?: number
  mipLevelCount?: number
  baseArrayLayer?: number
  arrayLayerCount?: number
  label?: string
}

export interface GpuSamplerDescriptor {
  addressModeU?: GpuAddressMode
  addressModeV?: GpuAddressMode
  addressModeW?: GpuAddressMode
  magFilter?: GpuFilterMode
  minFilter?: GpuFilterMode
  mipmapFilter?: GpuMipmapFilterMode
  lodMinClamp?: number
  lodMaxClamp?: number
  compare?: GpuCompareFunction
  maxAnisotropy?: number
  label?: string
}

export interface GpuBindGroupLayoutDescriptor {
  entries: GpuBindGroupLayoutEntry[]
  label?: string
}

export interface GpuBindGroupLayoutEntry {
  binding: number
  visibility: number
  buffer?: GpuBufferBindingLayout
  sampler?: GpuSamplerBindingLayout
  texture?: GpuTextureBindingLayout
  storageTexture?: GpuStorageTextureBindingLayout
}

export interface GpuBufferBindingLayout {
  type?: GpuBufferBindingType
  hasDynamicOffset?: boolean
  minBindingSize?: bigint
}

export interface GpuSamplerBindingLayout {
  type?: GpuSamplerBindingType
}

export interface GpuTextureBindingLayout {
  sampleType?: GpuTextureSampleType
  viewDimension?: GpuTextureViewDimension
  multisampled?: boolean
}

export interface GpuStorageTextureBindingLayout {
  access?: GpuStorageTextureAccess
  format: GpuTextureFormat
  viewDimension?: GpuTextureViewDimension
}

export interface GpuBindGroupDescriptor {
  layout: GpuBindGroupLayoutHandle
  entries: GpuBindGroupEntry[]
  label?: string
}

export interface GpuBindGroupEntry {
  binding: number
  resource: GpuBindingResource
}

export type GpuBindingResource =
  | { tag: 'gpu-buffer-binding'; val: GpuBufferBinding }
  | { tag: 'gpu-sampler'; val: GpuSamplerHandle }
  | { tag: 'gpu-texture-view'; val: GpuTextureViewHandle }

export interface GpuBufferBinding {
  buffer: GpuBufferHandle
  offset?: bigint
  size?: bigint
}

export interface GpuPipelineLayoutDescriptor {
  bindGroupLayouts: (GpuBindGroupLayoutHandle | null)[]
  label?: string
}

export interface GpuShaderModuleDescriptor {
  code: string
  compilationHints?: GpuShaderModuleCompilationHint[]
  label?: string
}

export interface GpuShaderModuleCompilationHint {
  entryPoint: string
  layout?: GpuLayoutMode
}

export type GpuLayoutMode =
  | { tag: 'specific'; val: GpuPipelineLayoutHandle }
  | { tag: 'auto' }

export interface GpuProgrammableStage {
  module: GpuShaderModuleHandle
  entryPoint?: string
  constants?: Record<string, number>
}

export interface GpuComputePipelineDescriptor {
  compute: GpuProgrammableStage
  layout: GpuLayoutMode
  label?: string
}

export interface GpuRenderPipelineDescriptor {
  vertex: GpuVertexState
  primitive?: GpuPrimitiveState
  depthStencil?: GpuDepthStencilState
  multisample?: GpuMultisampleState
  fragment?: GpuFragmentState
  layout: GpuLayoutMode
  label?: string
}

export interface GpuVertexState {
  buffers?: (GpuVertexBufferLayout | null)[]
  module: GpuShaderModuleHandle
  entryPoint?: string
  constants?: Record<string, number>
}

export interface GpuVertexBufferLayout {
  arrayStride: bigint
  stepMode?: GpuVertexStepMode
  attributes: GpuVertexAttribute[]
}

export interface GpuVertexAttribute {
  format: GpuVertexFormat
  offset: bigint
  shaderLocation: number
}

export interface GpuPrimitiveState {
  topology?: GpuPrimitiveTopology
  stripIndexFormat?: GpuIndexFormat
  frontFace?: GpuFrontFace
  cullMode?: GpuCullMode
  unclippedDepth?: boolean
}

export interface GpuDepthStencilState {
  format: GpuTextureFormat
  depthWriteEnabled?: boolean
  depthCompare?: GpuCompareFunction
  stencilFront?: GpuStencilFaceState
  stencilBack?: GpuStencilFaceState
  stencilReadMask?: number
  stencilWriteMask?: number
  depthBias?: number
  depthBiasSlopeScale?: number
  depthBiasClamp?: number
}

export interface GpuStencilFaceState {
  compare?: GpuCompareFunction
  failOp?: GpuStencilOperation
  depthFailOp?: GpuStencilOperation
  passOp?: GpuStencilOperation
}

export interface GpuMultisampleState {
  count?: number
  mask?: number
  alphaToCoverageEnabled?: boolean
}

export interface GpuFragmentState {
  targets: (GpuColorTargetState | null)[]
  module: GpuShaderModuleHandle
  entryPoint?: string
  constants?: Record<string, number>
}

export interface GpuColorTargetState {
  format: GpuTextureFormat
  blend?: GpuBlendState
  writeMask?: number
}

export interface GpuBlendState {
  color: GpuBlendComponent
  alpha: GpuBlendComponent
}

export interface GpuBlendComponent {
  operation?: GpuBlendOperation
  srcFactor?: GpuBlendFactor
  dstFactor?: GpuBlendFactor
}

export interface GpuCommandEncoderDescriptor {
  label?: string
}

export interface GpuCommandBufferDescriptor {
  label?: string
}

export interface GpuRenderPassDescriptor {
  colorAttachments: (GpuRenderPassColorAttachment | null)[]
  depthStencilAttachment?: GpuRenderPassDepthStencilAttachment
  occlusionQuerySet?: GpuQuerySetHandle
  timestampWrites?: GpuRenderPassTimestampWrites
  maxDrawCount?: bigint
  label?: string
}

export interface GpuRenderPassColorAttachment {
  view: GpuTextureViewHandle
  depthSlice?: number
  resolveTarget?: GpuTextureViewHandle
  clearValue?: GpuColor
  loadOp: GpuLoadOp
  storeOp: GpuStoreOp
}

export interface GpuRenderPassDepthStencilAttachment {
  view: GpuTextureViewHandle
  depthClearValue?: number
  depthLoadOp?: GpuLoadOp
  depthStoreOp?: GpuStoreOp
  depthReadOnly?: boolean
  stencilClearValue?: number
  stencilLoadOp?: GpuLoadOp
  stencilStoreOp?: GpuStoreOp
  stencilReadOnly?: boolean
}

export interface GpuRenderPassTimestampWrites {
  values: GpuRenderPassTimestampWrite[]
}

export interface GpuRenderPassTimestampWrite {
  querySet: GpuQuerySetHandle
  queryIndex: number
  location: 'beginning' | 'end'
}

export interface GpuComputePassDescriptor {
  timestampWrites?: GpuComputePassTimestampWrites
  label?: string
}

export interface GpuComputePassTimestampWrites {
  values: GpuComputePassTimestampWrite[]
}

export interface GpuComputePassTimestampWrite {
  querySet: GpuQuerySetHandle
  queryIndex: number
  location: 'beginning' | 'end'
}

export interface GpuRenderBundleDescriptor {
  label?: string
}

export interface GpuRenderBundleEncoderDescriptor {
  colorFormats: (GpuTextureFormat | null)[]
  depthStencilFormat?: GpuTextureFormat
  sampleCount?: number
  depthReadOnly?: boolean
  stencilReadOnly?: boolean
  label?: string
}

export interface GpuQuerySetDescriptor {
  type: GpuQueryType
  count: number
  label?: string
}

export interface GpuColor {
  r: number
  g: number
  b: number
  a: number
}

export interface GpuExtent3D {
  width: number
  height?: number
  depthOrArrayLayers?: number
}

export interface GpuOrigin3D {
  x?: number
  y?: number
  z?: number
}

export interface GpuTexelCopyBufferInfo {
  buffer: GpuBufferHandle
  offset?: bigint
  bytesPerRow?: number
  rowsPerImage?: number
}

export interface GpuTexelCopyTextureInfo {
  texture: GpuTextureHandle
  mipLevel?: number
  origin?: GpuOrigin3D
  aspect?: GpuTextureAspect
}

export interface GpuTexelCopyBufferLayout {
  offset?: bigint
  bytesPerRow?: number
  rowsPerImage?: number
}

export interface GpuCanvasConfiguration {
  device: GpuDeviceHandle
  format: GpuTextureFormat
  usage?: number
  viewFormats?: GpuTextureFormat[]
  colorSpace?: 'srgb' | 'display-p3'
  toneMapping?: GpuCanvasToneMapping
  alphaMode?: GpuCanvasAlphaMode
}

export interface GpuCanvasToneMapping {
  mode?: 'standard' | 'extended'
}

export interface GpuCanvasConfigurationOwned {
  format: GpuTextureFormat
  usage: number
  viewFormats: GpuTextureFormat[]
  colorSpace: 'srgb' | 'display-p3'
  toneMapping: GpuCanvasToneMapping
  alphaMode: GpuCanvasAlphaMode
}
