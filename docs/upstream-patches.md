# wasi-polyfill — upstream patches register

Local patches carried against published upstream WASI / browser
runtime layers, with explicit removal conditions. These patches
adapt **compatibility-layer behavior** — they are NOT Fiji
substrate fixes and do not change Fiji's JVM/component
semantics.

## Architectural boundary

| Layer | Responsibility |
|---|---|
| Fiji | JVM / component behavior |
| **wasi-polyfill** | Runtime / browser / WASI compatibility |
| Upstream (e.g. jco) | The published layer being patched |

Patches in `wasi-polyfill/patches/` are *temporary* by design.
Each has a documented **removal condition** keyed to the
upstream's release stream. When that condition is met, the
patch is dropped on the next maintenance pass.

## Active patches

### jco #1574 — browser p2-shim file read BigInt bounds

- **Patch:** `wasi-polyfill/patches/jco/1574-coerce-browser-file-read-bounds-to-numbers.patch`
- **Upstream:** [bytecodealliance/jco#1574](https://github.com/bytecodealliance/jco/pull/1574) (filed 2026-05-29; OPEN)
- **Upstream issue:** [bytecodealliance/jco#1573](https://github.com/bytecodealliance/jco/issues/1573)
- **Reason:** browser p2-shim file read BigInt bounds incompatibility (`Uint8Array.slice` rejects the canonical-ABI `BigInt` `offset` and `length` arguments)
- **Scope:** JCO preview2 / browser shim only (`packages/preview2-shim/lib/browser/filesystem.js Descriptor.read`)
- **Removal condition:** first `@bytecodealliance/preview2-shim` release containing #1574 or an equivalent upstream fix (detected at apply-time by `grep -q 'typeof offset === "bigint"'` against the browser `filesystem.js`)
- **Fiji substrate impact:** **none**
- **Applied by:** `scripts/portability/setup_beta13_browser.sh` (idempotent; skips if the upstream version already contains the fix)
- **Carrying record opened:** 2026-05-29

## How to retire a patch

1. Upstream releases a version containing the fix.
2. Update `package.json` `@bytecodealliance/preview2-shim` to that
   version.
3. Re-run `scripts/portability/setup_beta13_browser.sh` — the
   detection grep matches and the patch is skipped cleanly.
4. Delete the `.patch` file under `wasi-polyfill/patches/jco/`.
5. Remove this section's entry from "Active patches" and add an
   entry under "Retired patches" with the release version that
   absorbed it.

## Retired patches

(none yet)
