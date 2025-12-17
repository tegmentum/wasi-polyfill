/**
 * DNS Adapter for Proxy Server
 *
 * Handles DNS resolution requests from browser clients,
 * performing actual DNS lookups on the server side.
 */

import * as dns from 'node:dns'
import { promisify } from 'node:util'
import {
  MessageType,
  ErrorCode,
  DnsRecordType,
  type DnsResponsePayload,
  decodeDnsQuery,
  encodeDnsResponse,
} from '../protocol.js'
import type { StreamAdapter, ServerStream } from '../server.js'

// =============================================================================
// Types
// =============================================================================

/**
 * DNS adapter configuration
 */
export interface DnsAdapterConfig {
  /**
   * Allowed hostnames/patterns (empty = all allowed)
   */
  allowedHosts?: string[]

  /**
   * Blocked hostnames/patterns
   */
  blockedHosts?: string[]

  /**
   * Default TTL for responses (seconds)
   * @default 300
   */
  defaultTtl?: number

  /**
   * Cache DNS results
   * @default true
   */
  enableCache?: boolean

  /**
   * Cache TTL in seconds (0 = use DNS TTL)
   * @default 0
   */
  cacheTtl?: number

  /**
   * Custom DNS servers (null = system default)
   */
  servers?: string[] | null

  /**
   * Query timeout in ms
   * @default 5000
   */
  timeout?: number
}

// =============================================================================
// Cache Entry
// =============================================================================

interface CacheEntry {
  addresses: string[]
  ttl: number
  expiresAt: number
}

// =============================================================================
// DNS Adapter
// =============================================================================

/**
 * DNS adapter for proxy server
 */
export class DnsAdapter implements StreamAdapter {
  private readonly config: Required<Omit<DnsAdapterConfig, 'servers'>> & { servers: string[] | null }
  private readonly cache: Map<string, CacheEntry> = new Map()
  private readonly resolver: dns.Resolver

  // Promisified DNS methods
  private readonly resolve4: (hostname: string) => Promise<string[]>
  private readonly resolve6: (hostname: string) => Promise<string[]>

  constructor(config: DnsAdapterConfig = {}) {
    this.config = {
      allowedHosts: config.allowedHosts ?? [],
      blockedHosts: config.blockedHosts ?? [],
      defaultTtl: config.defaultTtl ?? 300,
      enableCache: config.enableCache ?? true,
      cacheTtl: config.cacheTtl ?? 0,
      servers: config.servers ?? null,
      timeout: config.timeout ?? 5000,
    }

    // Create resolver
    this.resolver = new dns.Resolver()
    if (this.config.servers) {
      this.resolver.setServers(this.config.servers)
    }

    // Create promisified methods
    this.resolve4 = promisify(this.resolver.resolve4.bind(this.resolver))
    this.resolve6 = promisify(this.resolver.resolve6.bind(this.resolver))
  }

  async onOpen(_stream: ServerStream, _payload: Uint8Array): Promise<void> {
    // DNS streams are stateless, nothing to initialize
  }

  async onData(stream: ServerStream, data: Uint8Array): Promise<void> {
    // Check if this is a DNS command
    if (data.length > 0 && data[0] === MessageType.DNS_QUERY) {
      const payload = data.slice(1)
      await this.handleQuery(stream, payload)
    } else {
      throw new Error('Invalid DNS operation')
    }
  }

  async onClose(_stream: ServerStream): Promise<void> {
    // Nothing to clean up
  }

  async onReset(_stream: ServerStream, _error: Error): Promise<void> {
    // Nothing to clean up
  }

  /**
   * Resolve a hostname (for use by other adapters)
   */
  async resolve(hostname: string, recordType: DnsRecordType = DnsRecordType.A): Promise<string[]> {
    // Check cache
    const cacheKey = `${hostname}:${recordType}`
    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey)
      if (cached && Date.now() < cached.expiresAt) {
        return cached.addresses
      }
    }

    // Perform lookup
    let addresses: string[]
    try {
      switch (recordType) {
        case DnsRecordType.A:
          addresses = await this.withTimeout(this.resolve4(hostname))
          break

        case DnsRecordType.AAAA:
          addresses = await this.withTimeout(this.resolve6(hostname))
          break

        default:
          // For other record types, try both A and AAAA
          const [ipv4, ipv6] = await Promise.allSettled([
            this.withTimeout(this.resolve4(hostname)),
            this.withTimeout(this.resolve6(hostname)),
          ])

          addresses = []
          if (ipv4.status === 'fulfilled') {
            addresses.push(...ipv4.value)
          }
          if (ipv6.status === 'fulfilled') {
            addresses.push(...ipv6.value)
          }

          if (addresses.length === 0) {
            throw new Error(`No DNS records found for ${hostname}`)
          }
          break
      }
    } catch (error) {
      throw error
    }

    // Update cache
    if (this.config.enableCache && addresses.length > 0) {
      const ttl = this.config.cacheTtl > 0 ? this.config.cacheTtl : this.config.defaultTtl
      this.cache.set(cacheKey, {
        addresses,
        ttl,
        expiresAt: Date.now() + ttl * 1000,
      })
    }

    return addresses
  }

  /**
   * Clear DNS cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async handleQuery(stream: ServerStream, payload: Uint8Array): Promise<void> {
    const query = decodeDnsQuery(payload)

    // Validate hostname
    if (!this.isHostAllowed(query.hostname)) {
      await stream.reset(ErrorCode.PERMISSION_DENIED, `Host not allowed: ${query.hostname}`)
      return
    }

    try {
      const addresses = await this.resolve(query.hostname, query.recordType)

      const response: DnsResponsePayload = {
        hostname: query.hostname,
        recordType: query.recordType,
        addresses,
        ttl: this.config.defaultTtl,
      }

      const responsePayload = encodeDnsResponse(response)
      await stream['client'].sendFrame(MessageType.DNS_RESPONSE, stream.id, responsePayload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await stream.reset(ErrorCode.DNS_ERROR, message)
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

  private matchHost(host: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      // Wildcard subdomain match
      const suffix = pattern.slice(1)
      return host.endsWith(suffix) || host === pattern.slice(2)
    }
    return host === pattern
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('DNS query timeout'))
      }, this.config.timeout)

      promise
        .then((result) => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }
}

/**
 * Create a DNS adapter
 */
export function createDnsAdapter(config?: DnsAdapterConfig): DnsAdapter {
  return new DnsAdapter(config)
}
