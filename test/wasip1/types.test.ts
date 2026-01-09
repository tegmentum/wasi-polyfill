/**
 * WASI Preview 1 Types Tests
 */

import { describe, it, expect } from 'vitest'
import {
  Errno,
  ClockId,
  FdFlags,
  FileType,
  Rights,
  ALL_RIGHTS,
  DIRECTORY_RIGHTS,
  FILE_RIGHTS,
  STDIN_RIGHTS,
  STDOUT_RIGHTS,
  Whence,
  LookupFlags,
  OFlags,
  PrestatType,
  Advice,
  FstFlags,
  EventType,
  EventRwFlags,
  SubclockFlags,
  Signal,
  RiFlags,
  RoFlags,
  SdFlags,
  IOVEC_SIZE,
  CIOVEC_SIZE,
  FILESTAT_SIZE,
  FDSTAT_SIZE,
  PRESTAT_SIZE,
  DIRENT_SIZE,
  EVENT_SIZE,
  SUBSCRIPTION_SIZE,
} from '../../src/wasip1/types.js'

describe('WASIP1 Types', () => {
  describe('Errno', () => {
    it('defines SUCCESS as 0', () => {
      expect(Errno.SUCCESS).toBe(0)
    })

    it('defines common error codes', () => {
      expect(Errno.EBADF).toBe(8)
      expect(Errno.ENOENT).toBe(44)
      expect(Errno.EEXIST).toBe(20)
      expect(Errno.EINVAL).toBe(28)
      expect(Errno.EIO).toBe(29)
      expect(Errno.ENOSYS).toBe(52)
    })

    it('defines permission errors', () => {
      expect(Errno.EACCES).toBe(2)
      expect(Errno.EPERM).toBe(63)
      expect(Errno.ENOTCAPABLE).toBe(76)
    })

    it('defines filesystem errors', () => {
      expect(Errno.EISDIR).toBe(31)
      expect(Errno.ENOTDIR).toBe(54)
      expect(Errno.ENOTEMPTY).toBe(55)
      expect(Errno.EROFS).toBe(69)
    })

    it('defines network errors', () => {
      expect(Errno.ECONNREFUSED).toBe(14)
      expect(Errno.ECONNRESET).toBe(15)
      expect(Errno.ETIMEDOUT).toBe(73)
      expect(Errno.EADDRINUSE).toBe(3)
    })

    it('has 77 error codes (0-76)', () => {
      const codes = Object.values(Errno)
      expect(codes.length).toBe(77)
      expect(Math.min(...codes)).toBe(0)
      expect(Math.max(...codes)).toBe(76)
    })
  })

  describe('ClockId', () => {
    it('defines clock types', () => {
      expect(ClockId.REALTIME).toBe(0)
      expect(ClockId.MONOTONIC).toBe(1)
      expect(ClockId.PROCESS_CPUTIME_ID).toBe(2)
      expect(ClockId.THREAD_CPUTIME_ID).toBe(3)
    })
  })

  describe('FdFlags', () => {
    it('defines file descriptor flags as bit flags', () => {
      expect(FdFlags.APPEND).toBe(1)
      expect(FdFlags.DSYNC).toBe(2)
      expect(FdFlags.NONBLOCK).toBe(4)
      expect(FdFlags.RSYNC).toBe(8)
      expect(FdFlags.SYNC).toBe(16)
    })

    it('flags can be combined with bitwise OR', () => {
      const combined = FdFlags.APPEND | FdFlags.NONBLOCK
      expect(combined).toBe(5)
      expect(combined & FdFlags.APPEND).toBe(FdFlags.APPEND)
      expect(combined & FdFlags.NONBLOCK).toBe(FdFlags.NONBLOCK)
      expect(combined & FdFlags.SYNC).toBe(0)
    })
  })

  describe('FileType', () => {
    it('defines file types', () => {
      expect(FileType.UNKNOWN).toBe(0)
      expect(FileType.BLOCK_DEVICE).toBe(1)
      expect(FileType.CHARACTER_DEVICE).toBe(2)
      expect(FileType.DIRECTORY).toBe(3)
      expect(FileType.REGULAR_FILE).toBe(4)
      expect(FileType.SOCKET_DGRAM).toBe(5)
      expect(FileType.SOCKET_STREAM).toBe(6)
      expect(FileType.SYMBOLIC_LINK).toBe(7)
    })
  })

  describe('Rights', () => {
    it('defines rights as bigint bit flags', () => {
      expect(Rights.FD_DATASYNC).toBe(1n)
      expect(Rights.FD_READ).toBe(2n)
      expect(Rights.FD_SEEK).toBe(4n)
      expect(Rights.FD_WRITE).toBe(64n)
    })

    it('defines all standard rights', () => {
      expect(Rights.PATH_CREATE_DIRECTORY).toBe(1n << 9n)
      expect(Rights.PATH_OPEN).toBe(1n << 13n)
      expect(Rights.FD_READDIR).toBe(1n << 14n)
      expect(Rights.SOCK_ACCEPT).toBe(1n << 29n)
    })

    it('defines ALL_RIGHTS as combination of all', () => {
      expect(ALL_RIGHTS).toBeGreaterThan(0n)
      expect(ALL_RIGHTS & Rights.FD_READ).toBe(Rights.FD_READ)
      expect(ALL_RIGHTS & Rights.FD_WRITE).toBe(Rights.FD_WRITE)
      expect(ALL_RIGHTS & Rights.PATH_OPEN).toBe(Rights.PATH_OPEN)
    })

    it('defines DIRECTORY_RIGHTS', () => {
      expect(DIRECTORY_RIGHTS & Rights.PATH_OPEN).toBe(Rights.PATH_OPEN)
      expect(DIRECTORY_RIGHTS & Rights.PATH_CREATE_DIRECTORY).toBe(Rights.PATH_CREATE_DIRECTORY)
      expect(DIRECTORY_RIGHTS & Rights.FD_READDIR).toBe(Rights.FD_READDIR)
    })

    it('defines FILE_RIGHTS', () => {
      expect(FILE_RIGHTS & Rights.FD_READ).toBe(Rights.FD_READ)
      expect(FILE_RIGHTS & Rights.FD_WRITE).toBe(Rights.FD_WRITE)
      expect(FILE_RIGHTS & Rights.FD_SEEK).toBe(Rights.FD_SEEK)
    })

    it('defines STDIN_RIGHTS', () => {
      expect(STDIN_RIGHTS & Rights.FD_READ).toBe(Rights.FD_READ)
      expect(STDIN_RIGHTS & Rights.FD_WRITE).toBe(0n)
    })

    it('defines STDOUT_RIGHTS', () => {
      expect(STDOUT_RIGHTS & Rights.FD_WRITE).toBe(Rights.FD_WRITE)
      expect(STDOUT_RIGHTS & Rights.FD_READ).toBe(0n)
    })
  })

  describe('Whence', () => {
    it('defines seek positions', () => {
      expect(Whence.SET).toBe(0)
      expect(Whence.CUR).toBe(1)
      expect(Whence.END).toBe(2)
    })
  })

  describe('LookupFlags', () => {
    it('defines symlink follow flag', () => {
      expect(LookupFlags.SYMLINK_FOLLOW).toBe(1)
    })
  })

  describe('OFlags', () => {
    it('defines open flags as bit flags', () => {
      expect(OFlags.CREAT).toBe(1)
      expect(OFlags.DIRECTORY).toBe(2)
      expect(OFlags.EXCL).toBe(4)
      expect(OFlags.TRUNC).toBe(8)
    })

    it('flags can be combined', () => {
      const createExclusive = OFlags.CREAT | OFlags.EXCL
      expect(createExclusive).toBe(5)
    })
  })

  describe('PrestatType', () => {
    it('defines directory prestat type', () => {
      expect(PrestatType.DIR).toBe(0)
    })
  })

  describe('Advice', () => {
    it('defines file access patterns', () => {
      expect(Advice.NORMAL).toBe(0)
      expect(Advice.SEQUENTIAL).toBe(1)
      expect(Advice.RANDOM).toBe(2)
      expect(Advice.WILLNEED).toBe(3)
      expect(Advice.DONTNEED).toBe(4)
      expect(Advice.NOREUSE).toBe(5)
    })
  })

  describe('FstFlags', () => {
    it('defines filestat time flags', () => {
      expect(FstFlags.ATIM).toBe(1)
      expect(FstFlags.ATIM_NOW).toBe(2)
      expect(FstFlags.MTIM).toBe(4)
      expect(FstFlags.MTIM_NOW).toBe(8)
    })

    it('flags can be combined', () => {
      const setNow = FstFlags.ATIM_NOW | FstFlags.MTIM_NOW
      expect(setNow).toBe(10)
    })
  })

  describe('EventType', () => {
    it('defines event types', () => {
      expect(EventType.CLOCK).toBe(0)
      expect(EventType.FD_READ).toBe(1)
      expect(EventType.FD_WRITE).toBe(2)
    })
  })

  describe('EventRwFlags', () => {
    it('defines read/write event flags', () => {
      expect(EventRwFlags.FD_READWRITE_HANGUP).toBe(1)
    })
  })

  describe('SubclockFlags', () => {
    it('defines subscription clock flags', () => {
      expect(SubclockFlags.SUBSCRIPTION_CLOCK_ABSTIME).toBe(1)
    })
  })

  describe('Signal', () => {
    it('defines standard signals', () => {
      expect(Signal.NONE).toBe(0)
      expect(Signal.HUP).toBe(1)
      expect(Signal.INT).toBe(2)
      expect(Signal.QUIT).toBe(3)
      expect(Signal.KILL).toBe(9)
      expect(Signal.TERM).toBe(15)
    })

    it('defines all POSIX signals', () => {
      expect(Signal.SEGV).toBe(11)
      expect(Signal.PIPE).toBe(13)
      expect(Signal.ALRM).toBe(14)
      expect(Signal.STOP).toBe(18)
      expect(Signal.SYS).toBe(30)
    })
  })

  describe('Socket flags', () => {
    it('defines receive flags', () => {
      expect(RiFlags.RECV_PEEK).toBe(1)
      expect(RiFlags.RECV_WAITALL).toBe(2)
    })

    it('defines receive output flags', () => {
      expect(RoFlags.RECV_DATA_TRUNCATED).toBe(1)
    })

    it('defines shutdown flags', () => {
      expect(SdFlags.RD).toBe(1)
      expect(SdFlags.WR).toBe(2)
    })
  })

  describe('Structure sizes', () => {
    it('defines iovec size', () => {
      expect(IOVEC_SIZE).toBe(8)
    })

    it('defines ciovec size', () => {
      expect(CIOVEC_SIZE).toBe(8)
    })

    it('defines filestat size', () => {
      expect(FILESTAT_SIZE).toBe(64)
    })

    it('defines fdstat size', () => {
      expect(FDSTAT_SIZE).toBe(24)
    })

    it('defines prestat size', () => {
      expect(PRESTAT_SIZE).toBe(8)
    })

    it('defines dirent size', () => {
      expect(DIRENT_SIZE).toBe(24)
    })

    it('defines event size', () => {
      expect(EVENT_SIZE).toBe(32)
    })

    it('defines subscription size', () => {
      expect(SUBSCRIPTION_SIZE).toBe(48)
    })
  })
})
