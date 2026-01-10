# Error Handling Guide

This guide explains error handling patterns in wasi-polyfill, including the Result type, error utilities, and best practices.

## The Result Type

wasi-polyfill uses a `Result<T, E>` type for operations that can fail. This is a discriminated union that forces explicit error handling.

### Basic Usage

```typescript
import { Result, ok, err, isOk, isErr } from '@aspect/wasi-polyfill/shared'

function divide(a: number, b: number): Result<number, string> {
  if (b === 0) {
    return err('Division by zero')
  }
  return ok(a / b)
}

const result = divide(10, 2)

if (isOk(result)) {
  console.log('Result:', result.value) // 5
} else {
  console.error('Error:', result.error)
}
```

### Pattern Matching with `match`

```typescript
import { match } from '@aspect/wasi-polyfill/shared'

const message = match(result, {
  ok: (value) => `Success: ${value}`,
  err: (error) => `Failed: ${error}`,
})
```

### Transforming Results

```typescript
import { map, flatMap, mapErr } from '@aspect/wasi-polyfill/shared'

// Transform success values
const doubled = map(result, (x) => x * 2)

// Chain operations that return Results
const chained = flatMap(result, (x) => divide(x, 2))

// Transform error values
const betterError = mapErr(result, (e) => new Error(e))
```

### Unwrapping Results

```typescript
import { unwrapOr, unwrapOrElse, unwrap } from '@aspect/wasi-polyfill/shared'

// Provide default value
const value = unwrapOr(result, 0)

// Compute default lazily
const computed = unwrapOrElse(result, () => calculateDefault())

// Throw on error (use sparingly)
const mustSucceed = unwrap(result) // throws if error
```

## Browser Interface Errors

Browser interfaces return `Result<T, BrowserError>`:

```typescript
import { BrowserStorage } from '@aspect/wasi-polyfill/browser'

const storage = new BrowserStorage()
const result = await storage.get('key')

if (result.ok) {
  const data = result.value // Uint8Array | null
} else {
  // Handle specific error codes
  switch (result.error.code) {
    case 'not-supported':
      console.log('Storage not available')
      break
    case 'quota-exceeded':
      console.log('Storage full')
      break
    default:
      console.error(result.error.message)
  }
}
```

### Common Browser Error Codes

| Code | Description |
|------|-------------|
| `not-supported` | Feature not available in environment |
| `not-found` | Resource not found |
| `invalid-argument` | Invalid parameter provided |
| `denied` | Permission denied |
| `busy` | Resource limit reached |
| `quota-exceeded` | Storage quota exceeded |
| `network` | Network operation failed |
| `timeout` | Operation timed out |
| `aborted` | Operation was cancelled |

## Error Utilities

### Extracting Error Messages

```typescript
import { extractErrorMessage, extractErrorDetails } from '@aspect/wasi-polyfill/shared'

try {
  await riskyOperation()
} catch (e) {
  // Safe extraction from unknown error
  const message = extractErrorMessage(e)
  const details = extractErrorDetails(e) // includes stack, cause
}
```

### Type Guards

```typescript
import { isError, isErrorLike, isErrorType } from '@aspect/wasi-polyfill/shared'

if (isError(e)) {
  // e is Error
  console.log(e.stack)
}

if (isErrorLike(e)) {
  // e has { message: string }
  console.log(e.message)
}

if (isErrorType(e, TypeError)) {
  // e is TypeError
}
```

### Creating Plugin Errors

```typescript
import { createPluginError, createErrorFactory } from '@aspect/wasi-polyfill/shared'

// One-off error
const error = createPluginError('invalid-state', 'Connection not established')

// Error factory for consistent errors
const createFsError = createErrorFactory('filesystem')
const notFound = createFsError('not-found', 'File does not exist')
```

### Wrapping Errors

```typescript
import { wrapError, wrapWithContext, errorWithCause } from '@aspect/wasi-polyfill/shared'

// Wrap unknown errors
const wrapped = wrapError(unknown, (msg) => new MyError(msg))

// Add context to errors
const contextual = wrapWithContext(error, 'while loading config')

// Create error chain
const chained = errorWithCause(new Error('High level'), originalError)
```

## Async Error Handling

### Converting Promises to Results

```typescript
import { fromPromise, tryCatchAsync } from '@aspect/wasi-polyfill/shared'

// From promise with custom error mapper
const result = await fromPromise(
  fetch('/api/data'),
  (e) => ({ code: 'network', message: extractErrorMessage(e) })
)

// Wrap async function
const safeResult = await tryCatchAsync(
  async () => {
    const response = await fetch('/api/data')
    return response.json()
  },
  (e) => ({ code: 'fetch-failed', message: String(e) })
)
```

### Retry Pattern

```typescript
import { retry } from '@aspect/wasi-polyfill/shared'

const result = await retry(
  () => fetchWithTimeout('/api/data'),
  {
    maxAttempts: 3,
    delay: 1000,
    backoff: 'exponential',
    shouldRetry: (error) => error.code === 'network',
  }
)
```

### Timeout Pattern

```typescript
import { withTimeout } from '@aspect/wasi-polyfill/shared'

const result = await withTimeout(
  longRunningOperation(),
  5000, // 5 second timeout
  () => ({ code: 'timeout', message: 'Operation timed out' })
)
```

## Validation Errors

Use validation utilities for input checking:

```typescript
import {
  validateRequired,
  validateRange,
  validatePattern,
  validateAll,
} from '@aspect/wasi-polyfill/shared'

function createUser(input: unknown): Result<User, ValidationError> {
  // Validate all fields
  const validation = validateAll([
    validateRequired(input?.name, () => ({ field: 'name', message: 'Required' })),
    validateRange(input?.age, 0, 150, () => ({ field: 'age', message: 'Invalid' })),
    validatePattern(input?.email, /^.+@.+$/, () => ({ field: 'email', message: 'Invalid' })),
  ])

  if (!validation.ok) {
    return validation
  }

  return ok({ name: input.name, age: input.age, email: input.email })
}
```

## Best Practices

### 1. Prefer Result over Exceptions

```typescript
// Good: Explicit error handling
function parseConfig(data: string): Result<Config, ParseError> {
  try {
    return ok(JSON.parse(data))
  } catch {
    return err({ code: 'parse-failed', message: 'Invalid JSON' })
  }
}

// Avoid: Hidden exceptions
function parseConfig(data: string): Config {
  return JSON.parse(data) // throws on invalid input
}
```

### 2. Use Specific Error Types

```typescript
// Good: Typed errors with codes
interface StorageError {
  code: 'not-found' | 'quota-exceeded' | 'permission-denied'
  message: string
}

// Avoid: Generic strings
type Error = string
```

### 3. Handle Errors at Boundaries

```typescript
// Handle at API boundary
async function handleRequest(req: Request): Promise<Response> {
  const result = await processRequest(req)

  return match(result, {
    ok: (data) => new Response(JSON.stringify(data), { status: 200 }),
    err: (error) => new Response(error.message, { status: errorToStatus(error) }),
  })
}
```

### 4. Propagate Errors with Context

```typescript
async function loadUserProfile(id: string): Result<Profile, AppError> {
  const userResult = await fetchUser(id)
  if (!userResult.ok) {
    return mapErr(userResult, (e) => ({
      ...e,
      context: `loading profile for user ${id}`,
    }))
  }

  // Continue processing...
}
```

### 5. Use Assertions for Invariants

```typescript
import { assert, assertDefined, assertNever } from '@aspect/wasi-polyfill/shared'

function processState(state: State): void {
  // Runtime assertion for invariants
  assert(state.isInitialized, 'State must be initialized')

  // Assert non-null
  const config = assertDefined(state.config, 'Config required')

  // Exhaustiveness check
  switch (state.type) {
    case 'loading': return handleLoading()
    case 'ready': return handleReady()
    case 'error': return handleError()
    default: assertNever(state.type)
  }
}
```

## Summary

- Use `Result<T, E>` for operations that can fail
- Use type guards (`isOk`, `isErr`) for safe narrowing
- Use `match` for exhaustive handling
- Use `map`, `flatMap`, `mapErr` for transformations
- Use error utilities for safe error extraction
- Handle errors at system boundaries
- Add context when propagating errors
