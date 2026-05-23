/**
 * browser:worker - Web Worker interface for parallel computation
 *
 * Provides capability-scoped access to Web Workers, enabling WebAssembly
 * components to spawn worker threads, exchange messages, and share memory
 * via SharedArrayBuffer.
 *
 * @example
 * ```typescript
 * import { BrowserWorker, spawn, postMessage } from '@aspect/wasi-polyfill/browser'
 *
 * const worker = new BrowserWorker()
 * const handle = await worker.spawn({ url: './worker.js' })
 * await worker.postMessage(handle, { type: 'compute', data: [1, 2, 3] })
 * ```
 *
 * @packageDocumentation
 */

import {
  BrowserErrorCode,
  BrowserException,
  type BrowserError,
  type Result,
  ok,
  browserErr,
} from './types.js'

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle to a Web Worker instance.
 */
export type WorkerHandle = number

/**
 * Handle to a shared memory buffer (SharedArrayBuffer).
 */
export type SharedBufferHandle = number

/**
 * Handle to a message port for direct communication.
 */
export type MessagePortHandle = number

// =============================================================================
// Worker Types
// =============================================================================

/**
 * Worker type enumeration.
 */
export enum WorkerType {
  /** Classic worker script */
  CLASSIC = 'classic',
  /** ES module worker */
  MODULE = 'module',
}

/**
 * Worker state enumeration.
 */
export enum WorkerState {
  /** Worker is starting up */
  PENDING = 'pending',
  /** Worker is running */
  RUNNING = 'running',
  /** Worker has terminated */
  TERMINATED = 'terminated',
  /** Worker encountered an error */
  ERROR = 'error',
}

/**
 * Descriptor for spawning a worker.
 */
export interface WorkerDescriptor {
  /** URL of the worker script (can be relative or blob:) */
  url: string
  /** Type of worker (classic or module) */
  type?: WorkerType
  /** Worker name for debugging */
  name?: string
  /** Credentials mode for module workers */
  credentials?: 'omit' | 'same-origin' | 'include'
}

/**
 * Information about a worker.
 */
export interface WorkerInfo {
  /** Worker handle */
  handle: WorkerHandle
  /** Worker name */
  name: string
  /** Current state */
  state: WorkerState
  /** Worker type */
  type: WorkerType
  /** URL the worker was spawned from */
  url: string
}

/**
 * Message received from a worker.
 */
export interface WorkerMessage {
  /** Worker handle that sent the message */
  worker: WorkerHandle
  /** Message data */
  data: unknown
  /** Timestamp when message was received */
  timestamp: number
}

/**
 * Worker error event.
 */
export interface WorkerError {
  /** Worker handle that errored */
  worker: WorkerHandle
  /** Error message */
  message: string
  /** Filename where error occurred */
  filename?: string
  /** Line number */
  lineno?: number
  /** Column number */
  colno?: number
}

// =============================================================================
// Shared Memory Types
// =============================================================================

/**
 * Descriptor for creating a shared buffer.
 */
export interface SharedBufferDescriptor {
  /** Size in bytes (must be multiple of page size for wasm) */
  byteLength: number
  /** Maximum size for growable buffers */
  maxByteLength?: number
}

/**
 * Information about a shared buffer.
 */
export interface SharedBufferInfo {
  /** Buffer handle */
  handle: SharedBufferHandle
  /** Current size in bytes */
  byteLength: number
  /** Maximum size if growable */
  maxByteLength?: number
  /** Whether the buffer can grow */
  growable: boolean
}

// =============================================================================
// Message Port Types
// =============================================================================

/**
 * Message port information.
 */
export interface MessagePortInfo {
  /** Port handle */
  handle: MessagePortHandle
  /** Whether the port is open */
  open: boolean
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Browser worker manager configuration.
 */
export interface BrowserWorkerOptions {
  /** Maximum number of concurrent workers */
  maxWorkers?: number
  /** Default worker type */
  defaultType?: WorkerType
  /** Enable SharedArrayBuffer support */
  enableSharedMemory?: boolean
  /** Base URL for worker scripts */
  baseUrl?: string
}

// =============================================================================
// Worker Manager
// =============================================================================

/**
 * Browser worker interface implementation.
 *
 * Manages Web Workers, shared memory buffers, and message ports
 * for parallel computation from WebAssembly components.
 */
export class BrowserWorker {
  private workers = new Map<WorkerHandle, Worker>()
  private workerInfo = new Map<WorkerHandle, WorkerInfo>()
  private sharedBuffers = new Map<SharedBufferHandle, SharedArrayBuffer>()
  private sharedBufferInfo = new Map<SharedBufferHandle, SharedBufferInfo>()
  private messagePorts = new Map<MessagePortHandle, MessagePort>()
  private messagePortInfo = new Map<MessagePortHandle, MessagePortInfo>()
  private messageQueue: WorkerMessage[] = []
  private errorQueue: WorkerError[] = []
  private nextWorkerHandle = 1
  private nextBufferHandle = 1
  private nextPortHandle = 1
  private options: Required<BrowserWorkerOptions>

  constructor(options: BrowserWorkerOptions = {}) {
    this.options = {
      maxWorkers: options.maxWorkers ?? 16,
      defaultType: options.defaultType ?? WorkerType.MODULE,
      enableSharedMemory: options.enableSharedMemory ?? true,
      baseUrl: options.baseUrl ?? '',
    }
  }

  // ===========================================================================
  // Worker Management
  // ===========================================================================

  /**
   * Check if workers are supported.
   */
  supportsWorkers(): boolean {
    return typeof Worker !== 'undefined'
  }

  /**
   * Check if shared memory is supported.
   */
  supportsSharedMemory(): boolean {
    return typeof SharedArrayBuffer !== 'undefined' && this.options.enableSharedMemory
  }

  /**
   * Spawn a new worker.
   */
  spawn(descriptor: WorkerDescriptor): Result<WorkerHandle, BrowserError> {
    if (!this.supportsWorkers()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'Web Workers are not supported')
    }

    if (this.workers.size >= this.options.maxWorkers) {
      return browserErr(BrowserErrorCode.BUSY, `Maximum workers (${this.options.maxWorkers}) reached`)
    }

    try {
      const url = descriptor.url.startsWith('blob:') || descriptor.url.startsWith('http')
        ? descriptor.url
        : this.options.baseUrl + descriptor.url

      const workerType = descriptor.type ?? this.options.defaultType
      const workerOptions: WorkerOptions = {}

      if (descriptor.name) {
        workerOptions.name = descriptor.name
      }

      if (workerType === WorkerType.MODULE) {
        workerOptions.type = 'module'
        if (descriptor.credentials) {
          workerOptions.credentials = descriptor.credentials
        }
      }

      const worker = new Worker(url, workerOptions)
      const handle = this.nextWorkerHandle++

      const info: WorkerInfo = {
        handle,
        name: descriptor.name ?? `worker-${handle}`,
        state: WorkerState.PENDING,
        type: workerType,
        url,
      }

      // Set up event handlers
      worker.onmessage = (event) => {
        // Update state on first message
        const workerInfo = this.workerInfo.get(handle)
        if (workerInfo && workerInfo.state === WorkerState.PENDING) {
          workerInfo.state = WorkerState.RUNNING
        }

        this.messageQueue.push({
          worker: handle,
          data: event.data,
          timestamp: Date.now(),
        })
      }

      worker.onerror = (event) => {
        const workerInfo = this.workerInfo.get(handle)
        if (workerInfo) {
          workerInfo.state = WorkerState.ERROR
        }

        this.errorQueue.push({
          worker: handle,
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        })
      }

      worker.onmessageerror = (_event) => {
        this.errorQueue.push({
          worker: handle,
          message: 'Message deserialization failed',
        })
      }

      this.workers.set(handle, worker)
      this.workerInfo.set(handle, info)

      // Mark as running after a brief delay (worker initialization)
      setTimeout(() => {
        const workerInfo = this.workerInfo.get(handle)
        if (workerInfo && workerInfo.state === WorkerState.PENDING) {
          workerInfo.state = WorkerState.RUNNING
        }
      }, 0)

      return ok(handle)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to spawn worker: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Spawn a worker from inline code.
   */
  spawnInline(code: string, type: WorkerType = WorkerType.MODULE): Result<WorkerHandle, BrowserError> {
    if (!this.supportsWorkers()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'Web Workers are not supported')
    }

    try {
      const blob = new Blob([code], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)

      const result = this.spawn({ url, type, name: 'inline-worker' })

      // Clean up blob URL after worker is created
      // The worker will have loaded the URL by then
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      return result
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to create inline worker: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Get information about a worker.
   */
  getWorkerInfo(handle: WorkerHandle): WorkerInfo | null {
    return this.workerInfo.get(handle) ?? null
  }

  /**
   * Get all active workers.
   */
  getActiveWorkers(): WorkerInfo[] {
    return Array.from(this.workerInfo.values()).filter(
      (info) => info.state === WorkerState.PENDING || info.state === WorkerState.RUNNING
    )
  }

  /**
   * Terminate a worker.
   */
  terminate(handle: WorkerHandle): Result<void, BrowserError> {
    const worker = this.workers.get(handle)
    if (!worker) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `Worker ${handle} not found`)
    }

    try {
      // Detach handlers so the Worker (and the closures capturing `this`) can be
      // collected, then drop any queued messages/errors from this worker.
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()

      const info = this.workerInfo.get(handle)
      if (info) {
        info.state = WorkerState.TERMINATED
      }

      this.workers.delete(handle)
      this.messageQueue = this.messageQueue.filter((m) => m.worker !== handle)
      this.errorQueue = this.errorQueue.filter((e) => e.worker !== handle)
      return ok(undefined)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to terminate worker: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Terminate all workers.
   */
  terminateAll(): void {
    for (const [handle] of this.workers) {
      this.terminate(handle)
    }
  }

  // ===========================================================================
  // Messaging
  // ===========================================================================

  /**
   * Post a message to a worker.
   */
  postMessage(
    handle: WorkerHandle,
    message: unknown,
    transfer?: Transferable[]
  ): Result<void, BrowserError> {
    const worker = this.workers.get(handle)
    if (!worker) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `Worker ${handle} not found`)
    }

    const info = this.workerInfo.get(handle)
    if (info && info.state === WorkerState.TERMINATED) {
      return browserErr(BrowserErrorCode.INVALID_ARGUMENT, 'Worker has been terminated')
    }

    try {
      if (transfer && transfer.length > 0) {
        worker.postMessage(message, transfer)
      } else {
        worker.postMessage(message)
      }
      return ok(undefined)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to post message: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Post a message with shared buffer.
   */
  postMessageWithBuffer(
    handle: WorkerHandle,
    message: unknown,
    bufferHandle: SharedBufferHandle
  ): Result<void, BrowserError> {
    const buffer = this.sharedBuffers.get(bufferHandle)
    if (!buffer) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `Shared buffer ${bufferHandle} not found`)
    }

    // Include the SharedArrayBuffer in the message
    const messageWithBuffer = {
      ...((typeof message === 'object' && message !== null) ? message : { data: message }),
      sharedBuffer: buffer,
    }

    return this.postMessage(handle, messageWithBuffer)
  }

  /**
   * Read pending messages from workers.
   */
  readMessages(maxCount?: number): WorkerMessage[] {
    const count = maxCount ?? this.messageQueue.length
    return this.messageQueue.splice(0, count)
  }

  /**
   * Check if there are pending messages.
   */
  hasMessages(): boolean {
    return this.messageQueue.length > 0
  }

  /**
   * Read pending errors from workers.
   */
  readErrors(maxCount?: number): WorkerError[] {
    const count = maxCount ?? this.errorQueue.length
    return this.errorQueue.splice(0, count)
  }

  /**
   * Check if there are pending errors.
   */
  hasErrors(): boolean {
    return this.errorQueue.length > 0
  }

  // ===========================================================================
  // Shared Memory
  // ===========================================================================

  /**
   * Create a shared memory buffer.
   */
  createSharedBuffer(descriptor: SharedBufferDescriptor): Result<SharedBufferHandle, BrowserError> {
    if (!this.supportsSharedMemory()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'SharedArrayBuffer is not supported (requires secure context with COOP/COEP headers)'
      )
    }

    try {
      // SharedArrayBuffer with options is a newer API (growable buffers)
      let buffer: SharedArrayBuffer
      if (descriptor.maxByteLength) {
        // @ts-expect-error - SharedArrayBuffer with options requires ES2024+
        buffer = new SharedArrayBuffer(descriptor.byteLength, {
          maxByteLength: descriptor.maxByteLength,
        })
      } else {
        buffer = new SharedArrayBuffer(descriptor.byteLength)
      }

      const handle = this.nextBufferHandle++

      const info: SharedBufferInfo = {
        handle,
        byteLength: buffer.byteLength,
        growable: !!descriptor.maxByteLength,
      }

      // Only set maxByteLength if defined (for exactOptionalPropertyTypes)
      if (descriptor.maxByteLength !== undefined) {
        info.maxByteLength = descriptor.maxByteLength
      }

      this.sharedBuffers.set(handle, buffer)
      this.sharedBufferInfo.set(handle, info)

      return ok(handle)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to create shared buffer: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Get a shared buffer by handle.
   */
  getSharedBuffer(handle: SharedBufferHandle): SharedArrayBuffer | null {
    return this.sharedBuffers.get(handle) ?? null
  }

  /**
   * Get shared buffer info.
   */
  getSharedBufferInfo(handle: SharedBufferHandle): SharedBufferInfo | null {
    return this.sharedBufferInfo.get(handle) ?? null
  }

  /**
   * Get a view into a shared buffer.
   */
  getSharedBufferView(
    handle: SharedBufferHandle,
    offset?: number,
    length?: number
  ): Result<Uint8Array, BrowserError> {
    const buffer = this.sharedBuffers.get(handle)
    if (!buffer) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `Shared buffer ${handle} not found`)
    }

    try {
      const view = new Uint8Array(buffer, offset, length)
      return ok(view)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Invalid buffer view parameters: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Delete a shared buffer.
   */
  deleteSharedBuffer(handle: SharedBufferHandle): boolean {
    this.sharedBufferInfo.delete(handle)
    return this.sharedBuffers.delete(handle)
  }

  // ===========================================================================
  // Message Channels
  // ===========================================================================

  /**
   * Create a message channel for direct worker-to-worker communication.
   */
  createMessageChannel(): Result<[MessagePortHandle, MessagePortHandle], BrowserError> {
    try {
      const channel = new MessageChannel()

      const handle1 = this.nextPortHandle++
      const handle2 = this.nextPortHandle++

      this.messagePorts.set(handle1, channel.port1)
      this.messagePorts.set(handle2, channel.port2)

      this.messagePortInfo.set(handle1, { handle: handle1, open: true })
      this.messagePortInfo.set(handle2, { handle: handle2, open: true })

      return ok([handle1, handle2] as [MessagePortHandle, MessagePortHandle])
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to create message channel: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Get a message port for transfer to a worker.
   */
  getMessagePort(handle: MessagePortHandle): MessagePort | null {
    return this.messagePorts.get(handle) ?? null
  }

  /**
   * Close a message port.
   */
  closeMessagePort(handle: MessagePortHandle): Result<void, BrowserError> {
    const port = this.messagePorts.get(handle)
    if (!port) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `Message port ${handle} not found`)
    }

    try {
      port.close()
      const info = this.messagePortInfo.get(handle)
      if (info) {
        info.open = false
      }
      return ok(undefined)
    } catch (error) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to close message port: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this.terminateAll()
    this.sharedBuffers.clear()
    this.sharedBufferInfo.clear()

    for (const [handle] of this.messagePorts) {
      this.closeMessagePort(handle)
    }
    this.messagePorts.clear()
    this.messagePortInfo.clear()

    this.messageQueue = []
    this.errorQueue = []
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultWorkerManager: BrowserWorker | null = null

/**
 * Get the default worker manager.
 */
export function getDefaultWorkerManager(): BrowserWorker {
  if (!defaultWorkerManager) {
    defaultWorkerManager = new BrowserWorker()
  }
  return defaultWorkerManager
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Check if workers are supported.
 */
export function supportsWorkers(): boolean {
  return getDefaultWorkerManager().supportsWorkers()
}

/**
 * Check if shared memory is supported.
 */
export function supportsSharedMemory(): boolean {
  return getDefaultWorkerManager().supportsSharedMemory()
}

/**
 * Spawn a worker.
 */
export function spawn(descriptor: WorkerDescriptor): Result<WorkerHandle, BrowserError> {
  return getDefaultWorkerManager().spawn(descriptor)
}

/**
 * Spawn a worker from inline code.
 */
export function spawnInline(
  code: string,
  type?: WorkerType
): Result<WorkerHandle, BrowserError> {
  return getDefaultWorkerManager().spawnInline(code, type)
}

/**
 * Terminate a worker.
 */
export function terminate(handle: WorkerHandle): Result<void, BrowserError> {
  return getDefaultWorkerManager().terminate(handle)
}

/**
 * Post a message to a worker.
 */
export function postMessage(
  handle: WorkerHandle,
  message: unknown,
  transfer?: Transferable[]
): Result<void, BrowserError> {
  return getDefaultWorkerManager().postMessage(handle, message, transfer)
}

/**
 * Read pending messages.
 */
export function readMessages(maxCount?: number): WorkerMessage[] {
  return getDefaultWorkerManager().readMessages(maxCount)
}

/**
 * Create a shared buffer.
 */
export function createSharedBuffer(
  descriptor: SharedBufferDescriptor
): Result<SharedBufferHandle, BrowserError> {
  return getDefaultWorkerManager().createSharedBuffer(descriptor)
}

// =============================================================================
// Import Generators
// =============================================================================

/**
 * Get browser:worker imports for WebAssembly instantiation.
 */
export function getBrowserWorkerImports(options?: BrowserWorkerOptions): Record<string, unknown> {
  const manager = options ? new BrowserWorker(options) : getDefaultWorkerManager()

  return {
    'browser:worker': {
      // Feature detection
      'supports-workers': () => manager.supportsWorkers(),
      'supports-shared-memory': () => manager.supportsSharedMemory(),

      // Worker management
      'spawn': (url: string, type: number, name: string) => {
        const workerType = type === 0 ? WorkerType.CLASSIC : WorkerType.MODULE
        const descriptor: WorkerDescriptor = { url, type: workerType }
        if (name) descriptor.name = name
        const result = manager.spawn(descriptor)
        if ('error' in result) throw new BrowserException(result.error)
        return result.value
      },
      'spawn-inline': (code: string, type: number) => {
        const workerType = type === 0 ? WorkerType.CLASSIC : WorkerType.MODULE
        const result = manager.spawnInline(code, workerType)
        if ('error' in result) throw new BrowserException(result.error)
        return result.value
      },
      'terminate': (handle: WorkerHandle) => {
        const result = manager.terminate(handle)
        if ('error' in result) throw new BrowserException(result.error)
      },
      'get-worker-info': (handle: WorkerHandle) => manager.getWorkerInfo(handle),
      'get-active-workers': () => manager.getActiveWorkers(),

      // Messaging
      'post-message': (handle: WorkerHandle, data: unknown) => {
        const result = manager.postMessage(handle, data)
        if ('error' in result) throw new BrowserException(result.error)
      },
      'read-messages': (maxCount: number) => manager.readMessages(maxCount || undefined),
      'has-messages': () => manager.hasMessages(),
      'read-errors': (maxCount: number) => manager.readErrors(maxCount || undefined),
      'has-errors': () => manager.hasErrors(),

      // Shared memory
      'create-shared-buffer': (byteLength: number, maxByteLength: number) => {
        const descriptor: SharedBufferDescriptor = { byteLength }
        if (maxByteLength) descriptor.maxByteLength = maxByteLength
        const result = manager.createSharedBuffer(descriptor)
        if ('error' in result) throw new BrowserException(result.error)
        return result.value
      },
      'get-shared-buffer-info': (handle: SharedBufferHandle) => manager.getSharedBufferInfo(handle),
      'delete-shared-buffer': (handle: SharedBufferHandle) => manager.deleteSharedBuffer(handle),

      // Message channels
      'create-message-channel': () => {
        const result = manager.createMessageChannel()
        if ('error' in result) throw new BrowserException(result.error)
        return result.value
      },
      'close-message-port': (handle: MessagePortHandle) => {
        const result = manager.closeMessagePort(handle)
        if ('error' in result) throw new BrowserException(result.error)
      },
    },
  }
}
