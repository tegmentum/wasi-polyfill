/**
 * @tegmentum/wasip2-polyfill
 *
 * Multi-version WASI polyfill for browser and JavaScript environments.
 *
 * Supports:
 * - WASI Preview 1 (wasip1) - Legacy compatibility
 * - WASI Preview 2 (wasip2) - Current stable (default)
 * - WASI Preview 3 (wasip3) - Future (placeholder)
 *
 * The default export provides WASI Preview 2 (wasip2) for backwards compatibility.
 * For explicit version selection, use the version-specific imports:
 *
 * @example
 * ```typescript
 * // Default (wasip2)
 * import { Polyfill } from '@tegmentum/wasip2-polyfill'
 *
 * // Explicit wasip2
 * import { Polyfill } from '@tegmentum/wasip2-polyfill/wasip2'
 *
 * // Legacy wasip1
 * import { Wasip1 } from '@tegmentum/wasip2-polyfill/wasip1'
 * ```
 *
 * @packageDocumentation
 */

// Default export is wasip2 for backwards compatibility
export * from './wasip2/index.js'
