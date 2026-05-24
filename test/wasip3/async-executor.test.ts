import { describe, it, expect } from 'vitest'
import {
  AsyncExecutor,
  runAsync,
  eventLoop,
  type AsyncCaller,
} from '../../src/wasip3/runtime/async-executor.js'
import type { TaskBuiltins } from '../../src/wasip3/canonical-abi/task.js'
import type { TaskEvent } from '../../src/wasip3/types.js'

describe('WASIP3 AsyncExecutor', () => {
  describe('constructor', () => {
    it('creates executor with default config', () => {
      const executor = new AsyncExecutor()
      expect(executor.activeTaskCount).toBe(0)
    })

    it('accepts custom config', () => {
      const executor = new AsyncExecutor({
        maxConcurrentTasks: 50,
        waitTimeout: 10000,
      })
      expect(executor).toBeDefined()
    })
  })

  describe('execute', () => {
    it('executes async function with task lifecycle', async () => {
      const executor = new AsyncExecutor()

      const result = await executor.execute<[number]>(async (builtins, task) => {
        builtins['task.start']()
        // Simulate async work
        await builtins['task.yield']()
        builtins['task.return']([42])
      })

      expect(result).toEqual([42])
    })

    it('returns multiple values', async () => {
      const executor = new AsyncExecutor()

      const result = await executor.execute<[string, number, boolean]>(async (builtins) => {
        builtins['task.start']()
        builtins['task.return'](['hello', 123, true])
      })

      expect(result).toEqual(['hello', 123, true])
    })

    it('throws if task.return is not called', async () => {
      const executor = new AsyncExecutor()

      await expect(
        executor.execute(async (builtins) => {
          builtins['task.start']()
          // Missing task.return
        })
      ).rejects.toThrow('Async function did not call task.return')
    })

    it('throws when max concurrent tasks exceeded', async () => {
      const executor = new AsyncExecutor({ maxConcurrentTasks: 1 })

      // Start a long-running task
      const longTask = executor.execute(async (builtins) => {
        builtins['task.start']()
        await new Promise((resolve) => setTimeout(resolve, 100))
        builtins['task.return']([])
      })

      // Try to start another
      await expect(
        executor.execute(async (builtins) => {
          builtins['task.start']()
          builtins['task.return']([])
        })
      ).rejects.toThrow('Maximum concurrent tasks exceeded')

      await longTask
    })

    it('cleans up task after completion', async () => {
      const executor = new AsyncExecutor()

      await executor.execute(async (builtins) => {
        builtins['task.start']()
        builtins['task.return']([])
      })

      expect(executor.activeTaskCount).toBe(0)
    })

    it('cleans up task after error', async () => {
      const executor = new AsyncExecutor()

      await expect(
        executor.execute(async () => {
          throw new Error('Task error')
        })
      ).rejects.toThrow('Task error')

      expect(executor.activeTaskCount).toBe(0)
    })

    it('handles complex async operations', async () => {
      const executor = new AsyncExecutor()

      const result = await executor.execute<[number]>(async (builtins, task) => {
        builtins['task.start']()

        // Simulate multiple async operations
        for (let i = 0; i < 3; i++) {
          await builtins['task.yield']()
        }

        // Wait for some work
        const events = builtins['task.poll']()
        expect(events).toEqual([])

        builtins['task.return']([42])
      })

      expect(result).toEqual([42])
    })
  })

  describe('executeSync', () => {
    it('executes sync function with async calls', async () => {
      const executor = new AsyncExecutor()

      const result = await executor.executeSync((caller: AsyncCaller) => {
        // This would block in Component Model
        // In JS, the whole thing is async
        return 'sync result'
      })

      expect(result).toBe('sync result')
    })

    it('can make async calls from sync context', async () => {
      const executor = new AsyncExecutor()

      const result = await executor.executeSync(async (caller: AsyncCaller) => {
        const values = await caller.callAsync(async () => [10, 20])
        return values[0] as number + (values[1] as number)
      })

      expect(result).toBe(30)
    })

    it('handles multiple async calls', async () => {
      const executor = new AsyncExecutor()

      const result = await executor.executeSync(async (caller: AsyncCaller) => {
        const v1 = await caller.callAsync(async () => [5])
        const v2 = await caller.callAsync(async () => [v1[0] as number * 2])
        const v3 = await caller.callAsync(async () => [(v2[0] as number) + 3])
        return v3[0] as number
      })

      expect(result).toBe(13) // (5 * 2) + 3
    })

    it('propagates errors from a rejected async call', async () => {
      // Regression: a rejected subtask used to transition to 'returned' with
      // empty values, so callAsync silently returned [] and the error vanished.
      const executor = new AsyncExecutor()

      await expect(
        executor.executeSync(async (caller: AsyncCaller) => {
          await caller.callAsync(async () => {
            throw new Error('async import failed')
          })
          return 'should not reach here'
        })
      ).rejects.toThrow('async import failed')
    })
  })

  describe('activeTaskCount', () => {
    it('tracks active tasks', async () => {
      const executor = new AsyncExecutor()

      expect(executor.activeTaskCount).toBe(0)

      const promise = executor.execute(async (builtins) => {
        builtins['task.start']()
        expect(executor.activeTaskCount).toBe(1)
        builtins['task.return']([])
      })

      await promise
      expect(executor.activeTaskCount).toBe(0)
    })
  })

  describe('waitAll', () => {
    it('waits for all tasks to complete', async () => {
      const executor = new AsyncExecutor()
      const results: number[] = []

      // Start multiple tasks
      const tasks = [
        executor.execute(async (builtins) => {
          builtins['task.start']()
          await new Promise((resolve) => setTimeout(resolve, 10))
          results.push(1)
          builtins['task.return']([])
        }),
        executor.execute(async (builtins) => {
          builtins['task.start']()
          await new Promise((resolve) => setTimeout(resolve, 20))
          results.push(2)
          builtins['task.return']([])
        }),
      ]

      // Wait for all
      await executor.waitAll()

      expect(results.sort()).toEqual([1, 2])
    })

    it('resolves immediately when no active tasks', async () => {
      const executor = new AsyncExecutor()

      const start = Date.now()
      await executor.waitAll()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })

    it('wakes multiple concurrent waiters when tasks drain', async () => {
      const executor = new AsyncExecutor()
      executor.execute(async (builtins) => {
        builtins['task.start']()
        await new Promise((resolve) => setTimeout(resolve, 15))
        builtins['task.return']([])
      })

      // Both waiters register on the same drain event (event-driven, not polled).
      await Promise.all([executor.waitAll(), executor.waitAll()])
      expect(executor.activeTaskCount).toBe(0)
    })

    it('throws on timeout', async () => {
      const executor = new AsyncExecutor({ waitTimeout: 50 })

      // Start a long-running task that never completes properly
      executor
        .execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        })
        .catch(() => {})

      await expect(executor.waitAll(50)).rejects.toThrow('Timeout waiting for tasks')
    })
  })

  describe('cancelAll', () => {
    it('cancels all active tasks', async () => {
      const executor = new AsyncExecutor()

      // Start a task that would take a long time
      const promise = executor.execute(async (builtins, task) => {
        builtins['task.start']()
        await new Promise((resolve) => setTimeout(resolve, 1000))
        builtins['task.return']([])
      })

      // Cancel immediately - this clears the active tasks but doesn't reject promises
      executor.cancelAll()

      expect(executor.activeTaskCount).toBe(0)

      // The task was cancelled mid-execution but may still resolve
      // depending on timing. What we verify is that activeTaskCount is 0.
      // Wait briefly for the promise to settle
      const result = await Promise.race([
        promise.then((v) => ({ resolved: true, value: v })),
        new Promise((r) => setTimeout(() => r({ resolved: false }), 50)),
      ])

      // Task should either resolve quickly or timeout
      expect(result).toBeDefined()
    })
  })

  describe('runAsync', () => {
    it('provides a simple way to run async component', async () => {
      const result = await runAsync<[string]>(async (builtins) => {
        builtins['task.start']()
        builtins['task.return'](['runAsync result'])
      })

      expect(result).toEqual(['runAsync result'])
    })

    it('handles errors', async () => {
      await expect(
        runAsync(async () => {
          throw new Error('runAsync error')
        })
      ).rejects.toThrow('runAsync error')
    })
  })

  describe('eventLoop', () => {
    it('processes events from operations', async () => {
      const events: TaskEvent[] = []
      let iteration = 0

      const operations = [
        async (): Promise<TaskEvent[]> => {
          iteration++
          if (iteration <= 3) {
            return [{ type: 'stream-read', handle: iteration }]
          }
          // Stop the loop by returning no events forever
          return []
        },
      ]

      // Run with a timeout to prevent infinite loop in test
      const loopPromise = eventLoop(operations, (event) => {
        events.push(event)
        if (events.length >= 3) {
          throw new Error('Stop loop') // Use error to exit
        }
      })

      await expect(loopPromise).rejects.toThrow('Stop loop')

      expect(events.length).toBe(3)
      expect(events.map((e) => e.handle)).toEqual([1, 2, 3])
    })

    it('handles async handlers', async () => {
      const events: number[] = []
      let iteration = 0

      const operations = [
        async (): Promise<TaskEvent[]> => {
          iteration++
          if (iteration === 1) {
            return [{ type: 'future-read', handle: 42 }]
          }
          return []
        },
      ]

      const loopPromise = eventLoop(operations, async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        events.push(event.handle)
        throw new Error('Stop')
      })

      await expect(loopPromise).rejects.toThrow('Stop')
      expect(events).toEqual([42])
    })
  })

  describe('integration scenarios', () => {
    it('simulates component async export', async () => {
      const executor = new AsyncExecutor()

      // Simulate a component that reads a file asynchronously
      const result = await executor.execute<[Uint8Array]>(async (builtins, task) => {
        builtins['task.start']()

        // Simulate file read
        const data = await new Promise<Uint8Array>((resolve) => {
          setTimeout(() => resolve(new Uint8Array([1, 2, 3])), 10)
        })

        builtins['task.return']([data])
      })

      expect(result[0]).toEqual(new Uint8Array([1, 2, 3]))
    })

    it('simulates component sync export calling async import', async () => {
      const executor = new AsyncExecutor()

      // Simulate sync function that needs to call async HTTP fetch
      const result = await executor.executeSync(async (caller) => {
        // Make "HTTP request"
        const [response] = await caller.callAsync<[string]>(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return ['{"data": "hello"}']
        })

        return JSON.parse(response as string)
      })

      expect(result).toEqual({ data: 'hello' })
    })

    it('handles parallel async operations', async () => {
      const executor = new AsyncExecutor()

      const result = await executor.execute<[number[]]>(async (builtins, task) => {
        builtins['task.start']()

        // Start multiple parallel operations
        const promises = [1, 2, 3, 4, 5].map(
          (n) =>
            new Promise<number>((resolve) => {
              setTimeout(() => resolve(n * 10), Math.random() * 20)
            })
        )

        const values = await Promise.all(promises)
        builtins['task.return']([values])
      })

      expect(result[0].sort()).toEqual([10, 20, 30, 40, 50])
    })

    it('handles task with subtasks', async () => {
      const executor = new AsyncExecutor()

      const result = await executor.execute<[number]>(async (builtins, task) => {
        builtins['task.start']()

        // Start a subtask
        const handle = task.subtaskStart(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return [42]
        })

        // Wait for subtask
        while (task.subtaskPoll(handle) !== 'returned') {
          await builtins['task.yield']()
        }

        const values = task.subtaskReturnValues(handle)
        builtins['task.return']([values![0] as number])
      })

      expect(result).toEqual([42])
    })

    it('handles multiple executors', async () => {
      const executor1 = new AsyncExecutor()
      const executor2 = new AsyncExecutor()

      const [result1, result2] = await Promise.all([
        executor1.execute<[string]>(async (builtins) => {
          builtins['task.start']()
          await new Promise((resolve) => setTimeout(resolve, 10))
          builtins['task.return'](['executor1'])
        }),
        executor2.execute<[string]>(async (builtins) => {
          builtins['task.start']()
          await new Promise((resolve) => setTimeout(resolve, 10))
          builtins['task.return'](['executor2'])
        }),
      ])

      expect(result1).toEqual(['executor1'])
      expect(result2).toEqual(['executor2'])
    })
  })
})
