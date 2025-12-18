/**
 * WASI Preview 1 file descriptor functions
 *
 * Implements fd_* functions for I/O operations.
 *
 * @packageDocumentation
 */

import { Errno, FileType, Rights, Whence, FdFlags, FstFlags } from './types.js'
import { WasiMemory, DIRENT_SIZE } from './memory.js'
import { FileDescriptorTable } from './fd-table.js'

/**
 * Input stream interface for stdin.
 */
export interface InputStream {
  /** Read up to max bytes. Returns empty array at EOF. */
  read(max: number): Promise<Uint8Array>
  /** Try to read synchronously (returns null if would block). */
  tryRead?(max: number): Uint8Array | null
  /** Check if data is available. */
  hasData?(): boolean
}

/**
 * Output stream interface for stdout/stderr.
 */
export interface OutputStream {
  /** Write data. */
  write(data: Uint8Array): void | Promise<void>
}

/**
 * File resource interface for file operations.
 */
export interface FileResource {
  /** Read data at offset. */
  read(offset: bigint, len: number): Uint8Array
  /** Write data at offset. Returns bytes written. */
  write(offset: bigint, data: Uint8Array): number
  /** Get file size. */
  size(): bigint
  /** Set file size (truncate or extend). */
  setSize(size: bigint): void
  /** Sync data to storage. */
  sync(): void
  /** Get file stats. */
  stat(): {
    dev: bigint
    ino: bigint
    filetype: FileType
    nlink: bigint
    size: bigint
    atim: bigint
    mtim: bigint
    ctim: bigint
  }
  /** Set file times. */
  setTimes(atim: bigint | null, mtim: bigint | null): void
}

/**
 * Directory resource interface for directory operations.
 */
export interface DirectoryResource {
  /** List directory entries. */
  readdir(): Array<{
    name: string
    ino: bigint
    type: FileType
  }>
  /** Get directory stats. */
  stat(): {
    dev: bigint
    ino: bigint
    filetype: FileType
    nlink: bigint
    size: bigint
    atim: bigint
    mtim: bigint
    ctim: bigint
  }
}

/**
 * Options for fd functions.
 */
export interface FdOptions {
  stdin?: InputStream
  stdout?: OutputStream
  stderr?: OutputStream
}

/**
 * Creates WASI fd functions.
 */
export function createFdFunctions(
  memory: WasiMemory,
  fdTable: FileDescriptorTable,
  options: FdOptions = {}
): {
  fd_advise: (fd: number, offset: bigint, len: bigint, advice: number) => number
  fd_allocate: (fd: number, offset: bigint, len: bigint) => number
  fd_close: (fd: number) => number
  fd_datasync: (fd: number) => number
  fd_fdstat_get: (fd: number, statPtr: number) => number
  fd_fdstat_set_flags: (fd: number, flags: number) => number
  fd_fdstat_set_rights: (fd: number, rightsBase: bigint, rightsInheriting: bigint) => number
  fd_filestat_get: (fd: number, bufPtr: number) => number
  fd_filestat_set_size: (fd: number, size: bigint) => number
  fd_filestat_set_times: (fd: number, atim: bigint, mtim: bigint, fstFlags: number) => number
  fd_pread: (fd: number, iovsPtr: number, iovsLen: number, offset: bigint, nreadPtr: number) => number
  fd_prestat_get: (fd: number, prestatPtr: number) => number
  fd_prestat_dir_name: (fd: number, pathPtr: number, pathLen: number) => number
  fd_pwrite: (fd: number, ciovsPtr: number, ciovsLen: number, offset: bigint, nwrittenPtr: number) => number
  fd_read: (fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number) => number
  fd_readdir: (fd: number, bufPtr: number, bufLen: number, cookie: bigint, bufUsedPtr: number) => number
  fd_renumber: (from: number, to: number) => number
  fd_seek: (fd: number, offset: bigint, whence: number, newOffsetPtr: number) => number
  fd_sync: (fd: number) => number
  fd_tell: (fd: number, offsetPtr: number) => number
  fd_write: (fd: number, ciovsPtr: number, ciovsLen: number, nwrittenPtr: number) => number
} {
  const { stdin, stdout, stderr } = options

  /**
   * Helper to read from stdin.
   */
  function readStdin(maxLen: number): Uint8Array {
    if (!stdin) {
      return new Uint8Array(0) // EOF
    }

    // Try synchronous read first if available
    if (stdin.tryRead) {
      const data = stdin.tryRead(maxLen)
      if (data !== null) {
        return data
      }
      // Would block - return empty with EAGAIN indicator
      return new Uint8Array(0)
    }

    // No sync read available - return empty (would block)
    return new Uint8Array(0)
  }

  /**
   * Helper to write to stdout/stderr.
   */
  function writeOutput(stream: OutputStream | undefined, data: Uint8Array): number {
    if (!stream) {
      return data.length // Discard silently
    }

    const result = stream.write(data)
    // Handle both sync and async - for now assume sync
    if (result instanceof Promise) {
      // Fire and forget for async - P1 is sync API
      result.catch(() => {
        /* ignore async errors */
      })
    }
    return data.length
  }

  return {
    /**
     * fd_advise(fd, offset, len, advice) -> errno
     *
     * Provide file advisory information on a file descriptor.
     */
    fd_advise(fd: number, _offset: bigint, _len: bigint, _advice: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_ADVISE)) return Errno.ENOTCAPABLE

      // Advisory is a hint - we can safely ignore it
      return Errno.SUCCESS
    },

    /**
     * fd_allocate(fd, offset, len) -> errno
     *
     * Force the allocation of space in a file.
     */
    fd_allocate(fd: number, offset: bigint, len: bigint): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_ALLOCATE)) return Errno.ENOTCAPABLE

      const resource = entry.resource as FileResource | undefined
      if (!resource) return Errno.EBADF

      try {
        const currentSize = resource.size()
        const neededSize = offset + len
        if (neededSize > currentSize) {
          resource.setSize(neededSize)
        }
        return Errno.SUCCESS
      } catch {
        return Errno.EIO
      }
    },

    /**
     * fd_close(fd) -> errno
     *
     * Close a file descriptor.
     */
    fd_close(fd: number): number {
      if (!fdTable.has(fd)) {
        return Errno.EBADF
      }

      // Don't allow closing stdio
      if (fd === 0 || fd === 1 || fd === 2) {
        return Errno.EBADF
      }

      fdTable.close(fd)
      return Errno.SUCCESS
    },

    /**
     * fd_datasync(fd) -> errno
     *
     * Synchronize the data of a file to disk.
     */
    fd_datasync(fd: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_DATASYNC)) return Errno.ENOTCAPABLE

      const resource = entry.resource as FileResource | undefined
      if (resource?.sync) {
        resource.sync()
      }
      return Errno.SUCCESS
    },

    /**
     * fd_fdstat_get(fd, fdstat_ptr) -> errno
     *
     * Get the attributes of a file descriptor.
     */
    fd_fdstat_get(fd: number, statPtr: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF

      memory.writeFdstat(statPtr, {
        filetype: entry.filetype,
        flags: entry.flags,
        rightsBase: entry.rights.base,
        rightsInheriting: entry.rights.inheriting,
      })

      return Errno.SUCCESS
    },

    /**
     * fd_fdstat_set_flags(fd, flags) -> errno
     *
     * Adjust the flags associated with a file descriptor.
     */
    fd_fdstat_set_flags(fd: number, flags: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_FDSTAT_SET_FLAGS)) return Errno.ENOTCAPABLE

      entry.flags = flags
      return Errno.SUCCESS
    },

    /**
     * fd_fdstat_set_rights(fd, rights_base, rights_inheriting) -> errno
     *
     * Adjust the rights associated with a file descriptor.
     * Rights can only be reduced, not expanded.
     */
    fd_fdstat_set_rights(fd: number, rightsBase: bigint, rightsInheriting: bigint): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF

      // Can only reduce rights, not expand
      if ((rightsBase & ~entry.rights.base) !== 0n) {
        return Errno.ENOTCAPABLE
      }
      if ((rightsInheriting & ~entry.rights.inheriting) !== 0n) {
        return Errno.ENOTCAPABLE
      }

      entry.rights.base = rightsBase
      entry.rights.inheriting = rightsInheriting
      return Errno.SUCCESS
    },

    /**
     * fd_filestat_get(fd, buf_ptr) -> errno
     *
     * Return the attributes of an open file.
     */
    fd_filestat_get(fd: number, bufPtr: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_FILESTAT_GET)) return Errno.ENOTCAPABLE

      const resource = entry.resource as FileResource | DirectoryResource | undefined

      if (resource?.stat) {
        const stat = resource.stat()
        memory.writeFilestat(bufPtr, stat)
      } else {
        // Default stats for stdio
        const now = BigInt(Date.now()) * 1_000_000n
        memory.writeFilestat(bufPtr, {
          dev: 0n,
          ino: BigInt(fd),
          filetype: entry.filetype,
          nlink: 1n,
          size: 0n,
          atim: now,
          mtim: now,
          ctim: now,
        })
      }

      return Errno.SUCCESS
    },

    /**
     * fd_filestat_set_size(fd, size) -> errno
     *
     * Adjust the size of an open file.
     */
    fd_filestat_set_size(fd: number, size: bigint): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_FILESTAT_SET_SIZE)) return Errno.ENOTCAPABLE

      const resource = entry.resource as FileResource | undefined
      if (!resource?.setSize) return Errno.EBADF

      try {
        resource.setSize(size)
        return Errno.SUCCESS
      } catch {
        return Errno.EIO
      }
    },

    /**
     * fd_filestat_set_times(fd, atim, mtim, fst_flags) -> errno
     *
     * Adjust the timestamps of an open file.
     */
    fd_filestat_set_times(fd: number, atim: bigint, mtim: bigint, fstFlags: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_FILESTAT_SET_TIMES)) return Errno.ENOTCAPABLE

      const resource = entry.resource as FileResource | undefined
      if (!resource?.setTimes) return Errno.EBADF

      const now = BigInt(Date.now()) * 1_000_000n

      let newAtim: bigint | null = null
      let newMtim: bigint | null = null

      if (fstFlags & FstFlags.ATIM) {
        newAtim = atim
      } else if (fstFlags & FstFlags.ATIM_NOW) {
        newAtim = now
      }

      if (fstFlags & FstFlags.MTIM) {
        newMtim = mtim
      } else if (fstFlags & FstFlags.MTIM_NOW) {
        newMtim = now
      }

      try {
        resource.setTimes(newAtim, newMtim)
        return Errno.SUCCESS
      } catch {
        return Errno.EIO
      }
    },

    /**
     * fd_pread(fd, iovs, iovs_len, offset, nread_ptr) -> errno
     *
     * Read from a file descriptor at a given offset.
     */
    fd_pread(fd: number, iovsPtr: number, iovsLen: number, offset: bigint, nreadPtr: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_READ | Rights.FD_SEEK)) return Errno.ENOTCAPABLE

      const resource = entry.resource as FileResource | undefined
      if (!resource?.read) return Errno.EBADF

      const iovs = memory.readIovecs(iovsPtr, iovsLen)
      let totalRead = 0

      for (const iov of iovs) {
        if (iov.len === 0) continue

        try {
          const data = resource.read(offset + BigInt(totalRead), iov.len)
          if (data.length === 0) break // EOF

          memory.writeBytes(iov.buf, data)
          totalRead += data.length

          if (data.length < iov.len) break // Partial read = EOF
        } catch {
          if (totalRead === 0) return Errno.EIO
          break
        }
      }

      memory.writeU32(nreadPtr, totalRead)
      return Errno.SUCCESS
    },

    /**
     * fd_prestat_get(fd, prestat_ptr) -> errno
     *
     * Return a description of the given preopened file descriptor.
     */
    fd_prestat_get(fd: number, prestatPtr: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF

      if (entry.preopen === undefined) {
        return Errno.EBADF // Not a preopen
      }

      const pathLen = new TextEncoder().encode(entry.preopen).length
      memory.writePrestat(prestatPtr, pathLen)
      return Errno.SUCCESS
    },

    /**
     * fd_prestat_dir_name(fd, path_ptr, path_len) -> errno
     *
     * Return the path of the given preopened file descriptor.
     */
    fd_prestat_dir_name(fd: number, pathPtr: number, pathLen: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF

      if (entry.preopen === undefined) {
        return Errno.EBADF // Not a preopen
      }

      const encoded = new TextEncoder().encode(entry.preopen)
      if (encoded.length > pathLen) {
        return Errno.ENAMETOOLONG
      }

      memory.writeBytes(pathPtr, encoded)
      return Errno.SUCCESS
    },

    /**
     * fd_pwrite(fd, ciovs, ciovs_len, offset, nwritten_ptr) -> errno
     *
     * Write to a file descriptor at a given offset.
     */
    fd_pwrite(fd: number, ciovsPtr: number, ciovsLen: number, offset: bigint, nwrittenPtr: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_WRITE | Rights.FD_SEEK)) return Errno.ENOTCAPABLE

      const resource = entry.resource as FileResource | undefined
      if (!resource?.write) return Errno.EBADF

      const ciovs = memory.readCiovecs(ciovsPtr, ciovsLen)
      let totalWritten = 0

      for (const ciov of ciovs) {
        if (ciov.len === 0) continue

        const data = memory.readBytes(ciov.buf, ciov.len)
        try {
          const written = resource.write(offset + BigInt(totalWritten), data)
          totalWritten += written
          if (written < ciov.len) break // Short write
        } catch {
          if (totalWritten === 0) return Errno.EIO
          break
        }
      }

      memory.writeU32(nwrittenPtr, totalWritten)
      return Errno.SUCCESS
    },

    /**
     * fd_read(fd, iovs, iovs_len, nread_ptr) -> errno
     *
     * Read from a file descriptor.
     */
    fd_read(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_READ)) return Errno.ENOTCAPABLE

      const iovs = memory.readIovecs(iovsPtr, iovsLen)
      let totalRead = 0

      // Special handling for stdin
      if (entry.type === 'stdin') {
        for (const iov of iovs) {
          if (iov.len === 0) continue

          const data = readStdin(iov.len)
          if (data.length === 0) break // EOF or would block

          memory.writeBytes(iov.buf, data)
          totalRead += data.length

          if (data.length < iov.len) break
        }

        memory.writeU32(nreadPtr, totalRead)
        return Errno.SUCCESS
      }

      // Regular file read
      const resource = entry.resource as FileResource | undefined
      if (!resource?.read) return Errno.EBADF

      for (const iov of iovs) {
        if (iov.len === 0) continue

        try {
          const data = resource.read(entry.position, iov.len)
          if (data.length === 0) break // EOF

          memory.writeBytes(iov.buf, data)
          entry.position += BigInt(data.length)
          totalRead += data.length

          if (data.length < iov.len) break
        } catch {
          if (totalRead === 0) return Errno.EIO
          break
        }
      }

      memory.writeU32(nreadPtr, totalRead)
      return Errno.SUCCESS
    },

    /**
     * fd_readdir(fd, buf, buf_len, cookie, buf_used_ptr) -> errno
     *
     * Read directory entries from a directory.
     */
    fd_readdir(fd: number, bufPtr: number, bufLen: number, cookie: bigint, bufUsedPtr: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_READDIR)) return Errno.ENOTCAPABLE
      if (entry.filetype !== FileType.DIRECTORY) return Errno.ENOTDIR

      const resource = entry.resource as DirectoryResource | undefined
      if (!resource?.readdir) return Errno.EBADF

      const entries = resource.readdir()
      let bufUsed = 0
      let currentCookie = 0n

      for (const dirEntry of entries) {
        // Skip entries before cookie
        if (currentCookie < cookie) {
          currentCookie++
          continue
        }

        const nameBytes = new TextEncoder().encode(dirEntry.name)
        const entrySize = DIRENT_SIZE + nameBytes.length

        // Check if we have space
        if (bufUsed + entrySize > bufLen) {
          // No more space - indicate there are more entries
          break
        }

        // Write dirent
        memory.writeDirent(bufPtr + bufUsed, {
          next: currentCookie + 1n,
          ino: dirEntry.ino,
          namelen: nameBytes.length,
          type: dirEntry.type,
        })

        // Write name
        memory.writeBytes(bufPtr + bufUsed + DIRENT_SIZE, nameBytes)

        bufUsed += entrySize
        currentCookie++
      }

      memory.writeU32(bufUsedPtr, bufUsed)
      return Errno.SUCCESS
    },

    /**
     * fd_renumber(fd, to) -> errno
     *
     * Atomically replace a file descriptor.
     */
    fd_renumber(from: number, to: number): number {
      if (!fdTable.has(from)) return Errno.EBADF

      // Can't renumber to stdio
      if (to === 0 || to === 1 || to === 2) {
        return Errno.EBADF
      }

      if (!fdTable.renumber(from, to)) {
        return Errno.EBADF
      }

      return Errno.SUCCESS
    },

    /**
     * fd_seek(fd, offset, whence, newoffset_ptr) -> errno
     *
     * Move the offset of a file descriptor.
     */
    fd_seek(fd: number, offset: bigint, whence: number, newOffsetPtr: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_SEEK)) return Errno.ENOTCAPABLE

      // Can't seek on stdio
      if (entry.type === 'stdin' || entry.type === 'stdout' || entry.type === 'stderr') {
        return Errno.ESPIPE
      }

      const resource = entry.resource as FileResource | undefined
      let newOffset: bigint

      switch (whence) {
        case Whence.SET:
          newOffset = offset
          break
        case Whence.CUR:
          newOffset = entry.position + offset
          break
        case Whence.END: {
          const size = resource?.size() ?? 0n
          newOffset = size + offset
          break
        }
        default:
          return Errno.EINVAL
      }

      if (newOffset < 0n) {
        return Errno.EINVAL
      }

      entry.position = newOffset
      memory.writeU64(newOffsetPtr, newOffset)
      return Errno.SUCCESS
    },

    /**
     * fd_sync(fd) -> errno
     *
     * Synchronize the data and metadata of a file to disk.
     */
    fd_sync(fd: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_SYNC)) return Errno.ENOTCAPABLE

      const resource = entry.resource as FileResource | undefined
      if (resource?.sync) {
        resource.sync()
      }
      return Errno.SUCCESS
    },

    /**
     * fd_tell(fd, offset_ptr) -> errno
     *
     * Return the current offset of a file descriptor.
     */
    fd_tell(fd: number, offsetPtr: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_TELL)) return Errno.ENOTCAPABLE

      memory.writeU64(offsetPtr, entry.position)
      return Errno.SUCCESS
    },

    /**
     * fd_write(fd, ciovs, ciovs_len, nwritten_ptr) -> errno
     *
     * Write to a file descriptor.
     */
    fd_write(fd: number, ciovsPtr: number, ciovsLen: number, nwrittenPtr: number): number {
      const entry = fdTable.get(fd)
      if (!entry) return Errno.EBADF
      if (!fdTable.hasRights(fd, Rights.FD_WRITE)) return Errno.ENOTCAPABLE

      const ciovs = memory.readCiovecs(ciovsPtr, ciovsLen)
      let totalWritten = 0

      // Special handling for stdout/stderr
      if (entry.type === 'stdout' || entry.type === 'stderr') {
        const stream = entry.type === 'stdout' ? stdout : stderr

        for (const ciov of ciovs) {
          if (ciov.len === 0) continue
          const data = memory.readBytes(ciov.buf, ciov.len)
          totalWritten += writeOutput(stream, data)
        }

        memory.writeU32(nwrittenPtr, totalWritten)
        return Errno.SUCCESS
      }

      // Regular file write
      const resource = entry.resource as FileResource | undefined
      if (!resource?.write) return Errno.EBADF

      for (const ciov of ciovs) {
        if (ciov.len === 0) continue

        const data = memory.readBytes(ciov.buf, ciov.len)
        try {
          // Handle append mode
          let writeOffset = entry.position
          if (entry.flags & FdFlags.APPEND) {
            writeOffset = resource.size()
          }

          const written = resource.write(writeOffset, data)
          entry.position = writeOffset + BigInt(written)
          totalWritten += written

          if (written < ciov.len) break
        } catch {
          if (totalWritten === 0) return Errno.EIO
          break
        }
      }

      memory.writeU32(nwrittenPtr, totalWritten)
      return Errno.SUCCESS
    },
  }
}
