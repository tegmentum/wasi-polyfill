/**
 * WASI Preview 1 linear memory helpers
 *
 * Provides utilities for reading/writing to WebAssembly linear memory.
 * WASI P1 uses direct memory access via i32 pointers.
 *
 * @packageDocumentation
 */

import {
  IOVEC_SIZE,
  CIOVEC_SIZE,
  FILESTAT_SIZE,
  FDSTAT_SIZE,
  PRESTAT_SIZE,
  DIRENT_SIZE,
  EVENT_SIZE,
  type FileType,
  type FdFlags,
  type EventType,
  type EventRwFlags,
} from './types.js'

/**
 * Helper class for reading/writing to WebAssembly linear memory.
 */
export class WasiMemory {
  private memory: WebAssembly.Memory | null = null
  private view: DataView | null = null
  private bytes: Uint8Array | null = null

  /**
   * Attach to a WebAssembly memory instance.
   * Must be called after WebAssembly.instantiate and before WASI functions are used.
   */
  attach(memory: WebAssembly.Memory): void {
    this.memory = memory
    this.refresh()
  }

  /**
   * Refresh the view after memory growth.
   */
  private refresh(): void {
    if (!this.memory) {
      throw new Error('Memory not attached')
    }
    this.view = new DataView(this.memory.buffer)
    this.bytes = new Uint8Array(this.memory.buffer)
  }

  /**
   * Ensure views are up to date (call before any memory operation).
   */
  private ensureViews(): { view: DataView; bytes: Uint8Array } {
    if (!this.memory || !this.view || !this.bytes) {
      throw new Error('Memory not attached')
    }
    // Check if memory has grown
    if (this.view.buffer !== this.memory.buffer) {
      this.refresh()
    }
    return { view: this.view!, bytes: this.bytes! }
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Read an unsigned 8-bit integer.
   */
  readU8(ptr: number): number {
    const { view } = this.ensureViews()
    return view.getUint8(ptr)
  }

  /**
   * Read an unsigned 16-bit integer (little-endian).
   */
  readU16(ptr: number): number {
    const { view } = this.ensureViews()
    return view.getUint16(ptr, true)
  }

  /**
   * Read an unsigned 32-bit integer (little-endian).
   */
  readU32(ptr: number): number {
    const { view } = this.ensureViews()
    return view.getUint32(ptr, true)
  }

  /**
   * Read a signed 32-bit integer (little-endian).
   */
  readI32(ptr: number): number {
    const { view } = this.ensureViews()
    return view.getInt32(ptr, true)
  }

  /**
   * Read an unsigned 64-bit integer (little-endian).
   */
  readU64(ptr: number): bigint {
    const { view } = this.ensureViews()
    return view.getBigUint64(ptr, true)
  }

  /**
   * Read a signed 64-bit integer (little-endian).
   */
  readI64(ptr: number): bigint {
    const { view } = this.ensureViews()
    return view.getBigInt64(ptr, true)
  }

  /**
   * Read a byte array from memory.
   * Returns a copy of the data, not a view.
   */
  readBytes(ptr: number, len: number): Uint8Array {
    const { bytes } = this.ensureViews()
    return bytes.slice(ptr, ptr + len)
  }

  /**
   * Read a string from memory (UTF-8 encoded).
   */
  readString(ptr: number, len: number): string {
    const bytes = this.readBytes(ptr, len)
    return new TextDecoder().decode(bytes)
  }

  /**
   * Read an iovec array (for fd_read).
   * iovec: { buf: u32, buf_len: u32 }
   */
  readIovecs(ptr: number, count: number): Array<{ buf: number; len: number }> {
    const result: Array<{ buf: number; len: number }> = []
    for (let i = 0; i < count; i++) {
      const offset = ptr + i * IOVEC_SIZE
      result.push({
        buf: this.readU32(offset),
        len: this.readU32(offset + 4),
      })
    }
    return result
  }

  /**
   * Read a ciovec array (for fd_write).
   * ciovec: { buf: u32, buf_len: u32 }
   */
  readCiovecs(ptr: number, count: number): Array<{ buf: number; len: number }> {
    // Same structure as iovec
    return this.readIovecs(ptr, count)
  }

  // ===========================================================================
  // Write Operations
  // ===========================================================================

  /**
   * Write an unsigned 8-bit integer.
   */
  writeU8(ptr: number, value: number): void {
    const { view } = this.ensureViews()
    view.setUint8(ptr, value)
  }

  /**
   * Write an unsigned 16-bit integer (little-endian).
   */
  writeU16(ptr: number, value: number): void {
    const { view } = this.ensureViews()
    view.setUint16(ptr, value, true)
  }

  /**
   * Write an unsigned 32-bit integer (little-endian).
   */
  writeU32(ptr: number, value: number): void {
    const { view } = this.ensureViews()
    view.setUint32(ptr, value, true)
  }

  /**
   * Write a signed 32-bit integer (little-endian).
   */
  writeI32(ptr: number, value: number): void {
    const { view } = this.ensureViews()
    view.setInt32(ptr, value, true)
  }

  /**
   * Write an unsigned 64-bit integer (little-endian).
   */
  writeU64(ptr: number, value: bigint): void {
    const { view } = this.ensureViews()
    view.setBigUint64(ptr, value, true)
  }

  /**
   * Write a signed 64-bit integer (little-endian).
   */
  writeI64(ptr: number, value: bigint): void {
    const { view } = this.ensureViews()
    view.setBigInt64(ptr, value, true)
  }

  /**
   * Write a byte array to memory.
   */
  writeBytes(ptr: number, data: Uint8Array): void {
    const { bytes } = this.ensureViews()
    bytes.set(data, ptr)
  }

  /**
   * Write a string to memory (UTF-8 encoded, null-terminated).
   * Returns the number of bytes written (including null terminator).
   */
  writeString(ptr: number, str: string): number {
    const encoded = new TextEncoder().encode(str)
    this.writeBytes(ptr, encoded)
    this.writeU8(ptr + encoded.length, 0) // null terminator
    return encoded.length + 1
  }

  /**
   * Write a string to memory (UTF-8 encoded, no null terminator).
   * Returns the number of bytes written.
   */
  writeStringNoNull(ptr: number, str: string): number {
    const encoded = new TextEncoder().encode(str)
    this.writeBytes(ptr, encoded)
    return encoded.length
  }

  // ===========================================================================
  // Structure Writers
  // ===========================================================================

  /**
   * Write a filestat structure.
   *
   * Layout (64 bytes):
   * - dev: u64 (offset 0)
   * - ino: u64 (offset 8)
   * - filetype: u8 (offset 16)
   * - padding: 7 bytes (offset 17)
   * - nlink: u64 (offset 24)
   * - size: u64 (offset 32)
   * - atim: u64 (offset 40)
   * - mtim: u64 (offset 48)
   * - ctim: u64 (offset 56)
   */
  writeFilestat(
    ptr: number,
    stat: {
      dev: bigint
      ino: bigint
      filetype: FileType
      nlink: bigint
      size: bigint
      atim: bigint
      mtim: bigint
      ctim: bigint
    }
  ): void {
    this.writeU64(ptr + 0, stat.dev)
    this.writeU64(ptr + 8, stat.ino)
    this.writeU8(ptr + 16, stat.filetype)
    // padding bytes 17-23 should be zero
    for (let i = 17; i < 24; i++) {
      this.writeU8(ptr + i, 0)
    }
    this.writeU64(ptr + 24, stat.nlink)
    this.writeU64(ptr + 32, stat.size)
    this.writeU64(ptr + 40, stat.atim)
    this.writeU64(ptr + 48, stat.mtim)
    this.writeU64(ptr + 56, stat.ctim)
  }

  /**
   * Write an fdstat structure.
   *
   * Layout (24 bytes):
   * - fs_filetype: u8 (offset 0)
   * - fs_flags: u16 (offset 2)
   * - padding: 4 bytes (offset 4)
   * - fs_rights_base: u64 (offset 8)
   * - fs_rights_inheriting: u64 (offset 16)
   */
  writeFdstat(
    ptr: number,
    stat: {
      filetype: FileType
      flags: FdFlags
      rightsBase: bigint
      rightsInheriting: bigint
    }
  ): void {
    this.writeU8(ptr + 0, stat.filetype)
    this.writeU8(ptr + 1, 0) // padding
    this.writeU16(ptr + 2, stat.flags)
    this.writeU32(ptr + 4, 0) // padding
    this.writeU64(ptr + 8, stat.rightsBase)
    this.writeU64(ptr + 16, stat.rightsInheriting)
  }

  /**
   * Write a prestat structure.
   *
   * Layout (8 bytes):
   * - tag: u8 (offset 0) - PrestatType
   * - padding: 3 bytes (offset 1)
   * - pr_name_len: u32 (offset 4) - only for DIR type
   */
  writePrestat(ptr: number, nameLen: number): void {
    this.writeU8(ptr + 0, 0) // PrestatType.DIR
    this.writeU8(ptr + 1, 0) // padding
    this.writeU8(ptr + 2, 0) // padding
    this.writeU8(ptr + 3, 0) // padding
    this.writeU32(ptr + 4, nameLen)
  }

  /**
   * Write a dirent structure.
   *
   * Layout (24 bytes, followed by name):
   * - d_next: u64 (offset 0) - offset of next dirent
   * - d_ino: u64 (offset 8) - inode number
   * - d_namlen: u32 (offset 16) - length of name
   * - d_type: u8 (offset 20) - file type
   * - padding: 3 bytes (offset 21)
   * - name follows...
   */
  writeDirent(
    ptr: number,
    dirent: {
      next: bigint
      ino: bigint
      namelen: number
      type: FileType
    }
  ): void {
    this.writeU64(ptr + 0, dirent.next)
    this.writeU64(ptr + 8, dirent.ino)
    this.writeU32(ptr + 16, dirent.namelen)
    this.writeU8(ptr + 20, dirent.type)
    this.writeU8(ptr + 21, 0) // padding
    this.writeU8(ptr + 22, 0) // padding
    this.writeU8(ptr + 23, 0) // padding
  }

  /**
   * Write an event structure.
   *
   * Layout (32 bytes):
   * - userdata: u64 (offset 0)
   * - error: u16 (offset 8) - errno
   * - type: u8 (offset 10) - EventType
   * - padding: 5 bytes (offset 11)
   * - fd_readwrite union (offset 16):
   *   - nbytes: u64 (offset 16)
   *   - flags: u16 (offset 24) - EventRwFlags
   *   - padding: 6 bytes (offset 26)
   */
  writeEvent(
    ptr: number,
    event: {
      userdata: bigint
      error: number
      type: EventType
      nbytes?: bigint
      flags?: EventRwFlags
    }
  ): void {
    this.writeU64(ptr + 0, event.userdata)
    this.writeU16(ptr + 8, event.error)
    this.writeU8(ptr + 10, event.type)
    // padding bytes 11-15
    for (let i = 11; i < 16; i++) {
      this.writeU8(ptr + i, 0)
    }
    this.writeU64(ptr + 16, event.nbytes ?? 0n)
    this.writeU16(ptr + 24, event.flags ?? 0)
    // padding bytes 26-31
    for (let i = 26; i < 32; i++) {
      this.writeU8(ptr + i, 0)
    }
  }

  // ===========================================================================
  // Structure Readers
  // ===========================================================================

  /**
   * Read a subscription structure.
   *
   * Layout (48 bytes):
   * - userdata: u64 (offset 0)
   * - u: union (offset 8):
   *   - tag: u8 (offset 8) - EventType
   *   - padding (offset 9-15)
   *   - For CLOCK (tag=0):
   *     - id: u32 (offset 16) - ClockId
   *     - padding: 4 bytes (offset 20)
   *     - timeout: u64 (offset 24)
   *     - precision: u64 (offset 32)
   *     - flags: u16 (offset 40) - SubclockFlags
   *   - For FD_READ/FD_WRITE (tag=1,2):
   *     - file_descriptor: u32 (offset 16)
   */
  readSubscription(ptr: number): {
    userdata: bigint
    type: EventType
    // Clock fields
    clockId?: number
    timeout?: bigint
    precision?: bigint
    clockFlags?: number
    // FD fields
    fd?: number
  } {
    const userdata = this.readU64(ptr + 0)
    const type = this.readU8(ptr + 8) as EventType

    if (type === 0) {
      // CLOCK
      return {
        userdata,
        type,
        clockId: this.readU32(ptr + 16),
        timeout: this.readU64(ptr + 24),
        precision: this.readU64(ptr + 32),
        clockFlags: this.readU16(ptr + 40),
      }
    } else {
      // FD_READ or FD_WRITE
      return {
        userdata,
        type,
        fd: this.readU32(ptr + 16),
      }
    }
  }
}

// Export structure sizes for use elsewhere
export { IOVEC_SIZE, CIOVEC_SIZE, FILESTAT_SIZE, FDSTAT_SIZE, PRESTAT_SIZE, DIRENT_SIZE, EVENT_SIZE }
