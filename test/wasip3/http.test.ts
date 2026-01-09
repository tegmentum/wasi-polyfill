/**
 * WASI HTTP 0.3.0 Interface Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Fields,
  Body,
  Request,
  Response,
  OutgoingHandler,
  IncomingHandler,
  getHttpImports,
  HttpErrorCode,
  type Method,
  type Scheme,
} from '../../src/wasip3/interfaces/http.js'

describe('WASIP3 HTTP Interface', () => {
  describe('HttpErrorCode', () => {
    it('defines DNS error codes', () => {
      expect(HttpErrorCode.DNS_TIMEOUT).toBe(0)
      expect(HttpErrorCode.DNS_ERROR).toBe(1)
    })

    it('defines connection error codes', () => {
      expect(HttpErrorCode.CONNECTION_REFUSED).toBe(6)
      expect(HttpErrorCode.CONNECTION_TERMINATED).toBe(7)
      expect(HttpErrorCode.CONNECTION_TIMEOUT).toBe(8)
    })

    it('defines HTTP error codes', () => {
      expect(HttpErrorCode.HTTP_REQUEST_DENIED).toBe(15)
      expect(HttpErrorCode.HTTP_RESPONSE_INCOMPLETE).toBe(25)
      expect(HttpErrorCode.HTTP_PROTOCOL_ERROR).toBe(35)
    })

    it('defines TLS error codes', () => {
      expect(HttpErrorCode.TLS_PROTOCOL_ERROR).toBe(12)
      expect(HttpErrorCode.TLS_CERTIFICATE_ERROR).toBe(13)
    })
  })

  describe('Fields', () => {
    it('creates empty fields', () => {
      const fields = new Fields()
      expect(fields.get('any')).toEqual([])
    })

    it('creates fields from entries', () => {
      const encoder = new TextEncoder()
      const fields = new Fields([
        ['content-type', encoder.encode('application/json')],
        ['accept', encoder.encode('*/*')],
      ])

      expect(fields.get('content-type')).toEqual(['application/json'])
      expect(fields.get('accept')).toEqual(['*/*'])
    })

    it('gets values case-insensitively', () => {
      const fields = new Fields()
      fields.set('Content-Type', 'text/html')

      expect(fields.get('content-type')).toEqual(['text/html'])
      expect(fields.get('Content-Type')).toEqual(['text/html'])
      expect(fields.get('CONTENT-TYPE')).toEqual(['text/html'])
    })

    it('checks if header exists', () => {
      const fields = new Fields()
      fields.set('X-Custom', 'value')

      expect(fields.has('x-custom')).toBe(true)
      expect(fields.has('x-other')).toBe(false)
    })

    it('sets header replacing existing', () => {
      const fields = new Fields()
      fields.set('X-Header', 'first')
      fields.set('X-Header', 'second')

      expect(fields.get('x-header')).toEqual(['second'])
    })

    it('appends values', () => {
      const fields = new Fields()
      fields.append('Accept', 'text/html')
      fields.append('Accept', 'application/json')

      expect(fields.get('accept')).toEqual(['text/html', 'application/json'])
    })

    it('deletes header', () => {
      const fields = new Fields()
      fields.set('X-Header', 'value')
      fields.delete('x-header')

      expect(fields.has('x-header')).toBe(false)
    })

    it('gets all entries', () => {
      const fields = new Fields()
      fields.set('A', 'a')
      fields.set('B', 'b')
      fields.append('B', 'b2')

      const entries = fields.getEntries()
      expect(entries.length).toBe(3)
    })

    it('clones fields', () => {
      const fields = new Fields()
      fields.set('X-Header', 'value')

      const cloned = fields.clone()
      cloned.set('X-Header', 'modified')

      expect(fields.get('x-header')).toEqual(['value'])
      expect(cloned.get('x-header')).toEqual(['modified'])
    })

    it('converts to native Headers', () => {
      const fields = new Fields()
      fields.set('Content-Type', 'text/plain')
      fields.append('Accept', 'application/json')

      const headers = fields.toHeaders()
      expect(headers.get('content-type')).toBe('text/plain')
      expect(headers.get('accept')).toBe('application/json')
    })

    it('creates from native Headers', () => {
      const headers = new Headers()
      headers.set('X-Test', 'value')

      const fields = Fields.fromHeaders(headers)
      expect(fields.get('x-test')).toEqual(['value'])
    })
  })

  describe('Body', () => {
    it('creates body with stream', () => {
      const body = new Body()
      const stream = body.getStream()
      expect(stream).toBeDefined()
      expect(stream.read).toBeDefined()
    })

    it('writes data to body', async () => {
      const body = new Body()
      const stream = body.getStream()

      // Start reading before writing (async)
      const readPromise = stream.read()

      await body.write(new TextEncoder().encode('hello'))
      body.finish()

      const result = await readPromise
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(new TextDecoder().decode(result.values[0])).toBe('hello')
      }
    })

    it('creates body from bytes', async () => {
      const body = Body.fromBytes(new TextEncoder().encode('content'))
      const stream = body.getStream()

      // Wait a bit for async write
      await new Promise((r) => setTimeout(r, 10))

      const result = await stream.read()
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(new TextDecoder().decode(result.values[0])).toBe('content')
      }
    })

    it('creates body from string', async () => {
      const body = Body.fromString('test string')
      const stream = body.getStream()

      await new Promise((r) => setTimeout(r, 10))

      const result = await stream.read()
      expect(result.status).toBe('values')
      if (result.status === 'values') {
        expect(new TextDecoder().decode(result.values[0])).toBe('test string')
      }
    })
  })

  describe('Request', () => {
    it('creates request with defaults', () => {
      const req = new Request()
      expect(req.method).toEqual({ tag: 'get' })
      expect(req.headers).toBeInstanceOf(Fields)
    })

    it('creates request from URL', () => {
      const req = Request.fromUrl('https://example.com/api/data?q=test')

      expect(req.scheme).toEqual({ tag: 'HTTPS' })
      expect(req.authority).toBe('example.com')
      expect(req.pathWithQuery).toBe('/api/data?q=test')
    })

    it('creates request with method', () => {
      const req = Request.fromUrl('http://example.com', { tag: 'post' })
      expect(req.method).toEqual({ tag: 'post' })
    })

    it('handles HTTP scheme', () => {
      const req = Request.fromUrl('http://example.com')
      expect(req.scheme).toEqual({ tag: 'HTTP' })
    })

    it('handles invalid URL', () => {
      const req = Request.fromUrl('/relative/path')
      expect(req.pathWithQuery).toBe('/relative/path')
      expect(req.scheme).toBeUndefined()
    })

    it('converts to fetch Request', () => {
      const req = Request.fromUrl('https://example.com/test', { tag: 'put' })
      req.headers.set('Content-Type', 'application/json')

      const fetchReq = req.toFetchRequest()

      expect(fetchReq.url).toBe('https://example.com/test')
      expect(fetchReq.method).toBe('PUT')
      expect(fetchReq.headers.get('content-type')).toBe('application/json')
    })

    it('handles common HTTP methods', () => {
      // Note: CONNECT and TRACE are not supported by browser's fetch Request API
      const methods: Method[] = [
        { tag: 'get' },
        { tag: 'head' },
        { tag: 'post' },
        { tag: 'put' },
        { tag: 'delete' },
        { tag: 'options' },
        { tag: 'patch' },
      ]

      for (const method of methods) {
        const req = new Request()
        req.method = method
        req.scheme = { tag: 'HTTP' }
        req.authority = 'example.com'
        req.pathWithQuery = '/'

        const fetchReq = req.toFetchRequest()
        const expected = method.tag.toUpperCase()
        expect(fetchReq.method).toBe(expected)
      }
    })

    it('handles other method', () => {
      const req = new Request()
      req.method = { tag: 'other', val: 'CUSTOM' }
      req.scheme = { tag: 'HTTP' }
      req.authority = 'example.com'
      req.pathWithQuery = '/'

      const fetchReq = req.toFetchRequest()
      expect(fetchReq.method).toBe('CUSTOM')
    })
  })

  describe('Response', () => {
    it('creates response with defaults', () => {
      const resp = new Response()
      expect(resp.status).toBe(200)
      expect(resp.headers).toBeInstanceOf(Fields)
    })

    it('creates response with status', () => {
      const resp = Response.withStatus(404)
      expect(resp.status).toBe(404)
    })

    it('creates response from fetch Response', async () => {
      const fetchResp = new globalThis.Response('body content', {
        status: 201,
        headers: { 'X-Custom': 'value' },
      })

      const resp = await Response.fromFetchResponse(fetchResp)

      expect(resp.status).toBe(201)
      expect(resp.headers.get('x-custom')).toEqual(['value'])
    })

    it('creates response from fetch Response with body', async () => {
      const fetchResp = new globalThis.Response('body content', { status: 200 })
      const resp = await Response.fromFetchResponse(fetchResp)

      expect(resp.body).toBeDefined()
    })
  })

  describe('OutgoingHandler', () => {
    it('creates handler with default fetch', () => {
      const handler = new OutgoingHandler()
      expect(handler).toBeDefined()
    })

    it('creates handler with custom fetch', () => {
      const mockFetch = vi.fn()
      const handler = new OutgoingHandler(mockFetch as unknown as typeof fetch)
      expect(handler).toBeDefined()
    })

    it('handles request using fetch', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new globalThis.Response('response body', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      )

      const handler = new OutgoingHandler(mockFetch as unknown as typeof fetch)
      const req = Request.fromUrl('https://example.com/api')

      const resp = await handler.handle(req)

      expect(mockFetch).toHaveBeenCalled()
      expect(resp.status).toBe(200)
    })

    it('returns error response on fetch failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const handler = new OutgoingHandler(mockFetch as unknown as typeof fetch)
      const req = Request.fromUrl('https://example.com/api')

      const resp = await handler.handle(req)

      expect(resp.status).toBe(0)
      expect(resp.headers.get('x-error')).toContain('Network error')
    })
  })

  describe('IncomingHandler', () => {
    it('creates handler with function', () => {
      const handler = new IncomingHandler(async (req) => Response.withStatus(200))
      expect(handler).toBeDefined()
    })

    it('handles request with custom handler', async () => {
      const handler = new IncomingHandler(async (req) => {
        const resp = Response.withStatus(201)
        resp.headers.set('X-Handled', 'yes')
        return resp
      })

      const req = Request.fromUrl('http://localhost/test')
      const resp = await handler.handle(req)

      expect(resp.status).toBe(201)
      expect(resp.headers.get('x-handled')).toEqual(['yes'])
    })
  })

  describe('getHttpImports', () => {
    it('returns import object with types', () => {
      const imports = getHttpImports()
      expect(imports).toHaveProperty('wasi:http/types@0.3.0')
    })

    it('returns import object with outgoing-handler', () => {
      const imports = getHttpImports()
      expect(imports).toHaveProperty('wasi:http/outgoing-handler@0.3.0')
    })

    describe('types imports', () => {
      it('creates fields', () => {
        const imports = getHttpImports()
        const types = imports['wasi:http/types@0.3.0'] as Record<string, Function>

        const handle = types['[constructor]fields']()
        expect(typeof handle).toBe('number')
        expect(handle).toBeGreaterThan(0)
      })

      it('creates fields from list', () => {
        const imports = getHttpImports()
        const types = imports['wasi:http/types@0.3.0'] as Record<string, Function>

        const encoder = new TextEncoder()
        const handle = types['[static]fields.from-list']([
          ['content-type', encoder.encode('text/plain')],
        ])

        expect(typeof handle).toBe('number')
      })

      it('gets field values', () => {
        const imports = getHttpImports()
        const types = imports['wasi:http/types@0.3.0'] as Record<string, Function>

        const encoder = new TextEncoder()
        const handle = types['[static]fields.from-list']([
          ['x-test', encoder.encode('value')],
        ])

        const values = types['[method]fields.get'](handle, 'x-test')
        expect(values.length).toBe(1)
        expect(new TextDecoder().decode(values[0])).toBe('value')
      })

      it('creates body', () => {
        const imports = getHttpImports()
        const types = imports['wasi:http/types@0.3.0'] as Record<string, Function>

        const handle = types['[constructor]body']()
        expect(typeof handle).toBe('number')
      })

      it('creates request', () => {
        const imports = getHttpImports()
        const types = imports['wasi:http/types@0.3.0'] as Record<string, Function>

        const fieldsHandle = types['[constructor]fields']()
        const reqHandle = types['[constructor]request'](fieldsHandle)

        expect(typeof reqHandle).toBe('number')
      })

      it('gets/sets request method', () => {
        const imports = getHttpImports()
        const types = imports['wasi:http/types@0.3.0'] as Record<string, Function>

        const fieldsHandle = types['[constructor]fields']()
        const reqHandle = types['[constructor]request'](fieldsHandle)

        types['[method]request.set-method'](reqHandle, { tag: 'post' })
        const method = types['[method]request.method'](reqHandle)

        expect(method).toEqual({ tag: 'post' })
      })

      it('creates response', () => {
        const imports = getHttpImports()
        const types = imports['wasi:http/types@0.3.0'] as Record<string, Function>

        const fieldsHandle = types['[constructor]fields']()
        const respHandle = types['[constructor]response'](fieldsHandle)

        expect(typeof respHandle).toBe('number')
      })

      it('gets/sets response status', () => {
        const imports = getHttpImports()
        const types = imports['wasi:http/types@0.3.0'] as Record<string, Function>

        const fieldsHandle = types['[constructor]fields']()
        const respHandle = types['[constructor]response'](fieldsHandle)

        types['[method]response.set-status'](respHandle, 404)
        const status = types['[method]response.status'](respHandle)

        expect(status).toBe(404)
      })

      it('drops resources', () => {
        const imports = getHttpImports()
        const types = imports['wasi:http/types@0.3.0'] as Record<string, Function>

        const fieldsHandle = types['[constructor]fields']()
        types['[resource-drop]fields'](fieldsHandle)

        // After drop, get should return empty
        const values = types['[method]fields.get'](fieldsHandle, 'any')
        expect(values).toEqual([])
      })
    })

    describe('outgoing-handler imports', () => {
      it('provides async handle function', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new globalThis.Response('ok', { status: 200 })
        )
        const handler = new OutgoingHandler(mockFetch as unknown as typeof fetch)
        const imports = getHttpImports(handler)
        const outgoing = imports['wasi:http/outgoing-handler@0.3.0'] as Record<string, Function>

        // Create request through types API
        const types = imports['wasi:http/types@0.3.0'] as Record<string, Function>
        const fieldsHandle = types['[constructor]fields']()
        const reqHandle = types['[constructor]request'](fieldsHandle)

        types['[method]request.set-scheme'](reqHandle, { tag: 'HTTP' })
        types['[method]request.set-authority'](reqHandle, 'example.com')
        types['[method]request.set-path-with-query'](reqHandle, '/test')

        const respHandle = await outgoing.handle(reqHandle)
        expect(typeof respHandle).toBe('number')
      })

      it('throws for invalid request handle', async () => {
        const imports = getHttpImports()
        const outgoing = imports['wasi:http/outgoing-handler@0.3.0'] as Record<string, Function>

        await expect(outgoing.handle(9999)).rejects.toThrow('Invalid request handle')
      })
    })
  })
})
