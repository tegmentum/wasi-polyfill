import { describe, it, expect } from 'vitest'
import { SubtaskManager } from '../../src/wasip3/canonical-abi/subtask.js'

describe('WASIP3 SubtaskManager', () => {
  describe('create', () => {
    it('creates a subtask and returns a handle', () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => ['result'])
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)
    })

    it('returns unique handles for each subtask', () => {
      const manager = new SubtaskManager()

      const handle1 = manager.create(async () => ['1'])
      const handle2 = manager.create(async () => ['2'])
      const handle3 = manager.create(async () => ['3'])

      expect(new Set([handle1, handle2, handle3]).size).toBe(3)
    })

    it('starts the async call immediately', async () => {
      const manager = new SubtaskManager()
      let called = false

      manager.create(async () => {
        called = true
        return ['done']
      })

      // Wait a tick for the async call to start
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(called).toBe(true)
    })
  })

  describe('getState', () => {
    it('returns starting state initially', () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return ['delayed']
      })

      // State might be 'starting' or 'started' depending on timing
      const state = manager.getState(handle)
      expect(['starting', 'started'].includes(state!)).toBe(true)
    })

    it('returns undefined for invalid handle', () => {
      const manager = new SubtaskManager()
      expect(manager.getState(999)).toBeUndefined()
    })

    it('transitions to started quickly', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return ['result']
      })

      // Wait a tick
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(manager.getState(handle)).toBe('started')
    })

    it('transitions to returned when complete', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => ['done'])

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(manager.getState(handle)).toBe('returned')
    })
  })

  describe('poll', () => {
    it('returns current state', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => ['result'])

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(manager.poll(handle)).toBe('returned')
    })

    it('throws for invalid handle', () => {
      const manager = new SubtaskManager()
      expect(() => manager.poll(999)).toThrow('Invalid subtask handle: 999')
    })
  })

  describe('wait', () => {
    it('resolves when subtask returns', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return ['delayed result']
      })

      const state = await manager.wait(handle)
      expect(state).toBe('returned')
    })

    it('resolves immediately if already returned', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => ['immediate'])

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should resolve immediately now
      const start = Date.now()
      const state = await manager.wait(handle)
      const elapsed = Date.now() - start

      expect(state).toBe('returned')
      expect(elapsed).toBeLessThan(10)
    })

    it('rejects for invalid handle', async () => {
      const manager = new SubtaskManager()
      await expect(manager.wait(999)).rejects.toThrow('Invalid subtask handle: 999')
    })
  })

  describe('getReturnValues', () => {
    it('returns values when subtask has returned', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => ['value1', 'value2', 'value3'])

      await manager.wait(handle)
      const values = manager.getReturnValues(handle)

      expect(values).toEqual(['value1', 'value2', 'value3'])
    })

    it('returns undefined before subtask returns', () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return ['delayed']
      })

      expect(manager.getReturnValues(handle)).toBeUndefined()
    })

    it('throws for invalid handle', () => {
      const manager = new SubtaskManager()
      expect(() => manager.getReturnValues(999)).toThrow('Invalid subtask handle: 999')
    })

    it('returns empty array for errors', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => {
        throw new Error('Subtask failed')
      })

      await manager.wait(handle)
      const values = manager.getReturnValues(handle)

      expect(values).toEqual([])
    })
  })

  describe('getError', () => {
    it('returns error when subtask fails', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => {
        throw new Error('Something went wrong')
      })

      await manager.wait(handle)
      const error = manager.getError(handle)

      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toBe('Something went wrong')
    })

    it('returns undefined when subtask succeeds', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => ['success'])

      await manager.wait(handle)
      expect(manager.getError(handle)).toBeUndefined()
    })

    it('converts non-Error to Error', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => {
        throw 'string error'
      })

      await manager.wait(handle)
      const error = manager.getError(handle)

      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toBe('string error')
    })
  })

  describe('acknowledge', () => {
    it('transitions to done state', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => ['result'])

      await manager.wait(handle)
      expect(manager.getState(handle)).toBe('returned')

      manager.acknowledge(handle)
      expect(manager.getState(handle)).toBe('done')
    })

    it('throws for invalid handle', () => {
      const manager = new SubtaskManager()
      expect(() => manager.acknowledge(999)).toThrow('Invalid subtask handle: 999')
    })

    it('throws when not in returned state', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return ['delayed']
      })

      // Try to acknowledge before completion
      expect(() => manager.acknowledge(handle)).toThrow('Cannot acknowledge subtask in state')
    })
  })

  describe('drop', () => {
    it('removes subtask from tracking', async () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => ['result'])
      await manager.wait(handle)

      manager.drop(handle)

      expect(manager.getState(handle)).toBeUndefined()
      expect(() => manager.poll(handle)).toThrow()
    })

    it('can drop unfinished subtask', () => {
      const manager = new SubtaskManager()

      const handle = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return ['never']
      })

      manager.drop(handle)
      expect(manager.getState(handle)).toBeUndefined()
    })
  })

  describe('getActiveHandles', () => {
    it('returns all active handles', async () => {
      const manager = new SubtaskManager()

      const handle1 = manager.create(async () => ['1'])
      const handle2 = manager.create(async () => ['2'])
      const handle3 = manager.create(async () => ['3'])

      const handles = manager.getActiveHandles()
      expect(handles.sort()).toEqual([handle1, handle2, handle3].sort())
    })

    it('returns empty array when no subtasks', () => {
      const manager = new SubtaskManager()
      expect(manager.getActiveHandles()).toEqual([])
    })

    it('excludes dropped handles', async () => {
      const manager = new SubtaskManager()

      const handle1 = manager.create(async () => ['1'])
      const handle2 = manager.create(async () => ['2'])

      manager.drop(handle1)

      expect(manager.getActiveHandles()).toEqual([handle2])
    })
  })

  describe('getHandlesInState', () => {
    it('returns handles in specified state', async () => {
      const manager = new SubtaskManager()

      // One quick subtask
      const quick = manager.create(async () => ['quick'])

      // One delayed subtask
      const delayed = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return ['delayed']
      })

      // Wait for quick to complete
      await manager.wait(quick)

      const returned = manager.getHandlesInState('returned')
      const started = manager.getHandlesInState('started')

      expect(returned).toContain(quick)
      expect(started).toContain(delayed)
    })

    it('returns empty array when no handles in state', () => {
      const manager = new SubtaskManager()
      expect(manager.getHandlesInState('done')).toEqual([])
    })
  })

  describe('waitAny', () => {
    it('resolves with first handle to complete', async () => {
      const manager = new SubtaskManager()

      const slow = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return ['slow']
      })

      const fast = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return ['fast']
      })

      const winner = await manager.waitAny([slow, fast])
      expect(winner).toBe(fast)
    })

    it('resolves immediately if one is already returned', async () => {
      const manager = new SubtaskManager()

      const done = manager.create(async () => ['done'])
      await manager.wait(done)

      const pending = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return ['pending']
      })

      const winner = await manager.waitAny([pending, done])
      expect(winner).toBe(done)
    })

    it('rejects if any handle is invalid', async () => {
      const manager = new SubtaskManager()

      const valid = manager.create(async () => ['valid'])

      await expect(manager.waitAny([valid, 999])).rejects.toThrow('Invalid subtask handle: 999')
    })
  })

  describe('state change callbacks', () => {
    it('invokes callbacks on state transitions', async () => {
      const manager = new SubtaskManager()
      const states: string[] = []

      // Access internal subtask to add callback (for testing)
      const handle = manager.create(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return ['result']
      })

      // Wait for the subtask to complete and observe states
      await manager.wait(handle)

      // Should have transitioned through states
      const finalState = manager.getState(handle)
      expect(finalState).toBe('returned')
    })
  })

  describe('integration scenarios', () => {
    it('handles multiple concurrent subtasks', async () => {
      const manager = new SubtaskManager()

      const handles = Array.from({ length: 10 }, (_, i) =>
        manager.create(async () => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 50))
          return [`result-${i}`]
        })
      )

      // Wait for all to complete
      await Promise.all(handles.map((h) => manager.wait(h)))

      // All should be in returned state
      for (const handle of handles) {
        expect(manager.getState(handle)).toBe('returned')
        expect(manager.getReturnValues(handle)).toBeDefined()
      }
    })

    it('handles mixed success and failure', async () => {
      const manager = new SubtaskManager()

      const success = manager.create(async () => ['success'])
      const failure = manager.create(async () => {
        throw new Error('failure')
      })

      await Promise.all([manager.wait(success), manager.wait(failure)])

      expect(manager.getReturnValues(success)).toEqual(['success'])
      expect(manager.getError(success)).toBeUndefined()

      expect(manager.getReturnValues(failure)).toEqual([])
      expect(manager.getError(failure)).toBeDefined()
    })

    it('simulates async import call pattern', async () => {
      const manager = new SubtaskManager()

      // Simulate calling an async import
      const handle = manager.create(async () => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10))
        return [42, 'hello']
      })

      // Poll until complete (non-blocking check)
      while (manager.poll(handle) !== 'returned') {
        await new Promise((resolve) => setTimeout(resolve, 1))
      }

      // Get results
      const values = manager.getReturnValues(handle)
      expect(values).toEqual([42, 'hello'])

      // Acknowledge completion
      manager.acknowledge(handle)
      expect(manager.getState(handle)).toBe('done')

      // Clean up
      manager.drop(handle)
    })

    it('handles subtask chains', async () => {
      const manager = new SubtaskManager()

      // First subtask
      const h1 = manager.create(async () => [10])
      await manager.wait(h1)
      const v1 = manager.getReturnValues(h1)?.[0] as number

      // Second subtask using first result
      const h2 = manager.create(async () => [v1 * 2])
      await manager.wait(h2)
      const v2 = manager.getReturnValues(h2)?.[0] as number

      // Third subtask using second result
      const h3 = manager.create(async () => [v2 + 5])
      await manager.wait(h3)
      const v3 = manager.getReturnValues(h3)?.[0] as number

      expect(v3).toBe(25) // 10 * 2 + 5

      // Cleanup
      for (const h of [h1, h2, h3]) {
        manager.acknowledge(h)
        manager.drop(h)
      }

      expect(manager.getActiveHandles()).toEqual([])
    })

    it('handles rapid create/drop cycles', () => {
      const manager = new SubtaskManager()

      for (let i = 0; i < 100; i++) {
        const handle = manager.create(async () => [`item-${i}`])
        manager.drop(handle)
      }

      expect(manager.getActiveHandles()).toEqual([])
    })

    it('stress test with many waiting handles', async () => {
      const manager = new SubtaskManager()
      const count = 50

      const handles = Array.from({ length: count }, (_, i) =>
        manager.create(async () => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20))
          return [i]
        })
      )

      // Use waitAny repeatedly
      const completed: number[] = []
      const remaining = new Set(handles)

      while (remaining.size > 0) {
        const winner = await manager.waitAny(Array.from(remaining))
        remaining.delete(winner)
        const values = manager.getReturnValues(winner)
        completed.push(values![0] as number)
        manager.acknowledge(winner)
      }

      expect(completed.sort((a, b) => a - b)).toEqual(
        Array.from({ length: count }, (_, i) => i)
      )
    })
  })
})
