/**
 * wasi:clocks plugin definitions
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { performanceClockImplementation } from './impl-performance.js'
import { dateClockImplementation } from './impl-date.js'

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
 * Provides high-resolution monotonic time using performance.now().
 */
export const monotonicClockPlugin: WasiPlugin = createPlugin(
  MONOTONIC_CLOCK_INTERFACE,
  {
    performance: performanceClockImplementation,
  },
  'performance'
)

/**
 * wasi:clocks/wall-clock plugin
 *
 * Provides wall clock time using Date.now().
 */
export const wallClockPlugin: WasiPlugin = createPlugin(
  WALL_CLOCK_INTERFACE,
  {
    date: dateClockImplementation,
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
