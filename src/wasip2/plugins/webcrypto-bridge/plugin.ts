import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { webcryptoBrowserImplementation } from './adapter.js'

/** tegmentum:webcrypto-bridge/bridge — host interface the
 *  pkcs11-webcrypto-adapter wasm component imports. */
export const WEBCRYPTO_BRIDGE_INTERFACE: WasiInterface = {
  package: 'tegmentum:webcrypto-bridge',
  name: 'bridge',
  version: '0.1.0',
}

/**
 * WebCrypto bridge plugin.
 *
 * Pair with the pkcs11-webcrypto-adapter wasm component. Routes
 * sign/verify/encrypt/decrypt/generate/import calls to
 * `crypto.subtle.*`; persists CryptoKey objects via IndexedDB
 * (default) or an in-memory Map (opt-in for tests).
 *
 * Configuration:
 *   storage  — 'idb' (default) or 'memory'.
 */
export const webcryptoBridgePlugin: WasiPlugin = createPlugin(
  WEBCRYPTO_BRIDGE_INTERFACE,
  { browser: webcryptoBrowserImplementation },
  'browser',
)
