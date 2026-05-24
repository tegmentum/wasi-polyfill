import { describe, it, expect } from 'vitest'
import {
  adaptInputStream,
  adaptOutputStream,
  adaptPollable,
  adaptFileRead,
  adaptFileWrite,
  adaptDirectoryRead,
  adaptP2ToP3,
  createStreamFromCallback,
  createWriterFromCallback,
  type P2InputStream,
  type P2OutputStream,
  type P2Pollable,
  type P2Descriptor,
  type P2Plugin,
} from '../../src/wasip3/adapters/p2-to-p3.js'
import { collectStream } from '../../src/wasip3/canonical-abi/stream.js'

describe('WASIP3 P2-to-P3 Adapters', () => {
  describe('adaptInputStream', () => {
    it('adapts P2 input stream to P3 stream', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      let readCalled = false

      const p2Stream: P2InputStream = {
        read: (len: bigint) => {
          if (readCalled) {
            return new Uint8Array(0) // EOF
          }
          readCalled = true
          return data.slice(0, Number(len))
        },
      }

      const p3Stream = adaptInputStream(p2Stream)

      const result1 = await p3Stream.read()
      expect(result1.status).toBe('values')
      if (result1.status === 'values') {
        expect(result1.values[0]).toEqual(data.slice(0, 5))
      }

      const result2 = await p3Stream.read()
      expect(result2).toEqual({ status: 'end' })
    })

    it('handles blockingRead if available', async () => {
      const data = new Uint8Array([10, 20, 30])

      const p2Stream: P2InputStream = {
        read: () => new Uint8Array(0),
        blockingRead: (len: bigint) => {
          return data.slice(0, Math.min(Number(len), data.length))
        },
      }

      const p3Stream = adaptInputStream(p2Stream)

      const result = await p3Stream.read()
      expect(result.status).toBe('values')
    })

    it('returns cancelled when cancelled', async () => {
      const p2Stream: P2InputStream = {
        read: () => new Uint8Array([1, 2, 3]),
      }

      const p3Stream = adaptInputStream(p2Stream)
      p3Stream.cancel()

      const result = await p3Stream.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('calls drop on close', async () => {
      let dropped = false
      const p2Stream: P2InputStream = {
        read: () => new Uint8Array(0),
        drop: () => {
          dropped = true
        },
      }

      const p3Stream = adaptInputStream(p2Stream)
      p3Stream.close()

      expect(dropped).toBe(true)
    })

    it('handles read errors gracefully', async () => {
      const p2Stream: P2InputStream = {
        read: () => {
          throw new Error('Read error')
        },
      }

      const p3Stream = adaptInputStream(p2Stream)
      const result = await p3Stream.read()

      expect(result).toEqual({ status: 'end' })
    })

    it('uses poll function when provided', async () => {
      let pollCalled = false
      const p2Stream: P2InputStream = {
        read: () => new Uint8Array([1, 2, 3]),
        subscribe: () => 42,
      }

      const pollFn = async (pollableId: number) => {
        pollCalled = true
        expect(pollableId).toBe(42)
      }

      const p3Stream = adaptInputStream(p2Stream, pollFn)
      await p3Stream.read()

      expect(pollCalled).toBe(true)
    })
  })

  describe('adaptOutputStream', () => {
    it('adapts P2 output stream to P3 writer', async () => {
      const written: Uint8Array[] = []

      const p2Stream: P2OutputStream = {
        write: (contents: Uint8Array) => {
          written.push(new Uint8Array(contents))
        },
      }

      const p3Writer = adaptOutputStream(p2Stream)

      const result = await p3Writer.write([
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4]),
      ])

      expect(result).toEqual({ status: 'ok', count: 2 })
      expect(written).toEqual([new Uint8Array([1, 2]), new Uint8Array([3, 4])])
    })

    it('calls flush if available', async () => {
      let flushed = false

      const p2Stream: P2OutputStream = {
        write: () => {},
        flush: () => {
          flushed = true
        },
      }

      const p3Writer = adaptOutputStream(p2Stream)
      await p3Writer.write([new Uint8Array([1])])

      expect(flushed).toBe(true)
    })

    it('returns cancelled when cancelled', async () => {
      const p2Stream: P2OutputStream = {
        write: () => {},
      }

      const p3Writer = adaptOutputStream(p2Stream)
      p3Writer.cancel()

      const result = await p3Writer.write([new Uint8Array([1])])
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('returns closed after close', async () => {
      const p2Stream: P2OutputStream = {
        write: () => {},
      }

      const p3Writer = adaptOutputStream(p2Stream)
      p3Writer.close()

      const result = await p3Writer.write([new Uint8Array([1])])
      expect(result).toEqual({ status: 'closed' })
    })

    it('handles write errors', async () => {
      const p2Stream: P2OutputStream = {
        write: () => {
          throw new Error('Write failed')
        },
      }

      const p3Writer = adaptOutputStream(p2Stream)
      const result = await p3Writer.write([new Uint8Array([1])])

      expect(result).toEqual({ status: 'closed' })
    })

    it('uses checkWrite for chunking', async () => {
      const written: number[] = []

      const p2Stream: P2OutputStream = {
        checkWrite: () => 2n, // Only 2 bytes at a time
        write: (contents: Uint8Array) => {
          written.push(contents.length)
        },
      }

      const p3Writer = adaptOutputStream(p2Stream)
      await p3Writer.write([new Uint8Array([1, 2, 3, 4, 5])])

      // Should chunk into 2-byte writes
      expect(written.length).toBeGreaterThan(1)
    })
  })

  describe('adaptPollable', () => {
    it('resolves immediately if already ready', async () => {
      const p2Pollable: P2Pollable = {
        ready: () => true,
        block: () => {},
      }

      const p3Future = adaptPollable(p2Pollable)
      const result = await p3Future.read()

      expect(result).toEqual({ status: 'ok', value: undefined })
    })

    it('waits until pollable becomes ready', async () => {
      let readyCount = 0

      const p2Pollable: P2Pollable = {
        ready: () => {
          readyCount++
          return readyCount >= 3 // Become ready after 3 checks
        },
        block: () => {},
      }

      const p3Future = adaptPollable(p2Pollable)
      const result = await p3Future.read()

      expect(result).toEqual({ status: 'ok', value: undefined })
      expect(readyCount).toBeGreaterThanOrEqual(3)
    })
  })

  describe('adaptFileRead', () => {
    it('reads file content as stream', async () => {
      const content = new Uint8Array([10, 20, 30, 40, 50])
      let position = 0n

      const p2Descriptor: P2Descriptor = {
        read: (length: bigint, offset: bigint): [Uint8Array, boolean] => {
          const start = Number(offset)
          const len = Math.min(Number(length), content.length - start)
          const data = content.slice(start, start + len)
          const eof = start + len >= content.length
          position = offset + BigInt(len)
          return [data, eof]
        },
      }

      const p3Stream = adaptFileRead(p2Descriptor)
      const values = await collectStream(p3Stream)

      expect(values[0]).toEqual(content)
    })

    it('handles empty file', async () => {
      const p2Descriptor: P2Descriptor = {
        read: (): [Uint8Array, boolean] => [new Uint8Array(0), true],
      }

      const p3Stream = adaptFileRead(p2Descriptor)
      const result = await p3Stream.read()

      expect(result).toEqual({ status: 'end' })
    })

    it('respects starting offset', async () => {
      const content = new Uint8Array([1, 2, 3, 4, 5])

      const p2Descriptor: P2Descriptor = {
        read: (length: bigint, offset: bigint): [Uint8Array, boolean] => {
          const start = Number(offset)
          return [content.slice(start), true]
        },
      }

      const p3Stream = adaptFileRead(p2Descriptor, 2n)
      const result = await p3Stream.read()

      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(result.values[0]).toEqual(new Uint8Array([3, 4, 5]))
      }
    })

    it('returns cancelled when cancelled', async () => {
      const p2Descriptor: P2Descriptor = {
        read: (): [Uint8Array, boolean] => [new Uint8Array([1]), false],
      }

      const p3Stream = adaptFileRead(p2Descriptor)
      p3Stream.cancel()

      const result = await p3Stream.read()
      expect(result).toEqual({ status: 'cancelled' })
    })
  })

  describe('adaptFileWrite', () => {
    it('writes data to file', async () => {
      const written: { data: Uint8Array; offset: bigint }[] = []

      const p2Descriptor: P2Descriptor = {
        write: (buffer: Uint8Array, offset: bigint): bigint => {
          written.push({ data: new Uint8Array(buffer), offset })
          return BigInt(buffer.length)
        },
      }

      const p3Writer = adaptFileWrite(p2Descriptor)
      const result = await p3Writer.write([
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4]),
      ])

      expect(result).toEqual({ status: 'ok', count: 2 })
      expect(written.length).toBe(2)
      expect(written[0].data).toEqual(new Uint8Array([1, 2]))
      expect(written[0].offset).toBe(0n)
      expect(written[1].offset).toBe(2n)
    })

    it('respects starting offset', async () => {
      const written: { offset: bigint }[] = []

      const p2Descriptor: P2Descriptor = {
        write: (buffer: Uint8Array, offset: bigint): bigint => {
          written.push({ offset })
          return BigInt(buffer.length)
        },
      }

      const p3Writer = adaptFileWrite(p2Descriptor, 100n)
      await p3Writer.write([new Uint8Array([1, 2, 3])])

      expect(written[0].offset).toBe(100n)
    })

    it('returns closed when no write method', async () => {
      const p2Descriptor: P2Descriptor = {}

      const p3Writer = adaptFileWrite(p2Descriptor)
      const result = await p3Writer.write([new Uint8Array([1])])

      expect(result).toEqual({ status: 'closed' })
    })
  })

  describe('adaptDirectoryRead', () => {
    it('reads directory entries as stream', async () => {
      const entries = [
        { name: 'file1.txt', type: 'file' },
        { name: 'file2.txt', type: 'file' },
        { name: 'subdir', type: 'directory' },
      ]

      const p2Descriptor: P2Descriptor = {
        readDirectory: function* () {
          for (const entry of entries) {
            yield entry
          }
        },
      }

      const p3Stream = adaptDirectoryRead(p2Descriptor)
      const values = await collectStream(p3Stream)

      expect(values).toEqual(entries)
    })

    it('handles empty directory', async () => {
      const p2Descriptor: P2Descriptor = {
        readDirectory: function* () {},
      }

      const p3Stream = adaptDirectoryRead(p2Descriptor)
      const result = await p3Stream.read()

      expect(result).toEqual({ status: 'end' })
    })

    it('batches large directories', async () => {
      const entries = Array.from({ length: 150 }, (_, i) => ({
        name: `file${i}.txt`,
        type: 'file',
      }))

      const p2Descriptor: P2Descriptor = {
        readDirectory: function* () {
          for (const entry of entries) {
            yield entry
          }
        },
      }

      const p3Stream = adaptDirectoryRead(p2Descriptor)

      const result1 = await p3Stream.read()
      expect(result1.status).toBe('values')
      if (result1.status === 'values') {
        expect(result1.values.length).toBe(100) // First batch
      }

      const result2 = await p3Stream.read()
      expect(result2.status).toBe('values')
      if (result2.status === 'values') {
        expect(result2.values.length).toBe(50) // Remaining
      }

      const result3 = await p3Stream.read()
      expect(result3).toEqual({ status: 'end' })
    })
  })

  describe('adaptP2ToP3', () => {
    it('wraps P2 plugin as P3 plugin', () => {
      const p2Plugin: P2Plugin = {
        witInterface: {
          package: 'wasi:random',
          name: 'random',
          version: '0.2.0',
        },
        getImports: () => ({
          'get-random-bytes': (len: bigint) => new Uint8Array(Number(len)),
        }),
      }

      const p3Plugin = adaptP2ToP3(p2Plugin)

      expect(p3Plugin.witInterface.version).toBe('0.3.0')
      expect(p3Plugin.witInterface.package).toBe('wasi:random')
    })

    it('wraps functions as async', async () => {
      const p2Plugin: P2Plugin = {
        witInterface: {
          package: 'test',
          name: 'sync',
          version: '0.2.0',
        },
        getImports: () => ({
          'add': (a: number, b: number) => a + b,
        }),
      }

      const p3Plugin = adaptP2ToP3(p2Plugin)
      const imports = p3Plugin.getImports()
      const addFn = imports['add'] as (a: number, b: number) => Promise<number>

      const result = await addFn(2, 3)
      expect(result).toBe(5)
    })

    it('handles nested objects', async () => {
      const p2Plugin: P2Plugin = {
        witInterface: {
          package: 'test',
          name: 'nested',
          version: '0.2.0',
        },
        getImports: () => ({
          resource: {
            read: (len: number) => new Uint8Array(len),
            write: (data: Uint8Array) => data.length,
          },
        }),
      }

      const p3Plugin = adaptP2ToP3(p2Plugin)
      const imports = p3Plugin.getImports()
      const resource = imports['resource'] as Record<string, Function>

      const readResult = await resource['read'](5)
      expect(readResult).toEqual(new Uint8Array(5))
    })
  })

  describe('createStreamFromCallback', () => {
    it('creates stream from callback', async () => {
      let callCount = 0
      const data = [[1, 2], [3, 4], [5]]

      const stream = createStreamFromCallback<number>(async () => {
        if (callCount >= data.length) {
          return { done: true }
        }
        return { data: data[callCount++], done: false }
      })

      const values = await collectStream(stream)
      expect(values).toEqual([1, 2, 3, 4, 5])
    })

    it('handles empty callback', async () => {
      const stream = createStreamFromCallback<string>(async () => ({ done: true }))
      const result = await stream.read()
      expect(result).toEqual({ status: 'end' })
    })

    it('returns cancelled when cancelled', async () => {
      const stream = createStreamFromCallback<number>(async () => ({
        data: [1],
        done: false,
      }))

      stream.cancel()

      const result = await stream.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('handles callback errors', async () => {
      const stream = createStreamFromCallback<number>(async () => {
        throw new Error('Callback failed')
      })

      const result = await stream.read()
      expect(result).toEqual({ status: 'end' })
    })
  })

  describe('createWriterFromCallback', () => {
    it('creates writer from callback', async () => {
      const written: string[][] = []

      const writer = createWriterFromCallback<string>(async (data) => {
        written.push(data)
        return data.length
      })

      const result = await writer.write(['hello', 'world'])

      expect(result).toEqual({ status: 'ok', count: 2 })
      expect(written).toEqual([['hello', 'world']])
    })

    it('calls close callback', async () => {
      let closed = false

      const writer = createWriterFromCallback<number>(
        async () => 0,
        async () => {
          closed = true
        }
      )

      writer.close()

      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(closed).toBe(true)
    })

    it('returns cancelled when cancelled', async () => {
      const writer = createWriterFromCallback<number>(async () => 0)

      writer.cancel()

      const result = await writer.write([1, 2, 3])
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('returns closed after close', async () => {
      const writer = createWriterFromCallback<number>(async () => 0)

      writer.close()

      const result = await writer.write([1])
      expect(result).toEqual({ status: 'closed' })
    })

    it('handles callback errors', async () => {
      const writer = createWriterFromCallback<number>(async () => {
        throw new Error('Write failed')
      })

      const result = await writer.write([1])
      expect(result).toEqual({ status: 'closed' })
    })
  })

  describe('integration scenarios', () => {
    it('adapts complete P2 stream pipeline', async () => {
      // Create P2-style streams
      const data = new Uint8Array([1, 2, 3, 4, 5])
      let readPos = 0
      const output: Uint8Array[] = []

      const p2Input: P2InputStream = {
        read: (len: bigint) => {
          const chunk = data.slice(readPos, readPos + Number(len))
          readPos += chunk.length
          return chunk
        },
      }

      const p2Output: P2OutputStream = {
        write: (contents: Uint8Array) => {
          output.push(new Uint8Array(contents))
        },
      }

      // Adapt to P3
      const p3Reader = adaptInputStream(p2Input)
      const p3Writer = adaptOutputStream(p2Output)

      // Read and write
      while (true) {
        const result = await p3Reader.read()
        if (result.status === 'values') {
          await p3Writer.write(result.values)
        } else {
          break
        }
      }

      expect(output.length).toBeGreaterThan(0)
      const totalOutput = new Uint8Array(output.reduce((acc, arr) => acc + arr.length, 0))
      let offset = 0
      for (const arr of output) {
        totalOutput.set(arr, offset)
        offset += arr.length
      }
      expect(totalOutput).toEqual(data)
    })

    it('adapts file reading with offset', async () => {
      const content = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

      const p2Descriptor: P2Descriptor = {
        read: (length: bigint, offset: bigint): [Uint8Array, boolean] => {
          const start = Number(offset)
          const end = Math.min(start + Number(length), content.length)
          const data = content.slice(start, end)
          return [data, end >= content.length]
        },
      }

      // Read from offset 5
      const p3Stream = adaptFileRead(p2Descriptor, 5n)
      const values = await collectStream(p3Stream)

      expect(values[0]).toEqual(new Uint8Array([5, 6, 7, 8, 9]))
    })

    it('adapts plugin with multiple functions', async () => {
      const p2Plugin: P2Plugin = {
        witInterface: {
          package: 'test:math',
          name: 'calculator',
          version: '0.2.0',
        },
        getImports: () => ({
          'add': (a: number, b: number) => a + b,
          'subtract': (a: number, b: number) => a - b,
          'multiply': (a: number, b: number) => a * b,
        }),
      }

      const p3Plugin = adaptP2ToP3(p2Plugin)
      const imports = p3Plugin.getImports() as Record<string, (a: number, b: number) => Promise<number>>

      expect(await imports['add'](10, 5)).toBe(15)
      expect(await imports['subtract'](10, 5)).toBe(5)
      expect(await imports['multiply'](10, 5)).toBe(50)
    })
  })
})
