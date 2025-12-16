/**
 * Test component for wasi:cli/environment
 *
 * This component exercises the CLI environment interfaces.
 */

// Import from WASI CLI interfaces
import { getEnvironment, getArguments } from 'wasi:cli/environment@0.2.0';

/**
 * Get all environment variables
 */
export function testGetEnvironment() {
  const env = getEnvironment();
  // Convert to object for easier testing
  const result = {};
  for (const [key, value] of env) {
    result[key] = value;
  }
  return result;
}

/**
 * Get command line arguments
 */
export function testGetArguments() {
  return getArguments();
}

/**
 * Check if a specific environment variable exists
 */
export function testHasEnvVar(name) {
  const env = getEnvironment();
  for (const [key, _value] of env) {
    if (key === name) {
      return true;
    }
  }
  return false;
}

/**
 * Get a specific environment variable value
 */
export function testGetEnvVar(name) {
  const env = getEnvironment();
  for (const [key, value] of env) {
    if (key === name) {
      return value;
    }
  }
  return null;
}

/**
 * Count environment variables
 */
export function testEnvCount() {
  return getEnvironment().length;
}

/**
 * Count command line arguments
 */
export function testArgsCount() {
  return getArguments().length;
}

/**
 * Get first argument (program name)
 */
export function testGetProgramName() {
  const args = getArguments();
  if (args.length > 0) {
    return args[0];
  }
  return null;
}
