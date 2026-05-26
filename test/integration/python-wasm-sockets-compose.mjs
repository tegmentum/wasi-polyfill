/**
 * Phase 3p smoke (componentize-python plan, docs/phase-3-tls.md): exercise
 * the wasi-polyfill sockets + ws-gateway plugins against python-wasm's
 * composed python.wasm (which includes openssl-component/tls and therefore
 * imports the wasi:sockets/* family).
 *
 * Goal: confirm the polyfill provides every wasi:sockets import the composed
 * component needs. This is a SURFACE check — we don't perform real TLS here
 * (Phase 3c.1 will, against a real wss-gateway). What we prove: registering
 * the sockets + ws-gateway plugins covers the surface, so a future
 * polyfill.forInterfaces(...) call from python-wasm's web demo succeeds.
 *
 * Run from wasi-polyfill repo root:
 *   npm run build && node test/integration/python-wasm-sockets-compose.mjs
 *
 * Requires python-wasm/build/python.composed.wasm (run in python-wasm:
 *   make python-composed).
 */

import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const POLYFILL_DIR = join(here, '../..')
const PW_COMPOSED = join(here, '../../../python-wasm/build/python.composed.wasm')

if (!existsSync(PW_COMPOSED)) {
  console.error(`SKIP: ${PW_COMPOSED} not built.`)
  console.error(`Run in python-wasm: make python-composed`)
  process.exit(2)
}

// Public API the wasi-polyfill plugins expose for this scenario.
const { createPolyfill, ConfigurablePolicy } = await import(
  join(POLYFILL_DIR, 'dist/wasip2/index.js')
)
// A permissive policy that allows every interface the composed python.wasm
// needs (this test is about plugin-coverage, not policy enforcement).
const allowAllPolicy = new ConfigurablePolicy({ defaultAllow: true, allow: [] })
const { socketPlugins } = await import(
  join(POLYFILL_DIR, 'dist/wasip2/plugins/sockets/index.js')
)
const wsGateway = await import(
  join(POLYFILL_DIR, 'dist/wasip2/plugins/ws-gateway/index.js')
)

// Composed wasm imports (from `wasm-tools component wit`):
//   wasi:sockets/{network, instance-network, ip-name-lookup,
//                 tcp, tcp-create-socket, udp, udp-create-socket}
// All at @0.2.6 (post-bump), with a couple of legacy @0.2.3 carried from
// compression-multiplexer (handled by the registry's version-agnostic key).
const REQUIRED_SOCKETS = [
  'wasi:sockets/network@0.2.6',
  'wasi:sockets/instance-network@0.2.6',
  'wasi:sockets/ip-name-lookup@0.2.6',
  'wasi:sockets/tcp@0.2.6',
  'wasi:sockets/tcp-create-socket@0.2.6',
  'wasi:sockets/udp@0.2.6',
  'wasi:sockets/udp-create-socket@0.2.6',
]

let failures = 0
const expect = (cond, msg) => {
  if (cond) console.log(`OK   : ${msg}`)
  else { console.log(`FAIL : ${msg}`); failures++ }
}

// --- Path 1: virtual sockets (browser-NotSupported fallback) -----------------
console.log('--- virtual sockets plugin set ---')
{
  const polyfill = createPolyfill({ policy: allowAllPolicy })
  for (const p of socketPlugins) polyfill.registerPlugin(p)
  try {
    const { imports } = await polyfill.forInterfaces(REQUIRED_SOCKETS)
    const got = Object.keys(imports)
    for (const want of REQUIRED_SOCKETS) {
      const base = want.split('@')[0]
      const found = got.find(g => g.startsWith(base))
      expect(!!found, `virtual: ${want} satisfied (host key: ${found ?? 'MISSING'})`)
    }
  } catch (e) {
    expect(false, `virtual: forInterfaces threw: ${e.message}`)
  }
}

// --- Path 2: ws-gateway-backed TCP (real network via WebSocket proxy) -------
console.log('--- ws-gateway TCP plugin set ---')
{
  const polyfill = createPolyfill({ policy: allowAllPolicy })
  // Register network + instance-network + DNS from the virtual set (these
  // plugins are reused across both paths), then override TCP with the
  // gateway implementation that backs the socket with a WebSocket.
  for (const p of socketPlugins) polyfill.registerPlugin(p)
  polyfill.registerPlugin(wsGateway.wsGatewayTcpPlugin, {
    options: { gatewayUrl: 'wss://example.test/ws' },
  })
  polyfill.registerPlugin(wsGateway.wsGatewayTcpCreateSocketPlugin, {
    options: { gatewayUrl: 'wss://example.test/ws' },
  })
  try {
    const { imports } = await polyfill.forInterfaces(REQUIRED_SOCKETS)
    const got = Object.keys(imports)
    for (const want of REQUIRED_SOCKETS) {
      const base = want.split('@')[0]
      const found = got.find(g => g.startsWith(base))
      expect(!!found, `gateway: ${want} satisfied`)
    }
  } catch (e) {
    expect(false, `gateway: forInterfaces threw: ${e.message}`)
  }
}

console.log('---')
if (failures === 0) {
  console.log('PASS: Phase 3p surface coverage complete.')
  console.log('Phase 3c.1 will hit a real TLS server through this stack.')
  process.exit(0)
} else {
  console.log(`${failures} FAILURES`)
  process.exit(1)
}
