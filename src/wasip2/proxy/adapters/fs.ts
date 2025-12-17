/**
 * Filesystem Adapter for Proxy Server
 *
 * Handles filesystem operations from browser clients,
 * providing actual filesystem access on the server side.
 * Includes sandboxing and path validation for security.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'
import {
  MessageType,
  ErrorCode,
  FsOpenFlags,
  FsFileType,
  type FsOpenPayload,
  type FsOpenAckPayload,
  type FsReadPayload,
  type FsReadAckPayload,
  type FsWritePayload,
  type FsWriteAckPayload,
  type FsStatPayload,
  type FsStatAckPayload,
  type FsReaddirPayload,
  type FsReaddirAckPayload,
  type FsClosePayload,
  type FsUnlinkPayload,
  type FsMkdirPayload,
  type FsRmdirPayload,
  type FsRenamePayload,
  encodeString,
  decodeString,
} from '../protocol.js'
import type { StreamAdapter, ServerStream } from '../server.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Filesystem adapter configuration
 */
export interface FsAdapterConfig {
  /**
   * Root directory for all operations (sandboxed)
   * If not set, no filesystem access is allowed
   */
  rootDir?: string

  /**
   * Additional preopen directories (mapped paths)
   * Key is virtual path, value is real path
   */
  preopens?: Record<string, string>

  /**
   * Allow writes (create, modify, delete)
   * @default false
   */
  allowWrite?: boolean

  /**
   * Allow reading outside preopens (with rootDir)
   * @default false
   */
  allowReadOutsidePreopens?: boolean

  /**
   * Maximum file size for reads
   * @default 100MB
   */
  maxReadSize?: number

  /**
   * Maximum file size for writes
   * @default 100MB
   */
  maxWriteSize?: number

  /**
   * Follow symbolic links
   * @default false
   */
  followSymlinks?: boolean
}

// =============================================================================
// Stream State
// =============================================================================

interface FsStreamState {
  openFiles: Map<number, { fd: number; path: string; flags: number }>
  nextFd: number
}

// =============================================================================
// Promisified FS
// =============================================================================

const fsOpen = promisify(fs.open)
const fsClose = promisify(fs.close)
const fsRead = promisify(fs.read)
const fsWrite = promisify(fs.write)
const fsStat = promisify(fs.stat)
const fsLstat = promisify(fs.lstat)
const fsReaddir = promisify(fs.readdir)
const fsUnlink = promisify(fs.unlink)
const fsMkdir = promisify(fs.mkdir)
const fsRmdir = promisify(fs.rmdir)
const fsRename = promisify(fs.rename)
const fsRealpath = promisify(fs.realpath)

// =============================================================================
// Filesystem Adapter
// =============================================================================

/**
 * Filesystem adapter for proxy server
 */
export class FsAdapter implements StreamAdapter {
  private readonly config: Required<Omit<FsAdapterConfig, 'rootDir' | 'preopens'>> & {
    rootDir: string | null
    preopens: Record<string, string>
  }
  private readonly streamStates: Map<number, FsStreamState> = new Map()
  private readonly resolvedPreopens: Map<string, string> = new Map()

  constructor(config: FsAdapterConfig = {}) {
    this.config = {
      rootDir: config.rootDir ?? null,
      preopens: config.preopens ?? {},
      allowWrite: config.allowWrite ?? false,
      allowReadOutsidePreopens: config.allowReadOutsidePreopens ?? false,
      maxReadSize: config.maxReadSize ?? 100 * 1024 * 1024,
      maxWriteSize: config.maxWriteSize ?? 100 * 1024 * 1024,
      followSymlinks: config.followSymlinks ?? false,
    }

    // Resolve preopens to absolute paths
    for (const [virtual, real] of Object.entries(this.config.preopens)) {
      this.resolvedPreopens.set(virtual, path.resolve(real))
    }
  }

  async onOpen(stream: ServerStream, _payload: Uint8Array): Promise<void> {
    this.streamStates.set(stream.id, {
      openFiles: new Map(),
      nextFd: 3, // 0, 1, 2 reserved for stdin/stdout/stderr
    })
  }

  async onData(stream: ServerStream, data: Uint8Array): Promise<void> {
    const state = this.streamStates.get(stream.id)
    if (!state) {
      throw new Error('Unknown stream')
    }

    if (data.length === 0) {
      throw new Error('Empty payload')
    }

    const messageType = data[0] as MessageType
    const payload = data.slice(1)

    switch (messageType) {
      case MessageType.FS_OPEN:
        await this.handleOpen(stream, state, payload)
        break

      case MessageType.FS_READ:
        await this.handleRead(stream, state, payload)
        break

      case MessageType.FS_WRITE:
        await this.handleWrite(stream, state, payload)
        break

      case MessageType.FS_STAT:
        await this.handleStat(stream, state, payload)
        break

      case MessageType.FS_READDIR:
        await this.handleReaddir(stream, state, payload)
        break

      case MessageType.FS_CLOSE:
        await this.handleClose(stream, state, payload)
        break

      case MessageType.FS_UNLINK:
        await this.handleUnlink(stream, state, payload)
        break

      case MessageType.FS_MKDIR:
        await this.handleMkdir(stream, state, payload)
        break

      case MessageType.FS_RMDIR:
        await this.handleRmdir(stream, state, payload)
        break

      case MessageType.FS_RENAME:
        await this.handleRename(stream, state, payload)
        break

      default:
        throw new Error(`Unknown FS operation: ${messageType}`)
    }
  }

  async onClose(stream: ServerStream): Promise<void> {
    const state = this.streamStates.get(stream.id)
    if (state) {
      // Close all open files
      for (const file of state.openFiles.values()) {
        try {
          await fsClose(file.fd)
        } catch {
          // Ignore close errors
        }
      }
      this.streamStates.delete(stream.id)
    }
  }

  async onReset(stream: ServerStream, _error: Error): Promise<void> {
    await this.onClose(stream)
  }

  // ==========================================================================
  // Operation Handlers
  // ==========================================================================

  private async handleOpen(stream: ServerStream, state: FsStreamState, payload: Uint8Array): Promise<void> {
    const openPayload = this.decodeFsOpen(payload)

    // Validate and resolve path
    const realPath = await this.resolvePath(openPayload.path, openPayload.flags)
    if (!realPath) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Path not allowed: ${openPayload.path}`)
      return
    }

    // Check write permission
    const isWrite = (openPayload.flags & (FsOpenFlags.WRITE | FsOpenFlags.CREATE | FsOpenFlags.TRUNCATE | FsOpenFlags.APPEND)) !== 0
    if (isWrite && !this.config.allowWrite) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, 'Write access not allowed')
      return
    }

    // Convert flags
    let nodeFlags = ''
    if (openPayload.flags & FsOpenFlags.READ) nodeFlags += 'r'
    if (openPayload.flags & FsOpenFlags.WRITE) {
      if (openPayload.flags & FsOpenFlags.CREATE) {
        if (openPayload.flags & FsOpenFlags.EXCLUSIVE) {
          nodeFlags = 'wx'
        } else if (openPayload.flags & FsOpenFlags.TRUNCATE) {
          nodeFlags = 'w'
        } else if (openPayload.flags & FsOpenFlags.APPEND) {
          nodeFlags = 'a'
        } else {
          nodeFlags = 'w+'
        }
      } else {
        nodeFlags = 'r+'
      }
    }
    if (!nodeFlags) nodeFlags = 'r'

    try {
      const fd = await fsOpen(realPath, nodeFlags, openPayload.mode ?? 0o644)

      // Get file type
      const stats = await fsStat(realPath)
      let fileType = FsFileType.FILE
      if (stats.isDirectory()) fileType = FsFileType.DIRECTORY
      else if (stats.isSymbolicLink()) fileType = FsFileType.SYMLINK

      // Store file handle
      const virtualFd = state.nextFd++
      state.openFiles.set(virtualFd, { fd, path: realPath, flags: openPayload.flags })

      // Send response
      const response = this.encodeFsOpenAck({ fd: virtualFd, fileType })
      await stream['client'].sendFrame(MessageType.FS_OPEN_ACK, stream.id, response)
    } catch (error) {
      const code = this.mapNodeError(error)
      const message = error instanceof Error ? error.message : String(error)
      await stream.reset(code, message)
    }
  }

  private async handleRead(stream: ServerStream, state: FsStreamState, payload: Uint8Array): Promise<void> {
    const readPayload = this.decodeFsRead(payload)

    const file = state.openFiles.get(readPayload.fd)
    if (!file) {
      await stream.reset(ErrorCode.INVALID_ARGUMENT, `Invalid file descriptor: ${readPayload.fd}`)
      return
    }

    if (readPayload.length > this.config.maxReadSize) {
      await stream.reset(ErrorCode.INVALID_ARGUMENT, `Read size too large: ${readPayload.length}`)
      return
    }

    try {
      const buffer = Buffer.alloc(readPayload.length)
      const { bytesRead } = await fsRead(file.fd, buffer, 0, readPayload.length, Number(readPayload.offset))

      const response = this.encodeFsReadAck({
        data: new Uint8Array(buffer.subarray(0, bytesRead)),
        eof: bytesRead < readPayload.length,
      })
      await stream['client'].sendFrame(MessageType.FS_READ_ACK, stream.id, response)
    } catch (error) {
      const code = this.mapNodeError(error)
      const message = error instanceof Error ? error.message : String(error)
      await stream.reset(code, message)
    }
  }

  private async handleWrite(stream: ServerStream, state: FsStreamState, payload: Uint8Array): Promise<void> {
    if (!this.config.allowWrite) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, 'Write access not allowed')
      return
    }

    const writePayload = this.decodeFsWrite(payload)

    const file = state.openFiles.get(writePayload.fd)
    if (!file) {
      await stream.reset(ErrorCode.INVALID_ARGUMENT, `Invalid file descriptor: ${writePayload.fd}`)
      return
    }

    if (writePayload.data.length > this.config.maxWriteSize) {
      await stream.reset(ErrorCode.INVALID_ARGUMENT, `Write size too large: ${writePayload.data.length}`)
      return
    }

    try {
      const { bytesWritten } = await fsWrite(file.fd, writePayload.data, 0, writePayload.data.length, Number(writePayload.offset))

      const response = this.encodeFsWriteAck({ bytesWritten })
      await stream['client'].sendFrame(MessageType.FS_WRITE_ACK, stream.id, response)
    } catch (error) {
      const code = this.mapNodeError(error)
      const message = error instanceof Error ? error.message : String(error)
      await stream.reset(code, message)
    }
  }

  private async handleStat(stream: ServerStream, _state: FsStreamState, payload: Uint8Array): Promise<void> {
    const statPayload = this.decodeFsStat(payload)

    const realPath = await this.resolvePath(statPayload.path, FsOpenFlags.READ)
    if (!realPath) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Path not allowed: ${statPayload.path}`)
      return
    }

    try {
      const statFn = statPayload.followSymlinks ? fsStat : fsLstat
      const stats = await statFn(realPath)

      let fileType = FsFileType.FILE
      if (stats.isDirectory()) fileType = FsFileType.DIRECTORY
      else if (stats.isSymbolicLink()) fileType = FsFileType.SYMLINK

      const response = this.encodeFsStatAck({
        fileType,
        size: BigInt(stats.size),
        mtime: BigInt(Math.floor(stats.mtimeMs * 1e6)), // Convert to nanoseconds
        atime: BigInt(Math.floor(stats.atimeMs * 1e6)),
        ctime: BigInt(Math.floor(stats.ctimeMs * 1e6)),
        mode: stats.mode,
      })
      await stream['client'].sendFrame(MessageType.FS_STAT_ACK, stream.id, response)
    } catch (error) {
      const code = this.mapNodeError(error)
      const message = error instanceof Error ? error.message : String(error)
      await stream.reset(code, message)
    }
  }

  private async handleReaddir(stream: ServerStream, _state: FsStreamState, payload: Uint8Array): Promise<void> {
    const readdirPayload = this.decodeFsReaddir(payload)

    const realPath = await this.resolvePath(readdirPayload.path, FsOpenFlags.READ)
    if (!realPath) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Path not allowed: ${readdirPayload.path}`)
      return
    }

    try {
      const entries = await fsReaddir(realPath, { withFileTypes: true })

      const responseEntries: Array<{ name: string; fileType: FsFileType }> = []
      for (const entry of entries) {
        let fileType = FsFileType.FILE
        if (entry.isDirectory()) fileType = FsFileType.DIRECTORY
        else if (entry.isSymbolicLink()) fileType = FsFileType.SYMLINK

        responseEntries.push({ name: entry.name, fileType })
      }

      const response = this.encodeFsReaddirAck({ entries: responseEntries })
      await stream['client'].sendFrame(MessageType.FS_READDIR_ACK, stream.id, response)
    } catch (error) {
      const code = this.mapNodeError(error)
      const message = error instanceof Error ? error.message : String(error)
      await stream.reset(code, message)
    }
  }

  private async handleClose(_stream: ServerStream, state: FsStreamState, payload: Uint8Array): Promise<void> {
    const closePayload = this.decodeFsClose(payload)

    const file = state.openFiles.get(closePayload.fd)
    if (!file) {
      // Already closed, ignore
      return
    }

    try {
      await fsClose(file.fd)
      state.openFiles.delete(closePayload.fd)
    } catch {
      // Ignore close errors
    }
  }

  private async handleUnlink(stream: ServerStream, _state: FsStreamState, payload: Uint8Array): Promise<void> {
    if (!this.config.allowWrite) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, 'Write access not allowed')
      return
    }

    const unlinkPayload = this.decodeFsUnlink(payload)

    const realPath = await this.resolvePath(unlinkPayload.path, FsOpenFlags.WRITE)
    if (!realPath) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Path not allowed: ${unlinkPayload.path}`)
      return
    }

    try {
      await fsUnlink(realPath)
    } catch (error) {
      const code = this.mapNodeError(error)
      const message = error instanceof Error ? error.message : String(error)
      await stream.reset(code, message)
    }
  }

  private async handleMkdir(stream: ServerStream, _state: FsStreamState, payload: Uint8Array): Promise<void> {
    if (!this.config.allowWrite) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, 'Write access not allowed')
      return
    }

    const mkdirPayload = this.decodeFsMkdir(payload)

    const realPath = await this.resolvePath(mkdirPayload.path, FsOpenFlags.WRITE | FsOpenFlags.CREATE)
    if (!realPath) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Path not allowed: ${mkdirPayload.path}`)
      return
    }

    try {
      await fsMkdir(realPath, { mode: mkdirPayload.mode ?? 0o755 })
    } catch (error) {
      const code = this.mapNodeError(error)
      const message = error instanceof Error ? error.message : String(error)
      await stream.reset(code, message)
    }
  }

  private async handleRmdir(stream: ServerStream, _state: FsStreamState, payload: Uint8Array): Promise<void> {
    if (!this.config.allowWrite) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, 'Write access not allowed')
      return
    }

    const rmdirPayload = this.decodeFsRmdir(payload)

    const realPath = await this.resolvePath(rmdirPayload.path, FsOpenFlags.WRITE)
    if (!realPath) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Path not allowed: ${rmdirPayload.path}`)
      return
    }

    try {
      await fsRmdir(realPath)
    } catch (error) {
      const code = this.mapNodeError(error)
      const message = error instanceof Error ? error.message : String(error)
      await stream.reset(code, message)
    }
  }

  private async handleRename(stream: ServerStream, _state: FsStreamState, payload: Uint8Array): Promise<void> {
    if (!this.config.allowWrite) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, 'Write access not allowed')
      return
    }

    const renamePayload = this.decodeFsRename(payload)

    const oldRealPath = await this.resolvePath(renamePayload.oldPath, FsOpenFlags.WRITE)
    const newRealPath = await this.resolvePath(renamePayload.newPath, FsOpenFlags.WRITE | FsOpenFlags.CREATE)

    if (!oldRealPath || !newRealPath) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, 'Path not allowed')
      return
    }

    try {
      await fsRename(oldRealPath, newRealPath)
    } catch (error) {
      const code = this.mapNodeError(error)
      const message = error instanceof Error ? error.message : String(error)
      await stream.reset(code, message)
    }
  }

  // ==========================================================================
  // Path Resolution
  // ==========================================================================

  private async resolvePath(virtualPath: string, flags: number): Promise<string | null> {
    // Normalize the virtual path
    const normalizedPath = path.posix.normalize(virtualPath)

    // Check if it matches any preopen
    for (const [preopenPath, realBasePath] of this.resolvedPreopens) {
      if (normalizedPath === preopenPath || normalizedPath.startsWith(preopenPath + '/')) {
        const relativePath = normalizedPath.slice(preopenPath.length)
        const realPath = path.join(realBasePath, relativePath)

        // Verify the path is still within the preopen after resolution
        const resolvedRealPath = await this.safeRealpath(realPath, flags)
        if (resolvedRealPath && resolvedRealPath.startsWith(realBasePath)) {
          return resolvedRealPath
        }
        return null
      }
    }

    // If rootDir is set and readOutsidePreopens is allowed
    if (this.config.rootDir && this.config.allowReadOutsidePreopens) {
      const resolvedRoot = path.resolve(this.config.rootDir)
      const realPath = path.join(resolvedRoot, normalizedPath)

      const resolvedRealPath = await this.safeRealpath(realPath, flags)
      if (resolvedRealPath && resolvedRealPath.startsWith(resolvedRoot)) {
        return resolvedRealPath
      }
    }

    return null
  }

  private async safeRealpath(filePath: string, flags: number): Promise<string | null> {
    try {
      // For existing files, resolve the real path
      if (this.config.followSymlinks) {
        return await fsRealpath(filePath)
      }
      return filePath
    } catch (error: unknown) {
      // If file doesn't exist and we're creating, return the path as-is
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT' &&
        flags & FsOpenFlags.CREATE
      ) {
        return filePath
      }
      return null
    }
  }

  // ==========================================================================
  // Error Mapping
  // ==========================================================================

  private mapNodeError(error: unknown): ErrorCode {
    if (error && typeof error === 'object' && 'code' in error) {
      switch (error.code) {
        case 'ENOENT':
          return ErrorCode.NOT_FOUND
        case 'EEXIST':
          return ErrorCode.ALREADY_EXISTS
        case 'EACCES':
        case 'EPERM':
          return ErrorCode.PERMISSION_DENIED
        case 'EISDIR':
        case 'ENOTDIR':
        case 'EINVAL':
          return ErrorCode.INVALID_ARGUMENT
        case 'ENOSPC':
        case 'EMFILE':
        case 'ENFILE':
          return ErrorCode.RESOURCE_EXHAUSTED
        default:
          return ErrorCode.IO_ERROR
      }
    }
    return ErrorCode.INTERNAL_ERROR
  }

  // ==========================================================================
  // Payload Encoding/Decoding
  // ==========================================================================

  private decodeFsOpen(payload: Uint8Array): FsOpenPayload {
    let offset = 0
    const { value: filePath, bytesRead } = decodeString(payload, offset)
    offset += bytesRead

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const flags = view.getUint32(offset, true)
    offset += 4

    const result: FsOpenPayload = { path: filePath, flags }
    if (offset < payload.length) {
      result.mode = view.getUint32(offset, true)
    }

    return result
  }

  private decodeFsRead(payload: Uint8Array): FsReadPayload {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    return {
      fd: view.getUint32(0, true),
      offset: view.getBigUint64(4, true),
      length: view.getUint32(12, true),
    }
  }

  private decodeFsWrite(payload: Uint8Array): FsWritePayload {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const fd = view.getUint32(0, true)
    const offset = view.getBigUint64(4, true)
    const data = payload.slice(12)
    return { fd, offset, data }
  }

  private decodeFsStat(payload: Uint8Array): FsStatPayload {
    let offset = 0
    const { value: filePath, bytesRead } = decodeString(payload, offset)
    offset += bytesRead

    const followSymlinks = payload[offset] !== 0

    return { path: filePath, followSymlinks }
  }

  private decodeFsReaddir(payload: Uint8Array): FsReaddirPayload {
    const { value: filePath } = decodeString(payload, 0)
    return { path: filePath }
  }

  private decodeFsClose(payload: Uint8Array): FsClosePayload {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    return { fd: view.getUint32(0, true) }
  }

  private decodeFsUnlink(payload: Uint8Array): FsUnlinkPayload {
    const { value: filePath } = decodeString(payload, 0)
    return { path: filePath }
  }

  private decodeFsMkdir(payload: Uint8Array): FsMkdirPayload {
    let offset = 0
    const { value: filePath, bytesRead } = decodeString(payload, offset)
    offset += bytesRead

    const result: FsMkdirPayload = { path: filePath }
    if (offset < payload.length) {
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
      result.mode = view.getUint32(offset, true)
    }

    return result
  }

  private decodeFsRmdir(payload: Uint8Array): FsRmdirPayload {
    const { value: filePath } = decodeString(payload, 0)
    return { path: filePath }
  }

  private decodeFsRename(payload: Uint8Array): FsRenamePayload {
    let offset = 0
    const { value: oldPath, bytesRead: oldLen } = decodeString(payload, offset)
    offset += oldLen
    const { value: newPath } = decodeString(payload, offset)
    return { oldPath, newPath }
  }

  private encodeFsOpenAck(payload: FsOpenAckPayload): Uint8Array {
    const result = new Uint8Array(5)
    const view = new DataView(result.buffer)
    view.setUint32(0, payload.fd, true)
    view.setUint8(4, payload.fileType)
    return result
  }

  private encodeFsReadAck(payload: FsReadAckPayload): Uint8Array {
    const result = new Uint8Array(1 + payload.data.length)
    result[0] = payload.eof ? 1 : 0
    result.set(payload.data, 1)
    return result
  }

  private encodeFsWriteAck(payload: FsWriteAckPayload): Uint8Array {
    const result = new Uint8Array(4)
    const view = new DataView(result.buffer)
    view.setUint32(0, payload.bytesWritten, true)
    return result
  }

  private encodeFsStatAck(payload: FsStatAckPayload): Uint8Array {
    const result = new Uint8Array(37)
    const view = new DataView(result.buffer)
    view.setUint8(0, payload.fileType)
    view.setBigUint64(1, payload.size, true)
    view.setBigUint64(9, payload.mtime, true)
    view.setBigUint64(17, payload.atime, true)
    view.setBigUint64(25, payload.ctime, true)
    view.setUint32(33, payload.mode, true)
    return result
  }

  private encodeFsReaddirAck(payload: FsReaddirAckPayload): Uint8Array {
    // Calculate size
    let size = 4 // entry count
    const encodedNames: Uint8Array[] = []
    for (const entry of payload.entries) {
      const nameBytes = encodeString(entry.name)
      encodedNames.push(nameBytes)
      size += nameBytes.length + 1 // name + fileType
    }

    const result = new Uint8Array(size)
    const view = new DataView(result.buffer)
    view.setUint32(0, payload.entries.length, true)

    let offset = 4
    for (let i = 0; i < payload.entries.length; i++) {
      const nameBytes = encodedNames[i]!
      const entry = payload.entries[i]!
      result.set(nameBytes, offset)
      offset += nameBytes.length
      result[offset] = entry.fileType
      offset += 1
    }

    return result
  }
}

/**
 * Create a filesystem adapter
 */
export function createFsAdapter(config?: FsAdapterConfig): FsAdapter {
  return new FsAdapter(config)
}
