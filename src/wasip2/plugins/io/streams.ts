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
  /** Read bytes without blocking - returns empty if none available */
  blockingRead(len: bigint): Promise<Uint8Array | StreamError>
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
  blockingWriteAndFlush(contents: Uint8Array): Promise<StreamError | undefined>
  /** Flush the stream */
  flush(): StreamError | undefined
  /** Blocking flush */
  blockingFlush(): Promise<StreamError | undefined>
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

  async blockingRead(len: bigint): Promise<Uint8Array | StreamError> {
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
 * Memory-backed output stream (growable buffer)
 */
export class MemoryOutputStream implements OutputStream {
  handle = 0
  private chunks: Uint8Array[] = []
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

    const currentSize = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (currentSize + contents.length > this.maxSize) {
      return {
        tag: 'last-operation-failed',
        val: new WasiError(WasiErrorCode.OutOfMemory, 'Stream buffer full'),
      }
    }

    this.chunks.push(contents.slice())
    return undefined
  }

  async blockingWriteAndFlush(
    contents: Uint8Array
  ): Promise<StreamError | undefined> {
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

  async blockingFlush(): Promise<StreamError | undefined> {
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
    const totalLength = this.chunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0
    )
    const result = new Uint8Array(totalLength)
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
  }
}

/**
 * Global stream registry
 */
export const globalStreamRegistry = new StreamRegistry()
