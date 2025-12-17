/**
 * wasi:clocks plugin definitions
 *
 * Includes:
 * - wasi:clocks/monotonic-clock - High-resolution monotonic time
 * - wasi:clocks/wall-clock - Wall clock time (real-world time)
 *
 * Each interface supports multiple implementations:
 * - performance/date: Standard implementations using browser APIs
 * - virtual: Deterministic implementations for testing
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { performanceClockImplementation } from './impl-performance.js'
import { dateClockImplementation } from './impl-date.js'
import {
  virtualMonotonicClockImplementation,
  virtualWallClockImplementation,
} from './impl-virtual.js'

/**
 * WASI monotonic clock interface definition
 */
export const MONOTONIC_CLOCK_INTERFACE: WasiInterface = {
  package: 'wasi:clocks',
  name: 'monotonic-clock',
  version: '0.2.0',
}

/**
 * WASI wall clock interface definition
 */
export const WALL_CLOCK_INTERFACE: WasiInterface = {
  package: 'wasi:clocks',
  name: 'wall-clock',
  version: '0.2.0',
}

/**
 * wasi:clocks/monotonic-clock plugin
 *
 * Provides high-resolution monotonic time.
 *
 * Implementations:
 * - performance: performance.now() (default, high resolution)
 * - virtual: Deterministic controllable time (for testing)
 */
export const monotonicClockPlugin: WasiPlugin = createPlugin(
  MONOTONIC_CLOCK_INTERFACE,
  {
    performance: performanceClockImplementation,
    virtual: virtualMonotonicClockImplementation,
  },
  'performance'
)

/**
 * wasi:clocks/wall-clock plugin
 *
 * Provides wall clock time (real-world time).
 *
 * Implementations:
 * - date: Date.now() (default)
 * - virtual: Deterministic controllable time (for testing)
 */
export const wallClockPlugin: WasiPlugin = createPlugin(
  WALL_CLOCK_INTERFACE,
  {
    date: dateClockImplementation,
    virtual: virtualWallClockImplementation,
  },
  'date'
)

/**
 * All clock plugins for convenient registration
 */
export const clocksPlugins: WasiPlugin[] = [
  monotonicClockPlugin,
  wallClockPlugin,
]
