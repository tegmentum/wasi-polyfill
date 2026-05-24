import { describe, it, expect } from 'vitest'
import {
  createStream,
  streamFromAsyncIterable,
  streamFromReadable,
  writerFromWritable,
  collectStream,
} from '../../src/wasip3/canonical-abi/stream.js'

describe('WASIP3 Stream', () => {
  describe('createStream', () => {
    it('creates a reader/writer pair', () => {
      const [reader, writer] = createStream<number>()
      expect(reader).toBeDefined()
      expect(writer).toBeDefined()
      expect(typeof reader.read).toBe('function')
      expect(typeof reader.close).toBe('function')
      expect(typeof reader.cancel).toBe('function')
      expect(typeof writer.write).toBe('function')
      expect(typeof writer.close).toBe('function')
      expect(typeof writer.cancel).toBe('function')
    })

    it('writes and reads a single value', async () => {
      const [reader, writer] = createStream<string>()

      const writeResult = await writer.write(['hello'])
      expect(writeResult).toEqual({ status: 'ok', count: 1 })

      const readResult = await reader.read()
      expect(readResult).toEqual({ status: 'values', values: ['hello'] })
    })

    it('writes and reads multiple values', async () => {
      const [reader, writer] = createStream<number>()

      await writer.write([1, 2, 3])
      const result = await reader.read()
      expect(result).toEqual({ status: 'values', values: [1, 2, 3] })
    })

    it('returns end status when writer closes', async () => {
      const [reader, writer] = createStream<string>()

      writer.close()
      const result = await reader.read()
      expect(result).toEqual({ status: 'end' })
    })

    it('handles pending read that resolves when write occurs', async () => {
      const [reader, writer] = createStream<string>()

      // Start reading before any data is written
      const readPromise = reader.read()

      // Write data after a delay
      await new Promise((resolve) => setTimeout(resolve, 10))
      await writer.write(['delayed'])

      const result = await readPromise
      expect(result).toEqual({ status: 'values', values: ['delayed'] })
    })

    it('handles pending read that resolves when writer closes', async () => {
      const [reader, writer] = createStream<string>()

      // Start reading before writer closes
      const readPromise = reader.read()

      // Close writer after a delay
      await new Promise((resolve) => setTimeout(resolve, 10))
      writer.close()

      const result = await readPromise
      expect(result).toEqual({ status: 'end' })
    })

    it('returns cancelled status when stream is cancelled', async () => {
      const [reader, writer] = createStream<string>()

      reader.cancel()

      const readResult = await reader.read()
      expect(readResult).toEqual({ status: 'cancelled' })

      const writeResult = await writer.write(['test'])
      expect(writeResult).toEqual({ status: 'cancelled' })
    })

    it('returns cancelled status for pending read when cancelled', async () => {
      const [reader, _writer] = createStream<string>()

      // Start reading
      const readPromise = reader.read()

      // Cancel the stream
      reader.cancel()

      const result = await readPromise
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('returns cancelled status for pending write when cancelled', async () => {
      const [reader, writer] = createStream<string>()

      // Fill buffer first
      await writer.write(['first'])

      // Start a write that will block
      const writePromise = writer.write(['second'])

      // Cancel the stream
      reader.cancel()

      const result = await writePromise
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('returns closed status when reader closes before write', async () => {
      const [reader, writer] = createStream<string>()

      reader.close()

      const result = await writer.write(['test'])
      expect(result).toEqual({ status: 'closed' })
    })

    it('returns closed status for pending write when reader closes', async () => {
      const [reader, writer] = createStream<string>()

      // Fill buffer
      await writer.write(['first'])

      // Start a write that will block
      const writePromise = writer.write(['second'])

      // Close reader
      reader.close()

      const result = await writePromise
      expect(result).toEqual({ status: 'closed' })
    })

    it('returns closed status when writer is already closed', async () => {
      const [_reader, writer] = createStream<string>()

      writer.close()

      const result = await writer.write(['test'])
      expect(result).toEqual({ status: 'closed' })
    })

    it('handles backpressure by blocking writes', async () => {
      const [reader, writer] = createStream<number>()

      // Write first batch
      const result1 = await writer.write([1, 2])
      expect(result1).toEqual({ status: 'ok', count: 2 })

      // Second write should block
      const writePromise = writer.write([3, 4])
      let writeResolved = false
      writePromise.then(() => {
        writeResolved = true
      })

      // Verify write is pending
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(writeResolved).toBe(false)

      // Read to unblock
      const readResult = await reader.read()
      expect(readResult).toEqual({ status: 'values', values: [1, 2] })

      // Write should now resolve
      const result2 = await writePromise
      expect(result2).toEqual({ status: 'ok', count: 2 })
    })

    it('writer.cancel also cancels pending reads', async () => {
      const [reader, writer] = createStream<string>()

      const readPromise = reader.read()
      writer.cancel()

      const result = await readPromise
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('handles typed arrays', async () => {
      const [reader, writer] = createStream<Uint8Array>()

      const data = new Uint8Array([1, 2, 3, 4, 5])
      await writer.write([data])

      const result = await reader.read()
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(result.values[0]).toEqual(data)
      }
    })

    it('handles objects', async () => {
      const [reader, writer] = createStream<{ name: string; value: number }>()

      const obj = { name: 'test', value: 42 }
      await writer.write([obj])

      const result = await reader.read()
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(result.values[0]).toEqual(obj)
      }
    })
  })

  describe('streamFromAsyncIterable', () => {
    it('creates a stream from async generator', async () => {
      async function* generator() {
        yield 1
        yield 2
        yield 3
      }

      const stream = streamFromAsyncIterable(generator())

      const result1 = await stream.read()
      expect(result1).toEqual({ status: 'values', values: [1] })

      const result2 = await stream.read()
      expect(result2).toEqual({ status: 'values', values: [2] })

      const result3 = await stream.read()
      expect(result3).toEqual({ status: 'values', values: [3] })

      const result4 = await stream.read()
      expect(result4).toEqual({ status: 'end' })
    })

    it('returns end after iterator is exhausted', async () => {
      async function* generator() {
        yield 'only one'
      }

      const stream = streamFromAsyncIterable(generator())

      await stream.read()
      const result = await stream.read()
      expect(result).toEqual({ status: 'end' })
    })

    it('handles empty iterator', async () => {
      async function* generator() {
        // Empty
      }

      const stream = streamFromAsyncIterable(generator())

      const result = await stream.read()
      expect(result).toEqual({ status: 'end' })
    })

    it('returns cancelled status when cancelled', async () => {
      async function* generator() {
        yield 1
        yield 2
      }

      const stream = streamFromAsyncIterable(generator())

      stream.cancel()

      const result = await stream.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('close stops the iterator', async () => {
      let cleanupCalled = false
      async function* generator() {
        try {
          yield 1
          yield 2
          yield 3
        } finally {
          cleanupCalled = true
        }
      }

      const stream = streamFromAsyncIterable(generator())

      await stream.read()
      stream.close()

      // Allow cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(cleanupCalled).toBe(true)
    })

    it('surfaces iterator errors as an error result (not EOF)', async () => {
      async function* generator() {
        yield 1
        throw new Error('Iterator error')
      }

      const stream = streamFromAsyncIterable(generator())

      const result1 = await stream.read()
      expect(result1).toEqual({ status: 'values', values: [1] })

      const result2 = await stream.read()
      expect(result2.status).toBe('error')
      if (result2.status === 'error') {
        expect(result2.error).toBeInstanceOf(Error)
        expect(result2.error.message).toBe('Iterator error')
      }
    })

    it('works with array async iteration', async () => {
      const array = [10, 20, 30]
      async function* fromArray() {
        for (const item of array) {
          yield item
        }
      }

      const stream = streamFromAsyncIterable(fromArray())
      const collected = await collectStream(stream)

      expect(collected).toEqual([10, 20, 30])
    })
  })

  describe('streamFromReadable', () => {
    it('creates a stream from ReadableStream', async () => {
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.enqueue(new Uint8Array([4, 5, 6]))
          controller.close()
        },
      })

      const stream = streamFromReadable(readable)

      const result1 = await stream.read()
      expect(result1.status).toBe('values')
      if (result1.status === 'values') {
        expect(result1.values[0]).toEqual(new Uint8Array([1, 2, 3]))
      }

      const result2 = await stream.read()
      expect(result2.status).toBe('values')
      if (result2.status === 'values') {
        expect(result2.values[0]).toEqual(new Uint8Array([4, 5, 6]))
      }

      const result3 = await stream.read()
      expect(result3).toEqual({ status: 'end' })
    })

    it('returns end when ReadableStream closes', async () => {
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      })

      const stream = streamFromReadable(readable)
      const result = await stream.read()
      expect(result).toEqual({ status: 'end' })
    })

    it('returns cancelled when cancelled', async () => {
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]))
        },
      })

      const stream = streamFromReadable(readable)
      stream.cancel()

      const result = await stream.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('close cancels the ReadableStream', async () => {
      let wasCancelled = false
      const readable = new ReadableStream<Uint8Array>({
        cancel() {
          wasCancelled = true
        },
        start(controller) {
          controller.enqueue(new Uint8Array([1]))
        },
      })

      const stream = streamFromReadable(readable)
      stream.close()

      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(wasCancelled).toBe(true)
    })

    it('handles ReadableStream errors', async () => {
      // Note: When error is called immediately after enqueue,
      // the read may see either the value or the error depending on timing
      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new Uint8Array([1]))
          // Give time for the enqueue to be processed
          await new Promise((r) => setTimeout(r, 10))
          controller.error(new Error('Stream error'))
        },
      })

      const stream = streamFromReadable(readable)

      const result1 = await stream.read()
      expect(result1.status).toBe('values')

      const result2 = await stream.read()
      expect(result2.status).toBe('error')
      if (result2.status === 'error') {
        expect(result2.error).toBeInstanceOf(Error)
        expect(result2.error.message).toBe('Stream error')
      }
    })
  })

  describe('writerFromWritable', () => {
    it('creates a writer from WritableStream', async () => {
      const chunks: Uint8Array[] = []
      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(chunk)
        },
      })

      const writer = writerFromWritable(writable)

      const result = await writer.write([
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4]),
      ])
      expect(result).toEqual({ status: 'ok', count: 2 })
      expect(chunks).toEqual([new Uint8Array([1, 2]), new Uint8Array([3, 4])])
    })

    it('returns closed after close is called', async () => {
      const writable = new WritableStream<Uint8Array>()
      const writer = writerFromWritable(writable)

      writer.close()

      const result = await writer.write([new Uint8Array([1])])
      expect(result).toEqual({ status: 'closed' })
    })

    it('returns cancelled after cancel is called', async () => {
      const writable = new WritableStream<Uint8Array>()
      const writer = writerFromWritable(writable)

      writer.cancel()

      const result = await writer.write([new Uint8Array([1])])
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('surfaces WritableStream errors as an error result (not a clean close)', async () => {
      const writable = new WritableStream<Uint8Array>({
        write() {
          throw new Error('Write error')
        },
      })

      const writer = writerFromWritable(writable)

      const result = await writer.write([new Uint8Array([1])])
      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error).toBeInstanceOf(Error)
      }
    })

    it('close calls WritableStream close', async () => {
      let closeCalled = false
      const writable = new WritableStream<Uint8Array>({
        close() {
          closeCalled = true
        },
      })

      const writer = writerFromWritable(writable)
      writer.close()

      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(closeCalled).toBe(true)
    })

    it('cancel calls WritableStream abort', async () => {
      let abortCalled = false
      const writable = new WritableStream<Uint8Array>({
        abort() {
          abortCalled = true
        },
      })

      const writer = writerFromWritable(writable)
      writer.cancel()

      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(abortCalled).toBe(true)
    })
  })

  describe('collectStream', () => {
    it('collects all values from a stream', async () => {
      const [reader, writer] = createStream<number>()

      // Start collecting in background
      const collectPromise = collectStream(reader)

      // Write values - these will be consumed as they're written
      await writer.write([1, 2, 3])
      await writer.write([4, 5])
      writer.close()

      const values = await collectPromise
      expect(values).toEqual([1, 2, 3, 4, 5])
    })

    it('returns empty array for empty stream', async () => {
      const [reader, writer] = createStream<string>()
      writer.close()

      const values = await collectStream(reader)
      expect(values).toEqual([])
    })

    it('stops collecting on cancelled', async () => {
      const [reader, writer] = createStream<number>()

      // Write values first
      await writer.write([1, 2])

      // Read them before cancelling
      const result = await reader.read()
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(result.values).toEqual([1, 2])
      }

      // Now cancel
      reader.cancel()

      // Collect should return empty since we already read the values
      const values = await collectStream(reader)
      expect(values).toEqual([])
    })

    it('collects from async iterable stream', async () => {
      async function* generator() {
        yield 'a'
        yield 'b'
        yield 'c'
      }

      const stream = streamFromAsyncIterable(generator())
      const values = await collectStream(stream)

      expect(values).toEqual(['a', 'b', 'c'])
    })

    it('collects typed arrays from ReadableStream', async () => {
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]))
          controller.enqueue(new Uint8Array([2]))
          controller.close()
        },
      })

      const stream = streamFromReadable(readable)
      const values = await collectStream(stream)

      expect(values).toEqual([new Uint8Array([1]), new Uint8Array([2])])
    })
  })

  describe('integration scenarios', () => {
    it('producer-consumer pattern', async () => {
      const [reader, writer] = createStream<string>()

      // Producer
      const producePromise = (async () => {
        for (const item of ['one', 'two', 'three']) {
          await writer.write([item])
        }
        writer.close()
      })()

      // Consumer
      const consumed = await collectStream(reader)

      await producePromise
      expect(consumed).toEqual(['one', 'two', 'three'])
    })

    it('pipeline of stream transformations', async () => {
      // Source stream
      async function* source() {
        yield 1
        yield 2
        yield 3
      }

      const sourceStream = streamFromAsyncIterable(source())

      // Transform: double each value
      const [transformedReader, transformedWriter] = createStream<number>()

      const transformPromise = (async () => {
        while (true) {
          const result = await sourceStream.read()
          if (result.status === 'values') {
            await transformedWriter.write(result.values.map((v) => v * 2))
          } else {
            transformedWriter.close()
            break
          }
        }
      })()

      // Collect results
      const results = await collectStream(transformedReader)
      await transformPromise

      expect(results).toEqual([2, 4, 6])
    })

    it('handles concurrent readers and writers', async () => {
      const [reader, writer] = createStream<number>()

      // Writer in background - writes sequentially to avoid backpressure deadlock
      const writePromise = (async () => {
        await writer.write([1])
        await writer.write([2])
        await writer.write([3])
        writer.close()
      })()

      // Read all - this runs concurrently with writes
      const values = await collectStream(reader)

      await writePromise

      expect(values.sort()).toEqual([1, 2, 3])
    })

    it('early close by reader', async () => {
      const [reader, writer] = createStream<number>()

      // Write some values
      await writer.write([1, 2])

      // Reader closes early
      reader.close()

      // Subsequent writes should fail
      const result = await writer.write([3])
      expect(result.status).toBe('closed')
    })

    it('stress test with many values', async () => {
      const [reader, writer] = createStream<number>()
      const count = 1000

      // Write many values
      const writePromise = (async () => {
        for (let i = 0; i < count; i++) {
          await writer.write([i])
        }
        writer.close()
      })()

      // Read and count
      const values = await collectStream(reader)
      await writePromise

      expect(values.length).toBe(count)
      expect(values).toEqual(Array.from({ length: count }, (_, i) => i))
    })
  })
})
