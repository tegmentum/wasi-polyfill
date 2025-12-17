/**
 * Unified resource tables for handle management
 *
 * WASI uses handles (u32 integers) to reference resources like streams,
 * files, sockets, etc. This module provides a unified way to manage
 * these handles across all providers.
 */

import { WasiError, WasiErrorCode } from '../../shared/errors.js'

/**
 * Resource types for type-safe handle management
 */
export type ResourceType =
  | 'stream.input'
  | 'stream.output'
  | 'pollable'
  | 'descriptor'
  | 'directory'
  | 'socket.tcp'
  | 'socket.udp'
  | 'socket.listener'
  | 'http.request'
  | 'http.response'
  | 'http.body.incoming'
  | 'http.body.outgoing'
  | 'http.fields'
  | 'dns.resolver'
  | 'network'
  | 'terminal.input'
  | 'terminal.output'
  | 'error'
  | 'future'

/**
 * Resource entry in the table
 */
export interface ResourceEntry<T = unknown> {
  /** The resource type */
  type: ResourceType
  /** The actual resource object */
  value: T
  /** When the resource was created */
  createdAt: number
  /** Whether the resource is closed */
  closed: boolean
  /** Optional parent handle (for hierarchical resources) */
  parent?: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Handle allocation result
 */
export interface HandleAllocation {
  /** The allocated handle */
  handle: number
  /** Function to release the handle */
  release: () => void
}

/**
 * Resource table statistics
 */
export interface ResourceStats {
  /** Total handles allocated */
  totalAllocated: number
  /** Currently active handles */
  activeCount: number
  /** Handles by type */
  byType: Record<ResourceType, number>
  /** Peak active count */
  peakCount: number
}

/**
 * Resource table for managing WASI handles
 *
 * Provides type-safe handle allocation and lookup with support for:
 * - Type checking on access
 * - Double-close detection
 * - Use-after-close detection
 * - Handle recycling
 * - Statistics tracking
 */
export class ResourceTable {
  private entries: Map<number, ResourceEntry> = new Map()
  private nextHandle: number = 1
  private freeHandles: number[] = []
  private stats: ResourceStats = {
    totalAllocated: 0,
    activeCount: 0,
    byType: {} as Record<ResourceType, number>,
    peakCount: 0,
  }

  /**
   * Allocate a new handle for a resource
   */
  allocate<T>(type: ResourceType, value: T, metadata?: Record<string, unknown>): number {
    // Reuse a freed handle if available
    let handle: number
    if (this.freeHandles.length > 0) {
      handle = this.freeHandles.pop()!
    } else {
      handle = this.nextHandle++
    }

    const entry: ResourceEntry<T> = {
      type,
      value,
      createdAt: Date.now(),
      closed: false,
    }

    if (metadata !== undefined) {
      entry.metadata = metadata
    }

    this.entries.set(handle, entry)

    // Update stats
    this.stats.totalAllocated++
    this.stats.activeCount++
    this.stats.byType[type] = (this.stats.byType[type] ?? 0) + 1
    if (this.stats.activeCount > this.stats.peakCount) {
      this.stats.peakCount = this.stats.activeCount
    }

    return handle
  }

  /**
   * Get a resource by handle
   *
   * @throws WasiError if handle is invalid or resource is closed
   */
  get<T>(handle: number, expectedType?: ResourceType): T {
    const entry = this.entries.get(handle)

    if (!entry) {
      throw new WasiError(WasiErrorCode.Invalid, `Invalid handle: ${handle}`)
    }

    if (entry.closed) {
      throw new WasiError(WasiErrorCode.Invalid, `Handle already closed: ${handle}`)
    }

    if (expectedType && entry.type !== expectedType) {
      throw new WasiError(
        WasiErrorCode.Invalid,
        `Handle type mismatch: expected ${expectedType}, got ${entry.type}`
      )
    }

    return entry.value as T
  }

  /**
   * Try to get a resource by handle
   *
   * Returns undefined if handle is invalid or resource is closed
   */
  tryGet<T>(handle: number, expectedType?: ResourceType): T | undefined {
    try {
      return this.get<T>(handle, expectedType)
    } catch {
      return undefined
    }
  }

  /**
   * Get the entry for a handle
   */
  getEntry(handle: number): ResourceEntry | undefined {
    return this.entries.get(handle)
  }

  /**
   * Check if a handle is valid and not closed
   */
  isValid(handle: number, expectedType?: ResourceType): boolean {
    const entry = this.entries.get(handle)
    if (!entry || entry.closed) {
      return false
    }
    if (expectedType && entry.type !== expectedType) {
      return false
    }
    return true
  }

  /**
   * Get the type of a handle
   */
  getType(handle: number): ResourceType | undefined {
    return this.entries.get(handle)?.type
  }

  /**
   * Close a resource handle
   *
   * After closing, the handle is marked as invalid and will be recycled.
   * Closing an already-closed handle is safe (no-op).
   *
   * @returns true if the resource was closed, false if already closed
   */
  close(handle: number): boolean {
    const entry = this.entries.get(handle)

    if (!entry) {
      // Handle never existed - treat as success
      return false
    }

    if (entry.closed) {
      // Already closed - safe, just return false
      return false
    }

    entry.closed = true

    // Update stats
    this.stats.activeCount--
    this.stats.byType[entry.type] = (this.stats.byType[entry.type] ?? 1) - 1

    // Schedule handle for recycling
    this.freeHandles.push(handle)

    return true
  }

  /**
   * Close a resource and call its cleanup function
   */
  async closeWithCleanup(
    handle: number,
    cleanup: (value: unknown) => void | Promise<void>
  ): Promise<boolean> {
    const entry = this.entries.get(handle)

    if (!entry || entry.closed) {
      return false
    }

    try {
      await cleanup(entry.value)
    } finally {
      this.close(handle)
    }

    return true
  }

  /**
   * Update the value of a resource
   */
  update<T>(handle: number, value: T): void {
    const entry = this.entries.get(handle)

    if (!entry) {
      throw new WasiError(WasiErrorCode.Invalid, `Invalid handle: ${handle}`)
    }

    if (entry.closed) {
      throw new WasiError(WasiErrorCode.Invalid, `Handle already closed: ${handle}`)
    }

    entry.value = value
  }

  /**
   * Update metadata for a resource
   */
  updateMetadata(handle: number, metadata: Record<string, unknown>): void {
    const entry = this.entries.get(handle)

    if (!entry) {
      throw new WasiError(WasiErrorCode.Invalid, `Invalid handle: ${handle}`)
    }

    entry.metadata = { ...entry.metadata, ...metadata }
  }

  /**
   * Set the parent handle for a resource
   */
  setParent(handle: number, parent: number): void {
    const entry = this.entries.get(handle)

    if (!entry) {
      throw new WasiError(WasiErrorCode.Invalid, `Invalid handle: ${handle}`)
    }

    entry.parent = parent
  }

  /**
   * Get all handles of a specific type
   */
  getHandlesByType(type: ResourceType): number[] {
    const handles: number[] = []
    for (const [handle, entry] of this.entries) {
      if (entry.type === type && !entry.closed) {
        handles.push(handle)
      }
    }
    return handles
  }

  /**
   * Get all child handles of a parent
   */
  getChildren(parent: number): number[] {
    const children: number[] = []
    for (const [handle, entry] of this.entries) {
      if (entry.parent === parent && !entry.closed) {
        children.push(handle)
      }
    }
    return children
  }

  /**
   * Close all child handles of a parent
   */
  closeChildren(parent: number): void {
    const children = this.getChildren(parent)
    for (const child of children) {
      this.close(child)
    }
  }

  /**
   * Get statistics about the resource table
   */
  getStats(): ResourceStats {
    return { ...this.stats }
  }

  /**
   * Get all active handles (for debugging)
   */
  getActiveHandles(): Array<{ handle: number; type: ResourceType; createdAt: number }> {
    const active: Array<{ handle: number; type: ResourceType; createdAt: number }> = []
    for (const [handle, entry] of this.entries) {
      if (!entry.closed) {
        active.push({
          handle,
          type: entry.type,
          createdAt: entry.createdAt,
        })
      }
    }
    return active
  }

  /**
   * Close all resources
   */
  closeAll(): void {
    for (const handle of this.entries.keys()) {
      this.close(handle)
    }
  }

  /**
   * Clear the table completely (for testing)
   */
  clear(): void {
    this.entries.clear()
    this.freeHandles = []
    this.nextHandle = 1
    this.stats = {
      totalAllocated: 0,
      activeCount: 0,
      byType: {} as Record<ResourceType, number>,
      peakCount: 0,
    }
  }
}

/**
 * Typed resource handle wrapper
 *
 * Provides a type-safe way to work with handles.
 */
export class TypedHandle<T, Type extends ResourceType = ResourceType> {
  constructor(
    private readonly table: ResourceTable,
    private readonly handle: number,
    private readonly type: Type
  ) {}

  /**
   * Get the underlying handle value
   */
  get id(): number {
    return this.handle
  }

  /**
   * Get the resource value
   */
  get(): T {
    return this.table.get<T>(this.handle, this.type)
  }

  /**
   * Try to get the resource value
   */
  tryGet(): T | undefined {
    return this.table.tryGet<T>(this.handle, this.type)
  }

  /**
   * Check if the handle is valid
   */
  isValid(): boolean {
    return this.table.isValid(this.handle, this.type)
  }

  /**
   * Close the handle
   */
  close(): boolean {
    return this.table.close(this.handle)
  }

  /**
   * Update the resource value
   */
  update(value: T): void {
    this.table.update(this.handle, value)
  }
}

/**
 * Stream-specific resource wrapper
 */
export interface StreamResource {
  /** Read bytes from the stream */
  read?(length: number): Promise<Uint8Array | null>
  /** Write bytes to the stream */
  write?(data: Uint8Array): Promise<number>
  /** Check if stream is readable */
  isReadable?(): boolean
  /** Check if stream is writable */
  isWritable?(): boolean
  /** Flush the stream */
  flush?(): Promise<void>
  /** Close the stream */
  close(): void | Promise<void>
}

/**
 * Pollable resource wrapper
 */
export interface PollableResource {
  /** Check if ready without blocking */
  ready(): boolean
  /** Wait until ready */
  block(): Promise<void>
}

/**
 * Create a pollable that resolves immediately
 */
export function createReadyPollable(): PollableResource {
  return {
    ready: () => true,
    block: () => Promise.resolve(),
  }
}

/**
 * Create a pollable from a promise
 */
export function createPromisePollable(promise: Promise<void>): PollableResource {
  let resolved = false
  promise.then(() => {
    resolved = true
  })

  return {
    ready: () => resolved,
    block: () => promise,
  }
}

/**
 * Global resource table
 *
 * This is the default table used by all providers.
 */
export const globalResourceTable = new ResourceTable()
