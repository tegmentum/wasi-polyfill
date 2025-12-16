import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  httpTypesPlugin,
  httpOutgoingHandlerPlugin,
  httpIncomingHandlerPlugin,
  httpPlugins,
  HTTP_TYPES_INTERFACE,
  HTTP_OUTGOING_HANDLER_INTERFACE,
  HTTP_INCOMING_HANDLER_INTERFACE,
  Fields,
  FieldsRegistry,
  methodToString,
  stringToMethod,
  schemeToString,
  stringToScheme,
  mapFetchError,
  HttpErrorCode,
  fetchHttpTypesImplementation,
  fetchOutgoingHandlerImplementation,
  stubIncomingHandlerImplementation,
  callbackIncomingHandlerImplementation,
  OutgoingRequestRegistry,
  IncomingResponseRegistry,
  RequestOptionsRegistry,
  IncomingRequestRegistry,
  OutgoingResponseRegistry,
  ResponseOutparamRegistry,
  // Service Worker exports
  ServiceWorkerHandler,
  ServiceWorkerAdapter,
  createServiceWorkerHandler,
  isServiceWorkerContext,
  serviceWorkerIncomingHandlerImplementation,
} from '../../src/plugins/http/index.js'
import type {
  Method,
  Scheme,
  HttpError,
  OutgoingRequest,
  IncomingRequest,
  OutgoingResponse,
} from '../../src/plugins/http/index.js'

describe('wasi:http/types', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(httpTypesPlugin.witInterface.package).toBe('wasi:http')
      expect(httpTypesPlugin.witInterface.name).toBe('types')
      expect(httpTypesPlugin.witInterface.version).toBe('0.2.0')
    })

    it('has fetch as default implementation', () => {
      expect(httpTypesPlugin.defaultImplementation).toBe('fetch')
    })

    it('has correct interface constant', () => {
      expect(HTTP_TYPES_INTERFACE).toEqual({
        package: 'wasi:http',
        name: 'types',
        version: '0.2.0',
      })
    })
  })

  describe('Method type utilities', () => {
    it('converts standard methods to strings', () => {
      expect(methodToString({ tag: 'get' })).toBe('GET')
      expect(methodToString({ tag: 'post' })).toBe('POST')
      expect(methodToString({ tag: 'put' })).toBe('PUT')
      expect(methodToString({ tag: 'delete' })).toBe('DELETE')
      expect(methodToString({ tag: 'head' })).toBe('HEAD')
      expect(methodToString({ tag: 'options' })).toBe('OPTIONS')
      expect(methodToString({ tag: 'patch' })).toBe('PATCH')
      expect(methodToString({ tag: 'connect' })).toBe('CONNECT')
      expect(methodToString({ tag: 'trace' })).toBe('TRACE')
    })

    it('converts custom methods to strings', () => {
      expect(methodToString({ tag: 'other', val: 'CUSTOM' })).toBe('CUSTOM')
    })

    it('parses standard methods from strings', () => {
      expect(stringToMethod('GET')).toEqual({ tag: 'get' })
      expect(stringToMethod('post')).toEqual({ tag: 'post' })
      expect(stringToMethod('Put')).toEqual({ tag: 'put' })
    })

    it('parses custom methods from strings', () => {
      expect(stringToMethod('CUSTOM')).toEqual({ tag: 'other', val: 'CUSTOM' })
    })
  })

  describe('Scheme type utilities', () => {
    it('converts standard schemes to strings', () => {
      expect(schemeToString({ tag: 'http' })).toBe('http')
      expect(schemeToString({ tag: 'https' })).toBe('https')
    })

    it('converts custom schemes to strings', () => {
      expect(schemeToString({ tag: 'other', val: 'ws' })).toBe('ws')
    })

    it('parses standard schemes from strings', () => {
      expect(stringToScheme('http')).toEqual({ tag: 'http' })
      expect(stringToScheme('HTTPS')).toEqual({ tag: 'https' })
    })

    it('parses custom schemes from strings', () => {
      expect(stringToScheme('wss')).toEqual({ tag: 'other', val: 'wss' })
    })
  })

  describe('HttpError mapping', () => {
    it('maps DNS errors', () => {
      const error = mapFetchError(new Error('DNS resolution failed'))
      expect(error.tag).toBe('DNS-error')
    })

    it('maps network errors', () => {
      const error = mapFetchError(new Error('Failed to fetch'))
      expect(error.tag).toBe('destination-unavailable')
    })

    it('maps connection refused', () => {
      const error = mapFetchError(new Error('Connection refused'))
      expect(error.tag).toBe('connection-refused')
    })

    it('maps timeout errors', () => {
      const error = mapFetchError(new Error('Request timed out'))
      expect(error.tag).toBe('connection-timeout')
    })

    it('maps abort errors', () => {
      const error = mapFetchError(new Error('Request aborted'))
      expect(error.tag).toBe('connection-terminated')
    })

    it('maps TLS/SSL errors', () => {
      const error = mapFetchError(new Error('SSL certificate error'))
      expect(error.tag).toBe('TLS-certificate-error')
    })

    it('maps CORS errors', () => {
      const error = mapFetchError(new Error('CORS policy blocked'))
      expect(error.tag).toBe('HTTP-request-denied')
    })

    it('maps unknown errors to internal-error', () => {
      const error = mapFetchError(new Error('Something strange happened'))
      expect(error.tag).toBe('internal-error')
      if (error.tag === 'internal-error') {
        expect(error.val).toBe('Something strange happened')
      }
    })
  })

  describe('HttpErrorCode enum', () => {
    it('has expected error codes', () => {
      expect(HttpErrorCode.DnsTimeout).toBe('DNS-timeout')
      expect(HttpErrorCode.ConnectionRefused).toBe('connection-refused')
      expect(HttpErrorCode.InternalError).toBe('internal-error')
    })
  })
})

describe('Fields resource', () => {
  let fields: Fields

  beforeEach(() => {
    fields = new Fields()
  })

  describe('basic operations', () => {
    it('creates empty fields', () => {
      expect(fields.getEntries()).toEqual([])
      expect(fields.getNames()).toEqual([])
    })

    it('creates fields from entries', () => {
      const entries: [string, Uint8Array][] = [
        ['content-type', new TextEncoder().encode('text/plain')],
        ['x-custom', new TextEncoder().encode('value')],
      ]
      const f = new Fields(entries)
      expect(f.getNames()).toContain('content-type')
      expect(f.getNames()).toContain('x-custom')
    })

    it('appends and retrieves values', () => {
      fields.append('content-type', new TextEncoder().encode('text/html'))
      const values = fields.get('content-type')
      expect(values.length).toBe(1)
      expect(new TextDecoder().decode(values[0])).toBe('text/html')
    })

    it('sets and replaces values', () => {
      fields.append('x-custom', new TextEncoder().encode('first'))
      fields.set('x-custom', new TextEncoder().encode('second'))
      const values = fields.get('x-custom')
      expect(values.length).toBe(1)
      expect(new TextDecoder().decode(values[0])).toBe('second')
    })

    it('handles multiple values for same header', () => {
      fields.append('set-cookie', new TextEncoder().encode('cookie1=value1'))
      fields.append('set-cookie', new TextEncoder().encode('cookie2=value2'))
      const values = fields.get('set-cookie')
      expect(values.length).toBe(2)
    })

    it('checks header existence', () => {
      expect(fields.has('content-type')).toBe(false)
      fields.append('content-type', new TextEncoder().encode('text/plain'))
      expect(fields.has('content-type')).toBe(true)
    })

    it('deletes headers', () => {
      fields.append('x-custom', new TextEncoder().encode('value'))
      expect(fields.has('x-custom')).toBe(true)
      fields.delete('x-custom')
      expect(fields.has('x-custom')).toBe(false)
    })

    it('normalizes header names to lowercase', () => {
      fields.append('Content-Type', new TextEncoder().encode('text/plain'))
      expect(fields.has('content-type')).toBe(true)
      expect(fields.get('CONTENT-TYPE').length).toBe(1)
    })
  })

  describe('immutability', () => {
    it('can be frozen', () => {
      fields.append('x-custom', new TextEncoder().encode('value'))
      fields.freeze()
      expect(fields.isFrozen()).toBe(true)
    })

    it('rejects mutations when frozen', () => {
      fields.freeze()
      const error = fields.append('x-new', new TextEncoder().encode('value'))
      expect(error).toBeDefined()
    })
  })

  describe('cloning', () => {
    it('creates a deep clone', () => {
      fields.append('x-custom', new TextEncoder().encode('value'))
      const cloned = fields.clone()

      // Modify original
      fields.append('x-other', new TextEncoder().encode('other'))

      // Clone should not be affected
      expect(cloned.has('x-other')).toBe(false)
      expect(cloned.has('x-custom')).toBe(true)
    })
  })

  describe('Headers conversion', () => {
    it('converts to Headers object', () => {
      fields.append('content-type', new TextEncoder().encode('application/json'))
      fields.append('x-custom', new TextEncoder().encode('value'))

      const headers = fields.toHeaders()
      expect(headers.get('content-type')).toBe('application/json')
      expect(headers.get('x-custom')).toBe('value')
    })

    it('creates from Headers object', () => {
      const headers = new Headers()
      headers.set('content-type', 'text/plain')
      headers.set('x-custom', 'value')

      const f = Fields.fromHeaders(headers)
      expect(new TextDecoder().decode(f.get('content-type')[0])).toBe('text/plain')
      expect(new TextDecoder().decode(f.get('x-custom')[0])).toBe('value')
    })
  })
})

describe('FieldsRegistry', () => {
  let registry: FieldsRegistry

  beforeEach(() => {
    registry = new FieldsRegistry()
  })

  it('registers and retrieves fields', () => {
    const fields = new Fields()
    const handle = registry.register(fields)
    expect(registry.get(handle)).toBe(fields)
  })

  it('returns unique handles', () => {
    const handle1 = registry.register(new Fields())
    const handle2 = registry.register(new Fields())
    expect(handle1).not.toBe(handle2)
  })

  it('drops fields', () => {
    const handle = registry.register(new Fields())
    expect(registry.drop(handle)).toBe(true)
    expect(registry.get(handle)).toBeUndefined()
  })

  it('tracks size', () => {
    expect(registry.size).toBe(0)
    registry.register(new Fields())
    expect(registry.size).toBe(1)
    registry.register(new Fields())
    expect(registry.size).toBe(2)
  })
})

describe('wasi:http/outgoing-handler', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(httpOutgoingHandlerPlugin.witInterface.package).toBe('wasi:http')
      expect(httpOutgoingHandlerPlugin.witInterface.name).toBe('outgoing-handler')
      expect(httpOutgoingHandlerPlugin.witInterface.version).toBe('0.2.0')
    })

    it('has fetch as default implementation', () => {
      expect(httpOutgoingHandlerPlugin.defaultImplementation).toBe('fetch')
    })

    it('has correct interface constant', () => {
      expect(HTTP_OUTGOING_HANDLER_INTERFACE).toEqual({
        package: 'wasi:http',
        name: 'outgoing-handler',
        version: '0.2.0',
      })
    })
  })

  describe('OutgoingRequestRegistry', () => {
    let registry: OutgoingRequestRegistry

    beforeEach(() => {
      registry = new OutgoingRequestRegistry()
    })

    it('registers and retrieves requests', () => {
      const request: OutgoingRequest = {
        handle: 0,
        method: { tag: 'get' },
        headers: 1,
      }
      const handle = registry.register(request)
      expect(registry.get(handle)).toBe(request)
    })

    it('drops requests', () => {
      const request: OutgoingRequest = {
        handle: 0,
        method: { tag: 'get' },
        headers: 1,
      }
      const handle = registry.register(request)
      expect(registry.drop(handle)).toBe(true)
      expect(registry.get(handle)).toBeUndefined()
    })
  })

  describe('RequestOptionsRegistry', () => {
    let registry: RequestOptionsRegistry

    beforeEach(() => {
      registry = new RequestOptionsRegistry()
    })

    it('registers and retrieves options', () => {
      const opts = {
        handle: 0,
        options: { connectTimeout: 5000n },
      }
      const handle = registry.register(opts)
      expect(registry.get(handle)).toBe(opts)
    })
  })

  describe('fetch implementation', () => {
    it('creates an instance', () => {
      const instance = fetchOutgoingHandlerImplementation.create({})
      expect(instance).toBeDefined()
      expect(instance.getImports()).toBeDefined()
    })

    it('exposes handle function', () => {
      const instance = fetchOutgoingHandlerImplementation.create({})
      const imports = instance.getImports()
      expect(imports['handle']).toBeDefined()
      expect(typeof imports['handle']).toBe('function')
    })
  })

  describe('HTTP types implementation', () => {
    it('creates an instance', () => {
      const instance = fetchHttpTypesImplementation.create({})
      expect(instance).toBeDefined()
    })

    it('exposes fields constructor', () => {
      const instance = fetchHttpTypesImplementation.create({})
      const imports = instance.getImports()
      expect(imports['[constructor]fields']).toBeDefined()
    })

    it('exposes outgoing-request constructor', () => {
      const instance = fetchHttpTypesImplementation.create({})
      const imports = instance.getImports()
      expect(imports['[constructor]outgoing-request']).toBeDefined()
    })

    it('exposes request-options constructor', () => {
      const instance = fetchHttpTypesImplementation.create({})
      const imports = instance.getImports()
      expect(imports['[constructor]request-options']).toBeDefined()
    })
  })
})

describe('wasi:http/incoming-handler', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(httpIncomingHandlerPlugin.witInterface.package).toBe('wasi:http')
      expect(httpIncomingHandlerPlugin.witInterface.name).toBe('incoming-handler')
      expect(httpIncomingHandlerPlugin.witInterface.version).toBe('0.2.0')
    })

    it('has stub as default implementation', () => {
      expect(httpIncomingHandlerPlugin.defaultImplementation).toBe('stub')
    })

    it('has correct interface constant', () => {
      expect(HTTP_INCOMING_HANDLER_INTERFACE).toEqual({
        package: 'wasi:http',
        name: 'incoming-handler',
        version: '0.2.0',
      })
    })
  })

  describe('IncomingRequestRegistry', () => {
    let registry: IncomingRequestRegistry

    beforeEach(() => {
      registry = new IncomingRequestRegistry()
    })

    it('registers and retrieves requests', () => {
      const request: IncomingRequest = {
        handle: 0,
        method: { tag: 'get' },
        headers: 1,
      }
      const handle = registry.register(request)
      expect(registry.get(handle)).toBe(request)
    })

    it('drops requests', () => {
      const request: IncomingRequest = {
        handle: 0,
        method: { tag: 'get' },
        headers: 1,
      }
      const handle = registry.register(request)
      expect(registry.drop(handle)).toBe(true)
      expect(registry.get(handle)).toBeUndefined()
    })
  })

  describe('OutgoingResponseRegistry', () => {
    let registry: OutgoingResponseRegistry

    beforeEach(() => {
      registry = new OutgoingResponseRegistry()
    })

    it('registers and retrieves responses', () => {
      const response: OutgoingResponse = {
        handle: 0,
        status: 200,
        headers: 1,
      }
      const handle = registry.register(response)
      expect(registry.get(handle)).toBe(response)
    })
  })

  describe('ResponseOutparamRegistry', () => {
    let registry: ResponseOutparamRegistry

    beforeEach(() => {
      registry = new ResponseOutparamRegistry()
    })

    it('registers and retrieves outparams', () => {
      const outparam = {
        handle: 0,
        set: false,
      }
      const handle = registry.register(outparam)
      expect(registry.get(handle)).toBe(outparam)
    })
  })

  describe('stub implementation', () => {
    it('creates an instance', () => {
      const instance = stubIncomingHandlerImplementation.create({})
      expect(instance).toBeDefined()
      expect(instance.getImports()).toBeDefined()
    })

    it('exposes handle function', () => {
      const instance = stubIncomingHandlerImplementation.create({})
      const imports = instance.getImports()
      expect(imports['handle']).toBeDefined()
      expect(typeof imports['handle']).toBe('function')
    })
  })

  describe('callback implementation', () => {
    it('creates an instance', () => {
      const instance = callbackIncomingHandlerImplementation.create({})
      expect(instance).toBeDefined()
    })

    it('accepts handler option', () => {
      const handler = vi.fn()
      const instance = callbackIncomingHandlerImplementation.create({
        options: { handler },
      })
      expect(instance).toBeDefined()
    })
  })
})

describe('httpPlugins array', () => {
  it('contains all HTTP plugins', () => {
    expect(httpPlugins.length).toBe(3)
    expect(httpPlugins).toContain(httpTypesPlugin)
    expect(httpPlugins).toContain(httpOutgoingHandlerPlugin)
    expect(httpPlugins).toContain(httpIncomingHandlerPlugin)
  })
})

describe('Service Worker Integration', () => {
  describe('Exports', () => {
    it('should export ServiceWorkerHandler class', () => {
      expect(ServiceWorkerHandler).toBeDefined()
      expect(typeof ServiceWorkerHandler).toBe('function')
    })

    it('should export ServiceWorkerAdapter class', () => {
      expect(ServiceWorkerAdapter).toBeDefined()
      expect(typeof ServiceWorkerAdapter).toBe('function')
    })

    it('should export createServiceWorkerHandler function', () => {
      expect(createServiceWorkerHandler).toBeDefined()
      expect(typeof createServiceWorkerHandler).toBe('function')
    })

    it('should export isServiceWorkerContext function', () => {
      expect(isServiceWorkerContext).toBeDefined()
      expect(typeof isServiceWorkerContext).toBe('function')
    })

    it('should export serviceWorkerIncomingHandlerImplementation', () => {
      expect(serviceWorkerIncomingHandlerImplementation).toBeDefined()
      expect(serviceWorkerIncomingHandlerImplementation.name).toBe('service-worker')
      expect(serviceWorkerIncomingHandlerImplementation.description).toContain('Service Worker')
    })
  })

  describe('isServiceWorkerContext', () => {
    it('should return false in Node.js environment', () => {
      // In Node.js, we're not in a Service Worker context
      expect(isServiceWorkerContext()).toBe(false)
    })
  })

  describe('Plugin Registration', () => {
    it('should include service-worker implementation in incoming handler plugin', () => {
      expect(httpIncomingHandlerPlugin.implementations.has('service-worker')).toBe(true)
      const impl = httpIncomingHandlerPlugin.implementations.get('service-worker')
      expect(impl).toBe(serviceWorkerIncomingHandlerImplementation)
    })

    it('should have stub as default implementation', () => {
      expect(httpIncomingHandlerPlugin.defaultImplementation).toBe('stub')
    })

    it('should have all three implementations', () => {
      expect(httpIncomingHandlerPlugin.implementations.size).toBe(3)
      expect(httpIncomingHandlerPlugin.implementations.has('stub')).toBe(true)
      expect(httpIncomingHandlerPlugin.implementations.has('callback')).toBe(true)
      expect(httpIncomingHandlerPlugin.implementations.has('service-worker')).toBe(true)
    })
  })

  describe('ServiceWorkerHandler', () => {
    it('should throw if neither wasmInstance nor handleFunction provided', () => {
      expect(() => {
        new ServiceWorkerHandler({})
      }).toThrow('Either wasmInstance or handleFunction must be provided')
    })

    it('should accept handleFunction config', () => {
      const mockHandler = vi.fn().mockResolvedValue(undefined)
      const handler = new ServiceWorkerHandler({
        handleFunction: mockHandler,
      })
      expect(handler).toBeDefined()
    })

    it('should have shouldHandle method', () => {
      const mockHandler = vi.fn().mockResolvedValue(undefined)
      const handler = new ServiceWorkerHandler({
        handleFunction: mockHandler,
      })
      expect(typeof handler.shouldHandle).toBe('function')
    })

    it('should return true from shouldHandle when no patterns', () => {
      const mockHandler = vi.fn().mockResolvedValue(undefined)
      const handler = new ServiceWorkerHandler({
        handleFunction: mockHandler,
      })
      const request = new Request('https://example.com/test')
      expect(handler.shouldHandle(request)).toBe(true)
    })

    it('should respect URL patterns', () => {
      const mockHandler = vi.fn().mockResolvedValue(undefined)
      const handler = new ServiceWorkerHandler({
        handleFunction: mockHandler,
        urlPatterns: [
          { test: (url: string) => url.includes('/api/') },
        ],
      })
      expect(handler.shouldHandle(new Request('https://example.com/api/test'))).toBe(true)
      expect(handler.shouldHandle(new Request('https://example.com/other'))).toBe(false)
    })
  })

  describe('ServiceWorkerAdapter', () => {
    it('should create adapter instance', () => {
      const adapter = new ServiceWorkerAdapter()
      expect(adapter).toBeDefined()
    })

    it('should have initialize method', () => {
      const adapter = new ServiceWorkerAdapter()
      expect(typeof adapter.initialize).toBe('function')
    })

    it('should have handleRequest method', () => {
      const adapter = new ServiceWorkerAdapter()
      expect(typeof adapter.handleRequest).toBe('function')
    })

    it('should have canHandle method', () => {
      const adapter = new ServiceWorkerAdapter()
      expect(typeof adapter.canHandle).toBe('function')
    })

    it('should return false from canHandle before initialization', () => {
      const adapter = new ServiceWorkerAdapter()
      const request = new Request('https://example.com/test')
      expect(adapter.canHandle(request)).toBe(false)
    })

    it('should throw from handleRequest before initialization', async () => {
      const adapter = new ServiceWorkerAdapter()
      const request = new Request('https://example.com/test')
      await expect(adapter.handleRequest(request)).rejects.toThrow('Adapter not initialized')
    })
  })

  describe('createServiceWorkerHandler', () => {
    it('should create fetch handler function', () => {
      const mockHandleFunction = vi.fn().mockResolvedValue(undefined)
      const handler = createServiceWorkerHandler({
        handleFunction: mockHandleFunction,
      })
      expect(typeof handler).toBe('function')
    })

    it('should return function that accepts Request', async () => {
      const mockHandleFunction = vi.fn().mockResolvedValue(undefined)
      const handler = createServiceWorkerHandler({
        handleFunction: mockHandleFunction,
      })

      const request = new Request('https://example.com/test')
      const responsePromise = handler(request)
      expect(responsePromise).toBeInstanceOf(Promise)
    })
  })

  describe('serviceWorkerIncomingHandlerImplementation', () => {
    it('should create plugin instance', () => {
      const instance = serviceWorkerIncomingHandlerImplementation.create({})
      expect(instance).toBeDefined()
      expect(typeof instance.getImports).toBe('function')
    })

    it('should accept configuration options', () => {
      const instance = serviceWorkerIncomingHandlerImplementation.create({
        options: {
          fallthrough: false,
          urlPatterns: [{ test: () => true }],
        },
      })
      expect(instance).toBeDefined()
    })

    it('should provide create-handler and handle imports', () => {
      const instance = serviceWorkerIncomingHandlerImplementation.create({})
      const imports = instance.getImports()
      expect(imports['create-handler']).toBeDefined()
      expect(imports['handle']).toBeDefined()
    })
  })
})
