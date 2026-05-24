import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    // Root entry (re-exports wasip2)
    index: 'src/index.ts',

    // WASI Preview 1
    'wasip1/index': 'src/wasip1/index.ts',

    // WASI Preview 2
    'wasip2/index': 'src/wasip2/index.ts',
    'wasip2/plugins/random/index': 'src/wasip2/plugins/random/index.ts',

    // WASI Preview 3
    'wasip3/index': 'src/wasip3/index.ts',

    // Browser interfaces
    'browser/index': 'src/browser/index.ts',
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
