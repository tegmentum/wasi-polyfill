/**
 * wasi:clocks plugin
 *
 * Provides monotonic and wall clock functionality.
 */

export { monotonicClockPlugin, wallClockPlugin, clocksPlugins } from './plugin.js'
export { performanceClockImplementation } from './impl-performance.js'
export { dateClockImplementation } from './impl-date.js'
