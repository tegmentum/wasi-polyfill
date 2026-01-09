import { describe, it, expect } from 'vitest'
import { Task, createTaskBuiltins } from '../../src/wasip3/canonical-abi/task.js'
import { createStream } from '../../src/wasip3/canonical-abi/stream.js'
import { createFuture } from '../../src/wasip3/canonical-abi/future.js'

describe('WASIP3 Task', () => {
  describe('lifecycle', () => {
    it('creates a new task in initial state', () => {
      const task = new Task()
      expect(task.isStarted()).toBe(false)
      expect(task.isReturned()).toBe(false)
      expect(task.getReturnValues()).toBeUndefined()
    })

    it('starts a task', () => {
      const task = new Task()
      task.start()
      expect(task.isStarted()).toBe(true)
      expect(task.isReturned()).toBe(false)
    })

    it('throws when starting an already started task', () => {
      const task = new Task()
      task.start()
      expect(() => task.start()).toThrow('Task already started')
    })

    it('returns from a started task', () => {
      const task = new Task()
      task.start()
      task.return([1, 'result'])
      expect(task.isReturned()).toBe(true)
      expect(task.getReturnValues()).toEqual([1, 'result'])
    })

    it('throws when returning from an unstarted task', () => {
      const task = new Task()
      expect(() => task.return(['value'])).toThrow('Task not started')
    })

    it('throws when returning from an already returned task', () => {
      const task = new Task()
      task.start()
      task.return(['first'])
      expect(() => task.return(['second'])).toThrow('Task already returned')
    })

    it('handles empty return values', () => {
      const task = new Task()
      task.start()
      task.return([])
      expect(task.getReturnValues()).toEqual([])
    })
  })

  describe('streamRead', () => {
    it('starts a stream read operation', () => {
      const task = new Task()
      const [reader, _writer] = createStream<number>()

      const handle = task.streamRead(reader)
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('returns unique handles for each operation', () => {
      const task = new Task()
      const [reader1] = createStream<number>()
      const [reader2] = createStream<string>()

      const handle1 = task.streamRead(reader1)
      const handle2 = task.streamRead(reader2)

      expect(handle1).not.toBe(handle2)
    })

    it('read result becomes available after data is written', async () => {
      const task = new Task()
      const [reader, writer] = createStream<string>()

      const handle = task.streamRead(reader)

      // Initially not ready
      expect(task.getResult(handle)).toBeUndefined()

      // Start waiting BEFORE writing so we catch the event
      const waitPromise = task.wait()

      // Write data
      await writer.write(['hello'])

      // Wait for result
      const events = await waitPromise
      expect(events.length).toBe(1)
      expect(events[0].type).toBe('stream-read')
      expect(events[0].handle).toBe(handle)

      // Result should be available
      const result = task.getResult(handle)
      expect(result).toEqual({ status: 'values', values: ['hello'] })
    })

    it('poll detects ready operations', async () => {
      const task = new Task()
      const [reader, writer] = createStream<number>()

      const handle = task.streamRead(reader)

      // Poll before data - nothing ready
      expect(task.poll()).toEqual([])

      // Write data and wait a tick
      await writer.write([42])
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Poll should now show ready
      const events = task.poll()
      expect(events.some((e) => e.handle === handle && e.type === 'stream-read')).toBe(true)
    })
  })

  describe('streamWrite', () => {
    it('starts a stream write operation', () => {
      const task = new Task()
      const [_reader, writer] = createStream<number>()

      const handle = task.streamWrite(writer, [1, 2, 3])
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('write result becomes available', async () => {
      const task = new Task()
      const [_reader, writer] = createStream<string>()

      const handle = task.streamWrite(writer, ['data'])

      // Wait for completion
      const events = await task.wait()
      expect(events.length).toBe(1)
      expect(events[0].type).toBe('stream-write')
      expect(events[0].handle).toBe(handle)

      const result = task.getResult(handle)
      expect(result).toEqual({ status: 'ok', count: 1 })
    })

    it('write blocks when buffer is full', async () => {
      const task = new Task()
      const [reader, writer] = createStream<number>()

      // First write fills buffer
      await writer.write([1])

      // Second write should block
      const handle = task.streamWrite(writer, [2])

      // Poll should show nothing ready yet
      expect(task.poll()).toEqual([])

      // Read to unblock
      await reader.read()

      // Wait for write to complete
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Now should be ready
      const events = task.poll()
      expect(events.some((e) => e.handle === handle)).toBe(true)
    })
  })

  describe('futureRead', () => {
    it('starts a future read operation', () => {
      const task = new Task()
      const [future, _resolver] = createFuture<string>()

      const handle = task.futureRead(future)
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('read result becomes available when future resolves', async () => {
      const task = new Task()
      const [future, resolver] = createFuture<number>()

      const handle = task.futureRead(future)

      // Initially not ready
      expect(task.getResult(handle)).toBeUndefined()

      // Resolve the future
      resolver.resolve(42)

      // Wait for result
      const events = await task.wait()
      expect(events.length).toBe(1)
      expect(events[0].type).toBe('future-read')
      expect(events[0].handle).toBe(handle)

      const result = task.getResult(handle)
      expect(result).toEqual({ status: 'ok', value: 42 })
    })

    it('poll detects ready futures', async () => {
      const task = new Task()
      const [future, resolver] = createFuture<string>()

      const handle = task.futureRead(future)

      // Poll before resolution
      expect(task.poll()).toEqual([])

      // Resolve and wait
      resolver.resolve('done')
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Poll should show ready
      const events = task.poll()
      expect(events.some((e) => e.handle === handle && e.type === 'future-read')).toBe(true)
    })
  })

  describe('subtask operations', () => {
    it('starts a subtask', () => {
      const task = new Task()

      const handle = task.subtaskStart(async () => ['result'])
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('polls subtask state', async () => {
      const task = new Task()

      const handle = task.subtaskStart(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return ['done']
      })

      // Initial state should be 'starting' or 'started'
      const initialState = task.subtaskPoll(handle)
      expect(['starting', 'started'].includes(initialState)).toBe(true)

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 50))

      const finalState = task.subtaskPoll(handle)
      expect(finalState).toBe('returned')
    })

    it('gets subtask return values', async () => {
      const task = new Task()

      const handle = task.subtaskStart(async () => ['value1', 'value2'])

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 10))

      const values = task.subtaskReturnValues(handle)
      expect(values).toEqual(['value1', 'value2'])
    })

    it('drops subtask handle', async () => {
      const task = new Task()

      const handle = task.subtaskStart(async () => ['result'])
      await new Promise((resolve) => setTimeout(resolve, 10))

      task.subtaskDrop(handle)

      // After drop, polling should throw
      expect(() => task.subtaskPoll(handle)).toThrow()
    })

    it('subtask completion triggers event in wait', async () => {
      const task = new Task()

      task.subtaskStart(async () => ['done'])

      const events = await task.wait()
      expect(events.length).toBe(1)
      expect(events[0].type).toBe('subtask-done')
    })
  })

  describe('wait', () => {
    it('waits for the first operation to complete', async () => {
      const task = new Task()
      const [reader, writer] = createStream<number>()
      const [future, resolver] = createFuture<string>()

      const streamHandle = task.streamRead(reader)
      task.futureRead(future)

      // Resolve the stream first
      setTimeout(() => writer.write([1]), 10)

      const events = await task.wait()
      expect(events.length).toBe(1)
      expect(events[0].handle).toBe(streamHandle)
      expect(events[0].type).toBe('stream-read')

      // Clean up
      resolver.resolve('cleanup')
    })

    it('returns empty array when no pending operations', async () => {
      const task = new Task()
      const events = await task.wait()
      expect(events).toEqual([])
    })

    it('waits for subtask completion', async () => {
      const task = new Task()

      task.subtaskStart(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return ['result']
      })

      const events = await task.wait()
      expect(events.length).toBe(1)
      expect(events[0].type).toBe('subtask-done')
    })
  })

  describe('poll', () => {
    it('returns empty array when nothing is ready', () => {
      const task = new Task()
      const [reader, _writer] = createStream<number>()

      task.streamRead(reader)

      const events = task.poll()
      expect(events).toEqual([])
    })

    it('returns multiple ready operations', async () => {
      const task = new Task()
      const [reader1, writer1] = createStream<number>()
      const [reader2, writer2] = createStream<string>()

      const handle1 = task.streamRead(reader1)
      const handle2 = task.streamRead(reader2)

      // Write to both
      await writer1.write([1])
      await writer2.write(['two'])

      // Wait a tick for operations to complete
      await new Promise((resolve) => setTimeout(resolve, 10))

      const events = task.poll()
      expect(events.length).toBe(2)
      expect(events.map((e) => e.handle).sort()).toEqual([handle1, handle2].sort())
    })
  })

  describe('yield', () => {
    it('yields execution', async () => {
      const task = new Task()
      let yieldComplete = false

      const yieldPromise = task.yield().then(() => {
        yieldComplete = true
      })

      expect(yieldComplete).toBe(false)

      await yieldPromise
      expect(yieldComplete).toBe(true)
    })
  })

  describe('dropOperation', () => {
    it('removes a pending operation', async () => {
      const task = new Task()
      const [reader, writer] = createStream<number>()

      const handle = task.streamRead(reader)
      task.dropOperation(handle)

      // Write should still work
      await writer.write([1])

      // But the result shouldn't be tracked
      expect(task.getResult(handle)).toBeUndefined()
    })
  })

  describe('cancelAll', () => {
    it('clears all pending operations', () => {
      const task = new Task()
      const [reader1] = createStream<number>()
      const [reader2] = createStream<string>()

      const handle1 = task.streamRead(reader1)
      const handle2 = task.streamRead(reader2)

      task.cancelAll()

      expect(task.getResult(handle1)).toBeUndefined()
      expect(task.getResult(handle2)).toBeUndefined()
      expect(task.poll()).toEqual([])
    })
  })

  describe('createTaskBuiltins', () => {
    it('creates task built-in functions', () => {
      const task = new Task()
      const builtins = createTaskBuiltins(task)

      expect(typeof builtins['task.start']).toBe('function')
      expect(typeof builtins['task.return']).toBe('function')
      expect(typeof builtins['task.wait']).toBe('function')
      expect(typeof builtins['task.poll']).toBe('function')
      expect(typeof builtins['task.yield']).toBe('function')
    })

    it('task.start calls task.start()', () => {
      const task = new Task()
      const builtins = createTaskBuiltins(task)

      builtins['task.start']()
      expect(task.isStarted()).toBe(true)
    })

    it('task.return calls task.return()', () => {
      const task = new Task()
      const builtins = createTaskBuiltins(task)

      builtins['task.start']()
      builtins['task.return'](['value'])

      expect(task.isReturned()).toBe(true)
      expect(task.getReturnValues()).toEqual(['value'])
    })

    it('task.wait calls task.wait()', async () => {
      const task = new Task()
      const builtins = createTaskBuiltins(task)

      const events = await builtins['task.wait']()
      expect(events).toEqual([])
    })

    it('task.poll calls task.poll()', () => {
      const task = new Task()
      const builtins = createTaskBuiltins(task)

      const events = builtins['task.poll']()
      expect(events).toEqual([])
    })

    it('task.yield calls task.yield()', async () => {
      const task = new Task()
      const builtins = createTaskBuiltins(task)

      await builtins['task.yield']()
      // Should complete without error
    })
  })

  describe('integration scenarios', () => {
    it('simulates async function execution', async () => {
      const task = new Task()
      const [reader, writer] = createStream<number>()

      // Simulate async function body
      task.start()

      // Read from stream
      const readHandle = task.streamRead(reader)

      // Writer provides data
      await writer.write([42])

      // Wait for read to complete
      await task.wait()
      const result = task.getResult(readHandle)

      // Return the result
      if (result && (result as { values?: number[] }).values) {
        task.return((result as { values: number[] }).values)
      }

      expect(task.getReturnValues()).toEqual([42])
    })

    it('handles multiple concurrent operations', async () => {
      const task = new Task()
      const [reader1, writer1] = createStream<number>()
      const [reader2, writer2] = createStream<string>()
      const [future, resolver] = createFuture<boolean>()

      task.start()

      // Start multiple operations
      const handles = [
        task.streamRead(reader1),
        task.streamRead(reader2),
        task.futureRead(future),
      ]

      // Complete them in different order
      resolver.resolve(true)
      await writer2.write(['second'])
      await writer1.write([1])

      // Collect all results
      const results: unknown[] = []
      while (results.length < handles.length) {
        const events = await task.wait()
        for (const event of events) {
          const result = task.getResult(event.handle)
          if (result) {
            results.push(result)
          }
        }
      }

      expect(results.length).toBe(3)
      task.return(results)
    })

    it('handles subtask chain', async () => {
      const task = new Task()
      task.start()

      // First subtask
      const handle1 = task.subtaskStart(async () => [10])
      await task.wait()
      const values1 = task.subtaskReturnValues(handle1)

      // Second subtask uses first result
      const handle2 = task.subtaskStart(async () => [(values1?.[0] as number ?? 0) * 2])
      await task.wait()
      const values2 = task.subtaskReturnValues(handle2)

      // Third subtask uses second result
      const handle3 = task.subtaskStart(async () => [(values2?.[0] as number ?? 0) + 5])
      await task.wait()
      const values3 = task.subtaskReturnValues(handle3)

      task.return([values3?.[0]])
      expect(task.getReturnValues()).toEqual([25])
    })
  })
})
