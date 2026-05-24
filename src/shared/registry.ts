/**
 * Handle Registry
 *
 * Generic handle-based resource management utilities.
 * Provides type-safe handle allocation, lookup, and cleanup for resources
 * that need numeric handle identifiers (common pattern in WASI interfaces).
 *
 * @example
 * ```typescript
 * import { HandleRegistry } from '@aspect/wasi-polyfill/shared'
 *
 * interface FileDescriptor {
 *   path: string
 *   position: number
 * }
 *
 * const files = new HandleRegistry<FileDescriptor>()
 * const handle = files.register({ path: '/file.txt', position: 0 })
 * const fd = files.get(handle) // FileDescriptor | undefined
 * files.drop(handle)
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Handle Registry
// =============================================================================

/**
 * Generic registry for managing handle-based resources.
 *
 * Handles are numeric identifiers (starting at 1) that can be used
 * to reference resources across the WASM boundary.
 *
 * @typeParam T - The type of resource being managed
 */
export class HandleRegistry<T> {
  private nextHandle = 1
  private readonly items = new Map<number, T>()

  /**
   * Create a new HandleRegistry.
   *
   * @param startHandle - Optional starting handle value (default: 1)
   */
  constructor(startHandle = 1) {
    this.nextHandle = startHandle
  }

  /**
   * Register a new item and return its handle.
   *
   * @param item - The item to register
   * @returns The numeric handle for the item
   */
  register(item: T): number {
    const handle = this.nextHandle++
    this.items.set(handle, item)
    return handle
  }

  /**
   * Register an item with a specific handle.
   * Use with caution - may overwrite existing items.
   *
   * @param handle - The handle to use
   * @param item - The item to register
   */
  registerWithHandle(handle: number, item: T): void {
    this.items.set(handle, item)
    if (handle >= this.nextHandle) {
      this.nextHandle = handle + 1
    }
  }

  /**
   * Get an item by its handle.
   *
   * @param handle - The handle to look up
   * @returns The item, or undefined if not found
   */
  get(handle: number): T | undefined {
    return this.items.get(handle)
  }

  /**
   * Get an item by its handle, throwing if not found.
   *
   * @param handle - The handle to look up
   * @param errorMessage - Optional custom error message
   * @returns The item
   * @throws Error if the handle is not found
   */
  getOrThrow(handle: number, errorMessage?: string): T {
    const item = this.items.get(handle)
    if (item === undefined) {
      throw new Error(errorMessage ?? `Handle ${handle} not found`)
    }
    return item
  }

  /**
   * Check if a handle exists in the registry.
   *
   * @param handle - The handle to check
   * @returns True if the handle exists
   */
  has(handle: number): boolean {
    return this.items.has(handle)
  }

  /**
   * Remove an item from the registry.
   *
   * @param handle - The handle to drop
   * @returns True if the item was found and removed
   */
  drop(handle: number): boolean {
    return this.items.delete(handle)
  }

  /**
   * Remove all items from the registry.
   */
  clear(): void {
    this.items.clear()
  }

  /**
   * Get the number of items in the registry.
   *
   * @returns The number of registered items
   */
  size(): number {
    return this.items.size
  }

  /**
   * Iterate over all items in the registry.
   *
   * @param fn - Callback function receiving each item and its handle
   */
  forEach(fn: (item: T, handle: number) => void): void {
    this.items.forEach((item, handle) => fn(item, handle))
  }

  /**
   * Get all handles in the registry.
   *
   * @returns Array of all handles
   */
  handles(): number[] {
    return Array.from(this.items.keys())
  }

  /**
   * Get all items in the registry.
   *
   * @returns Array of all items
   */
  values(): T[] {
    return Array.from(this.items.values())
  }

  /**
   * Get all handle-item pairs.
   *
   * @returns Array of [handle, item] tuples
   */
  entries(): [number, T][] {
    return Array.from(this.items.entries())
  }

  /**
   * Find a handle by predicate.
   *
   * @param predicate - Function to test each item
   * @returns The handle of the first matching item, or undefined
   */
  findHandle(predicate: (item: T) => boolean): number | undefined {
    for (const [handle, item] of this.items) {
      if (predicate(item)) {
        return handle
      }
    }
    return undefined
  }

  /**
   * Find an item by predicate.
   *
   * @param predicate - Function to test each item
   * @returns The first matching item, or undefined
   */
  find(predicate: (item: T) => boolean): T | undefined {
    for (const item of this.items.values()) {
      if (predicate(item)) {
        return item
      }
    }
    return undefined
  }

  /**
   * Update an item in the registry.
   *
   * @param handle - The handle to update
   * @param updater - Function that receives the current item and returns the updated item
   * @returns True if the item was found and updated
   */
  update(handle: number, updater: (item: T) => T): boolean {
    const item = this.items.get(handle)
    if (item === undefined) {
      return false
    }
    this.items.set(handle, updater(item))
    return true
  }
}

// =============================================================================
// Weak Handle Registry
// =============================================================================

/**
 * Registry that uses WeakRef for automatic cleanup of object resources.
 *
 * Items may be garbage collected if no other references exist.
 * Useful for caching or optional resource tracking.
 *
 * @typeParam T - The type of resource being managed (must be an object)
 */
export class WeakHandleRegistry<T extends object> {
  private nextHandle = 1
  private readonly items = new Map<number, WeakRef<T>>()
  /** Reverse map for {@link handleFor} dedup; entries auto-clear on GC. */
  private readonly objToHandle = new WeakMap<T, number>()
  private readonly finalizationRegistry: FinalizationRegistry<number>

  /**
   * Create a new WeakHandleRegistry.
   *
   * @param startHandle - Optional starting handle value (default: 1)
   */
  constructor(startHandle = 1) {
    this.nextHandle = startHandle
    this.finalizationRegistry = new FinalizationRegistry((handle) => {
      this.items.delete(handle)
    })
  }

  /**
   * Register a new item and return its handle.
   *
   * @param item - The item to register
   * @returns The numeric handle for the item
   */
  register(item: T): number {
    const handle = this.nextHandle++
    this.items.set(handle, new WeakRef(item))
    this.objToHandle.set(item, handle)
    // item doubles as the unregister token so drop() can cancel the callback.
    this.finalizationRegistry.register(item, handle, item)
    return handle
  }

  /**
   * Get a stable handle for `item`, allocating one on first sight and returning
   * the same handle for the same object thereafter (reference identity). Use
   * this for host objects handed out by handle (DOM nodes, media streams, …)
   * where the same object must map to a stable handle.
   *
   * @param item - The object to get a handle for
   * @returns The (stable) numeric handle
   */
  handleFor(item: T): number {
    const existing = this.objToHandle.get(item)
    if (existing !== undefined) {
      return existing
    }
    return this.register(item)
  }

  /**
   * Get an item by its handle.
   * Returns undefined if the item has been garbage collected.
   *
   * @param handle - The handle to look up
   * @returns The item, or undefined if not found or collected
   */
  get(handle: number): T | undefined {
    const ref = this.items.get(handle)
    if (!ref) {
      return undefined
    }
    const item = ref.deref()
    if (item === undefined) {
      // Item was garbage collected, clean up the entry
      this.items.delete(handle)
    }
    return item
  }

  /**
   * Check if a handle exists and the item is still alive.
   *
   * @param handle - The handle to check
   * @returns True if the handle exists and item is alive
   */
  has(handle: number): boolean {
    return this.get(handle) !== undefined
  }

  /**
   * Remove an item from the registry.
   *
   * @param handle - The handle to drop
   * @returns True if the entry was removed
   */
  drop(handle: number): boolean {
    const obj = this.items.get(handle)?.deref()
    if (obj !== undefined) {
      this.objToHandle.delete(obj)
      this.finalizationRegistry.unregister(obj)
    }
    return this.items.delete(handle)
  }

  /**
   * Remove all items from the registry.
   */
  clear(): void {
    this.items.clear()
  }

  /**
   * Get the number of entries in the registry.
   * Note: Some entries may reference garbage-collected items.
   *
   * @returns The number of registry entries
   */
  size(): number {
    return this.items.size
  }

  /**
   * Clean up entries for garbage-collected items.
   *
   * @returns The number of entries removed
   */
  prune(): number {
    let pruned = 0
    for (const [handle, ref] of this.items) {
      if (ref.deref() === undefined) {
        this.items.delete(handle)
        pruned++
      }
    }
    return pruned
  }
}

// =============================================================================
// Typed Handle
// =============================================================================

/**
 * A branded handle type for type-safe handle differentiation.
 *
 * @example
 * ```typescript
 * type FileHandle = TypedHandle<'file'>
 * type SocketHandle = TypedHandle<'socket'>
 *
 * // These are incompatible at the type level
 * const fileHandle: FileHandle = 1 as FileHandle
 * const socketHandle: SocketHandle = fileHandle // Error!
 * ```
 */
export type TypedHandle<Brand extends string> = number & { readonly __brand: Brand }

/**
 * Create a typed handle from a number.
 *
 * @param handle - The numeric handle
 * @returns The typed handle
 */
export function typedHandle<Brand extends string>(handle: number): TypedHandle<Brand> {
  return handle as TypedHandle<Brand>
}

// =============================================================================
// Handle Pool
// =============================================================================

/**
 * A registry that reuses dropped handles to minimize handle value growth.
 *
 * Useful when handle values need to stay within a certain range or
 * when handles are frequently allocated and deallocated.
 *
 * @typeParam T - The type of resource being managed
 */
export class HandlePool<T> {
  private nextHandle = 1
  private readonly items = new Map<number, T>()
  private readonly freeHandles: number[] = []

  /**
   * Create a new HandlePool.
   *
   * @param startHandle - Optional starting handle value (default: 1)
   */
  constructor(startHandle = 1) {
    this.nextHandle = startHandle
  }

  /**
   * Register a new item and return its handle.
   * Reuses previously dropped handles when available.
   *
   * @param item - The item to register
   * @returns The numeric handle for the item
   */
  register(item: T): number {
    const handle = this.freeHandles.pop() ?? this.nextHandle++
    this.items.set(handle, item)
    return handle
  }

  /**
   * Get an item by its handle.
   *
   * @param handle - The handle to look up
   * @returns The item, or undefined if not found
   */
  get(handle: number): T | undefined {
    return this.items.get(handle)
  }

  /**
   * Get an item by its handle, throwing if not found.
   *
   * @param handle - The handle to look up
   * @param errorMessage - Optional custom error message
   * @returns The item
   * @throws Error if the handle is not found
   */
  getOrThrow(handle: number, errorMessage?: string): T {
    const item = this.items.get(handle)
    if (item === undefined) {
      throw new Error(errorMessage ?? `Handle ${handle} not found`)
    }
    return item
  }

  /**
   * Check if a handle exists in the pool.
   *
   * @param handle - The handle to check
   * @returns True if the handle exists
   */
  has(handle: number): boolean {
    return this.items.has(handle)
  }

  /**
   * Remove an item from the pool and recycle its handle.
   *
   * @param handle - The handle to drop
   * @returns True if the item was found and removed
   */
  drop(handle: number): boolean {
    if (this.items.delete(handle)) {
      this.freeHandles.push(handle)
      return true
    }
    return false
  }

  /**
   * Remove all items from the pool.
   */
  clear(): void {
    this.items.clear()
    this.freeHandles.length = 0
  }

  /**
   * Get the number of active items in the pool.
   *
   * @returns The number of registered items
   */
  size(): number {
    return this.items.size
  }

  /**
   * Get the number of available recycled handles.
   *
   * @returns The number of free handles
   */
  freeCount(): number {
    return this.freeHandles.length
  }

  /**
   * Iterate over all items in the pool.
   *
   * @param fn - Callback function receiving each item and its handle
   */
  forEach(fn: (item: T, handle: number) => void): void {
    this.items.forEach((item, handle) => fn(item, handle))
  }
}

// =============================================================================
// Scoped Registry
// =============================================================================

/**
 * A registry that supports scoped cleanup.
 *
 * Items can be registered within a scope, and all items in that scope
 * can be cleaned up together.
 *
 * @typeParam T - The type of resource being managed
 */
export class ScopedRegistry<T> {
  private nextHandle = 1
  private readonly items = new Map<number, { item: T; scope: string }>()
  private readonly scopes = new Map<string, Set<number>>()
  private readonly onDrop: ((item: T) => void) | undefined

  /**
   * Create a new ScopedRegistry.
   *
   * @param options - Configuration options
   */
  constructor(options?: { startHandle?: number; onDrop?: (item: T) => void }) {
    this.nextHandle = options?.startHandle ?? 1
    this.onDrop = options?.onDrop
  }

  /**
   * Register a new item in a scope and return its handle.
   *
   * @param item - The item to register
   * @param scope - The scope name (default: 'default')
   * @returns The numeric handle for the item
   */
  register(item: T, scope = 'default'): number {
    const handle = this.nextHandle++
    this.items.set(handle, { item, scope })

    let scopeSet = this.scopes.get(scope)
    if (!scopeSet) {
      scopeSet = new Set()
      this.scopes.set(scope, scopeSet)
    }
    scopeSet.add(handle)

    return handle
  }

  /**
   * Get an item by its handle.
   *
   * @param handle - The handle to look up
   * @returns The item, or undefined if not found
   */
  get(handle: number): T | undefined {
    return this.items.get(handle)?.item
  }

  /**
   * Remove an item from the registry.
   *
   * @param handle - The handle to drop
   * @returns True if the item was found and removed
   */
  drop(handle: number): boolean {
    const entry = this.items.get(handle)
    if (!entry) {
      return false
    }

    this.onDrop?.(entry.item)
    this.items.delete(handle)

    const scopeSet = this.scopes.get(entry.scope)
    scopeSet?.delete(handle)
    if (scopeSet?.size === 0) {
      this.scopes.delete(entry.scope)
    }

    return true
  }

  /**
   * Drop all items in a scope.
   *
   * @param scope - The scope to clear
   * @returns The number of items dropped
   */
  dropScope(scope: string): number {
    const scopeSet = this.scopes.get(scope)
    if (!scopeSet) {
      return 0
    }

    let count = 0
    for (const handle of scopeSet) {
      const entry = this.items.get(handle)
      if (entry) {
        this.onDrop?.(entry.item)
        this.items.delete(handle)
        count++
      }
    }

    this.scopes.delete(scope)
    return count
  }

  /**
   * Get all handles in a scope.
   *
   * @param scope - The scope to query
   * @returns Array of handles in the scope
   */
  getScope(scope: string): number[] {
    return Array.from(this.scopes.get(scope) ?? [])
  }

  /**
   * Get all scope names.
   *
   * @returns Array of scope names
   */
  getScopeNames(): string[] {
    return Array.from(this.scopes.keys())
  }

  /**
   * Remove all items from all scopes.
   */
  clear(): void {
    if (this.onDrop) {
      for (const { item } of this.items.values()) {
        this.onDrop(item)
      }
    }
    this.items.clear()
    this.scopes.clear()
  }

  /**
   * Get the total number of items in the registry.
   *
   * @returns The number of registered items
   */
  size(): number {
    return this.items.size
  }
}
