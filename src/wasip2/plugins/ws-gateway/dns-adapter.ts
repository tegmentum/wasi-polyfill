/**
 * DNS Adapter for WebSocket Gateway
 *
 * Provides DNS resolution through the WebSocket gateway tunnel,
 * implementing the wasi:sockets/ip-name-lookup interface.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { HandleRegistry } from '../../../shared/registry.js'
import {
  PollableRegistry,
  globalPollableRegistry,
  createReadyPollable,
} from '../io/pollable.js'
import {
  type IpAddress,
  type IpAddressFamily,
  NetworkErrorCode,
  parseIpv4,
  parseIpv6,
  loopbackAddress,
} from '../sockets/types.js'
import { globalNetworkRegistry } from '../sockets/network.js'
import { WsTunnelManager, globalTunnelRegistry, buildTunnelConfig } from './tunnel-manager.js'
import { DnsError } from './protocol.js'

/**
 * Configuration for tunneled DNS lookup
 */
export interface TunneledDnsConfig {
  /** Gateway WebSocket URL */
  gatewayUrl?: string

  /** Authentication token */
  authToken?: string

  /** DNS query timeout in milliseconds */
  queryTimeoutMs?: number

  /**
   * Static DNS mappings (hostname -> IP addresses)
   * These take priority over gateway resolution
   */
  staticMappings?: Record<string, string[]>
}

/**
 * Resolve address stream resource
 */
export interface TunneledResolveAddressStream {
  handle: number
  addresses: IpAddress[]
  index: number
  error?: NetworkErrorCode
  pollable?: number
}

/**
 * Registry for tunneled resolve address streams
 */
export class TunneledResolveAddressStreamRegistry extends HandleRegistry<TunneledResolveAddressStream> {
  override register(stream: TunneledResolveAddressStream): number {
    const handle = super.register(stream)
    stream.handle = handle
    return handle
  }
}

/**
 * Global registry for tunneled resolve address streams
 */
export const globalTunneledResolveAddressStreamRegistry = new TunneledResolveAddressStreamRegistry()

/**
 * Tunneled DNS lookup instance
 */
class TunneledDnsLookupInstance implements PluginInstance {
  private readonly streamRegistry: TunneledResolveAddressStreamRegistry
  private readonly pollableRegistry: PollableRegistry
  private readonly tunnel: WsTunnelManager
  private readonly staticMappings: Record<string, string[]>
  private readonly queryTimeoutMs: number
  private readonly pendingStreams: Map<number, Promise<void>> = new Map()

  constructor(
    streamRegistry: TunneledResolveAddressStreamRegistry,
    pollableRegistry: PollableRegistry,
    tunnel: WsTunnelManager,
    config: TunneledDnsConfig = {}
  ) {
    this.streamRegistry = streamRegistry
    this.pollableRegistry = pollableRegistry
    this.tunnel = tunnel
    this.staticMappings = config.staticMappings ?? {}
    this.queryTimeoutMs = config.queryTimeoutMs ?? 30000
  }

  getImports(): Record<string, unknown> {
    return {
      'resolve-addresses': this.resolveAddresses.bind(this),
      '[method]resolve-address-stream.resolve-next-address':
        this.resolveNextAddress.bind(this),
      '[method]resolve-address-stream.subscribe': this.subscribe.bind(this),
      '[resource-drop]resolve-address-stream': this.dropStream.bind(this),
    }
  }

  destroy(): void {
    // No cleanup needed
  }

  /**
   * Start resolving addresses for a hostname
   */
  private resolveAddresses(
    networkHandle: number,
    name: string
  ): number | { tag: 'err'; val: NetworkErrorCode } {
    // Validate network handle
    const network = globalNetworkRegistry.get(networkHandle)
    if (!network) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Check host policy
    if (!network.isHostAllowed(name)) {
      return { tag: 'err', val: NetworkErrorCode.AccessDenied }
    }

    // Try static mappings first
    const staticAddresses = this.staticMappings[name]
    if (staticAddresses) {
      const addresses = this.parseAddresses(staticAddresses)
      const stream: TunneledResolveAddressStream = {
        handle: 0,
        addresses,
        index: 0,
      }
      return this.streamRegistry.register(stream)
    }

    // Handle special hostnames
    if (name === 'localhost') {
      const stream: TunneledResolveAddressStream = {
        handle: 0,
        addresses: [
          loopbackAddress('ipv4' as IpAddressFamily),
          loopbackAddress('ipv6' as IpAddressFamily),
        ],
        index: 0,
      }
      return this.streamRegistry.register(stream)
    }

    // Try to parse as IP address directly
    const ipv4 = parseIpv4(name)
    if (ipv4) {
      const stream: TunneledResolveAddressStream = {
        handle: 0,
        addresses: [{ tag: 'ipv4', val: ipv4 }],
        index: 0,
      }
      return this.streamRegistry.register(stream)
    }

    const ipv6 = parseIpv6(name)
    if (ipv6) {
      const stream: TunneledResolveAddressStream = {
        handle: 0,
        addresses: [{ tag: 'ipv6', val: ipv6 }],
        index: 0,
      }
      return this.streamRegistry.register(stream)
    }

    // Use tunnel DNS resolution (asynchronous)
    // Create the stream in pending state
    const stream: TunneledResolveAddressStream = {
      handle: 0,
      addresses: [],
      index: 0,
    }
    const handle = this.streamRegistry.register(stream)

    // Start async resolution
    const resolvePromise = this.resolveThroughTunnel(handle, name)
    this.pendingStreams.set(handle, resolvePromise)

    return handle
  }

  /**
   * Resolve hostname through tunnel
   */
  private async resolveThroughTunnel(handle: number, name: string): Promise<void> {
    const stream = this.streamRegistry.get(handle)
    if (!stream) {
      return
    }

    try {
      // Check tunnel connection
      if (!this.tunnel.isConnected) {
        const connected = await this.tunnel.connect()
        if (!connected) {
          stream.error = NetworkErrorCode.ConnectionRefused
          this.pendingStreams.delete(handle)
          return
        }
      }

      // Perform DNS resolution
      const result = await this.tunnel.resolveDns(name, 0, this.queryTimeoutMs)

      if (result.success) {
        // Convert raw address bytes to IpAddress
        stream.addresses = this.convertAddresses(result.addresses)
      } else {
        // Map DNS error to network error
        stream.error = this.mapDnsError(result.errorCode)
      }
    } catch {
      stream.error = NetworkErrorCode.Unknown
    }

    this.pendingStreams.delete(handle)
  }

  /**
   * Convert raw address bytes to IpAddress array
   */
  private convertAddresses(rawAddresses: Uint8Array[]): IpAddress[] {
    const addresses: IpAddress[] = []

    for (const raw of rawAddresses) {
      if (raw.length === 4) {
        // IPv4 address
        addresses.push({
          tag: 'ipv4',
          val: [raw[0], raw[1], raw[2], raw[3]] as [number, number, number, number],
        })
      } else if (raw.length === 16) {
        // IPv6 address - convert bytes to 8 u16 values
        const val: [number, number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0, 0]
        for (let i = 0; i < 8; i++) {
          val[i] = (raw[i * 2]! << 8) | raw[i * 2 + 1]!
        }
        addresses.push({ tag: 'ipv6', val })
      }
    }

    return addresses
  }

  /**
   * Map DNS error to network error code
   */
  private mapDnsError(error?: DnsError): NetworkErrorCode {
    switch (error) {
      case DnsError.NxDomain:
        return NetworkErrorCode.NameUnresolvable
      case DnsError.Timeout:
        return NetworkErrorCode.Timeout
      case DnsError.Refused:
        return NetworkErrorCode.AccessDenied
      case DnsError.NotImplemented:
        return NetworkErrorCode.NotSupported
      case DnsError.ServerFailure:
      case DnsError.FormatError:
      default:
        return NetworkErrorCode.Unknown
    }
  }

  /**
   * Get the next resolved address from the stream
   */
  private resolveNextAddress(
    streamHandle: number
  ): IpAddress | undefined | { tag: 'err'; val: NetworkErrorCode } {
    const stream = this.streamRegistry.get(streamHandle)
    if (!stream) {
      return { tag: 'err', val: NetworkErrorCode.InvalidArgument }
    }

    // Check if still pending
    if (this.pendingStreams.has(streamHandle)) {
      // Resolution in progress - would block
      return { tag: 'err', val: NetworkErrorCode.WouldBlock }
    }

    // Check for error state
    if (stream.error) {
      return { tag: 'err', val: stream.error }
    }

    // Return next address or undefined if exhausted
    if (stream.index < stream.addresses.length) {
      return stream.addresses[stream.index++]
    }

    return undefined
  }

  /**
   * Subscribe to stream completion
   */
  private subscribe(streamHandle: number): number {
    // Check if resolution is still pending
    const pending = this.pendingStreams.get(streamHandle)
    if (pending) {
      // Create a pollable that resolves when the DNS resolution completes
      return this.pollableRegistry.create(pending.then(() => {}))
    }

    // Already resolved
    return createReadyPollable(this.pollableRegistry)
  }

  /**
   * Drop a resolve address stream
   */
  private dropStream(handle: number): void {
    this.streamRegistry.drop(handle)
    this.pendingStreams.delete(handle)
  }

  /**
   * Parse address strings to IpAddress array
   */
  private parseAddresses(addresses: string[]): IpAddress[] {
    const result: IpAddress[] = []

    for (const addr of addresses) {
      const ipv4 = parseIpv4(addr)
      if (ipv4) {
        result.push({ tag: 'ipv4', val: ipv4 })
        continue
      }

      const ipv6 = parseIpv6(addr)
      if (ipv6) {
        result.push({ tag: 'ipv6', val: ipv6 })
      }
    }

    return result
  }
}

/**
 * Tunneled DNS lookup implementation
 *
 * Performs DNS resolution through the WebSocket gateway tunnel,
 * enabling real DNS lookups in browser environments.
 */
export const tunneledDnsLookupImplementation: Implementation = {
  name: 'tunneled',
  description: 'DNS resolver through WebSocket gateway',
  create(config: PluginConfig): PluginInstance {
    const gatewayUrl = config.options?.['gatewayUrl'] as string | undefined
    const authToken = config.options?.['authToken'] as string | undefined
    const queryTimeoutMs = config.options?.['queryTimeoutMs'] as number | undefined
    const staticMappings = config.options?.['staticMappings'] as
      | Record<string, string[]>
      | undefined

    if (!gatewayUrl) {
      throw new Error('gatewayUrl is required for tunneled DNS implementation')
    }

    // Get or create tunnel
    const tunnel = globalTunnelRegistry.getOrCreate(buildTunnelConfig({ gatewayUrl, authToken }))

    const dnsConfig: TunneledDnsConfig = { gatewayUrl }
    if (authToken !== undefined) {
      dnsConfig.authToken = authToken
    }
    if (queryTimeoutMs !== undefined) {
      dnsConfig.queryTimeoutMs = queryTimeoutMs
    }
    if (staticMappings !== undefined) {
      dnsConfig.staticMappings = staticMappings
    }

    return new TunneledDnsLookupInstance(
      globalTunneledResolveAddressStreamRegistry,
      globalPollableRegistry,
      tunnel,
      dnsConfig
    )
  },
}
