/**
 * Browser-side implementation of `tegmentum:pkcs11-tunnel/tunnel`.
 *
 * The pkcs11-gateway-adapter wasm component (Layer-4 of the
 * openssl-provider-wit stack) imports this WIT to ship each PKCS#11
 * RPC over a ws-gateway. This plugin satisfies that import by routing
 * `send-request` to the existing `WsTunnelManager.sendPkcs11Request`,
 * sharing the same tunnel singleton as the TCP/UDP/DNS adapters
 * (same WebSocket connection -> same negotiated Features set ->
 * same auth token).
 *
 * Wire layout for `send-request`'s return value matches the WIT
 * record/variant in pkcs11-gateway-adapter/wit/deps/pkcs11-tunnel/.
 * jco's emitter expects `{ tag: 'ok', val: { status, body } }` for
 * the result and `{ tag: 'err', val: { tag: 'not-connected' } }` (etc)
 * for tunnel errors.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  WsTunnelManager,
  globalTunnelRegistry,
  buildTunnelConfig,
} from './tunnel-manager.js'

class Pkcs11TunnelInstance implements PluginInstance {
  constructor(private readonly tunnel: WsTunnelManager,
              private readonly timeoutMs: number) {}

  getImports(): Record<string, unknown> {
    const fn = this.sendRequest.bind(this)
    return {
      // Both keys for two consumer styles:
      //   - dash-case `send-request` matches the WIT-method form most
      //     polyfill-aware consumers use (forInterfaces resolution).
      //   - camelCase `sendRequest` matches what jco's --instantiation
      //     mode destructures from the import object at runtime.
      'send-request': fn,
      sendRequest:    fn,
    }
  }

  destroy(): void {
    // Tunnel lifecycle is owned by the registry; nothing per-instance to free.
  }

  // jco-compatible handler for `send-request: func(...) -> result<response, tunnel-error>`.
  //
  // jco's --instantiation=async lift wraps the async return in
  // {tag:'ok', val} on resolve and {tag:'err', val} on throw. So we
  // return the inner `response` (= {status, body}) directly on
  // success and `throw {tag:...}` on tunnel error.
  private async sendRequest(fnId: number, args: Uint8Array): Promise<{ status: number, body: Uint8Array }> {
    if (!this.tunnel.isConnected) {
      const ok = await this.tunnel.connect()
      if (!ok) throw { tag: 'not-connected' }
    }
    try {
      const res = await this.tunnel.sendPkcs11Request(fnId, args, this.timeoutMs)
      return { status: res.status, body: res.body }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not connected'))     throw { tag: 'not-connected' }
      if (msg.includes('did not negotiate')) throw { tag: 'feature-unavailable' }
      if (msg.includes('timeout'))           throw { tag: 'timed-out' }
      throw { tag: 'internal', val: msg }
    }
  }
}

/**
 * Tunneled PKCS#11 implementation -- the only one we ship (no
 * `local` variant; the whole point is to talk to a gateway).
 */
export const tunneledPkcs11TunnelImplementation: Implementation = {
  name: 'tunneled',
  description: 'PKCS#11 RPC through the ws-gateway tunnel',
  create(config: PluginConfig): PluginInstance {
    const gatewayUrl = config.options?.['gatewayUrl'] as string | undefined
    const authToken = config.options?.['authToken'] as string | undefined
    const timeoutMs = (config.options?.['timeoutMs'] as number | undefined) ?? 30_000
    if (!gatewayUrl) {
      throw new Error('gatewayUrl is required for tunneled pkcs11-tunnel implementation')
    }
    const tunnel = globalTunnelRegistry.getOrCreate(buildTunnelConfig({ gatewayUrl, authToken }))
    return new Pkcs11TunnelInstance(tunnel, timeoutMs)
  },
}
