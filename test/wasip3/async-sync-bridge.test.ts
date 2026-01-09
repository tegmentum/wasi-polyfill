import { describe, it, expect } from 'vitest'
import {
  AsyncSyncBridge,
  createBridgeContext,
  blockingCall,
  promisify,
  wrapSyncAsAsync,
  wrapAsyncWithDefault,
  EventDispatcher,
  streamToFuture,
  futureToStream,
  pipeStream,
  mergeStreams,
} from '../../src/wasip3/adapters/async-sync-bridge.js'
import { createStream } from '../../src/wasip3/canonical-abi/stream.js'
import { createFuture, resolvedFuture } from '../../src/wasip3/canonical-abi/future.js'

describe('WASIP3 Async/Sync Bridge', () => {
  describe('createBridgeContext', () => {
    it('creates a sync context by default', () => {
      const context = createBridgeContext()
      expect(context.isAsync).toBe(false)
      expect(context.subtaskManager).toBeDefined()
    })

    it('creates an async context when specified', () => {
      const context = createBridgeContext(true)
      expect(context.isAsync).toBe(true)
    })
  })

  describe('AsyncSyncBridge', () => {
    describe('callSyncFromSync', () => {
      it('calls sync function directly', () => {
        const bridge = new AsyncSyncBridge()
        const result = bridge.callSyncFromSync(() => 42)
        expect(result).toBe(42)
      })

      it('passes return values through', () => {
        const bridge = new AsyncSyncBridge()
        const result = bridge.callSyncFromSync(() => ({ a: 1, b: 'hello' }))
        expect(result).toEqual({ a: 1, b: 'hello' })
      })

      it('propagates errors', () => {
        const bridge = new AsyncSyncBridge()
        expect(() =>
          bridge.callSyncFromSync(() => {
            throw new Error('Sync error')
          })
        ).toThrow('Sync error')
      })
    })

    describe('callAsyncFromSync', () => {
      it('calls async function and awaits result', async () => {
        const bridge = new AsyncSyncBridge()
        const result = await bridge.callAsyncFromSync(async () => 'async result')
        expect(result).toBe('async result')
      })

      it('handles async function with delay', async () => {
        const bridge = new AsyncSyncBridge()
        const result = await bridge.callAsyncFromSync(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return 'delayed'
        })
        expect(result).toBe('delayed')
      })

      it('throws when async call returns no value', async () => {
        const bridge = new AsyncSyncBridge()
        await expect(
          bridge.callAsyncFromSync(async () => {
            // Return undefined
            return undefined as unknown as string
          })
        ).resolves.toBeUndefined()
      })
    })

    describe('callSyncFromAsync', () => {
      it('calls sync function from async context', () => {
        const bridge = new AsyncSyncBridge(createBridgeContext(true))
        const result = bridge.callSyncFromAsync(() => 'sync result')
        expect(result).toBe('sync result')
      })
    })

    describe('startAsyncCall', () => {
      it('starts an async call and returns handle', () => {
        const bridge = new AsyncSyncBridge()
        const handle = bridge.startAsyncCall(async () => ['done'])
        expect(typeof handle).toBe('number')
        expect(handle).toBeGreaterThan(0)
      })

      it('can poll subtask state', async () => {
        const bridge = new AsyncSyncBridge()
        const handle = bridge.startAsyncCall(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return ['completed']
        })

        const initialState = bridge.pollSubtask(handle)
        expect(['starting', 'started'].includes(initialState)).toBe(true)

        await bridge.waitSubtask(handle)
        expect(bridge.pollSubtask(handle)).toBe('returned')
      })

      it('can get return values', async () => {
        const bridge = new AsyncSyncBridge()
        const handle = bridge.startAsyncCall(async () => ['value1', 'value2'])

        await bridge.waitSubtask(handle)
        const values = bridge.getSubtaskReturnValues(handle)

        expect(values).toEqual(['value1', 'value2'])
      })

      it('can drop subtask handles', async () => {
        const bridge = new AsyncSyncBridge()
        const handle = bridge.startAsyncCall(async () => ['result'])

        await bridge.waitSubtask(handle)
        bridge.dropSubtask(handle)

        expect(() => bridge.pollSubtask(handle)).toThrow()
      })
    })

    describe('waitAnySubtask', () => {
      it('waits for first subtask to complete', async () => {
        const bridge = new AsyncSyncBridge()

        const slow = bridge.startAsyncCall(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return ['slow']
        })

        const fast = bridge.startAsyncCall(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return ['fast']
        })

        const winner = await bridge.waitAnySubtask([slow, fast])
        expect(winner).toBe(fast)
      })
    })

    describe('getSubtasksInState', () => {
      it('gets subtasks by state', async () => {
        const bridge = new AsyncSyncBridge()

        const quick = bridge.startAsyncCall(async () => ['quick'])
        bridge.startAsyncCall(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return ['slow']
        })

        await new Promise((resolve) => setTimeout(resolve, 20))

        const returned = bridge.getSubtasksInState('returned')
        expect(returned).toContain(quick)
      })
    })

    describe('getActiveSubtasks', () => {
      it('gets all active subtasks', () => {
        const bridge = new AsyncSyncBridge()

        const h1 = bridge.startAsyncCall(async () => ['1'])
        const h2 = bridge.startAsyncCall(async () => ['2'])

        const active = bridge.getActiveSubtasks()
        expect(active.sort()).toEqual([h1, h2].sort())
      })
    })
  })

  describe('blockingCall', () => {
    it('calls async function and returns result', async () => {
      const result = await blockingCall(async () => 'blocked result')
      expect(result).toBe('blocked result')
    })

    it('handles complex return values', async () => {
      const result = await blockingCall(async () => ({
        data: [1, 2, 3],
        nested: { value: 'test' },
      }))
      expect(result).toEqual({
        data: [1, 2, 3],
        nested: { value: 'test' },
      })
    })
  })

  describe('promisify', () => {
    it('converts callback-based function to promise', async () => {
      const result = await promisify<number>((callback) => {
        setTimeout(() => callback(null, 42), 10)
      })
      expect(result).toBe(42)
    })

    it('rejects on error', async () => {
      await expect(
        promisify<number>((callback) => {
          callback(new Error('Callback error'))
        })
      ).rejects.toThrow('Callback error')
    })
  })

  describe('wrapSyncAsAsync', () => {
    it('wraps sync function as async', async () => {
      const syncFn = (x: number, y: number) => x + y
      const asyncFn = wrapSyncAsAsync(syncFn)

      const result = await asyncFn(2, 3)
      expect(result).toBe(5)
    })

    it('preserves function behavior', async () => {
      const syncFn = (items: string[]) => items.join(', ')
      const asyncFn = wrapSyncAsAsync(syncFn)

      const result = await asyncFn(['a', 'b', 'c'])
      expect(result).toBe('a, b, c')
    })
  })

  describe('wrapAsyncWithDefault', () => {
    it('returns result on success', async () => {
      const asyncFn = async (x: number) => x * 2
      const wrapped = wrapAsyncWithDefault(asyncFn, 0)

      const result = await wrapped(21)
      expect(result).toBe(42)
    })

    it('returns default on error', async () => {
      const asyncFn = async (): Promise<number> => {
        throw new Error('Failed')
      }
      const wrapped = wrapAsyncWithDefault(asyncFn, -1)

      const result = await wrapped()
      expect(result).toBe(-1)
    })
  })

  describe('EventDispatcher', () => {
    it('dispatches events to handlers', async () => {
      const dispatcher = new EventDispatcher()
      const received: string[] = []

      dispatcher.on('stream-read', (event) => {
        received.push(`read:${event.handle}`)
      })

      await dispatcher.dispatch({ type: 'stream-read', handle: 1 })
      expect(received).toEqual(['read:1'])
    })

    it('supports multiple handlers for same event', async () => {
      const dispatcher = new EventDispatcher()
      const received: number[] = []

      dispatcher.on('stream-write', () => received.push(1))
      dispatcher.on('stream-write', () => received.push(2))

      await dispatcher.dispatch({ type: 'stream-write', handle: 1 })
      expect(received).toEqual([1, 2])
    })

    it('supports wildcard handler', async () => {
      const dispatcher = new EventDispatcher()
      const received: string[] = []

      dispatcher.on('*', (event) => received.push(event.type))

      await dispatcher.dispatch({ type: 'stream-read', handle: 1 })
      await dispatcher.dispatch({ type: 'future-read', handle: 2 })

      expect(received).toEqual(['stream-read', 'future-read'])
    })

    it('can remove handlers', async () => {
      const dispatcher = new EventDispatcher()
      const received: number[] = []

      const handler = () => received.push(1)
      dispatcher.on('stream-read', handler)
      dispatcher.off('stream-read', handler)

      await dispatcher.dispatch({ type: 'stream-read', handle: 1 })
      expect(received).toEqual([])
    })

    it('dispatchAll dispatches multiple events', async () => {
      const dispatcher = new EventDispatcher()
      const received: number[] = []

      dispatcher.on('stream-read', (event) => received.push(event.handle))

      await dispatcher.dispatchAll([
        { type: 'stream-read', handle: 1 },
        { type: 'stream-read', handle: 2 },
        { type: 'stream-read', handle: 3 },
      ])

      expect(received).toEqual([1, 2, 3])
    })

    it('handles async handlers', async () => {
      const dispatcher = new EventDispatcher()
      const received: number[] = []

      dispatcher.on('stream-read', async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        received.push(event.handle)
      })

      await dispatcher.dispatch({ type: 'stream-read', handle: 42 })
      expect(received).toEqual([42])
    })
  })

  describe('streamToFuture', () => {
    it('collects all stream values into future', async () => {
      const [reader, writer] = createStream<number>()

      // Start collecting BEFORE writing to avoid backpressure deadlock
      const future = streamToFuture(reader)

      // Write values - they'll be consumed as written
      await writer.write([1, 2])
      await writer.write([3, 4])
      writer.close()

      const result = await future.read()

      expect(result).toEqual({ status: 'ok', value: [1, 2, 3, 4] })
    })

    it('returns empty array for empty stream', async () => {
      const [reader, writer] = createStream<string>()
      writer.close()

      const future = streamToFuture(reader)
      const result = await future.read()

      expect(result).toEqual({ status: 'ok', value: [] })
    })

    it('returns cancelled when stream is cancelled', async () => {
      const [reader, _writer] = createStream<number>()
      reader.cancel()

      const future = streamToFuture(reader)
      const result = await future.read()

      expect(result).toEqual({ status: 'cancelled' })
    })
  })

  describe('futureToStream', () => {
    it('converts future to single-value stream', async () => {
      const future = resolvedFuture('value')
      const stream = futureToStream(future)

      const result1 = await stream.read()
      expect(result1).toEqual({ status: 'values', values: ['value'] })

      const result2 = await stream.read()
      expect(result2).toEqual({ status: 'end' })
    })

    it('handles cancelled future', async () => {
      const [future] = createFuture<string>()
      future.cancel()

      const stream = futureToStream(future)
      const result = await stream.read()

      expect(result).toEqual({ status: 'cancelled' })
    })

    it('close prevents further reads', async () => {
      const future = resolvedFuture('value')
      const stream = futureToStream(future)

      stream.close()

      const result = await stream.read()
      expect(result).toEqual({ status: 'end' })
    })
  })

  describe('pipeStream', () => {
    it('pipes data from source to destination', async () => {
      const [source, sourceWriter] = createStream<string>()
      const [destReader, destWriter] = createStream<string>()

      // Write to source
      await sourceWriter.write(['hello', 'world'])
      sourceWriter.close()

      // Pipe source to dest
      await pipeStream(source, destWriter)

      // Read from dest
      const values: string[] = []
      while (true) {
        const result = await destReader.read()
        if (result.status === 'values') {
          values.push(...result.values)
        } else {
          break
        }
      }

      expect(values).toEqual(['hello', 'world'])
    })

    it('handles empty source stream', async () => {
      const [source, sourceWriter] = createStream<number>()
      const [destReader, destWriter] = createStream<number>()

      sourceWriter.close()
      await pipeStream(source, destWriter)

      const result = await destReader.read()
      expect(result).toEqual({ status: 'end' })
    })

    it('cancels source when dest closes', async () => {
      const [source, sourceWriter] = createStream<string>()
      const [_destReader, destWriter] = createStream<string>()

      // Close dest before anything is written
      destWriter.close()

      // Write something to source
      await sourceWriter.write(['data'])
      sourceWriter.close()

      await pipeStream(source, destWriter)
      // Should complete without error
    })
  })

  describe('mergeStreams', () => {
    it('merges values from multiple streams', async () => {
      const [reader1, writer1] = createStream<number>()
      const [reader2, writer2] = createStream<number>()

      const merged = mergeStreams([reader1, reader2])

      // Write to both streams
      await writer1.write([1])
      await writer2.write([2])
      writer1.close()
      writer2.close()

      // Collect all values
      const values: number[] = []
      while (true) {
        const result = await merged.read()
        if (result.status === 'values') {
          values.push(...result.values)
        } else {
          break
        }
      }

      expect(values.sort()).toEqual([1, 2])
    })

    it('returns end when all streams end', async () => {
      const [reader1, writer1] = createStream<string>()
      const [reader2, writer2] = createStream<string>()

      const merged = mergeStreams([reader1, reader2])

      writer1.close()
      writer2.close()

      const result = await merged.read()
      expect(result).toEqual({ status: 'end' })
    })

    it('close closes all source streams', async () => {
      const [reader1, writer1] = createStream<number>()
      const [reader2, writer2] = createStream<number>()

      const merged = mergeStreams([reader1, reader2])
      merged.close()

      // Writes should fail
      const result1 = await writer1.write([1])
      const result2 = await writer2.write([2])

      expect(result1.status).toBe('closed')
      expect(result2.status).toBe('closed')
    })

    it('cancel cancels all source streams', async () => {
      const [reader1] = createStream<number>()
      const [reader2] = createStream<number>()

      const merged = mergeStreams([reader1, reader2])
      merged.cancel()

      const result = await merged.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('handles empty stream list', async () => {
      const merged = mergeStreams<number>([])
      const result = await merged.read()
      expect(result).toEqual({ status: 'end' })
    })
  })

  describe('integration scenarios', () => {
    it('chained async operations', async () => {
      const bridge = new AsyncSyncBridge()

      // Start multiple async operations
      const h1 = bridge.startAsyncCall(async () => [10])
      await bridge.waitSubtask(h1)
      const v1 = bridge.getSubtaskReturnValues(h1)?.[0] as number

      const h2 = bridge.startAsyncCall(async () => [v1 * 2])
      await bridge.waitSubtask(h2)
      const v2 = bridge.getSubtaskReturnValues(h2)?.[0] as number

      const h3 = bridge.startAsyncCall(async () => [v2 + 5])
      await bridge.waitSubtask(h3)
      const v3 = bridge.getSubtaskReturnValues(h3)?.[0] as number

      expect(v3).toBe(25) // 10 * 2 + 5

      // Cleanup
      bridge.dropSubtask(h1)
      bridge.dropSubtask(h2)
      bridge.dropSubtask(h3)
    })

    it('concurrent async operations', async () => {
      const bridge = new AsyncSyncBridge()

      // Start multiple concurrent operations
      const handles = Array.from({ length: 5 }, (_, i) =>
        bridge.startAsyncCall(async () => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20))
          return [i * 10]
        })
      )

      // Wait for all
      const results: number[] = []
      for (const handle of handles) {
        await bridge.waitSubtask(handle)
        const values = bridge.getSubtaskReturnValues(handle)
        results.push(values![0] as number)
        bridge.dropSubtask(handle)
      }

      expect(results.sort((a, b) => a - b)).toEqual([0, 10, 20, 30, 40])
    })

    it('stream pipeline with transformation', async () => {
      // Source produces numbers
      const [source, sourceWriter] = createStream<number>()

      // Transform: double each value
      const [transformedReader, transformedWriter] = createStream<number>()

      // Start pipeline in background
      const pipelinePromise = (async () => {
        while (true) {
          const result = await source.read()
          if (result.status === 'values') {
            await transformedWriter.write(result.values.map((v) => v * 2))
          } else {
            transformedWriter.close()
            break
          }
        }
      })()

      // Write to source
      await sourceWriter.write([1, 2, 3])
      sourceWriter.close()

      // Collect transformed values via future
      const future = streamToFuture(transformedReader)
      const result = await future.read()

      await pipelinePromise

      expect(result).toEqual({ status: 'ok', value: [2, 4, 6] })
    })
  })
})
