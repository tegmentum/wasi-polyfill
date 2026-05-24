/**
 * Stream implementations for wasi:io/streams
 *
 * Provides input and output stream abstractions that map to
 * JavaScript readable/writable patterns.
 */

import { WasiError, WasiErrorCode } from '../../../shared/errors.js'
import { PollableRegistry, createReadyPollable } from './pollable.js'

/**
 * Stream error type matching WASI stream-error
 */
export type StreamError =
  | { tag: 'last-operation-failed'; val: Error }
  | { tag: 'closed' }

/**
 * Base interface for streams
 */
export interface StreamBase {
  /** Resource handle */
  readonly handle: number
  /** Check if the stream is closed */
  isClosed(): boolean
  /** Close the stream */
  close(): void
}

/**
 * Input stream interface matching wasi:io/streams input-stream
 */
export interface InputStream extends StreamBase {
  /** Read up to len bytes */
  read(len: bigint): Uint8Array | StreamError
  /** Blocking read - returns data or stream error */
  blockingRead(len: bigint): (Uint8Array | StreamError) | Promise<Uint8Array | StreamError>
  /** Skip up to len bytes */
  skip(len: bigint): bigint | StreamError
  /** Get a pollable for when data is available */
  subscribe(registry: PollableRegistry): number
}

/**
 * Output stream interface matching wasi:io/streams output-stream
 */
export interface OutputStream extends StreamBase {
  /** Check how many bytes can be written without blocking */
  checkWrite(): bigint | StreamError
  /** Write bytes (may write fewer than requested) */
  write(contents: Uint8Array): StreamError | undefined
  /** Write bytes, blocking until all are written */
  blockingWriteAndFlush(contents: Uint8Array): (StreamError | undefined) | Promise<StreamError | undefined>
  /** Flush the stream */
  flush(): StreamError | undefined
  /** Blocking flush */
  blockingFlush(): (StreamError | undefined) | Promise<StreamError | undefined>
  /** Get a pollable for when the stream can accept writes */
  subscribe(registry: PollableRegistry): number
  /** Write zeroes */
  writeZeroes(len: bigint): StreamError | undefined
  /** Splice from an input stream */
  splice(src: InputStream, len: bigint): bigint | StreamError
}

/**
 * Stream handle manager
 */
export class StreamRegistry {
  private nextHandle = 1
  private readonly streams: Map<number, StreamBase> = new Map()

  /**
   * Register a stream and return its handle
   */
  register<T extends StreamBase>(stream: T): number {
    const handle = this.nextHandle++
    ;(stream as { handle: number }).handle = handle
    this.streams.set(handle, stream)
    return handle
  }

  /**
   * Get a stream by handle
   */
  get(handle: number): StreamBase | undefined {
    return this.streams.get(handle)
  }

  /**
   * Get an input stream by handle
   */
  getInput(handle: number): InputStream | undefined {
    const stream = this.streams.get(handle)
    if (stream && 'read' in stream) {
      return stream as InputStream
    }
    return undefined
  }

  /**
   * Get an output stream by handle
   */
  getOutput(handle: number): OutputStream | undefined {
    const stream = this.streams.get(handle)
    if (stream && 'write' in stream) {
      return stream as OutputStream
    }
    return undefined
  }

  /**
   * Drop a stream
   */
  drop(handle: number): boolean {
    const stream = this.streams.get(handle)
    if (stream) {
      stream.close()
      return this.streams.delete(handle)
    }
    return false
  }

  /**
   * Clear all streams
   */
  clear(): void {
    for (const stream of this.streams.values()) {
      stream.close()
    }
    this.streams.clear()
  }

  /**
   * Get the number of active streams
   */
  get size(): number {
    return this.streams.size
  }
}

/**
 * Memory-backed input stream
 */
export class MemoryInputStream implements InputStream {
  handle = 0
  private data: Uint8Array
  private position = 0
  private closed = false

  constructor(data: Uint8Array) {
    this.data = data
  }

  isClosed(): boolean {
    return this.closed
  }

  close(): void {
    this.closed = true
  }

  read(len: bigint): Uint8Array | StreamError {
    if (this.closed) {
      return { tag: 'closed' }
    }

    const length = Math.min(Number(len), this.data.length - this.position)
    if (length === 0 && this.position >= this.data.length) {
      return { tag: 'closed' }
    }

    const result = this.data.slice(this.position, this.position + length)
    this.position += length
    return result
  }

  blockingRead(len: bigint): Uint8Array | StreamError {
    // Memory streams are always ready, so this is the same as read
    return this.read(len)
  }

  skip(len: bigint): bigint | StreamError {
    if (this.closed) {
      return { tag: 'closed' }
    }

    const skipAmount = Math.min(Number(len), this.data.length - this.position)
    this.position += skipAmount
    return BigInt(skipAmount)
  }

  subscribe(registry: PollableRegistry): number {
    // Memory streams are always ready
    return createReadyPollable(registry)
  }

  /**
   * Get remaining bytes available
   */
  available(): number {
    return this.data.length - this.position
  }
}

/**
 * Input stream backed by a WHATWG `ReadableStream<Uint8Array>` (e.g. a fetch
 * `Response.body`). A background pump drains the reader into an internal buffer,
 * so the body is consumed incrementally instead of being fully materialized.
 *
 * `read` is non-blocking (returns whatever is buffered, possibly empty);
 * `blockingRead` is genuinely async (it awaits the next chunk), so this is for
 * async/JSPI execution contexts — synchronous jco trampolines should use the
 * buffered {@link MemoryInputStream} instead.
 */
export class ReadableStreamInputStream implements InputStream {
  handle = 0
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private readonly chunks: Uint8Array[] = []
  private offset = 0
  private ended = false
  private closed = false
  private failure: Error | null = null
  private waiters: Array<() => void> = []

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader()
    void this.pump()
  }

  private async pump(): Promise<void> {
    try {
      for (;;) {
        const { done, value } = await this.reader.read()
        if (done) break
        if (value && value.length > 0) {
          this.chunks.push(value)
          this.wake()
        }
      }
    } catch (e) {
      this.failure = e instanceof Error ? e : new Error(String(e))
    } finally {
      this.ended = true
      this.wake()
    }
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) resolve()
  }

  private bufferedBytes(): number {
    let total = -this.offset
    for (const c of this.chunks) total += c.length
    return total
  }

  private drain(maxLen: number): Uint8Array {
    const take = Math.min(maxLen, this.bufferedBytes())
    const result = new Uint8Array(Math.max(0, take))
    let written = 0
    while (written < take && this.chunks.length > 0) {
      const chunk = this.chunks[0]!
      const n = Math.min(take - written, chunk.length - this.offset)
      result.set(chunk.subarray(this.offset, this.offset + n), written)
      written += n
      this.offset += n
      if (this.offset >= chunk.length) {
        this.chunks.shift()
        this.offset = 0
      }
    }
    return result
  }

  isClosed(): boolean {
    return this.closed
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    void this.reader.cancel().catch(() => {})
    this.wake()
  }

  read(len: bigint): Uint8Array | StreamError {
    if (this.closed) return { tag: 'closed' }
    if (this.bufferedBytes() > 0) return this.drain(Number(len))
    if (this.failure) return { tag: 'last-operation-failed', val: this.failure }
    if (this.ended) return { tag: 'closed' }
    return new Uint8Array(0) // open, but no data ready yet
  }

  async blockingRead(len: bigint): Promise<Uint8Array | StreamError> {
    for (;;) {
      if (this.closed) return { tag: 'closed' }
      if (this.bufferedBytes() > 0) return this.drain(Number(len))
      if (this.failure) return { tag: 'last-operation-failed', val: this.failure }
      if (this.ended) return { tag: 'closed' }
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  skip(len: bigint): bigint | StreamError {
    if (this.closed) return { tag: 'closed' }
    if (this.bufferedBytes() === 0) {
      return this.ended ? { tag: 'closed' } : 0n
    }
    const before = this.bufferedBytes()
    this.drain(Number(len))
    return BigInt(before - this.bufferedBytes())
  }

  subscribe(registry: PollableRegistry): number {
    if (this.bufferedBytes() > 0 || this.ended || this.closed) {
      return createReadyPollable(registry)
    }
    const promise = new Promise<void>((resolve) => this.waiters.push(resolve))
    return registry.create(promise)
  }
}

/**
 * Memory-backed output stream (growable buffer)
 */
export class MemoryOutputStream implements OutputStream {
  handle = 0
  private chunks: Uint8Array[] = []
  private totalSize = 0
  private closed = false
  private readonly maxSize: number

  constructor(maxSize = 1024 * 1024 * 10) {
    // Default 10MB max
    this.maxSize = maxSize
  }

  isClosed(): boolean {
    return this.closed
  }

  close(): void {
    this.closed = true
  }

  checkWrite(): bigint | StreamError {
    if (this.closed) {
      return { tag: 'closed' }
    }
    // Allow up to 64KB at a time
    return 65536n
  }

  write(contents: Uint8Array): StreamError | undefined {
    if (this.closed) {
      return { tag: 'closed' }
    }

    if (this.totalSize + contents.length > this.maxSize) {
      return {
        tag: 'last-operation-failed',
        val: new WasiError(WasiErrorCode.OutOfMemory, 'Stream buffer full'),
      }
    }

    // Copy: the caller may reuse its buffer after write returns.
    this.chunks.push(contents.slice())
    this.totalSize += contents.length
    return undefined
  }

  blockingWriteAndFlush(
    contents: Uint8Array
  ): StreamError | undefined {
    const error = this.write(contents)
    if (error) return error
    return this.flush()
  }

  flush(): StreamError | undefined {
    if (this.closed) {
      return { tag: 'closed' }
    }
    // Memory streams don't need flushing
    return undefined
  }

  blockingFlush(): StreamError | undefined {
    return this.flush()
  }

  subscribe(registry: PollableRegistry): number {
    // Memory streams are always ready for writing
    return createReadyPollable(registry)
  }

  writeZeroes(len: bigint): StreamError | undefined {
    const zeroes = new Uint8Array(Number(len))
    return this.write(zeroes)
  }

  splice(src: InputStream, len: bigint): bigint | StreamError {
    const data = src.read(len)
    if (!(data instanceof Uint8Array)) {
      return data
    }
    const error = this.write(data)
    if (error) return error
    return BigInt(data.length)
  }

  /**
   * Get all written data as a single buffer
   */
  getBuffer(): Uint8Array {
    const result = new Uint8Array(this.totalSize)
    let offset = 0
    for (const chunk of this.chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  /**
   * Get all written data as a string (UTF-8)
   */
  getString(): string {
    return new TextDecoder().decode(this.getBuffer())
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.chunks = []
    this.totalSize = 0
  }
}

/**
 * Global stream registry
 */
export const globalStreamRegistry = new StreamRegistry()
