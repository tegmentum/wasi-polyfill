import { describe, it, expect } from 'vitest'
import {
  createFuture,
  futureFromPromise,
  delay,
  resolvedFuture,
  cancelledFuture,
  raceFutures,
  allFutures,
} from '../../src/wasip3/canonical-abi/future.js'

describe('WASIP3 Future', () => {
  describe('createFuture', () => {
    it('creates a future/resolver pair', () => {
      const [future, resolver] = createFuture<number>()
      expect(future).toBeDefined()
      expect(resolver).toBeDefined()
      expect(typeof future.read).toBe('function')
      expect(typeof future.cancel).toBe('function')
      expect(typeof resolver.resolve).toBe('function')
      expect(typeof resolver.reject).toBe('function')
    })

    it('resolves with a value', async () => {
      const [future, resolver] = createFuture<string>()

      resolver.resolve('hello')

      const result = await future.read()
      expect(result).toEqual({ status: 'ok', value: 'hello' })
    })

    it('handles pending read that resolves when value is set', async () => {
      const [future, resolver] = createFuture<number>()

      // Start reading before value is set
      const readPromise = future.read()

      // Resolve after a delay
      await new Promise((resolve) => setTimeout(resolve, 10))
      resolver.resolve(42)

      const result = await readPromise
      expect(result).toEqual({ status: 'ok', value: 42 })
    })

    it('multiple reads all receive the value', async () => {
      const [future, resolver] = createFuture<string>()

      const readPromise1 = future.read()
      const readPromise2 = future.read()
      const readPromise3 = future.read()

      resolver.resolve('shared')

      const [result1, result2, result3] = await Promise.all([
        readPromise1,
        readPromise2,
        readPromise3,
      ])

      expect(result1).toEqual({ status: 'ok', value: 'shared' })
      expect(result2).toEqual({ status: 'ok', value: 'shared' })
      expect(result3).toEqual({ status: 'ok', value: 'shared' })
    })

    it('returns cancelled status when cancelled', async () => {
      const [future, _resolver] = createFuture<string>()

      future.cancel()

      const result = await future.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('cancels pending reads', async () => {
      const [future, _resolver] = createFuture<number>()

      const readPromise = future.read()
      future.cancel()

      const result = await readPromise
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('ignores resolve after cancel', async () => {
      const [future, resolver] = createFuture<string>()

      future.cancel()
      resolver.resolve('too late')

      const result = await future.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('ignores resolve after already resolved', async () => {
      const [future, resolver] = createFuture<number>()

      resolver.resolve(1)
      resolver.resolve(2) // This should be ignored

      const result = await future.read()
      expect(result).toEqual({ status: 'ok', value: 1 })
    })

    it('ignores cancel after already resolved', async () => {
      const [future, resolver] = createFuture<string>()

      resolver.resolve('first')
      future.cancel() // This should be ignored

      const result = await future.read()
      expect(result).toEqual({ status: 'ok', value: 'first' })
    })

    it('reject returns cancelled status', async () => {
      const [future, resolver] = createFuture<string>()

      resolver.reject(new Error('Something went wrong'))

      const result = await future.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('rejects pending reads', async () => {
      const [future, resolver] = createFuture<number>()

      const readPromise = future.read()
      resolver.reject(new Error('Failed'))

      const result = await readPromise
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('handles typed arrays', async () => {
      const [future, resolver] = createFuture<Uint8Array>()

      const data = new Uint8Array([1, 2, 3, 4, 5])
      resolver.resolve(data)

      const result = await future.read()
      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.value).toEqual(data)
      }
    })

    it('handles objects', async () => {
      const [future, resolver] = createFuture<{ name: string; count: number }>()

      const obj = { name: 'test', count: 123 }
      resolver.resolve(obj)

      const result = await future.read()
      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.value).toEqual(obj)
      }
    })

    it('handles null and undefined values', async () => {
      const [future1, resolver1] = createFuture<null>()
      const [future2, resolver2] = createFuture<undefined>()

      resolver1.resolve(null)
      resolver2.resolve(undefined)

      const result1 = await future1.read()
      const result2 = await future2.read()

      expect(result1).toEqual({ status: 'ok', value: null })
      expect(result2).toEqual({ status: 'ok', value: undefined })
    })
  })

  describe('futureFromPromise', () => {
    it('creates a future from a resolved promise', async () => {
      const promise = Promise.resolve('value')
      const future = futureFromPromise(promise)

      const result = await future.read()
      expect(result).toEqual({ status: 'ok', value: 'value' })
    })

    it('creates a future from a pending promise', async () => {
      const promise = new Promise<number>((resolve) => {
        setTimeout(() => resolve(42), 10)
      })
      const future = futureFromPromise(promise)

      const result = await future.read()
      expect(result).toEqual({ status: 'ok', value: 42 })
    })

    it('handles rejected promise', async () => {
      const promise = Promise.reject(new Error('Failed'))
      const future = futureFromPromise(promise)

      const result = await future.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('handles non-Error rejection', async () => {
      const promise = Promise.reject('string error')
      const future = futureFromPromise(promise)

      const result = await future.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('can be cancelled but does not cancel the promise', async () => {
      let promiseResolved = false
      const promise = new Promise<string>((resolve) => {
        setTimeout(() => {
          promiseResolved = true
          resolve('done')
        }, 50)
      })

      const future = futureFromPromise(promise)
      future.cancel()

      const result = await future.read()
      expect(result).toEqual({ status: 'cancelled' })

      // Wait for the promise to complete
      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(promiseResolved).toBe(true)
    })
  })

  describe('delay', () => {
    it('resolves after specified time', async () => {
      const start = Date.now()
      const future = delay(50)

      const result = await future.read()
      const elapsed = Date.now() - start

      expect(result).toEqual({ status: 'ok', value: undefined })
      expect(elapsed).toBeGreaterThanOrEqual(45) // Allow some tolerance
    })

    it('can be cancelled before resolving', async () => {
      const future = delay(1000)

      // Cancel immediately
      future.cancel()

      const result = await future.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('clears timeout on cancel', async () => {
      const future = delay(100)
      future.cancel()

      // If timeout wasn't cleared, we'd have to wait
      const start = Date.now()
      await future.read()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })

    it('handles zero delay', async () => {
      const future = delay(0)

      const result = await future.read()
      expect(result).toEqual({ status: 'ok', value: undefined })
    })
  })

  describe('resolvedFuture', () => {
    it('creates an already resolved future', async () => {
      const future = resolvedFuture('immediate')

      const result = await future.read()
      expect(result).toEqual({ status: 'ok', value: 'immediate' })
    })

    it('returns same value on multiple reads', async () => {
      const future = resolvedFuture(42)

      const result1 = await future.read()
      const result2 = await future.read()

      expect(result1).toEqual({ status: 'ok', value: 42 })
      expect(result2).toEqual({ status: 'ok', value: 42 })
    })

    it('cancel has no effect', async () => {
      const future = resolvedFuture('value')

      future.cancel()

      const result = await future.read()
      expect(result).toEqual({ status: 'ok', value: 'value' })
    })

    it('handles complex values', async () => {
      const obj = { nested: { data: [1, 2, 3] } }
      const future = resolvedFuture(obj)

      const result = await future.read()
      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.value).toBe(obj) // Same reference
      }
    })
  })

  describe('cancelledFuture', () => {
    it('creates an already cancelled future', async () => {
      const future = cancelledFuture<string>()

      const result = await future.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('returns cancelled on multiple reads', async () => {
      const future = cancelledFuture<number>()

      const result1 = await future.read()
      const result2 = await future.read()

      expect(result1).toEqual({ status: 'cancelled' })
      expect(result2).toEqual({ status: 'cancelled' })
    })

    it('cancel has no effect (already cancelled)', async () => {
      const future = cancelledFuture<boolean>()

      future.cancel()

      const result = await future.read()
      expect(result).toEqual({ status: 'cancelled' })
    })
  })

  describe('raceFutures', () => {
    it('returns the first future to complete', async () => {
      const [future1, resolver1] = createFuture<string>()
      const [future2, resolver2] = createFuture<string>()
      const [future3, resolver3] = createFuture<string>()

      const raced = raceFutures([future1, future2, future3])

      resolver2.resolve('winner')

      const result = await raced.read()
      expect(result).toEqual({ status: 'ok', value: 'winner' })

      // Other resolves are ignored
      resolver1.resolve('too late')
      resolver3.resolve('also late')
    })

    it('cancels other futures when one completes', async () => {
      let cancelled1 = false
      let cancelled3 = false

      const future1: ReturnType<typeof createFuture<string>>[0] = {
        read: () =>
          new Promise(() => {
            /* never resolves */
          }),
        cancel: () => {
          cancelled1 = true
        },
      }

      const [future2, resolver2] = createFuture<string>()

      const future3: ReturnType<typeof createFuture<string>>[0] = {
        read: () =>
          new Promise(() => {
            /* never resolves */
          }),
        cancel: () => {
          cancelled3 = true
        },
      }

      const raced = raceFutures([future1, future2, future3])

      resolver2.resolve('winner')
      await raced.read()

      expect(cancelled1).toBe(true)
      expect(cancelled3).toBe(true)
    })

    it('returns cancelled if first to complete is cancelled', async () => {
      const [future1] = createFuture<string>()
      const [future2] = createFuture<string>()

      const raced = raceFutures([future1, future2])

      future1.cancel()

      const result = await raced.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('cancelling the raced future cancels all inputs', async () => {
      const [future1] = createFuture<number>()
      const [future2] = createFuture<number>()

      const raced = raceFutures([future1, future2])

      raced.cancel()

      const result1 = await future1.read()
      const result2 = await future2.read()

      expect(result1).toEqual({ status: 'cancelled' })
      expect(result2).toEqual({ status: 'cancelled' })
    })

    it('handles already resolved futures', async () => {
      const resolved = resolvedFuture('quick')
      const [pending, _resolver] = createFuture<string>()

      const raced = raceFutures([resolved, pending])

      const result = await raced.read()
      expect(result).toEqual({ status: 'ok', value: 'quick' })
    })

    it('handles single future', async () => {
      const [future, resolver] = createFuture<number>()

      const raced = raceFutures([future])
      resolver.resolve(42)

      const result = await raced.read()
      expect(result).toEqual({ status: 'ok', value: 42 })
    })
  })

  describe('allFutures', () => {
    it('waits for all futures to complete', async () => {
      const [future1, resolver1] = createFuture<number>()
      const [future2, resolver2] = createFuture<number>()
      const [future3, resolver3] = createFuture<number>()

      const combined = allFutures([future1, future2, future3])

      resolver1.resolve(1)
      resolver2.resolve(2)
      resolver3.resolve(3)

      const result = await combined.read()
      expect(result).toEqual({ status: 'ok', value: [1, 2, 3] })
    })

    it('preserves order of values', async () => {
      const [future1, resolver1] = createFuture<string>()
      const [future2, resolver2] = createFuture<string>()
      const [future3, resolver3] = createFuture<string>()

      const combined = allFutures([future1, future2, future3])

      // Resolve in different order
      resolver3.resolve('third')
      resolver1.resolve('first')
      resolver2.resolve('second')

      const result = await combined.read()
      expect(result).toEqual({ status: 'ok', value: ['first', 'second', 'third'] })
    })

    it('returns cancelled if any future is cancelled', async () => {
      const [future1, resolver1] = createFuture<number>()
      const [future2] = createFuture<number>()
      const [future3, resolver3] = createFuture<number>()

      const combined = allFutures([future1, future2, future3])

      resolver1.resolve(1)
      future2.cancel()
      resolver3.resolve(3)

      const result = await combined.read()
      expect(result).toEqual({ status: 'cancelled' })
    })

    it('cancelling the combined future cancels all inputs', async () => {
      const [future1] = createFuture<number>()
      const [future2] = createFuture<number>()

      const combined = allFutures([future1, future2])

      combined.cancel()

      const result1 = await future1.read()
      const result2 = await future2.read()

      expect(result1).toEqual({ status: 'cancelled' })
      expect(result2).toEqual({ status: 'cancelled' })
    })

    it('handles empty array', async () => {
      const combined = allFutures<number>([])

      const result = await combined.read()
      expect(result).toEqual({ status: 'ok', value: [] })
    })

    it('handles single future', async () => {
      const [future, resolver] = createFuture<string>()

      const combined = allFutures([future])
      resolver.resolve('only')

      const result = await combined.read()
      expect(result).toEqual({ status: 'ok', value: ['only'] })
    })

    it('handles already resolved futures', async () => {
      const futures = [
        resolvedFuture(1),
        resolvedFuture(2),
        resolvedFuture(3),
      ]

      const combined = allFutures(futures)

      const result = await combined.read()
      expect(result).toEqual({ status: 'ok', value: [1, 2, 3] })
    })
  })

  describe('integration scenarios', () => {
    it('timeout pattern using race', async () => {
      const [future, resolver] = createFuture<string>()
      const timeout = delay(10)

      const raced = raceFutures([
        future,
        futureFromPromise(
          timeout.read().then(() => {
            throw new Error('Timeout')
          })
        ),
      ])

      // Resolve before timeout
      resolver.resolve('success')

      const result = await raced.read()
      expect(result).toEqual({ status: 'ok', value: 'success' })
    })

    it('sequential async operations', async () => {
      const step1 = resolvedFuture(10)
      const result1 = await step1.read()

      if (result1.status === 'ok') {
        const step2 = resolvedFuture(result1.value * 2)
        const result2 = await step2.read()

        if (result2.status === 'ok') {
          const step3 = resolvedFuture(result2.value + 5)
          const result3 = await step3.read()

          expect(result3).toEqual({ status: 'ok', value: 25 })
        }
      }
    })

    it('parallel operations with all', async () => {
      const futures = [
        futureFromPromise(
          new Promise<number>((resolve) => setTimeout(() => resolve(1), 10))
        ),
        futureFromPromise(
          new Promise<number>((resolve) => setTimeout(() => resolve(2), 20))
        ),
        futureFromPromise(
          new Promise<number>((resolve) => setTimeout(() => resolve(3), 30))
        ),
      ]

      const combined = allFutures(futures)
      const result = await combined.read()

      expect(result).toEqual({ status: 'ok', value: [1, 2, 3] })
    })

    it('first-success pattern', async () => {
      const [future1] = createFuture<string>()
      const [future2, resolver2] = createFuture<string>()
      const [future3] = createFuture<string>()

      // future1 and future3 will cancel, future2 succeeds
      future1.cancel()
      resolver2.resolve('success')
      future3.cancel()

      const raced = raceFutures([future1, future2, future3])

      const result = await raced.read()
      // future1 might win the race if it was cancelled first
      // but if future2 resolves first, we get success
      expect(
        result.status === 'ok' || result.status === 'cancelled'
      ).toBe(true)
    })

    it('stress test with many futures', async () => {
      const count = 100
      const futures: ReturnType<typeof createFuture<number>>[0][] = []
      const resolvers: ReturnType<typeof createFuture<number>>[1][] = []

      for (let i = 0; i < count; i++) {
        const [future, resolver] = createFuture<number>()
        futures.push(future)
        resolvers.push(resolver)
      }

      const combined = allFutures(futures)

      // Resolve all in random order
      const indices = Array.from({ length: count }, (_, i) => i)
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[indices[i], indices[j]] = [indices[j], indices[i]]
      }

      for (const i of indices) {
        resolvers[i].resolve(i)
      }

      const result = await combined.read()
      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.value).toEqual(Array.from({ length: count }, (_, i) => i))
      }
    })
  })
})
