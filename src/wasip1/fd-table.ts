/**
 * WASI Preview 1 file descriptor table
 *
 * Manages the mapping from integer file descriptors to underlying resources.
 * WASI P1 uses integer file descriptors (like POSIX) rather than typed handles.
 *
 * @packageDocumentation
 */

import {
  FileType,
  STDIN_RIGHTS,
  STDOUT_RIGHTS,
  DIRECTORY_RIGHTS,
  FILE_RIGHTS,
  ALL_RIGHTS,
  type FdFlags,
} from './types.js'

/**
 * Type of file descriptor entry.
 */
export type FdType = 'stdin' | 'stdout' | 'stderr' | 'file' | 'directory' | 'socket'

/**
 * A file descriptor table entry.
 */
/**
 * A directory listing snapshot cached on a directory fd so paged `fd_readdir`
 * calls don't re-read (and re-encode) the whole directory on every page.
 * Names are pre-encoded to bytes. Refreshed when enumeration restarts at
 * cookie 0.
 */
export interface ReaddirSnapshot {
  entries: Array<{ ino: bigint; type: FileType; nameBytes: Uint8Array }>
}

export interface FdEntry {
  /** Type of this file descriptor */
  type: FdType
  /** File type constant */
  filetype: FileType
  /** Rights for this file descriptor */
  rights: {
    base: bigint
    inheriting: bigint
  }
  /** File descriptor flags */
  flags: FdFlags
  /** Path for files/directories */
  path?: string
  /** Preopen path if this is a preopen */
  preopen?: string
  /** Current position for seekable descriptors */
  position: bigint
  /** Underlying resource (varies by type) */
  resource?: unknown
  /** Cached directory snapshot for paged fd_readdir (directories only). */
  readdirCache?: ReaddirSnapshot
}

/**
 * Creates a stdin file descriptor entry.
 */
export function createStdinEntry(resource?: unknown): FdEntry {
  return {
    type: 'stdin',
    filetype: FileType.CHARACTER_DEVICE,
    rights: {
      base: STDIN_RIGHTS,
      inheriting: 0n,
    },
    flags: 0,
    position: 0n,
    resource,
  }
}

/**
 * Creates a stdout file descriptor entry.
 */
export function createStdoutEntry(resource?: unknown): FdEntry {
  return {
    type: 'stdout',
    filetype: FileType.CHARACTER_DEVICE,
    rights: {
      base: STDOUT_RIGHTS,
      inheriting: 0n,
    },
    flags: 0,
    position: 0n,
    resource,
  }
}

/**
 * Creates a stderr file descriptor entry.
 */
export function createStderrEntry(resource?: unknown): FdEntry {
  return {
    type: 'stderr',
    filetype: FileType.CHARACTER_DEVICE,
    rights: {
      base: STDOUT_RIGHTS,
      inheriting: 0n,
    },
    flags: 0,
    position: 0n,
    resource,
  }
}

/**
 * Creates a directory file descriptor entry.
 */
export function createDirectoryEntry(
  path: string,
  preopen?: string,
  resource?: unknown
): FdEntry {
  const entry: FdEntry = {
    type: 'directory',
    filetype: FileType.DIRECTORY,
    rights: {
      base: DIRECTORY_RIGHTS,
      inheriting: ALL_RIGHTS,
    },
    flags: 0,
    path,
    position: 0n,
  }
  if (preopen !== undefined) {
    entry.preopen = preopen
  }
  if (resource !== undefined) {
    entry.resource = resource
  }
  return entry
}

/**
 * Creates a file file descriptor entry.
 */
export function createFileEntry(
  path: string,
  flags: FdFlags,
  rights?: { base: bigint; inheriting: bigint },
  resource?: unknown
): FdEntry {
  return {
    type: 'file',
    filetype: FileType.REGULAR_FILE,
    rights: rights ?? {
      base: FILE_RIGHTS,
      inheriting: 0n,
    },
    flags,
    path,
    position: 0n,
    resource,
  }
}

/**
 * Manages file descriptors for WASI Preview 1.
 */
export class FileDescriptorTable {
  private fds: Map<number, FdEntry> = new Map()
  private nextFd: number = 3 // Start after stdio

  /**
   * Initialize stdio file descriptors (0, 1, 2).
   */
  initStdio(stdin: FdEntry, stdout: FdEntry, stderr: FdEntry): void {
    this.fds.set(0, stdin)
    this.fds.set(1, stdout)
    this.fds.set(2, stderr)
  }

  /**
   * Allocate a new file descriptor.
   * Returns the allocated fd number.
   */
  allocate(entry: FdEntry): number {
    const fd = this.nextFd++
    this.fds.set(fd, entry)
    return fd
  }

  /**
   * Allocate a specific file descriptor number.
   * Used for preopens which need specific fd numbers.
   */
  allocateAt(fd: number, entry: FdEntry): void {
    this.fds.set(fd, entry)
    if (fd >= this.nextFd) {
      this.nextFd = fd + 1
    }
  }

  /**
   * Get a file descriptor entry.
   */
  get(fd: number): FdEntry | undefined {
    return this.fds.get(fd)
  }

  /**
   * Check if a file descriptor exists.
   */
  has(fd: number): boolean {
    return this.fds.has(fd)
  }

  /**
   * Update a file descriptor entry.
   */
  set(fd: number, entry: FdEntry): void {
    this.fds.set(fd, entry)
  }

  /**
   * Close a file descriptor.
   * Returns true if the fd existed and was closed.
   */
  close(fd: number): boolean {
    return this.fds.delete(fd)
  }

  /**
   * Renumber a file descriptor (like dup2).
   * Moves `from` to `to`, closing `to` if it exists.
   * Returns true if successful.
   */
  renumber(from: number, to: number): boolean {
    const entry = this.fds.get(from)
    if (!entry) {
      return false
    }
    this.fds.delete(from)
    this.fds.set(to, entry)
    return true
  }

  /**
   * Get all preopen directories.
   * Returns array of {fd, path} for each preopen.
   */
  getPreopens(): Array<{ fd: number; path: string }> {
    const result: Array<{ fd: number; path: string }> = []
    for (const [fd, entry] of this.fds) {
      if (entry.preopen !== undefined) {
        result.push({ fd, path: entry.preopen })
      }
    }
    return result
  }

  /**
   * Find the first preopen that contains the given path.
   */
  findPreopenForPath(path: string): { fd: number; entry: FdEntry } | undefined {
    for (const [fd, entry] of this.fds) {
      if (entry.preopen !== undefined) {
        // Check if path starts with this preopen
        if (path === entry.preopen || path.startsWith(entry.preopen + '/')) {
          return { fd, entry }
        }
        // Handle root preopen
        if (entry.preopen === '/' || entry.preopen === '.') {
          return { fd, entry }
        }
      }
    }
    return undefined
  }

  /**
   * Check if an fd has the required rights.
   */
  hasRights(fd: number, requiredRights: bigint): boolean {
    const entry = this.fds.get(fd)
    if (!entry) {
      return false
    }
    return (entry.rights.base & requiredRights) === requiredRights
  }

  /**
   * Get all file descriptors.
   */
  entries(): IterableIterator<[number, FdEntry]> {
    return this.fds.entries()
  }

  /**
   * Get the count of open file descriptors.
   */
  get size(): number {
    return this.fds.size
  }
}
