/**
 * WebGPU Type Declarations
 *
 * These types are a subset of the full WebGPU API needed by this implementation.
 * Full types available at @webgpu/types package.
 */

// Extend Navigator interface
interface Navigator {
  readonly gpu: GPU
}

// GPU Object
interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>
  getPreferredCanvasFormat(): GPUTextureFormat
}

interface GPURequestAdapterOptions {
  powerPreference?: GPUPowerPreference
  forceFallbackAdapter?: boolean
}

type GPUPowerPreference = 'low-power' | 'high-performance'

// GPU Adapter
interface GPUAdapter {
  readonly features: GPUSupportedFeatures
  readonly limits: GPUSupportedLimits
  readonly isFallbackAdapter: boolean
  readonly info: GPUAdapterInfo
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>
}

interface GPUSupportedFeatures extends ReadonlySet<string> {}

interface GPUSupportedLimits {
  readonly maxTextureDimension1D: number
  readonly maxTextureDimension2D: number
  readonly maxTextureDimension3D: number
  readonly maxTextureArrayLayers: number
  readonly maxBindGroups: number
  readonly maxBindGroupsPlusVertexBuffers: number
  readonly maxBindingsPerBindGroup: number
  readonly maxDynamicUniformBuffersPerPipelineLayout: number
  readonly maxDynamicStorageBuffersPerPipelineLayout: number
  readonly maxSampledTexturesPerShaderStage: number
  readonly maxSamplersPerShaderStage: number
  readonly maxStorageBuffersPerShaderStage: number
  readonly maxStorageTexturesPerShaderStage: number
  readonly maxUniformBuffersPerShaderStage: number
  readonly maxUniformBufferBindingSize: number
  readonly maxStorageBufferBindingSize: number
  readonly maxVertexBuffers: number
  readonly maxBufferSize: number
  readonly maxVertexAttributes: number
  readonly maxVertexBufferArrayStride: number
  readonly maxInterStageShaderComponents: number
  readonly maxInterStageShaderVariables: number
  readonly maxColorAttachments: number
  readonly maxColorAttachmentBytesPerSample: number
  readonly maxComputeWorkgroupStorageSize: number
  readonly maxComputeInvocationsPerWorkgroup: number
  readonly maxComputeWorkgroupSizeX: number
  readonly maxComputeWorkgroupSizeY: number
  readonly maxComputeWorkgroupSizeZ: number
  readonly maxComputeWorkgroupsPerDimension: number
}

interface GPUAdapterInfo {
  readonly vendor: string
  readonly architecture: string
  readonly device: string
  readonly description: string
}

// GPU Device
interface GPUDeviceDescriptor {
  requiredFeatures?: GPUFeatureName[]
  requiredLimits?: Partial<GPUSupportedLimits>
  defaultQueue?: GPUQueueDescriptor
  label?: string
}

interface GPUQueueDescriptor {
  label?: string
}

type GPUFeatureName = string

interface GPUDevice extends EventTarget {
  readonly features: GPUSupportedFeatures
  readonly limits: GPUSupportedLimits
  readonly queue: GPUQueue
  readonly lost: Promise<GPUDeviceLostInfo>
  destroy(): void
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture
  createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline
  createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline>
  createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline
  createComputePipelineAsync(descriptor: GPUComputePipelineDescriptor): Promise<GPUComputePipeline>
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder
  pushErrorScope(filter: GPUErrorFilter): void
  popErrorScope(): Promise<GPUError | null>
}

interface GPUDeviceLostInfo {
  readonly reason: 'unknown' | 'destroyed'
  readonly message: string
}

type GPUErrorFilter = 'validation' | 'out-of-memory' | 'internal'

interface GPUError {
  readonly message: string
}

declare class GPUValidationError extends Error implements GPUError {
  constructor(message: string)
  readonly message: string
}

declare class GPUOutOfMemoryError extends Error implements GPUError {
  constructor(message: string)
  readonly message: string
}

declare class GPUInternalError extends Error implements GPUError {
  constructor(message: string)
  readonly message: string
}

// GPU Queue
interface GPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void
  onSubmittedWorkDone(): Promise<void>
  writeBuffer(buffer: GPUBuffer, bufferOffset: number, data: ArrayBufferView | ArrayBuffer, dataOffset?: number, size?: number): void
  writeTexture(destination: GPUImageCopyTexture, data: ArrayBufferView | ArrayBuffer, dataLayout: GPUImageDataLayout, size: GPUExtent3DStrict): void
}

// GPU Buffer
interface GPUBufferDescriptor {
  size: number
  usage: GPUBufferUsageFlags
  mappedAtCreation?: boolean
  label?: string
}

type GPUBufferUsageFlags = number

declare const GPUBufferUsage: {
  readonly MAP_READ: GPUBufferUsageFlags
  readonly MAP_WRITE: GPUBufferUsageFlags
  readonly COPY_SRC: GPUBufferUsageFlags
  readonly COPY_DST: GPUBufferUsageFlags
  readonly INDEX: GPUBufferUsageFlags
  readonly VERTEX: GPUBufferUsageFlags
  readonly UNIFORM: GPUBufferUsageFlags
  readonly STORAGE: GPUBufferUsageFlags
  readonly INDIRECT: GPUBufferUsageFlags
  readonly QUERY_RESOLVE: GPUBufferUsageFlags
}

type GPUMapModeFlags = number

declare const GPUMapMode: {
  readonly READ: GPUMapModeFlags
  readonly WRITE: GPUMapModeFlags
}

interface GPUBuffer {
  readonly size: number
  readonly usage: GPUBufferUsageFlags
  readonly mapState: 'unmapped' | 'pending' | 'mapped'
  mapAsync(mode: GPUMapModeFlags, offset?: number, size?: number): Promise<void>
  getMappedRange(offset?: number, size?: number): ArrayBuffer
  unmap(): void
  destroy(): void
}

// GPU Texture
interface GPUTextureDescriptor {
  size: GPUExtent3DStrict
  mipLevelCount?: number
  sampleCount?: number
  dimension?: GPUTextureDimension
  format: GPUTextureFormat
  usage: GPUTextureUsageFlags
  viewFormats?: GPUTextureFormat[]
  label?: string
}

type GPUExtent3DStrict = { width: number; height?: number; depthOrArrayLayers?: number }
type GPUTextureDimension = '1d' | '2d' | '3d'
type GPUTextureFormat = string
type GPUTextureUsageFlags = number

declare const GPUTextureUsage: {
  readonly COPY_SRC: GPUTextureUsageFlags
  readonly COPY_DST: GPUTextureUsageFlags
  readonly TEXTURE_BINDING: GPUTextureUsageFlags
  readonly STORAGE_BINDING: GPUTextureUsageFlags
  readonly RENDER_ATTACHMENT: GPUTextureUsageFlags
}

interface GPUTexture {
  readonly width: number
  readonly height: number
  readonly depthOrArrayLayers: number
  readonly mipLevelCount: number
  readonly sampleCount: number
  readonly dimension: GPUTextureDimension
  readonly format: GPUTextureFormat
  readonly usage: GPUTextureUsageFlags
  createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView
  destroy(): void
}

interface GPUTextureViewDescriptor {
  format?: GPUTextureFormat
  dimension?: GPUTextureViewDimension
  aspect?: GPUTextureAspect
  baseMipLevel?: number
  mipLevelCount?: number
  baseArrayLayer?: number
  arrayLayerCount?: number
  label?: string
}

type GPUTextureViewDimension = '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d'
type GPUTextureAspect = 'all' | 'stencil-only' | 'depth-only'

interface GPUTextureView {}

// GPU Sampler
interface GPUSamplerDescriptor {
  addressModeU?: GPUAddressMode
  addressModeV?: GPUAddressMode
  addressModeW?: GPUAddressMode
  magFilter?: GPUFilterMode
  minFilter?: GPUFilterMode
  mipmapFilter?: GPUMipmapFilterMode
  lodMinClamp?: number
  lodMaxClamp?: number
  compare?: GPUCompareFunction
  maxAnisotropy?: number
  label?: string
}

type GPUAddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat'
type GPUFilterMode = 'nearest' | 'linear'
type GPUMipmapFilterMode = 'nearest' | 'linear'
type GPUCompareFunction = 'never' | 'less' | 'equal' | 'less-equal' | 'greater' | 'not-equal' | 'greater-equal' | 'always'

interface GPUSampler {}

// Shader Module
interface GPUShaderModuleDescriptor {
  code: string
  label?: string
}

interface GPUShaderModule {
  getCompilationInfo(): Promise<GPUCompilationInfo>
}

interface GPUCompilationInfo {
  readonly messages: readonly GPUCompilationMessage[]
}

interface GPUCompilationMessage {
  readonly message: string
  readonly type: 'error' | 'warning' | 'info'
  readonly lineNum: number
  readonly linePos: number
  readonly offset: number
  readonly length: number
}

// Bind Group Layout
interface GPUBindGroupLayoutDescriptor {
  entries: GPUBindGroupLayoutEntry[]
  label?: string
}

interface GPUBindGroupLayoutEntry {
  binding: number
  visibility: GPUShaderStageFlags
  buffer?: GPUBufferBindingLayout
  sampler?: GPUSamplerBindingLayout
  texture?: GPUTextureBindingLayout
  storageTexture?: GPUStorageTextureBindingLayout
}

type GPUShaderStageFlags = number

declare const GPUShaderStage: {
  readonly VERTEX: GPUShaderStageFlags
  readonly FRAGMENT: GPUShaderStageFlags
  readonly COMPUTE: GPUShaderStageFlags
}

interface GPUBufferBindingLayout {
  type?: GPUBufferBindingType | undefined
  hasDynamicOffset?: boolean | undefined
  minBindingSize?: number | undefined
}

type GPUBufferBindingType = 'uniform' | 'storage' | 'read-only-storage'

interface GPUSamplerBindingLayout {
  type?: GPUSamplerBindingType | undefined
}

type GPUSamplerBindingType = 'filtering' | 'non-filtering' | 'comparison'

interface GPUTextureBindingLayout {
  sampleType?: GPUTextureSampleType | undefined
  viewDimension?: GPUTextureViewDimension | undefined
  multisampled?: boolean | undefined
}

type GPUTextureSampleType = 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint'

interface GPUStorageTextureBindingLayout {
  access?: GPUStorageTextureAccess | undefined
  format: GPUTextureFormat
  viewDimension?: GPUTextureViewDimension | undefined
}

type GPUStorageTextureAccess = 'write-only' | 'read-only' | 'read-write'

interface GPUBindGroupLayout {}

// Pipeline Layout
interface GPUPipelineLayoutDescriptor {
  bindGroupLayouts: GPUBindGroupLayout[]
  label?: string
}

interface GPUPipelineLayout {}

// Bind Group
interface GPUBindGroupDescriptor {
  layout: GPUBindGroupLayout
  entries: GPUBindGroupEntry[]
  label?: string
}

interface GPUBindGroupEntry {
  binding: number
  resource: GPUBindingResource
}

type GPUBindingResource = GPUSampler | GPUTextureView | GPUBufferBinding

interface GPUBufferBinding {
  buffer: GPUBuffer
  offset?: number
  size?: number
}

interface GPUBindGroup {}

// Render Pipeline
interface GPURenderPipelineDescriptor {
  layout: GPUPipelineLayout | 'auto'
  vertex: GPUVertexState
  fragment?: GPUFragmentState
  primitive?: GPUPrimitiveState
  depthStencil?: GPUDepthStencilState
  multisample?: GPUMultisampleState
  label?: string
}

interface GPUVertexState extends GPUProgrammableStage {
  buffers?: (GPUVertexBufferLayout | null)[]
}

interface GPUProgrammableStage {
  module: GPUShaderModule
  entryPoint: string
  constants?: Record<string, number>
}

interface GPUVertexBufferLayout {
  arrayStride: number
  stepMode?: GPUVertexStepMode | undefined
  attributes: GPUVertexAttribute[]
}

type GPUVertexStepMode = 'vertex' | 'instance'

interface GPUVertexAttribute {
  format: GPUVertexFormat
  offset: number
  shaderLocation: number
}

type GPUVertexFormat = string

interface GPUFragmentState extends GPUProgrammableStage {
  targets: (GPUColorTargetState | null)[]
}

interface GPUColorTargetState {
  format: GPUTextureFormat
  blend?: GPUBlendState
  writeMask?: GPUColorWriteFlags
}

interface GPUBlendState {
  color: GPUBlendComponent
  alpha: GPUBlendComponent
}

interface GPUBlendComponent {
  srcFactor?: GPUBlendFactor | undefined
  dstFactor?: GPUBlendFactor | undefined
  operation?: GPUBlendOperation | undefined
}

type GPUBlendFactor = string
type GPUBlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max'
type GPUColorWriteFlags = number

declare const GPUColorWrite: {
  readonly RED: GPUColorWriteFlags
  readonly GREEN: GPUColorWriteFlags
  readonly BLUE: GPUColorWriteFlags
  readonly ALPHA: GPUColorWriteFlags
  readonly ALL: GPUColorWriteFlags
}

interface GPUPrimitiveState {
  topology?: GPUPrimitiveTopology | undefined
  stripIndexFormat?: GPUIndexFormat | undefined
  frontFace?: GPUFrontFace | undefined
  cullMode?: GPUCullMode | undefined
  unclippedDepth?: boolean | undefined
}

type GPUPrimitiveTopology = 'point-list' | 'line-list' | 'line-strip' | 'triangle-list' | 'triangle-strip'
type GPUIndexFormat = 'uint16' | 'uint32'
type GPUFrontFace = 'ccw' | 'cw'
type GPUCullMode = 'none' | 'front' | 'back'

interface GPUDepthStencilState {
  format: GPUTextureFormat
  depthWriteEnabled?: boolean | undefined
  depthCompare?: GPUCompareFunction | undefined
  stencilFront?: GPUStencilFaceState | undefined
  stencilBack?: GPUStencilFaceState | undefined
  stencilReadMask?: number | undefined
  stencilWriteMask?: number | undefined
  depthBias?: number | undefined
  depthBiasSlopeScale?: number | undefined
  depthBiasClamp?: number | undefined
}

interface GPUStencilFaceState {
  compare?: GPUCompareFunction | undefined
  failOp?: GPUStencilOperation | undefined
  depthFailOp?: GPUStencilOperation | undefined
  passOp?: GPUStencilOperation | undefined
}

type GPUStencilOperation = 'keep' | 'zero' | 'replace' | 'invert' | 'increment-clamp' | 'decrement-clamp' | 'increment-wrap' | 'decrement-wrap'

interface GPUMultisampleState {
  count?: number | undefined
  mask?: number | undefined
  alphaToCoverageEnabled?: boolean | undefined
}

interface GPURenderPipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout
}

// Compute Pipeline
interface GPUComputePipelineDescriptor {
  layout: GPUPipelineLayout | 'auto'
  compute: GPUProgrammableStage
  label?: string
}

interface GPUComputePipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout
}

// Command Encoder
interface GPUCommandEncoderDescriptor {
  label?: string
}

interface GPUCommandEncoder {
  beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder
  beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder
  copyBufferToBuffer(source: GPUBuffer, sourceOffset: number, destination: GPUBuffer, destinationOffset: number, size: number): void
  copyBufferToTexture(source: GPUImageCopyBuffer, destination: GPUImageCopyTexture, copySize: GPUExtent3DStrict): void
  copyTextureToBuffer(source: GPUImageCopyTexture, destination: GPUImageCopyBuffer, copySize: GPUExtent3DStrict): void
  copyTextureToTexture(source: GPUImageCopyTexture, destination: GPUImageCopyTexture, copySize: GPUExtent3DStrict): void
  finish(descriptor?: GPUCommandBufferDescriptor): GPUCommandBuffer
}

interface GPUCommandBufferDescriptor {
  label?: string
}

interface GPUCommandBuffer {}

// Render Pass
interface GPURenderPassDescriptor {
  colorAttachments: (GPURenderPassColorAttachment | null)[]
  depthStencilAttachment?: GPURenderPassDepthStencilAttachment
  label?: string
}

interface GPURenderPassColorAttachment {
  view: GPUTextureView
  resolveTarget?: GPUTextureView
  clearValue?: GPUColorDict
  loadOp: GPULoadOp
  storeOp: GPUStoreOp
}

interface GPUColorDict {
  r: number
  g: number
  b: number
  a: number
}

type GPULoadOp = 'load' | 'clear'
type GPUStoreOp = 'store' | 'discard'

interface GPURenderPassDepthStencilAttachment {
  view: GPUTextureView
  depthClearValue?: number | undefined
  depthLoadOp?: GPULoadOp | undefined
  depthStoreOp?: GPUStoreOp | undefined
  depthReadOnly?: boolean | undefined
  stencilClearValue?: number | undefined
  stencilLoadOp?: GPULoadOp | undefined
  stencilStoreOp?: GPUStoreOp | undefined
  stencilReadOnly?: boolean | undefined
}

interface GPURenderPassEncoder {
  setPipeline(pipeline: GPURenderPipeline): void
  setBindGroup(index: number, bindGroup: GPUBindGroup, dynamicOffsets?: number[]): void
  setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number, size?: number): void
  setIndexBuffer(buffer: GPUBuffer, indexFormat: GPUIndexFormat, offset?: number, size?: number): void
  setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): void
  setScissorRect(x: number, y: number, width: number, height: number): void
  setBlendConstant(color: GPUColorDict): void
  setStencilReference(reference: number): void
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void
  drawIndexed(indexCount: number, instanceCount?: number, firstIndex?: number, baseVertex?: number, firstInstance?: number): void
  drawIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): void
  drawIndexedIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): void
  end(): void
}

// Compute Pass
interface GPUComputePassDescriptor {
  label?: string
}

interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void
  setBindGroup(index: number, bindGroup: GPUBindGroup, dynamicOffsets?: number[]): void
  dispatchWorkgroups(countX: number, countY?: number, countZ?: number): void
  dispatchWorkgroupsIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): void
  end(): void
}

// Image Copy
interface GPUImageCopyBuffer {
  buffer: GPUBuffer
  offset?: number | undefined
  bytesPerRow: number
  rowsPerImage?: number | undefined
}

interface GPUImageCopyTexture {
  texture: GPUTexture
  mipLevel?: number | undefined
  origin?: [number, number, number] | undefined
  aspect?: GPUTextureAspect | undefined
}

interface GPUImageDataLayout {
  offset?: number
  bytesPerRow: number
  rowsPerImage?: number
}

// Canvas Context
interface GPUCanvasContext {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  configure(configuration: GPUCanvasConfiguration): void
  unconfigure(): void
  getCurrentTexture(): GPUTexture
}

interface GPUCanvasConfiguration {
  device: GPUDevice
  format: GPUTextureFormat
  usage?: GPUTextureUsageFlags
  viewFormats?: GPUTextureFormat[]
  colorSpace?: PredefinedColorSpace
  alphaMode?: GPUCanvasAlphaMode
}

type GPUCanvasAlphaMode = 'opaque' | 'premultiplied'

// Canvas element extension
interface HTMLCanvasElement {
  getContext(contextId: 'webgpu'): GPUCanvasContext | null
}

interface OffscreenCanvas {
  getContext(contextId: 'webgpu'): GPUCanvasContext | null
}
