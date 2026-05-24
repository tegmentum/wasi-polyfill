/**
 * WASI Preview 1 in-memory filesystem
 *
 * Provides a fully in-memory filesystem implementation for WASI P1.
 * Useful for testing and sandboxed environments.
 *
 * @packageDocumentation
 */

import { FileType } from './types.js'
import type { Filesystem } from './path.js'
import type { FileResource, DirectoryResource } from './fd.js'

/**
 * Inode types for the memory filesystem.
 */
type InodeType = 'file' | 'directory' | 'symlink'

/**
 * Base inode properties.
 */
interface BaseInode {
  type: InodeType
  ino: bigint
  nlink: number
  atim: bigint
  mtim: bigint
  ctim: bigint
}

/**
 * File inode.
 */
interface FileInode extends BaseInode {
  type: 'file'
  data: Uint8Array
}

/**
 * Directory inode.
 */
interface DirectoryInode extends BaseInode {
  type: 'directory'
  entries: Map<string, bigint> // name -> ino
}

/**
 * Symbolic link inode.
 */
interface SymlinkInode extends BaseInode {
  type: 'symlink'
  target: string
}

type Inode = FileInode | DirectoryInode | SymlinkInode

/**
 * POSIX-style error codes carried by {@link FilesystemError}. These mirror
 * Node's `err.code` convention, so the WASI errno mapper can read `.code`
 * uniformly from both our errors and native `node:fs` errors.
 */
export type FsErrorCode =
  | 'ENOENT'
  | 'ENOTDIR'
  | 'EEXIST'
  | 'EINVAL'
  | 'ENOTEMPTY'
  | 'EISDIR'
  | 'EPERM'
  | 'EACCES'
  | 'EROFS'
  | 'ENAMETOOLONG'
  | 'EBUSY'
  | 'EXDEV'
  | 'ENOTCAPABLE'
  | 'ENOSYS'

/**
 * Filesystem error carrying a typed POSIX `code`. The message is composed as
 * `${code}: ${detail}` so existing message-prefix expectations still hold, but
 * consumers should branch on `.code` rather than parsing the message.
 */
export class FilesystemError extends Error {
  readonly code: FsErrorCode

  constructor(code: FsErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'FilesystemError'
    this.code = code
  }
}

/**
 * In-memory filesystem implementation.
 */
export class MemoryFilesystem implements Filesystem {
  private inodes: Map<bigint, Inode> = new Map()
  private nextIno: bigint = 1n
  private dev: bigint = 1n

  /**
   * Create a new MemoryFilesystem.
   *
   * @param options - Filesystem options
   */
  constructor(options: { dev?: bigint } = {}) {
    this.dev = options.dev ?? 1n

    // Create root directory
    const now = this.now()
    const rootInode: DirectoryInode = {
      type: 'directory',
      ino: this.allocateIno(),
      nlink: 2, // . and parent (even if root)
      atim: now,
      mtim: now,
      ctim: now,
      entries: new Map(),
    }
    this.inodes.set(rootInode.ino, rootInode)
  }

  private now(): bigint {
    return BigInt(Date.now()) * 1_000_000n
  }

  private allocateIno(): bigint {
    return this.nextIno++
  }

  private getRootIno(): bigint {
    return 1n
  }

  /**
   * Parse a path into components.
   */
  private parsePath(path: string): string[] {
    // Normalize path
    const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '')
    if (normalized === '' || normalized === '/') return []
    const withoutLeading = normalized.startsWith('/') ? normalized.slice(1) : normalized
    return withoutLeading.split('/')
  }

  /**
   * Lookup an inode by path.
   */
  private lookupInode(path: string, followSymlinks = true): Inode {
    const components = this.parsePath(path)
    let currentIno = this.getRootIno()

    for (let i = 0; i < components.length; i++) {
      const component = components[i]!
      const inode = this.inodes.get(currentIno)

      if (!inode) {
        throw new FilesystemError('ENOENT', `no such file or directory: ${path}`)
      }

      // Handle symlinks
      if (inode.type === 'symlink' && followSymlinks) {
        const target = this.resolveSymlink(inode, components.slice(0, i).join('/'))
        const resolvedInode = this.lookupInode(target + '/' + components.slice(i).join('/'), true)
        return resolvedInode
      }

      if (inode.type !== 'directory') {
        throw new FilesystemError('ENOTDIR', `not a directory: ${path}`)
      }

      const childIno = inode.entries.get(component)
      if (childIno === undefined) {
        throw new FilesystemError('ENOENT', `no such file or directory: ${path}`)
      }

      currentIno = childIno
    }

    const finalInode = this.inodes.get(currentIno)
    if (!finalInode) {
      throw new FilesystemError('ENOENT', `no such file or directory: ${path}`)
    }

    // Follow final symlink if requested
    if (finalInode.type === 'symlink' && followSymlinks) {
      const target = this.resolveSymlink(finalInode, this.parentPath(path))
      return this.lookupInode(target, true)
    }

    return finalInode
  }

  /**
   * Get the parent path.
   */
  private parentPath(path: string): string {
    const components = this.parsePath(path)
    if (components.length <= 1) return '/'
    return '/' + components.slice(0, -1).join('/')
  }

  /**
   * Get the basename of a path.
   */
  private basename(path: string): string {
    const components = this.parsePath(path)
    return components[components.length - 1] || ''
  }

  /**
   * Resolve a symlink target.
   */
  private resolveSymlink(symlink: SymlinkInode, basePath: string): string {
    if (symlink.target.startsWith('/')) {
      return symlink.target
    }
    // Relative symlink
    return basePath + '/' + symlink.target
  }

  /**
   * Lookup parent directory and ensure it exists.
   */
  private lookupParent(path: string): DirectoryInode {
    const parent = this.parentPath(path)
    const inode = this.lookupInode(parent)
    if (inode.type !== 'directory') {
      throw new FilesystemError('ENOTDIR', `not a directory: ${parent}`)
    }
    return inode
  }

  /**
   * Open a file or directory.
   */
  open(
    path: string,
    options: {
      create?: boolean
      exclusive?: boolean
      truncate?: boolean
      directory?: boolean
    }
  ): FileResource | DirectoryResource {
    const { create, exclusive, truncate, directory } = options

    let inode: Inode
    let created = false

    try {
      inode = this.lookupInode(path)

      if (exclusive && create) {
        throw new FilesystemError('EEXIST', `file already exists: ${path}`)
      }
    } catch (e) {
      if (e instanceof FilesystemError && e.code === 'ENOENT') {
        if (!create) {
          throw e
        }

        // Create the file
        const parentInode = this.lookupParent(path)
        const name = this.basename(path)
        const now = this.now()

        if (directory) {
          const newInode: DirectoryInode = {
            type: 'directory',
            ino: this.allocateIno(),
            nlink: 2,
            atim: now,
            mtim: now,
            ctim: now,
            entries: new Map(),
          }
          this.inodes.set(newInode.ino, newInode)
          parentInode.entries.set(name, newInode.ino)
          parentInode.nlink++
          parentInode.mtim = now
          inode = newInode
        } else {
          const newInode: FileInode = {
            type: 'file',
            ino: this.allocateIno(),
            nlink: 1,
            atim: now,
            mtim: now,
            ctim: now,
            data: new Uint8Array(),
          }
          this.inodes.set(newInode.ino, newInode)
          parentInode.entries.set(name, newInode.ino)
          parentInode.mtim = now
          inode = newInode
        }
        created = true
      } else {
        throw e
      }
    }

    // Check directory flag
    if (directory && inode.type !== 'directory') {
      throw new FilesystemError('ENOTDIR', `not a directory: ${path}`)
    }

    // Truncate if requested
    if (truncate && inode.type === 'file' && !created) {
      inode.data = new Uint8Array()
      inode.mtim = this.now()
    }

    // Update access time
    inode.atim = this.now()

    // Return appropriate resource
    if (inode.type === 'directory') {
      return this.createDirectoryResource(inode)
    } else if (inode.type === 'file') {
      return this.createFileResource(inode)
    } else {
      throw new FilesystemError('EINVAL', `invalid file type: ${path}`)
    }
  }

  /**
   * Create a directory.
   */
  createDirectory(path: string): void {
    try {
      this.lookupInode(path, false)
      throw new FilesystemError('EEXIST', `file already exists: ${path}`)
    } catch (e) {
      if (!(e instanceof FilesystemError && e.code === 'ENOENT')) {
        throw e
      }
    }

    const parentInode = this.lookupParent(path)
    const name = this.basename(path)

    if (!name) {
      throw new FilesystemError('EINVAL', `invalid path: ${path}`)
    }

    const now = this.now()
    const newInode: DirectoryInode = {
      type: 'directory',
      ino: this.allocateIno(),
      nlink: 2,
      atim: now,
      mtim: now,
      ctim: now,
      entries: new Map(),
    }

    this.inodes.set(newInode.ino, newInode)
    parentInode.entries.set(name, newInode.ino)
    parentInode.nlink++
    parentInode.mtim = now
  }

  /**
   * Remove a directory.
   */
  removeDirectory(path: string): void {
    const inode = this.lookupInode(path, false)

    if (inode.type !== 'directory') {
      throw new FilesystemError('ENOTDIR', `not a directory: ${path}`)
    }

    if (inode.entries.size > 0) {
      throw new FilesystemError('ENOTEMPTY', `directory not empty: ${path}`)
    }

    const parentInode = this.lookupParent(path)
    const name = this.basename(path)

    parentInode.entries.delete(name)
    parentInode.nlink--
    parentInode.mtim = this.now()
    this.inodes.delete(inode.ino)
  }

  /**
   * Unlink (delete) a file.
   */
  unlink(path: string): void {
    const inode = this.lookupInode(path, false)

    if (inode.type === 'directory') {
      throw new FilesystemError('EISDIR', `is a directory: ${path}`)
    }

    const parentInode = this.lookupParent(path)
    const name = this.basename(path)

    parentInode.entries.delete(name)
    parentInode.mtim = this.now()

    inode.nlink--
    if (inode.nlink === 0) {
      this.inodes.delete(inode.ino)
    }
  }

  /**
   * Rename a file or directory.
   */
  rename(oldPath: string, newPath: string): void {
    const inode = this.lookupInode(oldPath, false)
    const oldParent = this.lookupParent(oldPath)
    const oldName = this.basename(oldPath)

    let newParent: DirectoryInode
    let newName: string

    try {
      // Check if target exists
      const targetInode = this.lookupInode(newPath, false)

      // If target is a directory and source is a file, error
      if (targetInode.type === 'directory' && inode.type !== 'directory') {
        throw new FilesystemError('EISDIR', `is a directory: ${newPath}`)
      }

      // If target is a file and source is a directory, error
      if (targetInode.type !== 'directory' && inode.type === 'directory') {
        throw new FilesystemError('ENOTDIR', `not a directory: ${newPath}`)
      }

      // If target is non-empty directory, error
      if (targetInode.type === 'directory' && targetInode.entries.size > 0) {
        throw new FilesystemError('ENOTEMPTY', `directory not empty: ${newPath}`)
      }

      // Remove target
      newParent = this.lookupParent(newPath)
      newName = this.basename(newPath)
      this.inodes.delete(targetInode.ino)
    } catch (e) {
      if (!(e instanceof FilesystemError && e.code === 'ENOENT')) {
        throw e
      }
      newParent = this.lookupParent(newPath)
      newName = this.basename(newPath)
    }

    // Update entries
    oldParent.entries.delete(oldName)
    newParent.entries.set(newName, inode.ino)

    const now = this.now()
    oldParent.mtim = now
    newParent.mtim = now
    inode.ctim = now

    // Update nlink for directories
    if (inode.type === 'directory' && oldParent !== newParent) {
      oldParent.nlink--
      newParent.nlink++
    }
  }

  /**
   * Get file/directory stats.
   */
  stat(path: string): {
    dev: bigint
    ino: bigint
    filetype: FileType
    nlink: bigint
    size: bigint
    atim: bigint
    mtim: bigint
    ctim: bigint
  } {
    const inode = this.lookupInode(path)

    let filetype: FileType
    let size: bigint

    switch (inode.type) {
      case 'file':
        filetype = FileType.REGULAR_FILE
        size = BigInt(inode.data.length)
        break
      case 'directory':
        filetype = FileType.DIRECTORY
        size = BigInt(inode.entries.size)
        break
      case 'symlink':
        filetype = FileType.SYMBOLIC_LINK
        size = BigInt(inode.target.length)
        break
    }

    return {
      dev: this.dev,
      ino: inode.ino,
      filetype,
      nlink: BigInt(inode.nlink),
      size,
      atim: inode.atim,
      mtim: inode.mtim,
      ctim: inode.ctim,
    }
  }

  /**
   * Set file/directory times.
   */
  setTimes(path: string, atim: bigint | null, mtim: bigint | null): void {
    const inode = this.lookupInode(path)

    if (atim !== null) {
      inode.atim = atim
    }
    if (mtim !== null) {
      inode.mtim = mtim
    }
    inode.ctim = this.now()
  }

  /**
   * Create a symbolic link.
   */
  symlink(target: string, path: string): void {
    try {
      this.lookupInode(path, false)
      throw new FilesystemError('EEXIST', `file already exists: ${path}`)
    } catch (e) {
      if (!(e instanceof FilesystemError && e.code === 'ENOENT')) {
        throw e
      }
    }

    const parentInode = this.lookupParent(path)
    const name = this.basename(path)

    const now = this.now()
    const newInode: SymlinkInode = {
      type: 'symlink',
      ino: this.allocateIno(),
      nlink: 1,
      atim: now,
      mtim: now,
      ctim: now,
      target,
    }

    this.inodes.set(newInode.ino, newInode)
    parentInode.entries.set(name, newInode.ino)
    parentInode.mtim = now
  }

  /**
   * Read a symbolic link.
   */
  readlink(path: string): string {
    const inode = this.lookupInode(path, false)

    if (inode.type !== 'symlink') {
      throw new FilesystemError('EINVAL', `not a symbolic link: ${path}`)
    }

    return inode.target
  }

  /**
   * Create a hard link.
   */
  link(oldPath: string, newPath: string): void {
    const inode = this.lookupInode(oldPath)

    if (inode.type === 'directory') {
      throw new FilesystemError('EPERM', `operation not permitted (hard links to directories): ${oldPath}`)
    }

    try {
      this.lookupInode(newPath, false)
      throw new FilesystemError('EEXIST', `file already exists: ${newPath}`)
    } catch (e) {
      if (!(e instanceof FilesystemError && e.code === 'ENOENT')) {
        throw e
      }
    }

    const parentInode = this.lookupParent(newPath)
    const name = this.basename(newPath)

    parentInode.entries.set(name, inode.ino)
    parentInode.mtim = this.now()
    inode.nlink++
    inode.ctim = this.now()
  }

  /**
   * Create a FileResource for a file inode.
   */
  private createFileResource(inode: FileInode): FileResource {
    return {
      read: (offset: bigint, len: number): Uint8Array => {
        const start = Number(offset)
        if (start >= inode.data.length) return new Uint8Array()
        const end = Math.min(start + len, inode.data.length)
        inode.atim = this.now()
        return inode.data.slice(start, end)
      },

      write: (offset: bigint, data: Uint8Array): number => {
        const start = Number(offset)
        const end = start + data.length

        if (end > inode.data.length) {
          const newData = new Uint8Array(end)
          newData.set(inode.data)
          inode.data = newData
        }

        inode.data.set(data, start)
        inode.mtim = this.now()
        return data.length
      },

      size: (): bigint => {
        return BigInt(inode.data.length)
      },

      setSize: (size: bigint): void => {
        const newSize = Number(size)
        const newData = new Uint8Array(newSize)
        newData.set(inode.data.slice(0, Math.min(inode.data.length, newSize)))
        inode.data = newData
        inode.mtim = this.now()
        inode.ctim = this.now()
      },

      sync: (): void => {
        // No-op for memory filesystem
      },

      stat: () => ({
        dev: this.dev,
        ino: inode.ino,
        filetype: FileType.REGULAR_FILE,
        nlink: BigInt(inode.nlink),
        size: BigInt(inode.data.length),
        atim: inode.atim,
        mtim: inode.mtim,
        ctim: inode.ctim,
      }),

      setTimes: (atim: bigint | null, mtim: bigint | null): void => {
        if (atim !== null) inode.atim = atim
        if (mtim !== null) inode.mtim = mtim
        inode.ctim = this.now()
      },
    }
  }

  /**
   * Create a DirectoryResource for a directory inode.
   */
  private createDirectoryResource(inode: DirectoryInode): DirectoryResource {
    return {
      readdir: (): Array<{ name: string; ino: bigint; type: FileType }> => {
        const entries: Array<{ name: string; ino: bigint; type: FileType }> = []

        for (const [name, ino] of inode.entries) {
          const childInode = this.inodes.get(ino)
          if (!childInode) continue

          let type: FileType
          switch (childInode.type) {
            case 'file':
              type = FileType.REGULAR_FILE
              break
            case 'directory':
              type = FileType.DIRECTORY
              break
            case 'symlink':
              type = FileType.SYMBOLIC_LINK
              break
          }

          entries.push({ name, ino, type })
        }

        inode.atim = this.now()
        return entries
      },

      stat: () => ({
        dev: this.dev,
        ino: inode.ino,
        filetype: FileType.DIRECTORY,
        nlink: BigInt(inode.nlink),
        size: BigInt(inode.entries.size),
        atim: inode.atim,
        mtim: inode.mtim,
        ctim: inode.ctim,
      }),
    }
  }

  // Utility methods for testing and debugging

  /**
   * Check if a path exists.
   */
  exists(path: string): boolean {
    try {
      this.lookupInode(path)
      return true
    } catch {
      return false
    }
  }

  /**
   * Read a file as a string.
   */
  readFileSync(path: string): string {
    const inode = this.lookupInode(path)
    if (inode.type !== 'file') {
      throw new FilesystemError('EISDIR', `is a directory: ${path}`)
    }
    return new TextDecoder().decode(inode.data)
  }

  /**
   * Write a string to a file.
   */
  writeFileSync(path: string, content: string): void {
    let inode: FileInode

    try {
      const existingInode = this.lookupInode(path)
      if (existingInode.type !== 'file') {
        throw new FilesystemError('EISDIR', `is a directory: ${path}`)
      }
      inode = existingInode
    } catch (e) {
      if (!(e instanceof FilesystemError && e.code === 'ENOENT')) {
        throw e
      }

      // Create new file
      const parentInode = this.lookupParent(path)
      const name = this.basename(path)
      const now = this.now()

      inode = {
        type: 'file',
        ino: this.allocateIno(),
        nlink: 1,
        atim: now,
        mtim: now,
        ctim: now,
        data: new Uint8Array(),
      }

      this.inodes.set(inode.ino, inode)
      parentInode.entries.set(name, inode.ino)
      parentInode.mtim = now
    }

    inode.data = new TextEncoder().encode(content)
    inode.mtim = this.now()
  }

  /**
   * List directory contents.
   */
  readdirSync(path: string): string[] {
    const inode = this.lookupInode(path)
    if (inode.type !== 'directory') {
      throw new FilesystemError('ENOTDIR', `not a directory: ${path}`)
    }
    return Array.from(inode.entries.keys())
  }
}
