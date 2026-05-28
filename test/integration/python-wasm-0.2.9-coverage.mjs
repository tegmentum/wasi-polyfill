/**
 * Surface coverage check for python.composed.wasm's @0.2.9 imports
 * (added by password-hash-multiplexer with wasip2 = "1.0.3").
 *
 * Confirms the polyfill's version-stripped interface registry satisfies
 * the new @0.2.9 import set with no per-version plugin additions — the
 * existing random / io / cli plugins should serve every minor version
 * jco emits.
 *
 * Run from wasi-polyfill repo root after `npm run build`:
 *   node test/integration/python-wasm-0.2.9-coverage.mjs
 */

import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const POLYFILL_DIR = join(here, '../..')
const PW_COMPOSED = join(here, '../../../python-wasm/build/python.composed.wasm')

if (!existsSync(PW_COMPOSED)) {
  console.error(`SKIP: ${PW_COMPOSED} not built. Run: make python-composed`)
  process.exit(2)
}

const { createPolyfill, ConfigurablePolicy, registerCorePlugins } = await import(
  join(POLYFILL_DIR, 'dist/wasip2/index.js')
)

// Register core plugins into globalRegistry (default), then createPolyfill picks them up.
await registerCorePlugins()
const allowAll = new ConfigurablePolicy({ defaultAllow: true, allow: [] })
const polyfill = createPolyfill({ policy: allowAll })

// The @0.2.9 imports password-hash-multiplexer brings in.
const NEW_029_IMPORTS = [
  'wasi:cli/environment@0.2.9',
  'wasi:cli/exit@0.2.9',
  'wasi:cli/stderr@0.2.9',
  'wasi:io/error@0.2.9',
  'wasi:io/streams@0.2.9',
  'wasi:random/random@0.2.9',
]

let failures = 0
const expect = (cond, msg) => {
  if (cond) console.log(`OK   : ${msg}`)
  else { console.log(`FAIL : ${msg}`); failures++ }
}

console.log('--- @0.2.9 import-surface coverage (jcoCompat mode) ---')
const { imports, denied, missing } = await polyfill.forInterfaces(NEW_029_IMPORTS, {
  jcoCompat: true,
})
const gotKeys = Object.keys(imports)
console.log('  resolved keys:', gotKeys.join(', '))
console.log('  denied:', denied.length, 'missing:', missing.length)

for (const want of NEW_029_IMPORTS) {
  const base = want.split('@')[0]
  const found = gotKeys.find(g => g.startsWith(base))
  expect(!!found, `${want} satisfied (host key: ${found ?? 'MISSING'})`)
}

expect(missing.length === 0, `no missing interfaces (got: ${missing.map(i => `${i.package}/${i.name}@${i.version}`).join(',') || '<none>'})`)

console.log('---')
if (failures === 0) {
  console.log('PASS: existing polyfill plugins cover @0.2.9 with no additions needed.')
  process.exit(0)
} else {
  console.log(`${failures} FAILURES`)
  process.exit(1)
}
