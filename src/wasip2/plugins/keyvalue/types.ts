/**
 * wasi:keyvalue types
 *
 * Types for the key-value store interface including errors,
 * bucket handles, and operation results.
 */

import { type Result, ok, err } from '../../../shared/result.js'

/**
 * Key-value error variants
 */
export type KeyValueError =
  | { tag: 'no-such-store' }
  | { tag: 'access-denied' }
  | { tag: 'other'; val: string }

/**
 * Create a no-such-store error
 */
export function noSuchStore(): KeyValueError {
  return { tag: 'no-such-store' }
}

/**
 * Create an access-denied error
 */
export function accessDenied(): KeyValueError {
  return { tag: 'access-denied' }
}

/**
 * Create an other error
 */
export function otherError(message: string): KeyValueError {
  return { tag: 'other', val: message }
}

/**
 * Result type for key-value operations
 */
export type KeyValueResult<T> = Result<T, KeyValueError>

/**
 * Create a successful result. Thin wrapper over the shared {@link ok}.
 */
export function kvOk<T>(value: T): KeyValueResult<T> {
  return ok(value)
}

/**
 * Create an error result. Thin wrapper over the shared {@link err}.
 */
export function kvErr<T>(error: KeyValueError): KeyValueResult<T> {
  return err(error)
}

/**
 * Response from list-keys operation
 */
export interface KeyResponse {
  /**
   * List of keys
   */
  keys: string[]

  /**
   * Cursor for pagination, undefined if no more keys
   */
  cursor?: string
}

/**
 * Bucket store interface
 *
 * Represents a key-value bucket that can be opened by identifier.
 */
export interface Bucket {
  /**
   * Get the value for a key
   * @returns The value bytes or undefined if key doesn't exist
   */
  get(key: string): KeyValueResult<Uint8Array | undefined>

  /**
   * Set a key-value pair
   */
  set(key: string, value: Uint8Array): KeyValueResult<void>

  /**
   * Delete a key
   */
  delete(key: string): KeyValueResult<void>

  /**
   * Check if a key exists
   */
  exists(key: string): KeyValueResult<boolean>

  /**
   * List keys with optional pagination
   * @param cursor Pagination cursor from previous call
   */
  listKeys(cursor?: string): KeyValueResult<KeyResponse>
}

/**
 * Atomic operations on a bucket
 */
export interface AtomicBucket extends Bucket {
  /**
   * Atomically increment a value
   * @param key The key to increment
   * @param delta The amount to add (can be negative)
   * @returns The new value
   */
  increment(key: string, delta: bigint): KeyValueResult<bigint>
}

/**
 * Compare-and-swap operation handle
 */
export interface CasHandle {
  /**
   * Get the current value
   */
  current(): KeyValueResult<Uint8Array | undefined>

  /**
   * Swap the value if it hasn't changed
   * @param newValue The new value to set
   * @returns true if swap succeeded, false if value changed
   */
  swap(newValue: Uint8Array): KeyValueResult<boolean>
}

/**
 * Batch operations on a bucket
 */
export interface BatchBucket extends Bucket {
  /**
   * Get multiple values at once
   * @param keys The keys to fetch
   * @returns Map of key to value (missing keys omitted)
   */
  getMany(keys: string[]): KeyValueResult<Map<string, Uint8Array>>

  /**
   * Set multiple key-value pairs at once
   * @param entries Map of key to value
   */
  setMany(entries: Map<string, Uint8Array>): KeyValueResult<void>

  /**
   * Delete multiple keys at once
   * @param keys The keys to delete
   */
  deleteMany(keys: string[]): KeyValueResult<void>
}

/**
 * Store configuration
 */
export interface StoreConfig {
  /**
   * Maximum number of keys per bucket (default: unlimited)
   */
  maxKeys?: number

  /**
   * Maximum value size in bytes (default: 1MB)
   */
  maxValueSize?: number

  /**
   * Page size for list-keys pagination (default: 100)
   */
  pageSize?: number
}

/**
 * Default store configuration values
 */
export const DEFAULT_STORE_CONFIG: Required<StoreConfig> = {
  maxKeys: Number.MAX_SAFE_INTEGER,
  maxValueSize: 1024 * 1024, // 1MB
  pageSize: 100,
}
