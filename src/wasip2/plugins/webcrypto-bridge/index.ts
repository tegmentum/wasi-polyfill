/**
 * tegmentum:webcrypto-bridge — browser-side polyfill plugin.
 *
 * Satisfies the bridge WIT that pkcs11-webcrypto-adapter imports.
 * Two storage backends (chosen at plugin-create time): IndexedDB-
 * persistent (default) and in-memory.
 */
export { webcryptoBrowserImplementation } from './adapter.js'
export { webcryptoBridgePlugin, WEBCRYPTO_BRIDGE_INTERFACE } from './plugin.js'
