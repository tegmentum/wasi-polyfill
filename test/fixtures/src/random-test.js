/**
 * Test component for wasi:random
 *
 * This component exercises the random number generation interfaces.
 */

// Import from WASI random interface
// These will be provided by the polyfill
import { getRandomBytes, getRandomU64 } from 'wasi:random/random@0.2.0';

/**
 * Get random bytes and return them
 */
export function testGetRandomBytes(len) {
  const bytes = getRandomBytes(BigInt(len));
  return bytes;
}

/**
 * Get a random u64 value
 */
export function testGetRandomU64() {
  return getRandomU64();
}

/**
 * Verify random bytes are actually random (basic entropy check)
 */
export function testRandomEntropy() {
  const bytes = getRandomBytes(100n);

  // Count unique values - should have reasonable entropy
  const unique = new Set(bytes);

  // With 100 bytes, we should have at least 20 unique values
  return unique.size >= 20;
}

/**
 * Test that multiple calls return different values
 */
export function testRandomDifferent() {
  const a = getRandomU64();
  const b = getRandomU64();
  const c = getRandomU64();

  // Very unlikely all three are the same
  return a !== b || b !== c;
}
