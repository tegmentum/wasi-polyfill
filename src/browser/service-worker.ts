/**
 * browser:service-worker - Service worker registration interface
 *
 * Provides a minimal capability-scoped interface to the Service Worker API
 * for registering and managing service workers.
 *
 * Note: Service workers require a secure context (HTTPS) and are not
 * available in all contexts (file://, sandboxed iframes, etc.).
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  mapErrorToBrowserError,
  type Result,
  ok,
  browserErr,
} from './types.js'
import { isSecureContext, supports, isMainThread } from './runtime.js'
import { WeakHandleRegistry } from '../shared/registry.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Handle to a service worker registration.
 */
export type RegistrationHandle = number

/**
 * Handle to a service worker.
 */
export type ServiceWorkerHandle = number

/**
 * Service worker state.
 */
export type ServiceWorkerState =
  | 'parsed'
  | 'installing'
  | 'installed'
  | 'activating'
  | 'activated'
  | 'redundant'

/**
 * Service worker update via cache mode.
 */
export type UpdateViaCache = 'imports' | 'all' | 'none'

/**
 * Service worker registration options.
 */
export interface RegistrationOptions {
  /** Scope URL for the registration */
  scope?: string
  /** Script type (classic or module) */
  type?: 'classic' | 'module'
  /** Update via cache mode */
  updateViaCache?: UpdateViaCache
}

/**
 * Service worker info.
 */
export interface ServiceWorkerInfo {
  /** Script URL */
  scriptUrl: string
  /** Current state */
  state: ServiceWorkerState
}

/**
 * Service worker registration info.
 */
export interface RegistrationInfo {
  /** Registration scope */
  scope: string
  /** Update via cache mode */
  updateViaCache: UpdateViaCache
  /** Installing worker (if any) */
  installing: ServiceWorkerInfo | null
  /** Waiting worker (if any) */
  waiting: ServiceWorkerInfo | null
  /** Active worker (if any) */
  active: ServiceWorkerInfo | null
}

/**
 * Service worker registration event.
 */
export type RegistrationEvent =
  | { type: 'updatefound' }
  | { type: 'statechange'; state: ServiceWorkerState }

/**
 * Service worker options.
 */
export interface ServiceWorkerOptions {
  /** Base URL for resolving relative script URLs */
  baseUrl?: string
}

// =============================================================================
// Browser Service Worker
// =============================================================================

/**
 * Browser service worker implementation.
 */
export class BrowserServiceWorker {
  private baseUrl: string
  private readonly registrations = new WeakHandleRegistry<ServiceWorkerRegistration>(1)
  private readonly workers = new WeakHandleRegistry<ServiceWorker>(1)

  constructor(options: ServiceWorkerOptions = {}) {
    this.baseUrl = options.baseUrl ?? (typeof location !== 'undefined' ? location.href : '')
  }

  /**
   * Check service worker requirements.
   */
  private checkRequirements(): Result<void, BrowserError> {
    if (!isSecureContext()) {
      return browserErr(
        BrowserErrorCode.INSECURE_CONTEXT,
        'Service workers require a secure context (HTTPS)'
      )
    }

    if (!supports('browser:service-worker')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Service Worker API is not supported in this environment (may be file://, sandboxed iframe, or unsupported browser)'
      )
    }

    if (!isMainThread()) {
      return browserErr(
        BrowserErrorCode.WRONG_THREAD,
        'Service worker registration must be done from the main thread'
      )
    }

    return ok(undefined)
  }

  /**
   * Get or create a handle for a registration.
   */
  private getRegistrationHandle(registration: ServiceWorkerRegistration): RegistrationHandle {
    return this.registrations.handleFor(registration)
  }

  /**
   * Get a registration from its handle.
   */
  private getRegistration(handle: RegistrationHandle): ServiceWorkerRegistration | null {
    return this.registrations.get(handle) ?? null
  }

  /**
   * Get or create a handle for a service worker.
   */
  private getWorkerHandle(worker: ServiceWorker): ServiceWorkerHandle {
    return this.workers.handleFor(worker)
  }

  /**
   * Get a service worker from its handle.
   */
  private getWorker(handle: ServiceWorkerHandle): ServiceWorker | null {
    return this.workers.get(handle) ?? null
  }

  /**
   * Map a service worker to info.
   */
  private mapWorkerInfo(worker: ServiceWorker | null): ServiceWorkerInfo | null {
    if (!worker) return null
    return {
      scriptUrl: worker.scriptURL,
      state: worker.state as ServiceWorkerState,
    }
  }

  /**
   * Map a registration to info.
   */
  private mapRegistrationInfo(registration: ServiceWorkerRegistration): RegistrationInfo {
    return {
      scope: registration.scope,
      updateViaCache: registration.updateViaCache as UpdateViaCache,
      installing: this.mapWorkerInfo(registration.installing),
      waiting: this.mapWorkerInfo(registration.waiting),
      active: this.mapWorkerInfo(registration.active),
    }
  }

  /**
   * Register a service worker.
   */
  async register(
    scriptUrl: string,
    options?: RegistrationOptions
  ): Promise<Result<RegistrationHandle, BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    try {
      // Resolve relative URLs
      const resolvedUrl = new URL(scriptUrl, this.baseUrl).href

      const registrationOptions: globalThis.RegistrationOptions = {}
      if (options?.scope !== undefined) {
        registrationOptions.scope = options.scope
      }
      if (options?.type !== undefined) {
        registrationOptions.type = options.type
      }
      if (options?.updateViaCache !== undefined) {
        registrationOptions.updateViaCache = options.updateViaCache
      }

      const registration = await navigator.serviceWorker.register(resolvedUrl, registrationOptions)
      return ok(this.getRegistrationHandle(registration))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get all service worker registrations.
   */
  async getRegistrations(): Promise<Result<RegistrationHandle[], BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      return ok(registrations.map(reg => this.getRegistrationHandle(reg)))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get the ready registration (when a service worker is active).
   */
  async getReady(): Promise<Result<RegistrationHandle, BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    try {
      const registration = await navigator.serviceWorker.ready
      return ok(this.getRegistrationHandle(registration))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get registration info.
   */
  getRegistrationInfo(handle: RegistrationHandle): Result<RegistrationInfo | null, BrowserError> {
    const registration = this.getRegistration(handle)
    if (!registration) {
      return ok(null)
    }
    return ok(this.mapRegistrationInfo(registration))
  }

  /**
   * Update a service worker registration.
   */
  async update(handle: RegistrationHandle): Promise<Result<void, BrowserError>> {
    const registration = this.getRegistration(handle)
    if (!registration) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Registration not found')
    }

    try {
      await registration.update()
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Unregister a service worker registration.
   */
  async unregister(handle: RegistrationHandle): Promise<Result<boolean, BrowserError>> {
    const registration = this.getRegistration(handle)
    if (!registration) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Registration not found')
    }

    try {
      const result = await registration.unregister()
      this.registrations.drop(handle)
      return ok(result)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get the controller (active service worker controlling this page).
   */
  getController(): Result<ServiceWorkerHandle | null, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    const controller = navigator.serviceWorker.controller
    if (!controller) {
      return ok(null)
    }
    return ok(this.getWorkerHandle(controller))
  }

  /**
   * Get service worker info.
   */
  getWorkerInfo(handle: ServiceWorkerHandle): Result<ServiceWorkerInfo | null, BrowserError> {
    const worker = this.getWorker(handle)
    if (!worker) {
      return ok(null)
    }
    return ok(this.mapWorkerInfo(worker))
  }

  /**
   * Post a message to a service worker.
   */
  postMessage(
    handle: ServiceWorkerHandle,
    message: unknown,
    transfer?: Transferable[]
  ): Result<void, BrowserError> {
    const worker = this.getWorker(handle)
    if (!worker) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Service worker not found')
    }

    try {
      if (transfer && transfer.length > 0) {
        worker.postMessage(message, transfer)
      } else {
        worker.postMessage(message)
      }
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get the installing worker from a registration.
   */
  getInstalling(handle: RegistrationHandle): Result<ServiceWorkerHandle | null, BrowserError> {
    const registration = this.getRegistration(handle)
    if (!registration) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Registration not found')
    }
    if (!registration.installing) {
      return ok(null)
    }
    return ok(this.getWorkerHandle(registration.installing))
  }

  /**
   * Get the waiting worker from a registration.
   */
  getWaiting(handle: RegistrationHandle): Result<ServiceWorkerHandle | null, BrowserError> {
    const registration = this.getRegistration(handle)
    if (!registration) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Registration not found')
    }
    if (!registration.waiting) {
      return ok(null)
    }
    return ok(this.getWorkerHandle(registration.waiting))
  }

  /**
   * Get the active worker from a registration.
   */
  getActive(handle: RegistrationHandle): Result<ServiceWorkerHandle | null, BrowserError> {
    const registration = this.getRegistration(handle)
    if (!registration) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Registration not found')
    }
    if (!registration.active) {
      return ok(null)
    }
    return ok(this.getWorkerHandle(registration.active))
  }

  /**
   * Release a registration handle.
   */
  releaseRegistration(handle: RegistrationHandle): void {
    this.registrations.drop(handle)
  }

  /**
   * Release a worker handle.
   */
  releaseWorker(handle: ServiceWorkerHandle): void {
    this.workers.drop(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultServiceWorker: BrowserServiceWorker | null = null

/**
 * Get the default service worker instance.
 */
export function getDefaultServiceWorker(): BrowserServiceWorker {
  if (!defaultServiceWorker) {
    defaultServiceWorker = new BrowserServiceWorker()
  }
  return defaultServiceWorker
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Register a service worker.
 */
export async function register(
  scriptUrl: string,
  options?: RegistrationOptions
): Promise<Result<RegistrationHandle, BrowserError>> {
  return getDefaultServiceWorker().register(scriptUrl, options)
}

/**
 * Get all service worker registrations.
 */
export async function getRegistrations(): Promise<Result<RegistrationHandle[], BrowserError>> {
  return getDefaultServiceWorker().getRegistrations()
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:service-worker imports object.
 */
export function getBrowserServiceWorkerImports(
  options?: ServiceWorkerOptions
): Record<string, unknown> {
  let serviceWorker: BrowserServiceWorker | null = null

  const getServiceWorker = (): BrowserServiceWorker => {
    if (!serviceWorker) {
      serviceWorker = options ? new BrowserServiceWorker(options) : getDefaultServiceWorker()
    }
    return serviceWorker
  }

  return {
    'browser:service-worker/service-worker': {
      // Registration
      register: (scriptUrl: string, opts?: RegistrationOptions) =>
        getServiceWorker().register(scriptUrl, opts),
      'get-registrations': () => getServiceWorker().getRegistrations(),
      'get-ready': () => getServiceWorker().getReady(),

      // Registration info
      'get-registration-info': (handle: RegistrationHandle) =>
        getServiceWorker().getRegistrationInfo(handle),
      update: (handle: RegistrationHandle) => getServiceWorker().update(handle),
      unregister: (handle: RegistrationHandle) => getServiceWorker().unregister(handle),

      // Worker access
      'get-controller': () => getServiceWorker().getController(),
      'get-installing': (handle: RegistrationHandle) => getServiceWorker().getInstalling(handle),
      'get-waiting': (handle: RegistrationHandle) => getServiceWorker().getWaiting(handle),
      'get-active': (handle: RegistrationHandle) => getServiceWorker().getActive(handle),

      // Worker info
      'get-worker-info': (handle: ServiceWorkerHandle) => getServiceWorker().getWorkerInfo(handle),
      'post-message': (handle: ServiceWorkerHandle, message: unknown, transfer?: Transferable[]) =>
        getServiceWorker().postMessage(handle, message, transfer),

      // Cleanup
      'release-registration': (handle: RegistrationHandle) =>
        getServiceWorker().releaseRegistration(handle),
      'release-worker': (handle: ServiceWorkerHandle) => getServiceWorker().releaseWorker(handle),
    },
  }
}
