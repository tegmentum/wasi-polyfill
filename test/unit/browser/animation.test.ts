/**
 * browser:animation tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BrowserAnimation,
  getDefaultAnimation,
  isAnimationFrameSupported,
  isIdleCallbackSupported,
  requestFrame,
  cancelFrame,
  requestIdle,
  cancelIdle,
  getFrameTime,
  getBrowserAnimationImports,
} from '../../../src/browser/animation.js'
import { createMockAnimationFrame, createMockIdleCallback } from '../../browser/test-utils.js'

describe('browser:animation', () => {
  let originalRAF: typeof requestAnimationFrame
  let originalCAF: typeof cancelAnimationFrame
  let originalRIC: typeof requestIdleCallback
  let originalCIC: typeof cancelIdleCallback
  let originalPerformance: Performance
  let mockRAF: ReturnType<typeof createMockAnimationFrame>
  let mockRIC: ReturnType<typeof createMockIdleCallback>

  beforeEach(() => {
    originalRAF = globalThis.requestAnimationFrame
    originalCAF = globalThis.cancelAnimationFrame
    originalRIC = globalThis.requestIdleCallback
    originalCIC = globalThis.cancelIdleCallback
    originalPerformance = globalThis.performance

    mockRAF = createMockAnimationFrame()
    mockRIC = createMockIdleCallback()

    ;(globalThis as unknown as Record<string, unknown>).requestAnimationFrame = mockRAF.requestAnimationFrame
    ;(globalThis as unknown as Record<string, unknown>).cancelAnimationFrame = mockRAF.cancelAnimationFrame
    ;(globalThis as unknown as Record<string, unknown>).requestIdleCallback = mockRIC.requestIdleCallback
    ;(globalThis as unknown as Record<string, unknown>).cancelIdleCallback = mockRIC.cancelIdleCallback
    ;(globalThis as unknown as Record<string, unknown>).performance = {
      now: vi.fn(() => Date.now()),
    }
  })

  afterEach(() => {
    ;(globalThis as unknown as Record<string, unknown>).requestAnimationFrame = originalRAF
    ;(globalThis as unknown as Record<string, unknown>).cancelAnimationFrame = originalCAF
    ;(globalThis as unknown as Record<string, unknown>).requestIdleCallback = originalRIC
    ;(globalThis as unknown as Record<string, unknown>).cancelIdleCallback = originalCIC
    ;(globalThis as unknown as Record<string, unknown>).performance = originalPerformance
  })

  describe('BrowserAnimation', () => {
    describe('Animation Frames', () => {
      it('detects animation frame support', () => {
        const anim = new BrowserAnimation()
        expect(anim.isAnimationFrameSupported()).toBe(true)
      })

      it('detects no support when requestAnimationFrame is missing', () => {
        delete (globalThis as unknown as Record<string, unknown>).requestAnimationFrame

        const anim = new BrowserAnimation()
        expect(anim.isAnimationFrameSupported()).toBe(false)
      })

      it('requests animation frame', () => {
        const anim = new BrowserAnimation()

        const result = anim.requestAnimationFrame()

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(typeof result.value).toBe('number')
          expect(result.value).toBeGreaterThan(0)
        }
      })

      it('returns error when not supported', () => {
        delete (globalThis as unknown as Record<string, unknown>).requestAnimationFrame

        const anim = new BrowserAnimation()
        const result = anim.requestAnimationFrame()

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('not-supported')
        }
      })

      it('respects max pending frames limit', () => {
        const anim = new BrowserAnimation({ maxPendingFrames: 2 })

        anim.requestAnimationFrame()
        anim.requestAnimationFrame()
        const result = anim.requestAnimationFrame()

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('busy')
        }
      })

      it('cancels animation frame', () => {
        const anim = new BrowserAnimation()
        const requestResult = anim.requestAnimationFrame()

        if (requestResult.ok) {
          const cancelResult = anim.cancelAnimationFrame(requestResult.value)
          expect(cancelResult.ok).toBe(true)
        }
      })

      it('cancelling non-existent frame succeeds', () => {
        const anim = new BrowserAnimation()

        const result = anim.cancelAnimationFrame(9999)
        expect(result.ok).toBe(true)
      })

      it('reads completed frames', async () => {
        const anim = new BrowserAnimation()
        anim.requestAnimationFrame()

        // Wait for frame to complete
        await new Promise(resolve => setTimeout(resolve, 20))

        const frames = anim.readCompletedFrames()
        expect(Array.isArray(frames)).toBe(true)
        expect(frames.length).toBeGreaterThan(0)
        expect(frames[0]!.timestamp).toBeGreaterThan(0)
      })

      it('reads limited completed frames', async () => {
        const anim = new BrowserAnimation()
        anim.requestAnimationFrame()
        anim.requestAnimationFrame()

        await new Promise(resolve => setTimeout(resolve, 30))

        const frames = anim.readCompletedFrames(1)
        expect(frames.length).toBeLessThanOrEqual(1)
      })

      it('checks if frame is pending', () => {
        const anim = new BrowserAnimation()
        const result = anim.requestAnimationFrame()

        if (result.ok) {
          expect(anim.isFramePending(result.value)).toBe(true)
        }
      })

      it('gets pending frame count', () => {
        const anim = new BrowserAnimation()

        expect(anim.getPendingFrameCount()).toBe(0)

        anim.requestAnimationFrame()
        expect(anim.getPendingFrameCount()).toBe(1)
      })

      it('gets current frame time', () => {
        const anim = new BrowserAnimation()

        const time = anim.getFrameTime()
        expect(typeof time).toBe('number')
        expect(time).toBeGreaterThan(0)
      })
    })

    describe('Idle Callbacks', () => {
      it('detects idle callback support', () => {
        const anim = new BrowserAnimation()
        expect(anim.isIdleCallbackSupported()).toBe(true)
      })

      it('detects no support when requestIdleCallback is missing', () => {
        delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback

        const anim = new BrowserAnimation()
        expect(anim.isIdleCallbackSupported()).toBe(false)
      })

      it('requests idle callback', () => {
        const anim = new BrowserAnimation()

        const result = anim.requestIdleCallback()

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(typeof result.value).toBe('number')
          expect(result.value).toBeGreaterThan(0)
        }
      })

      it('requests idle callback with timeout', () => {
        const anim = new BrowserAnimation()

        const result = anim.requestIdleCallback({ timeout: 1000 })

        expect(result.ok).toBe(true)
      })

      it('returns error when not supported', () => {
        delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback

        const anim = new BrowserAnimation()
        const result = anim.requestIdleCallback()

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('not-supported')
        }
      })

      it('respects max pending idle callbacks limit', () => {
        const anim = new BrowserAnimation({ maxPendingIdle: 2 })

        anim.requestIdleCallback()
        anim.requestIdleCallback()
        const result = anim.requestIdleCallback()

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('busy')
        }
      })

      it('cancels idle callback', () => {
        const anim = new BrowserAnimation()
        const requestResult = anim.requestIdleCallback()

        if (requestResult.ok) {
          const cancelResult = anim.cancelIdleCallback(requestResult.value)
          expect(cancelResult.ok).toBe(true)
        }
      })

      it('cancelling non-existent callback succeeds', () => {
        const anim = new BrowserAnimation()

        const result = anim.cancelIdleCallback(9999)
        expect(result.ok).toBe(true)
      })

      it('reads completed idle callbacks', async () => {
        const anim = new BrowserAnimation()
        anim.requestIdleCallback()

        // Wait for idle callback to complete
        await new Promise(resolve => setTimeout(resolve, 100))

        const callbacks = anim.readCompletedIdleCallbacks()
        expect(Array.isArray(callbacks)).toBe(true)
        expect(callbacks.length).toBeGreaterThan(0)
        expect(callbacks[0]!.deadline).toBeDefined()
        expect(typeof callbacks[0]!.deadline.timeRemaining).toBe('number')
      })

      it('reads limited completed idle callbacks', async () => {
        const anim = new BrowserAnimation()
        anim.requestIdleCallback()
        anim.requestIdleCallback()

        await new Promise(resolve => setTimeout(resolve, 100))

        const callbacks = anim.readCompletedIdleCallbacks(1)
        expect(callbacks.length).toBeLessThanOrEqual(1)
      })

      it('checks if idle callback is pending', () => {
        const anim = new BrowserAnimation()
        const result = anim.requestIdleCallback()

        if (result.ok) {
          expect(anim.isIdlePending(result.value)).toBe(true)
        }
      })

      it('gets pending idle count', () => {
        const anim = new BrowserAnimation()

        expect(anim.getPendingIdleCount()).toBe(0)

        anim.requestIdleCallback()
        expect(anim.getPendingIdleCount()).toBe(1)
      })
    })

    describe('Cleanup', () => {
      it('destroys and cleans up all pending requests', () => {
        const anim = new BrowserAnimation()

        anim.requestAnimationFrame()
        anim.requestIdleCallback()

        expect(anim.getPendingFrameCount()).toBe(1)
        expect(anim.getPendingIdleCount()).toBe(1)

        anim.destroy()

        expect(anim.getPendingFrameCount()).toBe(0)
        expect(anim.getPendingIdleCount()).toBe(0)
      })
    })
  })

  describe('Standalone functions', () => {
    it('isAnimationFrameSupported returns support status', () => {
      expect(isAnimationFrameSupported()).toBe(true)
    })

    it('isIdleCallbackSupported returns support status', () => {
      expect(isIdleCallbackSupported()).toBe(true)
    })

    it('requestFrame function works', () => {
      const result = requestFrame()
      expect(result.ok).toBe(true)
    })

    it('cancelFrame function works', () => {
      const requestResult = requestFrame()
      if (requestResult.ok) {
        const cancelResult = cancelFrame(requestResult.value)
        expect(cancelResult.ok).toBe(true)
      }
    })

    it('requestIdle function works', () => {
      const result = requestIdle()
      expect(result.ok).toBe(true)
    })

    it('requestIdle with options works', () => {
      const result = requestIdle({ timeout: 500 })
      expect(result.ok).toBe(true)
    })

    it('cancelIdle function works', () => {
      const requestResult = requestIdle()
      if (requestResult.ok) {
        const cancelResult = cancelIdle(requestResult.value)
        expect(cancelResult.ok).toBe(true)
      }
    })

    it('getFrameTime function works', () => {
      const time = getFrameTime()
      expect(typeof time).toBe('number')
    })
  })

  describe('getDefaultAnimation', () => {
    it('returns same instance', () => {
      const anim1 = getDefaultAnimation()
      const anim2 = getDefaultAnimation()
      expect(anim1).toBe(anim2)
    })
  })

  describe('getBrowserAnimationImports', () => {
    it('returns valid imports object', () => {
      const imports = getBrowserAnimationImports()

      expect(imports['browser:animation/animation']).toBeDefined()
      expect(typeof imports['browser:animation/animation']).toBe('object')
    })

    it('includes all required functions', () => {
      const imports = getBrowserAnimationImports()
      const animImports = imports['browser:animation/animation'] as Record<string, unknown>

      // Support checks
      expect(typeof animImports['is-animation-frame-supported']).toBe('function')
      expect(typeof animImports['is-idle-callback-supported']).toBe('function')

      // Animation frame functions
      expect(typeof animImports['request-animation-frame']).toBe('function')
      expect(typeof animImports['cancel-animation-frame']).toBe('function')
      expect(typeof animImports['read-completed-frames']).toBe('function')
      expect(typeof animImports['is-frame-pending']).toBe('function')
      expect(typeof animImports['get-pending-frame-count']).toBe('function')

      // Idle callback functions
      expect(typeof animImports['request-idle-callback']).toBe('function')
      expect(typeof animImports['cancel-idle-callback']).toBe('function')
      expect(typeof animImports['read-completed-idle-callbacks']).toBe('function')
      expect(typeof animImports['is-idle-pending']).toBe('function')
      expect(typeof animImports['get-pending-idle-count']).toBe('function')

      // Time
      expect(typeof animImports['get-frame-time']).toBe('function')
    })
  })
})
