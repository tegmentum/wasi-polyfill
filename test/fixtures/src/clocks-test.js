/**
 * Test component for wasi:clocks
 *
 * This component exercises the clock interfaces.
 */

// Import from WASI clocks interfaces
import { now as monotonicNow, resolution as monotonicResolution } from 'wasi:clocks/monotonic-clock@0.2.0';
import { now as wallNow, resolution as wallResolution } from 'wasi:clocks/wall-clock@0.2.0';

/**
 * Get current monotonic time
 */
export function testMonotonicNow() {
  return monotonicNow();
}

/**
 * Get monotonic clock resolution
 */
export function testMonotonicResolution() {
  return monotonicResolution();
}

/**
 * Verify monotonic clock is monotonic
 */
export function testMonotonicIncreasing() {
  const t1 = monotonicNow();
  // Do some work
  let sum = 0n;
  for (let i = 0; i < 1000; i++) {
    sum += BigInt(i);
  }
  const t2 = monotonicNow();

  // t2 should be >= t1
  return t2 >= t1;
}

/**
 * Get current wall clock time
 */
export function testWallNow() {
  const datetime = wallNow();
  return {
    seconds: datetime.seconds,
    nanoseconds: datetime.nanoseconds,
  };
}

/**
 * Get wall clock resolution
 */
export function testWallResolution() {
  return wallResolution();
}

/**
 * Verify wall clock returns reasonable time
 */
export function testWallReasonable() {
  const datetime = wallNow();

  // Time should be after year 2020 (in seconds since epoch)
  const year2020 = 1577836800n;
  // Time should be before year 2100
  const year2100 = 4102444800n;

  return datetime.seconds > year2020 && datetime.seconds < year2100;
}
