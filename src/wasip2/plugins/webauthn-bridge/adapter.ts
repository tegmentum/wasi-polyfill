/**
 * Browser-side implementation of `tegmentum:webauthn-bridge/bridge`.
 *
 * Satisfies the `pkcs11-webauthn-adapter` wasm component's import by
 * routing list/sign/register calls to `navigator.credentials.*` +
 * an IndexedDB-backed credential roster (because the WebAuthn API
 * has no "list my credentials" primitive — the polyfill remembers
 * what `register()` returned).
 *
 * jco's --instantiation=async lift wraps the async return in
 * `{tag:'ok', val}` on resolve and `{tag:'err', val}` on throw, so
 * we return the inner record directly on success and `throw {tag:...}`
 * for bridge-error variants.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'

// COSE algorithm enum positions per webauthn-bridge.wit:
//   es256(0) | rs256(1) | eddsa(2) | ps256(3)
// COSE numeric identifiers: ES256=-7, RS256=-257, EdDSA=-8, PS256=-37.
const COSE_ENUM_TO_NUMBER = [-7, -257, -8, -37] as const
const COSE_NUMBER_TO_ENUM: Record<number, number> = { [-7]: 0, [-257]: 1, [-8]: 2, [-37]: 3 }

type CoseEnum = 0 | 1 | 2 | 3

interface CredentialInfo {
  credentialId:   Uint8Array
  rpId:           string
  algorithm:      CoseEnum
  publicKeySpki:  Uint8Array
  label:          string
}

const IDB_NAME    = 'webauthn-bridge-credentials-v1'
const IDB_STORE   = 'credentials'
const IDB_VERSION = 1

/** Open the IndexedDB instance the polyfill uses to persist the
 *  credential roster across page reloads. The browser doesn't expose
 *  a "list my credentials" API — register() is the only way to learn
 *  about a credential, so we cache what it returns. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'credentialIdHex' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error ?? new Error('idb open failed'))
  })
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function dbList(rpId: string): Promise<CredentialInfo[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).getAll()
    req.onsuccess = () => {
      const all = (req.result ?? []) as Array<CredentialInfo & { credentialIdHex: string }>
      // Filter by rpId in JS; small N (typically <100 credentials per RP).
      resolve(all.filter((c) => c.rpId === rpId).map(({ credentialIdHex: _, ...rest }) => rest))
    }
    req.onerror = () => reject(req.error ?? new Error('idb list failed'))
  })
}

async function dbPut(c: CredentialInfo): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put({ ...c, credentialIdHex: hex(c.credentialId) })
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error ?? new Error('idb put failed'))
  })
}

/** Extract SPKI from a PublicKeyCredential's attestationObject.
 *  Authenticators encode the public key in COSE format inside the
 *  attestation object; we wrap it as SPKI for downstream OpenSSL
 *  consumers. For ES256 (the common case) this is a few-line
 *  encoding; for RSA we leave a TODO. */
async function spkiFromAttestation(cred: PublicKeyCredential): Promise<{ spki: Uint8Array, alg: CoseEnum }> {
  // WebAuthn provides getPublicKey() / getPublicKeyAlgorithm() on the
  // AuthenticatorAttestationResponse in newer browsers. Use those if
  // present; otherwise fall back to manual CBOR decode of the
  // attestationObject (Phase 2 enhancement).
  const resp = cred.response as AuthenticatorAttestationResponse
  if (typeof (resp as unknown as { getPublicKey(): ArrayBuffer | null }).getPublicKey === 'function') {
    const spki = (resp as unknown as { getPublicKey(): ArrayBuffer | null }).getPublicKey()
    const algNum = (resp as unknown as { getPublicKeyAlgorithm(): number }).getPublicKeyAlgorithm()
    if (spki) {
      return { spki: new Uint8Array(spki), alg: (COSE_NUMBER_TO_ENUM[algNum] ?? 0) as CoseEnum }
    }
  }
  // Fallback: empty SPKI; caller will see CKA_VALUE = []. The
  // wit-bridge sign path doesn't need SPKI (the signature comes back
  // from navigator.credentials.get directly); the SPKI is only needed
  // for cert-chain validation, which authenticator-internal keys
  // typically delegate to the platform attestation chain anyway.
  return { spki: new Uint8Array(0), alg: 0 as CoseEnum }
}

class WebauthnBridgeInstance implements PluginInstance {
  constructor(private readonly defaultRpId: string) {}

  getImports(): Record<string, unknown> {
    return {
      // dash-case form for WIT-method import resolution; bare identifier
      // form for jco --instantiation runtime destructuring.
      'list-credentials': this.listCredentials.bind(this),
      listCredentials:    this.listCredentials.bind(this),
      // sign and register have no dash so one entry covers both forms.
      sign:     this.sign.bind(this),
      register: this.register.bind(this),
    }
  }

  destroy(): void {}

  private async listCredentials(rpId: string): Promise<CredentialInfo[]> {
    const rp = rpId || this.defaultRpId
    try {
      return await dbList(rp)
    } catch (e) {
      throw { tag: 'storage-error', val: String(e) }
    }
  }

  private async sign(credentialId: Uint8Array, challenge: Uint8Array): Promise<Uint8Array> {
    let assertion: PublicKeyCredential | null
    try {
      assertion = (await navigator.credentials.get({
        publicKey: {
          challenge:        challenge.buffer.slice(challenge.byteOffset, challenge.byteOffset + challenge.byteLength) as ArrayBuffer,
          allowCredentials: [{
            id:   credentialId.buffer.slice(credentialId.byteOffset, credentialId.byteOffset + credentialId.byteLength) as ArrayBuffer,
            type: 'public-key',
          }],
          userVerification: 'required',
        },
      })) as PublicKeyCredential | null
    } catch (e) {
      throw { tag: 'webauthn-rejected', val: (e as Error).message }
    }
    if (!assertion) throw { tag: 'webauthn-rejected', val: 'no assertion returned' }
    const resp = assertion.response as AuthenticatorAssertionResponse
    return new Uint8Array(resp.signature)
  }

  private async register(
    rpId: string,
    userName: string,
    label: string,
    algorithm: CoseEnum,
    challenge: Uint8Array,
  ): Promise<CredentialInfo> {
    const rp = rpId || this.defaultRpId
    const algNum = COSE_ENUM_TO_NUMBER[algorithm]
    let cred: PublicKeyCredential | null
    try {
      const userIdBytes = new TextEncoder().encode(userName)
      cred = (await navigator.credentials.create({
        publicKey: {
          rp: { id: rp, name: rp },
          user: {
            id:          userIdBytes.buffer.slice(userIdBytes.byteOffset, userIdBytes.byteOffset + userIdBytes.byteLength) as ArrayBuffer,
            name:        userName,
            displayName: label,
          },
          pubKeyCredParams:       [{ type: 'public-key', alg: algNum }],
          challenge:              challenge.buffer.slice(challenge.byteOffset, challenge.byteOffset + challenge.byteLength) as ArrayBuffer,
          authenticatorSelection: { userVerification: 'required' },
          timeout:                60_000,
        },
      })) as PublicKeyCredential | null
    } catch (e) {
      throw { tag: 'webauthn-rejected', val: (e as Error).message }
    }
    if (!cred) throw { tag: 'webauthn-rejected', val: 'no credential returned' }
    const { spki, alg } = await spkiFromAttestation(cred)
    const info: CredentialInfo = {
      credentialId:  new Uint8Array(cred.rawId),
      rpId:          rp,
      algorithm:     alg,
      publicKeySpki: spki,
      label,
    }
    try {
      await dbPut(info)
    } catch (e) {
      throw { tag: 'storage-error', val: String(e) }
    }
    return info
  }
}

export const webauthnBrowserImplementation: Implementation = {
  name: 'browser',
  description: 'WebAuthn bridge via navigator.credentials.{create, get} + IndexedDB credential roster',
  create(config: PluginConfig): PluginInstance {
    const defaultRpId =
      (config.options?.['rpId'] as string | undefined) ??
      (typeof window !== 'undefined' ? window.location.hostname : 'localhost')
    return new WebauthnBridgeInstance(defaultRpId)
  },
}
