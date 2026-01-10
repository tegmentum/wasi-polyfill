/**
 * browser:screen tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BrowserScreen,
  getDefaultScreen,
  isScreenSupported,
  getScreenInfo,
  getOrientation,
  lockOrientation,
  unlockOrientation,
  getBrowserScreenImports,
} from '../../../src/browser/screen.js'
import { createMockScreen } from '../../browser/test-utils.js'

describe('browser:screen', () => {
  let originalScreen: Screen
  let originalDevicePixelRatio: number

  beforeEach(() => {
    originalScreen = globalThis.screen
    originalDevicePixelRatio = globalThis.devicePixelRatio
    ;(globalThis as unknown as Record<string, unknown>).screen = createMockScreen()
    ;(globalThis as unknown as Record<string, unknown>).devicePixelRatio = 2
  })

  afterEach(() => {
    ;(globalThis as unknown as Record<string, unknown>).screen = originalScreen
    ;(globalThis as unknown as Record<string, unknown>).devicePixelRatio = originalDevicePixelRatio
  })

  describe('BrowserScreen', () => {
    it('detects screen support', () => {
      const scr = new BrowserScreen()
      expect(scr.isSupported()).toBe(true)
    })

    it('detects no support when screen is missing', () => {
      delete (globalThis as unknown as Record<string, unknown>).screen

      const scr = new BrowserScreen()
      expect(scr.isSupported()).toBe(false)
    })

    it('detects orientation support', () => {
      const scr = new BrowserScreen()
      expect(scr.isOrientationSupported()).toBe(true)
    })

    it('gets screen info', () => {
      const scr = new BrowserScreen()

      const result = scr.getInfo()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.width).toBe(1920)
        expect(result.value.height).toBe(1080)
        expect(result.value.availWidth).toBe(1920)
        expect(result.value.availHeight).toBeLessThan(1080) // Minus taskbar
        expect(result.value.colorDepth).toBe(24)
        expect(result.value.pixelDepth).toBe(24)
        expect(result.value.devicePixelRatio).toBe(2)
        expect(result.value.orientation).toBe('landscape-primary')
        expect(typeof result.value.orientationAngle).toBe('number')
      }
    })

    it('returns error when not supported', () => {
      delete (globalThis as unknown as Record<string, unknown>).screen

      const scr = new BrowserScreen()
      const result = scr.getInfo()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    it('gets current orientation', () => {
      const scr = new BrowserScreen()

      const result = scr.getOrientation()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.type).toBe('landscape-primary')
        expect(typeof result.value.angle).toBe('number')
      }
    })

    it('returns error for orientation when not supported', () => {
      ;(globalThis as unknown as Record<string, unknown>).screen = { width: 1920, height: 1080 }

      const scr = new BrowserScreen()
      const result = scr.getOrientation()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    it('locks orientation', async () => {
      const scr = new BrowserScreen()

      const result = await scr.lockOrientation('landscape')

      expect(result.ok).toBe(true)
    })

    it('returns error when lock not supported', async () => {
      ;(globalThis as unknown as Record<string, unknown>).screen = { width: 1920, height: 1080 }

      const scr = new BrowserScreen()
      const result = await scr.lockOrientation('landscape')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    it('unlocks orientation', () => {
      const scr = new BrowserScreen()

      const result = scr.unlockOrientation()

      expect(result.ok).toBe(true)
    })

    it('returns error when unlock not supported', () => {
      ;(globalThis as unknown as Record<string, unknown>).screen = { width: 1920, height: 1080 }

      const scr = new BrowserScreen()
      const result = scr.unlockOrientation()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    it('reads orientation events', () => {
      const scr = new BrowserScreen()

      const events = scr.readOrientationEvents()

      expect(Array.isArray(events)).toBe(true)
    })

    it('reads limited orientation events', () => {
      const scr = new BrowserScreen()

      const events = scr.readOrientationEvents(5)

      expect(Array.isArray(events)).toBe(true)
    })

    it('gets queued event count', () => {
      const scr = new BrowserScreen()

      const count = scr.getQueuedEventCount()

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('destroys and cleans up', () => {
      const scr = new BrowserScreen()

      scr.destroy()

      expect(scr.getQueuedEventCount()).toBe(0)
    })
  })

  describe('Standalone functions', () => {
    it('isScreenSupported returns support status', () => {
      expect(isScreenSupported()).toBe(true)
    })

    it('getScreenInfo function works', () => {
      const result = getScreenInfo()
      expect(result.ok).toBe(true)
    })

    it('getOrientation function works', () => {
      const result = getOrientation()
      expect(result.ok).toBe(true)
    })

    it('lockOrientation function works', async () => {
      const result = await lockOrientation('portrait')
      expect(result.ok).toBe(true)
    })

    it('unlockOrientation function works', () => {
      const result = unlockOrientation()
      expect(result.ok).toBe(true)
    })
  })

  describe('getDefaultScreen', () => {
    it('returns same instance', () => {
      const scr1 = getDefaultScreen()
      const scr2 = getDefaultScreen()
      expect(scr1).toBe(scr2)
    })
  })

  describe('getBrowserScreenImports', () => {
    it('returns valid imports object', () => {
      const imports = getBrowserScreenImports()

      expect(imports['browser:screen/screen']).toBeDefined()
      expect(typeof imports['browser:screen/screen']).toBe('object')
    })

    it('includes all required functions', () => {
      const imports = getBrowserScreenImports()
      const screenImports = imports['browser:screen/screen'] as Record<string, unknown>

      expect(typeof screenImports['is-supported']).toBe('function')
      expect(typeof screenImports['is-orientation-supported']).toBe('function')
      expect(typeof screenImports['get-info']).toBe('function')
      expect(typeof screenImports['get-orientation']).toBe('function')
      expect(typeof screenImports['lock-orientation']).toBe('function')
      expect(typeof screenImports['unlock-orientation']).toBe('function')
      expect(typeof screenImports['read-orientation-events']).toBe('function')
      expect(typeof screenImports['get-queued-event-count']).toBe('function')
    })
  })

  describe('screen with different orientations', () => {
    it('handles portrait orientation', () => {
      ;(globalThis as unknown as Record<string, unknown>).screen = createMockScreen({
        width: 1080,
        height: 1920,
        orientation: 'portrait-primary',
      })

      const scr = new BrowserScreen()
      const result = scr.getInfo()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.width).toBe(1080)
        expect(result.value.height).toBe(1920)
        expect(result.value.orientation).toBe('portrait-primary')
      }
    })

    it('handles different color depths', () => {
      ;(globalThis as unknown as Record<string, unknown>).screen = createMockScreen({
        colorDepth: 32,
      })

      const scr = new BrowserScreen()
      const result = scr.getInfo()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.colorDepth).toBe(32)
        expect(result.value.pixelDepth).toBe(32)
      }
    })
  })
})
