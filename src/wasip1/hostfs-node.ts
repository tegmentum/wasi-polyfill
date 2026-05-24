/**
 * Node.js host filesystem backend for WASI Preview 1.
 *
 * Implements the {@link Filesystem} contract on top of the synchronous `node:fs`
 * API, sandboxed to a single root directory. This gives WASIP1 components real
 * file access under Node/Deno/Bun instead of the in-memory filesystem.
 *
 * This module imports `node:fs`/`node:path` and is therefore Node-only — import
 * it explicitly (`@tegmentum/wasi-polyfill/wasip1/hostfs-node`); it is not part
 * of the main wasip1 entry, so browser bundles never pull it in.
 *
 * Security: every guest path is resolved under `rootDir` and rejected if it
 * escapes (via `..`, an absolute path, or a symlink) — the sandbox boundary.
 *
 * ```ts
 * import { createNodeFilesystem } from '@tegmentum/wasi-polyfill/wasip1/hostfs-node'
 * const wasi = new Wasip1()
 * // map preopen "/" to a real directory:
 * const fsImpl = createNodeFilesystem('/tmp/sandbox')
 * ```
 */

import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { FileType } from './types.js'
import type { Filesystem } from './path.js'
import type { FileResource, DirectoryResource } from './fd.js'

type WasiStat = ReturnType<Filesystem['stat']>

/** Convert epoch-milliseconds (possibly fractional) to nanoseconds. */
function msToNs(ms: number): bigint {
  return BigInt(Math.round(ms * 1_000_000))
}

/** Map a node `fs.Stats` to the WASI stat shape. */
function toWasiStat(st: fs.Stats): WasiStat {
  let filetype: FileType = FileType.UNKNOWN
  if (st.isDirectory()) filetype = FileType.DIRECTORY
  else if (st.isSymbolicLink()) filetype = FileType.SYMBOLIC_LINK
  else if (st.isFile()) filetype = FileType.REGULAR_FILE
  else if (st.isCharacterDevice()) filetype = FileType.CHARACTER_DEVICE

  return {
    dev: BigInt(st.dev),
    ino: BigInt(st.ino),
    filetype,
    nlink: BigInt(st.nlink),
    size: BigInt(st.size),
    atim: msToNs(st.atimeMs),
    mtim: msToNs(st.mtimeMs),
    ctim: msToNs(st.ctimeMs),
  }
}

/** Map a dirent to a WASI file type. */
function direntType(d: fs.Dirent): FileType {
  if (d.isDirectory()) return FileType.DIRECTORY
  if (d.isSymbolicLink()) return FileType.SYMBOLIC_LINK
  if (d.isCharacterDevice()) return FileType.CHARACTER_DEVICE
  return FileType.REGULAR_FILE
}

/**
 * Create a Node-backed {@link Filesystem} sandboxed to `rootDir`.
 *
 * @param rootDir - The host directory that becomes the filesystem root. Must exist.
 */
export function createNodeFilesystem(rootDir: string): Filesystem {
  const root = fs.realpathSync(nodePath.resolve(rootDir))
  const sep = nodePath.sep

  /** Reject any host path that escapes the sandbox root. */
  function assertContained(hostPath: string): void {
    if (hostPath !== root && !hostPath.startsWith(root + sep)) {
      throw new Error(`ENOTCAPABLE: path escapes sandbox root: ${hostPath}`)
    }
    // Defend against symlink escapes: realpath the deepest existing ancestor.
    let probe = hostPath
    while (probe !== root && !fs.existsSync(probe)) {
      const parent = nodePath.dirname(probe)
      if (parent === probe) break
      probe = parent
    }
    if (fs.existsSync(probe)) {
      const real = fs.realpathSync(probe)
      if (real !== root && !real.startsWith(root + sep)) {
        throw new Error(`ENOTCAPABLE: path escapes sandbox via symlink: ${hostPath}`)
      }
    }
  }

  /** Resolve a guest path to a sandbox-contained host path. */
  function toHost(wasiPath: string): string {
    const rel = wasiPath.replace(/^\/+/, '')
    const hostPath = nodePath.resolve(root, rel)
    assertContained(hostPath)
    return hostPath
  }

  function openFile(hostPath: string, options: {
    create?: boolean
    exclusive?: boolean
    truncate?: boolean
  }): FileResource {
    let flag: string
    if (options.exclusive) flag = 'wx+'
    else if (options.truncate) flag = 'w+'
    else if (options.create) flag = fs.existsSync(hostPath) ? 'r+' : 'w+'
    else flag = 'r+'

    const fd = fs.openSync(hostPath, flag)

    return {
      read(offset: bigint, len: number): Uint8Array {
        const buf = Buffer.allocUnsafe(len)
        const n = fs.readSync(fd, buf, 0, len, Number(offset))
        return Uint8Array.prototype.slice.call(buf, 0, n)
      },
      write(offset: bigint, data: Uint8Array): number {
        return fs.writeSync(fd, data, 0, data.length, Number(offset))
      },
      size(): bigint {
        return BigInt(fs.fstatSync(fd).size)
      },
      setSize(size: bigint): void {
        fs.ftruncateSync(fd, Number(size))
      },
      sync(): void {
        fs.fsyncSync(fd)
      },
      stat(): WasiStat {
        return toWasiStat(fs.fstatSync(fd))
      },
      setTimes(atim: bigint | null, mtim: bigint | null): void {
        const st = fs.fstatSync(fd)
        const atime = atim === null ? st.atimeMs / 1000 : Number(atim) / 1e9
        const mtime = mtim === null ? st.mtimeMs / 1000 : Number(mtim) / 1e9
        fs.futimesSync(fd, atime, mtime)
      },
      close(): void {
        fs.closeSync(fd)
      },
    }
  }

  function openDirectory(hostPath: string): DirectoryResource {
    const st = fs.statSync(hostPath)
    if (!st.isDirectory()) {
      throw new Error(`ENOTDIR: not a directory: ${hostPath}`)
    }
    return {
      readdir() {
        const entries = fs.readdirSync(hostPath, { withFileTypes: true })
        return entries.map((d) => {
          let ino = 0n
          try {
            ino = BigInt(fs.lstatSync(nodePath.join(hostPath, d.name)).ino)
          } catch {
            // ignore stat failures for individual entries
          }
          return { name: d.name, ino, type: direntType(d) }
        })
      },
      stat(): WasiStat {
        return toWasiStat(fs.statSync(hostPath))
      },
    }
  }

  return {
    open(path, options): FileResource | DirectoryResource {
      const hostPath = toHost(path)
      if (options.directory) {
        return openDirectory(hostPath)
      }
      return openFile(hostPath, options)
    },

    createDirectory(path): void {
      fs.mkdirSync(toHost(path))
    },

    removeDirectory(path): void {
      fs.rmdirSync(toHost(path))
    },

    unlink(path): void {
      fs.unlinkSync(toHost(path))
    },

    rename(oldPath, newPath): void {
      fs.renameSync(toHost(oldPath), toHost(newPath))
    },

    stat(path): WasiStat {
      return toWasiStat(fs.statSync(toHost(path)))
    },

    setTimes(path, atim, mtim): void {
      const hostPath = toHost(path)
      const st = fs.statSync(hostPath)
      const atime = atim === null ? st.atimeMs / 1000 : Number(atim) / 1e9
      const mtime = mtim === null ? st.mtimeMs / 1000 : Number(mtim) / 1e9
      fs.utimesSync(hostPath, atime, mtime)
    },

    symlink(target, path): void {
      // `target` is stored verbatim (link contents); containment is enforced
      // when the link is later traversed via toHost().
      fs.symlinkSync(target, toHost(path))
    },

    readlink(path): string {
      return fs.readlinkSync(toHost(path), 'utf8')
    },

    link(oldPath, newPath): void {
      fs.linkSync(toHost(oldPath), toHost(newPath))
    },
  }
}
