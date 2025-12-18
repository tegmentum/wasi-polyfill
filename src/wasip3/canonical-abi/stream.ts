/**
 * WASI Preview 3 stream implementation
 *
 * Implements the built-in `stream<T>` type from the async Component Model.
 * Streams replace P2's resource-based wasi:io/streams.
 *
 * @packageDocumentation
 */

import type {
  Stream,
  StreamWriter,
  StreamReadResult,
  StreamWriteResult,
} from '../types.js'

/**
 * Internal state for a stream.
 */
interface StreamState<T> {
  /** Buffered values waiting to be read */
  buffer: T[]
  /** Whether the write end is closed */
  writerClosed: boolean
  /** Whether the read end is closed */
  readerClosed: boolean
  /** Whether the stream is cancelled */
  cancelled: boolean
  /** Pending read resolver */
  pendingRead: ((result: StreamReadResult<T>) => void) | null
  /** Pending write resolver */
  pendingWrite: ((result: StreamWriteResult) => void) | null
  /** Pending write values */
  pendingWriteValues: T[] | null
}

/**
 * Creates a bidirectional stream pair (reader, writer).
 *
 * The stream provides buffered async communication between
 * a producer (writer) and consumer (reader).
 *
 * @typeParam T - The type of values in the stream
 * @returns A tuple of [Stream<T>, StreamWriter<T>]
 *
 * @example
 * ```typescript
 * const [reader, writer] = createStream<Uint8Array>()
 *
 * // Producer
 * await writer.write([new Uint8Array([1, 2, 3])])
 * writer.close()
 *
 * // Consumer
 * const result = await reader.read()
 * if (result.status === 'values') {
 *   console.log('Got:', result.values)
 * }
 * ```
 */
export function createStream<T>(): [Stream<T>, StreamWriter<T>] {
  const state: StreamState<T> = {
    buffer: [],
    writerClosed: false,
    readerClosed: false,
    cancelled: false,
    pendingRead: null,
    pendingWrite: null,
    pendingWriteValues: null,
  }

  const reader: Stream<T> = {
    read(): Promise<StreamReadResult<T>> {
      return new Promise((resolve) => {
        // Check if cancelled
        if (state.cancelled) {
          resolve({ status: 'cancelled' })
          return
        }

        // Check if we have buffered values
        if (state.buffer.length > 0) {
          const values = state.buffer.splice(0)
          resolve({ status: 'values', values })

          // If there's a pending write, process it now
          if (state.pendingWrite && state.pendingWriteValues) {
            const writeValues = state.pendingWriteValues
            const writeResolve = state.pendingWrite
            state.pendingWrite = null
            state.pendingWriteValues = null
            state.buffer.push(...writeValues)
            writeResolve({ status: 'ok', count: writeValues.length })
          }
          return
        }

        // Check if writer closed (no more data coming)
        if (state.writerClosed) {
          resolve({ status: 'end' })
          return
        }

        // Wait for data
        state.pendingRead = resolve
      })
    },

    close(): void {
      state.readerClosed = true
      // If there's a pending write, notify it that reader closed
      if (state.pendingWrite) {
        const writeResolve = state.pendingWrite
        state.pendingWrite = null
        state.pendingWriteValues = null
        writeResolve({ status: 'closed' })
      }
    },

    cancel(): void {
      state.cancelled = true
      // Resolve any pending read with cancelled
      if (state.pendingRead) {
        const readResolve = state.pendingRead
        state.pendingRead = null
        readResolve({ status: 'cancelled' })
      }
      // Resolve any pending write with cancelled
      if (state.pendingWrite) {
        const writeResolve = state.pendingWrite
        state.pendingWrite = null
        state.pendingWriteValues = null
        writeResolve({ status: 'cancelled' })
      }
    },
  }

  const writer: StreamWriter<T> = {
    write(values: T[]): Promise<StreamWriteResult> {
      return new Promise((resolve) => {
        // Check if cancelled
        if (state.cancelled) {
          resolve({ status: 'cancelled' })
          return
        }

        // Check if reader closed
        if (state.readerClosed) {
          resolve({ status: 'closed' })
          return
        }

        // Check if writer already closed
        if (state.writerClosed) {
          resolve({ status: 'closed' })
          return
        }

        // If there's a pending read, fulfill it directly
        if (state.pendingRead) {
          const readResolve = state.pendingRead
          state.pendingRead = null
          readResolve({ status: 'values', values })
          resolve({ status: 'ok', count: values.length })
          return
        }

        // Buffer the values (with backpressure)
        // For simplicity, we buffer immediately but could add backpressure
        if (state.buffer.length === 0) {
          state.buffer.push(...values)
          resolve({ status: 'ok', count: values.length })
        } else {
          // Apply backpressure - wait for reader to consume
          state.pendingWrite = resolve
          state.pendingWriteValues = values
        }
      })
    },

    close(): void {
      state.writerClosed = true
      // If there's a pending read, notify it that stream ended
      if (state.pendingRead) {
        const readResolve = state.pendingRead
        state.pendingRead = null
        readResolve({ status: 'end' })
      }
    },

    cancel(): void {
      state.cancelled = true
      state.writerClosed = true
      // Resolve any pending read with cancelled
      if (state.pendingRead) {
        const readResolve = state.pendingRead
        state.pendingRead = null
        readResolve({ status: 'cancelled' })
      }
      // Resolve any pending write with cancelled
      if (state.pendingWrite) {
        const writeResolve = state.pendingWrite
        state.pendingWrite = null
        state.pendingWriteValues = null
        writeResolve({ status: 'cancelled' })
      }
    },
  }

  return [reader, writer]
}

/**
 * Creates a stream from an async iterable.
 *
 * @typeParam T - The type of values in the stream
 * @param iterable - The async iterable to stream from
 * @returns A Stream<T> that yields values from the iterable
 */
export function streamFromAsyncIterable<T>(
  iterable: AsyncIterable<T>
): Stream<T> {
  const iterator = iterable[Symbol.asyncIterator]()
  let done = false
  let cancelled = false

  return {
    async read(): Promise<StreamReadResult<T>> {
      if (cancelled) {
        return { status: 'cancelled' }
      }
      if (done) {
        return { status: 'end' }
      }

      try {
        const result = await iterator.next()
        if (result.done) {
          done = true
          return { status: 'end' }
        }
        return { status: 'values', values: [result.value] }
      } catch {
        done = true
        return { status: 'end' }
      }
    },

    close(): void {
      done = true
      if (iterator.return) {
        iterator.return(undefined).catch(() => {})
      }
    },

    cancel(): void {
      cancelled = true
      done = true
      if (iterator.return) {
        iterator.return(undefined).catch(() => {})
      }
    },
  }
}

/**
 * Creates a stream from a browser ReadableStream.
 *
 * @param readable - The ReadableStream to wrap
 * @returns A Stream<Uint8Array> that reads from the ReadableStream
 */
export function streamFromReadable(
  readable: ReadableStream<Uint8Array>
): Stream<Uint8Array> {
  const reader = readable.getReader()
  let done = false
  let cancelled = false

  return {
    async read(): Promise<StreamReadResult<Uint8Array>> {
      if (cancelled) {
        return { status: 'cancelled' }
      }
      if (done) {
        return { status: 'end' }
      }

      try {
        const result = await reader.read()
        if (result.done) {
          done = true
          reader.releaseLock()
          return { status: 'end' }
        }
        return { status: 'values', values: [result.value] }
      } catch {
        done = true
        reader.releaseLock()
        return { status: 'end' }
      }
    },

    close(): void {
      if (!done) {
        done = true
        reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    },

    cancel(): void {
      cancelled = true
      if (!done) {
        done = true
        reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    },
  }
}

/**
 * Creates a StreamWriter that writes to a browser WritableStream.
 *
 * @param writable - The WritableStream to wrap
 * @returns A StreamWriter<Uint8Array> that writes to the WritableStream
 */
export function writerFromWritable(
  writable: WritableStream<Uint8Array>
): StreamWriter<Uint8Array> {
  const writer = writable.getWriter()
  let closed = false
  let cancelled = false

  return {
    async write(values: Uint8Array[]): Promise<StreamWriteResult> {
      if (cancelled) {
        return { status: 'cancelled' }
      }
      if (closed) {
        return { status: 'closed' }
      }

      try {
        for (const value of values) {
          await writer.write(value)
        }
        return { status: 'ok', count: values.length }
      } catch {
        closed = true
        return { status: 'closed' }
      }
    },

    close(): void {
      if (!closed && !cancelled) {
        closed = true
        writer.close().catch(() => {})
        writer.releaseLock()
      }
    },

    cancel(): void {
      if (!cancelled) {
        cancelled = true
        closed = true
        writer.abort().catch(() => {})
        writer.releaseLock()
      }
    },
  }
}

/**
 * Collect all values from a stream into an array.
 *
 * @typeParam T - The type of values in the stream
 * @param stream - The stream to collect from
 * @returns A promise that resolves to all values in the stream
 */
export async function collectStream<T>(stream: Stream<T>): Promise<T[]> {
  const values: T[] = []

  while (true) {
    const result = await stream.read()
    if (result.status === 'values') {
      values.push(...result.values)
    } else {
      break
    }
  }

  return values
}
