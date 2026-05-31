/**
 * PKCS#11 RPC codec for KSW1 Pkcs11Request/Pkcs11Response frames.
 *
 * The gateway tunnels the `pkcs11:host` WIT contract (see
 * pkcs11-wasm-host/wit/) as a request/response RPC. This module
 * defines:
 *
 *   - the fn-id table (one u16 per pkcs11:host method)
 *   - the binary encoding for args/returns of the minimal subset
 *     that pkcs11-bridge actually calls
 *   - encode/decode helpers paired per method
 *
 * Both sides (browser pkcs11-gateway-adapter + gateway server) MUST
 * agree on this spec byte-for-byte. Resource handles (Session,
 * Object, FindCursor) are u32 row-ids minted server-side; the browser
 * just shuttles them opaquely.
 *
 * Wire types (little-endian throughout):
 *   u8 / u16 / u32 / u64                fixed-width integers
 *   bytes(N)                            length-prefixed buffer
 *                                       (u32 length + N bytes)
 *   handle = u32                        server-side resource id
 *   string = bytes(N) holding UTF-8
 *   bool   = u8 (0 = false, !=0 = true)
 *   option<T> = u8 present (0/1) + T iff present
 *   list<T>  = u32 count + count*T
 */

// =====================================================================
// fn-id table
// =====================================================================

/**
 * One enum entry per pkcs11:host method we tunnel. The numeric value
 * is the wire fn-id placed in the first 2 bytes of every
 * Pkcs11RequestPayload.args buffer.
 *
 * Reserve the 0x0000 block for slot-manager, 0x0100 for session,
 * 0x0200 for object, 0x0300 for crypto (rare/none currently), etc.
 * This leaves obvious gaps for new methods without renumbering.
 */
export enum Pkcs11Fn {
  // ---------- slot-manager (pkcs11:token/slot-manager) ----------
  GetSlotList         = 0x0000,   // (bool token_present) -> list<u64>
  GetSlotInfo         = 0x0001,   // (u64 slot)           -> SlotInfo (u8 status + bytes desc)
  GetTokenInfo        = 0x0002,   // (u64 slot)           -> TokenInfo bytes (opaque)
  InitToken           = 0x0003,   // (u64 slot, string so_pin, string label) -> ()
  OpenSession         = 0x0004,   // (u64 slot, u32 flags) -> handle(session)

  // ---------- session (pkcs11:session/session) ----------
  SessionLogin        = 0x0100,   // (handle, u32 user_type, bytes pin) -> ()
  SessionLogout       = 0x0101,   // (handle) -> ()
  SessionClose        = 0x0102,   // (handle) -> ()
  SessionInitPin      = 0x0103,   // (handle, bytes pin) -> ()
  SessionFindInit     = 0x0104,   // (handle, list<Attribute>) -> handle(cursor)
  SessionFindNext     = 0x0105,   // (handle(cursor), u32 max) -> list<handle(object)>
  SessionFindFinal    = 0x0106,   // (handle(cursor)) -> ()
  SessionGenKeyPair   = 0x0107,   // (handle, Mechanism, list<Attr> pub, list<Attr> priv)
                                   //   -> (handle(pub), handle(priv))
  SessionSign         = 0x0108,   // (handle, Mechanism, handle(key), bytes data) -> bytes
  SessionVerify       = 0x0109,   // (handle, Mechanism, handle(key), bytes data, bytes sig) -> ()
  SessionDecrypt      = 0x010a,   // (handle, Mechanism, handle(key), bytes ct, u32 max_out) -> bytes
  SessionEncrypt      = 0x010b,   // (handle, Mechanism, handle(key), bytes pt, u32 max_out) -> bytes

  // ---------- session (continued) ----------
  SessionDigest         = 0x010c, // (handle, Mechanism, bytes data) -> bytes
  SessionSeedRandom     = 0x010d, // (handle, bytes seed) -> ()
  SessionGenerateRandom = 0x010e, // (handle, u32 len)    -> bytes
  SessionCancelFunc     = 0x010f, // (handle) -> ()
  SessionSetPin         = 0x0110, // (handle, bytes old, bytes new) -> ()
  SessionDigestKey      = 0x0111, // (handle, handle(key)) -> ()
  SessionSignRecover    = 0x0112, // (handle, Mechanism, handle(key), bytes data, u32 max_out) -> bytes
  SessionVerifyRecover  = 0x0113, // (handle, Mechanism, handle(key), bytes sig,  u32 max_out) -> bytes
  SessionCreateObject   = 0x0114, // (handle, list<Attribute>) -> handle(object)
  SessionGenerateKey    = 0x0116, // (handle, Mechanism, list<Attribute>) -> handle(object)
  SessionDeriveKey      = 0x0117, // (handle, handle(base), Mechanism, list<Attribute>) -> handle(object)
  SessionWrapKey        = 0x0118, // (handle, Mechanism, handle(wrap), handle(key)) -> bytes
  SessionUnwrapKey      = 0x0119, // (handle, Mechanism, handle(unwrap), bytes, list<Attribute>) -> handle(object)
  SessionCopyObject     = 0x011a, // (handle, handle(src), list<Attribute>) -> handle(object)
  SessionGetOpState     = 0x011b, // (handle, u32 max) -> bytes
  SessionSetOpState     = 0x011c, // (handle, bytes, option<handle(enc)>, option<handle(auth)>) -> ()

  // ---------- slot-manager (continued) ----------
  SlotMgrGetMechList    = 0x0005, // (u64 slot)           -> list<u64>
  SlotMgrInitialize     = 0x0006, // (option<string> config) -> ()
  SlotMgrFinalize       = 0x0007, // ()                    -> ()
  SlotMgrCloseAllSessions = 0x0008, // (u64 slot)          -> ()
  SlotMgrGetInfo          = 0x0009, // ()                  -> ModuleInfo
  SlotMgrGetSlotInfo      = 0x000a, // (u64 slot)          -> SlotInfo
  SlotMgrGetTokenInfo     = 0x000b, // (u64 slot)          -> TokenInfo
  SlotMgrWaitForSlotEvent = 0x000c, // (u32 wait_flags)    -> SlotEvent
  SlotMgrGetMechInfo      = 0x000d, // (u64 slot, u64 mech) -> MechanismInfo
  SessionGetInfo          = 0x011d, // (handle)            -> SessionInfo

  // ---------- multipart crypto ops (init / update / final / abort) ----------
  //   init  : (handle, Mechanism [, handle(key)])    -> ()  (server-side C_*Init)
  //   update: (handle, bytes part, bool last)        -> bytes (encrypt/decrypt) or ()
  //   final : (handle [, u32 max_out | bytes sig])   -> bytes or ()
  //   abort : (handle)                               -> ()  (best-effort; PKCS#11 v2.40 has no C_*Abort)
  SessionEncryptInit   = 0x011e,
  SessionEncryptUpdate = 0x011f,
  SessionEncryptFinal  = 0x0120,
  SessionEncryptAbort  = 0x0121,
  SessionDecryptInit   = 0x0122,
  SessionDecryptUpdate = 0x0123,
  SessionDecryptFinal  = 0x0124,
  SessionDecryptAbort  = 0x0125,
  SessionSignInitMP    = 0x0126,  // distinct from one-shot SessionSign (0x0108)
  SessionSignUpdate    = 0x0127,
  SessionSignFinal     = 0x0128,
  SessionSignAbort     = 0x0129,
  SessionVerifyInitMP  = 0x012a,
  SessionVerifyUpdate  = 0x012b,
  SessionVerifyFinal   = 0x012c,  // takes (handle, bytes signature) -> ()
  SessionVerifyAbort   = 0x012d,
  SessionDigestInitMP  = 0x012e,
  SessionDigestUpdate  = 0x012f,
  SessionDigestFinal   = 0x0130,
  SessionDigestAbort   = 0x0131,
  SessionLoginVendor   = 0x0132, // (handle, u32 vendor_user_type, bytes pin) -> ()

  // ---------- object (pkcs11:object/object) ----------
  ObjectGetAttributes = 0x0200,   // (handle, list<u32>) -> list<Attribute>
  ObjectDestroy       = 0x0201,   // (handle) -> ()
  ObjectGetSize       = 0x0202,   // (handle) -> u64
  ObjectSetAttributes = 0x0203,   // (handle, list<Attribute>) -> ()
  /** Increment refcount of an existing Object row-id; gateway frees the
   *  native handle only when refcount returns to zero. */
  ObjectBind          = 0x0204,   // (handle(session), handle(object)) -> handle(object)

  // ---------- resource lifecycle (cross-cutting) ----------
  // Browser-side drop() of any handle. Server frees the row.
  HandleDrop          = 0xff00,   // (u8 kind, u32 id) -> ()
}

/**
 * Handle kinds for HandleDrop. Match the resource discriminator the
 * server uses internally; the wire just sees the u8.
 */
export enum HandleKind {
  Session = 1,
  Object  = 2,
  Cursor  = 3,
}

// =====================================================================
// Status code (first byte of Pkcs11ResponsePayload.body)
// =====================================================================

export enum Pkcs11Status {
  Ok = 0,
  /** Wire-level error: bad fn-id, malformed args, codec mismatch. */
  ProtocolError = 1,
  /** PKCS#11 CKR_* return value; body has u32 LE ckr followed by msg bytes. */
  CkError = 2,
  /** Backend / gateway-internal error; body has UTF-8 message. */
  Internal = 3,
  /** Auth failed for this connection's token. */
  AuthDenied = 4,
}

// =====================================================================
// Small DER-free encoder primitives
// =====================================================================

class Writer {
  private bufs: Uint8Array[] = []
  private len = 0
  u8(n: number)  { const b = new Uint8Array(1); b[0] = n & 0xff; this.push(b) }
  u16(n: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n & 0xffff, true); this.push(b) }
  u32(n: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); this.push(b) }
  u64(n: bigint) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, n), true); this.push(b) }
  bool(v: boolean) { this.u8(v ? 1 : 0) }
  bytes(b: Uint8Array) { this.u32(b.length); this.push(b) }
  str(s: string) { this.bytes(new TextEncoder().encode(s)) }
  option<T>(v: T | null | undefined, write: (t: T) => void) {
    if (v == null) { this.u8(0) } else { this.u8(1); write(v) }
  }
  list<T>(items: readonly T[], write: (t: T) => void) {
    this.u32(items.length); for (const it of items) write(it)
  }
  private push(b: Uint8Array) { this.bufs.push(b); this.len += b.length }
  finish(): Uint8Array {
    const out = new Uint8Array(this.len)
    let o = 0
    for (const b of this.bufs) { out.set(b, o); o += b.length }
    return out
  }
}

class Reader {
  private off = 0
  private v: DataView
  constructor(public buf: Uint8Array) {
    this.v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  remaining(): number { return this.buf.length - this.off }
  u8(): number  { const n = this.v.getUint8(this.off); this.off += 1; return n }
  u16(): number { const n = this.v.getUint16(this.off, true); this.off += 2; return n }
  u32(): number { const n = this.v.getUint32(this.off, true); this.off += 4; return n }
  u64(): bigint { const n = this.v.getBigUint64(this.off, true); this.off += 8; return n }
  bool(): boolean { return this.u8() !== 0 }
  bytes(): Uint8Array { const n = this.u32(); const o = this.buf.slice(this.off, this.off + n); this.off += n; return o }
  str(): string { return new TextDecoder().decode(this.bytes()) }
  option<T>(read: () => T): T | null { return this.u8() === 0 ? null : read() }
  list<T>(read: () => T): T[] { const n = this.u32(); const out: T[] = []; for (let i = 0; i < n; i++) out.push(read()); return out }
}

export { Writer as Pkcs11Writer, Reader as Pkcs11Reader }

// =====================================================================
// Shared types (mirror the WIT records pkcs11-bridge uses)
// =====================================================================

/** AttributeValue is sum-typed in WIT; on the wire we tag with u8. */
export enum AttrTag {
  Boolean       = 1,
  Uint32        = 2,
  Uint64        = 3,
  ByteString    = 4,
  String        = 5,
  KeyKind       = 6,    // u32, alias of Uint32 with typed semantics
  ObjectClass   = 7,    // u32, ditto
  MechanismType = 8,    // u64
  DateString    = 9,    // utf8 (alias of String)
  VendorBytes   = 10,   // bytes (alias of ByteString)
}

export type AttrValue =
  | { tag: AttrTag.Boolean,       val: boolean }
  | { tag: AttrTag.Uint32,        val: number }
  | { tag: AttrTag.Uint64,        val: bigint }
  | { tag: AttrTag.ByteString,    val: Uint8Array }
  | { tag: AttrTag.String,        val: string }
  | { tag: AttrTag.KeyKind,       val: number }
  | { tag: AttrTag.ObjectClass,   val: number }
  | { tag: AttrTag.MechanismType, val: bigint }
  | { tag: AttrTag.DateString,    val: string }
  | { tag: AttrTag.VendorBytes,   val: Uint8Array }

export interface Attribute {
  cka: number      // u32, e.g. CKA_TOKEN
  value: AttrValue
}

export interface Mechanism {
  ckm: bigint            // u64, e.g. CKM_ECDSA
  parameter: Uint8Array | null
}

export function writeAttribute(w: Writer, a: Attribute) {
  w.u32(a.cka)
  w.u8(a.value.tag)
  switch (a.value.tag) {
    case AttrTag.Boolean:       w.bool(a.value.val); break
    case AttrTag.Uint32:
    case AttrTag.KeyKind:
    case AttrTag.ObjectClass:    w.u32(a.value.val); break
    case AttrTag.Uint64:
    case AttrTag.MechanismType:  w.u64(a.value.val); break
    case AttrTag.ByteString:
    case AttrTag.VendorBytes:    w.bytes(a.value.val); break
    case AttrTag.String:
    case AttrTag.DateString:     w.str(a.value.val); break
  }
}

export function readAttribute(r: Reader): Attribute {
  const cka = r.u32()
  const tag = r.u8() as AttrTag
  let value: AttrValue
  switch (tag) {
    case AttrTag.Boolean:        value = { tag, val: r.bool() }; break
    case AttrTag.Uint32:         value = { tag, val: r.u32() }; break
    case AttrTag.Uint64:         value = { tag, val: r.u64() }; break
    case AttrTag.ByteString:     value = { tag, val: r.bytes() }; break
    case AttrTag.String:         value = { tag, val: r.str() }; break
    case AttrTag.KeyKind:        value = { tag, val: r.u32() }; break
    case AttrTag.ObjectClass:    value = { tag, val: r.u32() }; break
    case AttrTag.MechanismType:  value = { tag, val: r.u64() }; break
    case AttrTag.DateString:     value = { tag, val: r.str() }; break
    case AttrTag.VendorBytes:    value = { tag, val: r.bytes() }; break
    default: throw new Error(`unknown AttrTag ${tag as number}`)
  }
  return { cka, value }
}

export function writeMechanism(w: Writer, m: Mechanism) {
  w.u64(m.ckm)
  w.option(m.parameter, (p) => w.bytes(p))
}

export function readMechanism(r: Reader): Mechanism {
  return { ckm: r.u64(), parameter: r.option(() => r.bytes()) }
}
