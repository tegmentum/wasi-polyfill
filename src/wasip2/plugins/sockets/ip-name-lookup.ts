/**
 * IP name lookup for wasi:sockets/ip-name-lookup
 *
 * Provides DNS resolution capabilities. In browsers, this is limited
 * as there's no direct DNS API. We implement DNS-over-HTTPS (DoH) for
 * real DNS resolution in browser environments.
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
} from './types.js'
import { globalNetworkRegistry } from './network.js'

/**
 * Well-known DNS-over-HTTPS providers
 */
export const DOH_PROVIDERS = {
  /** Cloudflare DNS (1.1.1.1) */
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  /** Google Public DNS (8.8.8.8) */
  google: 'https://dns.google/dns-query',
  /** Quad9 DNS (9.9.9.9) */
  quad9: 'https://dns.quad9.net/dns-query',
  /** AdGuard DNS */
  adguard: 'https://dns.adguard-dns.com/dns-query',
} as const

/**
 * Default DoH resolver URL
 */
export const DEFAULT_DOH_RESOLVER = DOH_PROVIDERS.cloudflare

/**
 * Configuration for IP name lookup plugin
 */
export interface IpNameLookupConfig {
  /**
   * Static DNS mappings (hostname -> IP addresses)
   * Useful for testing or offline scenarios
   */
  staticMappings?: Record<string, string[]>

  /**
   * DNS-over-HTTPS resolver URL (for browser DNS resolution)
   * Defaults to Cloudflare DNS if not specified
   */
  dohResolverUrl?: string

  /**
   * Enable DoH resolution (default: true if dohResolverUrl is set or by default)
   */
  enableDoh?: boolean

  /**
   * DoH query timeout in milliseconds (default: 5000)
   */
  dohTimeoutMs?: number

  /**
   * Cache TTL in milliseconds (default: 300000 = 5 minutes)
   * Set to 0 to disable caching
   */
  cacheTtlMs?: number
}

/**
 * DNS record types
 */
export enum DnsRecordType {
  A = 1,
  AAAA = 28,
}

/**
 * DoH JSON response format (RFC 8484 JSON)
 */
interface DohJsonResponse {
  Status: number
  TC: boolean
  RD: boolean
  RA: boolean
  AD: boolean
  CD: boolean
  Question: Array<{
    name: string
    type: number
  }>
  Answer?: Array<{
    name: string
    type: number
    TTL: number
    data: string
  }>
}

/**
 * DNS cache entry
 */
interface DnsCacheEntry {
  addresses: IpAddress[]
  expiresAt: number
}

/**
 * Resolve address stream resource
 *
 * Represents an ongoing DNS resolution operation.
 */
export interface ResolveAddressStream {
  handle: number
  addresses: IpAddress[]
  index: number
  error?: NetworkErrorCode
  /** Whether resolution is still pending (async DoH query in progress) */
  pending: boolean
  /** Promise that resolves when DoH query completes */
  resolution?: Promise<void>
}

/**
 * Registry for resolve address streams
 */
export class ResolveAddressStreamRegistry extends HandleRegistry<ResolveAddressStream> {
  override register(stream: ResolveAddressStream): number {
    const handle = super.register(stream)
    stream.handle = handle
    return handle
  }
}

/**
 * Global resolve address stream registry
 */
export const globalResolveAddressStreamRegistry = new ResolveAddressStreamRegistry()

/**
 * IP name lookup plugin instance
 */
class IpNameLookupInstance implements PluginInstance {
  private readonly streamRegistry: ResolveAddressStreamRegistry
  private readonly pollableRegistry: PollableRegistry
  private readonly staticMappings: Record<string, string[]>
  private readonly dohResolverUrl: string
  private readonly enableDoh: boolean
  private readonly dohTimeoutMs: number
  private readonly cacheTtlMs: number
  private readonly dnsCache: Map<string, DnsCacheEntry> = new Map()

  constructor(
    streamRegistry: ResolveAddressStreamRegistry,
    pollableRegistry: PollableRegistry,
    config: IpNameLookupConfig = {}
  ) {
    this.streamRegistry = streamRegistry
    this.pollableRegistry = pollableRegistry
    this.staticMappings = config.staticMappings ?? {}
    this.dohResolverUrl = config.dohResolverUrl ?? DEFAULT_DOH_RESOLVER
    this.enableDoh = config.enableDoh ?? true
    this.dohTimeoutMs = config.dohTimeoutMs ?? 5000
    this.cacheTtlMs = config.cacheTtlMs ?? 300000 // 5 minutes
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
    this.dnsCache.clear()
  }

  /**
   * Start resolving addresses for a hostname
   */
  private resolveAddresses(
    _networkHandle: number,
    name: string
  ): number | { tag: 'err'; val: NetworkErrorCode } {
    // Validate network handle
    const network = globalNetworkRegistry.get(_networkHandle)
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
      const stream: ResolveAddressStream = {
        handle: 0,
        addresses,
        index: 0,
        pending: false,
      }
      return this.streamRegistry.register(stream)
    }

    // Handle special hostnames
    if (name === 'localhost') {
      const stream: ResolveAddressStream = {
        handle: 0,
        addresses: [
          loopbackAddress('ipv4' as IpAddressFamily),
          loopbackAddress('ipv6' as IpAddressFamily),
        ],
        index: 0,
        pending: false,
      }
      return this.streamRegistry.register(stream)
    }

    // Try to parse as IP address directly
    const ipv4 = parseIpv4(name)
    if (ipv4) {
      const stream: ResolveAddressStream = {
        handle: 0,
        addresses: [{ tag: 'ipv4', val: ipv4 }],
        index: 0,
        pending: false,
      }
      return this.streamRegistry.register(stream)
    }

    const ipv6 = parseIpv6(name)
    if (ipv6) {
      const stream: ResolveAddressStream = {
        handle: 0,
        addresses: [{ tag: 'ipv6', val: ipv6 }],
        index: 0,
        pending: false,
      }
      return this.streamRegistry.register(stream)
    }

    // Check DNS cache
    const cached = this.getCachedAddresses(name)
    if (cached) {
      const stream: ResolveAddressStream = {
        handle: 0,
        addresses: cached,
        index: 0,
        pending: false,
      }
      return this.streamRegistry.register(stream)
    }

    // If DoH is disabled, return unresolvable
    if (!this.enableDoh) {
      const stream: ResolveAddressStream = {
        handle: 0,
        addresses: [],
        index: 0,
        pending: false,
        error: NetworkErrorCode.NameUnresolvable,
      }
      return this.streamRegistry.register(stream)
    }

    // Start async DoH resolution
    const stream: ResolveAddressStream = {
      handle: 0,
      addresses: [],
      index: 0,
      pending: true,
    }
    const handle = this.streamRegistry.register(stream)

    // Start DoH resolution in background
    stream.resolution = this.resolveViaDoH(name, stream)

    return handle
  }

  /**
   * Resolve hostname via DNS-over-HTTPS
   */
  private async resolveViaDoH(
    hostname: string,
    stream: ResolveAddressStream
  ): Promise<void> {
    try {
      const addresses: IpAddress[] = []

      // Query both A and AAAA records in parallel
      const [ipv4Results, ipv6Results] = await Promise.allSettled([
        this.queryDoH(hostname, DnsRecordType.A),
        this.queryDoH(hostname, DnsRecordType.AAAA),
      ])

      // Process IPv4 results
      if (ipv4Results.status === 'fulfilled' && ipv4Results.value) {
        for (const addr of ipv4Results.value) {
          const parsed = parseIpv4(addr)
          if (parsed) {
            addresses.push({ tag: 'ipv4', val: parsed })
          }
        }
      }

      // Process IPv6 results
      if (ipv6Results.status === 'fulfilled' && ipv6Results.value) {
        for (const addr of ipv6Results.value) {
          const parsed = parseIpv6(addr)
          if (parsed) {
            addresses.push({ tag: 'ipv6', val: parsed })
          }
        }
      }

      if (addresses.length === 0) {
        stream.error = NetworkErrorCode.NameUnresolvable
      } else {
        stream.addresses = addresses
        // Cache the result
        this.cacheAddresses(hostname, addresses)
      }
    } catch {
      stream.error = NetworkErrorCode.NameUnresolvable
    } finally {
      stream.pending = false
    }
  }

  /**
   * Query DoH resolver for a specific record type
   */
  private async queryDoH(
    hostname: string,
    recordType: DnsRecordType
  ): Promise<string[] | null> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.dohTimeoutMs)

    try {
      const url = new URL(this.dohResolverUrl)
      url.searchParams.set('name', hostname)
      url.searchParams.set('type', recordType === DnsRecordType.A ? 'A' : 'AAAA')

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/dns-json',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as DohJsonResponse

      // Check for DNS errors (NXDOMAIN, SERVFAIL, etc.)
      if (data.Status !== 0) {
        return null
      }

      if (!data.Answer || data.Answer.length === 0) {
        return null
      }

      // Extract addresses from answer
      const addresses: string[] = []
      for (const answer of data.Answer) {
        if (answer.type === recordType) {
          addresses.push(answer.data)
        }
      }

      return addresses.length > 0 ? addresses : null
    } catch {
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Get cached addresses if not expired
   */
  private getCachedAddresses(hostname: string): IpAddress[] | null {
    if (this.cacheTtlMs === 0) {
      return null
    }

    const entry = this.dnsCache.get(hostname)
    if (!entry) {
      return null
    }

    if (Date.now() > entry.expiresAt) {
      this.dnsCache.delete(hostname)
      return null
    }

    return entry.addresses
  }

  /**
   * Cache resolved addresses
   */
  private cacheAddresses(hostname: string, addresses: IpAddress[]): void {
    if (this.cacheTtlMs === 0) {
      return
    }

    this.dnsCache.set(hostname, {
      addresses,
      expiresAt: Date.now() + this.cacheTtlMs,
    })
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
    if (stream.pending) {
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
    const stream = this.streamRegistry.get(streamHandle)

    // If pending, create pollable that resolves when done
    if (stream?.pending && stream.resolution) {
      return this.pollableRegistry.create(stream.resolution)
    }

    // Already resolved
    return createReadyPollable(this.pollableRegistry)
  }

  /**
   * Drop a resolve address stream
   */
  private dropStream(handle: number): void {
    this.streamRegistry.drop(handle)
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
 * Virtual IP name lookup implementation
 *
 * Provides static DNS resolution with configurable mappings.
 * DoH is enabled by default for resolving unknown hostnames.
 */
export const virtualIpNameLookupImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual DNS resolver with static mappings and DoH fallback',
  create(config: PluginConfig): PluginInstance {
    const lookupConfig: IpNameLookupConfig = {}
    const staticMappings = config.options?.['staticMappings'] as
      | Record<string, string[]>
      | undefined
    const dohResolverUrl = config.options?.['dohResolverUrl'] as string | undefined
    const enableDoh = config.options?.['enableDoh'] as boolean | undefined
    const dohTimeoutMs = config.options?.['dohTimeoutMs'] as number | undefined
    const cacheTtlMs = config.options?.['cacheTtlMs'] as number | undefined

    if (staticMappings !== undefined) {
      lookupConfig.staticMappings = staticMappings
    }
    if (dohResolverUrl !== undefined) {
      lookupConfig.dohResolverUrl = dohResolverUrl
    }
    if (enableDoh !== undefined) {
      lookupConfig.enableDoh = enableDoh
    }
    if (dohTimeoutMs !== undefined) {
      lookupConfig.dohTimeoutMs = dohTimeoutMs
    }
    if (cacheTtlMs !== undefined) {
      lookupConfig.cacheTtlMs = cacheTtlMs
    }

    return new IpNameLookupInstance(
      globalResolveAddressStreamRegistry,
      globalPollableRegistry,
      lookupConfig
    )
  },
}

/**
 * DNS-over-HTTPS implementation
 *
 * Uses DNS-over-HTTPS for all DNS resolution.
 * Supports multiple providers (Cloudflare, Google, Quad9, AdGuard).
 *
 * Configuration options:
 * - dohResolverUrl: DoH resolver URL (default: Cloudflare)
 * - dohTimeoutMs: Query timeout in ms (default: 5000)
 * - cacheTtlMs: Cache TTL in ms (default: 300000)
 * - staticMappings: Optional static hostname mappings
 */
export const dohIpNameLookupImplementation: Implementation = {
  name: 'doh',
  description: 'DNS-over-HTTPS resolver',
  create(config: PluginConfig): PluginInstance {
    const lookupConfig: IpNameLookupConfig = {
      enableDoh: true,
    }

    const staticMappings = config.options?.['staticMappings'] as
      | Record<string, string[]>
      | undefined
    const dohResolverUrl = config.options?.['dohResolverUrl'] as string | undefined
    const dohTimeoutMs = config.options?.['dohTimeoutMs'] as number | undefined
    const cacheTtlMs = config.options?.['cacheTtlMs'] as number | undefined

    if (staticMappings !== undefined) {
      lookupConfig.staticMappings = staticMappings
    }
    if (dohResolverUrl !== undefined) {
      lookupConfig.dohResolverUrl = dohResolverUrl
    }
    if (dohTimeoutMs !== undefined) {
      lookupConfig.dohTimeoutMs = dohTimeoutMs
    }
    if (cacheTtlMs !== undefined) {
      lookupConfig.cacheTtlMs = cacheTtlMs
    }

    return new IpNameLookupInstance(
      globalResolveAddressStreamRegistry,
      globalPollableRegistry,
      lookupConfig
    )
  },
}

/**
 * Stub IP name lookup implementation
 *
 * Returns errors for all lookups except static mappings, localhost, and IP addresses.
 * Use when DNS is not needed.
 */
export const stubIpNameLookupImplementation: Implementation = {
  name: 'stub',
  description: 'Stub DNS resolver (no external lookups)',
  create(config: PluginConfig): PluginInstance {
    const lookupConfig: IpNameLookupConfig = {
      enableDoh: false, // Disable DoH
    }

    const staticMappings = config.options?.['staticMappings'] as
      | Record<string, string[]>
      | undefined

    if (staticMappings !== undefined) {
      lookupConfig.staticMappings = staticMappings
    }

    return new IpNameLookupInstance(
      globalResolveAddressStreamRegistry,
      globalPollableRegistry,
      lookupConfig
    )
  },
}
