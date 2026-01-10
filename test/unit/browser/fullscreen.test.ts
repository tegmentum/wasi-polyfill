/**
 * browser:fullscreen tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BrowserFullscreen,
  getDefaultFullscreen,
  isFullscreenSupported,
  isFullscreen,
  requestFullscreen,
  exitFullscreen,
  getBrowserFullscreenImports,
} from '../../../src/browser/fullscreen.js'

// Create a mock document with fullscreen support
function createMockDocumentWithFullscreen() {
  let fullscreenElement: Element | null = null

  const mockDocument = {
    get fullscreenElement() { return fullscreenElement },
    fullscreenEnabled: true,
    exitFullscreen: vi.fn().mockImplementation(async () => {
      fullscreenElement = null
    }),
    documentElement: {
      requestFullscreen: vi.fn().mockImplementation(async () => {
        fullscreenElement = mockDocument.documentElement as unknown as Element
      }),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    // Helper for tests
    _setFullscreenElement: (el: Element | null) => {
      fullscreenElement = el
    },
  }

  return mockDocument
}

describe('browser:fullscreen', () => {
  let originalDocument: Document
  let mockDocument: ReturnType<typeof createMockDocumentWithFullscreen>

  beforeEach(() => {
    originalDocument = globalThis.document
    mockDocument = createMockDocumentWithFullscreen()
    ;(globalThis as unknown as Record<string, unknown>).document = mockDocument
  })

  afterEach(() => {
    ;(globalThis as unknown as Record<string, unknown>).document = originalDocument
  })

  describe('BrowserFullscreen', () => {
    it('detects fullscreen support', () => {
      const fs = new BrowserFullscreen()
      expect(fs.isSupported()).toBe(true)
    })

    it('detects no support when document is missing', () => {
      delete (globalThis as unknown as Record<string, unknown>).document

      const fs = new BrowserFullscreen()
      expect(fs.isSupported()).toBe(false)
    })

    it('detects no support when fullscreenEnabled is missing', () => {
      ;(globalThis as unknown as Record<string, unknown>).document = {
        other: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }

      const fs = new BrowserFullscreen()
      expect(fs.isSupported()).toBe(false)
    })

    it('checks if fullscreen is enabled', () => {
      const fs = new BrowserFullscreen()
      expect(fs.isEnabled()).toBe(true)
    })

    it('returns false for enabled when document is missing', () => {
      delete (globalThis as unknown as Record<string, unknown>).document

      const fs = new BrowserFullscreen()
      expect(fs.isEnabled()).toBe(false)
    })

    it('checks if currently in fullscreen', () => {
      const fs = new BrowserFullscreen()
      expect(fs.isFullscreen()).toBe(false)

      mockDocument._setFullscreenElement(document.documentElement as unknown as Element)
      expect(fs.isFullscreen()).toBe(true)
    })

    it('gets fullscreen element', () => {
      const fs = new BrowserFullscreen()
      expect(fs.getFullscreenElement()).toBeNull()
    })

    it('requests fullscreen', async () => {
      const fs = new BrowserFullscreen()

      const result = await fs.requestFullscreen()

      expect(result.ok).toBe(true)
      expect(mockDocument.documentElement.requestFullscreen).toHaveBeenCalled()
    })

    it('returns error when fullscreen not supported', async () => {
      delete (globalThis as unknown as Record<string, unknown>).document

      const fs = new BrowserFullscreen()
      const result = await fs.requestFullscreen()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    it('returns error when fullscreen not enabled', async () => {
      mockDocument.fullscreenEnabled = false

      const fs = new BrowserFullscreen()
      const result = await fs.requestFullscreen()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('denied')
      }
    })

    it('exits fullscreen', async () => {
      mockDocument._setFullscreenElement(document.documentElement as unknown as Element)

      const fs = new BrowserFullscreen()
      const result = await fs.exitFullscreen()

      expect(result.ok).toBe(true)
      expect(mockDocument.exitFullscreen).toHaveBeenCalled()
    })

    it('exits fullscreen succeeds when not in fullscreen', async () => {
      const fs = new BrowserFullscreen()
      const result = await fs.exitFullscreen()

      expect(result.ok).toBe(true)
    })

    it('returns error for exit when not supported', async () => {
      delete (globalThis as unknown as Record<string, unknown>).document

      const fs = new BrowserFullscreen()
      const result = await fs.exitFullscreen()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    it('reads change events', () => {
      const fs = new BrowserFullscreen()

      const events = fs.readChangeEvents()

      expect(Array.isArray(events)).toBe(true)
    })

    it('reads limited change events', () => {
      const fs = new BrowserFullscreen()

      const events = fs.readChangeEvents(5)

      expect(Array.isArray(events)).toBe(true)
    })

    it('reads error events', () => {
      const fs = new BrowserFullscreen()

      const events = fs.readErrorEvents()

      expect(Array.isArray(events)).toBe(true)
    })

    it('reads limited error events', () => {
      const fs = new BrowserFullscreen()

      const events = fs.readErrorEvents(3)

      expect(Array.isArray(events)).toBe(true)
    })

    it('gets queued change count', () => {
      const fs = new BrowserFullscreen()

      const count = fs.getQueuedChangeCount()

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('gets queued error count', () => {
      const fs = new BrowserFullscreen()

      const count = fs.getQueuedErrorCount()

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('destroys and cleans up', () => {
      const fs = new BrowserFullscreen()

      fs.destroy()

      expect(fs.getQueuedChangeCount()).toBe(0)
      expect(fs.getQueuedErrorCount()).toBe(0)
    })

    it('respects max queued events', () => {
      const fs = new BrowserFullscreen({ maxQueuedEvents: 5 })
      expect(fs).toBeDefined()
    })

    it('handles element lookup with custom functions', async () => {
      const nodeMap = new Map<number, Element>()
      nodeMap.set(1, document.documentElement as unknown as Element)

      const fs = new BrowserFullscreen({
        getNodeForHandle: (handle) => nodeMap.get(handle) ?? null,
        getHandleForNode: (node) => {
          for (const [handle, el] of nodeMap) {
            if (el === node) return handle
          }
          return null
        },
      })

      // Request with valid handle
      const result = await fs.requestFullscreen(1)
      expect(result.ok).toBe(true)
    })

    it('returns error for invalid element handle', async () => {
      const fs = new BrowserFullscreen({
        getNodeForHandle: () => null,
      })

      const result = await fs.requestFullscreen(999)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-found')
      }
    })
  })

  describe('Standalone functions', () => {
    it('isFullscreenSupported returns support status', () => {
      expect(isFullscreenSupported()).toBe(true)
    })

    it('isFullscreen returns fullscreen status', () => {
      expect(isFullscreen()).toBe(false)
    })

    it('requestFullscreen function works', async () => {
      const result = await requestFullscreen()
      expect(result.ok).toBe(true)
    })

    it('exitFullscreen function works', async () => {
      const result = await exitFullscreen()
      expect(result.ok).toBe(true)
    })
  })

  describe('getDefaultFullscreen', () => {
    it('returns same instance', () => {
      const fs1 = getDefaultFullscreen()
      const fs2 = getDefaultFullscreen()
      expect(fs1).toBe(fs2)
    })
  })

  describe('getBrowserFullscreenImports', () => {
    it('returns valid imports object', () => {
      const imports = getBrowserFullscreenImports()

      expect(imports['browser:fullscreen/fullscreen']).toBeDefined()
      expect(typeof imports['browser:fullscreen/fullscreen']).toBe('object')
    })

    it('includes all required functions', () => {
      const imports = getBrowserFullscreenImports()
      const fsImports = imports['browser:fullscreen/fullscreen'] as Record<string, unknown>

      expect(typeof fsImports['is-supported']).toBe('function')
      expect(typeof fsImports['is-enabled']).toBe('function')
      expect(typeof fsImports['is-fullscreen']).toBe('function')
      expect(typeof fsImports['get-fullscreen-element']).toBe('function')
      expect(typeof fsImports['request-fullscreen']).toBe('function')
      expect(typeof fsImports['exit-fullscreen']).toBe('function')
      expect(typeof fsImports['read-change-events']).toBe('function')
      expect(typeof fsImports['read-error-events']).toBe('function')
      expect(typeof fsImports['get-queued-change-count']).toBe('function')
      expect(typeof fsImports['get-queued-error-count']).toBe('function')
    })
  })
})
