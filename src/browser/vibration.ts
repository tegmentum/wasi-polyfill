/**
 * browser:vibration - Vibration interface
 *
 * Provides a capability-scoped interface to the Vibration API
 * for haptic feedback in WebAssembly components.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  type Result,
  ok,
  browserErr,
} from './types.js'

// =============================================================================
// Vibration Types
// =============================================================================

/**
 * Vibration pattern - duration in milliseconds.
 *
 * A single number is a single vibration.
 * An array alternates between vibration and pause durations.
 * e.g., [100, 50, 100] = vibrate 100ms, pause 50ms, vibrate 100ms
 */
export type VibrationPattern = number | number[]

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the Vibration manager.
 */
export interface VibrationOptions {
  /** Maximum duration for a single vibration (default: 10000ms) */
  maxDuration?: number
  /** Maximum total pattern duration (default: 30000ms) */
  maxPatternDuration?: number
  /** Maximum pattern length (default: 100) */
  maxPatternLength?: number
}

// =============================================================================
// Browser Vibration Manager
// =============================================================================

/**
 * Browser Vibration implementation.
 *
 * Provides vibration control with capability-scoped access suitable
 * for use across the WASM boundary.
 */
export class BrowserVibration {
  private maxDuration: number
  private maxPatternDuration: number
  private maxPatternLength: number

  constructor(options: VibrationOptions = {}) {
    this.maxDuration = options.maxDuration ?? 10000
    this.maxPatternDuration = options.maxPatternDuration ?? 30000
    this.maxPatternLength = options.maxPatternLength ?? 100
  }

  /**
   * Check if Vibration API is supported.
   */
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'vibrate' in navigator
  }

  /**
   * Validate a vibration pattern.
   *
   * @param pattern - The pattern to validate
   * @returns Success or error with reason
   */
  private validatePattern(pattern: VibrationPattern): Result<number[], BrowserError> {
    // Normalize to array
    const patternArray = Array.isArray(pattern) ? pattern : [pattern]

    // Check pattern length
    if (patternArray.length > this.maxPatternLength) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Pattern length ${patternArray.length} exceeds maximum ${this.maxPatternLength}`
      )
    }

    // Validate each duration
    let totalDuration = 0
    for (let i = 0; i < patternArray.length; i++) {
      const duration = patternArray[i]!

      if (typeof duration !== 'number' || !Number.isFinite(duration)) {
        return browserErr(
          BrowserErrorCode.INVALID_ARGUMENT,
          `Invalid duration at index ${i}: must be a finite number`
        )
      }

      if (duration < 0) {
        return browserErr(
          BrowserErrorCode.INVALID_ARGUMENT,
          `Invalid duration at index ${i}: must be non-negative`
        )
      }

      // Only odd indices are vibrations (index 0, 2, 4, ... are vibrations)
      if (i % 2 === 0 && duration > this.maxDuration) {
        return browserErr(
          BrowserErrorCode.INVALID_ARGUMENT,
          `Vibration duration ${duration}ms at index ${i} exceeds maximum ${this.maxDuration}ms`
        )
      }

      totalDuration += duration
    }

    // Check total duration
    if (totalDuration > this.maxPatternDuration) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Total pattern duration ${totalDuration}ms exceeds maximum ${this.maxPatternDuration}ms`
      )
    }

    return ok(patternArray)
  }

  /**
   * Trigger a vibration.
   *
   * @param pattern - Vibration pattern (duration or array of durations)
   * @returns True if vibration was triggered, or error
   */
  vibrate(pattern: VibrationPattern): Result<boolean, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Vibration API is not supported'
      )
    }

    // Validate pattern
    const validated = this.validatePattern(pattern)
    if (!validated.ok) {
      return validated
    }

    try {
      const result = navigator.vibrate(validated.value)
      return ok(result)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to vibrate: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Trigger a single vibration.
   *
   * @param duration - Vibration duration in milliseconds
   * @returns True if vibration was triggered, or error
   */
  vibrateOnce(duration: number): Result<boolean, BrowserError> {
    return this.vibrate(duration)
  }

  /**
   * Trigger a vibration pattern.
   *
   * @param pattern - Array of durations (vibration, pause, vibration, ...)
   * @returns True if vibration was triggered, or error
   */
  vibratePattern(pattern: number[]): Result<boolean, BrowserError> {
    return this.vibrate(pattern)
  }

  /**
   * Cancel any ongoing vibration.
   *
   * @returns Success or error
   */
  cancel(): Result<void, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Vibration API is not supported'
      )
    }

    try {
      navigator.vibrate(0)
      return ok(undefined)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.UNKNOWN,
        `Failed to cancel vibration: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Create a pulse pattern.
   *
   * @param count - Number of pulses
   * @param onDuration - Vibration duration per pulse (ms)
   * @param offDuration - Pause duration between pulses (ms)
   * @returns Vibration pattern
   */
  createPulsePattern(count: number, onDuration: number, offDuration: number): number[] {
    const pattern: number[] = []
    for (let i = 0; i < count; i++) {
      pattern.push(onDuration)
      if (i < count - 1) {
        pattern.push(offDuration)
      }
    }
    return pattern
  }

  /**
   * Create an SOS pattern (3 short, 3 long, 3 short).
   *
   * @returns SOS vibration pattern
   */
  createSosPattern(): number[] {
    // S = dot dot dot, O = dash dash dash, S = dot dot dot
    const dot = 100
    const dash = 300
    const symbolGap = 100
    const letterGap = 300

    return [
      // S
      dot, symbolGap, dot, symbolGap, dot, letterGap,
      // O
      dash, symbolGap, dash, symbolGap, dash, letterGap,
      // S
      dot, symbolGap, dot, symbolGap, dot,
    ]
  }

  /**
   * Create a heartbeat pattern.
   *
   * @param beats - Number of heartbeats
   * @returns Heartbeat vibration pattern
   */
  createHeartbeatPattern(beats: number = 2): number[] {
    const pattern: number[] = []
    for (let i = 0; i < beats; i++) {
      // Double pulse for each heartbeat
      pattern.push(50, 50, 100, 400)
    }
    // Remove trailing pause
    pattern.pop()
    return pattern
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultVibration: BrowserVibration | null = null

/**
 * Get the default Vibration manager instance.
 */
export function getDefaultVibration(options?: VibrationOptions): BrowserVibration {
  if (!defaultVibration) {
    defaultVibration = new BrowserVibration(options)
  }
  return defaultVibration
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Check if Vibration API is supported.
 */
export function isVibrationSupported(): boolean {
  return getDefaultVibration().isSupported()
}

/**
 * Trigger a vibration.
 */
export function vibrate(pattern: VibrationPattern): Result<boolean, BrowserError> {
  return getDefaultVibration().vibrate(pattern)
}

/**
 * Cancel ongoing vibration.
 */
export function cancelVibration(): Result<void, BrowserError> {
  return getDefaultVibration().cancel()
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:vibration imports object.
 */
export function getBrowserVibrationImports(options?: VibrationOptions): Record<string, unknown> {
  const vib = options ? new BrowserVibration(options) : getDefaultVibration()

  return {
    'browser:vibration/vibration': {
      // Support check
      'is-supported': () => vib.isSupported(),

      // Vibration
      vibrate: (pattern: VibrationPattern) => vib.vibrate(pattern),
      'vibrate-once': (duration: number) => vib.vibrateOnce(duration),
      'vibrate-pattern': (pattern: number[]) => vib.vibratePattern(pattern),
      cancel: () => vib.cancel(),

      // Pattern helpers
      'create-pulse-pattern': (count: number, onDuration: number, offDuration: number) =>
        vib.createPulsePattern(count, onDuration, offDuration),
      'create-sos-pattern': () => vib.createSosPattern(),
      'create-heartbeat-pattern': (beats?: number) => vib.createHeartbeatPattern(beats),
    },
  }
}
