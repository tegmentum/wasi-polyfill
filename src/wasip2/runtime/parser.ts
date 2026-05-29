/**
 * Lightweight WebAssembly Component Model binary parser
 *
 * Parses component binaries to extract import information without
 * requiring heavyweight dependencies like jco.
 *
 * Based on the Component Model binary format specification.
 * https://github.com/WebAssembly/component-model/blob/main/design/mvp/Binary.md
 */

import type { WasiInterface } from '../core/types.js'
import { parseInterfaceString } from '../core/types.js'

/**
 * Parsed import information from a component
 */
export interface ParsedImport {
  /** The full import name (e.g., "wasi:random/random@0.2.0") */
  name: string
  /** Parsed WASI interface if it's a WASI import, null otherwise */
  wasiInterface: WasiInterface | null
  /** Import kind (instance, func, etc.) */
  kind: ImportKind
}

export type ImportKind =
  | 'module'
  | 'func'
  | 'value'
  | 'type'
  | 'component'
  | 'instance'

/**
 * Result of parsing a component
 */
export interface ParsedComponentInfo {
  /** All imports found in the component */
  imports: ParsedImport[]
  /** Just the WASI imports */
  wasiImports: ParsedImport[]
  /** Interfaces required by the component */
  requiredInterfaces: WasiInterface[]
  /** Whether this appears to be a valid component */
  isComponent: boolean
}

// Component Model constants
const COMPONENT_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6d]) // \0asm
const COMPONENT_VERSION = new Uint8Array([0x0d, 0x00, 0x01, 0x00]) // version 13 (component)

// Section IDs for components (Component Model binary spec).
// 1=core:module, 2=core:instance, 3=core:type, 4=component, 5=instance,
// 6=alias, 7=type, 8=canon, 9=start, 10=import, 11=export.
const SECTION_IMPORT = 0x0a

// Extern-desc kinds inside a component import.
const EXTERN_KIND_CORE_MODULE = 0x00
const EXTERN_KIND_FUNC = 0x01
const EXTERN_KIND_VALUE = 0x02
const EXTERN_KIND_TYPE = 0x03
const EXTERN_KIND_COMPONENT = 0x04
const EXTERN_KIND_INSTANCE = 0x05

/**
 * Simple binary reader with LEB128 support
 */
class BinaryReader {
  private view: DataView
  private offset: number = 0

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get position(): number {
    return this.offset
  }

  set position(pos: number) {
    this.offset = pos
  }

  get remaining(): number {
    return this.bytes.length - this.offset
  }

  readBytes(count: number): Uint8Array {
    const result = this.bytes.subarray(this.offset, this.offset + count)
    this.offset += count
    return result
  }

  readByte(): number {
    return this.bytes[this.offset++]!
  }

  readU32(): number {
    const result = this.view.getUint32(this.offset, true)
    this.offset += 4
    return result
  }

  /**
   * Read unsigned LEB128 encoded integer
   */
  readLeb128U32(): number {
    let result = 0
    let shift = 0
    let byte: number

    do {
      byte = this.bytes[this.offset++]!
      result |= (byte & 0x7f) << shift
      shift += 7
    } while (byte & 0x80)

    return result >>> 0
  }

  /**
   * Read a UTF-8 string with LEB128 length prefix
   */
  readString(): string {
    const length = this.readLeb128U32()
    const bytes = this.readBytes(length)
    return new TextDecoder().decode(bytes)
  }

  /**
   * Skip bytes
   */
  skip(count: number): void {
    this.offset += count
  }

  /**
   * Check if we've reached the end
   */
  isEof(): boolean {
    return this.offset >= this.bytes.length
  }
}

/**
 * Parse a WebAssembly component binary to extract import information
 *
 * This is a lightweight parser that only extracts what's needed for
 * instantiation without full component model parsing.
 *
 * @param bytes - The component binary
 * @returns Parsed component information
 */
export function parseComponentImports(
  bytes: ArrayBuffer | Uint8Array
): ParsedComponentInfo {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const reader = new BinaryReader(data)

  // Check magic number
  const magic = reader.readBytes(4)
  if (!arraysEqual(magic, COMPONENT_MAGIC)) {
    return {
      imports: [],
      wasiImports: [],
      requiredInterfaces: [],
      isComponent: false,
    }
  }

  // Check version - should be component version
  const version = reader.readBytes(4)
  const isComponent = arraysEqual(version, COMPONENT_VERSION)

  if (!isComponent) {
    // This might be a core module, not a component
    return {
      imports: [],
      wasiImports: [],
      requiredInterfaces: [],
      isComponent: false,
    }
  }

  const imports: ParsedImport[] = []

  // Parse sections looking for imports
  while (!reader.isEof() && reader.remaining > 0) {
    const sectionId = reader.readByte()
    const sectionSize = reader.readLeb128U32()
    const sectionEnd = reader.position + sectionSize

    if (sectionId === SECTION_IMPORT) {
      // Parse import section
      const importCount = reader.readLeb128U32()

      for (let i = 0; i < importCount; i++) {
        // import-name = discriminator byte (0x00 = plain, 0x01 = interface)
        // followed by a length-prefixed UTF-8 string. Both forms share the
        // same on-wire payload; the byte is the semantic tag only.
        reader.readByte() // discriminator
        const importName = reader.readString()

        const externKind = reader.readByte()
        skipComponentExternDesc(reader, externKind)

        const kind = componentExternKindFromByte(externKind)
        const wasiInterface = tryParseWasiInterface(importName)

        imports.push({
          name: importName,
          wasiInterface,
          kind,
        })
      }
    } else {
      // Skip this section
      reader.position = sectionEnd
    }

    // Safety: ensure we don't read past section boundaries
    if (reader.position > sectionEnd) {
      break
    }
  }

  // Extract WASI imports
  const wasiImports = imports.filter((i) => i.wasiInterface !== null)
  const requiredInterfaces = wasiImports
    .map((i) => i.wasiInterface!)
    .filter((iface, index, arr) => {
      // Deduplicate
      return (
        arr.findIndex(
          (other) =>
            other.package === iface.package &&
            other.name === iface.name &&
            other.version === iface.version
        ) === index
      )
    })

  return {
    imports,
    wasiImports,
    requiredInterfaces,
    isComponent: true,
  }
}

/**
 * Try to parse an import name as a WASI interface
 */
function tryParseWasiInterface(name: string): WasiInterface | null {
  if (!name.startsWith('wasi:')) {
    return null
  }

  try {
    return parseInterfaceString(name)
  } catch {
    // Not a valid WASI interface string
    return null
  }
}

/**
 * Convert component extern-desc kind byte to enum.
 */
function componentExternKindFromByte(byte: number): ImportKind {
  switch (byte) {
    case EXTERN_KIND_CORE_MODULE:
      return 'module'
    case EXTERN_KIND_FUNC:
      return 'func'
    case EXTERN_KIND_VALUE:
      return 'value'
    case EXTERN_KIND_TYPE:
      return 'type'
    case EXTERN_KIND_COMPONENT:
      return 'component'
    case EXTERN_KIND_INSTANCE:
      return 'instance'
    default:
      return 'instance'
  }
}

/**
 * Skip a component import's extern-desc body. Per the Component Model
 * binary spec, an import's extern-desc is:
 *   0x00 0x11 typeidx        core-module
 *   0x01 typeidx             func
 *   0x02 valuebound          value
 *   0x03 typebound           type
 *   0x04 typeidx             component
 *   0x05 typeidx             instance
 * For WASI imports we only need to advance past the body to reach the
 * next import; we don't decode the type itself.
 */
function skipComponentExternDesc(reader: BinaryReader, kind: number): void {
  switch (kind) {
    case EXTERN_KIND_CORE_MODULE:
      // 0x00 0x11 typeidx — the kind byte (0x00) is already consumed;
      // skip the 0x11 sub-tag, then the typeidx.
      reader.readByte()
      reader.readLeb128U32()
      break
    case EXTERN_KIND_FUNC:
    case EXTERN_KIND_COMPONENT:
    case EXTERN_KIND_INSTANCE:
      reader.readLeb128U32()
      break
    case EXTERN_KIND_VALUE:
      skipValueType(reader)
      break
    case EXTERN_KIND_TYPE:
      skipTypeBounds(reader)
      break
    default:
      // Unknown future kind: try to advance by one LEB128 to recover.
      reader.readLeb128U32()
  }
}

/**
 * Skip instance type (simplified)
 */
function skipInstanceType(reader: BinaryReader): void {
  const kind = reader.readByte()
  if (kind === 0x00) {
    // Inline exports
    const count = reader.readLeb128U32()
    for (let i = 0; i < count; i++) {
      reader.readString() // export name
      skipExternType(reader)
    }
  } else {
    // Type index reference
    reader.readLeb128U32()
  }
}

/**
 * Skip extern type
 */
function skipExternType(reader: BinaryReader): void {
  const kind = reader.readByte()
  switch (kind) {
    case 0x00: // core module
    case 0x01: // func
    case 0x04: // component
      reader.readLeb128U32()
      break
    case 0x02: // value
      skipValueType(reader)
      break
    case 0x03: // type
      skipTypeBounds(reader)
      break
    case 0x05: // instance
      skipInstanceType(reader)
      break
  }
}

/**
 * Skip value type (simplified)
 */
function skipValueType(reader: BinaryReader): void {
  const byte = reader.readByte()
  // Most value types are single-byte primitive types
  // Complex types would need more parsing, but for import extraction
  // we just need to skip them
  if (byte >= 0x40) {
    // Single byte type
    return
  }
  // Type index
  reader.readLeb128U32()
}

/**
 * Skip type bounds
 */
function skipTypeBounds(reader: BinaryReader): void {
  const bound = reader.readByte()
  if (bound === 0x00 || bound === 0x01) {
    reader.readLeb128U32()
  }
}

/**
 * Check if two byte arrays are equal
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Quick check if bytes appear to be a component
 */
export function isComponent(bytes: ArrayBuffer | Uint8Array): boolean {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (data.length < 8) return false

  return (
    arraysEqual(data.subarray(0, 4), COMPONENT_MAGIC) &&
    arraysEqual(data.subarray(4, 8), COMPONENT_VERSION)
  )
}
