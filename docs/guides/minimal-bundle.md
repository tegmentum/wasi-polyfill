# Minimal Bundle Guide

This guide explains how to minimize your bundle size when using wasi-polyfill by selectively importing only the features you need.

## The Problem

The full `getBrowserImports()` function includes all browser interfaces, which can result in a large bundle even if your application only needs a few features. For example, WebGPU support alone adds significant code that may be unnecessary for simple applications.

## Solution: Selective Imports

### Option 1: Minimal Imports

For applications that need only basic functionality:

```typescript
import { getMinimalBrowserImports } from '@aspect/wasi-polyfill/browser'

// Includes only: types, runtime, console
const imports = getMinimalBrowserImports()
```

### Option 2: Core Imports

For typical web applications without heavy graphics:

```typescript
import { getCoreBrowserImports } from '@aspect/wasi-polyfill/browser'

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
} from '@aspect/wasi-polyfill/browser'

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

For maximum control, import specific modules directly:

```typescript
// Import only what you need
import { getBrowserConsoleImports } from '@aspect/wasi-polyfill/browser'
import { getBrowserFetchImports } from '@aspect/wasi-polyfill/browser'
import { getBrowserStorageImports } from '@aspect/wasi-polyfill/browser'

const imports = {
  ...getBrowserConsoleImports(),
  ...getBrowserFetchImports(),
  ...getBrowserStorageImports('my-app-storage'),
}
```

## WASIP2 Plugin Selective Loading

For WASIP2 interfaces, use lazy plugin registration:

```typescript
import { Polyfill, globalRegistry } from '@aspect/wasi-polyfill/wasip2'

// Register only needed plugins
globalRegistry.registerLazy(
  { package: 'wasi:filesystem', name: 'types', version: '0.2.0' },
  () => import('@aspect/wasi-polyfill/wasip2/plugins/filesystem').then(m => m.filesystemPlugin)
)

// Plugin loads only when first accessed
const polyfill = new Polyfill()
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
          'wasi-core': ['@aspect/wasi-polyfill/browser'],
          'wasi-webgpu': ['@aspect/wasi-polyfill/browser/webgpu'],
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
          test: /[\\/]node_modules[\\/]@aspect[\\/]wasi-polyfill/,
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
} from '@aspect/wasi-polyfill/browser'

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
