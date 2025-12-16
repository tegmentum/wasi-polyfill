import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'plugins/random/index': 'src/plugins/random/index.ts',
    'plugins/clocks/index': 'src/plugins/clocks/index.ts',
    'plugins/io/index': 'src/plugins/io/index.ts',
    'plugins/cli/index': 'src/plugins/cli/index.ts',
    'plugins/filesystem/index': 'src/plugins/filesystem/index.ts',
    'plugins/sockets/index': 'src/plugins/sockets/index.ts',
    'plugins/http/index': 'src/plugins/http/index.ts',
    'plugins/threads/index': 'src/plugins/threads/index.ts',
    'plugins/ws-gateway/index': 'src/plugins/ws-gateway/index.ts',
    'build/index': 'src/build/index.ts',
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
