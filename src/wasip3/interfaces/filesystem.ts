/**
 * WASI Filesystem 0.3.0 interface
 *
 * P3 filesystem uses async operations instead of pollables.
 *
 * @packageDocumentation
 */

import type { Stream, StreamWriter, StreamReadResult } from '../types.js'
import type { ErrorContext } from '../types.js'
import { mapErrorToCode } from './io.js'

/**
 * File descriptor flags.
 */
export enum DescriptorFlags {
  READ = 1 << 0,
  WRITE = 1 << 1,
  FILE_INTEGRITY_SYNC = 1 << 2,
  DATA_INTEGRITY_SYNC = 1 << 3,
  REQUESTED_WRITE_SYNC = 1 << 4,
  MUTATE_DIRECTORY = 1 << 5,
}

/**
 * Descriptor type.
 */
export enum DescriptorType {
  UNKNOWN = 0,
  BLOCK_DEVICE = 1,
  CHARACTER_DEVICE = 2,
  DIRECTORY = 3,
  FIFO = 4,
  SYMBOLIC_LINK = 5,
  REGULAR_FILE = 6,
  SOCKET = 7,
}

/**
 * File status.
 */
export interface DescriptorStat {
  type: DescriptorType
  linkCount: bigint
  size: bigint
  dataAccessTimestamp?: { seconds: bigint; nanoseconds: number }
  dataModificationTimestamp?: { seconds: bigint; nanoseconds: number }
  statusChangeTimestamp?: { seconds: bigint; nanoseconds: number }
}

/**
 * Directory entry.
 */
export interface DirectoryEntry {
  type: DescriptorType
  name: string
}

/**
 * In-memory file.
 */
interface MemFile {
  type: 'file'
  data: Uint8Array
  flags: DescriptorFlags
  created: number
  modified: number
  accessed: number
}

/**
 * In-memory directory.
 */
interface MemDirectory {
  type: 'directory'
  entries: Map<string, string> // name -> full path
  created: number
  modified: number
  accessed: number
}

type MemNode = MemFile | MemDirectory

/**
 * In-memory filesystem for P3.
 */
export class InMemoryFilesystem {
  private nodes: Map<string, MemNode> = new Map()
  private nextHandle = 1
  private openDescriptors: Map<number, { path: string; offset: bigint; flags: DescriptorFlags }> = new Map()

  constructor() {
    // Create root directory
    this.nodes.set('/', {
      type: 'directory',
      entries: new Map(),
      created: Date.now(),
      modified: Date.now(),
      accessed: Date.now(),
    })
  }

  /**
   * Normalize a path.
   */
  private normalizePath(path: string): string {
    // Remove trailing slashes except for root
    let normalized = path.replace(/\/+/g, '/')
    if (normalized !== '/' && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1)
    }
    return normalized || '/'
  }

  /**
   * Get parent directory path.
   */
  private parentPath(path: string): string {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return '/'
    const lastSlash = normalized.lastIndexOf('/')
    return lastSlash === 0 ? '/' : normalized.slice(0, lastSlash)
  }

  /**
   * Get basename of a path.
   */
  private basename(path: string): string {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return ''
    const lastSlash = normalized.lastIndexOf('/')
    return normalized.slice(lastSlash + 1)
  }

  /**
   * Create a file.
   */
  async createFile(path: string, data: Uint8Array = new Uint8Array()): Promise<void> {
    const normalized = this.normalizePath(path)
    const parent = this.parentPath(normalized)
    const parentNode = this.nodes.get(parent)

    if (!parentNode || parentNode.type !== 'directory') {
      throw new Error('Parent directory does not exist')
    }

    const now = Date.now()
    this.nodes.set(normalized, {
      type: 'file',
      data,
      flags: DescriptorFlags.READ | DescriptorFlags.WRITE,
      created: now,
      modified: now,
      accessed: now,
    })

    parentNode.entries.set(this.basename(normalized), normalized)
    parentNode.modified = now
  }

  /**
   * Create a directory.
   */
  async createDirectory(path: string): Promise<void> {
    const normalized = this.normalizePath(path)
    const parent = this.parentPath(normalized)
    const parentNode = this.nodes.get(parent)

    if (!parentNode || parentNode.type !== 'directory') {
      throw new Error('Parent directory does not exist')
    }

    if (this.nodes.has(normalized)) {
      throw new Error('Path already exists')
    }

    const now = Date.now()
    this.nodes.set(normalized, {
      type: 'directory',
      entries: new Map(),
      created: now,
      modified: now,
      accessed: now,
    })

    parentNode.entries.set(this.basename(normalized), normalized)
    parentNode.modified = now
  }

  /**
   * Open a file or directory.
   */
  async open(path: string, flags: DescriptorFlags): Promise<number> {
    const normalized = this.normalizePath(path)
    const node = this.nodes.get(normalized)

    if (!node) {
      throw new Error('File not found')
    }

    const handle = this.nextHandle++
    this.openDescriptors.set(handle, {
      path: normalized,
      offset: 0n,
      flags,
    })

    node.accessed = Date.now()
    return handle
  }

  /**
   * Read from a file (async).
   */
  async read(handle: number, length: bigint, offset: bigint): Promise<[Uint8Array, boolean]> {
    const descriptor = this.openDescriptors.get(handle)
    if (!descriptor) {
      throw new Error('Invalid descriptor')
    }

    const node = this.nodes.get(descriptor.path)
    if (!node || node.type !== 'file') {
      throw new Error('Not a file')
    }

    const start = Number(offset)
    const end = Math.min(start + Number(length), node.data.length)
    const data = node.data.slice(start, end)
    const eof = end >= node.data.length

    node.accessed = Date.now()
    return [data, eof]
  }

  /**
   * Write to a file (async).
   */
  async write(handle: number, data: Uint8Array, offset: bigint): Promise<bigint> {
    const descriptor = this.openDescriptors.get(handle)
    if (!descriptor) {
      throw new Error('Invalid descriptor')
    }

    const node = this.nodes.get(descriptor.path)
    if (!node || node.type !== 'file') {
      throw new Error('Not a file')
    }

    const start = Number(offset)
    const end = start + data.length

    // Expand file if needed
    if (end > node.data.length) {
      const newData = new Uint8Array(end)
      newData.set(node.data)
      node.data = newData
    }

    node.data.set(data, start)
    node.modified = Date.now()

    return BigInt(data.length)
  }

  /**
   * Get file/directory stat.
   */
  async stat(handle: number): Promise<DescriptorStat> {
    const descriptor = this.openDescriptors.get(handle)
    if (!descriptor) {
      throw new Error('Invalid descriptor')
    }

    const node = this.nodes.get(descriptor.path)
    if (!node) {
      throw new Error('Not found')
    }

    const toTimestamp = (ms: number) => ({
      seconds: BigInt(Math.floor(ms / 1000)),
      nanoseconds: (ms % 1000) * 1_000_000,
    })

    if (node.type === 'file') {
      return {
        type: DescriptorType.REGULAR_FILE,
        linkCount: 1n,
        size: BigInt(node.data.length),
        dataAccessTimestamp: toTimestamp(node.accessed),
        dataModificationTimestamp: toTimestamp(node.modified),
        statusChangeTimestamp: toTimestamp(node.modified),
      }
    } else {
      return {
        type: DescriptorType.DIRECTORY,
        linkCount: BigInt(node.entries.size + 2), // . and ..
        size: 0n,
        dataAccessTimestamp: toTimestamp(node.accessed),
        dataModificationTimestamp: toTimestamp(node.modified),
        statusChangeTimestamp: toTimestamp(node.modified),
      }
    }
  }

  /**
   * Read directory entries as a stream.
   */
  readDirectory(handle: number): Stream<DirectoryEntry> {
    const descriptor = this.openDescriptors.get(handle)
    if (!descriptor) {
      throw new Error('Invalid descriptor')
    }

    const node = this.nodes.get(descriptor.path)
    if (!node || node.type !== 'directory') {
      throw new Error('Not a directory')
    }

    const entries: DirectoryEntry[] = []
    for (const [name, path] of node.entries) {
      const child = this.nodes.get(path)
      entries.push({
        type: child?.type === 'directory' ? DescriptorType.DIRECTORY : DescriptorType.REGULAR_FILE,
        name,
      })
    }

    let index = 0
    return {
      async read(): Promise<StreamReadResult<DirectoryEntry>> {
        if (index >= entries.length) {
          return { status: 'end' }
        }
        const batch = entries.slice(index, index + 100)
        index += batch.length
        return { status: 'values', values: batch }
      },
      close() {
        index = entries.length
      },
      cancel() {
        index = entries.length
      },
    }
  }

  /**
   * Close a descriptor.
   */
  close(handle: number): void {
    this.openDescriptors.delete(handle)
  }

  /**
   * Remove a file.
   */
  async removeFile(path: string): Promise<void> {
    const normalized = this.normalizePath(path)
    const node = this.nodes.get(normalized)

    if (!node) {
      throw new Error('File not found')
    }

    if (node.type !== 'file') {
      throw new Error('Not a file')
    }

    const parent = this.parentPath(normalized)
    const parentNode = this.nodes.get(parent) as MemDirectory | undefined

    this.nodes.delete(normalized)
    if (parentNode) {
      parentNode.entries.delete(this.basename(normalized))
      parentNode.modified = Date.now()
    }
  }

  /**
   * Remove a directory.
   */
  async removeDirectory(path: string): Promise<void> {
    const normalized = this.normalizePath(path)
    const node = this.nodes.get(normalized)

    if (!node) {
      throw new Error('Directory not found')
    }

    if (node.type !== 'directory') {
      throw new Error('Not a directory')
    }

    if (node.entries.size > 0) {
      throw new Error('Directory not empty')
    }

    const parent = this.parentPath(normalized)
    const parentNode = this.nodes.get(parent) as MemDirectory | undefined

    this.nodes.delete(normalized)
    if (parentNode) {
      parentNode.entries.delete(this.basename(normalized))
      parentNode.modified = Date.now()
    }
  }
}

/**
 * Get the wasi:filesystem@0.3.0 imports.
 *
 * @param fs - Filesystem implementation
 * @param preopens - Preopened directories
 * @returns Import object for wasi:filesystem@0.3.0
 */
export function getFilesystemImports(
  fs: InMemoryFilesystem = new InMemoryFilesystem(),
  preopens: Record<string, string> = {}
): Record<string, unknown> {
  // Pre-open directories
  const preopenHandles: Array<[number, string]> = []
  for (const [guestPath, hostPath] of Object.entries(preopens)) {
    fs.createDirectory(hostPath).catch(() => {})
    fs.open(hostPath, DescriptorFlags.READ | DescriptorFlags.MUTATE_DIRECTORY)
      .then((handle) => {
        preopenHandles.push([handle, guestPath])
      })
      .catch(() => {})
  }

  return {
    'wasi:filesystem/types@0.3.0': {
      // Descriptor methods
      '[method]descriptor.read-via-stream': (handle: number, _offset: bigint): Stream<Uint8Array> => {
        let position = 0n
        return {
          async read() {
            try {
              const [data, eof] = await fs.read(handle, 4096n, position)
              position += BigInt(data.length)
              if (data.length === 0 && eof) {
                return { status: 'end' }
              }
              return { status: 'values', values: [data] }
            } catch {
              return { status: 'end' }
            }
          },
          close() {},
          cancel() {},
        }
      },

      '[method]descriptor.write-via-stream': (handle: number, _offset: bigint): StreamWriter<Uint8Array> => {
        let position = 0n
        return {
          async write(values) {
            try {
              for (const data of values) {
                await fs.write(handle, data, position)
                position += BigInt(data.length)
              }
              return { status: 'ok', count: values.length }
            } catch {
              return { status: 'closed' }
            }
          },
          close() {},
          cancel() {},
        }
      },

      // Async read/write (P3 specific)
      '[method]descriptor.read': async (handle: number, len: bigint, offset: bigint): Promise<[Uint8Array, boolean]> => {
        return fs.read(handle, len, offset)
      },

      '[method]descriptor.write': async (handle: number, buffer: Uint8Array, offset: bigint): Promise<bigint> => {
        return fs.write(handle, buffer, offset)
      },

      '[method]descriptor.stat': async (handle: number): Promise<DescriptorStat> => {
        return fs.stat(handle)
      },

      '[method]descriptor.read-directory': (handle: number): Stream<DirectoryEntry> => {
        return fs.readDirectory(handle)
      },

      '[resource-drop]descriptor': (handle: number): void => {
        fs.close(handle)
      },

      // Error handling
      'filesystem-error-code': (err: ErrorContext): number => {
        return mapErrorToCode(new Error(err.getDebugMessage()))
      },
    },

    'wasi:filesystem/preopens@0.3.0': {
      'get-directories': (): Array<[number, string]> => {
        return preopenHandles
      },
    },
  }
}
