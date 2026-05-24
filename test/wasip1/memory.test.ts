import { describe, it, expect, beforeEach } from 'vitest'
import {
  WasiMemory,
  WasiMemoryError,
  IOVEC_SIZE,
  CIOVEC_SIZE,
  FILESTAT_SIZE,
  FDSTAT_SIZE,
  PRESTAT_SIZE,
  DIRENT_SIZE,
  EVENT_SIZE,
} from '../../src/wasip1/memory.js'
import { FileType, EventType } from '../../src/wasip1/types.js'

describe('WASIP1 WasiMemory', () => {
  let wasiMemory: WasiMemory
  let memory: WebAssembly.Memory

  beforeEach(() => {
    wasiMemory = new WasiMemory()
    memory = new WebAssembly.Memory({ initial: 1 }) // 64KB
    wasiMemory.attach(memory)
  })

  describe('attach', () => {
    it('attaches to a WebAssembly memory instance', () => {
      const wm = new WasiMemory()
      const mem = new WebAssembly.Memory({ initial: 1 })
      wm.attach(mem)
      // Should not throw when reading/writing
      expect(() => wm.readU8(0)).not.toThrow()
    })

    it('throws when not attached', () => {
      const wm = new WasiMemory()
      expect(() => wm.readU8(0)).toThrow('Memory not attached')
    })
  })

  describe('bounds checking (EFAULT)', () => {
    // 1 page = 65536 bytes; valid offsets are [0, 65535].
    const SIZE = 65536

    it('throws WasiMemoryError for an out-of-range read', () => {
      expect(() => wasiMemory.readU8(SIZE)).toThrow(WasiMemoryError)
      expect(() => wasiMemory.readU32(SIZE - 2)).toThrow(WasiMemoryError)
      expect(() => wasiMemory.readBytes(SIZE - 4, 8)).toThrow(WasiMemoryError)
    })

    it('throws WasiMemoryError for an out-of-range write', () => {
      expect(() => wasiMemory.writeU8(SIZE, 1)).toThrow(WasiMemoryError)
      expect(() => wasiMemory.writeBytes(SIZE - 1, new Uint8Array([1, 2, 3]))).toThrow(
        WasiMemoryError
      )
    })

    it('rejects negative and non-integer pointers', () => {
      expect(() => wasiMemory.readU8(-1)).toThrow(WasiMemoryError)
      expect(() => wasiMemory.readU8(1.5)).toThrow(WasiMemoryError)
    })

    it('carries EFAULT (21) as its errno', () => {
      try {
        wasiMemory.readU8(SIZE)
        throw new Error('expected WasiMemoryError')
      } catch (err) {
        expect(err).toBeInstanceOf(WasiMemoryError)
        expect((err as WasiMemoryError).errno).toBe(21)
      }
    })

    it('still allows in-range accesses at the boundary', () => {
      expect(() => wasiMemory.writeU8(SIZE - 1, 7)).not.toThrow()
      expect(wasiMemory.readU8(SIZE - 1)).toBe(7)
      expect(() => wasiMemory.readU32(SIZE - 4)).not.toThrow()
    })
  })

  describe('read operations', () => {
    describe('readU8', () => {
      it('reads an unsigned 8-bit integer', () => {
        const view = new DataView(memory.buffer)
        view.setUint8(100, 255)
        expect(wasiMemory.readU8(100)).toBe(255)
      })

      it('reads zero correctly', () => {
        const view = new DataView(memory.buffer)
        view.setUint8(100, 0)
        expect(wasiMemory.readU8(100)).toBe(0)
      })
    })

    describe('readU16', () => {
      it('reads an unsigned 16-bit integer (little-endian)', () => {
        const view = new DataView(memory.buffer)
        view.setUint16(100, 0xabcd, true) // little-endian
        expect(wasiMemory.readU16(100)).toBe(0xabcd)
      })

      it('reads maximum value correctly', () => {
        const view = new DataView(memory.buffer)
        view.setUint16(100, 65535, true)
        expect(wasiMemory.readU16(100)).toBe(65535)
      })
    })

    describe('readU32', () => {
      it('reads an unsigned 32-bit integer (little-endian)', () => {
        const view = new DataView(memory.buffer)
        view.setUint32(100, 0xdeadbeef, true)
        expect(wasiMemory.readU32(100)).toBe(0xdeadbeef)
      })

      it('reads maximum value correctly', () => {
        const view = new DataView(memory.buffer)
        view.setUint32(100, 4294967295, true)
        expect(wasiMemory.readU32(100)).toBe(4294967295)
      })
    })

    describe('readI32', () => {
      it('reads a signed 32-bit integer (little-endian)', () => {
        const view = new DataView(memory.buffer)
        view.setInt32(100, -12345, true)
        expect(wasiMemory.readI32(100)).toBe(-12345)
      })

      it('reads positive values correctly', () => {
        const view = new DataView(memory.buffer)
        view.setInt32(100, 2147483647, true)
        expect(wasiMemory.readI32(100)).toBe(2147483647)
      })

      it('reads negative values correctly', () => {
        const view = new DataView(memory.buffer)
        view.setInt32(100, -2147483648, true)
        expect(wasiMemory.readI32(100)).toBe(-2147483648)
      })
    })

    describe('readU64', () => {
      it('reads an unsigned 64-bit integer (little-endian)', () => {
        const view = new DataView(memory.buffer)
        view.setBigUint64(100, 0xdeadbeefcafebabn, true)
        expect(wasiMemory.readU64(100)).toBe(0xdeadbeefcafebabn)
      })

      it('reads maximum value correctly', () => {
        const view = new DataView(memory.buffer)
        view.setBigUint64(100, 18446744073709551615n, true)
        expect(wasiMemory.readU64(100)).toBe(18446744073709551615n)
      })
    })

    describe('readI64', () => {
      it('reads a signed 64-bit integer (little-endian)', () => {
        const view = new DataView(memory.buffer)
        view.setBigInt64(100, -9223372036854775808n, true)
        expect(wasiMemory.readI64(100)).toBe(-9223372036854775808n)
      })

      it('reads positive values correctly', () => {
        const view = new DataView(memory.buffer)
        view.setBigInt64(100, 9223372036854775807n, true)
        expect(wasiMemory.readI64(100)).toBe(9223372036854775807n)
      })
    })

    describe('readBytes', () => {
      it('reads a byte array from memory', () => {
        const bytes = new Uint8Array(memory.buffer)
        bytes.set([1, 2, 3, 4, 5], 100)
        const result = wasiMemory.readBytes(100, 5)
        expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
      })

      it('returns a copy, not a view', () => {
        const bytes = new Uint8Array(memory.buffer)
        bytes.set([1, 2, 3], 100)
        const result = wasiMemory.readBytes(100, 3)
        bytes[100] = 99
        expect(result[0]).toBe(1) // Original value preserved
      })

      it('reads empty array', () => {
        const result = wasiMemory.readBytes(100, 0)
        expect(result).toEqual(new Uint8Array([]))
      })
    })

    describe('readString', () => {
      it('reads a UTF-8 encoded string', () => {
        const bytes = new Uint8Array(memory.buffer)
        const encoded = new TextEncoder().encode('Hello, World!')
        bytes.set(encoded, 100)
        expect(wasiMemory.readString(100, encoded.length)).toBe('Hello, World!')
      })

      it('reads empty string', () => {
        expect(wasiMemory.readString(100, 0)).toBe('')
      })

      it('reads unicode characters correctly', () => {
        const bytes = new Uint8Array(memory.buffer)
        const encoded = new TextEncoder().encode('Hello \u{1F600}')
        bytes.set(encoded, 100)
        expect(wasiMemory.readString(100, encoded.length)).toBe('Hello \u{1F600}')
      })
    })

    describe('readIovecs', () => {
      it('reads an iovec array', () => {
        const view = new DataView(memory.buffer)
        // First iovec: buf=1000, len=100
        view.setUint32(200, 1000, true)
        view.setUint32(204, 100, true)
        // Second iovec: buf=2000, len=200
        view.setUint32(208, 2000, true)
        view.setUint32(212, 200, true)

        const iovecs = wasiMemory.readIovecs(200, 2)
        expect(iovecs).toEqual([
          { buf: 1000, len: 100 },
          { buf: 2000, len: 200 },
        ])
      })

      it('reads single iovec', () => {
        const view = new DataView(memory.buffer)
        view.setUint32(200, 500, true)
        view.setUint32(204, 50, true)

        const iovecs = wasiMemory.readIovecs(200, 1)
        expect(iovecs).toEqual([{ buf: 500, len: 50 }])
      })

      it('reads empty array', () => {
        const iovecs = wasiMemory.readIovecs(200, 0)
        expect(iovecs).toEqual([])
      })
    })

    describe('readCiovecs', () => {
      it('reads a ciovec array (same as iovec)', () => {
        const view = new DataView(memory.buffer)
        view.setUint32(200, 1000, true)
        view.setUint32(204, 100, true)

        const ciovecs = wasiMemory.readCiovecs(200, 1)
        expect(ciovecs).toEqual([{ buf: 1000, len: 100 }])
      })
    })
  })

  describe('write operations', () => {
    describe('writeU8', () => {
      it('writes an unsigned 8-bit integer', () => {
        wasiMemory.writeU8(100, 255)
        const view = new DataView(memory.buffer)
        expect(view.getUint8(100)).toBe(255)
      })

      it('writes zero correctly', () => {
        wasiMemory.writeU8(100, 0)
        const view = new DataView(memory.buffer)
        expect(view.getUint8(100)).toBe(0)
      })
    })

    describe('writeU16', () => {
      it('writes an unsigned 16-bit integer (little-endian)', () => {
        wasiMemory.writeU16(100, 0xabcd)
        const view = new DataView(memory.buffer)
        expect(view.getUint16(100, true)).toBe(0xabcd)
      })
    })

    describe('writeU32', () => {
      it('writes an unsigned 32-bit integer (little-endian)', () => {
        wasiMemory.writeU32(100, 0xdeadbeef)
        const view = new DataView(memory.buffer)
        expect(view.getUint32(100, true)).toBe(0xdeadbeef)
      })
    })

    describe('writeI32', () => {
      it('writes a signed 32-bit integer (little-endian)', () => {
        wasiMemory.writeI32(100, -12345)
        const view = new DataView(memory.buffer)
        expect(view.getInt32(100, true)).toBe(-12345)
      })
    })

    describe('writeU64', () => {
      it('writes an unsigned 64-bit integer (little-endian)', () => {
        wasiMemory.writeU64(100, 0xdeadbeefcafebabn)
        const view = new DataView(memory.buffer)
        expect(view.getBigUint64(100, true)).toBe(0xdeadbeefcafebabn)
      })
    })

    describe('writeI64', () => {
      it('writes a signed 64-bit integer (little-endian)', () => {
        wasiMemory.writeI64(100, -9223372036854775808n)
        const view = new DataView(memory.buffer)
        expect(view.getBigInt64(100, true)).toBe(-9223372036854775808n)
      })
    })

    describe('writeBytes', () => {
      it('writes a byte array to memory', () => {
        wasiMemory.writeBytes(100, new Uint8Array([1, 2, 3, 4, 5]))
        const bytes = new Uint8Array(memory.buffer)
        expect(bytes.slice(100, 105)).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
      })

      it('writes empty array', () => {
        wasiMemory.writeBytes(100, new Uint8Array([]))
        // Should not throw
      })
    })

    describe('writeString', () => {
      it('writes a UTF-8 encoded string with null terminator', () => {
        const written = wasiMemory.writeString(100, 'Hello')
        expect(written).toBe(6) // 5 chars + null terminator

        const bytes = new Uint8Array(memory.buffer)
        const expected = new TextEncoder().encode('Hello')
        expect(bytes.slice(100, 105)).toEqual(expected)
        expect(bytes[105]).toBe(0) // null terminator
      })

      it('writes empty string', () => {
        const written = wasiMemory.writeString(100, '')
        expect(written).toBe(1) // Just null terminator

        const bytes = new Uint8Array(memory.buffer)
        expect(bytes[100]).toBe(0)
      })
    })

    describe('writeStringNoNull', () => {
      it('writes a UTF-8 encoded string without null terminator', () => {
        const written = wasiMemory.writeStringNoNull(100, 'Hello')
        expect(written).toBe(5)

        const bytes = new Uint8Array(memory.buffer)
        const expected = new TextEncoder().encode('Hello')
        expect(bytes.slice(100, 105)).toEqual(expected)
      })
    })
  })

  describe('structure writers', () => {
    describe('writeFilestat', () => {
      it('writes a filestat structure correctly', () => {
        wasiMemory.writeFilestat(100, {
          dev: 1n,
          ino: 2n,
          filetype: FileType.REGULAR_FILE,
          nlink: 3n,
          size: 4096n,
          atim: 1000000000n,
          mtim: 2000000000n,
          ctim: 3000000000n,
        })

        const view = new DataView(memory.buffer)
        expect(view.getBigUint64(100, true)).toBe(1n) // dev
        expect(view.getBigUint64(108, true)).toBe(2n) // ino
        expect(view.getUint8(116)).toBe(FileType.REGULAR_FILE) // filetype
        expect(view.getBigUint64(124, true)).toBe(3n) // nlink
        expect(view.getBigUint64(132, true)).toBe(4096n) // size
        expect(view.getBigUint64(140, true)).toBe(1000000000n) // atim
        expect(view.getBigUint64(148, true)).toBe(2000000000n) // mtim
        expect(view.getBigUint64(156, true)).toBe(3000000000n) // ctim
      })

      it('clears padding bytes', () => {
        // Fill with non-zero
        const bytes = new Uint8Array(memory.buffer)
        bytes.fill(255, 117, 124)

        wasiMemory.writeFilestat(100, {
          dev: 0n,
          ino: 0n,
          filetype: 0,
          nlink: 0n,
          size: 0n,
          atim: 0n,
          mtim: 0n,
          ctim: 0n,
        })

        // Padding bytes 117-123 should be zero
        for (let i = 117; i < 124; i++) {
          expect(bytes[i]).toBe(0)
        }
      })
    })

    describe('writeFdstat', () => {
      it('writes an fdstat structure correctly', () => {
        wasiMemory.writeFdstat(100, {
          filetype: FileType.DIRECTORY,
          flags: 0x05, // APPEND | NONBLOCK
          rightsBase: 0x1fffn,
          rightsInheriting: 0xffffn,
        })

        const view = new DataView(memory.buffer)
        expect(view.getUint8(100)).toBe(FileType.DIRECTORY) // filetype
        expect(view.getUint8(101)).toBe(0) // padding
        expect(view.getUint16(102, true)).toBe(0x05) // flags
        expect(view.getUint32(104, true)).toBe(0) // padding
        expect(view.getBigUint64(108, true)).toBe(0x1fffn) // rightsBase
        expect(view.getBigUint64(116, true)).toBe(0xffffn) // rightsInheriting
      })
    })

    describe('writePrestat', () => {
      it('writes a prestat structure correctly', () => {
        wasiMemory.writePrestat(100, 10)

        const view = new DataView(memory.buffer)
        expect(view.getUint8(100)).toBe(0) // PrestatType.DIR
        expect(view.getUint8(101)).toBe(0) // padding
        expect(view.getUint8(102)).toBe(0) // padding
        expect(view.getUint8(103)).toBe(0) // padding
        expect(view.getUint32(104, true)).toBe(10) // nameLen
      })
    })

    describe('writeDirent', () => {
      it('writes a dirent structure correctly', () => {
        wasiMemory.writeDirent(100, {
          next: 5n,
          ino: 123n,
          namelen: 8,
          type: FileType.REGULAR_FILE,
        })

        const view = new DataView(memory.buffer)
        expect(view.getBigUint64(100, true)).toBe(5n) // next
        expect(view.getBigUint64(108, true)).toBe(123n) // ino
        expect(view.getUint32(116, true)).toBe(8) // namelen
        expect(view.getUint8(120)).toBe(FileType.REGULAR_FILE) // type
        expect(view.getUint8(121)).toBe(0) // padding
        expect(view.getUint8(122)).toBe(0) // padding
        expect(view.getUint8(123)).toBe(0) // padding
      })
    })

    describe('writeEvent', () => {
      it('writes an event structure correctly', () => {
        wasiMemory.writeEvent(100, {
          userdata: 12345n,
          error: 0,
          type: EventType.FD_READ,
          nbytes: 1024n,
          flags: 1,
        })

        const view = new DataView(memory.buffer)
        expect(view.getBigUint64(100, true)).toBe(12345n) // userdata
        expect(view.getUint16(108, true)).toBe(0) // error
        expect(view.getUint8(110)).toBe(EventType.FD_READ) // type
        expect(view.getBigUint64(116, true)).toBe(1024n) // nbytes
        expect(view.getUint16(124, true)).toBe(1) // flags
      })

      it('writes event without optional fields', () => {
        wasiMemory.writeEvent(100, {
          userdata: 1n,
          error: 0,
          type: EventType.CLOCK,
        })

        const view = new DataView(memory.buffer)
        expect(view.getBigUint64(100, true)).toBe(1n)
        expect(view.getBigUint64(116, true)).toBe(0n) // nbytes defaults to 0
        expect(view.getUint16(124, true)).toBe(0) // flags defaults to 0
      })
    })
  })

  describe('structure reader', () => {
    describe('readSubscription', () => {
      it('reads a clock subscription', () => {
        const view = new DataView(memory.buffer)
        view.setBigUint64(100, 12345n, true) // userdata
        view.setUint8(108, 0) // type = CLOCK
        view.setUint32(116, 1, true) // clockId = MONOTONIC
        view.setBigUint64(124, 5000000000n, true) // timeout
        view.setBigUint64(132, 1000000n, true) // precision
        view.setUint16(140, 1, true) // clockFlags

        const sub = wasiMemory.readSubscription(100)
        expect(sub.userdata).toBe(12345n)
        expect(sub.type).toBe(0) // CLOCK
        expect(sub.clockId).toBe(1)
        expect(sub.timeout).toBe(5000000000n)
        expect(sub.precision).toBe(1000000n)
        expect(sub.clockFlags).toBe(1)
        expect(sub.fd).toBeUndefined()
      })

      it('reads a fd_read subscription', () => {
        const view = new DataView(memory.buffer)
        view.setBigUint64(100, 67890n, true) // userdata
        view.setUint8(108, 1) // type = FD_READ
        view.setUint32(116, 5, true) // fd

        const sub = wasiMemory.readSubscription(100)
        expect(sub.userdata).toBe(67890n)
        expect(sub.type).toBe(1) // FD_READ
        expect(sub.fd).toBe(5)
        expect(sub.clockId).toBeUndefined()
      })

      it('reads a fd_write subscription', () => {
        const view = new DataView(memory.buffer)
        view.setBigUint64(100, 11111n, true) // userdata
        view.setUint8(108, 2) // type = FD_WRITE
        view.setUint32(116, 7, true) // fd

        const sub = wasiMemory.readSubscription(100)
        expect(sub.userdata).toBe(11111n)
        expect(sub.type).toBe(2) // FD_WRITE
        expect(sub.fd).toBe(7)
      })
    })
  })

  describe('memory growth', () => {
    it('handles memory growth by refreshing views', () => {
      wasiMemory.writeU32(100, 12345)
      expect(wasiMemory.readU32(100)).toBe(12345)

      // Grow memory
      memory.grow(1)

      // Should still work after growth
      wasiMemory.writeU32(200, 67890)
      expect(wasiMemory.readU32(200)).toBe(67890)

      // Old data should still be readable
      expect(wasiMemory.readU32(100)).toBe(12345)
    })

    it('detects buffer change after growth', () => {
      const initialBuffer = memory.buffer
      memory.grow(1)

      // Buffer should be different
      expect(memory.buffer).not.toBe(initialBuffer)

      // But operations should still work
      wasiMemory.writeU32(100, 42)
      expect(wasiMemory.readU32(100)).toBe(42)
    })
  })

  describe('structure sizes', () => {
    it('exports correct iovec size', () => {
      expect(IOVEC_SIZE).toBe(8)
    })

    it('exports correct ciovec size', () => {
      expect(CIOVEC_SIZE).toBe(8)
    })

    it('exports correct filestat size', () => {
      expect(FILESTAT_SIZE).toBe(64)
    })

    it('exports correct fdstat size', () => {
      expect(FDSTAT_SIZE).toBe(24)
    })

    it('exports correct prestat size', () => {
      expect(PRESTAT_SIZE).toBe(8)
    })

    it('exports correct dirent size', () => {
      expect(DIRENT_SIZE).toBe(24)
    })

    it('exports correct event size', () => {
      expect(EVENT_SIZE).toBe(32)
    })
  })

  describe('round-trip operations', () => {
    it('reads back what was written - u8', () => {
      for (const val of [0, 127, 255]) {
        wasiMemory.writeU8(100, val)
        expect(wasiMemory.readU8(100)).toBe(val)
      }
    })

    it('reads back what was written - u16', () => {
      for (const val of [0, 32767, 65535]) {
        wasiMemory.writeU16(100, val)
        expect(wasiMemory.readU16(100)).toBe(val)
      }
    })

    it('reads back what was written - u32', () => {
      for (const val of [0, 2147483647, 4294967295]) {
        wasiMemory.writeU32(100, val)
        expect(wasiMemory.readU32(100)).toBe(val)
      }
    })

    it('reads back what was written - i32', () => {
      for (const val of [-2147483648, 0, 2147483647]) {
        wasiMemory.writeI32(100, val)
        expect(wasiMemory.readI32(100)).toBe(val)
      }
    })

    it('reads back what was written - u64', () => {
      for (const val of [0n, 9223372036854775807n, 18446744073709551615n]) {
        wasiMemory.writeU64(100, val)
        expect(wasiMemory.readU64(100)).toBe(val)
      }
    })

    it('reads back what was written - i64', () => {
      for (const val of [-9223372036854775808n, 0n, 9223372036854775807n]) {
        wasiMemory.writeI64(100, val)
        expect(wasiMemory.readI64(100)).toBe(val)
      }
    })

    it('reads back what was written - bytes', () => {
      const data = new Uint8Array([0, 1, 127, 128, 255])
      wasiMemory.writeBytes(100, data)
      expect(wasiMemory.readBytes(100, 5)).toEqual(data)
    })

    it('reads back what was written - string', () => {
      const testStrings = ['', 'a', 'Hello, World!', '\u{1F600}', 'mixed \u00e9 chars']
      for (const str of testStrings) {
        const encoded = new TextEncoder().encode(str)
        wasiMemory.writeStringNoNull(100, str)
        expect(wasiMemory.readString(100, encoded.length)).toBe(str)
      }
    })
  })
})
