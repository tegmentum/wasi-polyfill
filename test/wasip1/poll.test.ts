/**
 * WASI Preview 1 Poll Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPollFunctions } from '../../src/wasip1/poll.js'
import { WasiMemory } from '../../src/wasip1/memory.js'
import {
  FileDescriptorTable,
  createStdinEntry,
  createStdoutEntry,
  createStderrEntry,
} from '../../src/wasip1/fd-table.js'
import {
  Errno,
  EventType,
  ClockId,
  SubclockFlags,
  SUBSCRIPTION_SIZE,
  EVENT_SIZE,
} from '../../src/wasip1/types.js'

describe('WASIP1 Poll', () => {
  let memory: WasiMemory
  let wasmMemory: WebAssembly.Memory
  let fdTable: FileDescriptorTable

  beforeEach(() => {
    wasmMemory = new WebAssembly.Memory({ initial: 1 })
    memory = new WasiMemory()
    memory.attach(wasmMemory)
    fdTable = new FileDescriptorTable()

    // Initialize stdio
    fdTable.initStdio(createStdinEntry(), createStdoutEntry(), createStderrEntry())
  })

  /**
   * Helper to write a clock subscription to memory
   */
  function writeClockSubscription(
    ptr: number,
    userdata: bigint,
    clockId: number,
    timeout: bigint,
    flags: number
  ): void {
    // userdata: u64 at offset 0
    memory.writeU64(ptr, userdata)
    // tag: u8 at offset 8 (EventType.CLOCK = 0)
    memory.writeU8(ptr + 8, EventType.CLOCK)
    // clock_id: u32 at offset 16 (union starts at 16)
    memory.writeU32(ptr + 16, clockId)
    // timeout: u64 at offset 24
    memory.writeU64(ptr + 24, timeout)
    // precision: u64 at offset 32
    memory.writeU64(ptr + 32, 0n)
    // flags: u16 at offset 40
    memory.writeU16(ptr + 40, flags)
  }

  /**
   * Helper to write an FD read subscription to memory
   */
  function writeFdReadSubscription(ptr: number, userdata: bigint, fd: number): void {
    // userdata: u64 at offset 0
    memory.writeU64(ptr, userdata)
    // tag: u8 at offset 8 (EventType.FD_READ = 1)
    memory.writeU8(ptr + 8, EventType.FD_READ)
    // fd: u32 at offset 16 (union starts at 16)
    memory.writeU32(ptr + 16, fd)
  }

  /**
   * Helper to write an FD write subscription to memory
   */
  function writeFdWriteSubscription(ptr: number, userdata: bigint, fd: number): void {
    // userdata: u64 at offset 0
    memory.writeU64(ptr, userdata)
    // tag: u8 at offset 8 (EventType.FD_WRITE = 2)
    memory.writeU8(ptr + 8, EventType.FD_WRITE)
    // fd: u32 at offset 16 (union starts at 16)
    memory.writeU32(ptr + 16, fd)
  }

  /**
   * Helper to read an event from memory
   */
  function readEvent(ptr: number): { userdata: bigint; error: number; type: number } {
    return {
      userdata: memory.readU64(ptr),
      error: memory.readU16(ptr + 8),
      type: memory.readU8(ptr + 10),
    }
  }

  describe('poll_oneoff', () => {
    it('returns SUCCESS with zero subscriptions', () => {
      const fns = createPollFunctions(memory, fdTable)

      const result = fns.poll_oneoff(0, 100, 0, 200)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(200)).toBe(0) // nevents = 0
    })

    it('handles clock subscription with past deadline', () => {
      const fns = createPollFunctions(memory, fdTable)

      // Create subscription with 0 timeout (already expired)
      writeClockSubscription(0, 123n, ClockId.MONOTONIC, 0n, 0)

      const result = fns.poll_oneoff(0, 100, 1, 200)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(200)).toBe(1) // 1 event

      const event = readEvent(100)
      expect(event.userdata).toBe(123n)
      expect(event.error).toBe(Errno.SUCCESS)
      expect(event.type).toBe(EventType.CLOCK)
    })

    it('handles FD read subscription for stdin', () => {
      const fns = createPollFunctions(memory, fdTable)

      writeFdReadSubscription(0, 456n, 0) // fd 0 = stdin

      const result = fns.poll_oneoff(0, 100, 1, 200)

      expect(result).toBe(Errno.SUCCESS)
      // Stdin is always considered ready in this implementation
      expect(memory.readU32(200)).toBe(1)

      const event = readEvent(100)
      expect(event.userdata).toBe(456n)
      expect(event.error).toBe(Errno.SUCCESS)
      expect(event.type).toBe(EventType.FD_READ)
    })

    it('handles FD write subscription for stdout', () => {
      const fns = createPollFunctions(memory, fdTable)

      writeFdWriteSubscription(0, 789n, 1) // fd 1 = stdout

      const result = fns.poll_oneoff(0, 100, 1, 200)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(200)).toBe(1)

      const event = readEvent(100)
      expect(event.userdata).toBe(789n)
      expect(event.error).toBe(Errno.SUCCESS)
      expect(event.type).toBe(EventType.FD_WRITE)
    })

    it('handles FD write subscription for stderr', () => {
      const fns = createPollFunctions(memory, fdTable)

      writeFdWriteSubscription(0, 999n, 2) // fd 2 = stderr

      const result = fns.poll_oneoff(0, 100, 1, 200)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(200)).toBe(1)

      const event = readEvent(100)
      expect(event.userdata).toBe(999n)
      expect(event.type).toBe(EventType.FD_WRITE)
    })

    it('returns EBADF for invalid fd', () => {
      const fns = createPollFunctions(memory, fdTable)

      writeFdReadSubscription(0, 1n, 999) // Invalid fd

      const result = fns.poll_oneoff(0, 100, 1, 200)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(200)).toBe(1)

      const event = readEvent(100)
      expect(event.error).toBe(Errno.EBADF)
    })

    it('handles multiple subscriptions', () => {
      const fns = createPollFunctions(memory, fdTable)

      // Write 3 subscriptions
      writeClockSubscription(0, 1n, ClockId.MONOTONIC, 0n, 0) // Expired clock
      writeFdReadSubscription(SUBSCRIPTION_SIZE, 2n, 0) // stdin read
      writeFdWriteSubscription(SUBSCRIPTION_SIZE * 2, 3n, 1) // stdout write

      const result = fns.poll_oneoff(0, 1000, 3, 2000)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(2000)).toBe(3) // 3 events
    })

    it('preserves userdata in events', () => {
      const fns = createPollFunctions(memory, fdTable)

      const userdata = 0x123456789ABCDEFn
      writeClockSubscription(0, userdata, ClockId.MONOTONIC, 0n, 0)

      fns.poll_oneoff(0, 100, 1, 200)

      const event = readEvent(100)
      expect(event.userdata).toBe(userdata)
    })

    it('handles realtime clock', () => {
      const fns = createPollFunctions(memory, fdTable)

      // Past deadline in realtime
      writeClockSubscription(0, 1n, ClockId.REALTIME, 0n, SubclockFlags.SUBSCRIPTION_CLOCK_ABSTIME)

      const result = fns.poll_oneoff(0, 100, 1, 200)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(200)).toBe(1)
    })

    it('handles clock subscription with absolute time', () => {
      const fns = createPollFunctions(memory, fdTable)

      // Absolute time in the past (0 nanoseconds since epoch)
      writeClockSubscription(0, 1n, ClockId.REALTIME, 0n, SubclockFlags.SUBSCRIPTION_CLOCK_ABSTIME)

      const result = fns.poll_oneoff(0, 100, 1, 200)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(200)).toBe(1)

      const event = readEvent(100)
      expect(event.error).toBe(Errno.SUCCESS)
    })

    it('handles future clock (no event)', () => {
      const fns = createPollFunctions(memory, fdTable)

      // Very long timeout (won't expire)
      writeClockSubscription(0, 1n, ClockId.MONOTONIC, 9999999999999n, 0)

      const result = fns.poll_oneoff(0, 100, 1, 200)

      expect(result).toBe(Errno.SUCCESS)
      // No events because clock hasn't expired
      expect(memory.readU32(200)).toBe(0)
    })
  })

  describe('error handling', () => {
    it('handles unknown event type', () => {
      const fns = createPollFunctions(memory, fdTable)

      // Write subscription with invalid type
      memory.writeU64(0, 1n) // userdata
      memory.writeU8(8, 99) // invalid type

      const result = fns.poll_oneoff(0, 100, 1, 200)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(200)).toBe(1)

      const event = readEvent(100)
      expect(event.error).toBe(Errno.EINVAL)
    })
  })

  describe('event output format', () => {
    it('writes events at correct offsets', () => {
      const fns = createPollFunctions(memory, fdTable)

      writeFdWriteSubscription(0, 42n, 1)
      writeFdWriteSubscription(SUBSCRIPTION_SIZE, 43n, 1)

      fns.poll_oneoff(0, 1000, 2, 2000)

      // Check first event
      const event1 = readEvent(1000)
      expect(event1.userdata).toBe(42n)

      // Check second event at offset EVENT_SIZE
      const event2 = readEvent(1000 + EVENT_SIZE)
      expect(event2.userdata).toBe(43n)
    })
  })
})
