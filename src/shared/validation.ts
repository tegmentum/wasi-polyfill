/**
 * Validation Utilities
 *
 * Shared validation functions that return Result types for consistent
 * error handling across the codebase.
 *
 * @example
 * ```typescript
 * import { validateRequired, validateRange, validateSize } from '@aspect/wasi-polyfill/shared'
 *
 * function processData(data: Data | undefined): Result<void, Error> {
 *   const validated = validateRequired(data, () => new Error('Data is required'))
 *   if (!validated.ok) return validated
 *
 *   const sizeCheck = validateSize(data.size, MAX_SIZE, () => new Error('Data too large'))
 *   if (!sizeCheck.ok) return sizeCheck
 *
 *   return ok(undefined)
 * }
 * ```
 *
 * @packageDocumentation
 */

import { type Result, ok, err } from './result.js'

// =============================================================================
// Required Value Validation
// =============================================================================

/**
 * Validate that a value is not null or undefined.
 *
 * @param value - The value to validate
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result containing the value or the error
 *
 * @example
 * ```typescript
 * const result = validateRequired(user.email, () => ({
 *   code: 'missing-field',
 *   message: 'Email is required'
 * }))
 * ```
 */
export function validateRequired<T, E>(
  value: T | null | undefined,
  errorFactory: () => E
): Result<T, E> {
  if (value === null || value === undefined) {
    return err(errorFactory())
  }
  return ok(value)
}

/**
 * Validate that a string is not empty.
 *
 * @param value - The string to validate
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateNotEmpty<E>(
  value: string | null | undefined,
  errorFactory: () => E
): Result<string, E> {
  if (value === null || value === undefined || value.trim() === '') {
    return err(errorFactory())
  }
  return ok(value)
}

// =============================================================================
// Numeric Validation
// =============================================================================

/**
 * Validate that a size value does not exceed a maximum.
 *
 * @param actual - The actual size
 * @param max - The maximum allowed size
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 *
 * @example
 * ```typescript
 * const result = validateSize(buffer.length, MAX_BUFFER_SIZE, () => ({
 *   code: 'buffer-overflow',
 *   message: `Buffer exceeds maximum size of ${MAX_BUFFER_SIZE}`
 * }))
 * ```
 */
export function validateSize<E>(
  actual: number,
  max: number,
  errorFactory: () => E
): Result<void, E> {
  if (actual > max) {
    return err(errorFactory())
  }
  return ok(undefined)
}

/**
 * Validate that a count does not exceed a maximum.
 *
 * @param current - The current count
 * @param max - The maximum allowed count
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateCount<E>(
  current: number,
  max: number,
  errorFactory: () => E
): Result<void, E> {
  if (current >= max) {
    return err(errorFactory())
  }
  return ok(undefined)
}

/**
 * Validate that a value falls within a range (inclusive).
 *
 * @param value - The value to check
 * @param min - The minimum allowed value
 * @param max - The maximum allowed value
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 *
 * @example
 * ```typescript
 * const result = validateRange(port, 1, 65535, () => ({
 *   code: 'invalid-port',
 *   message: 'Port must be between 1 and 65535'
 * }))
 * ```
 */
export function validateRange<E>(
  value: number,
  min: number,
  max: number,
  errorFactory: () => E
): Result<void, E> {
  if (value < min || value > max) {
    return err(errorFactory())
  }
  return ok(undefined)
}

/**
 * Validate that a value is non-negative.
 *
 * @param value - The value to check
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateNonNegative<E>(
  value: number,
  errorFactory: () => E
): Result<void, E> {
  if (value < 0) {
    return err(errorFactory())
  }
  return ok(undefined)
}

/**
 * Validate that a value is positive (greater than zero).
 *
 * @param value - The value to check
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validatePositive<E>(
  value: number,
  errorFactory: () => E
): Result<void, E> {
  if (value <= 0) {
    return err(errorFactory())
  }
  return ok(undefined)
}

/**
 * Validate that a value is a valid integer.
 *
 * @param value - The value to check
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateInteger<E>(
  value: number,
  errorFactory: () => E
): Result<void, E> {
  if (!Number.isInteger(value)) {
    return err(errorFactory())
  }
  return ok(undefined)
}

/**
 * Validate that a value is finite (not NaN or Infinity).
 *
 * @param value - The value to check
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateFinite<E>(
  value: number,
  errorFactory: () => E
): Result<void, E> {
  if (!Number.isFinite(value)) {
    return err(errorFactory())
  }
  return ok(undefined)
}

// =============================================================================
// String Validation
// =============================================================================

/**
 * Validate that a string has a minimum length.
 *
 * @param value - The string to check
 * @param minLength - The minimum required length
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateMinLength<E>(
  value: string,
  minLength: number,
  errorFactory: () => E
): Result<void, E> {
  if (value.length < minLength) {
    return err(errorFactory())
  }
  return ok(undefined)
}

/**
 * Validate that a string does not exceed a maximum length.
 *
 * @param value - The string to check
 * @param maxLength - The maximum allowed length
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateMaxLength<E>(
  value: string,
  maxLength: number,
  errorFactory: () => E
): Result<void, E> {
  if (value.length > maxLength) {
    return err(errorFactory())
  }
  return ok(undefined)
}

/**
 * Validate that a string matches a regular expression pattern.
 *
 * @param value - The string to check
 * @param pattern - The regex pattern to match
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validatePattern<E>(
  value: string,
  pattern: RegExp,
  errorFactory: () => E
): Result<void, E> {
  if (!pattern.test(value)) {
    return err(errorFactory())
  }
  return ok(undefined)
}

// =============================================================================
// Array Validation
// =============================================================================

/**
 * Validate that an array is not empty.
 *
 * @param value - The array to check
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateNonEmptyArray<T, E>(
  value: T[],
  errorFactory: () => E
): Result<T[], E> {
  if (value.length === 0) {
    return err(errorFactory())
  }
  return ok(value)
}

/**
 * Validate that an array has a specific length.
 *
 * @param value - The array to check
 * @param length - The required length
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateArrayLength<T, E>(
  value: T[],
  length: number,
  errorFactory: () => E
): Result<void, E> {
  if (value.length !== length) {
    return err(errorFactory())
  }
  return ok(undefined)
}

/**
 * Validate that an array does not exceed a maximum length.
 *
 * @param value - The array to check
 * @param maxLength - The maximum allowed length
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateArrayMaxLength<T, E>(
  value: T[],
  maxLength: number,
  errorFactory: () => E
): Result<void, E> {
  if (value.length > maxLength) {
    return err(errorFactory())
  }
  return ok(undefined)
}

// =============================================================================
// Type Validation
// =============================================================================

/**
 * Validate that a value is one of the allowed values.
 *
 * @param value - The value to check
 * @param allowed - Array of allowed values
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 *
 * @example
 * ```typescript
 * const result = validateOneOf(status, ['pending', 'active', 'closed'], () => ({
 *   code: 'invalid-status',
 *   message: `Status must be one of: pending, active, closed`
 * }))
 * ```
 */
export function validateOneOf<T, E>(
  value: T,
  allowed: readonly T[],
  errorFactory: () => E
): Result<T, E> {
  if (!allowed.includes(value)) {
    return err(errorFactory())
  }
  return ok(value)
}

/**
 * Validate that a value is of a specific type.
 *
 * @param value - The value to check
 * @param expectedType - The expected typeof result
 * @param errorFactory - Function to create the error if validation fails
 * @returns A Result indicating success or containing the error
 */
export function validateType<E>(
  value: unknown,
  expectedType: 'string' | 'number' | 'boolean' | 'object' | 'function' | 'bigint' | 'symbol',
  errorFactory: () => E
): Result<void, E> {
  if (typeof value !== expectedType) {
    return err(errorFactory())
  }
  return ok(undefined)
}

// =============================================================================
// Composite Validation
// =============================================================================

/**
 * Chain multiple validations together, short-circuiting on first error.
 *
 * @param validations - Array of validation functions returning Results
 * @returns The first error, or ok if all validations pass
 *
 * @example
 * ```typescript
 * const result = validateAll([
 *   () => validateRequired(name, () => 'Name required'),
 *   () => validateMinLength(name, 2, () => 'Name too short'),
 *   () => validateMaxLength(name, 100, () => 'Name too long'),
 * ])
 * ```
 */
export function validateAll<E>(
  validations: Array<() => Result<unknown, E>>
): Result<void, E> {
  for (const validate of validations) {
    const result = validate()
    if (!result.ok) {
      return result
    }
  }
  return ok(undefined)
}

/**
 * Collect all validation errors instead of short-circuiting.
 *
 * @param validations - Array of validation functions returning Results
 * @returns Ok if all pass, or Err with array of all errors
 */
export function validateAllCollect<E>(
  validations: Array<() => Result<unknown, E>>
): Result<void, E[]> {
  const errors: E[] = []

  for (const validate of validations) {
    const result = validate()
    if (!result.ok) {
      errors.push(result.error)
    }
  }

  if (errors.length > 0) {
    return err(errors)
  }
  return ok(undefined)
}

// =============================================================================
// Object Validation
// =============================================================================

/**
 * Validate that an object has all required keys.
 *
 * @param obj - The object to validate
 * @param requiredKeys - Array of required key names
 * @param errorFactory - Function to create the error for missing keys
 * @returns A Result indicating success or containing the error
 */
export function validateHasKeys<T extends object, K extends keyof T, E>(
  obj: Partial<T>,
  requiredKeys: K[],
  errorFactory: (missingKey: K) => E
): Result<T, E> {
  for (const key of requiredKeys) {
    if (!(key in obj) || obj[key] === undefined) {
      return err(errorFactory(key))
    }
  }
  return ok(obj as T)
}

/**
 * Validate an object against a schema of validators.
 *
 * @param obj - The object to validate
 * @param schema - Object mapping keys to validator functions
 * @returns A Result indicating success or containing the first error
 */
export function validateSchema<T extends object, E>(
  obj: T,
  schema: { [K in keyof T]?: (value: T[K]) => Result<unknown, E> }
): Result<T, E> {
  for (const key in schema) {
    const validator = schema[key]
    if (validator) {
      const result = validator(obj[key])
      if (!result.ok) {
        return result as Result<T, E>
      }
    }
  }
  return ok(obj)
}

// =============================================================================
// Conditional Validation
// =============================================================================

/**
 * Apply validation only if a condition is true.
 *
 * @param condition - Whether to apply the validation
 * @param validation - The validation function to conditionally apply
 * @returns Ok if condition is false, otherwise the validation result
 */
export function validateIf<E>(
  condition: boolean,
  validation: () => Result<unknown, E>
): Result<void, E> {
  if (!condition) {
    return ok(undefined)
  }
  const result = validation()
  if (!result.ok) {
    return result
  }
  return ok(undefined)
}

/**
 * Apply validation only if a value is defined.
 *
 * @param value - The value to check
 * @param validation - The validation to apply if value is defined
 * @returns Ok if value is undefined, otherwise the validation result
 */
export function validateIfDefined<T, E>(
  value: T | undefined | null,
  validation: (value: T) => Result<unknown, E>
): Result<void, E> {
  if (value === undefined || value === null) {
    return ok(undefined)
  }
  const result = validation(value)
  if (!result.ok) {
    return result
  }
  return ok(undefined)
}
