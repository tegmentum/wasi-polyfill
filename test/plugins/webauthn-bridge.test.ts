/**
 * Smoke tests for the webauthn-bridge plugin. Node doesn't have a
 * real `navigator.credentials` — we mock it just enough to exercise
 * the bridge's three methods (list-credentials, sign, register) and
 * verify the IndexedDB-backed credential roster round-trip.
 *
 * Real-browser correctness is verified out of band via a manual
 * browser-driven smoke once the openssl-wasm component is composed
 * with pkcs11-webauthn-adapter (WITH_PKCS11_WEBAUTHN=1).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'  // populates globalThis.indexedDB
import { webauthnBridgePlugin } from '../../src/wasip2/plugins/webauthn-bridge/index.js'

// CoseAlg enum positions per webauthn-bridge.wit:
//   es256(0) | rs256(1) | eddsa(2) | ps256(3)
const COSE_ES256 = 0

interface CredentialInfo {
  credentialId:   Uint8Array
  rpId:           string
  algorithm:      number
  publicKeySpki:  Uint8Array
  label:          string
}

interface BridgeImports {
  listCredentials: (rpId: string) => Promise<CredentialInfo[]>
  sign:            (credentialId: Uint8Array, challenge: Uint8Array) => Promise<Uint8Array>
  register:        (rpId: string, userName: string, label: string, alg: number, challenge: Uint8Array) => Promise<CredentialInfo>
}

// Mock navigator.credentials with deterministic credentials.
const MOCK_CRED_ID  = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
const MOCK_SPKI     = new Uint8Array([0x30, 0x59, 0x30, 0x13]) // truncated; just enough bytes for the smoke
const MOCK_SIG      = new Uint8Array([0x30, 0x44, 0x02, 0x20, 0xde, 0xad, 0xbe, 0xef])

const navMock = {
  credentials: {
    async create(_opts: unknown): Promise<unknown> {
      return {
        rawId: MOCK_CRED_ID.buffer.slice(0),
        response: {
          getPublicKey:           () => MOCK_SPKI.buffer.slice(0),
          getPublicKeyAlgorithm:  () => -7,  // ES256
        },
      }
    },
    async get(_opts: unknown): Promise<unknown> {
      return {
        rawId: MOCK_CRED_ID.buffer.slice(0),
        response: {
          signature: MOCK_SIG.buffer.slice(0),
        },
      }
    },
  },
}

beforeAll(() => {
  // Node 18+'s globalThis.navigator is a read-only getter. Use
  // defineProperty so we can supply (and later restore) a writable
  // descriptor for the mock.
  Object.defineProperty(globalThis, 'navigator', {
    value: navMock,
    writable: true, configurable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: { location: { hostname: 'test.example' } },
    writable: true, configurable: true,
  })
})

afterAll(() => {
  // Best-effort cleanup; leaving the mock in place is harmless since
  // vitest isolates test files in separate workers.
  try { delete (globalThis as unknown as { navigator?: unknown }).navigator } catch { /* getter */ }
  try { delete (globalThis as unknown as { window?: unknown }).window } catch { /* getter */ }
})

let imports: BridgeImports

beforeAll(() => {
  const instance = webauthnBridgePlugin.create({
    implementation: 'browser',
    options: { rpId: 'test.example' },
  })
  imports = instance.getImports() as unknown as BridgeImports
})

describe('webauthn-bridge / mocked navigator.credentials', () => {
  it('registers a credential and lists it back', async () => {
    const challenge = new Uint8Array([9, 8, 7, 6])
    const info = await imports.register('test.example', 'alice', 'smoke-cred', COSE_ES256, challenge)
    expect(info.credentialId).toEqual(MOCK_CRED_ID)
    expect(info.publicKeySpki).toEqual(MOCK_SPKI)
    expect(info.algorithm).toBe(COSE_ES256)
    expect(info.label).toBe('smoke-cred')

    const listed = await imports.listCredentials('test.example')
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.some((c) => c.label === 'smoke-cred')).toBe(true)
  })

  it('returns an empty list for an unknown rpId', async () => {
    const listed = await imports.listCredentials('other.example')
    expect(listed.length).toBe(0)
  })

  it('signs via navigator.credentials.get and returns the raw signature', async () => {
    const sig = await imports.sign(MOCK_CRED_ID, new Uint8Array([1, 2, 3]))
    expect(sig).toEqual(MOCK_SIG)
  })

  it('surfaces navigator rejections as webauthn-rejected', async () => {
    // Override the mock to throw once.
    const nav = (globalThis as unknown as { navigator: { credentials: { get: unknown } } }).navigator
    const orig = nav.credentials.get
    nav.credentials.get = async () => { throw new Error('user cancelled') }
    await expect(
      imports.sign(MOCK_CRED_ID, new Uint8Array([1]))
    ).rejects.toMatchObject({ tag: 'webauthn-rejected' })
    nav.credentials.get = orig
  })
})
