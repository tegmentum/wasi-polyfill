/**
 * Tests for manifest export-availability checks and component-hash verification
 * (REMEDIATION-PLAN 3.13). Previously `componentHash` and `exports` were parsed
 * and stored but never used; these verifiers put them to work.
 */

import { describe, it, expect } from 'vitest'
import {
  createManifest,
  validateExports,
  verifyComponentHash,
  type ComponentManifest,
} from '../../src/wasip2/core/index.js'

const BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 2, 3, 4])
// SHA-256 of BYTES, computed independently for the fixture below.
let SHA256_HEX: string

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data.slice())
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('manifest export validation', () => {
  const manifest = createManifest(['wasi:io/streams@0.2.0'], {
    exports: ['wasi:http/incoming-handler@0.2.0', 'wasi:cli/run@0.2.0'],
  })

  it('passes when all required exports are provided', () => {
    const r = validateExports(manifest, [
      { package: 'wasi:http', name: 'incoming-handler', version: '0.2.0' },
    ])
    expect(r.valid).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('reports missing exports', () => {
    const r = validateExports(manifest, [
      { package: 'wasi:cli', name: 'run', version: '0.2.0' },
      { package: 'wasi:keyvalue', name: 'store', version: '0.2.0' },
    ])
    expect(r.valid).toBe(false)
    expect(r.missing.map((i) => i.name)).toEqual(['store'])
  })

  it('ignores version when matching (package/name only)', () => {
    const r = validateExports(manifest, [
      { package: 'wasi:cli', name: 'run', version: '0.9.9' },
    ])
    expect(r.valid).toBe(true)
  })
})

describe('verifyComponentHash', () => {
  it('returns true when no hash is declared', async () => {
    const manifest = createManifest([])
    expect(await verifyComponentHash(manifest, BYTES)).toBe(true)
  })

  it('verifies a matching sha256-prefixed hash', async () => {
    SHA256_HEX ??= await sha256Hex(BYTES)
    const manifest: ComponentManifest = {
      ...createManifest([]),
      componentHash: `sha256:${SHA256_HEX}`,
    }
    expect(await verifyComponentHash(manifest, BYTES)).toBe(true)
  })

  it('verifies a bare hex hash (defaults to sha256) case-insensitively', async () => {
    SHA256_HEX ??= await sha256Hex(BYTES)
    const manifest: ComponentManifest = {
      ...createManifest([]),
      componentHash: SHA256_HEX.toUpperCase(),
    }
    expect(await verifyComponentHash(manifest, BYTES)).toBe(true)
  })

  it('fails on a mismatching hash', async () => {
    const manifest: ComponentManifest = {
      ...createManifest([]),
      componentHash: 'sha256:' + '00'.repeat(32),
    }
    expect(await verifyComponentHash(manifest, BYTES)).toBe(false)
  })

  it('fails when the bytes differ', async () => {
    SHA256_HEX ??= await sha256Hex(BYTES)
    const manifest: ComponentManifest = {
      ...createManifest([]),
      componentHash: `sha256:${SHA256_HEX}`,
    }
    expect(await verifyComponentHash(manifest, new Uint8Array([9, 9, 9]))).toBe(false)
  })

  it('throws on an unsupported algorithm', async () => {
    const manifest: ComponentManifest = {
      ...createManifest([]),
      componentHash: 'md5:abcdef',
    }
    await expect(verifyComponentHash(manifest, BYTES)).rejects.toThrow(/Unsupported/)
  })
})
