/**
 * Test component for wasi:keyvalue
 *
 * This component exercises the key-value store interfaces.
 */

// Import from WASI keyvalue interfaces
import { open } from 'wasi:keyvalue/store@0.2.0';

/**
 * Test basic get and set operations
 */
export function testBasicOperations() {
  const store = open('test-store');

  // Set a value
  store.set('test-key', new TextEncoder().encode('test-value'));

  // Get the value back
  const value = store.get('test-key');
  if (!value) {
    return false;
  }

  const decoded = new TextDecoder().decode(value);
  return decoded === 'test-value';
}

/**
 * Test key existence check
 */
export function testExists(key) {
  const store = open('test-store');
  return store.exists(key);
}

/**
 * Test delete operation
 */
export function testDelete(key) {
  const store = open('test-store');
  store.delete(key);
  return !store.exists(key);
}

/**
 * Test list keys
 */
export function testListKeys() {
  const store = open('test-store');

  // Set some keys
  store.set('list-a', new TextEncoder().encode('a'));
  store.set('list-b', new TextEncoder().encode('b'));
  store.set('list-c', new TextEncoder().encode('c'));

  // List keys
  const keys = store.keys();
  return keys.filter(k => k.startsWith('list-')).length >= 3;
}

/**
 * Test getting a non-existent key
 */
export function testGetMissing(key) {
  const store = open('test-store');
  const value = store.get(key);
  return value === null || value === undefined;
}
