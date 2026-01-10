/**
 * browser:vibration tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BrowserVibration,
  getDefaultVibration,
  isVibrationSupported,
  vibrate,
  cancelVibration,
  getBrowserVibrationImports,
} from '../../../src/browser/vibration.js'

describe('browser:vibration', () => {
  let originalNavigator: typeof globalThis.navigator
  let mockVibrate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalNavigator = globalThis.navigator
    mockVibrate = vi.fn(() => true)

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        vibrate: mockVibrate,
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  describe('BrowserVibration', () => {
    it('detects vibration support', () => {
      const vib = new BrowserVibration()
      expect(vib.isSupported()).toBe(true)
    })

    it('detects no support when navigator.vibrate is missing', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      })

      const vib = new BrowserVibration()
      expect(vib.isSupported()).toBe(false)
    })

    it('vibrates with single duration', () => {
      const vib = new BrowserVibration()

      const result = vib.vibrate(100)

      expect(result.ok).toBe(true)
      expect(mockVibrate).toHaveBeenCalledWith([100])
    })

    it('vibrates with pattern', () => {
      const vib = new BrowserVibration()

      const result = vib.vibrate([100, 50, 100])

      expect(result.ok).toBe(true)
      expect(mockVibrate).toHaveBeenCalledWith([100, 50, 100])
    })

    it('vibrateOnce is alias for vibrate with single duration', () => {
      const vib = new BrowserVibration()

      const result = vib.vibrateOnce(200)

      expect(result.ok).toBe(true)
      expect(mockVibrate).toHaveBeenCalledWith([200])
    })

    it('vibratePattern is alias for vibrate with array', () => {
      const vib = new BrowserVibration()

      const result = vib.vibratePattern([100, 50, 100])

      expect(result.ok).toBe(true)
      expect(mockVibrate).toHaveBeenCalledWith([100, 50, 100])
    })

    it('cancels vibration', () => {
      const vib = new BrowserVibration()

      const result = vib.cancel()

      expect(result.ok).toBe(true)
      expect(mockVibrate).toHaveBeenCalledWith(0)
    })

    it('returns error when not supported', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      })

      const vib = new BrowserVibration()

      const result = vib.vibrate(100)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    it('returns error for cancel when not supported', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      })

      const vib = new BrowserVibration()

      const result = vib.cancel()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    describe('pattern validation', () => {
      it('rejects patterns exceeding max length', () => {
        const vib = new BrowserVibration({ maxPatternLength: 5 })

        const result = vib.vibrate([100, 50, 100, 50, 100, 50])

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('invalid-argument')
          expect(result.error.message).toContain('length')
        }
      })

      it('rejects vibration durations exceeding max', () => {
        const vib = new BrowserVibration({ maxDuration: 100 })

        const result = vib.vibrate(200)

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('invalid-argument')
          expect(result.error.message).toContain('exceeds maximum')
        }
      })

      it('rejects total pattern duration exceeding max', () => {
        const vib = new BrowserVibration({ maxPatternDuration: 500 })

        const result = vib.vibrate([200, 100, 200, 100])

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('invalid-argument')
          expect(result.error.message).toContain('Total pattern duration')
        }
      })

      it('rejects negative durations', () => {
        const vib = new BrowserVibration()

        const result = vib.vibrate(-100)

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('invalid-argument')
          expect(result.error.message).toContain('non-negative')
        }
      })

      it('rejects non-finite durations', () => {
        const vib = new BrowserVibration()

        const result = vib.vibrate(Infinity)

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('invalid-argument')
          expect(result.error.message).toContain('finite')
        }
      })

      it('rejects NaN durations', () => {
        const vib = new BrowserVibration()

        const result = vib.vibrate(NaN)

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('invalid-argument')
        }
      })

      it('allows zero duration', () => {
        const vib = new BrowserVibration()

        const result = vib.vibrate(0)

        expect(result.ok).toBe(true)
      })

      it('validates only odd indices for vibration max (pauses can be longer)', () => {
        const vib = new BrowserVibration({ maxDuration: 100 })

        // Pattern: [vibrate, pause, vibrate]
        // Pauses (index 1) are not checked against maxDuration
        const result = vib.vibrate([100, 200, 100])

        expect(result.ok).toBe(true)
      })
    })

    describe('pattern helpers', () => {
      it('creates pulse pattern', () => {
        const vib = new BrowserVibration()

        const pattern = vib.createPulsePattern(3, 100, 50)

        expect(pattern).toEqual([100, 50, 100, 50, 100])
      })

      it('creates SOS pattern', () => {
        const vib = new BrowserVibration()

        const pattern = vib.createSosPattern()

        // S (3 dots) O (3 dashes) S (3 dots)
        expect(pattern.length).toBeGreaterThan(10)
        // First element should be a short (dot) vibration
        expect(pattern[0]).toBe(100)
      })

      it('creates heartbeat pattern', () => {
        const vib = new BrowserVibration()

        const pattern = vib.createHeartbeatPattern(2)

        // Each heartbeat is 4 elements (double pulse with pause)
        // Last pause is removed
        expect(pattern.length).toBe(7) // 4 + 4 - 1
      })

      it('creates single heartbeat pattern', () => {
        const vib = new BrowserVibration()

        const pattern = vib.createHeartbeatPattern(1)

        expect(pattern.length).toBe(3) // 4 - 1 (no trailing pause)
      })
    })
  })

  describe('Standalone functions', () => {
    it('isVibrationSupported returns support status', () => {
      expect(isVibrationSupported()).toBe(true)
    })

    it('vibrate function works', () => {
      const result = vibrate(100)
      expect(result.ok).toBe(true)
      expect(mockVibrate).toHaveBeenCalled()
    })

    it('cancelVibration function works', () => {
      const result = cancelVibration()
      expect(result.ok).toBe(true)
      expect(mockVibrate).toHaveBeenCalledWith(0)
    })
  })

  describe('getDefaultVibration', () => {
    it('returns same instance', () => {
      const vib1 = getDefaultVibration()
      const vib2 = getDefaultVibration()
      expect(vib1).toBe(vib2)
    })
  })

  describe('getBrowserVibrationImports', () => {
    it('returns valid imports object', () => {
      const imports = getBrowserVibrationImports()

      expect(imports['browser:vibration/vibration']).toBeDefined()
      expect(typeof imports['browser:vibration/vibration']).toBe('object')
    })

    it('includes all required functions', () => {
      const imports = getBrowserVibrationImports()
      const vibImports = imports['browser:vibration/vibration'] as Record<string, unknown>

      expect(typeof vibImports['is-supported']).toBe('function')
      expect(typeof vibImports['vibrate']).toBe('function')
      expect(typeof vibImports['vibrate-once']).toBe('function')
      expect(typeof vibImports['vibrate-pattern']).toBe('function')
      expect(typeof vibImports['cancel']).toBe('function')
      expect(typeof vibImports['create-pulse-pattern']).toBe('function')
      expect(typeof vibImports['create-sos-pattern']).toBe('function')
      expect(typeof vibImports['create-heartbeat-pattern']).toBe('function')
    })

    it('uses custom options when provided', () => {
      const imports = getBrowserVibrationImports({ maxDuration: 500 })
      expect(imports['browser:vibration/vibration']).toBeDefined()
    })
  })
})
