/**
 * Browser-side implementation of `tegmentum:webcrypto-bridge/bridge`.
 *
 * Routes the pkcs11-webcrypto-adapter wasm component's calls to
 * `crypto.subtle.*` for the sign/verify/encrypt/decrypt/generate/
 * import paths, plus a small storage layer for CryptoKey persistence.
 *
 * Two storage backends, picked at plugin construction:
 *   - 'idb'    : IndexedDB-persistent via structured-clone of CryptoKey
 *   - 'memory' : Map<keyId, CryptoKey>; cleared on plugin destroy
 *
 * Both expose the same WIT; only the storage strategy differs.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'

// SubtleAlg enum positions per webcrypto-bridge.wit (must stay in sync):
const ALG_NAMES = [
  'ECDSA',           // 0  ecdsa-p256 / p384 / p521 share the SubtleCrypto name; namedCurve narrows
  'ECDSA',           // 1  ecdsa-p384
  'ECDSA',           // 2  ecdsa-p521
  'RSASSA-PKCS1-v1_5', // 3  rsassa-pkcs1v15
  'RSA-PSS',         // 4  rsa-pss
  'RSA-OAEP',        // 5  rsa-oaep
  'AES-GCM',         // 6  aes-gcm
  'AES-KW',          // 7  aes-kw
  'ECDH',            // 8  ecdh-p256
  'ECDH',            // 9  ecdh-p384
  'HKDF',            // 10 hkdf
  'Ed25519',         // 11 ed25519
  'X25519',          // 12 x25519
] as const

const ALG_NAMED_CURVE: Record<number, string | undefined> = {
  0: 'P-256', 1: 'P-384', 2: 'P-521',
  8: 'P-256', 9: 'P-384',
}

const ALG_HASH: Record<number, string | undefined> = {
  // ECDSA/RSA-* default to SHA-256; consumers can override via mech.parameter later.
  0: 'SHA-256', 1: 'SHA-384', 2: 'SHA-512',
  3: 'SHA-256', 4: 'SHA-256', 5: 'SHA-256',
  10: 'SHA-256',
}

type AlgEnum = number  // 0..12

function subtleAlgFor(alg: AlgEnum): AlgorithmIdentifier {
  const name = ALG_NAMES[alg]
  if (!name) throw { tag: 'unsupported-algorithm' }
  const obj: Record<string, unknown> = { name }
  const curve = ALG_NAMED_CURVE[alg]
  if (curve) obj.namedCurve = curve
  const hash = ALG_HASH[alg]
  if (hash) obj.hash = { name: hash }
  return obj as unknown as AlgorithmIdentifier
}

interface KeyInfo {
  keyId:       string
  algorithm:   AlgEnum
  kind:        0 | 1 | 2   // 0=public, 1=private, 2=secret  (matches key-kind enum)
  extractable: boolean
  keyOps:      string[]
  label:       string
  publicSpki:  Uint8Array | null
}

interface KeyStorage {
  put(id: string, key: CryptoKey, info: KeyInfo): Promise<void>
  get(id: string): Promise<{ key: CryptoKey, info: KeyInfo } | null>
  list(labelPrefix: string | null): Promise<KeyInfo[]>
  delete(id: string): Promise<void>
}

class MemoryKeyStorage implements KeyStorage {
  private store = new Map<string, { key: CryptoKey, info: KeyInfo }>()
  async put(id: string, key: CryptoKey, info: KeyInfo): Promise<void> {
    this.store.set(id, { key, info })
  }
  async get(id: string) { return this.store.get(id) ?? null }
  async list(labelPrefix: string | null): Promise<KeyInfo[]> {
    return Array.from(this.store.values())
      .map((v) => v.info)
      .filter((i) => !labelPrefix || i.label.startsWith(labelPrefix))
  }
  async delete(id: string): Promise<void> { this.store.delete(id) }
}

const IDB_NAME    = 'webcrypto-bridge-keys-v1'
const IDB_STORE   = 'keys'
const IDB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'keyId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error ?? new Error('idb open failed'))
  })
}

class IdbKeyStorage implements KeyStorage {
  async put(_id: string, key: CryptoKey, info: KeyInfo): Promise<void> {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      // CryptoKey is structured-cloneable in modern browsers — IDB
      // stores it natively. The KeyInfo metadata travels alongside.
      tx.objectStore(IDB_STORE).put({ ...info, key })
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error ?? new Error('idb put'))
    })
  }
  async get(id: string) {
    const db = await openDb()
    return new Promise<{ key: CryptoKey, info: KeyInfo } | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(id)
      req.onsuccess = () => {
        const r = req.result as (KeyInfo & { key: CryptoKey }) | undefined
        if (!r) { resolve(null); return }
        const { key, ...info } = r
        resolve({ key, info })
      }
      req.onerror = () => reject(req.error ?? new Error('idb get'))
    })
  }
  async list(labelPrefix: string | null): Promise<KeyInfo[]> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).getAll()
      req.onsuccess = () => {
        const all = (req.result ?? []) as Array<KeyInfo & { key: CryptoKey }>
        resolve(all.map(({ key: _, ...info }) => info)
          .filter((i) => !labelPrefix || i.label.startsWith(labelPrefix)))
      }
      req.onerror = () => reject(req.error ?? new Error('idb list'))
    })
  }
  async delete(id: string): Promise<void> {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error ?? new Error('idb delete'))
    })
  }
}

/** Convert Uint8Array to a fresh ArrayBuffer slice — needed because
 *  TS strict types narrow Uint8Array's `.buffer` to ArrayBufferLike
 *  (which can be SharedArrayBuffer), but BufferSource requires
 *  ArrayBuffer specifically. SubtleCrypto methods all accept BufferSource. */
function toBuf(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

function newKeyId(label: string): string {
  // Stable enough for an in-process roster; not cryptographically meaningful.
  return `${label}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
}

async function spkiOf(key: CryptoKey): Promise<Uint8Array | null> {
  if (key.type !== 'public' || !key.extractable) return null
  try {
    return new Uint8Array(await crypto.subtle.exportKey('spki', key))
  } catch {
    return null
  }
}

class WebcryptoBridgeInstance implements PluginInstance {
  constructor(private readonly storage: KeyStorage) {}

  getImports(): Record<string, unknown> {
    const bind = (m: string) => {
      const fn = (this as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>)[m]
      if (!fn) throw new Error(`webcrypto-bridge: method ${m} missing`)
      return fn.bind(this)
    }
    return {
      // dash-case form for WIT-method import resolution; bare identifier
      // form for jco --instantiation runtime destructuring.
      'list-keys':    bind('listKeys'),    listKeys:    bind('listKeys'),
      'generate-key': bind('generateKey'), generateKey: bind('generateKey'),
      'import-key':   bind('importKey'),   importKey:   bind('importKey'),
      'delete-key':   bind('deleteKey'),   deleteKey:   bind('deleteKey'),
      // Methods without dashes — single entry covers both forms.
      sign:    bind('sign'),
      verify:  bind('verify'),
      encrypt: bind('encrypt'),
      decrypt: bind('decrypt'),
    }
  }

  destroy(): void {
    if (this.storage instanceof MemoryKeyStorage) {
      // Clear the in-memory map; idb-backed storage survives the plugin.
      (this.storage as unknown as { store: Map<unknown, unknown> }).store.clear()
    }
  }

  async listKeys(labelPrefix: string | null): Promise<KeyInfo[]> {
    try {
      return await this.storage.list(labelPrefix ?? null)
    } catch (e) {
      throw { tag: 'storage-error', val: String(e) }
    }
  }

  async sign(keyId: string, algorithm: AlgEnum, data: Uint8Array): Promise<Uint8Array> {
    const entry = await this.lookup(keyId)
    try {
      const sig = await crypto.subtle.sign(subtleAlgFor(algorithm), entry.key, toBuf(data))
      return new Uint8Array(sig)
    } catch (e) {
      throw { tag: 'subtle-failed', val: (e as Error).message }
    }
  }

  async verify(keyId: string, algorithm: AlgEnum, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const entry = await this.lookup(keyId)
    try {
      return await crypto.subtle.verify(subtleAlgFor(algorithm), entry.key, toBuf(signature), toBuf(data))
    } catch (e) {
      throw { tag: 'subtle-failed', val: (e as Error).message }
    }
  }

  async encrypt(keyId: string, algorithm: AlgEnum, plaintext: Uint8Array): Promise<Uint8Array> {
    const entry = await this.lookup(keyId)
    try {
      const ct = await crypto.subtle.encrypt(subtleAlgFor(algorithm), entry.key, toBuf(plaintext))
      return new Uint8Array(ct)
    } catch (e) {
      throw { tag: 'subtle-failed', val: (e as Error).message }
    }
  }

  async decrypt(keyId: string, algorithm: AlgEnum, ciphertext: Uint8Array): Promise<Uint8Array> {
    const entry = await this.lookup(keyId)
    try {
      const pt = await crypto.subtle.decrypt(subtleAlgFor(algorithm), entry.key, toBuf(ciphertext))
      return new Uint8Array(pt)
    } catch (e) {
      throw { tag: 'subtle-failed', val: (e as Error).message }
    }
  }

  async generateKey(
    algorithm: AlgEnum, extractable: boolean, keyOps: string[], label: string,
  ): Promise<KeyInfo> {
    const algSpec = subtleAlgFor(algorithm)
    let key: CryptoKey | CryptoKeyPair
    try {
      // RSA needs modulus + exponent; AES needs length. Fill in defaults.
      const fullSpec: Record<string, unknown> = { ...(algSpec as object) }
      const name = (algSpec as { name: string }).name
      if (name.startsWith('RSA')) {
        fullSpec.modulusLength   = 2048
        fullSpec.publicExponent  = new Uint8Array([0x01, 0x00, 0x01])
      }
      if (name === 'AES-GCM' || name === 'AES-KW') {
        fullSpec.length = 256
      }
      key = await crypto.subtle.generateKey(fullSpec as unknown as AlgorithmIdentifier, extractable,
        keyOps as KeyUsage[])
    } catch (e) {
      throw { tag: 'subtle-failed', val: (e as Error).message }
    }

    if ('publicKey' in key) {
      // Asymmetric: store both halves; return public-half info.
      const pubId  = newKeyId(label + ':pub')
      const privId = newKeyId(label + ':priv')
      const pubSpki = await spkiOf(key.publicKey)
      const pubInfo: KeyInfo = {
        keyId: pubId, algorithm, kind: 0, extractable: true, keyOps,
        label, publicSpki: pubSpki,
      }
      const privInfo: KeyInfo = {
        keyId: privId, algorithm, kind: 1, extractable, keyOps,
        label, publicSpki: pubSpki,
      }
      try {
        await this.storage.put(pubId,  key.publicKey,  pubInfo)
        await this.storage.put(privId, key.privateKey, privInfo)
      } catch (e) {
        throw { tag: 'storage-error', val: String(e) }
      }
      return pubInfo
    }

    // Symmetric.
    const id = newKeyId(label)
    const info: KeyInfo = {
      keyId: id, algorithm, kind: 2, extractable, keyOps, label,
      publicSpki: null,
    }
    try { await this.storage.put(id, key, info) }
    catch (e) { throw { tag: 'storage-error', val: String(e) } }
    return info
  }

  async importKey(
    format: string, keyBytes: Uint8Array, algorithm: AlgEnum,
    extractable: boolean, keyOps: string[], label: string,
  ): Promise<KeyInfo> {
    let key: CryptoKey
    try {
      if (format === 'jwk') {
        // jwk overload: key bytes are UTF-8-encoded JSON.
        const jwk = JSON.parse(new TextDecoder().decode(keyBytes)) as JsonWebKey
        key = await crypto.subtle.importKey(
          'jwk', jwk, subtleAlgFor(algorithm),
          extractable, keyOps as KeyUsage[],
        )
      } else {
        // raw / pkcs8 / spki overload: BufferSource.
        key = await crypto.subtle.importKey(
          format as 'raw' | 'pkcs8' | 'spki', toBuf(keyBytes), subtleAlgFor(algorithm),
          extractable, keyOps as KeyUsage[],
        )
      }
    } catch (e) {
      throw { tag: 'subtle-failed', val: (e as Error).message }
    }
    const id = newKeyId(label)
    const info: KeyInfo = {
      keyId: id, algorithm,
      kind: key.type === 'public' ? 0 : key.type === 'private' ? 1 : 2,
      extractable, keyOps, label,
      publicSpki: await spkiOf(key),
    }
    try { await this.storage.put(id, key, info) }
    catch (e) { throw { tag: 'storage-error', val: String(e) } }
    return info
  }

  async deleteKey(keyId: string): Promise<void> {
    try { await this.storage.delete(keyId) }
    catch (e) { throw { tag: 'storage-error', val: String(e) } }
  }

  private async lookup(keyId: string): Promise<{ key: CryptoKey, info: KeyInfo }> {
    let entry: { key: CryptoKey, info: KeyInfo } | null
    try { entry = await this.storage.get(keyId) }
    catch (e) { throw { tag: 'storage-error', val: String(e) } }
    if (!entry) throw { tag: 'no-such-key' }
    return entry
  }
}

function makeStorage(kind: 'idb' | 'memory'): KeyStorage {
  return kind === 'memory' ? new MemoryKeyStorage() : new IdbKeyStorage()
}

export const webcryptoBrowserImplementation: Implementation = {
  name: 'browser',
  description: 'SubtleCrypto bridge with IndexedDB or in-memory key storage',
  create(config: PluginConfig): PluginInstance {
    const storageKind = ((config.options?.['storage'] as string | undefined) ?? 'idb') as 'idb' | 'memory'
    return new WebcryptoBridgeInstance(makeStorage(storageKind))
  },
}
