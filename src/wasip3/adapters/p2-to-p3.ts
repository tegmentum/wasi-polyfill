/**
 * WASI P2 to P3 Adapter Layer
 *
 * Wraps P2 plugin implementations to expose P3-compatible interfaces.
 * This enables reuse of existing P2 code with P3's async model.
 *
 * @packageDocumentation
 */

import type { Stream, StreamWriter, StreamReadResult, StreamWriteResult, Future } from '../types.js'
import { createFuture } from '../canonical-abi/future.js'

/**
 * P2 input stream interface (from wasi:io/streams).
 */
export interface P2InputStream {
  /** Read bytes from the stream */
  read(len: bigint): Uint8Array
  /** Check for available bytes without blocking */
  blockingRead?(len: bigint): Uint8Array
  /** Subscribe for read readiness (returns pollable ID) */
  subscribe?(): number
  /** Close the stream */
  drop?(): void
}

/**
 * P2 output stream interface (from wasi:io/streams).
 */
export interface P2OutputStream {
  /** Check how many bytes can be written */
  checkWrite?(): bigint
  /** Write bytes to the stream */
  write(contents: Uint8Array): void
  /** Flush the stream */
  flush?(): void
  /** Subscribe for write readiness (returns pollable ID) */
  subscribe?(): number
  /** Close the stream */
  drop?(): void
}

/**
 * P2 pollable interface.
 */
export interface P2Pollable {
  /** Check if ready */
  ready(): boolean
  /** Block until ready */
  block(): void
}

/**
 * Adapt a P2 input stream to a P3 Stream<Uint8Array>.
 *
 * Converts the pollable-based async model to native async.
 *
 * @param p2Stream - The P2 input stream
 * @param poll - Optional poll function for async reads
 * @returns P3-compatible stream
 */
export function adaptInputStream(
  p2Stream: P2InputStream,
  poll?: (pollableId: number) => Promise<void>
): Stream<Uint8Array> {
  let closed = false
  let cancelled = false

  return {
    async read(): Promise<StreamReadResult<Uint8Array>> {
      if (cancelled) {
        return { status: 'cancelled' }
      }

      if (closed) {
        return { status: 'end' }
      }

      try {
        // If we have async poll support, use it
        if (poll && p2Stream.subscribe) {
          const pollableId = p2Stream.subscribe()
          await poll(pollableId)
        }

        // Try to read
        const data = p2Stream.blockingRead
          ? p2Stream.blockingRead(4096n)
          : p2Stream.read(4096n)

        if (data.length === 0) {
          return { status: 'end' }
        }

        return { status: 'values', values: [data] }
      } catch (error) {
        // Check if it's an end-of-stream error
        if (error instanceof Error && error.message.includes('end')) {
          return { status: 'end' }
        }
        // Treat other errors as stream end
        return { status: 'end' }
      }
    },

    close(): void {
      closed = true
      if (p2Stream.drop) {
        p2Stream.drop()
      }
    },

    cancel(): void {
      cancelled = true
      closed = true
      if (p2Stream.drop) {
        p2Stream.drop()
      }
    },
  }
}

/**
 * Adapt a P2 output stream to a P3 StreamWriter<Uint8Array>.
 *
 * @param p2Stream - The P2 output stream
 * @param poll - Optional poll function for async writes
 * @returns P3-compatible stream writer
 */
export function adaptOutputStream(
  p2Stream: P2OutputStream,
  poll?: (pollableId: number) => Promise<void>
): StreamWriter<Uint8Array> {
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
        let totalWritten = 0

        for (const data of values) {
          // If we have async poll support, use it
          if (poll && p2Stream.subscribe) {
            const pollableId = p2Stream.subscribe()
            await poll(pollableId)
          }

          // Check write capacity if available
          if (p2Stream.checkWrite) {
            const capacity = p2Stream.checkWrite()
            // May need to chunk the write
            let offset = 0
            while (offset < data.length) {
              const chunkSize = Math.min(Number(capacity), data.length - offset)
              const chunk = data.slice(offset, offset + chunkSize)
              p2Stream.write(chunk)
              offset += chunkSize
              totalWritten++
            }
          } else {
            p2Stream.write(data)
            totalWritten++
          }
        }

        // Flush if available
        if (p2Stream.flush) {
          p2Stream.flush()
        }

        return { status: 'ok', count: totalWritten }
      } catch {
        return { status: 'closed' }
      }
    },

    close(): void {
      if (!closed) {
        closed = true
        if (p2Stream.flush) {
          try {
            p2Stream.flush()
          } catch {
            // Ignore flush errors on close
          }
        }
        if (p2Stream.drop) {
          p2Stream.drop()
        }
      }
    },

    cancel(): void {
      cancelled = true
      closed = true
      if (p2Stream.drop) {
        p2Stream.drop()
      }
    },
  }
}

/**
 * Adapt a P2 pollable to a P3 Future<void>.
 *
 * @param pollable - The P2 pollable
 * @returns P3-compatible future
 */
export function adaptPollable(pollable: P2Pollable): Future<void> {
  const [future, resolver] = createFuture<void>()

  // Check if already ready
  if (pollable.ready()) {
    resolver.resolve(undefined)
    return future
  }

  // Poll in background
  const checkReady = (): void => {
    if (pollable.ready()) {
      resolver.resolve(undefined)
    } else {
      setTimeout(checkReady, 0)
    }
  }
  checkReady()

  return future
}

/**
 * P2 filesystem descriptor interface.
 */
export interface P2Descriptor {
  /** Read file at offset */
  read?(length: bigint, offset: bigint): [Uint8Array, boolean]
  /** Write to file at offset */
  write?(buffer: Uint8Array, offset: bigint): bigint
  /** Get file size */
  stat?(): { size: bigint; type: string }
  /** Read directory entries */
  readDirectory?(): Iterable<{ name: string; type: string }>
  /** Close descriptor */
  drop?(): void
}

/**
 * Adapt a P2 file descriptor for reading to a P3 stream.
 *
 * @param descriptor - The P2 file descriptor
 * @param offset - Starting offset
 * @returns P3-compatible stream
 */
export function adaptFileRead(
  descriptor: P2Descriptor,
  offset: bigint = 0n
): Stream<Uint8Array> {
  let position = offset
  let closed = false
  let cancelled = false

  return {
    async read(): Promise<StreamReadResult<Uint8Array>> {
      if (cancelled) {
        return { status: 'cancelled' }
      }

      if (closed) {
        return { status: 'end' }
      }

      if (!descriptor.read) {
        return { status: 'end' }
      }

      try {
        const [data, eof] = descriptor.read(4096n, position)
        position += BigInt(data.length)

        if (data.length === 0 && eof) {
          return { status: 'end' }
        }

        return { status: 'values', values: [data] }
      } catch {
        return { status: 'end' }
      }
    },

    close(): void {
      closed = true
    },

    cancel(): void {
      cancelled = true
      closed = true
    },
  }
}

/**
 * Adapt a P2 file descriptor for writing to a P3 stream writer.
 *
 * @param descriptor - The P2 file descriptor
 * @param offset - Starting offset
 * @returns P3-compatible stream writer
 */
export function adaptFileWrite(
  descriptor: P2Descriptor,
  offset: bigint = 0n
): StreamWriter<Uint8Array> {
  let position = offset
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

      if (!descriptor.write) {
        return { status: 'closed' }
      }

      try {
        let totalWritten = 0

        for (const data of values) {
          const written = descriptor.write(data, position)
          position += written
          totalWritten++
        }

        return { status: 'ok', count: totalWritten }
      } catch {
        return { status: 'closed' }
      }
    },

    close(): void {
      closed = true
    },

    cancel(): void {
      cancelled = true
      closed = true
    },
  }
}

/**
 * Adapt P2 directory reading to a P3 stream.
 *
 * @param descriptor - The P2 directory descriptor
 * @returns P3-compatible stream of directory entries
 */
export function adaptDirectoryRead(
  descriptor: P2Descriptor
): Stream<{ name: string; type: string }> {
  let entries: Array<{ name: string; type: string }> = []
  let initialized = false
  let closed = false
  let cancelled = false

  return {
    async read(): Promise<StreamReadResult<{ name: string; type: string }>> {
      if (cancelled) {
        return { status: 'cancelled' }
      }

      if (closed) {
        return { status: 'end' }
      }

      // Initialize entries on first read
      if (!initialized) {
        initialized = true
        if (descriptor.readDirectory) {
          entries = Array.from(descriptor.readDirectory())
        }
      }

      if (entries.length === 0) {
        return { status: 'end' }
      }

      // Return all remaining entries
      const batch = entries.splice(0, 100)
      return { status: 'values', values: batch }
    },

    close(): void {
      closed = true
    },

    cancel(): void {
      cancelled = true
      closed = true
    },
  }
}

/**
 * P2 plugin interface.
 */
export interface P2Plugin {
  /** Get the WIT interface this plugin implements */
  witInterface: {
    package: string
    name: string
    version: string
  }
  /** Get imports for this plugin */
  getImports(): Record<string, unknown>
}

/**
 * P3 plugin interface.
 */
export interface P3Plugin {
  /** Get the WIT interface this plugin implements */
  witInterface: {
    package: string
    name: string
    version: string
  }
  /** Get imports for this plugin (async-compatible) */
  getImports(): Record<string, unknown>
}

/**
 * Adapt a P2 plugin to expose P3-compatible interfaces.
 *
 * This wraps P2 sync APIs to be callable from async contexts
 * and converts pollable-based patterns to native async.
 *
 * @param p2Plugin - The P2 plugin to adapt
 * @param pollFn - Optional function to resolve pollables
 * @returns P3-compatible plugin
 */
export function adaptP2ToP3(
  p2Plugin: P2Plugin,
  pollFn?: (pollableId: number) => Promise<void>
): P3Plugin {
  const p2Imports = p2Plugin.getImports()

  // Wrap each import function to be async-compatible
  const p3Imports: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(p2Imports)) {
    if (typeof value === 'function') {
      // Wrap function to return Promise
      p3Imports[key] = async (...args: unknown[]) => {
        return (value as (...args: unknown[]) => unknown)(...args)
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recursively wrap nested objects (like resources)
      p3Imports[key] = wrapObjectAsync(value as Record<string, unknown>, pollFn)
    } else {
      p3Imports[key] = value
    }
  }

  return {
    witInterface: {
      ...p2Plugin.witInterface,
      // Bump version to 0.3.0
      version: '0.3.0',
    },
    getImports: () => p3Imports,
  }
}

/**
 * Wrap an object's methods to be async.
 */
function wrapObjectAsync(
  obj: Record<string, unknown>,
  pollFn?: (pollableId: number) => Promise<void>
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'function') {
      // Special handling for stream methods
      if (key === 'read' || key === 'blockingRead') {
        wrapped[key] = async (...args: unknown[]) => {
          return (value as (...args: unknown[]) => unknown)(...args)
        }
      } else if (key === 'write' || key === 'blockingWrite') {
        wrapped[key] = async (...args: unknown[]) => {
          return (value as (...args: unknown[]) => unknown)(...args)
        }
      } else if (key === 'subscribe' && pollFn) {
        // Convert subscribe to async wait
        wrapped['wait'] = async () => {
          const pollableId = (value as () => number)()
          await pollFn(pollableId)
        }
      } else {
        wrapped[key] = async (...args: unknown[]) => {
          return (value as (...args: unknown[]) => unknown)(...args)
        }
      }
    } else {
      wrapped[key] = value
    }
  }

  return wrapped
}

/**
 * Create a P3 stream from a callback-based P2 pattern.
 *
 * @param readCallback - Callback to read data
 * @returns P3-compatible stream
 */
export function createStreamFromCallback<T>(
  readCallback: () => Promise<{ data?: T[]; done: boolean }>
): Stream<T> {
  let closed = false
  let cancelled = false

  return {
    async read(): Promise<StreamReadResult<T>> {
      if (cancelled) {
        return { status: 'cancelled' }
      }

      if (closed) {
        return { status: 'end' }
      }

      try {
        const result = await readCallback()

        if (result.done) {
          closed = true
          return { status: 'end' }
        }

        if (result.data && result.data.length > 0) {
          return { status: 'values', values: result.data }
        }

        return { status: 'end' }
      } catch {
        closed = true
        return { status: 'end' }
      }
    },

    close(): void {
      closed = true
    },

    cancel(): void {
      cancelled = true
      closed = true
    },
  }
}

/**
 * Create a P3 stream writer from a callback-based P2 pattern.
 *
 * @param writeCallback - Callback to write data
 * @param closeCallback - Optional callback on close
 * @returns P3-compatible stream writer
 */
export function createWriterFromCallback<T>(
  writeCallback: (data: T[]) => Promise<number>,
  closeCallback?: () => Promise<void>
): StreamWriter<T> {
  let closed = false
  let cancelled = false

  return {
    async write(values: T[]): Promise<StreamWriteResult> {
      if (cancelled) {
        return { status: 'cancelled' }
      }

      if (closed) {
        return { status: 'closed' }
      }

      try {
        const count = await writeCallback(values)
        return { status: 'ok', count }
      } catch {
        return { status: 'closed' }
      }
    },

    close(): void {
      if (!closed) {
        closed = true
        if (closeCallback) {
          closeCallback().catch(() => {})
        }
      }
    },

    cancel(): void {
      cancelled = true
      closed = true
    },
  }
}
