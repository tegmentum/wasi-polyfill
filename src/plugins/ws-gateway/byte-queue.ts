/**
 * ByteQueue - Per-connection receive FIFO buffer
 *
 * Efficiently buffers incoming data chunks and provides
 * read operations that consume data from the front.
 */

/**
 * A FIFO queue for byte data with efficient chunk management
 */
export class ByteQueue {
  private chunks: Uint8Array[] = []
  private totalBytes = 0
  private readOffset = 0
  private readonly maxSize: number
  private closed = false
  private error?: Error

  /**
   * Create a new ByteQueue
   * @param maxSize Maximum bytes to buffer (default 8MB)
   */
  constructor(maxSize: number = 8 * 1024 * 1024) {
    this.maxSize = maxSize
  }

  /**
   * Get the number of bytes available to read
   */
  get available(): number {
    return this.totalBytes - this.readOffset
  }

  /**
   * Check if the queue is empty
   */
  get isEmpty(): boolean {
    return this.available === 0
  }

  /**
   * Check if the queue is closed
   */
  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Get any error that occurred
   */
  get lastError(): Error | undefined {
    return this.error
  }

  /**
   * Get the maximum buffer size
   */
  get capacity(): number {
    return this.maxSize
  }

  /**
   * Get how much space is available for writing
   */
  get freeSpace(): number {
    return Math.max(0, this.maxSize - this.available)
  }

  /**
   * Push data onto the queue
   * @returns true if successful, false if would exceed max size
   */
  push(data: Uint8Array): boolean {
    if (this.closed) {
      return false
    }

    if (this.available + data.length > this.maxSize) {
      return false
    }

    // Make a copy to avoid external mutation
    this.chunks.push(data.slice())
    this.totalBytes += data.length

    return true
  }

  /**
   * Read up to `length` bytes from the queue
   * @returns The data read (may be less than requested)
   */
  read(length: number): Uint8Array {
    if (this.isEmpty) {
      return new Uint8Array(0)
    }

    const toRead = Math.min(length, this.available)
    const result = new Uint8Array(toRead)
    let resultOffset = 0
    let remaining = toRead

    while (remaining > 0 && this.chunks.length > 0) {
      const chunk = this.chunks[0]!
      const chunkAvailable = chunk.length - this.readOffset
      const copyLen = Math.min(remaining, chunkAvailable)

      result.set(chunk.subarray(this.readOffset, this.readOffset + copyLen), resultOffset)

      resultOffset += copyLen
      remaining -= copyLen
      this.readOffset += copyLen

      // If we've consumed the entire chunk, remove it
      if (this.readOffset >= chunk.length) {
        this.chunks.shift()
        this.totalBytes -= chunk.length
        this.readOffset = 0
      }
    }

    return result
  }

  /**
   * Peek at data without consuming it
   * @returns Copy of the data (up to length bytes)
   */
  peek(length: number): Uint8Array {
    if (this.isEmpty) {
      return new Uint8Array(0)
    }

    const toRead = Math.min(length, this.available)
    const result = new Uint8Array(toRead)
    let resultOffset = 0
    let remaining = toRead
    let chunkIndex = 0
    let offset = this.readOffset

    while (remaining > 0 && chunkIndex < this.chunks.length) {
      const chunk = this.chunks[chunkIndex]!
      const chunkAvailable = chunk.length - offset
      const copyLen = Math.min(remaining, chunkAvailable)

      result.set(chunk.subarray(offset, offset + copyLen), resultOffset)

      resultOffset += copyLen
      remaining -= copyLen

      chunkIndex++
      offset = 0
    }

    return result
  }

  /**
   * Skip bytes without reading them
   * @returns Number of bytes actually skipped
   */
  skip(length: number): number {
    if (this.isEmpty) {
      return 0
    }

    const toSkip = Math.min(length, this.available)
    let remaining = toSkip

    while (remaining > 0 && this.chunks.length > 0) {
      const chunk = this.chunks[0]!
      const chunkAvailable = chunk.length - this.readOffset
      const skipLen = Math.min(remaining, chunkAvailable)

      remaining -= skipLen
      this.readOffset += skipLen

      if (this.readOffset >= chunk.length) {
        this.chunks.shift()
        this.totalBytes -= chunk.length
        this.readOffset = 0
      }
    }

    return toSkip
  }

  /**
   * Read all available data
   */
  readAll(): Uint8Array {
    return this.read(this.available)
  }

  /**
   * Close the queue (no more data will be accepted)
   */
  close(error?: Error): void {
    this.closed = true
    if (error !== undefined) {
      this.error = error
    }
  }

  /**
   * Clear all data from the queue
   */
  clear(): void {
    this.chunks = []
    this.totalBytes = 0
    this.readOffset = 0
  }

  /**
   * Reset the queue (clear data and reopen)
   */
  reset(): void {
    this.clear()
    this.closed = false
    delete this.error
  }
}

/**
 * A ByteQueue with async read support
 */
export class AsyncByteQueue extends ByteQueue {
  private waiters: Array<{
    resolve: (data: Uint8Array) => void
    reject: (error: Error) => void
    length: number
  }> = []

  /**
   * Push data and notify any waiters
   */
  override push(data: Uint8Array): boolean {
    const result = super.push(data)

    if (result) {
      this.notifyWaiters()
    }

    return result
  }

  /**
   * Close and notify any waiters
   */
  override close(error?: Error): void {
    super.close(error)
    this.notifyWaiters()
  }

  /**
   * Read data, waiting if necessary
   * @param length Maximum bytes to read
   * @param timeout Timeout in milliseconds (0 = no timeout)
   */
  async readAsync(length: number, timeout: number = 0): Promise<Uint8Array> {
    // If data is available, return immediately
    if (!this.isEmpty) {
      return this.read(length)
    }

    // If closed, return empty or throw
    if (this.isClosed) {
      if (this.lastError) {
        throw this.lastError
      }
      return new Uint8Array(0)
    }

    // Wait for data
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, length }
      this.waiters.push(waiter)

      if (timeout > 0) {
        setTimeout(() => {
          const index = this.waiters.indexOf(waiter)
          if (index !== -1) {
            this.waiters.splice(index, 1)
            reject(new Error('Read timeout'))
          }
        }, timeout)
      }
    })
  }

  /**
   * Wait until data is available or queue is closed
   */
  async waitForData(): Promise<boolean> {
    if (!this.isEmpty) {
      return true
    }

    if (this.isClosed) {
      return false
    }

    return new Promise((resolve) => {
      const waiter = {
        resolve: () => resolve(true),
        reject: () => resolve(false),
        length: 1,
      }
      this.waiters.push(waiter)
    })
  }

  /**
   * Notify waiters that data is available
   */
  private notifyWaiters(): void {
    while (this.waiters.length > 0 && (!this.isEmpty || this.isClosed)) {
      const waiter = this.waiters.shift()!

      if (this.isClosed && this.isEmpty) {
        if (this.lastError) {
          waiter.reject(this.lastError)
        } else {
          waiter.resolve(new Uint8Array(0))
        }
      } else {
        waiter.resolve(this.read(waiter.length))
      }
    }
  }
}
