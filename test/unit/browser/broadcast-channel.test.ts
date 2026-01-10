/**
 * browser:broadcast-channel tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BrowserBroadcastChannel,
  getDefaultBroadcastChannel,
  isBroadcastChannelSupported,
  createChannel,
  postMessage,
  readMessages,
  closeChannel,
  getBrowserBroadcastChannelImports,
} from '../../../src/browser/broadcast-channel.js'
import { createMockBroadcastChannelClass } from '../../browser/test-utils.js'

describe('browser:broadcast-channel', () => {
  let originalBroadcastChannel: typeof BroadcastChannel

  beforeEach(() => {
    originalBroadcastChannel = globalThis.BroadcastChannel
    ;(globalThis as unknown as Record<string, unknown>).BroadcastChannel = createMockBroadcastChannelClass()
  })

  afterEach(() => {
    ;(globalThis as unknown as Record<string, unknown>).BroadcastChannel = originalBroadcastChannel
  })

  describe('BrowserBroadcastChannel', () => {
    it('detects BroadcastChannel support', () => {
      const bc = new BrowserBroadcastChannel()
      expect(bc.isSupported()).toBe(true)
    })

    it('detects no support when BroadcastChannel is missing', () => {
      delete (globalThis as unknown as Record<string, unknown>).BroadcastChannel

      const bc = new BrowserBroadcastChannel()
      expect(bc.isSupported()).toBe(false)
    })

    it('creates a channel', () => {
      const bc = new BrowserBroadcastChannel()

      const result = bc.create('test-channel')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(typeof result.value).toBe('number')
        expect(result.value).toBeGreaterThan(0)
      }
    })

    it('returns error when not supported', () => {
      delete (globalThis as unknown as Record<string, unknown>).BroadcastChannel

      const bc = new BrowserBroadcastChannel()
      const result = bc.create('test-channel')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    it('respects max channels limit', () => {
      const bc = new BrowserBroadcastChannel({ maxChannels: 2 })

      bc.create('channel1')
      bc.create('channel2')
      const result = bc.create('channel3')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('busy')
      }
    })

    it('requires channel name', () => {
      const bc = new BrowserBroadcastChannel()

      const result = bc.create('')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('invalid-argument')
      }
    })

    it('posts message to channel', () => {
      const bc = new BrowserBroadcastChannel()
      const createResult = bc.create('test-channel')

      if (createResult.ok) {
        const postResult = bc.postMessage(createResult.value, { type: 'test', data: 123 })
        expect(postResult.ok).toBe(true)
      }
    })

    it('returns error when posting to invalid channel', () => {
      const bc = new BrowserBroadcastChannel()

      const result = bc.postMessage(9999, { test: true })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-found')
      }
    })

    it('reads messages from channel', () => {
      const bc = new BrowserBroadcastChannel()
      const createResult = bc.create('test-channel')

      if (createResult.ok) {
        const messagesResult = bc.readMessages(createResult.value)

        expect(messagesResult.ok).toBe(true)
        if (messagesResult.ok) {
          expect(Array.isArray(messagesResult.value)).toBe(true)
        }
      }
    })

    it('reads limited messages when maxCount specified', () => {
      const bc = new BrowserBroadcastChannel()
      const createResult = bc.create('test-channel')

      if (createResult.ok) {
        const messagesResult = bc.readMessages(createResult.value, 5)

        expect(messagesResult.ok).toBe(true)
      }
    })

    it('returns error when reading from invalid channel', () => {
      const bc = new BrowserBroadcastChannel()

      const result = bc.readMessages(9999)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-found')
      }
    })

    it('gets channel info', () => {
      const bc = new BrowserBroadcastChannel()
      const createResult = bc.create('info-channel')

      if (createResult.ok) {
        const infoResult = bc.getInfo(createResult.value)

        expect(infoResult.ok).toBe(true)
        if (infoResult.ok) {
          expect(infoResult.value.handle).toBe(createResult.value)
          expect(infoResult.value.name).toBe('info-channel')
          expect(typeof infoResult.value.queuedMessages).toBe('number')
        }
      }
    })

    it('returns error for info of invalid channel', () => {
      const bc = new BrowserBroadcastChannel()

      const result = bc.getInfo(9999)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-found')
      }
    })

    it('closes channel', () => {
      const bc = new BrowserBroadcastChannel()
      const createResult = bc.create('close-channel')

      if (createResult.ok) {
        const closeResult = bc.close(createResult.value)
        expect(closeResult.ok).toBe(true)

        // Should be removed
        const infoResult = bc.getInfo(createResult.value)
        expect(infoResult.ok).toBe(false)
      }
    })

    it('closing non-existent channel succeeds silently', () => {
      const bc = new BrowserBroadcastChannel()

      const result = bc.close(9999)
      expect(result.ok).toBe(true)
    })

    it('gets all channel handles', () => {
      const bc = new BrowserBroadcastChannel()

      bc.create('channel1')
      bc.create('channel2')
      bc.create('channel3')

      const handles = bc.getChannels()
      expect(handles.length).toBe(3)
    })

    it('gets channel count', () => {
      const bc = new BrowserBroadcastChannel()

      expect(bc.getChannelCount()).toBe(0)

      bc.create('channel1')
      expect(bc.getChannelCount()).toBe(1)

      bc.create('channel2')
      expect(bc.getChannelCount()).toBe(2)
    })

    it('destroys all channels', () => {
      const bc = new BrowserBroadcastChannel()

      bc.create('channel1')
      bc.create('channel2')

      bc.destroy()

      expect(bc.getChannelCount()).toBe(0)
    })

    describe('channel name filtering', () => {
      it('allows all names by default', () => {
        const bc = new BrowserBroadcastChannel()

        const result = bc.create('any-name')
        expect(result.ok).toBe(true)
      })

      it('restricts to allowed names', () => {
        const bc = new BrowserBroadcastChannel({
          allowedChannelNames: ['allowed', 'also-allowed'],
        })

        const result1 = bc.create('allowed')
        expect(result1.ok).toBe(true)

        const result2 = bc.create('not-allowed')
        expect(result2.ok).toBe(false)
        if (!result2.ok) {
          expect(result2.error.code).toBe('denied')
        }
      })

      it('supports wildcard patterns', () => {
        const bc = new BrowserBroadcastChannel({
          allowedChannelNames: ['app-*'],
        })

        const result1 = bc.create('app-messages')
        expect(result1.ok).toBe(true)

        const result2 = bc.create('other-channel')
        expect(result2.ok).toBe(false)
      })

      it('supports catch-all wildcard', () => {
        const bc = new BrowserBroadcastChannel({
          allowedChannelNames: ['*'],
        })

        const result = bc.create('anything-goes')
        expect(result.ok).toBe(true)
      })
    })
  })

  describe('Standalone functions', () => {
    it('isBroadcastChannelSupported returns support status', () => {
      expect(isBroadcastChannelSupported()).toBe(true)
    })

    it('createChannel function works', () => {
      const result = createChannel('standalone-channel')
      expect(result.ok).toBe(true)
    })

    it('postMessage function works', () => {
      const createResult = createChannel('post-channel')
      if (createResult.ok) {
        const postResult = postMessage(createResult.value, { test: true })
        expect(postResult.ok).toBe(true)
      }
    })

    it('readMessages function works', () => {
      const createResult = createChannel('read-channel')
      if (createResult.ok) {
        const messagesResult = readMessages(createResult.value)
        expect(messagesResult.ok).toBe(true)
      }
    })

    it('closeChannel function works', () => {
      const createResult = createChannel('close-standalone')
      if (createResult.ok) {
        const closeResult = closeChannel(createResult.value)
        expect(closeResult.ok).toBe(true)
      }
    })
  })

  describe('getDefaultBroadcastChannel', () => {
    it('returns same instance', () => {
      const bc1 = getDefaultBroadcastChannel()
      const bc2 = getDefaultBroadcastChannel()
      expect(bc1).toBe(bc2)
    })
  })

  describe('getBrowserBroadcastChannelImports', () => {
    it('returns valid imports object', () => {
      const imports = getBrowserBroadcastChannelImports()

      expect(imports['browser:broadcast-channel/broadcast-channel']).toBeDefined()
      expect(typeof imports['browser:broadcast-channel/broadcast-channel']).toBe('object')
    })

    it('includes all required functions', () => {
      const imports = getBrowserBroadcastChannelImports()
      const bcImports = imports['browser:broadcast-channel/broadcast-channel'] as Record<string, unknown>

      expect(typeof bcImports['is-supported']).toBe('function')
      expect(typeof bcImports['create']).toBe('function')
      expect(typeof bcImports['close']).toBe('function')
      expect(typeof bcImports['post-message']).toBe('function')
      expect(typeof bcImports['read-messages']).toBe('function')
      expect(typeof bcImports['get-info']).toBe('function')
      expect(typeof bcImports['get-channels']).toBe('function')
      expect(typeof bcImports['get-channel-count']).toBe('function')
    })
  })
})
