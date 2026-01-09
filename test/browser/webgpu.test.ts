import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  // Error codes
  WebGPUErrorCode,
  createWebGPUError,
  // Limits and features
  mapGPULimits,
  mapGPUFeatures,
  featuresToArray,
  // HandleTable
  HandleTable,
  // Managers
  BrowserWebGPUAdapter,
  BrowserWebGPUDevice,
  BrowserWebGPUBuffer,
  // Support checks
  isWebGPUSupported,
  getPreferredCanvasFormat,
  // Import getters
  getBrowserWebGPUImports,
  getBrowserWebGPUAdapterImports,
  getBrowserWebGPUDeviceImports,
  getBrowserWebGPUBufferImports,
  getBrowserWebGPUTextureImports,
  getBrowserWebGPUSamplerImports,
  getBrowserWebGPUShaderImports,
  getBrowserWebGPUBindGroupImports,
  getBrowserWebGPUPipelineImports,
  getBrowserWebGPUCommandImports,
  getBrowserWebGPUQueueImports,
  getBrowserWebGPUCanvasContextImports,
} from '../../src/browser/webgpu/index.js'
import { BrowserErrorCode } from '../../src/browser/types.js'

// =============================================================================
// Mock WebGPU globals for Node.js environment
// =============================================================================

const mockGPUBufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
}

const mockGPUTextureUsage = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
}

const mockGPUShaderStage = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
}

const mockGPUColorWrite = {
  RED: 0x1,
  GREEN: 0x2,
  BLUE: 0x4,
  ALPHA: 0x8,
  ALL: 0xf,
}

const mockGPUMapMode = {
  READ: 0x1,
  WRITE: 0x2,
}

// Set up global mocks
beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).GPUBufferUsage = mockGPUBufferUsage
  ;(globalThis as unknown as Record<string, unknown>).GPUTextureUsage = mockGPUTextureUsage
  ;(globalThis as unknown as Record<string, unknown>).GPUShaderStage = mockGPUShaderStage
  ;(globalThis as unknown as Record<string, unknown>).GPUColorWrite = mockGPUColorWrite
  ;(globalThis as unknown as Record<string, unknown>).GPUMapMode = mockGPUMapMode
  ;(globalThis as unknown as Record<string, unknown>).GPUValidationError = class GPUValidationError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'GPUValidationError'
    }
  }
  ;(globalThis as unknown as Record<string, unknown>).GPUOutOfMemoryError = class GPUOutOfMemoryError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'GPUOutOfMemoryError'
    }
  }
  ;(globalThis as unknown as Record<string, unknown>).GPUInternalError = class GPUInternalError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'GPUInternalError'
    }
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).GPUBufferUsage
  delete (globalThis as unknown as Record<string, unknown>).GPUTextureUsage
  delete (globalThis as unknown as Record<string, unknown>).GPUShaderStage
  delete (globalThis as unknown as Record<string, unknown>).GPUColorWrite
  delete (globalThis as unknown as Record<string, unknown>).GPUMapMode
  delete (globalThis as unknown as Record<string, unknown>).GPUValidationError
  delete (globalThis as unknown as Record<string, unknown>).GPUOutOfMemoryError
  delete (globalThis as unknown as Record<string, unknown>).GPUInternalError
})

// =============================================================================
// Type Utilities Tests
// =============================================================================

describe('browser:webgpu/types', () => {
  describe('WebGPUErrorCode', () => {
    it('has correct error codes', () => {
      expect(WebGPUErrorCode.VALIDATION_ERROR).toBe('validation-error')
      expect(WebGPUErrorCode.OUT_OF_MEMORY).toBe('out-of-memory')
      expect(WebGPUErrorCode.INTERNAL_ERROR).toBe('internal-error')
      expect(WebGPUErrorCode.DEVICE_LOST).toBe('device-lost')
      expect(WebGPUErrorCode.ADAPTER_NOT_FOUND).toBe('adapter-not-found')
    })
  })

  describe('createWebGPUError', () => {
    it('creates error with code and message', () => {
      const error = createWebGPUError(WebGPUErrorCode.VALIDATION_ERROR, 'Test error')
      expect(error.code).toBe(WebGPUErrorCode.VALIDATION_ERROR)
      expect(error.message).toBe('Test error')
    })
  })

  describe('mapGPULimits', () => {
    it('maps GPU limits to record', () => {
      const mockLimits = {
        maxTextureDimension1D: 8192,
        maxTextureDimension2D: 8192,
        maxTextureDimension3D: 2048,
        maxTextureArrayLayers: 256,
        maxBindGroups: 4,
        maxBindGroupsPlusVertexBuffers: 24,
        maxBindingsPerBindGroup: 1000,
        maxDynamicUniformBuffersPerPipelineLayout: 8,
        maxDynamicStorageBuffersPerPipelineLayout: 4,
        maxSampledTexturesPerShaderStage: 16,
        maxSamplersPerShaderStage: 16,
        maxStorageBuffersPerShaderStage: 8,
        maxStorageTexturesPerShaderStage: 4,
        maxUniformBuffersPerShaderStage: 12,
        maxUniformBufferBindingSize: 65536,
        maxStorageBufferBindingSize: 134217728,
        minUniformBufferOffsetAlignment: 256,
        minStorageBufferOffsetAlignment: 256,
        maxVertexBuffers: 8,
        maxBufferSize: 268435456,
        maxVertexAttributes: 16,
        maxVertexBufferArrayStride: 2048,
        maxInterStageShaderComponents: 60,
        maxInterStageShaderVariables: 16,
        maxColorAttachments: 8,
        maxColorAttachmentBytesPerSample: 32,
        maxComputeWorkgroupStorageSize: 16384,
        maxComputeInvocationsPerWorkgroup: 256,
        maxComputeWorkgroupSizeX: 256,
        maxComputeWorkgroupSizeY: 256,
        maxComputeWorkgroupSizeZ: 64,
        maxComputeWorkgroupsPerDimension: 65535,
      }

      const result = mapGPULimits(mockLimits as GPUSupportedLimits)
      expect(result['maxTextureDimension1D']).toBe(8192)
      expect(result['maxTextureDimension2D']).toBe(8192)
      expect(result['maxBindGroups']).toBe(4)
    })
  })

  describe('mapGPUFeatures', () => {
    it('maps GPU features to set', () => {
      const mockFeatures = {
        has: (name: string) => name === 'depth-clip-control' || name === 'texture-compression-bc',
        forEach: (cb: (value: string) => void) => {
          cb('depth-clip-control')
          cb('texture-compression-bc')
        },
        [Symbol.iterator]: function* () {
          yield 'depth-clip-control'
          yield 'texture-compression-bc'
        },
      }

      const result = mapGPUFeatures(mockFeatures as unknown as GPUSupportedFeatures)
      expect(result.has('depth-clip-control')).toBe(true)
      expect(result.has('texture-compression-bc')).toBe(true)
    })
  })

  describe('featuresToArray', () => {
    it('converts features set to array', () => {
      const features = new Set(['depth-clip-control', 'texture-compression-bc'])
      const result = featuresToArray(features)
      expect(result).toContain('depth-clip-control')
      expect(result).toContain('texture-compression-bc')
      expect(result.length).toBe(2)
    })
  })
})

// =============================================================================
// HandleTable Tests
// =============================================================================

describe('HandleTable', () => {
  it('generates unique handles for objects', () => {
    const table = new HandleTable<{ id: number }>()
    const obj1 = { id: 1 }
    const obj2 = { id: 2 }

    const handle1 = table.getHandle(obj1)
    const handle2 = table.getHandle(obj2)

    expect(handle1).not.toBe(handle2)
    expect(typeof handle1).toBe('number')
    expect(typeof handle2).toBe('number')
  })

  it('returns same handle for same object', () => {
    const table = new HandleTable<{ id: number }>()
    const obj = { id: 1 }

    const handle1 = table.getHandle(obj)
    const handle2 = table.getHandle(obj)

    expect(handle1).toBe(handle2)
  })

  it('retrieves object from handle', () => {
    const table = new HandleTable<{ id: number }>()
    const obj = { id: 42 }

    const handle = table.getHandle(obj)
    const retrieved = table.getObject(handle)

    expect(retrieved).toBe(obj)
  })

  it('returns null for invalid handle', () => {
    const table = new HandleTable<{ id: number }>()
    const retrieved = table.getObject(99999)
    expect(retrieved).toBeNull()
  })

  it('checks if handle exists', () => {
    const table = new HandleTable<{ id: number }>()
    const obj = { id: 1 }

    const handle = table.getHandle(obj)

    expect(table.has(handle)).toBe(true)
    expect(table.has(99999)).toBe(false)
  })

  it('releases handles', () => {
    const table = new HandleTable<{ id: number }>()
    const obj = { id: 1 }

    const handle = table.getHandle(obj)
    expect(table.has(handle)).toBe(true)

    table.release(handle)
    expect(table.has(handle)).toBe(false)
    expect(table.getObject(handle)).toBeNull()
  })
})

// =============================================================================
// Adapter Manager Tests
// =============================================================================

describe('BrowserWebGPUAdapter', () => {
  let originalNavigator: typeof globalThis.navigator
  let mockGPU: {
    requestAdapter: ReturnType<typeof vi.fn>
    getPreferredCanvasFormat: ReturnType<typeof vi.fn>
  }
  let mockAdapter: {
    features: { has: () => boolean; forEach: () => void; [Symbol.iterator]: () => Generator }
    limits: Record<string, number>
    isFallbackAdapter: boolean
    requestDevice: ReturnType<typeof vi.fn>
    requestAdapterInfo: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    originalNavigator = globalThis.navigator

    mockAdapter = {
      features: {
        has: () => false,
        forEach: () => {},
        *[Symbol.iterator]() {},
      },
      limits: { maxTextureDimension2D: 8192 },
      isFallbackAdapter: false,
      requestDevice: vi.fn(),
      requestAdapterInfo: vi.fn().mockResolvedValue({
        vendor: 'Test Vendor',
        architecture: 'x86',
        device: 'Test Device',
        description: 'Test Description',
      }),
    }

    mockGPU = {
      requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
    }

    Object.defineProperty(globalThis, 'navigator', {
      value: { gpu: mockGPU },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  it('requests adapter successfully', async () => {
    const manager = new BrowserWebGPUAdapter()
    const result = await manager.requestAdapter({})

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.value).toBe('number')
    }
  })

  it('returns null when adapter not available', async () => {
    mockGPU.requestAdapter.mockResolvedValue(null)

    const manager = new BrowserWebGPUAdapter()
    const result = await manager.requestAdapter({})

    // When no adapter is available, the implementation returns ok(null)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBeNull()
    }
  })

  it('gets adapter features', async () => {
    const manager = new BrowserWebGPUAdapter()
    const adapterResult = await manager.requestAdapter({})

    expect(adapterResult.ok).toBe(true)
    if (adapterResult.ok) {
      const features = manager.getAdapterFeatures(adapterResult.value)
      expect(features.ok).toBe(true)
    }
  })

  it('gets adapter limits', async () => {
    const manager = new BrowserWebGPUAdapter()
    const adapterResult = await manager.requestAdapter({})

    expect(adapterResult.ok).toBe(true)
    if (adapterResult.ok) {
      const limits = manager.getAdapterLimits(adapterResult.value)
      expect(limits.ok).toBe(true)
      if (limits.ok) {
        expect(limits.value['maxTextureDimension2D']).toBe(8192)
      }
    }
  })

  it('returns error for invalid adapter handle', () => {
    const manager = new BrowserWebGPUAdapter()
    const features = manager.getAdapterFeatures(99999)
    expect(features.ok).toBe(false)
    if (!features.ok) {
      expect(features.error.code).toBe(BrowserErrorCode.NOT_FOUND)
    }
  })

  it('releases adapter', async () => {
    const manager = new BrowserWebGPUAdapter()
    const adapterResult = await manager.requestAdapter({})

    expect(adapterResult.ok).toBe(true)
    if (adapterResult.ok) {
      manager.releaseAdapter(adapterResult.value)
      const features = manager.getAdapterFeatures(adapterResult.value)
      expect(features.ok).toBe(false)
    }
  })
})

// =============================================================================
// Device Manager Tests
// =============================================================================

describe('BrowserWebGPUDevice', () => {
  let mockDevice: {
    features: { has: () => boolean; forEach: () => void; [Symbol.iterator]: () => Generator }
    limits: Record<string, number>
    queue: { submit: ReturnType<typeof vi.fn> }
    destroy: ReturnType<typeof vi.fn>
    pushErrorScope: ReturnType<typeof vi.fn>
    popErrorScope: ReturnType<typeof vi.fn>
    createBuffer: ReturnType<typeof vi.fn>
  }
  let mockAdapterManager: {
    getNativeAdapter: ReturnType<typeof vi.fn>
    releaseAdapter: ReturnType<typeof vi.fn>
  }
  let mockAdapter: { requestDevice: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockDevice = {
      features: {
        has: () => false,
        forEach: () => {},
        *[Symbol.iterator]() {},
      },
      limits: { maxTextureDimension2D: 8192 },
      queue: { submit: vi.fn() },
      destroy: vi.fn(),
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn().mockResolvedValue(null),
      createBuffer: vi.fn(),
    }

    mockAdapter = {
      requestDevice: vi.fn().mockResolvedValue(mockDevice),
    }

    mockAdapterManager = {
      getNativeAdapter: vi.fn().mockReturnValue(mockAdapter),
      releaseAdapter: vi.fn(),
    }
  })

  it('requests device successfully', async () => {
    const manager = new BrowserWebGPUDevice(mockAdapterManager as unknown as BrowserWebGPUAdapter)
    const result = await manager.requestDevice(1, {})

    expect(result.ok).toBe(true)
    if (result.ok) {
      // requestDevice returns just the device handle
      expect(typeof result.value).toBe('number')
    }
  })

  it('returns error for invalid adapter', async () => {
    mockAdapterManager.getNativeAdapter.mockReturnValue(null)

    const manager = new BrowserWebGPUDevice(mockAdapterManager as unknown as BrowserWebGPUAdapter)
    const result = await manager.requestDevice(999, {})

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(BrowserErrorCode.NOT_FOUND)
    }
  })

  it('gets device features', async () => {
    const manager = new BrowserWebGPUDevice(mockAdapterManager as unknown as BrowserWebGPUAdapter)
    const deviceResult = await manager.requestDevice(1, {})

    expect(deviceResult.ok).toBe(true)
    if (deviceResult.ok) {
      const features = manager.getDeviceFeatures(deviceResult.value)
      expect(features.ok).toBe(true)
    }
  })

  it('gets device limits', async () => {
    const manager = new BrowserWebGPUDevice(mockAdapterManager as unknown as BrowserWebGPUAdapter)
    const deviceResult = await manager.requestDevice(1, {})

    expect(deviceResult.ok).toBe(true)
    if (deviceResult.ok) {
      const limits = manager.getDeviceLimits(deviceResult.value)
      expect(limits.ok).toBe(true)
      if (limits.ok) {
        expect(limits.value['maxTextureDimension2D']).toBe(8192)
      }
    }
  })

  it('destroys device', async () => {
    const manager = new BrowserWebGPUDevice(mockAdapterManager as unknown as BrowserWebGPUAdapter)
    const deviceResult = await manager.requestDevice(1, {})

    expect(deviceResult.ok).toBe(true)
    if (deviceResult.ok) {
      const destroyResult = manager.destroyDevice(deviceResult.value)
      expect(destroyResult.ok).toBe(true)
      expect(mockDevice.destroy).toHaveBeenCalled()
    }
  })
})

// =============================================================================
// Buffer Manager Tests
// =============================================================================

describe('BrowserWebGPUBuffer', () => {
  let mockBuffer: {
    size: number
    usage: number
    mapState: string
    mapAsync: ReturnType<typeof vi.fn>
    getMappedRange: ReturnType<typeof vi.fn>
    unmap: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  let mockDevice: { createBuffer: ReturnType<typeof vi.fn> }
  let mockDeviceManager: {
    getNativeDevice: ReturnType<typeof vi.fn>
    getNativeQueue: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockBuffer = {
      size: 256,
      usage: 0x0021, // MAP_READ | COPY_DST
      mapState: 'unmapped',
      mapAsync: vi.fn().mockResolvedValue(undefined),
      getMappedRange: vi.fn().mockReturnValue(new ArrayBuffer(256)),
      unmap: vi.fn(),
      destroy: vi.fn(),
    }

    mockDevice = {
      createBuffer: vi.fn().mockReturnValue(mockBuffer),
    }

    mockDeviceManager = {
      getNativeDevice: vi.fn().mockReturnValue(mockDevice),
      getNativeQueue: vi.fn().mockReturnValue(null),
    }
  })

  it('creates buffer successfully', () => {
    const manager = new BrowserWebGPUBuffer(mockDeviceManager as unknown as BrowserWebGPUDevice)
    const result = manager.createBuffer(1, {
      size: 256,
      usage: ['map-read', 'copy-dst'],
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.value).toBe('number')
    }
    expect(mockDevice.createBuffer).toHaveBeenCalledWith({
      size: 256,
      usage: mockGPUBufferUsage.MAP_READ | mockGPUBufferUsage.COPY_DST,
      mappedAtCreation: undefined,
      label: undefined,
    })
  })

  it('returns error for invalid device', () => {
    mockDeviceManager.getNativeDevice.mockReturnValue(null)

    const manager = new BrowserWebGPUBuffer(mockDeviceManager as unknown as BrowserWebGPUDevice)
    const result = manager.createBuffer(999, {
      size: 256,
      usage: ['map-read'],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(BrowserErrorCode.NOT_FOUND)
    }
  })

  it('maps buffer', async () => {
    const manager = new BrowserWebGPUBuffer(mockDeviceManager as unknown as BrowserWebGPUDevice)
    const createResult = manager.createBuffer(1, {
      size: 256,
      usage: ['map-read'],
    })

    expect(createResult.ok).toBe(true)
    if (createResult.ok) {
      const mapResult = await manager.mapBuffer(createResult.value, 'read')
      expect(mapResult.ok).toBe(true)
      expect(mockBuffer.mapAsync).toHaveBeenCalled()
    }
  })

  it('gets mapped range', async () => {
    const manager = new BrowserWebGPUBuffer(mockDeviceManager as unknown as BrowserWebGPUDevice)
    const createResult = manager.createBuffer(1, {
      size: 256,
      usage: ['map-read'],
      mappedAtCreation: true,
    })

    expect(createResult.ok).toBe(true)
    if (createResult.ok) {
      const rangeResult = manager.getMappedRange(createResult.value)
      expect(rangeResult.ok).toBe(true)
      if (rangeResult.ok) {
        // getMappedRange returns Uint8Array
        expect(rangeResult.value).toBeInstanceOf(Uint8Array)
      }
    }
  })

  it('unmaps buffer', async () => {
    const manager = new BrowserWebGPUBuffer(mockDeviceManager as unknown as BrowserWebGPUDevice)
    const createResult = manager.createBuffer(1, {
      size: 256,
      usage: ['map-read'],
      mappedAtCreation: true,
    })

    expect(createResult.ok).toBe(true)
    if (createResult.ok) {
      const unmapResult = manager.unmapBuffer(createResult.value)
      expect(unmapResult.ok).toBe(true)
      expect(mockBuffer.unmap).toHaveBeenCalled()
    }
  })

  it('destroys buffer', () => {
    const manager = new BrowserWebGPUBuffer(mockDeviceManager as unknown as BrowserWebGPUDevice)
    const createResult = manager.createBuffer(1, {
      size: 256,
      usage: ['map-read'],
    })

    expect(createResult.ok).toBe(true)
    if (createResult.ok) {
      const destroyResult = manager.destroyBuffer(createResult.value)
      expect(destroyResult.ok).toBe(true)
      expect(mockBuffer.destroy).toHaveBeenCalled()
    }
  })

  it('gets buffer size', () => {
    const manager = new BrowserWebGPUBuffer(mockDeviceManager as unknown as BrowserWebGPUDevice)
    const createResult = manager.createBuffer(1, {
      size: 256,
      usage: ['map-read'],
    })

    expect(createResult.ok).toBe(true)
    if (createResult.ok) {
      const sizeResult = manager.getBufferSize(createResult.value)
      expect(sizeResult.ok).toBe(true)
      if (sizeResult.ok) {
        expect(sizeResult.value).toBe(256)
      }
    }
  })
})

// =============================================================================
// Support Check Tests
// =============================================================================

describe('WebGPU Support Checks', () => {
  let originalNavigator: typeof globalThis.navigator

  beforeEach(() => {
    originalNavigator = globalThis.navigator
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  describe('isWebGPUSupported', () => {
    it('returns true when gpu is available', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          gpu: {
            requestAdapter: vi.fn(),
            getPreferredCanvasFormat: vi.fn(),
          },
        },
        writable: true,
        configurable: true,
      })

      expect(isWebGPUSupported()).toBe(true)
    })

    it('returns false when gpu is not available', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      })

      expect(isWebGPUSupported()).toBe(false)
    })
  })

  describe('getPreferredCanvasFormat', () => {
    it('returns format when WebGPU is supported', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          gpu: {
            requestAdapter: vi.fn(),
            getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
          },
        },
        writable: true,
        configurable: true,
      })

      expect(getPreferredCanvasFormat()).toBe('bgra8unorm')
    })

    it('returns null when WebGPU is not supported', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      })

      expect(getPreferredCanvasFormat()).toBeNull()
    })
  })
})

// =============================================================================
// Import Getter Tests
// =============================================================================

describe('WebGPU Import Getters', () => {
  it('getBrowserWebGPUImports returns combined imports', () => {
    const imports = getBrowserWebGPUImports()
    expect(imports).toBeDefined()
    expect(typeof imports).toBe('object')
  })

  it('getBrowserWebGPUAdapterImports returns adapter interface', () => {
    const imports = getBrowserWebGPUAdapterImports()
    expect(imports['browser:webgpu/adapter']).toBeDefined()
    expect(imports['browser:webgpu/adapter']['request-adapter']).toBeDefined()
  })

  it('getBrowserWebGPUDeviceImports returns device interface', () => {
    const imports = getBrowserWebGPUDeviceImports()
    expect(imports['browser:webgpu/device']).toBeDefined()
    expect(imports['browser:webgpu/device']['request-device']).toBeDefined()
  })

  it('getBrowserWebGPUBufferImports returns buffer interface', () => {
    const imports = getBrowserWebGPUBufferImports()
    expect(imports['browser:webgpu/buffer']).toBeDefined()
    expect(imports['browser:webgpu/buffer']['create-buffer']).toBeDefined()
  })

  it('getBrowserWebGPUTextureImports returns texture interface', () => {
    const imports = getBrowserWebGPUTextureImports()
    expect(imports['browser:webgpu/texture']).toBeDefined()
    expect(imports['browser:webgpu/texture']['create-texture']).toBeDefined()
  })

  it('getBrowserWebGPUSamplerImports returns sampler interface', () => {
    const imports = getBrowserWebGPUSamplerImports()
    expect(imports['browser:webgpu/sampler']).toBeDefined()
    expect(imports['browser:webgpu/sampler']['create-sampler']).toBeDefined()
  })

  it('getBrowserWebGPUShaderImports returns shader interface', () => {
    const imports = getBrowserWebGPUShaderImports()
    expect(imports['browser:webgpu/shader']).toBeDefined()
    expect(imports['browser:webgpu/shader']['create-shader-module']).toBeDefined()
  })

  it('getBrowserWebGPUBindGroupImports returns bind group interface', () => {
    const imports = getBrowserWebGPUBindGroupImports()
    expect(imports['browser:webgpu/bind-group']).toBeDefined()
    expect(imports['browser:webgpu/bind-group']['create-bind-group-layout']).toBeDefined()
  })

  it('getBrowserWebGPUPipelineImports returns pipeline interface', () => {
    const imports = getBrowserWebGPUPipelineImports()
    expect(imports['browser:webgpu/pipeline']).toBeDefined()
    expect(imports['browser:webgpu/pipeline']['create-render-pipeline']).toBeDefined()
  })

  it('getBrowserWebGPUCommandImports returns command interface', () => {
    const imports = getBrowserWebGPUCommandImports()
    expect(imports['browser:webgpu/command']).toBeDefined()
    expect(imports['browser:webgpu/command']['create-command-encoder']).toBeDefined()
  })

  it('getBrowserWebGPUQueueImports returns queue interface', () => {
    const imports = getBrowserWebGPUQueueImports()
    expect(imports['browser:webgpu/queue']).toBeDefined()
    expect(imports['browser:webgpu/queue']['submit']).toBeDefined()
  })

  it('getBrowserWebGPUCanvasContextImports returns canvas context interface', () => {
    const imports = getBrowserWebGPUCanvasContextImports()
    expect(imports['browser:webgpu/canvas-context']).toBeDefined()
    expect(imports['browser:webgpu/canvas-context']['configure']).toBeDefined()
  })
})
