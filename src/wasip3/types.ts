/**
 * WASI Preview 3 type definitions
 *
 * These types represent the built-in stream<T> and future<T> types
 * introduced in the async Component Model for P3.
 *
 * @packageDocumentation
 */

// =============================================================================
// Stream Types
// =============================================================================

/**
 * Result of reading from a stream.
 */
export type StreamReadResult<T> =
  | { status: 'values'; values: T[] }
  | { status: 'end' }
  | { status: 'cancelled' }

/**
 * Result of writing to a stream.
 */
export type StreamWriteResult =
  | { status: 'ok'; count: number }
  | { status: 'closed' }
  | { status: 'cancelled' }

/**
 * Built-in stream type for async sequences of values.
 *
 * Streams are first-class types in P3's Component Model, replacing
 * the resource-based wasi:io/streams from P2.
 *
 * @typeParam T - The type of values in the stream
 */
export interface Stream<T> {
  /**
   * Read values from the stream.
   * Returns when at least one value is available or stream closes.
   */
  read(): Promise<StreamReadResult<T>>

  /**
   * Close the readable end (signal no more reads).
   */
  close(): void

  /**
   * Cancel the stream (abort pending operations).
   */
  cancel(): void
}

/**
 * Writer end of a stream.
 *
 * @typeParam T - The type of values in the stream
 */
export interface StreamWriter<T> {
  /**
   * Write values to the stream.
   * Returns when values are accepted (may buffer).
   */
  write(values: T[]): Promise<StreamWriteResult>

  /**
   * Close the stream (no more writes).
   */
  close(): void

  /**
   * Cancel the stream (abort pending operations).
   */
  cancel(): void
}

// =============================================================================
// Future Types
// =============================================================================

/**
 * Result of reading from a future.
 */
export type FutureReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'cancelled' }

/**
 * Built-in future type for single async value.
 *
 * Futures are first-class types in P3's Component Model, similar
 * to Promises but with cancellation support.
 *
 * @typeParam T - The type of the future's value
 */
export interface Future<T> {
  /**
   * Read the future's value.
   * Returns when value is available.
   */
  read(): Promise<FutureReadResult<T>>

  /**
   * Cancel the future.
   */
  cancel(): void
}

/**
 * Resolver for a future.
 *
 * @typeParam T - The type of value to resolve
 */
export interface FutureResolver<T> {
  /**
   * Resolve the future with a value.
   */
  resolve(value: T): void

  /**
   * Reject the future with an error.
   */
  reject(error: Error): void
}

// =============================================================================
// Task Types
// =============================================================================

/**
 * Event types returned from task.wait() and task.poll().
 */
export type TaskEventType =
  | 'stream-read'
  | 'stream-write'
  | 'future-read'
  | 'subtask-done'

/**
 * Event describing async progress.
 */
export interface TaskEvent {
  type: TaskEventType
  handle: number
  payload?: unknown
}

/**
 * Subtask states in the async canonical ABI.
 */
export type SubtaskState =
  | 'starting' // Call initiated, callee not yet started
  | 'started' // Callee called task.start
  | 'returned' // Callee called task.return
  | 'done' // Caller acknowledged completion

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error context resource from wasi:io@0.3.0.
 *
 * Provides richer error information across component boundaries.
 */
export interface ErrorContext {
  /**
   * Get a human-readable debug message.
   */
  getDebugMessage(): string
}

/**
 * Standard WASI error codes (same as P2).
 */
export const enum WasiErrorCode {
  SUCCESS = 0,
  ACCESS = 1,
  WOULD_BLOCK = 2,
  ALREADY = 3,
  BAD_DESCRIPTOR = 4,
  BUSY = 5,
  DEADLOCK = 6,
  QUOTA = 7,
  EXIST = 8,
  FILE_TOO_LARGE = 9,
  ILLEGAL_BYTE_SEQUENCE = 10,
  IN_PROGRESS = 11,
  INTERRUPTED = 12,
  INVALID = 13,
  IO = 14,
  IS_DIRECTORY = 15,
  LOOP = 16,
  TOO_MANY_LINKS = 17,
  MESSAGE_SIZE = 18,
  NAME_TOO_LONG = 19,
  NO_DEVICE = 20,
  NO_ENTRY = 21,
  NO_LOCK = 22,
  INSUFFICIENT_MEMORY = 23,
  INSUFFICIENT_SPACE = 24,
  NOT_DIRECTORY = 25,
  NOT_EMPTY = 26,
  NOT_RECOVERABLE = 27,
  UNSUPPORTED = 28,
  NO_TTY = 29,
  NO_SUCH_DEVICE = 30,
  OVERFLOW = 31,
  NOT_PERMITTED = 32,
  PIPE = 33,
  READ_ONLY = 34,
  INVALID_SEEK = 35,
  TEXT_FILE_BUSY = 36,
  CROSS_DEVICE = 37,
}

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle for a stream resource.
 */
export type StreamHandle = number

/**
 * Handle for a future resource.
 */
export type FutureHandle = number

/**
 * Handle for a subtask.
 */
export type SubtaskHandleType = number

// =============================================================================
// Callback Types
// =============================================================================

/**
 * Callback invoked when a stream read completes.
 */
export type StreamReadCallback<T> = (result: StreamReadResult<T>) => void

/**
 * Callback invoked when a stream write completes.
 */
export type StreamWriteCallback = (result: StreamWriteResult) => void

/**
 * Callback invoked when a future read completes.
 */
export type FutureReadCallback<T> = (result: FutureReadResult<T>) => void
