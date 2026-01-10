# Minimal Bundle Guide

This guide explains how to minimize your bundle size when using wasi-polyfill by selectively importing only the features you need.

## The Problem

The full `getBrowserImports()` function includes all browser interfaces, which can result in a large bundle even if your application only needs a few features. For example, WebGPU support alone adds significant code that may be unnecessary for simple applications.

## Solution: Selective Imports

### Option 1: Minimal Imports

For applications that need only basic functionality:

```typescript
import { getMinimalBrowserImports } from '@tegmentum/wasi-polyfill/browser'

// Includes only: types, runtime, console
const imports = getMinimalBrowserImports()
```

### Option 2: Core Imports

For typical web applications without heavy graphics:

```typescript
import { getCoreBrowserImports } from '@tegmentum/wasi-polyfill/browser'

// Includes: types, runtime, console, fetch, storage, performance
const imports = getCoreBrowserImports()
```

### Option 3: Lazy Loading Heavy Modules

Load heavy modules only when needed:

```typescript
import {
  getCoreBrowserImports,
  getWebGPUImportsLazy,
  getCanvasImportsLazy
} from '@tegmentum/wasi-polyfill/browser'

// Start with core imports
const imports = getCoreBrowserImports()

// Conditionally add WebGPU
if (needsWebGPU()) {
  const webgpuImports = await getWebGPUImportsLazy()
  Object.assign(imports, webgpuImports)
}

// Conditionally add Canvas
if (needsCanvas()) {
  const canvasImports = await getCanvasImportsLazy()
  Object.assign(imports, canvasImports)
}
```

## Available Lazy Loaders

| Function | Module | When to Use |
|----------|--------|-------------|
| `getWebGPUImportsLazy()` | WebGPU | GPU compute or advanced graphics |
| `getGcEnhancedImportsLazy()` | GC-Enhanced DOM | When targeting wasmGC |
| `getCanvasImportsLazy()` | Canvas 2D | Drawing/games without WebGPU |
| `getMediaImportsLazy()` | Media Capture | Audio/video recording |

## Direct Module Imports

For maximum control, import specific modules directly using subpath exports:

```typescript
// Import only what you need - individual browser modules
import { BrowserFetch } from '@tegmentum/wasi-polyfill/browser/fetch'
import { BrowserStorage } from '@tegmentum/wasi-polyfill/browser/storage'
import { ConsoleLogger } from '@tegmentum/wasi-polyfill/browser/console'

// Or use the combined imports from the main browser entry
import { getBrowserConsoleImports } from '@tegmentum/wasi-polyfill/browser'
import { getBrowserFetchImports } from '@tegmentum/wasi-polyfill/browser'
import { getBrowserStorageImports } from '@tegmentum/wasi-polyfill/browser'

const imports = {
  ...getBrowserConsoleImports(),
  ...getBrowserFetchImports(),
  ...getBrowserStorageImports('my-app-storage'),
}
```

### Available Browser Subpath Exports

| Import Path | Description |
|-------------|-------------|
| `@tegmentum/wasi-polyfill/browser/types` | Core types and Result utilities |
| `@tegmentum/wasi-polyfill/browser/console` | Console logging |
| `@tegmentum/wasi-polyfill/browser/runtime` | Runtime detection |
| `@tegmentum/wasi-polyfill/browser/fetch` | HTTP fetch |
| `@tegmentum/wasi-polyfill/browser/storage` | IndexedDB storage |
| `@tegmentum/wasi-polyfill/browser/performance` | Performance metrics |
| `@tegmentum/wasi-polyfill/browser/dom` | DOM manipulation |
| `@tegmentum/wasi-polyfill/browser/events` | Event handling |
| `@tegmentum/wasi-polyfill/browser/canvas` | Canvas 2D |
| `@tegmentum/wasi-polyfill/browser/clipboard` | Clipboard API |
| `@tegmentum/wasi-polyfill/browser/geolocation` | Geolocation |
| `@tegmentum/wasi-polyfill/browser/notifications` | Notifications |
| `@tegmentum/wasi-polyfill/browser/media` | Media capture |
| `@tegmentum/wasi-polyfill/browser/service-worker` | Service workers |
| `@tegmentum/wasi-polyfill/browser/worker` | Web workers |
| `@tegmentum/wasi-polyfill/browser/websocket` | WebSockets |
| `@tegmentum/wasi-polyfill/browser/broadcast-channel` | Broadcast channels |
| `@tegmentum/wasi-polyfill/browser/animation` | Animation frames |
| `@tegmentum/wasi-polyfill/browser/history` | History API |
| `@tegmentum/wasi-polyfill/browser/screen` | Screen info |
| `@tegmentum/wasi-polyfill/browser/fullscreen` | Fullscreen API |
| `@tegmentum/wasi-polyfill/browser/vibration` | Vibration API |
| `@tegmentum/wasi-polyfill/browser/gc-enhanced` | wasmGC-enhanced DOM |

## WASIP2 Plugin Selective Loading

For WASIP2 interfaces, use lazy plugin registration:

```typescript
import { Polyfill, globalRegistry } from '@tegmentum/wasi-polyfill/wasip2'

// Register only needed plugins
globalRegistry.registerLazy(
  { package: 'wasi:filesystem', name: 'types', version: '0.2.0' },
  () => import('@tegmentum/wasi-polyfill/wasip2/plugins/filesystem').then(m => m.filesystemPlugin)
)

// Plugin loads only when first accessed
const polyfill = new Polyfill()
```

### Available WASIP2 Plugin Subpath Exports

| Import Path | Description |
|-------------|-------------|
| `@tegmentum/wasi-polyfill/wasip2/plugins/random` | Random number generation |
| `@tegmentum/wasi-polyfill/wasip2/plugins/clocks` | Clocks and timers |
| `@tegmentum/wasi-polyfill/wasip2/plugins/io` | I/O streams |
| `@tegmentum/wasi-polyfill/wasip2/plugins/cli` | CLI environment |
| `@tegmentum/wasi-polyfill/wasip2/plugins/filesystem` | File system |
| `@tegmentum/wasi-polyfill/wasip2/plugins/sockets` | Network sockets |
| `@tegmentum/wasi-polyfill/wasip2/plugins/http` | HTTP client |
| `@tegmentum/wasi-polyfill/wasip2/plugins/threads` | Threading |
| `@tegmentum/wasi-polyfill/wasip2/plugins/ws-gateway` | WebSocket gateway |
| `@tegmentum/wasi-polyfill/wasip2/plugins/logging` | Logging |
| `@tegmentum/wasi-polyfill/wasip2/plugins/keyvalue` | Key-value storage |
| `@tegmentum/wasi-polyfill/wasip2/plugins/blobstore` | Blob storage |
| `@tegmentum/wasi-polyfill/wasip2/plugins/config` | Configuration |
| `@tegmentum/wasi-polyfill/wasip2/plugins/messaging` | Messaging |
| `@tegmentum/wasi-polyfill/wasip2/plugins/nn` | Neural networks |
| `@tegmentum/wasi-polyfill/wasip2/plugins/sql` | SQL databases |
| `@tegmentum/wasi-polyfill/wasip2/plugins/webgpu` | WebGPU |
| `@tegmentum/wasi-polyfill/wasip2/plugins/wasi-gfx` | Graphics context |

Shorthand aliases (without `wasip2/` prefix) are also available:
```typescript
import { randomPlugin } from '@tegmentum/wasi-polyfill/plugins/random'
import { filesystemPlugin } from '@tegmentum/wasi-polyfill/plugins/filesystem'
```

## Bundle Size Comparison

Approximate sizes (minified + gzipped):

| Configuration | Size |
|--------------|------|
| Full `getBrowserImports()` | ~45KB |
| `getCoreBrowserImports()` | ~12KB |
| `getMinimalBrowserImports()` | ~4KB |
| WebGPU module alone | ~18KB |
| Canvas module alone | ~8KB |

## Tree-Shaking Tips

1. **Use named imports**: Avoid `import * as browser from '...'`
2. **Check your bundler**: Ensure tree-shaking is enabled
3. **Avoid side effects**: Don't import modules you don't use
4. **Use dynamic imports**: For conditional features

### Vite Configuration

```typescript
// vite.config.ts
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'wasi-core': ['@tegmentum/wasi-polyfill/browser'],
          'wasi-webgpu': ['@tegmentum/wasi-polyfill/browser/gc-enhanced'],
        }
      }
    }
  }
}
```

### Webpack Configuration

```javascript
// webpack.config.js
module.exports = {
  optimization: {
    usedExports: true,
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        wasiPolyfill: {
          test: /[\\/]node_modules[\\/]@tegmentum[\\/]wasi-polyfill/,
          name: 'wasi-polyfill',
          chunks: 'all',
        }
      }
    }
  }
}
```

## Feature Detection Pattern

Combine lazy loading with feature detection:

```typescript
import {
  getCoreBrowserImports,
  isWebGPUSupported,
  getWebGPUImportsLazy
} from '@tegmentum/wasi-polyfill/browser'

async function createImports() {
  const imports = getCoreBrowserImports()

  // Only load WebGPU if supported
  if (isWebGPUSupported()) {
    Object.assign(imports, await getWebGPUImportsLazy())
  }

  return imports
}
```

## Summary

- Use `getMinimalBrowserImports()` for smallest bundles
- Use `getCoreBrowserImports()` for typical web apps
- Use lazy loaders (`*Lazy()`) for optional heavy features
- Import specific modules directly for maximum control
- Configure your bundler for optimal tree-shaking
