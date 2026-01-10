/**
 * browser:websocket tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BrowserWebSocket,
  WebSocketState,
  getDefaultWebSocket,
  getBrowserWebSocketImports,
} from '../../../src/browser/websocket.js'
import { createMockWebSocketClass } from '../../browser/test-utils.js'

describe('browser:websocket', () => {
  let originalWebSocket: typeof WebSocket

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket
    ;(globalThis as unknown as Record<string, unknown>).WebSocket = createMockWebSocketClass()
  })

  afterEach(() => {
    ;(globalThis as unknown as Record<string, unknown>).WebSocket = originalWebSocket
  })

  describe('BrowserWebSocket', () => {
    it('detects WebSocket support', () => {
      const ws = new BrowserWebSocket()
      expect(ws.isSupported()).toBe(true)
    })

    it('detects no support when WebSocket is missing', () => {
      delete (globalThis as unknown as Record<string, unknown>).WebSocket

      const ws = new BrowserWebSocket()
      expect(ws.isSupported()).toBe(false)
    })

    it('connects to a WebSocket URL', async () => {
      const ws = new BrowserWebSocket()

      const result = ws.connect({ url: 'ws://localhost:8080' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(typeof result.value).toBe('number')
        expect(result.value).toBeGreaterThan(0)
      }
    })

    it('connects with protocols', async () => {
      const ws = new BrowserWebSocket()

      const result = ws.connect({ url: 'ws://localhost:8080', protocols: ['protocol1', 'protocol2'] })

      expect(result.ok).toBe(true)
    })

    it('returns error when not supported', () => {
      delete (globalThis as unknown as Record<string, unknown>).WebSocket

      const ws = new BrowserWebSocket()
      const result = ws.connect({ url: 'ws://localhost:8080' })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-supported')
      }
    })

    it('respects max connections limit', () => {
      const ws = new BrowserWebSocket({ maxConnections: 2 })

      ws.connect({ url: 'ws://localhost:8080/1' })
      ws.connect({ url: 'ws://localhost:8080/2' })
      const result = ws.connect({ url: 'ws://localhost:8080/3' })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('busy')
      }
    })

    it('gets socket state', async () => {
      const ws = new BrowserWebSocket()
      const connectResult = ws.connect({ url: 'ws://localhost:8080' })

      if (connectResult.ok) {
        // Initially connecting
        const stateResult = ws.getState(connectResult.value)
        expect(stateResult.ok).toBe(true)
        if (stateResult.ok) {
          expect([WebSocketState.CONNECTING, WebSocketState.OPEN]).toContain(stateResult.value)
        }
      }
    })

    it('returns error for invalid handle', () => {
      const ws = new BrowserWebSocket()

      const result = ws.getState(9999)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not-found')
      }
    })

    it('sends data on open socket', async () => {
      const ws = new BrowserWebSocket()
      const connectResult = ws.connect({ url: 'ws://localhost:8080' })

      if (connectResult.ok) {
        // Wait for socket to open
        await new Promise(resolve => setTimeout(resolve, 20))

        const sendResult = ws.send(connectResult.value, new Uint8Array([1, 2, 3]))
        expect(sendResult.ok).toBe(true)
      }
    })

    it('sends string data', async () => {
      const ws = new BrowserWebSocket()
      const connectResult = ws.connect({ url: 'ws://localhost:8080' })

      if (connectResult.ok) {
        await new Promise(resolve => setTimeout(resolve, 20))

        const sendResult = ws.sendText(connectResult.value, 'hello')
        expect(sendResult.ok).toBe(true)
      }
    })

    it('closes socket', async () => {
      const ws = new BrowserWebSocket()
      const connectResult = ws.connect({ url: 'ws://localhost:8080' })

      if (connectResult.ok) {
        const closeResult = ws.close(connectResult.value)
        expect(closeResult.ok).toBe(true)

        // Wait for close to complete
        await new Promise(resolve => setTimeout(resolve, 20))

        const stateResult = ws.getState(connectResult.value)
        if (stateResult.ok) {
          expect([WebSocketState.CLOSING, WebSocketState.CLOSED]).toContain(stateResult.value)
        }
      }
    })

    it('closes socket with code and reason', async () => {
      const ws = new BrowserWebSocket()
      const connectResult = ws.connect({ url: 'ws://localhost:8080' })

      if (connectResult.ok) {
        const closeResult = ws.close(connectResult.value, 1000, 'Normal closure')
        expect(closeResult.ok).toBe(true)
      }
    })

    it('reads messages from queue', async () => {
      const ws = new BrowserWebSocket()
      const connectResult = ws.connect({ url: 'ws://localhost:8080' })

      if (connectResult.ok) {
        // Messages are queued when received
        const messages = ws.readMessages(connectResult.value)

        expect(messages.ok).toBe(true)
        if (messages.ok) {
          expect(Array.isArray(messages.value)).toBe(true)
        }
      }
    })

    it('gets socket info', async () => {
      const ws = new BrowserWebSocket()
      const connectResult = ws.connect({ url: 'ws://localhost:8080' })

      if (connectResult.ok) {
        const info = ws.getInfo(connectResult.value)

        expect(info.ok).toBe(true)
        if (info.ok) {
          expect(info.value.handle).toBe(connectResult.value)
          expect(info.value.url).toBe('ws://localhost:8080')
        }
      }
    })

    it('destroys all connections', async () => {
      const ws = new BrowserWebSocket()

      ws.connect({ url: 'ws://localhost:8080/1' })
      ws.connect({ url: 'ws://localhost:8080/2' })

      ws.destroy()

      expect(ws.getConnectionCount()).toBe(0)
    })

    it('gets connection count', () => {
      const ws = new BrowserWebSocket()

      expect(ws.getConnectionCount()).toBe(0)

      ws.connect({ url: 'ws://localhost:8080/1' })
      expect(ws.getConnectionCount()).toBe(1)

      ws.connect({ url: 'ws://localhost:8080/2' })
      expect(ws.getConnectionCount()).toBe(2)
    })
  })

  describe('getDefaultWebSocket', () => {
    it('returns same instance', () => {
      const ws1 = getDefaultWebSocket()
      const ws2 = getDefaultWebSocket()
      expect(ws1).toBe(ws2)
    })
  })

  describe('getBrowserWebSocketImports', () => {
    it('returns valid imports object', () => {
      const imports = getBrowserWebSocketImports()

      expect(imports['browser:websocket/websocket']).toBeDefined()
      expect(typeof imports['browser:websocket/websocket']).toBe('object')
    })

    it('includes all required functions', () => {
      const imports = getBrowserWebSocketImports()
      const wsImports = imports['browser:websocket/websocket'] as Record<string, unknown>

      expect(typeof wsImports['is-supported']).toBe('function')
      expect(typeof wsImports['connect']).toBe('function')
      expect(typeof wsImports['send']).toBe('function')
      expect(typeof wsImports['send-text']).toBe('function')
      expect(typeof wsImports['close']).toBe('function')
      expect(typeof wsImports['get-state']).toBe('function')
      expect(typeof wsImports['read-messages']).toBe('function')
      expect(typeof wsImports['get-info']).toBe('function')
    })
  })
})
