/**
 * Write batching utility for IndexedDB operations
 *
 * Automatically batches individual write operations into single transactions
 * to improve performance when many writes occur in quick succession.
 */

/**
 * Options for the write batcher
 */
export interface WriteBatcherOptions {
  /**
   * Delay in milliseconds before flushing pending writes
   * @default 10
   */
  flushDelay?: number

  /**
   * Maximum number of pending writes before forcing a flush
   * @default 100
   */
  maxPending?: number
}

/**
 * Pending write operation
 */
interface PendingWrite<T> {
  key: string
  value: T
  resolve: () => void
  reject: (error: Error) => void
}

/**
 * Pending delete operation
 */
interface PendingDelete {
  key: string
  resolve: () => void
  reject: (error: Error) => void
}

/**
 * A utility class that batches individual write operations into single flushes.
 *
 * This improves performance when many writes occur in quick succession by
 * collecting them and executing them in a single transaction.
 *
 * @example
 * ```typescript
 * const batcher = new WriteBatcher<Uint8Array>({
 *   flushDelay: 10,
 *   maxPending: 100,
 * })
 *
 * batcher.setFlushHandler(async (writes, deletes) => {
 *   const tx = db.transaction(storeName, 'readwrite')
 *   const store = tx.objectStore(storeName)
 *
 *   for (const [key, value] of writes) {
 *     store.put(value, key)
 *   }
 *   for (const key of deletes) {
 *     store.delete(key)
 *   }
 *
 *   await new Promise(resolve => tx.oncomplete = resolve)
 * })
 *
 * // These writes will be batched
 * await batcher.set('key1', value1)
 * await batcher.set('key2', value2)
 * await batcher.set('key3', value3)
 * ```
 */
export class WriteBatcher<T> {
  private pendingWrites: Map<string, PendingWrite<T>> = new Map()
  private pendingDeletes: Map<string, PendingDelete> = new Map()
  private flushTimeout: ReturnType<typeof setTimeout> | null = null
  private flushHandler: ((writes: Map<string, T>, deletes: Set<string>) => Promise<void>) | null = null

  private readonly flushDelay: number
  private readonly maxPending: number

  constructor(options: WriteBatcherOptions = {}) {
    this.flushDelay = options.flushDelay ?? 10
    this.maxPending = options.maxPending ?? 100
  }

  /**
   * Set the handler function that will be called to flush pending operations.
   *
   * @param handler - Function that receives batched writes and deletes
   */
  setFlushHandler(handler: (writes: Map<string, T>, deletes: Set<string>) => Promise<void>): void {
    this.flushHandler = handler
  }

  /**
   * Queue a write operation.
   *
   * Returns a promise that resolves when the write is flushed.
   */
  set(key: string, value: T): Promise<void> {
    // If there's a pending delete for this key, remove it
    const pendingDelete = this.pendingDeletes.get(key)
    if (pendingDelete) {
      pendingDelete.resolve()
      this.pendingDeletes.delete(key)
    }

    // If there's an existing pending write for this key, update it
    const existing = this.pendingWrites.get(key)
    if (existing) {
      existing.value = value
      return new Promise((resolve, reject) => {
        const originalResolve = existing.resolve
        const originalReject = existing.reject
        existing.resolve = () => {
          originalResolve()
          resolve()
        }
        existing.reject = (err) => {
          originalReject(err)
          reject(err)
        }
      })
    }

    return new Promise((resolve, reject) => {
      this.pendingWrites.set(key, { key, value, resolve, reject })
      this.scheduleFlush()
    })
  }

  /**
   * Queue a delete operation.
   *
   * Returns a promise that resolves when the delete is flushed.
   */
  delete(key: string): Promise<void> {
    // If there's a pending write for this key, remove it
    const pendingWrite = this.pendingWrites.get(key)
    if (pendingWrite) {
      pendingWrite.resolve()
      this.pendingWrites.delete(key)
    }

    // If there's an existing pending delete for this key, chain to it
    const existing = this.pendingDeletes.get(key)
    if (existing) {
      return new Promise((resolve, reject) => {
        const originalResolve = existing.resolve
        const originalReject = existing.reject
        existing.resolve = () => {
          originalResolve()
          resolve()
        }
        existing.reject = (err) => {
          originalReject(err)
          reject(err)
        }
      })
    }

    return new Promise((resolve, reject) => {
      this.pendingDeletes.set(key, { key, resolve, reject })
      this.scheduleFlush()
    })
  }

  /**
   * Get the number of pending operations.
   */
  get pendingCount(): number {
    return this.pendingWrites.size + this.pendingDeletes.size
  }

  /**
   * Force an immediate flush of all pending operations.
   */
  async flush(): Promise<void> {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = null
    }

    if (this.pendingWrites.size === 0 && this.pendingDeletes.size === 0) {
      return
    }

    // Capture current pending operations
    const writes = new Map(
      Array.from(this.pendingWrites.entries()).map(([k, v]) => [k, v.value])
    )
    const deletes = new Set(this.pendingDeletes.keys())
    const writeCallbacks = Array.from(this.pendingWrites.values())
    const deleteCallbacks = Array.from(this.pendingDeletes.values())

    // Clear pending before async operation
    this.pendingWrites.clear()
    this.pendingDeletes.clear()

    if (!this.flushHandler) {
      const error = new Error('No flush handler set')
      writeCallbacks.forEach((cb) => cb.reject(error))
      deleteCallbacks.forEach((cb) => cb.reject(error))
      return
    }

    try {
      await this.flushHandler(writes, deletes)
      writeCallbacks.forEach((cb) => cb.resolve())
      deleteCallbacks.forEach((cb) => cb.resolve())
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      writeCallbacks.forEach((cb) => cb.reject(err))
      deleteCallbacks.forEach((cb) => cb.reject(err))
    }
  }

  /**
   * Cancel all pending operations.
   */
  cancel(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = null
    }

    const error = new Error('Batcher cancelled')
    this.pendingWrites.forEach((cb) => cb.reject(error))
    this.pendingDeletes.forEach((cb) => cb.reject(error))
    this.pendingWrites.clear()
    this.pendingDeletes.clear()
  }

  /**
   * Destroy the batcher and flush remaining operations.
   */
  async destroy(): Promise<void> {
    await this.flush()
  }

  private scheduleFlush(): void {
    // Check if we should force a flush due to max pending
    if (this.pendingCount >= this.maxPending) {
      void this.flush()
      return
    }

    // Schedule a delayed flush
    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => {
        this.flushTimeout = null
        void this.flush()
      }, this.flushDelay)
    }
  }
}

/**
 * Create a batched version of set/delete operations.
 *
 * @param options - Batcher options
 * @param flushHandler - Function to execute batched operations
 * @returns Object with batched set/delete functions
 */
export function createBatchedOperations<T>(
  options: WriteBatcherOptions,
  flushHandler: (writes: Map<string, T>, deletes: Set<string>) => Promise<void>
): {
  set: (key: string, value: T) => Promise<void>
  delete: (key: string) => Promise<void>
  flush: () => Promise<void>
  cancel: () => void
  getPendingCount: () => number
} {
  const batcher = new WriteBatcher<T>(options)
  batcher.setFlushHandler(flushHandler)

  return {
    set: (key, value) => batcher.set(key, value),
    delete: (key) => batcher.delete(key),
    flush: () => batcher.flush(),
    cancel: () => batcher.cancel(),
    getPendingCount: () => batcher.pendingCount,
  }
}
