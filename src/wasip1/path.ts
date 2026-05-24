/**
 * WASI Preview 1 path functions
 *
 * Implements path_* functions for filesystem operations.
 *
 * @packageDocumentation
 */

import { Errno, FileType, Rights, OFlags, FstFlags } from './types.js'
import { WasiMemory } from './memory.js'
import { FileDescriptorTable, createFileEntry, createDirectoryEntry } from './fd-table.js'
import type { FileResource, DirectoryResource } from './fd.js'

/**
 * Filesystem interface for path operations.
 */
export interface Filesystem {
  /** Open a file or directory. */
  open(
    path: string,
    options: {
      create?: boolean
      exclusive?: boolean
      truncate?: boolean
      directory?: boolean
    }
  ): FileResource | DirectoryResource

  /** Create a directory. */
  createDirectory(path: string): void

  /** Remove a directory. */
  removeDirectory(path: string): void

  /** Unlink (delete) a file. */
  unlink(path: string): void

  /** Rename a file or directory. */
  rename(oldPath: string, newPath: string): void

  /** Get file/directory stats. */
  stat(path: string): {
    dev: bigint
    ino: bigint
    filetype: FileType
    nlink: bigint
    size: bigint
    atim: bigint
    mtim: bigint
    ctim: bigint
  }

  /** Set file/directory times. */
  setTimes(path: string, atim: bigint | null, mtim: bigint | null): void

  /** Create a symbolic link. */
  symlink?(target: string, path: string): void

  /** Read a symbolic link. */
  readlink?(path: string): string

  /** Create a hard link. */
  link?(oldPath: string, newPath: string): void
}

/**
 * Options for path functions.
 */
export interface PathOptions {
  /** Map of preopen path to filesystem. */
  filesystems?: Map<string, Filesystem>
}

/**
 * Creates WASI path functions.
 */
export function createPathFunctions(
  memory: WasiMemory,
  fdTable: FileDescriptorTable,
  options: PathOptions = {}
): {
  path_create_directory: (fd: number, pathPtr: number, pathLen: number) => number
  path_filestat_get: (fd: number, flags: number, pathPtr: number, pathLen: number, bufPtr: number) => number
  path_filestat_set_times: (fd: number, flags: number, pathPtr: number, pathLen: number, atim: bigint, mtim: bigint, fstFlags: number) => number
  path_link: (oldFd: number, oldFlags: number, oldPathPtr: number, oldPathLen: number, newFd: number, newPathPtr: number, newPathLen: number) => number
  path_open: (fd: number, dirflags: number, pathPtr: number, pathLen: number, oflags: number, rightsBase: bigint, rightsInheriting: bigint, fdflags: number, fdPtr: number) => number
  path_readlink: (fd: number, pathPtr: number, pathLen: number, bufPtr: number, bufLen: number, bufUsedPtr: number) => number
  path_remove_directory: (fd: number, pathPtr: number, pathLen: number) => number
  path_rename: (oldFd: number, oldPathPtr: number, oldPathLen: number, newFd: number, newPathPtr: number, newPathLen: number) => number
  path_symlink: (oldPathPtr: number, oldPathLen: number, fd: number, newPathPtr: number, newPathLen: number) => number
  path_unlink_file: (fd: number, pathPtr: number, pathLen: number) => number
} {
  const { filesystems } = options

  /**
   * Get the filesystem for a given fd.
   */
  function getFilesystem(fd: number): { fs: Filesystem; basePath: string } | null {
    const entry = fdTable.get(fd)
    if (!entry) return null
    if (entry.filetype !== FileType.DIRECTORY) return null

    // Check if this fd has an associated filesystem
    if (entry.preopen && filesystems) {
      const fs = filesystems.get(entry.preopen)
      if (fs) {
        return { fs, basePath: entry.path ?? '' }
      }
    }

    // Check if the entry has a filesystem resource attached
    const resource = entry.resource as { filesystem?: Filesystem } | undefined
    if (resource?.filesystem) {
      return { fs: resource.filesystem, basePath: entry.path ?? '' }
    }

    return null
  }

  /**
   * Resolve a path relative to a directory fd.
   */
  function resolvePath(basePath: string, relativePath: string): string {
    // Join basePath and relativePath. A leading '/' means "relative to the
    // filesystem (preopen) root".
    let combined: string
    if (relativePath.startsWith('/')) {
      combined = relativePath
    } else if (basePath === '' || basePath === '.') {
      combined = relativePath
    } else {
      combined = basePath.replace(/\/+$/, '') + '/' + relativePath
    }

    // Normalize '.' and '..'. '..' is clamped at the root so a path can never
    // escape the preopen (defense-in-depth), and 'a/../b' correctly resolves to
    // 'b' instead of failing on a literal '..' component. The absolute/relative
    // distinction (leading '/') is preserved for the filesystem layer.
    const isAbsolute = combined.startsWith('/')
    const stack: string[] = []
    for (const part of combined.split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        stack.pop()
        continue
      }
      stack.push(part)
    }
    const joined = stack.join('/')
    return isAbsolute ? '/' + joined : joined
  }

  return {
    /**
     * path_create_directory(fd, path_ptr, path_len) -> errno
     *
     * Create a directory.
     */
    path_create_directory(fd: number, pathPtr: number, pathLen: number): number {
      if (!fdTable.hasRights(fd, Rights.PATH_CREATE_DIRECTORY)) return Errno.ENOTCAPABLE

      const fsInfo = getFilesystem(fd)
      if (!fsInfo) return Errno.EBADF

      const path = memory.readString(pathPtr, pathLen)
      const fullPath = resolvePath(fsInfo.basePath, path)

      try {
        fsInfo.fs.createDirectory(fullPath)
        return Errno.SUCCESS
      } catch (e) {
        return mapError(e)
      }
    },

    /**
     * path_filestat_get(fd, flags, path_ptr, path_len, buf_ptr) -> errno
     *
     * Return the attributes of a file or directory.
     */
    path_filestat_get(fd: number, _flags: number, pathPtr: number, pathLen: number, bufPtr: number): number {
      if (!fdTable.hasRights(fd, Rights.PATH_FILESTAT_GET)) return Errno.ENOTCAPABLE

      const fsInfo = getFilesystem(fd)
      if (!fsInfo) return Errno.EBADF

      const path = memory.readString(pathPtr, pathLen)
      const fullPath = resolvePath(fsInfo.basePath, path)

      try {
        const stat = fsInfo.fs.stat(fullPath)
        memory.writeFilestat(bufPtr, stat)
        return Errno.SUCCESS
      } catch (e) {
        return mapError(e)
      }
    },

    /**
     * path_filestat_set_times(fd, flags, path_ptr, path_len, atim, mtim, fst_flags) -> errno
     *
     * Adjust the timestamps of a file or directory.
     */
    path_filestat_set_times(
      fd: number,
      _flags: number,
      pathPtr: number,
      pathLen: number,
      atim: bigint,
      mtim: bigint,
      fstFlags: number
    ): number {
      if (!fdTable.hasRights(fd, Rights.PATH_FILESTAT_SET_TIMES)) return Errno.ENOTCAPABLE

      // It is invalid to request both an explicit timestamp and "now" for the
      // same field (WASI requires EINVAL).
      if (
        (fstFlags & FstFlags.ATIM && fstFlags & FstFlags.ATIM_NOW) ||
        (fstFlags & FstFlags.MTIM && fstFlags & FstFlags.MTIM_NOW)
      ) {
        return Errno.EINVAL
      }

      const fsInfo = getFilesystem(fd)
      if (!fsInfo) return Errno.EBADF

      const path = memory.readString(pathPtr, pathLen)
      const fullPath = resolvePath(fsInfo.basePath, path)

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
        fsInfo.fs.setTimes(fullPath, newAtim, newMtim)
        return Errno.SUCCESS
      } catch (e) {
        return mapError(e)
      }
    },

    /**
     * path_link(old_fd, old_flags, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) -> errno
     *
     * Create a hard link.
     */
    path_link(
      oldFd: number,
      _oldFlags: number,
      oldPathPtr: number,
      oldPathLen: number,
      newFd: number,
      newPathPtr: number,
      newPathLen: number
    ): number {
      if (!fdTable.hasRights(oldFd, Rights.PATH_LINK_SOURCE)) return Errno.ENOTCAPABLE
      if (!fdTable.hasRights(newFd, Rights.PATH_LINK_TARGET)) return Errno.ENOTCAPABLE

      const oldFsInfo = getFilesystem(oldFd)
      const newFsInfo = getFilesystem(newFd)
      if (!oldFsInfo || !newFsInfo) return Errno.EBADF

      // Hard links must be on same filesystem
      if (oldFsInfo.fs !== newFsInfo.fs) return Errno.EXDEV

      if (!oldFsInfo.fs.link) return Errno.ENOSYS

      const oldPath = memory.readString(oldPathPtr, oldPathLen)
      const newPath = memory.readString(newPathPtr, newPathLen)
      const fullOldPath = resolvePath(oldFsInfo.basePath, oldPath)
      const fullNewPath = resolvePath(newFsInfo.basePath, newPath)

      try {
        oldFsInfo.fs.link(fullOldPath, fullNewPath)
        return Errno.SUCCESS
      } catch (e) {
        return mapError(e)
      }
    },

    /**
     * path_open(fd, dirflags, path_ptr, path_len, oflags, rights_base, rights_inheriting, fdflags, fd_ptr) -> errno
     *
     * Open a file or directory.
     */
    path_open(
      fd: number,
      _dirflags: number,
      pathPtr: number,
      pathLen: number,
      oflags: number,
      rightsBase: bigint,
      rightsInheriting: bigint,
      fdflags: number,
      fdPtr: number
    ): number {
      if (!fdTable.hasRights(fd, Rights.PATH_OPEN)) return Errno.ENOTCAPABLE

      const fsInfo = getFilesystem(fd)
      if (!fsInfo) return Errno.EBADF

      const path = memory.readString(pathPtr, pathLen)
      const fullPath = resolvePath(fsInfo.basePath, path)

      const isDirectory = (oflags & OFlags.DIRECTORY) !== 0
      const create = (oflags & OFlags.CREAT) !== 0
      const exclusive = (oflags & OFlags.EXCL) !== 0
      const truncate = (oflags & OFlags.TRUNC) !== 0

      try {
        const resource = fsInfo.fs.open(fullPath, {
          create,
          exclusive,
          truncate,
          directory: isDirectory,
        })

        // Determine filetype from resource
        const isDir = 'readdir' in resource

        // Create fd entry
        let newFd: number
        if (isDir) {
          // Attach the filesystem so getFilesystem() can resolve path_* calls
          // made against this directory fd (it is not a preopen).
          ;(resource as { filesystem?: Filesystem }).filesystem = fsInfo.fs
          const entry = createDirectoryEntry(fullPath, undefined, resource)
          entry.rights.base = rightsBase
          entry.rights.inheriting = rightsInheriting
          entry.flags = fdflags
          newFd = fdTable.allocate(entry)
        } else {
          const entry = createFileEntry(
            fullPath,
            fdflags,
            { base: rightsBase, inheriting: rightsInheriting },
            resource
          )
          newFd = fdTable.allocate(entry)
        }

        memory.writeU32(fdPtr, newFd)
        return Errno.SUCCESS
      } catch (e) {
        return mapError(e)
      }
    },

    /**
     * path_readlink(fd, path_ptr, path_len, buf_ptr, buf_len, buf_used_ptr) -> errno
     *
     * Read the contents of a symbolic link.
     */
    path_readlink(
      fd: number,
      pathPtr: number,
      pathLen: number,
      bufPtr: number,
      bufLen: number,
      bufUsedPtr: number
    ): number {
      if (!fdTable.hasRights(fd, Rights.PATH_READLINK)) return Errno.ENOTCAPABLE

      const fsInfo = getFilesystem(fd)
      if (!fsInfo) return Errno.EBADF

      if (!fsInfo.fs.readlink) return Errno.ENOSYS

      const path = memory.readString(pathPtr, pathLen)
      const fullPath = resolvePath(fsInfo.basePath, path)

      try {
        const target = fsInfo.fs.readlink(fullPath)
        const encoded = new TextEncoder().encode(target)

        const copyLen = Math.min(encoded.length, bufLen)
        memory.writeBytes(bufPtr, encoded.subarray(0, copyLen))
        memory.writeU32(bufUsedPtr, copyLen)

        return Errno.SUCCESS
      } catch (e) {
        return mapError(e)
      }
    },

    /**
     * path_remove_directory(fd, path_ptr, path_len) -> errno
     *
     * Remove a directory.
     */
    path_remove_directory(fd: number, pathPtr: number, pathLen: number): number {
      if (!fdTable.hasRights(fd, Rights.PATH_REMOVE_DIRECTORY)) return Errno.ENOTCAPABLE

      const fsInfo = getFilesystem(fd)
      if (!fsInfo) return Errno.EBADF

      const path = memory.readString(pathPtr, pathLen)
      const fullPath = resolvePath(fsInfo.basePath, path)

      try {
        fsInfo.fs.removeDirectory(fullPath)
        return Errno.SUCCESS
      } catch (e) {
        return mapError(e)
      }
    },

    /**
     * path_rename(old_fd, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) -> errno
     *
     * Rename a file or directory.
     */
    path_rename(
      oldFd: number,
      oldPathPtr: number,
      oldPathLen: number,
      newFd: number,
      newPathPtr: number,
      newPathLen: number
    ): number {
      if (!fdTable.hasRights(oldFd, Rights.PATH_RENAME_SOURCE)) return Errno.ENOTCAPABLE
      if (!fdTable.hasRights(newFd, Rights.PATH_RENAME_TARGET)) return Errno.ENOTCAPABLE

      const oldFsInfo = getFilesystem(oldFd)
      const newFsInfo = getFilesystem(newFd)
      if (!oldFsInfo || !newFsInfo) return Errno.EBADF

      // Rename must be on same filesystem
      if (oldFsInfo.fs !== newFsInfo.fs) return Errno.EXDEV

      const oldPath = memory.readString(oldPathPtr, oldPathLen)
      const newPath = memory.readString(newPathPtr, newPathLen)
      const fullOldPath = resolvePath(oldFsInfo.basePath, oldPath)
      const fullNewPath = resolvePath(newFsInfo.basePath, newPath)

      try {
        oldFsInfo.fs.rename(fullOldPath, fullNewPath)
        return Errno.SUCCESS
      } catch (e) {
        return mapError(e)
      }
    },

    /**
     * path_symlink(old_path_ptr, old_path_len, fd, new_path_ptr, new_path_len) -> errno
     *
     * Create a symbolic link.
     */
    path_symlink(
      oldPathPtr: number,
      oldPathLen: number,
      fd: number,
      newPathPtr: number,
      newPathLen: number
    ): number {
      if (!fdTable.hasRights(fd, Rights.PATH_SYMLINK)) return Errno.ENOTCAPABLE

      const fsInfo = getFilesystem(fd)
      if (!fsInfo) return Errno.EBADF

      if (!fsInfo.fs.symlink) return Errno.ENOSYS

      const oldPath = memory.readString(oldPathPtr, oldPathLen)
      const newPath = memory.readString(newPathPtr, newPathLen)
      const fullNewPath = resolvePath(fsInfo.basePath, newPath)

      try {
        // oldPath is the target, which is stored as-is (can be relative or absolute)
        fsInfo.fs.symlink(oldPath, fullNewPath)
        return Errno.SUCCESS
      } catch (e) {
        return mapError(e)
      }
    },

    /**
     * path_unlink_file(fd, path_ptr, path_len) -> errno
     *
     * Unlink a file.
     */
    path_unlink_file(fd: number, pathPtr: number, pathLen: number): number {
      if (!fdTable.hasRights(fd, Rights.PATH_UNLINK_FILE)) return Errno.ENOTCAPABLE

      const fsInfo = getFilesystem(fd)
      if (!fsInfo) return Errno.EBADF

      const path = memory.readString(pathPtr, pathLen)
      const fullPath = resolvePath(fsInfo.basePath, path)

      try {
        fsInfo.fs.unlink(fullPath)
        return Errno.SUCCESS
      } catch (e) {
        return mapError(e)
      }
    },
  }
}

/**
 * POSIX error code -> WASI errno. Both our `FilesystemError` and native
 * `node:fs` errors expose a string `.code`, so this is the authoritative map.
 */
const ERRNO_BY_CODE: Readonly<Record<string, Errno>> = {
  ENOENT: Errno.ENOENT,
  EEXIST: Errno.EEXIST,
  ENOTDIR: Errno.ENOTDIR,
  EISDIR: Errno.EISDIR,
  ENOTEMPTY: Errno.ENOTEMPTY,
  EACCES: Errno.EACCES,
  EPERM: Errno.EPERM,
  EROFS: Errno.EROFS,
  EINVAL: Errno.EINVAL,
  ENAMETOOLONG: Errno.ENAMETOOLONG,
  EBUSY: Errno.EBUSY,
  EXDEV: Errno.EXDEV,
  ENOTCAPABLE: Errno.ENOTCAPABLE,
  ENOSYS: Errno.ENOSYS,
}

/**
 * Map a thrown error to a WASI errno. Reads the typed POSIX `.code` carried by
 * our `FilesystemError` and by native `node:fs` errors. As a last-resort guard
 * for any plain `Error` whose message is `CODE: ...`, the leading token is
 * looked up too; everything else is EIO.
 */
function mapError(e: unknown): Errno {
  const code = (e as { code?: unknown })?.code
  if (typeof code === 'string') {
    const mapped = ERRNO_BY_CODE[code]
    if (mapped !== undefined) return mapped
  }
  if (e instanceof Error) {
    const prefix = /^([A-Z]+):/.exec(e.message)?.[1]
    if (prefix && ERRNO_BY_CODE[prefix] !== undefined) return ERRNO_BY_CODE[prefix]!
  }
  return Errno.EIO
}
