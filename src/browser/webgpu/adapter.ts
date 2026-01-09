/**
 * browser:webgpu/adapter - GPU adapter discovery
 *
 * Provides functions for discovering GPU adapters and querying
 * their capabilities.
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
  type AdapterHandle,
  type AdapterInfo,
  type AdapterOptions,
  type GPULimitsRecord,
  mapAdapterInfo,
  mapGPULimits,
  mapGPUFeatures,
  featuresToArray,
} from './types.js'

// =============================================================================
// Handle Table
// =============================================================================

/**
 * Generic handle table for managing GPU resources.
 */
export class HandleTable<T extends object> {
  private counter = 1
  private objectToHandle = new WeakMap<T, number>()
  private handleToObject = new Map<number, WeakRef<T>>()
  private registry = new FinalizationRegistry<number>((handle) => {
    this.handleToObject.delete(handle)
  })

  /**
   * Get or create a handle for an object.
   */
  getHandle(obj: T): number {
    let handle = this.objectToHandle.get(obj)
    if (handle === undefined) {
      handle = this.counter++
      this.objectToHandle.set(obj, handle)
      this.handleToObject.set(handle, new WeakRef(obj))
      this.registry.register(obj, handle)
    }
    return handle
  }

  /**
   * Get an object from its handle.
   */
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

  /**
   * Check if a handle exists.
   */
  has(handle: number): boolean {
    return this.getObject(handle) !== null
  }

  /**
   * Release a handle manually.
   */
  release(handle: number): void {
    this.handleToObject.delete(handle)
  }
}

// =============================================================================
// Adapter Manager
// =============================================================================

/**
 * Browser WebGPU adapter manager.
 */
export class BrowserWebGPUAdapter {
  private adapters = new HandleTable<GPUAdapter>()

  /**
   * Check if WebGPU is supported.
   */
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  }

  /**
   * Request a GPU adapter.
   */
  async requestAdapter(
    options?: AdapterOptions
  ): Promise<Result<AdapterHandle | null, BrowserError>> {
    if (!this.isSupported()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'WebGPU is not supported in this environment'
      )
    }

    try {
      const nativeOptions: GPURequestAdapterOptions = {}
      if (options?.powerPreference) {
        nativeOptions.powerPreference = options.powerPreference
      }
      if (options?.forceFallbackAdapter !== undefined) {
        nativeOptions.forceFallbackAdapter = options.forceFallbackAdapter
      }

      const adapter = await navigator.gpu.requestAdapter(nativeOptions)
      if (!adapter) {
        return ok(null)
      }

      return ok(this.adapters.getHandle(adapter))
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        error instanceof Error ? error.message : 'Failed to request adapter'
      )
    }
  }

  /**
   * Get adapter info.
   */
  getAdapterInfo(handle: AdapterHandle): Result<AdapterInfo, BrowserError> {
    const adapter = this.adapters.getObject(handle)
    if (!adapter) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Adapter not found'
      )
    }

    return ok(mapAdapterInfo(adapter.info))
  }

  /**
   * Get adapter features.
   */
  getAdapterFeatures(handle: AdapterHandle): Result<string[], BrowserError> {
    const adapter = this.adapters.getObject(handle)
    if (!adapter) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Adapter not found'
      )
    }

    return ok(featuresToArray(mapGPUFeatures(adapter.features)))
  }

  /**
   * Get adapter limits.
   */
  getAdapterLimits(handle: AdapterHandle): Result<GPULimitsRecord, BrowserError> {
    const adapter = this.adapters.getObject(handle)
    if (!adapter) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Adapter not found'
      )
    }

    return ok(mapGPULimits(adapter.limits))
  }

  /**
   * Check if adapter is a fallback adapter.
   */
  isFallbackAdapter(handle: AdapterHandle): Result<boolean, BrowserError> {
    const adapter = this.adapters.getObject(handle)
    if (!adapter) {
      return browserErr(
        BrowserErrorCode.NOT_FOUND,
        'Adapter not found'
      )
    }

    return ok(adapter.isFallbackAdapter)
  }

  /**
   * Get the native adapter from a handle.
   * Used internally by device manager.
   */
  getNativeAdapter(handle: AdapterHandle): GPUAdapter | null {
    return this.adapters.getObject(handle)
  }

  /**
   * Release an adapter handle.
   */
  releaseAdapter(handle: AdapterHandle): void {
    this.adapters.release(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultAdapter: BrowserWebGPUAdapter | null = null

/**
 * Get the default adapter manager instance.
 */
export function getDefaultAdapterManager(): BrowserWebGPUAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new BrowserWebGPUAdapter()
  }
  return defaultAdapter
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:webgpu/adapter imports object.
 */
export function getBrowserWebGPUAdapterImports(): Record<string, unknown> {
  let manager: BrowserWebGPUAdapter | null = null

  const getManager = (): BrowserWebGPUAdapter => {
    if (!manager) {
      manager = getDefaultAdapterManager()
    }
    return manager
  }

  return {
    'browser:webgpu/adapter': {
      'is-supported': () => getManager().isSupported(),
      'request-adapter': (options?: AdapterOptions) => getManager().requestAdapter(options),
      'get-adapter-info': (handle: AdapterHandle) => getManager().getAdapterInfo(handle),
      'get-adapter-features': (handle: AdapterHandle) => getManager().getAdapterFeatures(handle),
      'get-adapter-limits': (handle: AdapterHandle) => getManager().getAdapterLimits(handle),
      'is-fallback-adapter': (handle: AdapterHandle) => getManager().isFallbackAdapter(handle),
      'release-adapter': (handle: AdapterHandle) => getManager().releaseAdapter(handle),
    },
  }
}
