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

// Section IDs for components
const SECTION_IMPORT = 2

// Import kinds in component model
const IMPORT_KIND_MODULE = 0x00
const IMPORT_KIND_FUNC = 0x01
const IMPORT_KIND_VALUE = 0x02
const IMPORT_KIND_TYPE = 0x03
const IMPORT_KIND_COMPONENT = 0x04
const IMPORT_KIND_INSTANCE = 0x05

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
        const importName = reader.readString()
        const externKind = reader.readByte()

        // Skip the extern description (we just need the name)
        skipExternDesc(reader, externKind)

        const kind = importKindFromByte(externKind)
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
 * Convert import kind byte to enum
 */
function importKindFromByte(byte: number): ImportKind {
  switch (byte) {
    case IMPORT_KIND_MODULE:
      return 'module'
    case IMPORT_KIND_FUNC:
      return 'func'
    case IMPORT_KIND_VALUE:
      return 'value'
    case IMPORT_KIND_TYPE:
      return 'type'
    case IMPORT_KIND_COMPONENT:
      return 'component'
    case IMPORT_KIND_INSTANCE:
      return 'instance'
    default:
      return 'instance' // Default assumption
  }
}

/**
 * Skip extern description based on kind
 * This is a simplified skip - full parsing would require more context
 */
function skipExternDesc(reader: BinaryReader, kind: number): void {
  switch (kind) {
    case IMPORT_KIND_MODULE:
    case IMPORT_KIND_COMPONENT:
      // These have a type index (LEB128)
      reader.readLeb128U32()
      break

    case IMPORT_KIND_INSTANCE:
      // Instance has an inline instance type
      skipInstanceType(reader)
      break

    case IMPORT_KIND_FUNC:
      // Function has a type index
      reader.readLeb128U32()
      break

    case IMPORT_KIND_VALUE:
      // Value has a value type
      skipValueType(reader)
      break

    case IMPORT_KIND_TYPE:
      // Type has a type bounds
      skipTypeBounds(reader)
      break

    default:
      // Unknown, try to skip as LEB128
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
