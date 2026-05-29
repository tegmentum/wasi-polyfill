/**
 * @tegmentum/wasi-polyfill
 *
 * Multi-version WASI polyfill for browser and JavaScript environments.
 *
 * Each preview lives at its own subpath:
 *
 * @example
 * ```typescript
 * import { Polyfill }   from '@tegmentum/wasi-polyfill/wasip2'
 * import { createWasip1 } from '@tegmentum/wasi-polyfill/wasip1'
 * import { createWasip3 } from '@tegmentum/wasi-polyfill/wasip3'
 * ```
 *
 * @deprecated The root entry point re-exports wasip2 as a back-compat alias.
 * Import from `@tegmentum/wasi-polyfill/wasip2` instead. The root re-export
 * will be removed in a future major version.
 *
 * @packageDocumentation
 */

export * from './wasip2/index.js'
