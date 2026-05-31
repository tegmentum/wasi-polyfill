/**
 * tegmentum:webauthn-bridge — browser-side polyfill plugin.
 *
 * Satisfies the bridge WIT that pkcs11-webauthn-adapter imports.
 * See ../webauthn-bridge/plugin.ts for the plugin definition and
 * adapter.ts for the navigator.credentials.* implementation.
 */
export { webauthnBrowserImplementation } from './adapter.js'
export { webauthnBridgePlugin, WEBAUTHN_BRIDGE_INTERFACE } from './plugin.js'
