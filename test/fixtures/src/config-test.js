/**
 * Test component for wasi:config
 *
 * This component exercises the runtime configuration interfaces.
 */

// Import from WASI config interfaces
import { get, getAll } from 'wasi:config/runtime@0.2.0';

/**
 * Get a specific configuration value
 */
export function testGet(key) {
  const result = get(key);
  return result;
}

/**
 * Get all configuration values
 */
export function testGetAll() {
  const config = getAll();
  // Convert to object for easier testing
  const result = {};
  for (const [key, value] of config) {
    result[key] = value;
  }
  return result;
}

/**
 * Check if a config key exists
 */
export function testHasKey(key) {
  const result = get(key);
  return result !== null && result !== undefined;
}

/**
 * Count configuration entries
 */
export function testCount() {
  return getAll().length;
}

/**
 * Get config with fallback
 */
export function testGetWithFallback(key, fallback) {
  const result = get(key);
  if (result === null || result === undefined) {
    return fallback;
  }
  return result;
}
