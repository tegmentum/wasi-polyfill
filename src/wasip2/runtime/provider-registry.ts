/**
 * Provider registry with selection algorithm
 *
 * The registry manages provider definitions and handles automatic
 * selection of the best provider for each interface based on
 * environment, capabilities, and configuration.
 */

import type { WasiInterface, PluginConfig } from '../core/types.js'
import { formatInterfaceString } from '../core/types.js'
import type {
  Provider,
  ProviderDefinition,
  ProviderContext,
  Capabilities,
} from './provider.js'

/**
 * Bundle configuration
 *
 * A bundle is a preset configuration that specifies which provider
 * to use for each interface.
 */
export interface BundleConfig {
  /** Bundle name (e.g., 'browser-default', 'node-default') */
  name: string
  /** Provider mappings: interface key -> provider ID */
  providers: Record<string, string>
  /** Default policy settings */
  policyDefaults?: Record<string, unknown>
}

/**
 * Provider selection override
 */
export interface ProviderOverride {
  /** Interface to override (e.g., 'wasi:random/random') */
  interface: string
  /** Provider ID to use */
  providerId: string
  /** Additional configuration */
  config?: PluginConfig
}

/**
 * Provider registry configuration
 */
export interface ProviderRegistryConfig {
  /** Base bundle to use */
  bundle?: string | BundleConfig
  /** Per-interface overrides */
  overrides?: ProviderOverride[]
  /** Fallback to proxy provider if available */
  useProxyFallback?: boolean
  /** Environment hint ('browser', 'node', 'worker', etc.) */
  environment?: string
}

/**
 * Selection result
 */
export interface SelectionResult {
  /** Selected provider definition */
  provider: ProviderDefinition
  /** Reason for selection */
  reason: 'explicit' | 'bundle' | 'best-available' | 'proxy-fallback' | 'unsupported'
  /** Configuration to use */
  config: PluginConfig
}

/**
 * Detected runtime environment
 */
export type Environment = 'browser' | 'node' | 'deno' | 'bun' | 'worker' | 'unknown'

/**
 * Detect the current runtime environment
 */
export function detectEnvironment(): Environment {
  // Check for Deno
  if (typeof (globalThis as Record<string, unknown>).Deno !== 'undefined') {
    return 'deno'
  }

  // Check for Bun
  if (typeof (globalThis as Record<string, unknown>).Bun !== 'undefined') {
    return 'bun'
  }

  // Check for Node.js
  if (
    typeof (globalThis as Record<string, unknown>).process !== 'undefined' &&
    (globalThis as Record<string, unknown> & { process?: { versions?: { node?: string } } })
      .process?.versions?.node
  ) {
    return 'node'
  }

  // Check for Web Worker
  if (
    typeof (globalThis as Record<string, unknown>).WorkerGlobalScope !== 'undefined' &&
    globalThis instanceof (globalThis as Record<string, unknown> & { WorkerGlobalScope?: { new(): unknown } }).WorkerGlobalScope!
  ) {
    return 'worker'
  }

  // Check for browser
  if (typeof (globalThis as Record<string, unknown>).window !== 'undefined') {
    return 'browser'
  }

  return 'unknown'
}

/**
 * Provider registry
 *
 * Manages provider registration and selection.
 */
export class ProviderRegistry {
  private definitions: Map<string, ProviderDefinition[]> = new Map()
  private bundles: Map<string, BundleConfig> = new Map()
  private instances: Map<string, Provider> = new Map()
  private config: ProviderRegistryConfig
  private environment: Environment

  constructor(config: ProviderRegistryConfig = {}) {
    this.config = config
    this.environment = (config.environment as Environment) ?? detectEnvironment()
  }

  /**
   * Register a provider definition
   */
  register(definition: ProviderDefinition): void {
    const key = this.makeInterfaceKey(definition.witInterface)
    const existing = this.definitions.get(key) ?? []
    existing.push(definition)
    // Sort by priority (higher first)
    existing.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    this.definitions.set(key, existing)
  }

  /**
   * Register a bundle configuration
   */
  registerBundle(bundle: BundleConfig): void {
    this.bundles.set(bundle.name, bundle)
  }

  /**
   * Get all registered provider IDs for an interface
   */
  getProviderIds(iface: WasiInterface): string[] {
    const key = this.makeInterfaceKey(iface)
    const definitions = this.definitions.get(key) ?? []
    return definitions.map((d) => d.id)
  }

  /**
   * Get a specific provider definition by ID
   */
  getDefinition(iface: WasiInterface, providerId: string): ProviderDefinition | undefined {
    const key = this.makeInterfaceKey(iface)
    const definitions = this.definitions.get(key) ?? []
    return definitions.find((d) => d.id === providerId)
  }

  /**
   * Select the best provider for an interface
   *
   * Selection algorithm:
   * 1. Check explicit overrides
   * 2. Check bundle configuration
   * 3. Find best available provider for environment
   * 4. Fall back to proxy provider if enabled
   * 5. Return unsupported provider
   */
  select(iface: WasiInterface): SelectionResult {
    const key = this.makeInterfaceKey(iface)
    const interfaceStr = formatInterfaceString(iface)

    // 1. Check explicit overrides
    const override = this.config.overrides?.find((o) => o.interface === interfaceStr || o.interface === key)
    if (override) {
      const definition = this.getDefinition(iface, override.providerId)
      if (definition) {
        return {
          provider: definition,
          reason: 'explicit',
          config: override.config ?? {},
        }
      }
    }

    // 2. Check bundle configuration
    const bundle = this.getActiveBundle()
    if (bundle) {
      const providerId = bundle.providers[key] ?? bundle.providers[interfaceStr]
      if (providerId) {
        const definition = this.getDefinition(iface, providerId)
        if (definition) {
          return {
            provider: definition,
            reason: 'bundle',
            config: {},
          }
        }
      }
    }

    // 3. Find best available provider for environment
    const definitions = this.definitions.get(key) ?? []
    for (const definition of definitions) {
      if (this.isAvailableInEnvironment(definition)) {
        return {
          provider: definition,
          reason: 'best-available',
          config: {},
        }
      }
    }

    // 4. Fall back to proxy provider if enabled
    if (this.config.useProxyFallback) {
      const proxyDef = definitions.find((d) => d.id.includes('proxy') || d.id.includes('remote'))
      if (proxyDef) {
        return {
          provider: proxyDef,
          reason: 'proxy-fallback',
          config: {},
        }
      }
    }

    // 5. Return unsupported provider
    return {
      provider: this.createUnsupportedProvider(iface),
      reason: 'unsupported',
      config: {},
    }
  }

  /**
   * Create and initialize a provider instance
   */
  async createProvider(
    iface: WasiInterface,
    ctx: ProviderContext,
    config?: PluginConfig
  ): Promise<Provider> {
    const selection = this.select(iface)

    // Check if we already have an instance
    const instanceKey = `${this.makeInterfaceKey(iface)}:${selection.provider.id}`
    const existing = this.instances.get(instanceKey)
    if (existing && existing.state === 'ready') {
      return existing
    }

    // Create new instance
    const mergedConfig = { ...selection.config, ...config }
    const provider = selection.provider.factory(mergedConfig)

    // Initialize
    await provider.init(ctx)

    // Cache instance
    this.instances.set(instanceKey, provider)

    return provider
  }

  /**
   * Get a cached provider instance if available
   */
  getInstance(iface: WasiInterface, providerId?: string): Provider | undefined {
    const key = this.makeInterfaceKey(iface)

    if (providerId) {
      return this.instances.get(`${key}:${providerId}`)
    }

    // Return any cached instance for this interface
    for (const [instanceKey, provider] of this.instances) {
      if (instanceKey.startsWith(`${key}:`)) {
        return provider
      }
    }

    return undefined
  }

  /**
   * Close all provider instances
   */
  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = []

    for (const provider of this.instances.values()) {
      if (provider.state === 'ready') {
        closePromises.push(Promise.resolve(provider.close()))
      }
    }

    await Promise.all(closePromises)
    this.instances.clear()
  }

  /**
   * List all registered interfaces
   */
  listInterfaces(): WasiInterface[] {
    const interfaces: WasiInterface[] = []
    for (const definitions of this.definitions.values()) {
      const first = definitions[0]
      if (first) {
        interfaces.push(first.witInterface)
      }
    }
    return interfaces
  }

  /**
   * Check if a provider is available in the current environment
   */
  private isAvailableInEnvironment(definition: ProviderDefinition): boolean {
    if (!definition.environments || definition.environments.length === 0) {
      // No environment restrictions
      return true
    }
    return definition.environments.includes(this.environment)
  }

  /**
   * Get the active bundle configuration
   */
  private getActiveBundle(): BundleConfig | undefined {
    if (!this.config.bundle) {
      return undefined
    }

    if (typeof this.config.bundle === 'string') {
      return this.bundles.get(this.config.bundle)
    }

    return this.config.bundle
  }

  /**
   * Create an unsupported provider for an interface
   */
  private createUnsupportedProvider(iface: WasiInterface): ProviderDefinition {
    return {
      id: 'unsupported',
      witInterface: iface,
      description: `Unsupported interface: ${formatInterfaceString(iface)}`,
      defaultCapabilities: {},
      factory: () => new UnsupportedProvider(iface),
    }
  }

  /**
   * Create interface key for lookups
   */
  private makeInterfaceKey(iface: WasiInterface): string {
    return `${iface.package}/${iface.name}`
  }
}

/**
 * Unsupported provider
 *
 * Returned when no provider is available for an interface.
 * All methods throw an error indicating the interface is not supported.
 */
class UnsupportedProvider implements Provider {
  readonly id = 'unsupported'
  readonly witInterface: WasiInterface
  readonly state = 'ready' as const

  constructor(iface: WasiInterface) {
    this.witInterface = iface
  }

  capabilities(): Capabilities {
    return {}
  }

  init(): void {
    // No-op
  }

  getImports(): Record<string, unknown> {
    const interfaceStr = formatInterfaceString(this.witInterface)
    return new Proxy(
      {},
      {
        get: (_target, prop) => {
          return () => {
            throw new Error(`Interface not supported: ${interfaceStr}.${String(prop)}`)
          }
        },
      }
    )
  }

  close(): void {
    // No-op
  }
}

/**
 * Built-in bundle definitions
 */
export const browserDefaultBundle: BundleConfig = {
  name: 'browser-default',
  providers: {
    'wasi:random/random': 'random.crypto.web',
    'wasi:random/insecure': 'random.insecure.math',
    'wasi:random/insecure-seed': 'random.insecure.seeded',
    'wasi:clocks/monotonic-clock': 'clocks.monotonic.real',
    'wasi:clocks/wall-clock': 'clocks.wall.real',
    'wasi:io/streams': 'io.streams.webstreams',
    'wasi:io/poll': 'io.poll.promise',
    'wasi:io/error': 'io.error.default',
    'wasi:cli/environment': 'cli.env.browser-config',
    'wasi:cli/stdin': 'cli.stdio.console',
    'wasi:cli/stdout': 'cli.stdio.console',
    'wasi:cli/stderr': 'cli.stdio.console',
    'wasi:cli/exit': 'cli.exit.throw',
    'wasi:filesystem/types': 'fs.opfs',
    'wasi:filesystem/preopens': 'fs.preopens.manifest',
    'wasi:sockets/network': 'net.disabled',
    'wasi:sockets/ip-name-lookup': 'dns.doh',
    'wasi:sockets/tcp': 'tcp.ws-tunnel',
    'wasi:http/outgoing-handler': 'http.client.fetch',
    'wasi:http/incoming-handler': 'http.server.serviceworker',
  },
}

export const nodeDefaultBundle: BundleConfig = {
  name: 'node-default',
  providers: {
    'wasi:random/random': 'random.crypto.node',
    'wasi:random/insecure': 'random.insecure.math',
    'wasi:random/insecure-seed': 'random.insecure.seeded',
    'wasi:clocks/monotonic-clock': 'clocks.monotonic.real',
    'wasi:clocks/wall-clock': 'clocks.wall.real',
    'wasi:io/streams': 'io.streams.node',
    'wasi:io/poll': 'io.poll.scheduler',
    'wasi:io/error': 'io.error.default',
    'wasi:cli/environment': 'cli.env.node',
    'wasi:cli/stdin': 'cli.stdio.node',
    'wasi:cli/stdout': 'cli.stdio.node',
    'wasi:cli/stderr': 'cli.stdio.node',
    'wasi:cli/exit': 'cli.exit.throw',
    'wasi:filesystem/types': 'fs.node',
    'wasi:filesystem/preopens': 'fs.preopens.manifest',
    'wasi:sockets/network': 'net.node',
    'wasi:sockets/ip-name-lookup': 'dns.node',
    'wasi:sockets/tcp': 'tcp.node',
    'wasi:sockets/udp': 'udp.node',
    'wasi:http/outgoing-handler': 'http.client.undici',
    'wasi:http/incoming-handler': 'http.server.node',
  },
}

export const deterministicTestBundle: BundleConfig = {
  name: 'deterministic-test',
  providers: {
    'wasi:random/random': 'random.replay',
    'wasi:random/insecure': 'random.insecure.seeded',
    'wasi:random/insecure-seed': 'random.insecure.seeded',
    'wasi:clocks/monotonic-clock': 'clocks.monotonic.virtual',
    'wasi:clocks/wall-clock': 'clocks.wall.fixed',
    'wasi:io/streams': 'io.streams.ringbuffer',
    'wasi:io/poll': 'io.poll.scheduler',
    'wasi:io/error': 'io.error.default',
    'wasi:cli/environment': 'cli.env.browser-config',
    'wasi:cli/stdin': 'cli.stdio.capture',
    'wasi:cli/stdout': 'cli.stdio.capture',
    'wasi:cli/stderr': 'cli.stdio.capture',
    'wasi:cli/exit': 'cli.exit.throw',
    'wasi:filesystem/types': 'fs.mem',
    'wasi:filesystem/preopens': 'fs.preopens.static',
    'wasi:sockets/network': 'net.disabled',
    'wasi:sockets/ip-name-lookup': 'dns.static',
    'wasi:sockets/tcp': 'tcp.simulated',
    'wasi:sockets/udp': 'udp.simulated',
    'wasi:http/outgoing-handler': 'http.client.replay',
    'wasi:http/incoming-handler': 'http.server.inprocess',
  },
}

/**
 * Create a provider registry with default bundles
 */
export function createProviderRegistry(
  config: ProviderRegistryConfig = {}
): ProviderRegistry {
  const registry = new ProviderRegistry(config)

  // Register built-in bundles
  registry.registerBundle(browserDefaultBundle)
  registry.registerBundle(nodeDefaultBundle)
  registry.registerBundle(deterministicTestBundle)

  return registry
}
