# browser:webgpu Implementation Plan

## Overview

This document outlines the implementation plan for `browser:webgpu`, a capability-scoped interface providing WebAssembly components access to the WebGPU API for GPU compute and rendering.

### Goals

1. **Portable GPU access** - Enable WASM components to use GPU hardware for rendering and compute
2. **Capability-scoped** - Follow existing browser:* security model
3. **Performance-first** - Minimize boundary crossings, support command batching
4. **Memory-safe** - Careful resource lifetime management with handles
5. **Async-native** - Align with WASIP3 async model for pipeline creation and data transfers

### Non-Goals

- 100% WebGPU API coverage in v1 (start with essential features)
- WebGL fallback (separate interface if needed)
- Low-level memory management bypass

---

## Architecture

### File Structure

```
src/browser/
├── webgpu/
│   ├── index.ts              # Main entry point, exports
│   ├── types.ts              # WebGPU-specific types
│   ├── adapter.ts            # GPU adapter discovery
│   ├── device.ts             # Device creation and management
│   ├── buffer.ts             # Buffer operations
│   ├── texture.ts            # Texture operations
│   ├── sampler.ts            # Sampler creation
│   ├── shader.ts             # Shader module compilation
│   ├── pipeline.ts           # Render/compute pipeline creation
│   ├── bind-group.ts         # Bind group management
│   ├── command.ts            # Command encoder and passes
│   ├── queue.ts              # Queue submission
│   └── canvas-context.ts     # Canvas WebGPU context
└── webgpu.ts                 # Re-export for browser/index.ts
```

### Handle Types

Following the pattern from `browser:canvas`, all GPU resources use numeric handles:

```typescript
// Resource handles (all are opaque numbers)
export type AdapterHandle = number
export type DeviceHandle = number
export type BufferHandle = number
export type TextureHandle = number
export type TextureViewHandle = number
export type SamplerHandle = number
export type ShaderModuleHandle = number
export type BindGroupLayoutHandle = number
export type BindGroupHandle = number
export type PipelineLayoutHandle = number
export type RenderPipelineHandle = number
export type ComputePipelineHandle = number
export type CommandEncoderHandle = number
export type RenderPassEncoderHandle = number
export type ComputePassEncoderHandle = number
export type CommandBufferHandle = number
export type QuerySetHandle = number
export type CanvasContextHandle = number
```

### Error Codes

Extend `BrowserErrorCode` or use WebGPU-specific codes:

```typescript
export enum WebGPUErrorCode {
  // Existing browser codes
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
```

---

## Phase 1: Core Infrastructure (~800 LOC)

### 1.1 Types and Handle Management

```typescript
// types.ts
export interface GPULimits {
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
  maxComputeWorkgroupStorageSize: number
  maxComputeInvocationsPerWorkgroup: number
  maxComputeWorkgroupSizeX: number
  maxComputeWorkgroupSizeY: number
  maxComputeWorkgroupSizeZ: number
  maxComputeWorkgroupsPerDimension: number
}

export interface GPUFeatures {
  depthClipControl: boolean
  depth32FloatStencil8: boolean
  textureCompressionBC: boolean
  textureCompressionETC2: boolean
  textureCompressionASTC: boolean
  timestampQuery: boolean
  indirectFirstInstance: boolean
  shaderF16: boolean
  rg11b10UfloatRenderable: boolean
  bgra8UnormStorage: boolean
  float32Filterable: boolean
}

export type GPUPowerPreference = 'low-power' | 'high-performance'

export interface AdapterInfo {
  vendor: string
  architecture: string
  device: string
  description: string
}
```

### 1.2 Adapter Discovery

```typescript
// adapter.ts
export class BrowserWebGPUAdapter {
  private handleCounter = 1
  private adapters = new Map<AdapterHandle, WeakRef<GPUAdapter>>()

  /**
   * Check if WebGPU is supported.
   */
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  }

  /**
   * Request a GPU adapter.
   */
  async requestAdapter(options?: {
    powerPreference?: GPUPowerPreference
    forceFallbackAdapter?: boolean
  }): Promise<Result<AdapterHandle | null, BrowserError>>

  /**
   * Get adapter info.
   */
  getAdapterInfo(handle: AdapterHandle): Result<AdapterInfo, BrowserError>

  /**
   * Get adapter features.
   */
  getAdapterFeatures(handle: AdapterHandle): Result<GPUFeatures, BrowserError>

  /**
   * Get adapter limits.
   */
  getAdapterLimits(handle: AdapterHandle): Result<GPULimits, BrowserError>

  /**
   * Check if adapter is a fallback adapter.
   */
  isFallbackAdapter(handle: AdapterHandle): Result<boolean, BrowserError>
}
```

### 1.3 Device Creation

```typescript
// device.ts
export interface DeviceDescriptor {
  requiredFeatures?: string[]
  requiredLimits?: Partial<GPULimits>
  defaultQueue?: { label?: string }
  label?: string
}

export class BrowserWebGPUDevice {
  private handleCounter = 1
  private devices = new Map<DeviceHandle, WeakRef<GPUDevice>>()
  private deviceLostCallbacks = new Map<DeviceHandle, (reason: string) => void>()

  /**
   * Request a device from an adapter.
   */
  async requestDevice(
    adapterHandle: AdapterHandle,
    descriptor?: DeviceDescriptor
  ): Promise<Result<DeviceHandle, BrowserError>>

  /**
   * Get device features.
   */
  getDeviceFeatures(handle: DeviceHandle): Result<GPUFeatures, BrowserError>

  /**
   * Get device limits.
   */
  getDeviceLimits(handle: DeviceHandle): Result<GPULimits, BrowserError>

  /**
   * Get the device queue handle.
   */
  getDeviceQueue(handle: DeviceHandle): Result<QueueHandle, BrowserError>

  /**
   * Check if device is lost.
   */
  isDeviceLost(handle: DeviceHandle): Result<boolean, BrowserError>

  /**
   * Destroy a device.
   */
  destroyDevice(handle: DeviceHandle): Result<void, BrowserError>

  /**
   * Register device lost callback (returns stream).
   */
  onDeviceLost(handle: DeviceHandle): Stream<{ reason: string; message: string }>
}
```

---

## Phase 2: Buffers and Textures (~600 LOC)

### 2.1 Buffer Operations

```typescript
// buffer.ts
export type BufferUsage =
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

export interface BufferDescriptor {
  size: number
  usage: BufferUsage[]
  mappedAtCreation?: boolean
  label?: string
}

export class BrowserWebGPUBuffer {
  /**
   * Create a buffer.
   */
  createBuffer(
    deviceHandle: DeviceHandle,
    descriptor: BufferDescriptor
  ): Result<BufferHandle, BrowserError>

  /**
   * Map buffer for CPU access.
   */
  async mapBuffer(
    handle: BufferHandle,
    mode: 'read' | 'write',
    offset?: number,
    size?: number
  ): Promise<Result<void, BrowserError>>

  /**
   * Get mapped range as bytes.
   */
  getMappedRange(
    handle: BufferHandle,
    offset?: number,
    size?: number
  ): Result<Uint8Array, BrowserError>

  /**
   * Unmap buffer.
   */
  unmapBuffer(handle: BufferHandle): Result<void, BrowserError>

  /**
   * Write data to buffer (via queue).
   */
  writeBuffer(
    queueHandle: QueueHandle,
    bufferHandle: BufferHandle,
    offset: number,
    data: Uint8Array
  ): Result<void, BrowserError>

  /**
   * Destroy buffer.
   */
  destroyBuffer(handle: BufferHandle): Result<void, BrowserError>
}
```

### 2.2 Texture Operations

```typescript
// texture.ts
export type TextureFormat =
  | 'rgba8unorm' | 'rgba8snorm' | 'rgba8uint' | 'rgba8sint'
  | 'bgra8unorm' | 'bgra8unorm-srgb'
  | 'rgba16float' | 'rgba32float'
  | 'depth16unorm' | 'depth24plus' | 'depth24plus-stencil8' | 'depth32float'
  // ... other formats

export type TextureUsage =
  | 'copy-src'
  | 'copy-dst'
  | 'texture-binding'
  | 'storage-binding'
  | 'render-attachment'

export interface TextureDescriptor {
  size: { width: number; height: number; depthOrArrayLayers?: number }
  mipLevelCount?: number
  sampleCount?: number
  dimension?: '1d' | '2d' | '3d'
  format: TextureFormat
  usage: TextureUsage[]
  viewFormats?: TextureFormat[]
  label?: string
}

export interface TextureViewDescriptor {
  format?: TextureFormat
  dimension?: '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d'
  aspect?: 'all' | 'stencil-only' | 'depth-only'
  baseMipLevel?: number
  mipLevelCount?: number
  baseArrayLayer?: number
  arrayLayerCount?: number
  label?: string
}

export class BrowserWebGPUTexture {
  createTexture(
    deviceHandle: DeviceHandle,
    descriptor: TextureDescriptor
  ): Result<TextureHandle, BrowserError>

  createTextureView(
    textureHandle: TextureHandle,
    descriptor?: TextureViewDescriptor
  ): Result<TextureViewHandle, BrowserError>

  writeTexture(
    queueHandle: QueueHandle,
    destination: { texture: TextureHandle; mipLevel?: number; origin?: [number, number, number] },
    data: Uint8Array,
    dataLayout: { offset?: number; bytesPerRow: number; rowsPerImage?: number },
    size: { width: number; height: number; depthOrArrayLayers?: number }
  ): Result<void, BrowserError>

  copyTextureToBuffer(
    encoderHandle: CommandEncoderHandle,
    source: { texture: TextureHandle; mipLevel?: number; origin?: [number, number, number] },
    destination: { buffer: BufferHandle; offset?: number; bytesPerRow: number; rowsPerImage?: number },
    size: { width: number; height: number; depthOrArrayLayers?: number }
  ): Result<void, BrowserError>

  destroyTexture(handle: TextureHandle): Result<void, BrowserError>
}
```

### 2.3 Sampler

```typescript
// sampler.ts
export type FilterMode = 'nearest' | 'linear'
export type MipmapFilterMode = 'nearest' | 'linear'
export type AddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat'
export type CompareFunction = 'never' | 'less' | 'equal' | 'less-equal' | 'greater' | 'not-equal' | 'greater-equal' | 'always'

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

export class BrowserWebGPUSampler {
  createSampler(
    deviceHandle: DeviceHandle,
    descriptor?: SamplerDescriptor
  ): Result<SamplerHandle, BrowserError>
}
```

---

## Phase 3: Shaders and Pipelines (~700 LOC)

### 3.1 Shader Modules

```typescript
// shader.ts
export interface ShaderModuleDescriptor {
  code: string  // WGSL source
  label?: string
  hints?: Record<string, { layout: PipelineLayoutHandle | 'auto' }>
}

export interface CompilationMessage {
  message: string
  type: 'error' | 'warning' | 'info'
  lineNum?: number
  linePos?: number
  offset?: number
  length?: number
}

export class BrowserWebGPUShader {
  /**
   * Create a shader module from WGSL code.
   */
  createShaderModule(
    deviceHandle: DeviceHandle,
    descriptor: ShaderModuleDescriptor
  ): Result<ShaderModuleHandle, BrowserError>

  /**
   * Get compilation info (async - may need to wait for compilation).
   */
  async getCompilationInfo(
    handle: ShaderModuleHandle
  ): Promise<Result<CompilationMessage[], BrowserError>>
}
```

### 3.2 Pipeline Layouts and Bind Groups

```typescript
// bind-group.ts
export type BufferBindingType = 'uniform' | 'storage' | 'read-only-storage'
export type SamplerBindingType = 'filtering' | 'non-filtering' | 'comparison'
export type TextureSampleType = 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint'
export type StorageTextureAccess = 'write-only' | 'read-only' | 'read-write'

export interface BindGroupLayoutEntry {
  binding: number
  visibility: ('vertex' | 'fragment' | 'compute')[]
  buffer?: { type?: BufferBindingType; hasDynamicOffset?: boolean; minBindingSize?: number }
  sampler?: { type?: SamplerBindingType }
  texture?: { sampleType?: TextureSampleType; viewDimension?: string; multisampled?: boolean }
  storageTexture?: { access?: StorageTextureAccess; format: TextureFormat; viewDimension?: string }
}

export interface BindGroupEntry {
  binding: number
  resource:
    | { buffer: BufferHandle; offset?: number; size?: number }
    | { sampler: SamplerHandle }
    | { textureView: TextureViewHandle }
}

export class BrowserWebGPUBindGroup {
  createBindGroupLayout(
    deviceHandle: DeviceHandle,
    entries: BindGroupLayoutEntry[],
    label?: string
  ): Result<BindGroupLayoutHandle, BrowserError>

  createPipelineLayout(
    deviceHandle: DeviceHandle,
    bindGroupLayouts: BindGroupLayoutHandle[],
    label?: string
  ): Result<PipelineLayoutHandle, BrowserError>

  createBindGroup(
    deviceHandle: DeviceHandle,
    layout: BindGroupLayoutHandle,
    entries: BindGroupEntry[],
    label?: string
  ): Result<BindGroupHandle, BrowserError>
}
```

### 3.3 Render Pipeline

```typescript
// pipeline.ts
export type PrimitiveTopology = 'point-list' | 'line-list' | 'line-strip' | 'triangle-list' | 'triangle-strip'
export type FrontFace = 'ccw' | 'cw'
export type CullMode = 'none' | 'front' | 'back'
export type BlendFactor = 'zero' | 'one' | 'src' | 'one-minus-src' | 'src-alpha' | 'one-minus-src-alpha' | 'dst' | 'one-minus-dst' | 'dst-alpha' | 'one-minus-dst-alpha' | 'src-alpha-saturated' | 'constant' | 'one-minus-constant'
export type BlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max'
export type VertexFormat = 'uint8x2' | 'uint8x4' | 'sint8x2' | 'sint8x4' | 'unorm8x2' | 'unorm8x4' | 'snorm8x2' | 'snorm8x4' | 'uint16x2' | 'uint16x4' | 'sint16x2' | 'sint16x4' | 'unorm16x2' | 'unorm16x4' | 'snorm16x2' | 'snorm16x4' | 'float16x2' | 'float16x4' | 'float32' | 'float32x2' | 'float32x3' | 'float32x4' | 'uint32' | 'uint32x2' | 'uint32x3' | 'uint32x4' | 'sint32' | 'sint32x2' | 'sint32x3' | 'sint32x4'

export interface VertexAttribute {
  format: VertexFormat
  offset: number
  shaderLocation: number
}

export interface VertexBufferLayout {
  arrayStride: number
  stepMode?: 'vertex' | 'instance'
  attributes: VertexAttribute[]
}

export interface RenderPipelineDescriptor {
  layout: PipelineLayoutHandle | 'auto'
  vertex: {
    module: ShaderModuleHandle
    entryPoint: string
    buffers?: VertexBufferLayout[]
    constants?: Record<string, number>
  }
  fragment?: {
    module: ShaderModuleHandle
    entryPoint: string
    targets: Array<{
      format: TextureFormat
      blend?: {
        color: { srcFactor?: BlendFactor; dstFactor?: BlendFactor; operation?: BlendOperation }
        alpha: { srcFactor?: BlendFactor; dstFactor?: BlendFactor; operation?: BlendOperation }
      }
      writeMask?: number
    }>
    constants?: Record<string, number>
  }
  primitive?: {
    topology?: PrimitiveTopology
    stripIndexFormat?: 'uint16' | 'uint32'
    frontFace?: FrontFace
    cullMode?: CullMode
    unclippedDepth?: boolean
  }
  depthStencil?: {
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
  multisample?: {
    count?: number
    mask?: number
    alphaToCoverageEnabled?: boolean
  }
  label?: string
}

export class BrowserWebGPUPipeline {
  /**
   * Create render pipeline (async for shader compilation).
   */
  async createRenderPipeline(
    deviceHandle: DeviceHandle,
    descriptor: RenderPipelineDescriptor
  ): Promise<Result<RenderPipelineHandle, BrowserError>>

  /**
   * Create compute pipeline.
   */
  async createComputePipeline(
    deviceHandle: DeviceHandle,
    descriptor: ComputePipelineDescriptor
  ): Promise<Result<ComputePipelineHandle, BrowserError>>

  /**
   * Get bind group layout from auto-layout pipeline.
   */
  getBindGroupLayout(
    pipelineHandle: RenderPipelineHandle | ComputePipelineHandle,
    index: number
  ): Result<BindGroupLayoutHandle, BrowserError>
}
```

---

## Phase 4: Command Encoding and Rendering (~800 LOC)

### 4.1 Command Encoder

```typescript
// command.ts
export interface RenderPassColorAttachment {
  view: TextureViewHandle
  resolveTarget?: TextureViewHandle
  clearValue?: { r: number; g: number; b: number; a: number }
  loadOp: 'load' | 'clear'
  storeOp: 'store' | 'discard'
}

export interface RenderPassDepthStencilAttachment {
  view: TextureViewHandle
  depthClearValue?: number
  depthLoadOp?: 'load' | 'clear'
  depthStoreOp?: 'store' | 'discard'
  depthReadOnly?: boolean
  stencilClearValue?: number
  stencilLoadOp?: 'load' | 'clear'
  stencilStoreOp?: 'store' | 'discard'
  stencilReadOnly?: boolean
}

export interface RenderPassDescriptor {
  colorAttachments: (RenderPassColorAttachment | null)[]
  depthStencilAttachment?: RenderPassDepthStencilAttachment
  occlusionQuerySet?: QuerySetHandle
  timestampWrites?: {
    querySet: QuerySetHandle
    beginningOfPassWriteIndex?: number
    endOfPassWriteIndex?: number
  }
  label?: string
}

export class BrowserWebGPUCommand {
  createCommandEncoder(
    deviceHandle: DeviceHandle,
    label?: string
  ): Result<CommandEncoderHandle, BrowserError>

  beginRenderPass(
    encoderHandle: CommandEncoderHandle,
    descriptor: RenderPassDescriptor
  ): Result<RenderPassEncoderHandle, BrowserError>

  beginComputePass(
    encoderHandle: CommandEncoderHandle,
    label?: string
  ): Result<ComputePassEncoderHandle, BrowserError>

  finishEncoder(
    encoderHandle: CommandEncoderHandle
  ): Result<CommandBufferHandle, BrowserError>

  // Copy operations
  copyBufferToBuffer(
    encoderHandle: CommandEncoderHandle,
    source: BufferHandle,
    sourceOffset: number,
    destination: BufferHandle,
    destinationOffset: number,
    size: number
  ): Result<void, BrowserError>

  copyBufferToTexture(...)
  copyTextureToBuffer(...)
  copyTextureToTexture(...)
}
```

### 4.2 Render Pass

```typescript
// Render pass operations
export class BrowserWebGPURenderPass {
  setPipeline(
    passHandle: RenderPassEncoderHandle,
    pipelineHandle: RenderPipelineHandle
  ): Result<void, BrowserError>

  setBindGroup(
    passHandle: RenderPassEncoderHandle,
    index: number,
    bindGroupHandle: BindGroupHandle,
    dynamicOffsets?: number[]
  ): Result<void, BrowserError>

  setVertexBuffer(
    passHandle: RenderPassEncoderHandle,
    slot: number,
    bufferHandle: BufferHandle,
    offset?: number,
    size?: number
  ): Result<void, BrowserError>

  setIndexBuffer(
    passHandle: RenderPassEncoderHandle,
    bufferHandle: BufferHandle,
    format: 'uint16' | 'uint32',
    offset?: number,
    size?: number
  ): Result<void, BrowserError>

  setViewport(
    passHandle: RenderPassEncoderHandle,
    x: number, y: number, width: number, height: number,
    minDepth: number, maxDepth: number
  ): Result<void, BrowserError>

  setScissorRect(
    passHandle: RenderPassEncoderHandle,
    x: number, y: number, width: number, height: number
  ): Result<void, BrowserError>

  draw(
    passHandle: RenderPassEncoderHandle,
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number
  ): Result<void, BrowserError>

  drawIndexed(
    passHandle: RenderPassEncoderHandle,
    indexCount: number,
    instanceCount?: number,
    firstIndex?: number,
    baseVertex?: number,
    firstInstance?: number
  ): Result<void, BrowserError>

  drawIndirect(...)
  drawIndexedIndirect(...)

  endRenderPass(passHandle: RenderPassEncoderHandle): Result<void, BrowserError>
}
```

### 4.3 Compute Pass

```typescript
export class BrowserWebGPUComputePass {
  setPipeline(
    passHandle: ComputePassEncoderHandle,
    pipelineHandle: ComputePipelineHandle
  ): Result<void, BrowserError>

  setBindGroup(
    passHandle: ComputePassEncoderHandle,
    index: number,
    bindGroupHandle: BindGroupHandle,
    dynamicOffsets?: number[]
  ): Result<void, BrowserError>

  dispatchWorkgroups(
    passHandle: ComputePassEncoderHandle,
    countX: number,
    countY?: number,
    countZ?: number
  ): Result<void, BrowserError>

  dispatchWorkgroupsIndirect(
    passHandle: ComputePassEncoderHandle,
    indirectBuffer: BufferHandle,
    indirectOffset: number
  ): Result<void, BrowserError>

  endComputePass(passHandle: ComputePassEncoderHandle): Result<void, BrowserError>
}
```

### 4.4 Queue Operations

```typescript
// queue.ts
export class BrowserWebGPUQueue {
  /**
   * Submit command buffers.
   */
  submit(
    queueHandle: QueueHandle,
    commandBuffers: CommandBufferHandle[]
  ): Result<void, BrowserError>

  /**
   * Wait for all submitted work to complete.
   */
  async onSubmittedWorkDone(queueHandle: QueueHandle): Promise<Result<void, BrowserError>>

  /**
   * Write to buffer (convenience method).
   */
  writeBuffer(
    queueHandle: QueueHandle,
    buffer: BufferHandle,
    bufferOffset: number,
    data: Uint8Array,
    dataOffset?: number,
    size?: number
  ): Result<void, BrowserError>

  /**
   * Write to texture (convenience method).
   */
  writeTexture(
    queueHandle: QueueHandle,
    destination: { texture: TextureHandle; mipLevel?: number; origin?: [number, number, number]; aspect?: string },
    data: Uint8Array,
    dataLayout: { offset?: number; bytesPerRow: number; rowsPerImage?: number },
    size: { width: number; height: number; depthOrArrayLayers?: number }
  ): Result<void, BrowserError>
}
```

---

## Phase 5: Canvas Integration (~300 LOC)

### 5.1 Canvas Context

```typescript
// canvas-context.ts
export interface CanvasContextConfiguration {
  device: DeviceHandle
  format: TextureFormat
  usage?: TextureUsage[]
  viewFormats?: TextureFormat[]
  colorSpace?: 'srgb' | 'display-p3'
  alphaMode?: 'opaque' | 'premultiplied'
}

export class BrowserWebGPUCanvasContext {
  /**
   * Get WebGPU context from canvas (via browser:canvas handle).
   */
  getContext(
    canvasHandle: CanvasHandle
  ): Result<CanvasContextHandle, BrowserError>

  /**
   * Configure the context.
   */
  configure(
    contextHandle: CanvasContextHandle,
    config: CanvasContextConfiguration
  ): Result<void, BrowserError>

  /**
   * Unconfigure the context.
   */
  unconfigure(contextHandle: CanvasContextHandle): Result<void, BrowserError>

  /**
   * Get current texture for rendering.
   */
  getCurrentTexture(contextHandle: CanvasContextHandle): Result<TextureHandle, BrowserError>

  /**
   * Get preferred format for this canvas.
   */
  getPreferredFormat(contextHandle: CanvasContextHandle): Result<TextureFormat, BrowserError>
}
```

---

## Phase 6: Command Batching (~400 LOC)

For performance, support batched commands similar to `browser:canvas`:

```typescript
// Batched render commands
export type RenderCommand =
  | { type: 'set-pipeline'; pipeline: RenderPipelineHandle }
  | { type: 'set-bind-group'; index: number; bindGroup: BindGroupHandle; dynamicOffsets?: number[] }
  | { type: 'set-vertex-buffer'; slot: number; buffer: BufferHandle; offset?: number; size?: number }
  | { type: 'set-index-buffer'; buffer: BufferHandle; format: 'uint16' | 'uint32'; offset?: number; size?: number }
  | { type: 'set-viewport'; x: number; y: number; width: number; height: number; minDepth: number; maxDepth: number }
  | { type: 'set-scissor-rect'; x: number; y: number; width: number; height: number }
  | { type: 'draw'; vertexCount: number; instanceCount?: number; firstVertex?: number; firstInstance?: number }
  | { type: 'draw-indexed'; indexCount: number; instanceCount?: number; firstIndex?: number; baseVertex?: number; firstInstance?: number }

export function executeRenderCommands(
  passHandle: RenderPassEncoderHandle,
  commands: RenderCommand[]
): Result<void, BrowserError>

// Batched compute commands
export type ComputeCommand =
  | { type: 'set-pipeline'; pipeline: ComputePipelineHandle }
  | { type: 'set-bind-group'; index: number; bindGroup: BindGroupHandle; dynamicOffsets?: number[] }
  | { type: 'dispatch-workgroups'; countX: number; countY?: number; countZ?: number }

export function executeComputeCommands(
  passHandle: ComputePassEncoderHandle,
  commands: ComputeCommand[]
): Result<void, BrowserError>
```

---

## Resource Management

### Handle Tables

Each resource type has its own handle table using `WeakRef` for memory efficiency:

```typescript
class HandleTable<T extends object> {
  private counter = 1
  private objectToHandle = new WeakMap<T, number>()
  private handleToObject = new Map<number, WeakRef<T>>()
  private finalizationRegistry = new FinalizationRegistry<number>((handle) => {
    this.handleToObject.delete(handle)
  })

  getHandle(obj: T): number {
    let handle = this.objectToHandle.get(obj)
    if (handle === undefined) {
      handle = this.counter++
      this.objectToHandle.set(obj, handle)
      this.handleToObject.set(handle, new WeakRef(obj))
      this.finalizationRegistry.register(obj, handle)
    }
    return handle
  }

  getObject(handle: number): T | null {
    const ref = this.handleToObject.get(handle)
    if (!ref) return null
    const obj = ref.deref()
    if (!obj) {
      this.handleToObject.delete(handle)
      return null
    }
    return obj
  }

  release(handle: number): void {
    this.handleToObject.delete(handle)
  }
}
```

### Device Lost Handling

```typescript
// Stream-based device lost notification
export function watchDeviceLost(deviceHandle: DeviceHandle): Stream<DeviceLostInfo> {
  const device = getDevice(deviceHandle)
  if (!device) {
    return createErrorStream('Device not found')
  }

  return createStreamFromPromise(device.lost.then(info => ({
    reason: info.reason,
    message: info.message,
  })))
}
```

---

## Estimated Implementation Size

| Phase | Component | Est. LOC |
|-------|-----------|----------|
| 1 | Types, Adapter, Device | 800 |
| 2 | Buffer, Texture, Sampler | 600 |
| 3 | Shader, BindGroup, Pipeline | 700 |
| 4 | Command Encoder, Passes, Queue | 800 |
| 5 | Canvas Context | 300 |
| 6 | Command Batching | 400 |
| - | Tests | 1500 |
| **Total** | | **~5100** |

---

## WIT Interface Definition (Future)

```wit
// browser-webgpu.wit
package browser:webgpu@0.1.0;

interface gpu {
  // Resource handles
  type adapter-handle = u32;
  type device-handle = u32;
  type buffer-handle = u32;
  type texture-handle = u32;
  // ...

  // Error type
  record gpu-error {
    code: gpu-error-code,
    message: string,
  }

  // Adapter discovery
  is-supported: func() -> bool;
  request-adapter: async func(options: option<adapter-options>) -> result<option<adapter-handle>, gpu-error>;

  // Device creation
  request-device: async func(adapter: adapter-handle, descriptor: option<device-descriptor>) -> result<device-handle, gpu-error>;

  // Buffer operations
  create-buffer: func(device: device-handle, descriptor: buffer-descriptor) -> result<buffer-handle, gpu-error>;
  // ...
}
```

---

## Testing Strategy

### Unit Tests

- Handle table lifecycle
- Type conversions
- Error mapping
- Each resource type creation/destruction

### Integration Tests

- Full render pipeline (adapter → device → pipeline → render)
- Compute pipeline with buffer readback
- Canvas context rendering
- Device lost handling
- Memory pressure scenarios

### Browser Compatibility

- Chrome (primary target - best WebGPU support)
- Firefox (behind flag)
- Safari (partial support)

---

## Security Considerations

1. **No direct memory access** - All buffer operations go through handles
2. **Validation** - Validate all descriptors before passing to WebGPU
3. **Resource limits** - Respect device limits, fail gracefully
4. **Device isolation** - Each WASM component should ideally get its own device
5. **Error information** - Don't leak sensitive info in error messages

---

## Future Enhancements

1. **WebGPU 2.0 features** as they become available
2. **Render bundle** support for static command recording
3. **Query sets** for occlusion and timestamp queries
4. **External texture** support for video frames
5. **Memory budget** APIs for resource management hints

---

## Dependencies

- `browser:canvas` - For canvas handle integration
- `browser:types` - For Result, BrowserError types
- `browser:runtime` - For feature detection

---

## Implementation Order

1. **Phase 1** - Get minimal "triangle on screen" working
2. **Phase 2** - Add buffer/texture support for real rendering
3. **Phase 3** - Shader and pipeline flexibility
4. **Phase 4** - Full command encoding
5. **Phase 5** - Canvas integration polish
6. **Phase 6** - Performance optimization with batching
