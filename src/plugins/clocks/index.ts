/**
 * wasi:clocks plugin
 *
 * Provides monotonic and wall clock functionality.
 *
 * Interfaces:
 * - wasi:clocks/monotonic-clock - High-resolution monotonic time
 * - wasi:clocks/wall-clock - Wall clock time (real-world time)
 *
 * Implementations:
 * - performance/date: Standard implementations using browser APIs
 * - virtual: Deterministic implementations for testing
 */

// Plugin definitions and interfaces
export {
  monotonicClockPlugin,
  wallClockPlugin,
  clocksPlugins,
  MONOTONIC_CLOCK_INTERFACE,
  WALL_CLOCK_INTERFACE,
} from './plugin.js'

// Standard implementations
export { performanceClockImplementation } from './impl-performance.js'
export { dateClockImplementation } from './impl-date.js'

// Virtual implementations (for deterministic testing)
export {
  virtualMonotonicClockImplementation,
  virtualWallClockImplementation,
  ControllableClockStore,
  type VirtualClockConfig,
} from './impl-virtual.js'
