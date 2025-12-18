/**
 * browser:performance - Performance timing APIs
 *
 * Provides a capability-scoped interface to the Performance API
 * for high-resolution timing and performance measurement.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  mapErrorToBrowserError,
  type Result,
  ok,
} from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Performance mark entry.
 */
export interface PerformanceMark {
  /** Mark name */
  name: string
  /** Mark timestamp (ms since time origin) */
  startTime: number
  /** Mark detail (optional) */
  detail?: unknown
}

/**
 * Performance measure entry.
 */
export interface PerformanceMeasure {
  /** Measure name */
  name: string
  /** Start timestamp (ms since time origin) */
  startTime: number
  /** Duration in milliseconds */
  duration: number
  /** Measure detail (optional) */
  detail?: unknown
}

/**
 * Memory usage info (if available).
 */
export interface MemoryInfo {
  /** Used JS heap size in bytes */
  usedJSHeapSize?: number
  /** Total JS heap size in bytes */
  totalJSHeapSize?: number
  /** JS heap size limit in bytes */
  jsHeapSizeLimit?: number
}

// =============================================================================
// Browser Performance
// =============================================================================

/**
 * Browser performance implementation.
 */
export class BrowserPerformance {
  private perf: Performance

  constructor(performance?: Performance) {
    this.perf = performance ?? globalThis.performance
  }

  /**
   * Get high-resolution timestamp.
   */
  now(): number {
    return this.perf.now()
  }

  /**
   * Get time origin (when the page started loading).
   */
  timeOrigin(): number {
    return this.perf.timeOrigin
  }

  /**
   * Create a performance mark.
   */
  mark(name: string, detail?: unknown): Result<PerformanceMark, BrowserError> {
    try {
      const options = detail !== undefined ? { detail } : undefined
      const entry = this.perf.mark(name, options)
      return ok({
        name: entry.name,
        startTime: entry.startTime,
        detail: (entry as PerformanceEntry & { detail?: unknown }).detail,
      })
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Create a performance measure between two marks or from a start time.
   */
  measure(
    name: string,
    startMark?: string,
    endMark?: string,
    detail?: unknown
  ): Result<PerformanceMeasure, BrowserError> {
    try {
      let entry: PerformanceMeasure

      if (startMark === undefined && endMark === undefined) {
        // Measure from time origin to now
        const nativeEntry = this.perf.measure(name)
        entry = {
          name: nativeEntry.name,
          startTime: nativeEntry.startTime,
          duration: nativeEntry.duration,
        }
      } else {
        const options: PerformanceMeasureOptions = {}
        if (startMark !== undefined) options.start = startMark
        if (endMark !== undefined) options.end = endMark
        if (detail !== undefined) options.detail = detail

        const nativeEntry = this.perf.measure(name, options)
        entry = {
          name: nativeEntry.name,
          startTime: nativeEntry.startTime,
          duration: nativeEntry.duration,
          detail: (nativeEntry as PerformanceMeasure).detail,
        }
      }

      return ok(entry)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get all marks with a given name.
   */
  getMarks(name?: string): PerformanceMark[] {
    const entries = name
      ? this.perf.getEntriesByName(name, 'mark')
      : this.perf.getEntriesByType('mark')

    return entries.map(entry => ({
      name: entry.name,
      startTime: entry.startTime,
      detail: (entry as PerformanceMark).detail,
    }))
  }

  /**
   * Get all measures with a given name.
   */
  getMeasures(name?: string): PerformanceMeasure[] {
    const entries = name
      ? this.perf.getEntriesByName(name, 'measure')
      : this.perf.getEntriesByType('measure')

    return entries.map(entry => ({
      name: entry.name,
      startTime: entry.startTime,
      duration: entry.duration,
      detail: (entry as PerformanceMeasure).detail,
    }))
  }

  /**
   * Clear marks.
   */
  clearMarks(name?: string): void {
    if (name) {
      this.perf.clearMarks(name)
    } else {
      this.perf.clearMarks()
    }
  }

  /**
   * Clear measures.
   */
  clearMeasures(name?: string): void {
    if (name) {
      this.perf.clearMeasures(name)
    } else {
      this.perf.clearMeasures()
    }
  }

  /**
   * Get memory info (Chrome only).
   */
  getMemoryInfo(): Result<MemoryInfo | null, BrowserError> {
    const perfWithMemory = this.perf as Performance & {
      memory?: {
        usedJSHeapSize: number
        totalJSHeapSize: number
        jsHeapSizeLimit: number
      }
    }

    if (!perfWithMemory.memory) {
      return ok(null)
    }

    return ok({
      usedJSHeapSize: perfWithMemory.memory.usedJSHeapSize,
      totalJSHeapSize: perfWithMemory.memory.totalJSHeapSize,
      jsHeapSizeLimit: perfWithMemory.memory.jsHeapSizeLimit,
    })
  }

  /**
   * Get navigation timing (page load metrics).
   */
  getNavigationTiming(): Result<PerformanceNavigationTiming | null, BrowserError> {
    try {
      const entries = this.perf.getEntriesByType('navigation')
      if (entries.length === 0) {
        return ok(null)
      }
      return ok(entries[0] as PerformanceNavigationTiming)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get resource timing entries.
   */
  getResourceTiming(name?: string): PerformanceResourceTiming[] {
    if (name) {
      return this.perf.getEntriesByName(name, 'resource') as PerformanceResourceTiming[]
    }
    return this.perf.getEntriesByType('resource') as PerformanceResourceTiming[]
  }

  /**
   * Clear resource timing buffer.
   */
  clearResourceTimings(): void {
    this.perf.clearResourceTimings()
  }

  /**
   * Set resource timing buffer size.
   */
  setResourceTimingBufferSize(size: number): Result<void, BrowserError> {
    try {
      this.perf.setResourceTimingBufferSize(size)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultPerformance: BrowserPerformance | null = null

/**
 * Get the default performance instance.
 */
function getDefaultPerformance(): BrowserPerformance {
  if (!defaultPerformance) {
    defaultPerformance = new BrowserPerformance()
  }
  return defaultPerformance
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Get high-resolution timestamp.
 */
export function now(): number {
  return getDefaultPerformance().now()
}

/**
 * Create a performance mark.
 */
export function mark(name: string, detail?: unknown): Result<PerformanceMark, BrowserError> {
  return getDefaultPerformance().mark(name, detail)
}

/**
 * Create a performance measure.
 */
export function measure(
  name: string,
  startMark?: string,
  endMark?: string,
  detail?: unknown
): Result<PerformanceMeasure, BrowserError> {
  return getDefaultPerformance().measure(name, startMark, endMark, detail)
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:performance imports object.
 */
export function getBrowserPerformanceImports(): Record<string, unknown> {
  const perf = getDefaultPerformance()

  return {
    'browser:performance/performance': {
      // Core timing
      now: () => perf.now(),
      'time-origin': () => perf.timeOrigin(),

      // Marks
      mark: (name: string, detail?: unknown) => perf.mark(name, detail),
      'get-marks': (name?: string) => perf.getMarks(name),
      'clear-marks': (name?: string) => perf.clearMarks(name),

      // Measures
      measure: (name: string, startMark?: string, endMark?: string, detail?: unknown) =>
        perf.measure(name, startMark, endMark, detail),
      'get-measures': (name?: string) => perf.getMeasures(name),
      'clear-measures': (name?: string) => perf.clearMeasures(name),

      // Memory (Chrome only)
      'get-memory-info': () => perf.getMemoryInfo(),

      // Navigation timing
      'get-navigation-timing': () => perf.getNavigationTiming(),

      // Resource timing
      'get-resource-timing': (name?: string) => perf.getResourceTiming(name),
      'clear-resource-timings': () => perf.clearResourceTimings(),
      'set-resource-timing-buffer-size': (size: number) => perf.setResourceTimingBufferSize(size),
    },
  }
}
