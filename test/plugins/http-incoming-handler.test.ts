/**
 * Tests for the wasi:http incoming-handler `dispatch` round-trip
 * (REMEDIATION-PLAN 3.11). `createIncomingHandler(handler).dispatch(request)`
 * runs a handler end-to-end (Fetch Request -> Response), the integration point
 * for a Service Worker `fetch` event.
 */

import { describe, it, expect } from 'vitest'
import { createIncomingHandler } from '../../src/wasip2/plugins/http/index.js'

describe('incoming-handler dispatch', () => {
  it('runs a handler and returns its response (status, headers, body)', async () => {
    const server = createIncomingHandler(async (_req, out) => {
      out.set({
        status: 200,
        headers: new Headers({ 'x-test': 'yes' }),
        body: new TextEncoder().encode('hello'),
      })
    })

    const res = await server.dispatch(new Request('https://example.com/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-test')).toBe('yes')
    expect(await res.text()).toBe('hello')
  })

  it('exposes the request method and path to the handler', async () => {
    let seen: { method: unknown; path?: string } | undefined
    const server = createIncomingHandler(async (req, out) => {
      seen = { method: req.method, path: req.pathWithQuery }
      out.set({ status: 204 })
    })

    const res = await server.dispatch(
      new Request('https://example.com/a/b?x=1', { method: 'DELETE' })
    )
    expect(res.status).toBe(204)
    expect(seen?.method).toEqual({ tag: 'delete' })
    expect(seen?.path).toBe('/a/b?x=1')
  })

  it('passes the request body through to the handler', async () => {
    const server = createIncomingHandler(async (req, out) => {
      out.set({ status: 201, body: req.body ?? new Uint8Array() })
    })

    const res = await server.dispatch(
      new Request('https://example.com/', { method: 'POST', body: 'ping' })
    )
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('ping')
  })

  it('returns 501 when no handler is configured', async () => {
    const server = createIncomingHandler()
    const res = await server.dispatch(new Request('https://example.com/'))
    expect(res.status).toBe(501)
  })

  it('returns 500 when the handler throws', async () => {
    const server = createIncomingHandler(async () => {
      throw new Error('boom')
    })
    const res = await server.dispatch(new Request('https://example.com/'))
    expect(res.status).toBe(500)
  })

  it('returns 500 when the handler sets an error outparam', async () => {
    const server = createIncomingHandler(async (_req, out) => {
      out.setError({ tag: 'internal-error', val: 'nope' })
    })
    const res = await server.dispatch(new Request('https://example.com/'))
    expect(res.status).toBe(500)
  })
})
