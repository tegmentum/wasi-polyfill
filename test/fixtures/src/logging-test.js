/**
 * Test component for wasi:logging
 *
 * This component exercises the logging interfaces.
 */

// Import from WASI logging interfaces
import { log } from 'wasi:logging/logging@0.1.0';

/**
 * Log at trace level
 */
export function testLogTrace(message) {
  log(0, 'test', message); // 0 = trace
  return true;
}

/**
 * Log at debug level
 */
export function testLogDebug(message) {
  log(1, 'test', message); // 1 = debug
  return true;
}

/**
 * Log at info level
 */
export function testLogInfo(message) {
  log(2, 'test', message); // 2 = info
  return true;
}

/**
 * Log at warn level
 */
export function testLogWarn(message) {
  log(3, 'test', message); // 3 = warn
  return true;
}

/**
 * Log at error level
 */
export function testLogError(message) {
  log(4, 'test', message); // 4 = error
  return true;
}

/**
 * Log with context
 */
export function testLogWithContext(level, context, message) {
  log(level, context, message);
  return true;
}

/**
 * Log multiple messages
 */
export function testLogMultiple() {
  log(2, 'multi', 'First message');
  log(2, 'multi', 'Second message');
  log(2, 'multi', 'Third message');
  return true;
}
