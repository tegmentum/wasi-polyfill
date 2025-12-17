/**
 * TCP Adapter for Proxy Server
 *
 * Handles TCP connection requests from browser clients,
 * establishing actual TCP connections on the server side.
 */

import * as net from 'node:net'
import {
  MessageType,
  ErrorCode,
  type TcpConnectPayload,
  type TcpConnectAckPayload,
  encodeString,
  decodeString,
} from '../protocol.js'
import type { StreamAdapter, ServerStream } from '../server.js'

// =============================================================================
// Types
// =============================================================================

/**
 * TCP adapter configuration
 */
export interface TcpAdapterConfig {
  /**
   * Allowed hosts (empty = all allowed)
   */
  allowedHosts?: string[]

  /**
   * Blocked hosts
   */
  blockedHosts?: string[]

  /**
   * Allowed port ranges (empty = all allowed)
   */
  allowedPorts?: Array<number | [number, number]>

  /**
   * Blocked ports
   */
  blockedPorts?: number[]

  /**
   * Connection timeout in ms
   * @default 30000
   */
  connectTimeout?: number

  /**
   * DNS resolver (for hostname lookup)
   */
  dnsLookup?: (hostname: string) => Promise<string>
}

// =============================================================================
// Stream State
// =============================================================================

interface TcpStreamState {
  socket: net.Socket | null
  localAddress?: string
  localPort?: number
  remoteAddress?: string
  remotePort?: number
  connecting: boolean
  connected: boolean
}

// =============================================================================
// TCP Adapter
// =============================================================================

/**
 * TCP adapter for proxy server
 */
export class TcpAdapter implements StreamAdapter {
  private readonly config: Required<Omit<TcpAdapterConfig, 'dnsLookup'>> & { dnsLookup?: (hostname: string) => Promise<string> }
  private readonly streamStates: Map<number, TcpStreamState> = new Map()

  constructor(config: TcpAdapterConfig = {}) {
    const resolvedConfig: Required<Omit<TcpAdapterConfig, 'dnsLookup'>> & { dnsLookup?: (hostname: string) => Promise<string> } = {
      allowedHosts: config.allowedHosts ?? [],
      blockedHosts: config.blockedHosts ?? [],
      allowedPorts: config.allowedPorts ?? [],
      blockedPorts: config.blockedPorts ?? [],
      connectTimeout: config.connectTimeout ?? 30000,
    }
    if (config.dnsLookup) {
      resolvedConfig.dnsLookup = config.dnsLookup
    }
    this.config = resolvedConfig
  }

  async onOpen(stream: ServerStream, _payload: Uint8Array): Promise<void> {
    // Initialize stream state
    this.streamStates.set(stream.id, {
      socket: null,
      connecting: false,
      connected: false,
    })
  }

  async onData(stream: ServerStream, data: Uint8Array): Promise<void> {
    const state = this.streamStates.get(stream.id)
    if (!state) {
      throw new Error('Unknown stream')
    }

    // Check if this is a command or raw data
    const firstByte = data[0]
    if (data.length > 0 && firstByte !== undefined && firstByte >= 0x20 && firstByte <= 0x2f) {
      // TCP operation command
      const messageType = firstByte as MessageType
      const payload = data.slice(1)

      switch (messageType) {
        case MessageType.TCP_CONNECT:
          await this.handleConnect(stream, state, payload)
          break

        case MessageType.TCP_SHUTDOWN:
          await this.handleShutdown(stream, state, payload)
          break

        default:
          throw new Error(`Unknown TCP operation: ${messageType}`)
      }
    } else if (state.connected && state.socket) {
      // Raw TCP data
      state.socket.write(data)
    } else {
      throw new Error('Not connected')
    }
  }

  async onClose(stream: ServerStream): Promise<void> {
    const state = this.streamStates.get(stream.id)
    if (state?.socket) {
      state.socket.end()
      state.socket = null
    }
    this.streamStates.delete(stream.id)
  }

  async onReset(stream: ServerStream, _error: Error): Promise<void> {
    const state = this.streamStates.get(stream.id)
    if (state?.socket) {
      state.socket.destroy()
      state.socket = null
    }
    this.streamStates.delete(stream.id)
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async handleConnect(stream: ServerStream, state: TcpStreamState, payload: Uint8Array): Promise<void> {
    if (state.connecting || state.connected) {
      throw new Error('Already connecting or connected')
    }

    const connectPayload = this.decodeTcpConnect(payload)

    // Validate host and port
    if (!this.isHostAllowed(connectPayload.host)) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Host not allowed: ${connectPayload.host}`)
      return
    }

    if (!this.isPortAllowed(connectPayload.port)) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Port not allowed: ${connectPayload.port}`)
      return
    }

    state.connecting = true

    // Resolve hostname if needed
    let host = connectPayload.host
    if (this.config.dnsLookup && !this.isIpAddress(host)) {
      try {
        host = await this.config.dnsLookup(host)
      } catch (error) {
        state.connecting = false
        await stream.reset(ErrorCode.DNS_ERROR, `DNS lookup failed: ${connectPayload.host}`)
        return
      }
    }

    // Create TCP socket
    const socket = new net.Socket()
    state.socket = socket

    // Set socket options
    if (connectPayload.noDelay) {
      socket.setNoDelay(true)
    }
    if (connectPayload.keepAlive) {
      socket.setKeepAlive(true)
    }

    // Connection timeout
    const timeoutId = setTimeout(() => {
      if (state.connecting) {
        socket.destroy()
        state.connecting = false
        stream.reset(ErrorCode.TIMEOUT, 'Connection timeout')
      }
    }, this.config.connectTimeout)

    socket.on('connect', () => {
      clearTimeout(timeoutId)
      state.connecting = false
      state.connected = true
      if (socket.localAddress) state.localAddress = socket.localAddress
      if (socket.localPort) state.localPort = socket.localPort
      if (socket.remoteAddress) state.remoteAddress = socket.remoteAddress
      if (socket.remotePort) state.remotePort = socket.remotePort

      // Send TCP_CONNECT_ACK
      const ackPayload = this.encodeTcpConnectAck({
        localAddress: socket.localAddress ?? '0.0.0.0',
        localPort: socket.localPort ?? 0,
        remoteAddress: socket.remoteAddress ?? host,
        remotePort: socket.remotePort ?? connectPayload.port,
      })

      stream['client'].sendFrame(MessageType.TCP_CONNECT_ACK, stream.id, ackPayload)
    })

    socket.on('data', (data: Buffer) => {
      // Forward data to client
      stream.write(new Uint8Array(data)).catch(() => {
        // Ignore write errors
      })
    })

    socket.on('end', () => {
      // Remote closed the connection
      stream.close().catch(() => {})
    })

    socket.on('error', (error: Error) => {
      clearTimeout(timeoutId)
      if (state.connecting) {
        state.connecting = false
        stream.reset(ErrorCode.CONNECT_ERROR, error.message)
      } else if (state.connected) {
        stream.reset(ErrorCode.IO_ERROR, error.message)
      }
    })

    socket.on('close', () => {
      state.connected = false
      state.socket = null
    })

    // Initiate connection
    const connectOptions: net.TcpSocketConnectOpts = {
      host,
      port: connectPayload.port,
    }

    if (connectPayload.localAddress) {
      connectOptions.localAddress = connectPayload.localAddress
    }
    if (connectPayload.localPort) {
      connectOptions.localPort = connectPayload.localPort
    }

    socket.connect(connectOptions)
  }

  private async handleShutdown(_stream: ServerStream, state: TcpStreamState, payload: Uint8Array): Promise<void> {
    if (!state.connected || !state.socket) {
      throw new Error('Not connected')
    }

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const flags = view.getUint8(0)
    const shutdownRead = (flags & 0x01) !== 0
    const shutdownWrite = (flags & 0x02) !== 0

    if (shutdownWrite) {
      state.socket.end()
    }
    if (shutdownRead) {
      state.socket.pause()
    }
  }

  private isHostAllowed(host: string): boolean {
    // Check blocked hosts first
    if (this.config.blockedHosts.length > 0) {
      for (const blocked of this.config.blockedHosts) {
        if (this.matchHost(host, blocked)) {
          return false
        }
      }
    }

    // Check allowed hosts
    if (this.config.allowedHosts.length > 0) {
      for (const allowed of this.config.allowedHosts) {
        if (this.matchHost(host, allowed)) {
          return true
        }
      }
      return false
    }

    return true
  }

  private isPortAllowed(port: number): boolean {
    // Check blocked ports first
    if (this.config.blockedPorts.includes(port)) {
      return false
    }

    // Check allowed ports
    if (this.config.allowedPorts.length > 0) {
      for (const allowed of this.config.allowedPorts) {
        if (typeof allowed === 'number') {
          if (port === allowed) return true
        } else {
          const [min, max] = allowed
          if (port >= min && port <= max) return true
        }
      }
      return false
    }

    return true
  }

  private matchHost(host: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      // Wildcard subdomain match
      const suffix = pattern.slice(1)
      return host.endsWith(suffix) || host === pattern.slice(2)
    }
    return host === pattern
  }

  private isIpAddress(host: string): boolean {
    // Simple IPv4/IPv6 check
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')
  }

  private decodeTcpConnect(payload: Uint8Array): TcpConnectPayload {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)

    let offset = 0
    const port = view.getUint16(offset, true)
    offset += 2

    const { value: host, bytesRead } = decodeString(payload, offset)
    offset += bytesRead

    const flags = view.getUint8(offset)
    offset += 1

    const hasLocalAddress = (flags & 0x01) !== 0
    const keepAlive = (flags & 0x02) !== 0
    const noDelay = (flags & 0x04) !== 0

    const result: TcpConnectPayload = {
      host,
      port,
      keepAlive,
      noDelay,
    }

    if (hasLocalAddress && offset < payload.length) {
      const localPort = view.getUint16(offset, true)
      offset += 2
      const { value: localAddress } = decodeString(payload, offset)
      result.localAddress = localAddress
      result.localPort = localPort
    }

    return result
  }

  private encodeTcpConnectAck(payload: TcpConnectAckPayload): Uint8Array {
    const localAddrBytes = encodeString(payload.localAddress)
    const remoteAddrBytes = encodeString(payload.remoteAddress)

    const result = new Uint8Array(4 + localAddrBytes.length + remoteAddrBytes.length)
    const view = new DataView(result.buffer)

    let offset = 0
    view.setUint16(offset, payload.localPort, true)
    offset += 2
    view.setUint16(offset, payload.remotePort, true)
    offset += 2

    result.set(localAddrBytes, offset)
    offset += localAddrBytes.length

    result.set(remoteAddrBytes, offset)

    return result
  }
}

/**
 * Create a TCP adapter
 */
export function createTcpAdapter(config?: TcpAdapterConfig): TcpAdapter {
  return new TcpAdapter(config)
}
