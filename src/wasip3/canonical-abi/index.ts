/**
 * WASI Preview 3 Canonical ABI async support
 *
 * This module implements the async extensions to the Component Model
 * canonical ABI, providing:
 *
 * - `stream<T>` - Async sequences of values
 * - `future<T>` - Single async values with cancellation
 * - Task management (start, return, wait, poll, yield)
 * - Subtask tracking for async calls
 *
 * @packageDocumentation
 */

// Stream exports
export {
  createStream,
  streamFromAsyncIterable,
  streamFromReadable,
  writerFromWritable,
  collectStream,
} from './stream.js'

// Future exports
export {
  createFuture,
  futureFromPromise,
  delay,
  resolvedFuture,
  cancelledFuture,
  raceFutures,
  allFutures,
} from './future.js'

// Task exports
export {
  Task,
  createTaskBuiltins,
  type TaskBuiltins,
  type StreamReadHandle,
  type StreamWriteHandle,
  type FutureReadHandle,
} from './task.js'

// Subtask exports
export {
  SubtaskManager,
  type SubtaskHandle,
  type Subtask,
} from './subtask.js'

// Re-export types
export type {
  Stream,
  StreamWriter,
  StreamReadResult,
  StreamWriteResult,
  Future,
  FutureReadResult,
  FutureResolver,
  TaskEvent,
  TaskEventType,
  SubtaskState,
} from '../types.js'
