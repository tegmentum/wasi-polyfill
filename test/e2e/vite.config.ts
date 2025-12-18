import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(__dirname),
  build: {
    outDir: resolve(__dirname, '../../dist-e2e'),
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@tegmentum/wasi-polyfill': resolve(__dirname, '../../src/index.ts'),
    },
  },
  server: {
    port: 4173,
  },
  preview: {
    port: 4173,
  },
})
