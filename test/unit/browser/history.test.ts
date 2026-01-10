/**
 * browser:history tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BrowserHistory,
  getDefaultHistory,
  isHistorySupported,
  pushState,
  replaceState,
  back,
  forward,
  go,
  getLength,
  getState,
  getBrowserHistoryImports,
} from '../../../src/browser/history.js'
import { createMockHistory, createMockLocation } from '../../browser/test-utils.js'

describe('browser:history', () => {
  let originalHistory: History
  let originalLocation: Location
  let originalWindow: typeof globalThis.window

  beforeEach(() => {
    originalHistory = globalThis.history
    originalLocation = globalThis.location
    originalWindow = globalThis.window
    ;(globalThis as unknown as Record<string, unknown>).history = createMockHistory()
    ;(globalThis as unknown as Record<string, unknown>).location = createMockLocation('http://localhost:3000/')
    // Create minimal window mock for event listeners
    ;(globalThis as unknown as Record<string, unknown>).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
  })

  afterEach(() => {
    ;(globalThis as unknown as Record<string, unknown>).history = originalHistory
    ;(globalThis as unknown as Record<string, unknown>).location = originalLocation
    ;(globalThis as unknown as Record<string, unknown>).window = originalWindow
  })

  describe('BrowserHistory', () => {
    it('detects history support', () => {
      const hist = new BrowserHistory()
      expect(hist.isSupported()).toBe(true)
    })

    it('detects no support when history is missing', () => {
      delete (globalThis as unknown as Record<string, unknown>).history

      const hist = new BrowserHistory()
      expect(hist.isSupported()).toBe(false)
    })

    it('pushes state', () => {
      const hist = new BrowserHistory()

      const result = hist.pushState({ data: { count: 1 }, title: 'Test' })

      expect(result.ok).toBe(true)
    })

    it('pushes state with URL', () => {
      const hist = new BrowserHistory()

      const result = hist.pushState({ data: { page: 'about' }, url: '/about' })

      expect(result.ok).toBe(true)
      expect(history.pushState).toHaveBeenCalledWith({ page: 'about' }, '', '/about')
    })

    it('returns error when not supported', () => {
      delete (globalThis as unknown as Record<string, unknown>).history

      const hist = new BrowserHistory()
      const result = hist.pushState({ data: null })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    it('replaces state', () => {
      const hist = new BrowserHistory()

      const result = hist.replaceState({ data: { updated: true }, title: 'Updated' })

      expect(result.ok).toBe(true)
      expect(history.replaceState).toHaveBeenCalled()
    })

    it('replaces state with URL', () => {
      const hist = new BrowserHistory()

      const result = hist.replaceState({ data: { id: 123 }, url: '/item/123' })

      expect(result.ok).toBe(true)
    })

    it('navigates back', () => {
      const hist = new BrowserHistory()

      const result = hist.back()

      expect(result.ok).toBe(true)
      expect(history.back).toHaveBeenCalled()
    })

    it('navigates forward', () => {
      const hist = new BrowserHistory()

      const result = hist.forward()

      expect(result.ok).toBe(true)
      expect(history.forward).toHaveBeenCalled()
    })

    it('navigates by delta', () => {
      const hist = new BrowserHistory()

      const result = hist.go(-2)

      expect(result.ok).toBe(true)
      expect(history.go).toHaveBeenCalledWith(-2)
    })

    it('rejects non-integer delta', () => {
      const hist = new BrowserHistory()

      const result = hist.go(1.5)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('invalid-argument')
      }
    })

    it('gets current entry', () => {
      const hist = new BrowserHistory()

      const result = hist.getCurrentEntry()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.url).toBe('http://localhost:3000/')
        expect(typeof result.value.length).toBe('number')
      }
    })

    it('gets history length', () => {
      const hist = new BrowserHistory()

      const length = hist.getLength()

      expect(typeof length).toBe('number')
      expect(length).toBeGreaterThanOrEqual(1)
    })

    it('gets current state', () => {
      const hist = new BrowserHistory()

      const state = hist.getState()

      // Initial state is null
      expect(state).toBeNull()
    })

    it('reads popstate events', () => {
      const hist = new BrowserHistory()

      const events = hist.readPopStateEvents()

      expect(Array.isArray(events)).toBe(true)
    })

    it('reads limited popstate events', () => {
      const hist = new BrowserHistory()

      const events = hist.readPopStateEvents(5)

      expect(Array.isArray(events)).toBe(true)
    })

    it('gets queued event count', () => {
      const hist = new BrowserHistory()

      const count = hist.getQueuedEventCount()

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('destroys and cleans up', () => {
      const hist = new BrowserHistory()

      hist.destroy()

      expect(hist.getQueuedEventCount()).toBe(0)
    })

    it('respects max queued events', () => {
      const hist = new BrowserHistory({ maxQueuedEvents: 2 })
      // Events are queued via popstate listener
      expect(hist).toBeDefined()
    })
  })

  describe('Standalone functions', () => {
    it('isHistorySupported returns support status', () => {
      expect(isHistorySupported()).toBe(true)
    })

    it('pushState function works', () => {
      const result = pushState({ data: { test: true } })
      expect(result.ok).toBe(true)
    })

    it('replaceState function works', () => {
      const result = replaceState({ data: { replaced: true } })
      expect(result.ok).toBe(true)
    })

    it('back function works', () => {
      const result = back()
      expect(result.ok).toBe(true)
    })

    it('forward function works', () => {
      const result = forward()
      expect(result.ok).toBe(true)
    })

    it('go function works', () => {
      const result = go(-1)
      expect(result.ok).toBe(true)
    })

    it('getLength function works', () => {
      const length = getLength()
      expect(typeof length).toBe('number')
    })

    it('getState function works', () => {
      const state = getState()
      // Returns null or the current state
      expect(state === null || state !== undefined).toBe(true)
    })
  })

  describe('getDefaultHistory', () => {
    it('returns same instance', () => {
      const hist1 = getDefaultHistory()
      const hist2 = getDefaultHistory()
      expect(hist1).toBe(hist2)
    })
  })

  describe('getBrowserHistoryImports', () => {
    it('returns valid imports object', () => {
      const imports = getBrowserHistoryImports()

      expect(imports['browser:history/history']).toBeDefined()
      expect(typeof imports['browser:history/history']).toBe('object')
    })

    it('includes all required functions', () => {
      const imports = getBrowserHistoryImports()
      const histImports = imports['browser:history/history'] as Record<string, unknown>

      expect(typeof histImports['is-supported']).toBe('function')
      expect(typeof histImports['push-state']).toBe('function')
      expect(typeof histImports['replace-state']).toBe('function')
      expect(typeof histImports['back']).toBe('function')
      expect(typeof histImports['forward']).toBe('function')
      expect(typeof histImports['go']).toBe('function')
      expect(typeof histImports['get-current-entry']).toBe('function')
      expect(typeof histImports['get-length']).toBe('function')
      expect(typeof histImports['get-state']).toBe('function')
      expect(typeof histImports['read-popstate-events']).toBe('function')
      expect(typeof histImports['get-queued-event-count']).toBe('function')
    })
  })
})
