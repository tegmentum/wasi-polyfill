/**
 * Network resource for wasi:sockets/network and wasi:sockets/instance-network
 *
 * The network resource represents a network capability that can be used
 * to create sockets and perform DNS lookups.
 *
 * In browsers, this is a virtual network that may connect to a proxy
 * server for actual network operations.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type { Network } from './types.js'
import { HandleRegistry } from '../../../shared/registry.js'

/**
 * Configuration for network plugins
 */
export interface NetworkConfig {
  /**
   * Allowed hosts for network operations (for policy enforcement)
   * If empty or undefined, all hosts are allowed
   */
  allowedHosts?: string[]

  /**
   * Allowed ports for network operations
   * If empty or undefined, all ports are allowed
   */
  allowedPorts?: number[]

  /**
   * Proxy server URL for browser WebSocket tunneling
   */
  proxyUrl?: string
}

/**
 * Registry for network resources.
 *
 * A plain handle table — see the shared {@link HandleRegistry} for the
 * register/get/drop/clear surface.
 */
export class NetworkRegistry extends HandleRegistry<NetworkInstance> {}

/**
 * Global network registry
 */
export const globalNetworkRegistry = new NetworkRegistry()

/**
 * Network instance representing a network capability
 */
export class NetworkInstance implements Network {
  handle = 0
  private readonly allowedHosts: string[]
  private readonly allowedPorts: number[]
  private readonly proxyUrl?: string

  constructor(config: NetworkConfig = {}) {
    this.allowedHosts = config.allowedHosts ?? []
    this.allowedPorts = config.allowedPorts ?? []
    if (config.proxyUrl !== undefined) {
      this.proxyUrl = config.proxyUrl
    }
  }

  /**
   * Check if a host is allowed by policy
   */
  isHostAllowed(host: string): boolean {
    if (this.allowedHosts.length === 0) {
      return true // No restrictions
    }
    return this.allowedHosts.some((allowed) => {
      if (allowed.startsWith('*.')) {
        // Wildcard domain matching
        const domain = allowed.slice(2)
        return host === domain || host.endsWith('.' + domain)
      }
      return host === allowed
    })
  }

  /**
   * Check if a port is allowed by policy
   */
  isPortAllowed(port: number): boolean {
    if (this.allowedPorts.length === 0) {
      return true // No restrictions
    }
    return this.allowedPorts.includes(port)
  }

  /**
   * Get the proxy URL for tunneling (browser only)
   */
  getProxyUrl(): string | undefined {
    return this.proxyUrl
  }
}

/**
 * Network plugin instance for wasi:sockets/network
 *
 * Provides the network resource type with drop capability.
 */
class NetworkPluginInstance implements PluginInstance {
  private readonly registry: NetworkRegistry

  constructor(registry: NetworkRegistry) {
    this.registry = registry
  }

  getImports(): Record<string, unknown> {
    return {
      '[resource-drop]network': this.dropNetwork.bind(this),
    }
  }

  destroy(): void {
    // No cleanup needed
  }

  private dropNetwork(handle: number): void {
    this.registry.drop(handle)
  }
}

/**
 * Instance network plugin instance for wasi:sockets/instance-network
 *
 * Provides the instance-network function that returns the network
 * capability for the current component instance.
 */
class InstanceNetworkPluginInstance implements PluginInstance {
  private readonly registry: NetworkRegistry
  private networkHandle: number | null = null
  private readonly network: NetworkInstance

  constructor(registry: NetworkRegistry, config: NetworkConfig = {}) {
    this.registry = registry
    this.network = new NetworkInstance(config)
    this.networkHandle = registry.register(this.network)
  }

  getImports(): Record<string, unknown> {
    return {
      'instance-network': this.instanceNetwork.bind(this),
    }
  }

  destroy(): void {
    if (this.networkHandle !== null) {
      this.registry.drop(this.networkHandle)
    }
  }

  /**
   * Get the network handle for this instance
   */
  private instanceNetwork(): number {
    if (this.networkHandle === null) {
      throw new Error('Network not available')
    }
    return this.networkHandle
  }

  /**
   * Get the network instance (for use by other plugins)
   */
  getNetwork(): NetworkInstance {
    return this.network
  }
}

/**
 * Virtual network implementation
 *
 * Provides a no-op network resource that doesn't support actual networking.
 * Use this for components that don't need real network access.
 */
export const virtualNetworkImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual network (no actual networking)',
  create(_config: PluginConfig): PluginInstance {
    return new NetworkPluginInstance(globalNetworkRegistry)
  },
}

/**
 * Virtual instance-network implementation
 *
 * Provides a network handle that can be used for policy checking
 * but doesn't support actual network operations in browsers.
 */
export const virtualInstanceNetworkImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual instance network',
  create(config: PluginConfig): PluginInstance {
    const networkConfig: NetworkConfig = {}
    const allowedHosts = config.options?.['allowedHosts'] as string[] | undefined
    const allowedPorts = config.options?.['allowedPorts'] as number[] | undefined
    const proxyUrl = config.options?.['proxyUrl'] as string | undefined

    if (allowedHosts !== undefined) {
      networkConfig.allowedHosts = allowedHosts
    }
    if (allowedPorts !== undefined) {
      networkConfig.allowedPorts = allowedPorts
    }
    if (proxyUrl !== undefined) {
      networkConfig.proxyUrl = proxyUrl
    }

    return new InstanceNetworkPluginInstance(globalNetworkRegistry, networkConfig)
  },
}
