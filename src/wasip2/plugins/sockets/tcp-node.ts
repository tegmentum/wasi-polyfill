/**
 * Node-native TCP backend for wasi:sockets/tcp and wasi:sockets/tcp-create-socket.
 *
 * Where `virtual` returns NotSupported and `tunneled` relays through a
 * WebSocket gateway, this backend uses Node's `net` module for real TCP egress
 * — no gateway, no JSPI. It is the `node` implementation of the TCP plugins,
 * selectable via `registerPlugin(tcpPlugin, { implementation: 'node' })`.
 *
 * `net` is imported dynamically (and only when a connection is actually made) so
 * this module stays free of a static Node dependency and is safe to include in
 * browser bundles, where the `node` implementation simply is never selected.
 *
 * Reads are non-blocking: incoming bytes are buffered as they arrive, and
 * `input-stream.read` drains the buffer immediately. Because a synchronous guest
 * call freezes the JS event loop, sockets only make progress *between* guest
 * calls — a non-blocking caller (poll/read, yielding between calls) works
 * without JSPI; a guest that hard-blocks inside one call would need it.
 */

import type { Socket } from 'node:net'
import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { HandleRegistry } from '../../../shared/registry.js'
import {
  PollableRegistry,
  globalPollableRegistry,
  createReadyPollable,
} from '../io/pollable.js'
import { globalStreamRegistry, type InputStream, type OutputStream } from '../io/streams.js'
import { NetworkErrorCode } from './types.js'

/** Dynamically load Node's `net`, defeating static bundler analysis. */
async function loadNet(): Promise<typeof import('node:net')> {
  const specifier = 'node:net'
  return import(/* @vite-ignore */ specifier)
}

/** A FIFO byte buffer with a promise that resolves when data arrives or it closes. */
class RxQueue {
  private chunks: Uint8Array[] = []
  closed = false
  error?: Error
  private waiters: Array<() => void> = []

  get isEmpty(): boolean {
    return this.chunks.length === 0
  }

  push(chunk: Uint8Array): void {
    this.chunks.push(chunk)
    this.wake()
  }

  close(error?: Error): void {
    this.closed = true
    if (error) this.error = error
    this.wake()
  }

  /** Drain up to `len` bytes without blocking. Returns an empty array if none. */
  read(len: number): Uint8Array {
    if (this.chunks.length === 0 || len <= 0) return new Uint8Array(0)
    const parts: Uint8Array[] = []
    let total = 0
    while (this.chunks.length > 0 && total < len) {
      const head = this.chunks[0]!
      const take = Math.min(head.length, len - total)
      if (take === head.length) {
        parts.push(head)
        this.chunks.shift()
      } else {
        parts.push(head.subarray(0, take))
        this.chunks[0] = head.subarray(take)
      }
      total += take
    }
    const out = new Uint8Array(total)
    let off = 0
    for (const p of parts) {
      out.set(p, off)
      off += p.length
    }
    return out
  }

  waitForData(): Promise<void> {
    if (this.chunks.length > 0 || this.closed) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w()
  }
}

type SocketState = 'new' | 'connecting' | 'connected' | 'closed'

interface NodeTcpSocket {
  handle: number
  state: SocketState
  family: 'ipv4' | 'ipv6'
  remoteHost?: string
  remotePort?: number
  sock?: Socket
  rx: RxQueue
  inputStreamHandle?: number
  outputStreamHandle?: number
  connectPromise?: Promise<void>
  connectResult?:
    | { tag: 'ok'; val: [number, number] }
    | { tag: 'err'; val: NetworkErrorCode }
}

class NodeTcpSocketRegistry extends HandleRegistry<NodeTcpSocket> {
  override register(socket: NodeTcpSocket): number {
    const handle = super.register(socket)
    socket.handle = handle
    return handle
  }

  override drop(handle: number): boolean {
    const socket = this.get(handle)
    if (socket?.sock) socket.sock.destroy()
    if (socket) socket.state = 'closed'
    return super.drop(handle)
  }
}

const globalNodeTcpSocketRegistry = new NodeTcpSocketRegistry()

class NodeInputStream implements InputStream {
  handle = 0
  private closed = false
  constructor(private readonly socket: NodeTcpSocket) {}

  isClosed(): boolean {
    if (this.closed) return true
    return this.socket.rx.closed && this.socket.rx.isEmpty
  }

  close(): void {
    this.closed = true
  }

  read(len: bigint): Uint8Array | { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } {
    if (this.closed) return { tag: 'closed' }
    const data = this.socket.rx.read(Number(len))
    if (data.length === 0 && this.socket.rx.closed) {
      return this.socket.rx.error
        ? { tag: 'last-operation-failed', val: this.socket.rx.error }
        : { tag: 'closed' }
    }
    return data
  }

  async blockingRead(
    len: bigint
  ): Promise<Uint8Array | { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error }> {
    await this.socket.rx.waitForData()
    return this.read(len)
  }

  skip(len: bigint): bigint | { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } {
    const data = this.read(len)
    return data instanceof Uint8Array ? BigInt(data.length) : data
  }

  subscribe(registry: PollableRegistry): number {
    if (this.isClosed()) return createReadyPollable(registry)
    return registry.create(this.socket.rx.waitForData())
  }
}

class NodeOutputStream implements OutputStream {
  handle = 0
  private closed = false
  constructor(private readonly socket: NodeTcpSocket) {}

  isClosed(): boolean {
    return this.closed || this.socket.state === 'closed'
  }

  close(): void {
    this.closed = true
  }

  checkWrite(): bigint | { tag: 'closed' } {
    return this.isClosed() ? { tag: 'closed' } : 65536n
  }

  write(contents: Uint8Array): { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } | undefined {
    if (this.isClosed() || !this.socket.sock) return { tag: 'closed' }
    try {
      this.socket.sock.write(contents)
      return undefined
    } catch (e) {
      return { tag: 'last-operation-failed', val: e as Error }
    }
  }

  async blockingWriteAndFlush(
    contents: Uint8Array
  ): Promise<{ tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } | undefined> {
    return this.write(contents)
  }

  flush(): { tag: 'closed' } | undefined {
    return this.isClosed() ? { tag: 'closed' } : undefined
  }

  async blockingFlush(): Promise<{ tag: 'closed' } | undefined> {
    return this.flush()
  }

  subscribe(registry: PollableRegistry): number {
    return createReadyPollable(registry)
  }

  writeZeroes(len: bigint): { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } | undefined {
    return this.write(new Uint8Array(Number(len)))
  }

  splice(src: InputStream, len: bigint): bigint | { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } {
    const data = src.read(len)
    if (!(data instanceof Uint8Array)) return data
    const err = this.write(data)
    return err ?? BigInt(data.length)
  }
}

type IpSocketAddress = { tag: string; val: { port: number; address: number[] } }

class NodeTcpInstance implements PluginInstance {
  constructor(
    private readonly registry: NodeTcpSocketRegistry,
    private readonly pollables: PollableRegistry
  ) {}

  getImports(): Record<string, unknown> {
    return {
      '[resource-drop]tcp-socket': (h: number) => this.registry.drop(h),
      '[method]tcp-socket.start-bind': () => ({ tag: 'err', val: NetworkErrorCode.NotSupported }),
      '[method]tcp-socket.finish-bind': () => ({ tag: 'err', val: NetworkErrorCode.NotSupported }),
      '[method]tcp-socket.start-connect': this.startConnect.bind(this),
      '[method]tcp-socket.finish-connect': this.finishConnect.bind(this),
      '[method]tcp-socket.start-listen': () => ({ tag: 'err', val: NetworkErrorCode.NotSupported }),
      '[method]tcp-socket.finish-listen': () => ({ tag: 'err', val: NetworkErrorCode.NotSupported }),
      '[method]tcp-socket.accept': () => ({ tag: 'err', val: NetworkErrorCode.NotSupported }),
      '[method]tcp-socket.local-address': this.localAddress.bind(this),
      '[method]tcp-socket.remote-address': this.remoteAddress.bind(this),
      '[method]tcp-socket.is-listening': () => false,
      '[method]tcp-socket.address-family': (h: number) => this.registry.get(h)?.family ?? 'ipv4',
      '[method]tcp-socket.set-listen-backlog-size': () => undefined,
      '[method]tcp-socket.keep-alive-enabled': () => false,
      '[method]tcp-socket.set-keep-alive-enabled': () => undefined,
      '[method]tcp-socket.keep-alive-idle-time': () => 7200_000_000_000n,
      '[method]tcp-socket.set-keep-alive-idle-time': () => undefined,
      '[method]tcp-socket.keep-alive-interval': () => 75_000_000_000n,
      '[method]tcp-socket.set-keep-alive-interval': () => undefined,
      '[method]tcp-socket.keep-alive-count': () => 9,
      '[method]tcp-socket.set-keep-alive-count': () => undefined,
      '[method]tcp-socket.hop-limit': () => 64,
      '[method]tcp-socket.set-hop-limit': () => undefined,
      '[method]tcp-socket.receive-buffer-size': () => 65536n,
      '[method]tcp-socket.set-receive-buffer-size': () => undefined,
      '[method]tcp-socket.send-buffer-size': () => 65536n,
      '[method]tcp-socket.set-send-buffer-size': () => undefined,
      '[method]tcp-socket.subscribe': this.subscribe.bind(this),
      '[method]tcp-socket.shutdown': this.shutdown.bind(this),
    }
  }

  destroy(): void {
    this.registry.forEach((s) => s.sock?.destroy())
    this.registry.clear()
  }

  private startConnect(
    handle: number,
    _network: number,
    remoteAddress: IpSocketAddress
  ): { tag: 'err'; val: NetworkErrorCode } | undefined {
    const socket = this.registry.get(handle)
    if (!socket) return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    if (socket.state !== 'new') return { tag: 'err', val: NetworkErrorCode.InvalidState }
    if (!remoteAddress?.val) return { tag: 'err', val: NetworkErrorCode.InvalidArgument }

    const bytes = remoteAddress.val.address
    let host: string
    if (remoteAddress.tag === 'ipv4' && bytes.length === 4) {
      host = bytes.join('.')
    } else if (remoteAddress.tag === 'ipv6' && bytes.length === 16) {
      const parts: string[] = []
      for (let i = 0; i < 16; i += 2) parts.push((((bytes[i]! << 8) | bytes[i + 1]!) >>> 0).toString(16))
      host = parts.join(':')
    } else {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    socket.remoteHost = host
    socket.remotePort = remoteAddress.val.port
    socket.state = 'connecting'

    socket.connectPromise = (async () => {
      try {
        const net = await loadNet()
        await new Promise<void>((resolve) => {
          const sock = net.connect({ host, port: socket.remotePort! }, () => resolve())
          socket.sock = sock
          sock.on('data', (buf: Buffer) => socket.rx.push(new Uint8Array(buf)))
          sock.on('error', (err: Error) => {
            socket.rx.close(err)
            if (socket.state === 'connecting') {
              socket.connectResult = { tag: 'err', val: NetworkErrorCode.ConnectionRefused }
              socket.state = 'closed'
              resolve()
            }
          })
          sock.on('close', () => {
            socket.rx.close()
            socket.state = 'closed'
          })
        })
        if (socket.state === 'closed') return
        const input = new NodeInputStream(socket)
        const output = new NodeOutputStream(socket)
        socket.inputStreamHandle = globalStreamRegistry.register(input)
        socket.outputStreamHandle = globalStreamRegistry.register(output)
        socket.state = 'connected'
        socket.connectResult = { tag: 'ok', val: [socket.inputStreamHandle, socket.outputStreamHandle] }
      } catch {
        socket.connectResult = { tag: 'err', val: NetworkErrorCode.ConnectionRefused }
        socket.state = 'closed'
      }
    })()

    return undefined
  }

  private finishConnect(handle: number): [number, number] | { tag: 'err'; val: NetworkErrorCode } {
    const socket = this.registry.get(handle)
    if (!socket) return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    if (!socket.connectResult) return { tag: 'err', val: NetworkErrorCode.WouldBlock }
    if (socket.connectResult.tag === 'err') return { tag: 'err', val: socket.connectResult.val }
    return socket.connectResult.val
  }

  private subscribe(handle: number): number {
    const socket = this.registry.get(handle)
    if (socket?.state === 'connecting' && socket.connectPromise) {
      return this.pollables.create(socket.connectPromise.then(() => undefined))
    }
    return createReadyPollable(this.pollables)
  }

  private localAddress(handle: number): unknown {
    const socket = this.registry.get(handle)
    if (!socket) return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    return { tag: 'ipv4', val: { port: 0, address: [127, 0, 0, 1] } }
  }

  private remoteAddress(handle: number): unknown {
    const socket = this.registry.get(handle)
    if (!socket?.remoteHost || socket.remotePort === undefined) {
      return { tag: 'err', val: NetworkErrorCode.InvalidState }
    }
    const parts = socket.remoteHost.split('.').map(Number)
    if (parts.length === 4 && parts.every((p) => !Number.isNaN(p))) {
      return { tag: 'ipv4', val: { port: socket.remotePort, address: parts } }
    }
    return { tag: 'err', val: NetworkErrorCode.InvalidState }
  }

  private shutdown(handle: number): { tag: 'err'; val: NetworkErrorCode } | undefined {
    const socket = this.registry.get(handle)
    if (!socket) return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    socket.sock?.end()
    socket.state = 'closed'
    return undefined
  }
}

class NodeTcpCreateSocketInstance implements PluginInstance {
  constructor(private readonly registry: NodeTcpSocketRegistry) {}

  getImports(): Record<string, unknown> {
    return { 'create-tcp-socket': this.createTcpSocket.bind(this) }
  }

  destroy(): void {}

  private createTcpSocket(addressFamily: string): number | { tag: 'err'; val: NetworkErrorCode } {
    if (addressFamily !== 'ipv4' && addressFamily !== 'ipv6') {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }
    return this.registry.register({
      handle: 0,
      state: 'new',
      family: addressFamily,
      rx: new RxQueue(),
    })
  }
}

/** Node-native TCP implementation (real egress via `net`). */
export const nodeTcpImplementation: Implementation = {
  name: 'node',
  description: 'Node-native TCP sockets (real egress via node:net)',
  create(_config: PluginConfig): PluginInstance {
    return new NodeTcpInstance(globalNodeTcpSocketRegistry, globalPollableRegistry)
  },
}

/** Node-native TCP create-socket implementation. */
export const nodeTcpCreateSocketImplementation: Implementation = {
  name: 'node',
  description: 'Node-native TCP socket creation',
  create(_config: PluginConfig): PluginInstance {
    return new NodeTcpCreateSocketInstance(globalNodeTcpSocketRegistry)
  },
}
