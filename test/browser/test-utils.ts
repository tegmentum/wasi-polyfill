/**
 * Test utilities for browser interface testing
 *
 * Provides mock implementations of browser APIs for unit testing
 * in Node.js environment.
 */

import { vi, type Mock } from 'vitest'

// =============================================================================
// Storage Mocks
// =============================================================================

/**
 * Create a mock Storage implementation
 */
export function createMockStorage(): Storage {
  const store = new Map<string, string>()

  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
    clear: vi.fn(() => {
      store.clear()
    }),
    key: vi.fn((index: number) => {
      const keys = Array.from(store.keys())
      return keys[index] ?? null
    }),
    get length() {
      return store.size
    },
  }
}

// =============================================================================
// Console Mocks
// =============================================================================

/**
 * Create a mock console with captured calls
 */
export function createMockConsole(): Console & { getCalls(): Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    log: [],
    info: [],
    warn: [],
    error: [],
    debug: [],
    trace: [],
    dir: [],
    table: [],
    group: [],
    groupEnd: [],
    groupCollapsed: [],
    time: [],
    timeEnd: [],
    timeLog: [],
    clear: [],
    count: [],
    countReset: [],
    assert: [],
  }

  const mockConsole = {
    log: vi.fn((...args: unknown[]) => calls.log.push(args)),
    info: vi.fn((...args: unknown[]) => calls.info.push(args)),
    warn: vi.fn((...args: unknown[]) => calls.warn.push(args)),
    error: vi.fn((...args: unknown[]) => calls.error.push(args)),
    debug: vi.fn((...args: unknown[]) => calls.debug.push(args)),
    trace: vi.fn((...args: unknown[]) => calls.trace.push(args)),
    dir: vi.fn((...args: unknown[]) => calls.dir.push(args)),
    table: vi.fn((...args: unknown[]) => calls.table.push(args)),
    group: vi.fn((...args: unknown[]) => calls.group.push(args)),
    groupEnd: vi.fn(() => calls.groupEnd.push([])),
    groupCollapsed: vi.fn((...args: unknown[]) => calls.groupCollapsed.push(args)),
    time: vi.fn((label?: string) => calls.time.push([label])),
    timeEnd: vi.fn((label?: string) => calls.timeEnd.push([label])),
    timeLog: vi.fn((label?: string, ...args: unknown[]) => calls.timeLog.push([label, ...args])),
    clear: vi.fn(() => calls.clear.push([])),
    count: vi.fn((label?: string) => calls.count.push([label])),
    countReset: vi.fn((label?: string) => calls.countReset.push([label])),
    assert: vi.fn((condition?: boolean, ...args: unknown[]) => {
      if (!condition) calls.assert.push(args)
    }),
    getCalls: () => calls,
  }

  return mockConsole as Console & { getCalls(): Record<string, unknown[][]> }
}

// =============================================================================
// Performance Mocks
// =============================================================================

/**
 * Create a mock Performance implementation
 */
export function createMockPerformance(): Performance {
  let now = 0
  const marks = new Map<string, PerformanceMark>()
  const measures = new Map<string, PerformanceMeasure>()
  const entries: PerformanceEntry[] = []

  return {
    now: vi.fn(() => now),
    timeOrigin: Date.now(),
    mark: vi.fn((name: string, options?: PerformanceMarkOptions) => {
      const mark = {
        name,
        entryType: 'mark',
        startTime: now,
        duration: 0,
        detail: options?.detail,
        toJSON: () => ({ name, entryType: 'mark', startTime: now, duration: 0 }),
      } as PerformanceMark
      marks.set(name, mark)
      entries.push(mark)
      return mark
    }),
    measure: vi.fn((name: string, startMarkOrOptions?: string | PerformanceMeasureOptions, endMark?: string) => {
      let startTime = 0
      let endTime = now

      if (typeof startMarkOrOptions === 'string') {
        const start = marks.get(startMarkOrOptions)
        if (start) startTime = start.startTime
        if (endMark) {
          const end = marks.get(endMark)
          if (end) endTime = end.startTime
        }
      } else if (startMarkOrOptions) {
        if (startMarkOrOptions.start) {
          if (typeof startMarkOrOptions.start === 'string') {
            const start = marks.get(startMarkOrOptions.start)
            if (start) startTime = start.startTime
          } else {
            startTime = startMarkOrOptions.start
          }
        }
        if (startMarkOrOptions.end) {
          if (typeof startMarkOrOptions.end === 'string') {
            const end = marks.get(startMarkOrOptions.end)
            if (end) endTime = end.startTime
          } else {
            endTime = startMarkOrOptions.end
          }
        }
        if (startMarkOrOptions.duration !== undefined) {
          endTime = startTime + startMarkOrOptions.duration
        }
      }

      const measure = {
        name,
        entryType: 'measure',
        startTime,
        duration: endTime - startTime,
        detail: typeof startMarkOrOptions === 'object' ? startMarkOrOptions.detail : undefined,
        toJSON: () => ({ name, entryType: 'measure', startTime, duration: endTime - startTime }),
      } as PerformanceMeasure
      measures.set(name, measure)
      entries.push(measure)
      return measure
    }),
    clearMarks: vi.fn((name?: string) => {
      if (name) {
        marks.delete(name)
      } else {
        marks.clear()
      }
    }),
    clearMeasures: vi.fn((name?: string) => {
      if (name) {
        measures.delete(name)
      } else {
        measures.clear()
      }
    }),
    getEntries: vi.fn(() => [...entries]),
    getEntriesByName: vi.fn((name: string) => entries.filter(e => e.name === name)),
    getEntriesByType: vi.fn((type: string) => entries.filter(e => e.entryType === type)),
    clearResourceTimings: vi.fn(),
    setResourceTimingBufferSize: vi.fn(),
    toJSON: vi.fn(() => ({ timeOrigin: Date.now() })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    // Helper to advance time in tests
    _advanceTime: (ms: number) => { now += ms },
  } as unknown as Performance
}

// =============================================================================
// Navigator Mocks
// =============================================================================

/**
 * Create a mock Navigator
 */
export function createMockNavigator(options: {
  userAgent?: string
  language?: string
  languages?: string[]
  onLine?: boolean
  vibrate?: boolean
  geolocation?: boolean
  clipboard?: boolean
  mediaDevices?: boolean
} = {}): Partial<Navigator> {
  const nav: Partial<Navigator> = {
    userAgent: options.userAgent ?? 'MockBrowser/1.0',
    language: options.language ?? 'en-US',
    languages: options.languages ?? ['en-US', 'en'],
    onLine: options.onLine ?? true,
    hardwareConcurrency: 4,
    maxTouchPoints: 0,
    cookieEnabled: true,
    pdfViewerEnabled: false,
    webdriver: false,
  }

  if (options.vibrate !== false) {
    nav.vibrate = vi.fn((pattern: VibratePattern) => true)
  }

  if (options.clipboard !== false) {
    nav.clipboard = {
      readText: vi.fn().mockResolvedValue(''),
      writeText: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue([]),
      write: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }
  }

  if (options.geolocation !== false) {
    nav.geolocation = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracy: 10,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        })
      }),
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    }
  }

  return nav
}

// =============================================================================
// Screen Mocks
// =============================================================================

/**
 * Create a mock Screen
 */
export function createMockScreen(options: {
  width?: number
  height?: number
  colorDepth?: number
  orientation?: OrientationType
} = {}): Screen {
  return {
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    availWidth: options.width ?? 1920,
    availHeight: (options.height ?? 1080) - 40,
    colorDepth: options.colorDepth ?? 24,
    pixelDepth: options.colorDepth ?? 24,
    orientation: {
      type: options.orientation ?? 'landscape-primary',
      angle: options.orientation?.includes('portrait') ? 0 : 90,
      lock: vi.fn().mockResolvedValue(undefined),
      unlock: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      onchange: null,
    },
  } as unknown as Screen
}

// =============================================================================
// History Mocks
// =============================================================================

/**
 * Create a mock History
 */
export function createMockHistory(): History {
  const states: { data: unknown; title: string; url?: string }[] = [{ data: null, title: '', url: '/' }]
  let index = 0

  return {
    get length() { return states.length },
    get state() { return states[index]?.data ?? null },
    scrollRestoration: 'auto',
    pushState: vi.fn((data: unknown, title: string, url?: string | URL | null) => {
      // Remove forward history
      states.splice(index + 1)
      states.push({ data, title, url: url?.toString() })
      index = states.length - 1
    }),
    replaceState: vi.fn((data: unknown, title: string, url?: string | URL | null) => {
      states[index] = { data, title, url: url?.toString() }
    }),
    back: vi.fn(() => {
      if (index > 0) index--
    }),
    forward: vi.fn(() => {
      if (index < states.length - 1) index++
    }),
    go: vi.fn((delta?: number) => {
      const newIndex = index + (delta ?? 0)
      if (newIndex >= 0 && newIndex < states.length) {
        index = newIndex
      }
    }),
  } as History
}

// =============================================================================
// Location Mocks
// =============================================================================

/**
 * Create a mock Location
 */
export function createMockLocation(url = 'http://localhost:3000/'): Location {
  const parsed = new URL(url)

  return {
    href: parsed.href,
    protocol: parsed.protocol,
    host: parsed.host,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    origin: parsed.origin,
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    toString: () => parsed.href,
    ancestorOrigins: {
      length: 0,
      item: () => null,
      contains: () => false,
      [Symbol.iterator]: function* () {},
    },
  } as Location
}

// =============================================================================
// Document Mocks
// =============================================================================

/**
 * Create a mock Document (minimal)
 */
export function createMockDocument(): Partial<Document> {
  let fullscreenElement: Element | null = null

  return {
    fullscreenElement,
    fullscreenEnabled: true,
    exitFullscreen: vi.fn().mockImplementation(() => {
      fullscreenElement = null
      return Promise.resolve()
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    visibilityState: 'visible',
    hidden: false,
  }
}

// =============================================================================
// Fetch Mocks
// =============================================================================

export interface MockFetchOptions {
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: unknown
  ok?: boolean
}

/**
 * Create a mock fetch function
 */
export function createMockFetch(defaultResponse?: MockFetchOptions): typeof fetch & { setResponse: (url: string, options: MockFetchOptions) => void } {
  const responses = new Map<string, MockFetchOptions>()

  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const response = responses.get(url) ?? defaultResponse ?? { status: 200, ok: true }

    return {
      ok: response.ok ?? ((response.status ?? 200) >= 200 && (response.status ?? 200) < 300),
      status: response.status ?? 200,
      statusText: response.statusText ?? 'OK',
      headers: new Headers(response.headers),
      url,
      redirected: false,
      type: 'basic' as ResponseType,
      body: null,
      bodyUsed: false,
      clone: vi.fn(),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      blob: vi.fn().mockResolvedValue(new Blob()),
      formData: vi.fn().mockResolvedValue(new FormData()),
      json: vi.fn().mockResolvedValue(response.body ?? {}),
      text: vi.fn().mockResolvedValue(
        typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? '')
      ),
    } as unknown as Response
  })

  ;(mockFetch as typeof fetch & { setResponse: (url: string, options: MockFetchOptions) => void }).setResponse = (url: string, options: MockFetchOptions) => {
    responses.set(url, options)
  }

  return mockFetch as typeof fetch & { setResponse: (url: string, options: MockFetchOptions) => void }
}

// =============================================================================
// WebSocket Mocks
// =============================================================================

/**
 * Create a mock WebSocket class
 */
export function createMockWebSocketClass(): typeof WebSocket {
  return class MockWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    url: string
    readyState = 0
    bufferedAmount = 0
    extensions = ''
    protocol = ''
    binaryType: BinaryType = 'blob'

    onopen: ((event: Event) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null

    constructor(url: string | URL, protocols?: string | string[]) {
      this.url = url.toString()
      if (protocols) {
        this.protocol = Array.isArray(protocols) ? protocols[0] ?? '' : protocols
      }

      // Auto-open after brief delay
      setTimeout(() => {
        this.readyState = 1
        if (this.onopen) {
          this.onopen(new Event('open'))
        }
      }, 10)
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== 1) {
        throw new Error('WebSocket is not open')
      }
    }

    close(code?: number, reason?: string) {
      this.readyState = 2
      setTimeout(() => {
        this.readyState = 3
        if (this.onclose) {
          this.onclose(new CloseEvent('close', { code: code ?? 1000, reason: reason ?? '' }))
        }
      }, 10)
    }

    addEventListener = vi.fn()
    removeEventListener = vi.fn()
    dispatchEvent = vi.fn(() => true)

    // Test helper to simulate receiving a message
    _receiveMessage(data: unknown) {
      if (this.onmessage) {
        this.onmessage(new MessageEvent('message', { data }))
      }
    }

    // Test helper to simulate error
    _simulateError() {
      if (this.onerror) {
        this.onerror(new Event('error'))
      }
    }
  } as unknown as typeof WebSocket
}

// =============================================================================
// BroadcastChannel Mocks
// =============================================================================

/**
 * Create a mock BroadcastChannel class
 */
export function createMockBroadcastChannelClass(): typeof BroadcastChannel {
  const channels = new Map<string, Set<MockBroadcastChannel>>()

  class MockBroadcastChannel {
    name: string
    onmessage: ((event: MessageEvent) => void) | null = null
    onmessageerror: ((event: MessageEvent) => void) | null = null

    constructor(name: string) {
      this.name = name
      if (!channels.has(name)) {
        channels.set(name, new Set())
      }
      channels.get(name)!.add(this)
    }

    postMessage(message: unknown) {
      const peers = channels.get(this.name)
      if (peers) {
        for (const peer of peers) {
          if (peer !== this && peer.onmessage) {
            peer.onmessage(new MessageEvent('message', {
              data: message,
              origin: 'http://localhost',
            }))
          }
        }
      }
    }

    close() {
      const peers = channels.get(this.name)
      if (peers) {
        peers.delete(this)
      }
    }

    addEventListener = vi.fn()
    removeEventListener = vi.fn()
    dispatchEvent = vi.fn(() => true)
  }

  return MockBroadcastChannel as unknown as typeof BroadcastChannel
}

// =============================================================================
// Notification Mocks
// =============================================================================

/**
 * Create a mock Notification class
 */
export function createMockNotificationClass(permission: NotificationPermission = 'granted'): typeof Notification {
  return class MockNotification {
    static permission = permission
    static maxActions = 2

    static requestPermission = vi.fn().mockResolvedValue(permission)

    title: string
    options: NotificationOptions

    body?: string
    icon?: string
    tag?: string

    onclick: ((event: Event) => void) | null = null
    onclose: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onshow: ((event: Event) => void) | null = null

    constructor(title: string, options?: NotificationOptions) {
      this.title = title
      this.options = options ?? {}
      this.body = options?.body
      this.icon = options?.icon
      this.tag = options?.tag
    }

    close = vi.fn()
    addEventListener = vi.fn()
    removeEventListener = vi.fn()
    dispatchEvent = vi.fn(() => true)
  } as unknown as typeof Notification
}

// =============================================================================
// IndexedDB Mocks
// =============================================================================

/**
 * Create a simple mock IndexedDB factory
 */
export function createMockIndexedDB(): IDBFactory {
  const databases = new Map<string, Map<string, Map<string, unknown>>>()

  return {
    open: vi.fn((name: string, version?: number) => {
      const request = {
        result: null as unknown as IDBDatabase,
        error: null as DOMException | null,
        source: null,
        transaction: null,
        readyState: 'pending' as IDBRequestReadyState,
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
        onblocked: null as ((event: Event) => void) | null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      }

      if (!databases.has(name)) {
        databases.set(name, new Map())
      }

      setTimeout(() => {
        request.readyState = 'done'
        request.result = {
          name,
          version: version ?? 1,
          objectStoreNames: {
            length: 0,
            contains: () => false,
            item: () => null,
            [Symbol.iterator]: function* () {},
          },
          close: vi.fn(),
          createObjectStore: vi.fn(),
          deleteObjectStore: vi.fn(),
          transaction: vi.fn(),
          onabort: null,
          onclose: null,
          onerror: null,
          onversionchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        } as unknown as IDBDatabase

        if (request.onsuccess) {
          request.onsuccess(new Event('success'))
        }
      }, 0)

      return request as IDBOpenDBRequest
    }),
    deleteDatabase: vi.fn((name: string) => {
      databases.delete(name)
      const request = {
        result: undefined,
        error: null,
        source: null,
        transaction: null,
        readyState: 'done' as IDBRequestReadyState,
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onblocked: null as ((event: Event) => void) | null,
        onupgradeneeded: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      }
      return request as IDBOpenDBRequest
    }),
    databases: vi.fn().mockResolvedValue([]),
    cmp: vi.fn((a, b) => a < b ? -1 : a > b ? 1 : 0),
  }
}

// =============================================================================
// Setup Helpers
// =============================================================================

/**
 * Setup global browser mocks for testing
 */
export function setupBrowserMocks(options: {
  storage?: boolean
  console?: boolean
  performance?: boolean
  navigator?: Parameters<typeof createMockNavigator>[0]
  screen?: Parameters<typeof createMockScreen>[0]
  history?: boolean
  location?: string
  document?: boolean
  fetch?: MockFetchOptions
  WebSocket?: boolean
  BroadcastChannel?: boolean
  Notification?: NotificationPermission
  indexedDB?: boolean
} = {}): () => void {
  const cleanups: (() => void)[] = []
  const originalValues: Record<string, unknown> = {}

  if (options.storage !== false) {
    originalValues.localStorage = globalThis.localStorage
    originalValues.sessionStorage = globalThis.sessionStorage
    ;(globalThis as unknown as Record<string, unknown>).localStorage = createMockStorage()
    ;(globalThis as unknown as Record<string, unknown>).sessionStorage = createMockStorage()
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).localStorage = originalValues.localStorage
      ;(globalThis as unknown as Record<string, unknown>).sessionStorage = originalValues.sessionStorage
    })
  }

  if (options.performance !== false) {
    originalValues.performance = globalThis.performance
    ;(globalThis as unknown as Record<string, unknown>).performance = createMockPerformance()
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).performance = originalValues.performance
    })
  }

  if (options.navigator) {
    originalValues.navigator = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      value: createMockNavigator(options.navigator),
      writable: true,
      configurable: true,
    })
    cleanups.push(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalValues.navigator,
        writable: true,
        configurable: true,
      })
    })
  }

  if (options.screen) {
    originalValues.screen = globalThis.screen
    ;(globalThis as unknown as Record<string, unknown>).screen = createMockScreen(options.screen)
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).screen = originalValues.screen
    })
  }

  if (options.history !== false) {
    originalValues.history = globalThis.history
    ;(globalThis as unknown as Record<string, unknown>).history = createMockHistory()
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).history = originalValues.history
    })
  }

  if (options.location) {
    originalValues.location = globalThis.location
    ;(globalThis as unknown as Record<string, unknown>).location = createMockLocation(options.location)
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).location = originalValues.location
    })
  }

  if (options.document !== false) {
    originalValues.document = globalThis.document
    ;(globalThis as unknown as Record<string, unknown>).document = createMockDocument()
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).document = originalValues.document
    })
  }

  if (options.fetch) {
    originalValues.fetch = globalThis.fetch
    ;(globalThis as unknown as Record<string, unknown>).fetch = createMockFetch(options.fetch)
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).fetch = originalValues.fetch
    })
  }

  if (options.WebSocket !== false) {
    originalValues.WebSocket = globalThis.WebSocket
    ;(globalThis as unknown as Record<string, unknown>).WebSocket = createMockWebSocketClass()
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).WebSocket = originalValues.WebSocket
    })
  }

  if (options.BroadcastChannel !== false) {
    originalValues.BroadcastChannel = globalThis.BroadcastChannel
    ;(globalThis as unknown as Record<string, unknown>).BroadcastChannel = createMockBroadcastChannelClass()
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).BroadcastChannel = originalValues.BroadcastChannel
    })
  }

  if (options.Notification) {
    originalValues.Notification = globalThis.Notification
    ;(globalThis as unknown as Record<string, unknown>).Notification = createMockNotificationClass(options.Notification)
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).Notification = originalValues.Notification
    })
  }

  if (options.indexedDB !== false) {
    originalValues.indexedDB = globalThis.indexedDB
    ;(globalThis as unknown as Record<string, unknown>).indexedDB = createMockIndexedDB()
    cleanups.push(() => {
      ;(globalThis as unknown as Record<string, unknown>).indexedDB = originalValues.indexedDB
    })
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}
