import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { webauthnBrowserImplementation } from './adapter.js'

/** tegmentum:webauthn-bridge/bridge — narrow host interface the
 *  pkcs11-webauthn-adapter wasm component imports. */
export const WEBAUTHN_BRIDGE_INTERFACE: WasiInterface = {
  package: 'tegmentum:webauthn-bridge',
  name: 'bridge',
  version: '0.1.0',
}

/**
 * WebAuthn bridge plugin.
 *
 * Pair with the pkcs11-webauthn-adapter wasm component (Layer-4
 * alternative to pkcs11-provider+softhsm or pkcs11-gateway-adapter).
 * Maps the bridge's list-credentials / sign / register calls to
 * `navigator.credentials.*` + an IndexedDB-backed credential roster.
 *
 * Configuration (per `tunneled.options` block):
 *   rpId  — RP id passed to navigator.credentials.create/get.
 *           Defaults to window.location.hostname; override for
 *           cross-origin scenarios.
 */
export const webauthnBridgePlugin: WasiPlugin = createPlugin(
  WEBAUTHN_BRIDGE_INTERFACE,
  { browser: webauthnBrowserImplementation },
  'browser',
)
