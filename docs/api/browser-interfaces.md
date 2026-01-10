# Browser Interfaces API Reference

This document provides a comprehensive reference for all browser:* interfaces available in wasi-polyfill.

## Overview

Browser interfaces provide WebAssembly components with access to browser functionality through capability-scoped APIs. Each interface follows a consistent pattern:

- **Class-based API**: `BrowserXxx` class with methods
- **Standalone functions**: Convenience functions using a default instance
- **Imports function**: `getBrowserXxxImports()` for WASM instantiation

## Interface Categories

| Phase | Interfaces | Description |
|-------|-----------|-------------|
| 0 | Types, Runtime, Console | Core utilities and logging |
| 1 | Fetch, Storage, Performance | Basic web APIs |
| 2 | DOM, Events | Document manipulation |
| 3 | Canvas | 2D graphics |
| 4 | Clipboard, Geolocation, Notifications, Media | Device capabilities |
| 5 | Service Worker | Offline and background |
| 6 | Worker | Parallel computation |
| Ext | WebGPU, GC-Enhanced, WebSocket, etc. | Advanced features |

---

## Phase 0: Core

### browser:console

Logging and debugging utilities.

```typescript
import {
  ConsoleLogger,
  LogLevel,
  log, debug, info, warn, error, trace,
  time, timeEnd,
  getBrowserConsoleImports
} from '@aspect/wasi-polyfill/browser'
```

#### ConsoleLogger

```typescript
class ConsoleLogger {
  constructor(config?: ConsoleLoggerConfig)

  log(level: LogLevel, ...parts: LogPart[]): void
  trace(...args: unknown[]): void
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void

  time(label?: string): void
  timeEnd(label?: string): void
  timeLog(label?: string, ...args: unknown[]): void

  group(label?: string): void
  groupEnd(): void
  clear(): void
}
```

#### Configuration

```typescript
interface ConsoleLoggerConfig {
  console?: Console           // Custom console implementation
  minLevel?: LogLevel         // Minimum log level (default: DEBUG)
  prefix?: string             // Prefix for all messages
  timestamps?: boolean        // Include timestamps
}
```

### browser:runtime

Environment detection and feature checking.

```typescript
import {
  isBrowser, isWorker, isSecureContext,
  supports, getSupportedFeatures,
  getRuntimeInfo,
  getBrowserRuntimeImports
} from '@aspect/wasi-polyfill/browser'
```

#### Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `isBrowser()` | boolean | Running in browser |
| `isWorker()` | boolean | Running in Web Worker |
| `isServiceWorker()` | boolean | Running in Service Worker |
| `isSecureContext()` | boolean | HTTPS or localhost |
| `isWasmGcEnabled()` | boolean | wasmGC available |
| `supports(feature)` | boolean | Feature detection |
| `getSupportedFeatures()` | string[] | All supported features |

---

## Phase 1: Basic Web APIs

### browser:fetch

HTTP requests.

```typescript
import {
  BrowserFetch,
  fetch as browserFetch,
  getBrowserFetchImports
} from '@aspect/wasi-polyfill/browser'
```

#### BrowserFetch

```typescript
class BrowserFetch {
  constructor(options?: FetchOptions)

  fetch(request: FetchRequest): Promise<Result<FetchResponse, BrowserError>>
}
```

#### Types

```typescript
interface FetchRequest {
  url: string
  method?: string
  headers?: Headers
  body?: Uint8Array
  timeout?: number
}

interface FetchResponse {
  status: number
  statusText: string
  headers: Headers
  body: Uint8Array | null
}
```

### browser:storage

Persistent key-value storage using IndexedDB.

```typescript
import {
  BrowserStorage,
  getStorage,
  getBrowserStorageImports
} from '@aspect/wasi-polyfill/browser'
```

#### BrowserStorage

```typescript
class BrowserStorage {
  constructor(options?: StorageOptions)

  get(key: string): Promise<Result<Uint8Array | null, BrowserError>>
  set(key: string, value: Uint8Array, ttl?: number): Promise<Result<void, BrowserError>>
  delete(key: string): Promise<Result<boolean, BrowserError>>
  has(key: string): Promise<Result<boolean, BrowserError>>
  keys(): Promise<Result<string[], BrowserError>>
  clear(): Promise<Result<void, BrowserError>>
  size(): Promise<Result<{ count: number; bytes: number }, BrowserError>>

  getString(key: string): Promise<Result<string | null, BrowserError>>
  setString(key: string, value: string, ttl?: number): Promise<Result<void, BrowserError>>
}
```

### browser:performance

Performance measurement.

```typescript
import {
  BrowserPerformance,
  now, mark, measure,
  getBrowserPerformanceImports
} from '@aspect/wasi-polyfill/browser'
```

#### Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `now()` | number | High-resolution timestamp |
| `mark(name)` | void | Create performance mark |
| `measure(name, start?, end?)` | void | Measure between marks |

---

## Phase 2: DOM and Events

### browser:dom

Document manipulation via handle-based API.

```typescript
import {
  BrowserDom,
  NodeHandle, ElementHandle,
  NodeType,
  getBrowserDomImports
} from '@aspect/wasi-polyfill/browser'
```

#### BrowserDom

```typescript
class BrowserDom {
  constructor(options?: DomOptions)

  // Query
  querySelector(selector: string): Result<NodeHandle | null, BrowserError>
  querySelectorAll(selector: string): Result<NodeHandle[], BrowserError>
  getElementById(id: string): Result<NodeHandle | null, BrowserError>

  // Creation
  createElement(tagName: string): Result<NodeHandle, BrowserError>
  createTextNode(text: string): Result<NodeHandle, BrowserError>

  // Tree manipulation
  appendChild(parent: NodeHandle, child: NodeHandle): Result<void, BrowserError>
  removeChild(parent: NodeHandle, child: NodeHandle): Result<void, BrowserError>
  insertBefore(parent: NodeHandle, node: NodeHandle, ref: NodeHandle | null): Result<void, BrowserError>

  // Attributes
  getAttribute(node: NodeHandle, name: string): Result<string | null, BrowserError>
  setAttribute(node: NodeHandle, name: string, value: string): Result<void, BrowserError>
  removeAttribute(node: NodeHandle, name: string): Result<void, BrowserError>

  // Properties
  getProperty(node: NodeHandle, name: string): Result<unknown, BrowserError>
  setProperty(node: NodeHandle, name: string, value: unknown): Result<void, BrowserError>

  // Content
  getTextContent(node: NodeHandle): Result<string | null, BrowserError>
  setTextContent(node: NodeHandle, text: string): Result<void, BrowserError>
  getInnerHTML(node: NodeHandle): Result<string, BrowserError>
  setInnerHTML(node: NodeHandle, html: string): Result<void, BrowserError>

  // Style
  getStyle(node: NodeHandle, property: string): Result<string, BrowserError>
  setStyle(node: NodeHandle, property: string, value: string): Result<void, BrowserError>

  // Classes
  addClass(node: NodeHandle, className: string): Result<void, BrowserError>
  removeClass(node: NodeHandle, className: string): Result<void, BrowserError>
  toggleClass(node: NodeHandle, className: string): Result<boolean, BrowserError>
  hasClass(node: NodeHandle, className: string): Result<boolean, BrowserError>

  // Info
  getNodeInfo(node: NodeHandle): Result<ElementInfo, BrowserError>
  getBoundingClientRect(node: NodeHandle): Result<Rect, BrowserError>
}
```

### browser:events

Event subscription and handling.

```typescript
import {
  BrowserEvents,
  subscribeDocument, subscribeWindow,
  readEvents, unsubscribe,
  getBrowserEventsImports
} from '@aspect/wasi-polyfill/browser'
```

#### BrowserEvents

```typescript
class BrowserEvents {
  constructor(options?: EventsOptions)

  subscribe(target: NodeHandle | 'window' | 'document', eventType: string, options?: SubscribeOptions): Result<SubscriptionHandle, BrowserError>
  unsubscribe(handle: SubscriptionHandle): Result<void, BrowserError>
  readEvents(handle: SubscriptionHandle, maxCount?: number): Result<EventData[], BrowserError>
  getQueuedEventCount(handle: SubscriptionHandle): Result<number, BrowserError>
}
```

#### Event Types

```typescript
interface EventData {
  type: string
  timestamp: number
  target: NodeHandle | null
  // Type-specific data
  mouse?: MouseEventData
  keyboard?: KeyboardEventData
  touch?: TouchEventData
  wheel?: WheelEventData
  focus?: FocusEventData
  input?: InputEventData
}
```

---

## Phase 3: Canvas

### browser:canvas

2D drawing API.

```typescript
import {
  BrowserCanvas,
  CanvasHandle, Context2DHandle,
  getBrowserCanvasImports
} from '@aspect/wasi-polyfill/browser'
```

#### BrowserCanvas

```typescript
class BrowserCanvas {
  constructor(options?: CanvasOptions)

  // Canvas management
  createCanvas(width: number, height: number): Result<CanvasHandle, BrowserError>
  getContext2D(canvas: CanvasHandle): Result<Context2DHandle, BrowserError>
  attachToElement(canvas: CanvasHandle, element: NodeHandle): Result<void, BrowserError>

  // Drawing state
  save(ctx: Context2DHandle): Result<void, BrowserError>
  restore(ctx: Context2DHandle): Result<void, BrowserError>

  // Transforms
  translate(ctx: Context2DHandle, x: number, y: number): Result<void, BrowserError>
  rotate(ctx: Context2DHandle, angle: number): Result<void, BrowserError>
  scale(ctx: Context2DHandle, x: number, y: number): Result<void, BrowserError>

  // Style
  setFillStyle(ctx: Context2DHandle, style: string | Color): Result<void, BrowserError>
  setStrokeStyle(ctx: Context2DHandle, style: string | Color): Result<void, BrowserError>
  setLineWidth(ctx: Context2DHandle, width: number): Result<void, BrowserError>

  // Shapes
  fillRect(ctx: Context2DHandle, x: number, y: number, w: number, h: number): Result<void, BrowserError>
  strokeRect(ctx: Context2DHandle, x: number, y: number, w: number, h: number): Result<void, BrowserError>
  clearRect(ctx: Context2DHandle, x: number, y: number, w: number, h: number): Result<void, BrowserError>

  // Paths
  beginPath(ctx: Context2DHandle): Result<void, BrowserError>
  closePath(ctx: Context2DHandle): Result<void, BrowserError>
  moveTo(ctx: Context2DHandle, x: number, y: number): Result<void, BrowserError>
  lineTo(ctx: Context2DHandle, x: number, y: number): Result<void, BrowserError>
  arc(ctx: Context2DHandle, x: number, y: number, radius: number, startAngle: number, endAngle: number, ccw?: boolean): Result<void, BrowserError>
  fill(ctx: Context2DHandle): Result<void, BrowserError>
  stroke(ctx: Context2DHandle): Result<void, BrowserError>

  // Text
  fillText(ctx: Context2DHandle, text: string, x: number, y: number): Result<void, BrowserError>
  strokeText(ctx: Context2DHandle, text: string, x: number, y: number): Result<void, BrowserError>
  setFont(ctx: Context2DHandle, font: string): Result<void, BrowserError>

  // Pixel data
  getImageData(ctx: Context2DHandle, x: number, y: number, w: number, h: number): Result<ImageData, BrowserError>
  putImageData(ctx: Context2DHandle, data: ImageData, x: number, y: number): Result<void, BrowserError>
}
```

---

## Phase 4: Device Capabilities

### browser:clipboard

Clipboard access (requires user gesture).

```typescript
import {
  BrowserClipboard,
  readText, writeText,
  getBrowserClipboardImports
} from '@aspect/wasi-polyfill/browser'
```

#### Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `readText()` | Promise<Result<string>> | Read clipboard text |
| `writeText(text)` | Promise<Result<void>> | Write to clipboard |

### browser:geolocation

Location access (requires permission).

```typescript
import {
  BrowserGeolocation,
  getCurrentPosition,
  getBrowserGeolocationImports
} from '@aspect/wasi-polyfill/browser'
```

#### Types

```typescript
interface GeolocationPosition {
  coords: GeolocationCoordinates
  timestamp: number
}

interface GeolocationCoordinates {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number | null
  altitudeAccuracy: number | null
  heading: number | null
  speed: number | null
}
```

### browser:notifications

System notifications (requires permission).

```typescript
import {
  BrowserNotifications,
  requestPermission, showNotification,
  getBrowserNotificationsImports
} from '@aspect/wasi-polyfill/browser'
```

### browser:media

Media capture (requires permission).

```typescript
import {
  BrowserMedia,
  getBrowserMediaImports
} from '@aspect/wasi-polyfill/browser'
```

---

## Extended Interfaces

### browser:websocket

WebSocket connections.

```typescript
import {
  BrowserWebSocket,
  WebSocketState,
  isWebSocketSupported,
  connect, send, close,
  getBrowserWebSocketImports
} from '@aspect/wasi-polyfill/browser'
```

#### BrowserWebSocket

```typescript
class BrowserWebSocket {
  constructor(options?: WebSocketOptions)

  connect(options: { url: string; protocols?: string[] }): Result<WebSocketHandle, BrowserError>
  send(handle: WebSocketHandle, data: Uint8Array): Result<void, BrowserError>
  sendText(handle: WebSocketHandle, text: string): Result<void, BrowserError>
  close(handle: WebSocketHandle, code?: number, reason?: string): Result<void, BrowserError>
  getState(handle: WebSocketHandle): Result<WebSocketState, BrowserError>
  readMessages(handle: WebSocketHandle, maxCount?: number): Result<WebSocketMessage[], BrowserError>
}
```

### browser:animation

Animation frames and idle callbacks.

```typescript
import {
  BrowserAnimation,
  requestFrame, cancelFrame,
  requestIdle, cancelIdle,
  getFrameTime,
  getBrowserAnimationImports
} from '@aspect/wasi-polyfill/browser'
```

### browser:history

Browser history manipulation.

```typescript
import {
  BrowserHistory,
  pushState, replaceState,
  back, forward, go,
  getBrowserHistoryImports
} from '@aspect/wasi-polyfill/browser'
```

### browser:screen

Screen information and orientation.

```typescript
import {
  BrowserScreen,
  getScreenInfo, getOrientation,
  lockOrientation, unlockOrientation,
  getBrowserScreenImports
} from '@aspect/wasi-polyfill/browser'
```

### browser:fullscreen

Fullscreen mode.

```typescript
import {
  BrowserFullscreen,
  isFullscreen, requestFullscreen, exitFullscreen,
  getBrowserFullscreenImports
} from '@aspect/wasi-polyfill/browser'
```

### browser:vibration

Device vibration.

```typescript
import {
  BrowserVibration,
  isVibrationSupported,
  vibrate, cancelVibration,
  getBrowserVibrationImports
} from '@aspect/wasi-polyfill/browser'
```

---

## Error Handling

All browser interfaces return `Result<T, BrowserError>`:

```typescript
interface BrowserError {
  code: BrowserErrorCode
  message: string
  cause?: unknown
}

type BrowserErrorCode =
  | 'not-supported'
  | 'not-found'
  | 'invalid-argument'
  | 'denied'
  | 'busy'
  | 'quota-exceeded'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'unknown'
```

---

## Combined Imports

### Full Imports

```typescript
import { getBrowserImports } from '@aspect/wasi-polyfill/browser'

const imports = getBrowserImports({
  console: { minLevel: LogLevel.INFO },
  storageDatabaseName: 'my-app',
})
```

### Minimal Imports

```typescript
import { getMinimalBrowserImports } from '@aspect/wasi-polyfill/browser'

// Only types, runtime, console
const imports = getMinimalBrowserImports()
```

### Core Imports

```typescript
import { getCoreBrowserImports } from '@aspect/wasi-polyfill/browser'

// Core without heavy modules (WebGPU, Canvas, Media)
const imports = getCoreBrowserImports()
```

### Lazy Loading

```typescript
import {
  getWebGPUImportsLazy,
  getCanvasImportsLazy,
  getMediaImportsLazy,
  getGcEnhancedImportsLazy,
} from '@aspect/wasi-polyfill/browser'

// Load on demand
const webgpu = await getWebGPUImportsLazy()
```
