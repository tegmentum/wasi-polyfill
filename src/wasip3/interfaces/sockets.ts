/**
 * WASI Sockets 0.3.0 interface
 *
 * P3 sockets use native async for connect/accept/read/write
 * instead of the pollable-based pattern in P2.
 *
 * Note: Browser environments have limited socket support.
 * This implementation provides WebSocket-based TCP emulation.
 *
 * @packageDocumentation
 */

import type { Stream, StreamWriter } from '../types.js'
import { createStream } from '../canonical-abi/stream.js'

/**
 * IP address (v4 or v6).
 */
export type IpAddress =
  | { tag: 'ipv4'; val: [number, number, number, number] }
  | { tag: 'ipv6'; val: [number, number, number, number, number, number, number, number] }

/**
 * IP socket address.
 */
export interface IpSocketAddress {
  address: IpAddress
  port: number
}

/**
 * Socket error codes.
 */
export enum SocketErrorCode {
  UNKNOWN = 0,
  ACCESS_DENIED = 1,
  NOT_SUPPORTED = 2,
  INVALID_ARGUMENT = 3,
  OUT_OF_MEMORY = 4,
  TIMEOUT = 5,
  CONCURRENCY_CONFLICT = 6,
  NOT_IN_PROGRESS = 7,
  WOULD_BLOCK = 8,
  INVALID_STATE = 9,
  NEW_SOCKET_LIMIT = 10,
  ADDRESS_NOT_BINDABLE = 11,
  ADDRESS_IN_USE = 12,
  REMOTE_UNREACHABLE = 13,
  CONNECTION_REFUSED = 14,
  CONNECTION_RESET = 15,
  CONNECTION_ABORTED = 16,
  DATAGRAM_TOO_LARGE = 17,
  NAME_UNRESOLVABLE = 18,
  TEMPORARY_RESOLVER_FAILURE = 19,
  PERMANENT_RESOLVER_FAILURE = 20,
}

/**
 * TCP socket state.
 */
export type TcpState =
  | 'unbound'
  | 'bound'
  | 'listening'
  | 'connecting'
  | 'connected'
  | 'closed'

/**
 * TCP socket implementation.
 *
 * In browsers, this uses WebSocket for TCP emulation.
 * A WebSocket gateway server is required for actual TCP connectivity.
 */
export class TcpSocket {
  private state: TcpState = 'unbound'
  private localAddress?: IpSocketAddress
  private remoteAddress?: IpSocketAddress
  private inputStream?: Stream<Uint8Array>
  private outputStream?: StreamWriter<Uint8Array>
  private webSocket?: WebSocket
  private wsGatewayUrl: string | undefined

  constructor(wsGatewayUrl?: string) {
    this.wsGatewayUrl = wsGatewayUrl
  }

  /**
   * Get the current socket state.
   */
  getState(): TcpState {
    return this.state
  }

  /**
   * Bind to a local address.
   */
  bind(localAddress: IpSocketAddress): void {
    if (this.state !== 'unbound') {
      throw new Error(`Invalid state for bind: ${this.state}`)
    }
    this.localAddress = localAddress
    this.state = 'bound'
  }

  /**
   * Connect to a remote address (async).
   *
   * Returns streams for reading and writing.
   */
  async connect(
    remoteAddress: IpSocketAddress
  ): Promise<[Stream<Uint8Array>, StreamWriter<Uint8Array>]> {
    if (this.state !== 'unbound' && this.state !== 'bound') {
      throw new Error(`Invalid state for connect: ${this.state}`)
    }

    this.remoteAddress = remoteAddress
    this.state = 'connecting'

    // Create streams for reading and writing
    const [inputReader, inputWriter] = createStream<Uint8Array>()
    const [outputReader, outputWriter] = createStream<Uint8Array>()

    this.inputStream = inputReader
    this.outputStream = outputWriter

    // If we have a WebSocket gateway, connect through it
    if (this.wsGatewayUrl) {
      await this.connectViaWebSocket(remoteAddress, inputWriter, outputReader)
    } else {
      // No gateway - simulate connection for testing
      // In a real implementation, this would fail without a gateway
      console.warn('TCP socket: No WebSocket gateway configured, connection simulated')
    }

    this.state = 'connected'
    return [inputReader, outputWriter]
  }

  /**
   * Connect via WebSocket gateway.
   */
  private async connectViaWebSocket(
    remoteAddress: IpSocketAddress,
    inputWriter: StreamWriter<Uint8Array>,
    outputReader: Stream<Uint8Array>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const addr = this.formatAddress(remoteAddress)
      const wsUrl = `${this.wsGatewayUrl}/tcp/${addr}`

      try {
        this.webSocket = new WebSocket(wsUrl)
        this.webSocket.binaryType = 'arraybuffer'

        this.webSocket.onopen = () => {
          resolve()

          // Pipe output to WebSocket
          this.pipeToWebSocket(outputReader)
        }

        this.webSocket.onmessage = async (event) => {
          if (event.data instanceof ArrayBuffer) {
            await inputWriter.write([new Uint8Array(event.data)])
          }
        }

        this.webSocket.onclose = () => {
          inputWriter.close()
          this.state = 'closed'
        }

        this.webSocket.onerror = () => {
          reject(new Error('WebSocket connection failed'))
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Pipe output stream to WebSocket.
   */
  private async pipeToWebSocket(outputReader: Stream<Uint8Array>): Promise<void> {
    while (this.webSocket?.readyState === WebSocket.OPEN) {
      const result = await outputReader.read()
      if (result.status === 'values') {
        for (const data of result.values) {
          this.webSocket.send(data)
        }
      } else {
        break
      }
    }
  }

  /**
   * Start listening for connections.
   */
  listen(): void {
    if (this.state !== 'bound') {
      throw new Error(`Invalid state for listen: ${this.state}`)
    }
    this.state = 'listening'
    // Note: Server-side listening is not supported in browsers
    console.warn('TCP socket: Server-side listening not supported in browser')
  }

  /**
   * Accept an incoming connection (async).
   *
   * Note: Not supported in browser environments.
   */
  async accept(): Promise<[TcpSocket, Stream<Uint8Array>, StreamWriter<Uint8Array>]> {
    if (this.state !== 'listening') {
      throw new Error(`Invalid state for accept: ${this.state}`)
    }
    throw new Error('TCP accept not supported in browser environment')
  }

  /**
   * Shutdown the socket.
   */
  shutdown(how: 'read' | 'write' | 'both'): void {
    if (this.state !== 'connected') {
      throw new Error(`Invalid state for shutdown: ${this.state}`)
    }

    if (how === 'read' || how === 'both') {
      this.inputStream?.cancel()
    }
    if (how === 'write' || how === 'both') {
      this.outputStream?.close()
    }

    if (how === 'both') {
      this.close()
    }
  }

  /**
   * Close the socket.
   */
  close(): void {
    this.state = 'closed'
    this.inputStream?.cancel()
    this.outputStream?.cancel()
    this.webSocket?.close()
  }

  /**
   * Get the local address.
   */
  getLocalAddress(): IpSocketAddress | undefined {
    return this.localAddress
  }

  /**
   * Get the remote address.
   */
  getRemoteAddress(): IpSocketAddress | undefined {
    return this.remoteAddress
  }

  /**
   * Format an address as a string.
   */
  private formatAddress(addr: IpSocketAddress): string {
    if (addr.address.tag === 'ipv4') {
      return `${addr.address.val.join('.')}:${addr.port}`
    } else {
      return `[${addr.address.val.map(n => n.toString(16)).join(':')}]:${addr.port}`
    }
  }
}

/**
 * UDP socket implementation.
 *
 * Note: Not directly supported in browsers.
 */
export class UdpSocket {
  private state: 'unbound' | 'bound' | 'connected' | 'closed' = 'unbound'

  /**
   * Get the current socket state.
   */
  getState(): string {
    return this.state
  }

  /**
   * Bind to a local address.
   */
  bind(_localAddress: IpSocketAddress): void {
    if (this.state !== 'unbound') {
      throw new Error(`Invalid state for bind: ${this.state}`)
    }
    this.state = 'bound'
    console.warn('UDP socket: Not supported in browser environment')
  }

  /**
   * Connect to a remote address (sets default destination).
   */
  connect(_remoteAddress: IpSocketAddress): void {
    if (this.state !== 'bound') {
      throw new Error(`Invalid state for connect: ${this.state}`)
    }
    this.state = 'connected'
  }

  /**
   * Send a datagram.
   */
  async send(_data: Uint8Array, _destination?: IpSocketAddress): Promise<void> {
    throw new Error('UDP send not supported in browser environment')
  }

  /**
   * Receive a datagram.
   */
  async receive(): Promise<[Uint8Array, IpSocketAddress]> {
    throw new Error('UDP receive not supported in browser environment')
  }

  /**
   * Close the socket.
   */
  close(): void {
    this.state = 'closed'
  }
}

/**
 * Network resource for creating sockets.
 */
export class Network {
  private wsGatewayUrl: string | undefined

  constructor(wsGatewayUrl?: string) {
    this.wsGatewayUrl = wsGatewayUrl
  }

  /**
   * Create a TCP socket.
   */
  createTcpSocket(): TcpSocket {
    return new TcpSocket(this.wsGatewayUrl)
  }

  /**
   * Create a UDP socket.
   */
  createUdpSocket(): UdpSocket {
    return new UdpSocket()
  }
}

/**
 * DNS resolution.
 */
export async function resolveAddresses(
  hostname: string
): Promise<IpAddress[]> {
  // In browsers, we can't do DNS resolution directly
  // Return localhost as a placeholder
  console.warn(`DNS resolution not supported in browser: ${hostname}`)

  // Check if it's already an IP address
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4Match) {
    return [{
      tag: 'ipv4',
      val: [
        parseInt(ipv4Match[1]!),
        parseInt(ipv4Match[2]!),
        parseInt(ipv4Match[3]!),
        parseInt(ipv4Match[4]!),
      ],
    }]
  }

  // Return localhost for other hostnames
  return [{ tag: 'ipv4', val: [127, 0, 0, 1] }]
}

/**
 * Get the wasi:sockets@0.3.0 imports.
 *
 * @param wsGatewayUrl - WebSocket gateway URL for TCP connections
 * @returns Import object for wasi:sockets@0.3.0
 */
export function getSocketsImports(wsGatewayUrl?: string): Record<string, unknown> {
  // Resource handles
  let nextHandle = 1
  const networks = new Map<number, Network>()
  const tcpSockets = new Map<number, TcpSocket>()
  const udpSockets = new Map<number, UdpSocket>()

  // Default network
  const defaultNetwork = new Network(wsGatewayUrl)
  const defaultNetworkHandle = nextHandle++
  networks.set(defaultNetworkHandle, defaultNetwork)

  return {
    'wasi:sockets/network@0.3.0': {
      '[resource-drop]network': (handle: number): void => {
        networks.delete(handle)
      },
    },

    'wasi:sockets/instance-network@0.3.0': {
      'instance-network': (): number => {
        return defaultNetworkHandle
      },
    },

    'wasi:sockets/tcp@0.3.0': {
      '[constructor]tcp-socket': (_addressFamily: number): number => {
        const handle = nextHandle++
        tcpSockets.set(handle, new TcpSocket(wsGatewayUrl))
        return handle
      },

      '[method]tcp-socket.bind': (handle: number, _network: number, localAddr: IpSocketAddress): void => {
        tcpSockets.get(handle)?.bind(localAddr)
      },

      // P3 async connect - returns streams directly
      '[method]tcp-socket.connect': async (
        handle: number,
        _network: number,
        remoteAddr: IpSocketAddress
      ): Promise<[Stream<Uint8Array>, StreamWriter<Uint8Array>]> => {
        const socket = tcpSockets.get(handle)
        if (!socket) throw new Error('Invalid socket handle')
        return socket.connect(remoteAddr)
      },

      '[method]tcp-socket.listen': (handle: number): void => {
        tcpSockets.get(handle)?.listen()
      },

      // P3 async accept - returns socket and streams
      '[method]tcp-socket.accept': async (
        handle: number
      ): Promise<[number, Stream<Uint8Array>, StreamWriter<Uint8Array>]> => {
        const socket = tcpSockets.get(handle)
        if (!socket) throw new Error('Invalid socket handle')
        const [newSocket, input, output] = await socket.accept()
        const newHandle = nextHandle++
        tcpSockets.set(newHandle, newSocket)
        return [newHandle, input, output]
      },

      '[method]tcp-socket.shutdown': (handle: number, how: 'read' | 'write' | 'both'): void => {
        tcpSockets.get(handle)?.shutdown(how)
      },

      '[method]tcp-socket.local-address': (handle: number): IpSocketAddress | undefined => {
        return tcpSockets.get(handle)?.getLocalAddress()
      },

      '[method]tcp-socket.remote-address': (handle: number): IpSocketAddress | undefined => {
        return tcpSockets.get(handle)?.getRemoteAddress()
      },

      '[resource-drop]tcp-socket': (handle: number): void => {
        tcpSockets.get(handle)?.close()
        tcpSockets.delete(handle)
      },
    },

    'wasi:sockets/udp@0.3.0': {
      '[constructor]udp-socket': (_addressFamily: number): number => {
        const handle = nextHandle++
        udpSockets.set(handle, new UdpSocket())
        return handle
      },

      '[method]udp-socket.bind': (handle: number, _network: number, localAddr: IpSocketAddress): void => {
        udpSockets.get(handle)?.bind(localAddr)
      },

      '[method]udp-socket.connect': (handle: number, remoteAddr: IpSocketAddress): void => {
        udpSockets.get(handle)?.connect(remoteAddr)
      },

      '[method]udp-socket.send': async (handle: number, data: Uint8Array, dest?: IpSocketAddress): Promise<void> => {
        await udpSockets.get(handle)?.send(data, dest)
      },

      '[method]udp-socket.receive': async (handle: number): Promise<[Uint8Array, IpSocketAddress]> => {
        const socket = udpSockets.get(handle)
        if (!socket) throw new Error('Invalid socket handle')
        return socket.receive()
      },

      '[resource-drop]udp-socket': (handle: number): void => {
        udpSockets.get(handle)?.close()
        udpSockets.delete(handle)
      },
    },

    'wasi:sockets/ip-name-lookup@0.3.0': {
      // P3 async resolve
      'resolve-addresses': async (_network: number, hostname: string): Promise<IpAddress[]> => {
        return resolveAddresses(hostname)
      },
    },
  }
}
