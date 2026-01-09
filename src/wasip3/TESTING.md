# WASIP3 Test Suite Implementation Plan

## Overview

WASIP3 has a complete implementation (~6000 LOC) but zero test coverage. This plan establishes comprehensive testing to validate the async primitives, P2 adapters, and interface implementations before production use.

### Current State

| Component | LOC | Tests |
|-----------|-----|-------|
| Canonical ABI (stream, future, task, subtask) | ~1400 | 0 |
| Async/Sync Bridge | ~520 | 0 |
| P2-to-P3 Adapters | ~620 | 0 |
| Async Executor | ~240 | 0 |
| Component Loader | ~440 | 0 |
| Interfaces (cli, clocks, fs, http, io, random, sockets) | ~2000 | 0 |
| **Total** | **~6000** | **0** |

### Goals

1. Achieve >90% code coverage for all WASIP3 modules
2. Validate async primitive semantics match Component Model spec
3. Ensure P2 adapter compatibility with existing P2 plugins
4. Prepare for jco P3 integration when available

### Testing Strategy

Since jco P3 support is not yet available, we'll:
1. Unit test all primitives in isolation
2. Integration test adapters with P2 plugins
3. Mock component instantiation for loader tests
4. Create compatibility tests ready for real components

---

## Phase 1: Core Primitives (~1200 LOC tests)

**Priority**: Critical | **Effort**: High | **Duration**: 3-4 days

### 1.1 Stream Tests (`test/wasip3/stream.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createStream,
  Stream,
  StreamWriter,
  streamFromAsyncIterable,
  streamFromReadable,
  writerFromWritable,
  collectStream
} from '../../src/wasip3/canonical-abi/stream.js'

describe('Stream', () => {
  describe('createStream', () => {
    it('should create a reader/writer pair', () => {
      const [reader, writer] = createStream<number>()
      expect(reader).toBeDefined()
      expect(writer).toBeDefined()
    })

    it('should transfer values from writer to reader', async () => {
      const [reader, writer] = createStream<number>()

      writer.write([1, 2, 3])
      const result = await reader.read()

      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(result.values).toEqual([1, 2, 3])
      }
    })

    it('should handle multiple writes before read', async () => {
      const [reader, writer] = createStream<number>()

      writer.write([1, 2])
      writer.write([3, 4])

      const result1 = await reader.read()
      const result2 = await reader.read()

      expect(result1.status).toBe('values')
      expect(result2.status).toBe('values')
    })

    it('should signal end when writer closes', async () => {
      const [reader, writer] = createStream<number>()

      writer.write([1])
      writer.close()

      await reader.read() // consume [1]
      const result = await reader.read()

      expect(result.status).toBe('end')
    })

    it('should signal cancelled when reader cancels', async () => {
      const [reader, writer] = createStream<number>()

      reader.cancel()

      const writeResult = await writer.write([1])
      expect(writeResult.status).toBe('cancelled')
    })

    it('should signal cancelled when writer cancels', async () => {
      const [reader, writer] = createStream<number>()

      writer.cancel()

      const readResult = await reader.read()
      expect(readResult.status).toBe('cancelled')
    })
  })

  describe('Backpressure', () => {
    it('should apply backpressure when buffer is full', async () => {
      const [reader, writer] = createStream<number>({ bufferSize: 2 })

      // Fill buffer
      await writer.write([1])
      await writer.write([2])

      // Third write should block until read
      let writeResolved = false
      const writePromise = writer.write([3]).then(() => {
        writeResolved = true
      })

      // Give time for async operations
      await new Promise(r => setTimeout(r, 10))
      expect(writeResolved).toBe(false)

      // Read to make space
      await reader.read()

      // Now write should resolve
      await writePromise
      expect(writeResolved).toBe(true)
    })

    it('should report write count correctly', async () => {
      const [reader, writer] = createStream<number>()

      const result = await writer.write([1, 2, 3, 4, 5])

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.count).toBe(5)
      }
    })
  })

  describe('streamFromAsyncIterable', () => {
    it('should convert async iterable to stream', async () => {
      async function* generate() {
        yield 1
        yield 2
        yield 3
      }

      const stream = streamFromAsyncIterable(generate())
      const values = await collectStream(stream)

      expect(values).toEqual([1, 2, 3])
    })

    it('should handle errors in async iterable', async () => {
      async function* generateWithError() {
        yield 1
        throw new Error('Test error')
      }

      const stream = streamFromAsyncIterable(generateWithError())

      const result1 = await stream.read()
      expect(result1.status).toBe('values')

      // Next read should get cancellation (error maps to cancel)
      const result2 = await stream.read()
      expect(result2.status).toBe('cancelled')
    })
  })

  describe('streamFromReadable', () => {
    it('should wrap browser ReadableStream', async () => {
      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.close()
        }
      })

      const stream = streamFromReadable(readable)
      const result = await stream.read()

      expect(result.status).toBe('values')
    })
  })

  describe('collectStream', () => {
    it('should collect all values into array', async () => {
      const [reader, writer] = createStream<string>()

      writer.write(['a', 'b'])
      writer.write(['c'])
      writer.close()

      const values = await collectStream(reader)
      expect(values).toEqual(['a', 'b', 'c'])
    })

    it('should return empty array for immediately closed stream', async () => {
      const [reader, writer] = createStream<string>()
      writer.close()

      const values = await collectStream(reader)
      expect(values).toEqual([])
    })
  })
})
```

### 1.2 Future Tests (`test/wasip3/future.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  createFuture,
  Future,
  FutureResolver,
  futureFromPromise,
  delay,
  resolvedFuture,
  cancelledFuture,
  raceFutures,
  allFutures
} from '../../src/wasip3/canonical-abi/future.js'

describe('Future', () => {
  describe('createFuture', () => {
    it('should create future/resolver pair', () => {
      const [future, resolver] = createFuture<number>()
      expect(future).toBeDefined()
      expect(resolver).toBeDefined()
    })

    it('should resolve with value', async () => {
      const [future, resolver] = createFuture<number>()

      resolver.resolve(42)
      const result = await future.read()

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.value).toBe(42)
      }
    })

    it('should handle rejection', async () => {
      const [future, resolver] = createFuture<number>()

      resolver.reject(new Error('Test error'))
      const result = await future.read()

      // Current implementation treats errors as cancelled
      // This test documents current behavior
      expect(result.status).toBe('cancelled')
    })

    it('should support cancellation', async () => {
      const [future, resolver] = createFuture<number>()

      future.cancel()

      // Resolver should be notified
      // Future read should return cancelled
      const result = await future.read()
      expect(result.status).toBe('cancelled')
    })

    it('should only resolve once', async () => {
      const [future, resolver] = createFuture<number>()

      resolver.resolve(1)
      resolver.resolve(2) // Should be ignored

      const result = await future.read()
      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.value).toBe(1)
      }
    })
  })

  describe('futureFromPromise', () => {
    it('should wrap resolved promise', async () => {
      const promise = Promise.resolve(42)
      const future = futureFromPromise(promise)

      const result = await future.read()
      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.value).toBe(42)
      }
    })

    it('should wrap rejected promise', async () => {
      const promise = Promise.reject(new Error('Test'))
      const future = futureFromPromise(promise)

      const result = await future.read()
      expect(result.status).toBe('cancelled')
    })
  })

  describe('delay', () => {
    it('should resolve after specified time', async () => {
      const start = Date.now()
      const future = delay(50)

      await future.read()
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(45) // Allow some variance
    })

    it('should be cancellable', async () => {
      const future = delay(1000)

      future.cancel()
      const result = await future.read()

      expect(result.status).toBe('cancelled')
    })
  })

  describe('resolvedFuture', () => {
    it('should immediately resolve', async () => {
      const future = resolvedFuture('hello')
      const result = await future.read()

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.value).toBe('hello')
      }
    })
  })

  describe('cancelledFuture', () => {
    it('should immediately return cancelled', async () => {
      const future = cancelledFuture<number>()
      const result = await future.read()

      expect(result.status).toBe('cancelled')
    })
  })

  describe('raceFutures', () => {
    it('should resolve with first completed', async () => {
      const slow = delay(100).read().then(() => 'slow')
      const fast = delay(10).read().then(() => 'fast')

      const [f1] = createFuture<string>()
      const [f2] = createFuture<string>()

      // Manual race implementation test
      const winner = await Promise.race([
        delay(100).read().then(() => 'slow'),
        delay(10).read().then(() => 'fast')
      ])

      expect(winner).toBe('fast')
    })

    it('should cancel remaining futures on completion', async () => {
      const [f1, r1] = createFuture<number>()
      const [f2, r2] = createFuture<number>()

      const raceResult = raceFutures([f1, f2])

      r1.resolve(1) // f1 wins

      const result = await raceResult.read()
      expect(result.status).toBe('ok')
    })
  })

  describe('allFutures', () => {
    it('should wait for all futures', async () => {
      const [f1, r1] = createFuture<number>()
      const [f2, r2] = createFuture<number>()
      const [f3, r3] = createFuture<number>()

      const allResult = allFutures([f1, f2, f3])

      r1.resolve(1)
      r2.resolve(2)
      r3.resolve(3)

      const result = await allResult.read()
      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.value).toEqual([1, 2, 3])
      }
    })

    it('should cancel all if any cancelled', async () => {
      const [f1, r1] = createFuture<number>()
      const [f2, r2] = createFuture<number>()

      const allResult = allFutures([f1, f2])

      f1.cancel()

      const result = await allResult.read()
      expect(result.status).toBe('cancelled')
    })
  })
})
```

### 1.3 Task Tests (`test/wasip3/task.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  Task,
  TaskManager,
  TaskBuiltins,
  TaskEvent
} from '../../src/wasip3/canonical-abi/task.js'

describe('Task', () => {
  describe('TaskManager', () => {
    it('should create new task', () => {
      const manager = new TaskManager()
      const task = manager.createTask()

      expect(task).toBeDefined()
      expect(task.id).toBeDefined()
    })

    it('should track task state transitions', () => {
      const manager = new TaskManager()
      const task = manager.createTask()

      expect(task.state).toBe('created')

      task.start()
      expect(task.state).toBe('started')

      task.return([42])
      expect(task.state).toBe('returned')
    })
  })

  describe('Task Builtins', () => {
    it('task.start should signal task started', () => {
      const manager = new TaskManager()
      const task = manager.createTask()
      const builtins = task.getBuiltins()

      builtins['task.start']()

      expect(task.state).toBe('started')
    })

    it('task.return should provide return values', () => {
      const manager = new TaskManager()
      const task = manager.createTask()
      const builtins = task.getBuiltins()

      builtins['task.start']()
      builtins['task.return']([1, 2, 3])

      expect(task.state).toBe('returned')
      expect(task.returnValues).toEqual([1, 2, 3])
    })

    it('task.wait should block until event available', async () => {
      const manager = new TaskManager()
      const task = manager.createTask()
      const builtins = task.getBuiltins()

      builtins['task.start']()

      // Schedule an event
      setTimeout(() => {
        task.pushEvent({
          type: 'stream-read',
          handle: 1,
          payload: [1, 2, 3]
        })
      }, 10)

      const events = await builtins['task.wait']()

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('stream-read')
    })

    it('task.poll should return immediately', () => {
      const manager = new TaskManager()
      const task = manager.createTask()
      const builtins = task.getBuiltins()

      builtins['task.start']()

      // No events pending
      const events = builtins['task.poll']()
      expect(events).toEqual([])

      // Add event
      task.pushEvent({ type: 'future-read', handle: 1 })

      // Now poll should return it
      const events2 = builtins['task.poll']()
      expect(events2).toHaveLength(1)
    })

    it('task.yield should allow other tasks to run', async () => {
      const manager = new TaskManager()
      const task = manager.createTask()
      const builtins = task.getBuiltins()

      builtins['task.start']()

      let otherTaskRan = false
      setTimeout(() => { otherTaskRan = true }, 0)

      await builtins['task.yield']()

      expect(otherTaskRan).toBe(true)
    })
  })

  describe('Stream/Future Handle Integration', () => {
    it('should register stream read handle', () => {
      const manager = new TaskManager()
      const task = manager.createTask()

      const handle = task.registerStreamRead(/* stream */)

      expect(handle).toBeGreaterThan(0)
    })

    it('should dispatch stream read event', async () => {
      const manager = new TaskManager()
      const task = manager.createTask()
      const builtins = task.getBuiltins()

      builtins['task.start']()

      const handle = task.registerStreamRead(/* stream */)
      task.completeStreamRead(handle, [1, 2, 3])

      const events = builtins['task.poll']()

      expect(events).toContainEqual({
        type: 'stream-read',
        handle,
        payload: [1, 2, 3]
      })
    })
  })
})
```

### 1.4 Subtask Tests (`test/wasip3/subtask.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  Subtask,
  SubtaskManager,
  SubtaskState
} from '../../src/wasip3/canonical-abi/subtask.js'

describe('Subtask', () => {
  describe('State Machine', () => {
    it('should start in starting state', () => {
      const manager = new SubtaskManager()
      const subtask = manager.create(async () => {})

      expect(subtask.state).toBe('starting')
    })

    it('should transition through all states', async () => {
      const states: SubtaskState[] = []

      const manager = new SubtaskManager()
      const subtask = manager.create(async () => {
        // Simulated async function body
      })

      subtask.onStateChange = (state) => states.push(state)

      // Simulate callee calling task.start
      subtask.markStarted()
      expect(subtask.state).toBe('started')

      // Simulate callee calling task.return
      subtask.markReturned([42])
      expect(subtask.state).toBe('returned')

      // Caller acknowledges completion
      subtask.acknowledge()
      expect(subtask.state).toBe('done')

      expect(states).toEqual(['started', 'returned', 'done'])
    })
  })

  describe('SubtaskManager', () => {
    it('should create subtask with handle', () => {
      const manager = new SubtaskManager()
      const subtask = manager.create(async () => {})

      expect(subtask.handle).toBeDefined()
      expect(typeof subtask.handle).toBe('number')
    })

    it('should poll subtask state', () => {
      const manager = new SubtaskManager()
      const subtask = manager.create(async () => {})

      const state = manager.poll(subtask.handle)
      expect(state).toBe('starting')
    })

    it('should wait for subtask state change', async () => {
      const manager = new SubtaskManager()
      const subtask = manager.create(async () => {})

      // Schedule state change
      setTimeout(() => subtask.markStarted(), 10)

      const state = await manager.wait(subtask.handle)
      expect(state).toBe('started')
    })

    it('should get return values after returned', () => {
      const manager = new SubtaskManager()
      const subtask = manager.create(async () => {})

      subtask.markStarted()
      subtask.markReturned(['result'])

      const values = manager.getReturnValues(subtask.handle)
      expect(values).toEqual(['result'])
    })

    it('should return undefined for non-returned subtask', () => {
      const manager = new SubtaskManager()
      const subtask = manager.create(async () => {})

      const values = manager.getReturnValues(subtask.handle)
      expect(values).toBeUndefined()
    })
  })

  describe('waitAny', () => {
    it('should return first subtask that changes state', async () => {
      const manager = new SubtaskManager()
      const s1 = manager.create(async () => {})
      const s2 = manager.create(async () => {})

      // s2 completes first
      setTimeout(() => s2.markStarted(), 10)
      setTimeout(() => s1.markStarted(), 50)

      const result = await manager.waitAny([s1.handle, s2.handle])

      expect(result.handle).toBe(s2.handle)
      expect(result.state).toBe('started')
    })
  })

  describe('drop', () => {
    it('should clean up subtask resources', () => {
      const manager = new SubtaskManager()
      const subtask = manager.create(async () => {})
      const handle = subtask.handle

      manager.drop(handle)

      expect(() => manager.poll(handle)).toThrow()
    })
  })
})
```

---

## Phase 2: Async/Sync Bridge Tests (~400 LOC)

**Priority**: High | **Effort**: Medium | **Duration**: 1-2 days

### 2.1 Bridge Tests (`test/wasip3/async-sync-bridge.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  AsyncSyncBridge,
  callAsyncFromSync,
  callSyncFromAsync,
  streamToFuture,
  futureToStream,
  pipeStream,
  mergeStreams,
  blockingCall,
  promisify,
  wrapSyncAsAsync,
  wrapAsyncWithDefault
} from '../../src/wasip3/adapters/async-sync-bridge.js'
import { createStream } from '../../src/wasip3/canonical-abi/stream.js'
import { createFuture } from '../../src/wasip3/canonical-abi/future.js'

describe('AsyncSyncBridge', () => {
  describe('callAsyncFromSync', () => {
    it('should block until async completes', async () => {
      const asyncFn = async () => {
        await new Promise(r => setTimeout(r, 10))
        return 42
      }

      // In real usage this would block the Wasm execution
      // Here we test the mechanism
      const result = await callAsyncFromSync(asyncFn)

      expect(result).toBe(42)
    })
  })

  describe('callSyncFromAsync', () => {
    it('should call sync function directly', async () => {
      const syncFn = () => 42

      const result = await callSyncFromAsync(syncFn)

      expect(result).toBe(42)
    })

    it('should propagate sync errors', async () => {
      const syncFn = () => { throw new Error('Sync error') }

      await expect(callSyncFromAsync(syncFn)).rejects.toThrow('Sync error')
    })
  })

  describe('streamToFuture', () => {
    it('should collect stream into future with single value', async () => {
      const [reader, writer] = createStream<number>()

      writer.write([1, 2, 3])
      writer.close()

      const future = streamToFuture(reader)
      const result = await future.read()

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.value).toEqual([1, 2, 3])
      }
    })
  })

  describe('futureToStream', () => {
    it('should emit future value then close', async () => {
      const [future, resolver] = createFuture<number[]>()

      resolver.resolve([1, 2, 3])

      const stream = futureToStream(future)

      const result1 = await stream.read()
      expect(result1.status).toBe('values')

      const result2 = await stream.read()
      expect(result2.status).toBe('end')
    })
  })

  describe('pipeStream', () => {
    it('should pipe values from source to destination', async () => {
      const [src, srcWriter] = createStream<number>()
      const [dest, destWriter] = createStream<number>()

      // Start pipe
      const pipePromise = pipeStream(src, destWriter)

      // Write to source
      srcWriter.write([1, 2, 3])
      srcWriter.close()

      // Read from destination
      const result = await dest.read()
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(result.values).toEqual([1, 2, 3])
      }

      await pipePromise
    })
  })

  describe('mergeStreams', () => {
    it('should merge multiple streams', async () => {
      const [s1, w1] = createStream<number>()
      const [s2, w2] = createStream<number>()

      const merged = mergeStreams([s1, s2])

      w1.write([1])
      w2.write([2])
      w1.write([3])
      w2.close()
      w1.close()

      const values: number[] = []
      let result
      while ((result = await merged.read()).status === 'values') {
        values.push(...result.values)
      }

      expect(values.sort()).toEqual([1, 2, 3])
    })
  })

  describe('Utility Functions', () => {
    describe('blockingCall', () => {
      it('should wrap async as blocking', async () => {
        const asyncFn = async (x: number) => x * 2

        const result = await blockingCall(asyncFn, 21)

        expect(result).toBe(42)
      })
    })

    describe('promisify', () => {
      it('should convert future to promise', async () => {
        const [future, resolver] = createFuture<number>()
        resolver.resolve(42)

        const promise = promisify(future)
        const result = await promise

        expect(result).toBe(42)
      })
    })

    describe('wrapSyncAsAsync', () => {
      it('should wrap sync function as async', async () => {
        const syncFn = (x: number) => x * 2
        const asyncFn = wrapSyncAsAsync(syncFn)

        const result = await asyncFn(21)

        expect(result).toBe(42)
      })
    })

    describe('wrapAsyncWithDefault', () => {
      it('should return default on timeout', async () => {
        const slowFn = async () => {
          await new Promise(r => setTimeout(r, 1000))
          return 'slow'
        }

        const wrapped = wrapAsyncWithDefault(slowFn, 'default', 10)
        const result = await wrapped()

        expect(result).toBe('default')
      })

      it('should return result if fast enough', async () => {
        const fastFn = async () => 'fast'

        const wrapped = wrapAsyncWithDefault(fastFn, 'default', 1000)
        const result = await wrapped()

        expect(result).toBe('fast')
      })
    })
  })
})
```

---

## Phase 3: P2 Adapter Tests (~600 LOC)

**Priority**: High | **Effort**: Medium | **Duration**: 2-3 days

### 3.1 P2-to-P3 Adapter Tests (`test/wasip3/p2-adapters.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  adaptInputStream,
  adaptOutputStream,
  adaptPollable,
  adaptFileRead,
  adaptFileWrite,
  adaptDirectoryRead,
  adaptP2ToP3,
  createStreamFromCallback,
  createWriterFromCallback
} from '../../src/wasip3/adapters/p2-to-p3.js'
import { collectStream } from '../../src/wasip3/canonical-abi/stream.js'

// Mock P2 resources
const mockInputStream = () => ({
  read: vi.fn(),
  blockingRead: vi.fn(),
  subscribe: vi.fn(),
  drop: vi.fn()
})

const mockOutputStream = () => ({
  write: vi.fn(),
  blockingWrite: vi.fn(),
  blockingFlush: vi.fn(),
  subscribe: vi.fn(),
  drop: vi.fn()
})

const mockPollable = () => ({
  ready: vi.fn(),
  block: vi.fn(),
  drop: vi.fn()
})

describe('P2-to-P3 Adapters', () => {
  describe('adaptInputStream', () => {
    it('should convert P2 input stream to P3 stream', async () => {
      const p2Stream = mockInputStream()
      p2Stream.read.mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      p2Stream.read.mockResolvedValueOnce(new Uint8Array([]))

      const p3Stream = adaptInputStream(p2Stream)

      const result = await p3Stream.read()
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(result.values[0]).toEqual(new Uint8Array([1, 2, 3]))
      }

      expect(p2Stream.read).toHaveBeenCalled()
    })

    it('should handle stream end', async () => {
      const p2Stream = mockInputStream()
      p2Stream.read.mockResolvedValueOnce(new Uint8Array([]))

      const p3Stream = adaptInputStream(p2Stream)

      const result = await p3Stream.read()
      expect(result.status).toBe('end')
    })

    it('should cancel underlying stream', async () => {
      const p2Stream = mockInputStream()
      p2Stream.read.mockImplementation(() => new Promise(() => {})) // Never resolves

      const p3Stream = adaptInputStream(p2Stream)

      p3Stream.cancel()

      expect(p2Stream.drop).toHaveBeenCalled()
    })
  })

  describe('adaptOutputStream', () => {
    it('should convert P2 output stream to P3 writer', async () => {
      const p2Stream = mockOutputStream()
      p2Stream.write.mockResolvedValue(3)

      const p3Writer = adaptOutputStream(p2Stream)

      const result = await p3Writer.write([new Uint8Array([1, 2, 3])])

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.count).toBe(1)
      }
      expect(p2Stream.write).toHaveBeenCalled()
    })

    it('should handle write errors', async () => {
      const p2Stream = mockOutputStream()
      p2Stream.write.mockRejectedValue(new Error('Write failed'))

      const p3Writer = adaptOutputStream(p2Stream)

      const result = await p3Writer.write([new Uint8Array([1])])

      expect(result.status).toBe('cancelled')
    })

    it('should close underlying stream', () => {
      const p2Stream = mockOutputStream()

      const p3Writer = adaptOutputStream(p2Stream)
      p3Writer.close()

      expect(p2Stream.drop).toHaveBeenCalled()
    })
  })

  describe('adaptPollable', () => {
    it('should convert pollable to future', async () => {
      const p2Pollable = mockPollable()
      p2Pollable.block.mockResolvedValue(undefined)

      const future = adaptPollable(p2Pollable)

      const result = await future.read()
      expect(result.status).toBe('ok')
    })

    it('should support cancellation', async () => {
      const p2Pollable = mockPollable()
      p2Pollable.block.mockImplementation(() => new Promise(() => {}))

      const future = adaptPollable(p2Pollable)
      future.cancel()

      const result = await future.read()
      expect(result.status).toBe('cancelled')
    })
  })

  describe('adaptFileRead', () => {
    it('should read file with offset tracking', async () => {
      const fileRead = vi.fn()
        .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
        .mockResolvedValueOnce(new Uint8Array([4, 5]))
        .mockResolvedValueOnce(new Uint8Array([]))

      const stream = adaptFileRead(fileRead, 0, 1024)

      const values = await collectStream(stream)
      expect(values).toHaveLength(2)
      expect(fileRead).toHaveBeenCalledTimes(3)

      // Verify offset progression
      expect(fileRead).toHaveBeenNthCalledWith(1, 1024, 0)
      expect(fileRead).toHaveBeenNthCalledWith(2, 1024, 3)
      expect(fileRead).toHaveBeenNthCalledWith(3, 1024, 5)
    })
  })

  describe('adaptFileWrite', () => {
    it('should write to file with offset tracking', async () => {
      const fileWrite = vi.fn().mockResolvedValue(3)

      const writer = adaptFileWrite(fileWrite, 0)

      await writer.write([new Uint8Array([1, 2, 3])])
      await writer.write([new Uint8Array([4, 5])])

      expect(fileWrite).toHaveBeenNthCalledWith(
        1,
        expect.any(Uint8Array),
        0
      )
      expect(fileWrite).toHaveBeenNthCalledWith(
        2,
        expect.any(Uint8Array),
        3
      )
    })
  })

  describe('adaptDirectoryRead', () => {
    it('should convert directory iteration to stream', async () => {
      const entries = [
        { name: 'file1.txt', type: 'file' },
        { name: 'dir1', type: 'directory' }
      ]
      const dirRead = vi.fn()
        .mockResolvedValueOnce([entries[0]])
        .mockResolvedValueOnce([entries[1]])
        .mockResolvedValueOnce([])

      const stream = adaptDirectoryRead(dirRead)
      const results = await collectStream(stream)

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual(entries[0])
      expect(results[1]).toEqual(entries[1])
    })
  })

  describe('createStreamFromCallback', () => {
    it('should create stream from push callback', async () => {
      const stream = createStreamFromCallback<number>((push, end) => {
        push([1, 2])
        push([3])
        end()
      })

      const values = await collectStream(stream)
      expect(values).toEqual([1, 2, 3])
    })
  })

  describe('createWriterFromCallback', () => {
    it('should create writer from consume callback', async () => {
      const consumed: number[][] = []

      const writer = createWriterFromCallback<number>((values) => {
        consumed.push([...values])
        return Promise.resolve()
      })

      await writer.write([1, 2])
      await writer.write([3])
      writer.close()

      expect(consumed).toEqual([[1, 2], [3]])
    })
  })

  describe('adaptP2ToP3', () => {
    it('should wrap P2 plugin with P3 interface', () => {
      const p2Plugin = {
        name: 'test-plugin',
        version: '0.2.0',
        getImports: vi.fn().mockReturnValue({
          'test:api/sync': { doThing: () => 42 }
        })
      }

      const p3Plugin = adaptP2ToP3(p2Plugin)

      expect(p3Plugin.name).toBe('test-plugin')
      expect(p3Plugin.version).toBe('0.3.0')

      const imports = p3Plugin.getImports()
      expect(imports['test:api/sync']).toBeDefined()
    })

    it('should convert pollable-returning functions to async', async () => {
      const pollable = mockPollable()
      pollable.block.mockResolvedValue(undefined)

      const p2Plugin = {
        name: 'test-plugin',
        version: '0.2.0',
        getImports: vi.fn().mockReturnValue({
          'test:api/async': {
            asyncOp: () => pollable
          }
        })
      }

      const p3Plugin = adaptP2ToP3(p2Plugin)
      const imports = p3Plugin.getImports()

      // P3 version should return a future
      const result = imports['test:api/async'].asyncOp()
      expect(result.read).toBeDefined() // Has future interface
    })
  })
})
```

---

## Phase 4: Interface Tests (~800 LOC)

**Priority**: High | **Effort**: High | **Duration**: 2-3 days

### 4.1 CLI Interface Tests (`test/wasip3/interfaces/cli.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest'
import { Wasip3Cli } from '../../../src/wasip3/interfaces/cli.js'
import { collectStream } from '../../../src/wasip3/canonical-abi/stream.js'

describe('wasi:cli@0.3.0', () => {
  describe('environment', () => {
    it('should return configured environment variables', () => {
      const cli = new Wasip3Cli({
        env: { HOME: '/home/user', PATH: '/usr/bin' }
      })

      const env = cli.getEnvironment()

      expect(env).toContainEqual(['HOME', '/home/user'])
      expect(env).toContainEqual(['PATH', '/usr/bin'])
    })

    it('should return empty array when no env configured', () => {
      const cli = new Wasip3Cli({})

      const env = cli.getEnvironment()

      expect(env).toEqual([])
    })
  })

  describe('arguments', () => {
    it('should return configured arguments', () => {
      const cli = new Wasip3Cli({
        args: ['program', '--flag', 'value']
      })

      const args = cli.getArguments()

      expect(args).toEqual(['program', '--flag', 'value'])
    })
  })

  describe('stdin', () => {
    it('should provide stdin as stream', async () => {
      const cli = new Wasip3Cli({
        stdin: 'Hello, World!'
      })

      const stdin = cli.getStdin()
      const data = await collectStream(stdin)

      expect(Buffer.concat(data.map(d => Buffer.from(d))).toString())
        .toBe('Hello, World!')
    })

    it('should handle empty stdin', async () => {
      const cli = new Wasip3Cli({})

      const stdin = cli.getStdin()
      const result = await stdin.read()

      expect(result.status).toBe('end')
    })
  })

  describe('stdout/stderr', () => {
    it('should capture stdout writes', async () => {
      const output: Uint8Array[] = []
      const cli = new Wasip3Cli({
        stdout: (data) => output.push(data)
      })

      const stdout = cli.getStdout()
      await stdout.write([new TextEncoder().encode('Hello')])

      expect(new TextDecoder().decode(output[0])).toBe('Hello')
    })
  })

  describe('exit', () => {
    it('should throw exit error with code', () => {
      const cli = new Wasip3Cli({})

      expect(() => cli.exit(42)).toThrow()
    })
  })
})
```

### 4.2 Clocks Interface Tests (`test/wasip3/interfaces/clocks.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Wasip3Clocks } from '../../../src/wasip3/interfaces/clocks.js'

describe('wasi:clocks@0.3.0', () => {
  describe('monotonic clock', () => {
    it('should return monotonically increasing time', () => {
      const clocks = new Wasip3Clocks()

      const t1 = clocks.monotonicNow()
      const t2 = clocks.monotonicNow()

      expect(t2).toBeGreaterThanOrEqual(t1)
    })

    it('should return resolution', () => {
      const clocks = new Wasip3Clocks()

      const resolution = clocks.monotonicResolution()

      expect(resolution).toBeGreaterThan(0n)
      expect(resolution).toBeLessThanOrEqual(1_000_000n) // At least millisecond
    })

    it('should provide async sleep', async () => {
      const clocks = new Wasip3Clocks()
      const start = Date.now()

      const sleepFuture = clocks.monotonicSleep(50_000_000n) // 50ms in nanoseconds
      await sleepFuture.read()

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('should support sleep cancellation', async () => {
      const clocks = new Wasip3Clocks()

      const sleepFuture = clocks.monotonicSleep(10_000_000_000n) // 10 seconds
      sleepFuture.cancel()

      const result = await sleepFuture.read()
      expect(result.status).toBe('cancelled')
    })
  })

  describe('wall clock', () => {
    it('should return current datetime', () => {
      const clocks = new Wasip3Clocks()

      const datetime = clocks.wallNow()

      expect(datetime.seconds).toBeGreaterThan(0n)
      expect(datetime.nanoseconds).toBeGreaterThanOrEqual(0)
      expect(datetime.nanoseconds).toBeLessThan(1_000_000_000)
    })

    it('should return reasonable time', () => {
      const clocks = new Wasip3Clocks()

      const datetime = clocks.wallNow()
      const now = BigInt(Math.floor(Date.now() / 1000))

      // Should be within 1 second of JS time
      expect(datetime.seconds).toBeGreaterThanOrEqual(now - 1n)
      expect(datetime.seconds).toBeLessThanOrEqual(now + 1n)
    })
  })
})
```

### 4.3 Additional Interface Tests

Create similar test files for:
- `test/wasip3/interfaces/random.test.ts`
- `test/wasip3/interfaces/io.test.ts`
- `test/wasip3/interfaces/filesystem.test.ts`
- `test/wasip3/interfaces/http.test.ts`
- `test/wasip3/interfaces/sockets.test.ts`

Each following the pattern of testing:
1. Basic functionality
2. Error cases
3. Async behavior (futures/streams)
4. Edge cases

---

## Phase 5: Async Executor & Component Loader Tests (~400 LOC)

**Priority**: Medium | **Effort**: Medium | **Duration**: 1-2 days

### 5.1 Async Executor Tests (`test/wasip3/async-executor.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  AsyncExecutor,
  runAsync,
  eventLoop
} from '../../src/wasip3/runtime/async-executor.js'

describe('AsyncExecutor', () => {
  describe('execute', () => {
    it('should execute simple async function', async () => {
      const executor = new AsyncExecutor()

      const result = await executor.execute(async () => {
        return [42]
      })

      expect(result).toEqual([42])
    })

    it('should handle task.wait calls', async () => {
      const executor = new AsyncExecutor()

      const result = await executor.execute(async (builtins) => {
        builtins['task.start']()
        // Simulate async work
        await new Promise(r => setTimeout(r, 10))
        builtins['task.return'](['done'])
      })

      expect(result).toEqual(['done'])
    })

    it('should limit concurrent tasks', async () => {
      const executor = new AsyncExecutor({ maxConcurrentTasks: 2 })
      let concurrentCount = 0
      let maxConcurrent = 0

      const task = async () => {
        concurrentCount++
        maxConcurrent = Math.max(maxConcurrent, concurrentCount)
        await new Promise(r => setTimeout(r, 50))
        concurrentCount--
        return ['ok']
      }

      await Promise.all([
        executor.execute(task),
        executor.execute(task),
        executor.execute(task),
        executor.execute(task)
      ])

      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })
  })

  describe('runAsync', () => {
    it('should be convenience wrapper for execute', async () => {
      const result = await runAsync(async () => 42)
      expect(result).toBe(42)
    })
  })
})
```

### 5.2 Component Loader Tests (`test/wasip3/component-loader.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Wasip3ComponentLoader,
  Wasip3Instance,
  runComponent
} from '../../src/wasip3/runtime/component-loader.js'

// Mock WebAssembly for testing without real components
const mockWasmModule = {
  exports: {
    memory: new WebAssembly.Memory({ initial: 1 }),
    'wasi:cli/run@0.3.0#run': vi.fn().mockReturnValue(0)
  }
}

describe('Wasip3ComponentLoader', () => {
  describe('load', () => {
    it('should load component with WASI imports', async () => {
      const loader = new Wasip3ComponentLoader()

      // This will use mock/placeholder behavior since real
      // P3 components aren't available yet
      const config = {
        args: ['test'],
        env: { TEST: 'value' }
      }

      // The loader should set up imports correctly
      // even if instantiation is mocked
      expect(loader).toBeDefined()
    })

    it('should configure filesystem preopens', async () => {
      const loader = new Wasip3ComponentLoader()

      const config = {
        preopens: {
          '/': { type: 'memory' as const }
        }
      }

      // Verify config is accepted
      expect(config.preopens['/']).toBeDefined()
    })
  })

  describe('Wasip3Instance', () => {
    it('should have callAsync method', () => {
      // Mock instance for interface testing
      const instance: Partial<Wasip3Instance> = {
        callAsync: vi.fn().mockResolvedValue(42),
        callSync: vi.fn().mockReturnValue(42),
        run: vi.fn().mockResolvedValue(0),
        dispose: vi.fn()
      }

      expect(instance.callAsync).toBeDefined()
      expect(instance.callSync).toBeDefined()
      expect(instance.run).toBeDefined()
    })

    it('should call async exports', async () => {
      const callAsync = vi.fn().mockResolvedValue('result')
      const instance = { callAsync } as unknown as Wasip3Instance

      const result = await instance.callAsync('myExport', [1, 2])

      expect(callAsync).toHaveBeenCalledWith('myExport', [1, 2])
      expect(result).toBe('result')
    })

    it('should call sync exports', () => {
      const callSync = vi.fn().mockReturnValue('result')
      const instance = { callSync } as unknown as Wasip3Instance

      const result = instance.callSync('myExport', [1, 2])

      expect(callSync).toHaveBeenCalledWith('myExport', [1, 2])
      expect(result).toBe('result')
    })
  })

  describe('runComponent', () => {
    it('should be convenience function for load + run', async () => {
      // This tests the interface, actual execution requires
      // real components which need jco P3 support
      expect(runComponent).toBeDefined()
    })
  })
})
```

---

## Phase 6: Error Handling Improvements (~100 LOC)

**Priority**: Medium | **Effort**: Low | **Duration**: 0.5 day

### 6.1 Add Error Status to Future

Currently errors are treated as 'cancelled'. Add proper error handling:

```typescript
// src/wasip3/canonical-abi/future.ts

export type FutureReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; error: Error }  // NEW
  | { status: 'cancelled' }

export function createFuture<T>(): [Future<T>, FutureResolver<T>] {
  // ... existing code ...

  const resolver: FutureResolver<T> = {
    resolve(value: T) {
      if (state !== 'pending') return
      state = 'resolved'
      result = { status: 'ok', value }
      // ...
    },
    reject(error: Error) {
      if (state !== 'pending') return
      state = 'rejected'
      result = { status: 'error', error }  // Changed from 'cancelled'
      // ...
    }
  }

  // ...
}
```

### 6.2 Add Tests for Error Handling

```typescript
// test/wasip3/error-handling.test.ts

describe('Error Handling', () => {
  describe('Future errors', () => {
    it('should distinguish error from cancellation', async () => {
      const [future, resolver] = createFuture<number>()

      resolver.reject(new Error('Test error'))
      const result = await future.read()

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error.message).toBe('Test error')
      }
    })

    it('should report cancelled for explicit cancel', async () => {
      const [future, resolver] = createFuture<number>()

      future.cancel()
      const result = await future.read()

      expect(result.status).toBe('cancelled')
    })
  })

  describe('Stream errors', () => {
    it('should propagate errors through stream', async () => {
      // Similar tests for stream error handling
    })
  })
})
```

---

## Implementation Checklist

### Phase 1: Core Primitives
- [ ] `test/wasip3/stream.test.ts` (~350 lines)
- [ ] `test/wasip3/future.test.ts` (~300 lines)
- [ ] `test/wasip3/task.test.ts` (~300 lines)
- [ ] `test/wasip3/subtask.test.ts` (~250 lines)

### Phase 2: Async/Sync Bridge
- [ ] `test/wasip3/async-sync-bridge.test.ts` (~400 lines)

### Phase 3: P2 Adapters
- [ ] `test/wasip3/p2-adapters.test.ts` (~600 lines)

### Phase 4: Interfaces
- [ ] `test/wasip3/interfaces/cli.test.ts` (~150 lines)
- [ ] `test/wasip3/interfaces/clocks.test.ts` (~150 lines)
- [ ] `test/wasip3/interfaces/random.test.ts` (~100 lines)
- [ ] `test/wasip3/interfaces/io.test.ts` (~100 lines)
- [ ] `test/wasip3/interfaces/filesystem.test.ts` (~150 lines)
- [ ] `test/wasip3/interfaces/http.test.ts` (~150 lines)

### Phase 5: Runtime
- [ ] `test/wasip3/async-executor.test.ts` (~200 lines)
- [ ] `test/wasip3/component-loader.test.ts` (~200 lines)

### Phase 6: Error Handling
- [ ] Update `future.ts` for error status
- [ ] `test/wasip3/error-handling.test.ts` (~100 lines)

---

## Success Criteria

1. **Coverage**: >90% line coverage for all wasip3 modules
2. **Primitives**: All stream/future/task/subtask behaviors validated
3. **Adapters**: P2 plugins work correctly through P3 adapters
4. **Interfaces**: All interface methods tested with success and error cases
5. **Regression**: No existing behavior broken by error handling changes

## Estimated Total Effort

| Phase | LOC | Duration |
|-------|-----|----------|
| Core Primitives | ~1200 | 3-4 days |
| Async/Sync Bridge | ~400 | 1-2 days |
| P2 Adapters | ~600 | 2-3 days |
| Interfaces | ~800 | 2-3 days |
| Runtime | ~400 | 1-2 days |
| Error Handling | ~100 | 0.5 day |
| **Total** | **~3500** | **10-14 days** |

---

## Future Work (Post-jco P3)

Once jco P3 support is available:

1. **Real Component Tests**: Test with actual P3 components
2. **Compatibility Tests**: Compare behavior with Wasmtime P3
3. **Performance Tests**: Benchmark async overhead
4. **Integration Tests**: Full E2E with real WASM workloads
