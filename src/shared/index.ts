/**
 * Shared Utilities
 *
 * Common utilities used across the wasi-polyfill codebase.
 * Includes Result types, handle registries, error utilities, and validation.
 *
 * @example
 * ```typescript
 * import {
 *   Result, ok, err, map, unwrapOr,
 *   HandleRegistry,
 *   extractErrorMessage, wrapError,
 *   validateRequired, validateRange
 * } from '@aspect/wasi-polyfill/shared'
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// WASI Errors (existing)
// =============================================================================

export {
  WasiErrorCode,
  WasiError,
  PluginNotFoundError,
  PolicyDeniedError,
  ImplementationNotFoundError,
  ManifestError,
} from './errors.js'

// =============================================================================
// Result Type
// =============================================================================

export {
  // Types
  type Result,
  type Ok,
  type Err,
  // Constructors
  ok,
  err,
  // Type guards
  isOk,
  isErr,
  // Transformations
  map,
  flatMap,
  mapErr,
  // Unwrapping
  unwrapOr,
  unwrapOrElse,
  unwrap,
  unwrapErr,
  // Async utilities
  fromPromise,
  tryCatch,
  tryCatchAsync,
  // Combining
  all,
  partition,
  // Matching
  match,
  // Void utilities
  okVoid,
  okUnit,
} from './result.js'

// =============================================================================
// Handle Registry
// =============================================================================

export {
  // Registries
  HandleRegistry,
  WeakHandleRegistry,
  HandlePool,
  ScopedRegistry,
  // Typed handles
  type TypedHandle,
  typedHandle,
} from './registry.js'

// =============================================================================
// Error Utilities
// =============================================================================

export {
  // Error extraction
  extractErrorMessage,
  extractErrorDetails,
  // Type guards
  isError,
  isErrorLike,
  isErrorType,
  // Error wrapping
  wrapError,
  wrapWithContext,
  errorWithCause,
  // Error creation
  type PluginError,
  createPluginError,
  createErrorFactory,
  // Assertions
  assertDefined,
  assert,
  assertNever,
  // Error recovery
  retry,
  withTimeout,
  // Error aggregation
  MultiError,
  collectErrors,
} from './error-utils.js'

// =============================================================================
// Validation Utilities
// =============================================================================

export {
  // Required validation
  validateRequired,
  validateNotEmpty,
  // Numeric validation
  validateSize,
  validateCount,
  validateRange,
  validateNonNegative,
  validatePositive,
  validateInteger,
  validateFinite,
  // String validation
  validateMinLength,
  validateMaxLength,
  validatePattern,
  // Array validation
  validateNonEmptyArray,
  validateArrayLength,
  validateArrayMaxLength,
  // Type validation
  validateOneOf,
  validateType,
  // Composite validation
  validateAll,
  validateAllCollect,
  // Object validation
  validateHasKeys,
  validateSchema,
  // Conditional validation
  validateIf,
  validateIfDefined,
} from './validation.js'

// =============================================================================
// Caching Utilities
// =============================================================================

export {
  // Stat cache
  type CachedStat,
  type StatCacheOptions,
  StatCache,
  createCachedStatFn,
} from './stat-cache.js'

export {
  // Write batcher
  type WriteBatcherOptions,
  WriteBatcher,
  createBatchedOperations,
} from './write-batcher.js'
