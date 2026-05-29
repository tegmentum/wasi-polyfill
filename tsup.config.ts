import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    // Root entry (re-exports wasip2)
    index: 'src/index.ts',

    // WASI Preview 1
    'wasip1/index': 'src/wasip1/index.ts',
    // Node-only host filesystem backend (imports node:fs).
    'wasip1/hostfs-node': 'src/wasip1/hostfs-node.ts',

    // WASI Preview 2
    'wasip2/index': 'src/wasip2/index.ts',
    'wasip2/plugins/random/index': 'src/wasip2/plugins/random/index.ts',

    // WASI Preview 3
    'wasip3/index': 'src/wasip3/index.ts',

    // Shared utilities (declared as ./shared export)
    'shared/index': 'src/shared/index.ts',

    // Browser interfaces
    'browser/index': 'src/browser/index.ts',
    // Individual browser modules (declared as ./browser/* exports)
    'browser/types': 'src/browser/types.ts',
    'browser/console': 'src/browser/console.ts',
    'browser/runtime': 'src/browser/runtime.ts',
    'browser/fetch': 'src/browser/fetch.ts',
    'browser/storage': 'src/browser/storage.ts',
    'browser/performance': 'src/browser/performance.ts',
    'browser/dom': 'src/browser/dom.ts',
    'browser/events': 'src/browser/events.ts',
    'browser/canvas': 'src/browser/canvas.ts',
    'browser/clipboard': 'src/browser/clipboard.ts',
    'browser/geolocation': 'src/browser/geolocation.ts',
    'browser/notifications': 'src/browser/notifications.ts',
    'browser/media': 'src/browser/media.ts',
    'browser/service-worker': 'src/browser/service-worker.ts',
    'browser/worker': 'src/browser/worker.ts',
    'browser/websocket': 'src/browser/websocket.ts',
    'browser/broadcast-channel': 'src/browser/broadcast-channel.ts',
    'browser/animation': 'src/browser/animation.ts',
    'browser/history': 'src/browser/history.ts',
    'browser/screen': 'src/browser/screen.ts',
    'browser/fullscreen': 'src/browser/fullscreen.ts',
    'browser/vibration': 'src/browser/vibration.ts',
    'browser/gc-enhanced': 'src/browser/gc-enhanced.ts',

    'wasip2/plugins/clocks/index': 'src/wasip2/plugins/clocks/index.ts',
    'wasip2/plugins/io/index': 'src/wasip2/plugins/io/index.ts',
    'wasip2/plugins/cli/index': 'src/wasip2/plugins/cli/index.ts',
    'wasip2/plugins/filesystem/index': 'src/wasip2/plugins/filesystem/index.ts',
    'wasip2/plugins/sockets/index': 'src/wasip2/plugins/sockets/index.ts',
    'wasip2/plugins/http/index': 'src/wasip2/plugins/http/index.ts',
    'wasip2/plugins/threads/index': 'src/wasip2/plugins/threads/index.ts',
    'wasip2/plugins/ws-gateway/index': 'src/wasip2/plugins/ws-gateway/index.ts',
    'wasip2/plugins/logging/index': 'src/wasip2/plugins/logging/index.ts',
    'wasip2/plugins/keyvalue/index': 'src/wasip2/plugins/keyvalue/index.ts',
    'wasip2/plugins/blobstore/index': 'src/wasip2/plugins/blobstore/index.ts',
    'wasip2/plugins/config/index': 'src/wasip2/plugins/config/index.ts',
    // Plugins with declared package exports that were previously not built.
    'wasip2/plugins/sql/index': 'src/wasip2/plugins/sql/index.ts',
    'wasip2/plugins/nn/index': 'src/wasip2/plugins/nn/index.ts',
    'wasip2/plugins/messaging/index': 'src/wasip2/plugins/messaging/index.ts',
    'wasip2/plugins/webgpu/index': 'src/wasip2/plugins/webgpu/index.ts',
    'wasip2/plugins/frame-buffer/index': 'src/wasip2/plugins/frame-buffer/index.ts',
    'wasip2/plugins/graphics-context/index': 'src/wasip2/plugins/graphics-context/index.ts',
    'wasip2/plugins/surface/index': 'src/wasip2/plugins/surface/index.ts',
    'wasip2/plugins/wasi-gfx/index': 'src/wasip2/plugins/wasi-gfx/index.ts',
    'wasip2/build/index': 'src/wasip2/build/index.ts',
    'wasip2/runtime/index': 'src/wasip2/runtime/index.ts',
    'wasip2/testing/index': 'src/wasip2/testing/index.ts',
    'wasip2/proxy/index': 'src/wasip2/proxy/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
  target: 'es2022',
  outDir: 'dist',
})
