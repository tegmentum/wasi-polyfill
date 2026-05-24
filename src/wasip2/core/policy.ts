/**
 * Security policy engine for controlling WASI interface access
 */

import type {
  Policy,
  PluginConfig,
  PluginOverride,
  WasiInterface,
} from './types.js'
import { parseInterfaceString, interfaceKey } from './types.js'

/**
 * Configuration for building a policy
 */
export interface PolicyConfig {
  /** Default behavior for interfaces not explicitly configured */
  defaultAllow?: boolean
  /** Interfaces that are explicitly allowed */
  allow?: Array<WasiInterface | string>
  /** Interfaces that are explicitly denied */
  deny?: Array<WasiInterface | string>
  /** Configuration overrides per interface */
  overrides?: PluginOverride[]
  /** Filesystem preopens (paths the component can access) */
  preopens?: string[]
  /** Environment variables to expose */
  env?: Record<string, string> | boolean
  /** Command line arguments */
  args?: string[] | boolean
  /** Network access configuration */
  network?: {
    /** Allowed hosts for outbound connections */
    allowedHosts?: string[]
    /** Whether to allow all outbound connections */
    allowAll?: boolean
  }
}

/**
 * Default deny-all policy
 *
 * This policy denies all interfaces by default.
 * Use this as a starting point for secure configurations.
 */
export class DenyAllPolicy implements Policy {
  allow(_iface: WasiInterface): boolean {
    return false
  }

  configure(_iface: WasiInterface): PluginConfig {
    return {}
  }
}

/**
 * Default allow-all policy
 *
 * This policy allows all interfaces with default configuration.
 * Use this for development/testing only.
 */
export class AllowAllPolicy implements Policy {
  allow(_iface: WasiInterface): boolean {
    return true
  }

  configure(_iface: WasiInterface): PluginConfig {
    return {}
  }
}

/**
 * Configurable policy
 *
 * Allows fine-grained control over which interfaces are allowed
 * and how they are configured.
 */
export class ConfigurablePolicy implements Policy {
  private readonly config: PolicyConfig
  private readonly allowSet: Set<string>
  private readonly denySet: Set<string>
  private readonly overrideMap: Map<string, PluginOverride>

  constructor(config: PolicyConfig = {}) {
    this.config = config
    this.allowSet = new Set()
    this.denySet = new Set()
    this.overrideMap = new Map()

    // Build allow set
    for (const iface of config.allow ?? []) {
      const parsed =
        typeof iface === 'string' ? parseInterfaceString(iface) : iface
      this.allowSet.add(this.makeKey(parsed))
    }

    // Build deny set
    for (const iface of config.deny ?? []) {
      const parsed =
        typeof iface === 'string' ? parseInterfaceString(iface) : iface
      this.denySet.add(this.makeKey(parsed))
    }

    // Build override map
    for (const override of config.overrides ?? []) {
      const iface =
        typeof override.interface === 'string'
          ? parseInterfaceString(override.interface)
          : override.interface
      this.overrideMap.set(this.makeKey(iface), override)
    }
  }

  allow(iface: WasiInterface): boolean {
    const key = this.makeKey(iface)

    // Check explicit deny first
    if (this.denySet.has(key)) {
      return false
    }

    // Check override enabled flag
    const override = this.overrideMap.get(key)
    if (override?.enabled === false) {
      return false
    }

    // Check explicit allow
    if (this.allowSet.has(key)) {
      return true
    }

    // Fall back to default
    return this.config.defaultAllow ?? false
  }

  configure(iface: WasiInterface): PluginConfig {
    const key = this.makeKey(iface)
    const override = this.overrideMap.get(key)

    const config: PluginConfig = {}

    if (override?.implementation !== undefined) {
      config.implementation = override.implementation
    }

    if (override?.options !== undefined) {
      config.options = { ...override.options }
    }

    // Add interface-specific configuration
    this.addInterfaceConfig(iface, config)

    return config
  }

  private addInterfaceConfig(iface: WasiInterface, config: PluginConfig): void {
    config.options = config.options ?? {}

    // Filesystem configuration
    if (iface.package === 'wasi:filesystem') {
      if (config.options['preopens'] === undefined) {
        config.options['preopens'] = this.config.preopens ?? []
      }
    }

    // CLI configuration
    if (iface.package === 'wasi:cli') {
      if (iface.name === 'environment') {
        if (config.options['inheritEnv'] === undefined && config.options['env'] === undefined) {
          if (this.config.env === true) {
            // Expose all environment variables (not recommended)
            config.options['inheritEnv'] = true
          } else if (typeof this.config.env === 'object') {
            config.options['env'] = this.config.env
          } else {
            config.options['env'] = {}
          }
        }
      }

      if (iface.name === 'environment') {
        if (config.options['inheritArgs'] === undefined && config.options['args'] === undefined) {
          if (this.config.args === true) {
            config.options['inheritArgs'] = true
          } else if (Array.isArray(this.config.args)) {
            config.options['args'] = this.config.args
          } else {
            config.options['args'] = []
          }
        }
      }
    }

    // Network configuration
    if (iface.package === 'wasi:sockets' || iface.package === 'wasi:http') {
      if (config.options['network'] === undefined) {
        config.options['network'] = this.config.network ?? { allowAll: false }
      }
    }
  }

  private makeKey(iface: WasiInterface): string {
    return interfaceKey(iface)
  }
}

/**
 * Create a policy from configuration
 */
export function createPolicy(config: PolicyConfig): Policy {
  return new ConfigurablePolicy(config)
}

/**
 * Create a minimal safe policy
 *
 * Allows only basic, safe interfaces:
 * - random (cryptographic randomness)
 * - clocks (time measurement)
 *
 * Denies filesystem, network, and other potentially dangerous interfaces.
 */
export function createSafePolicy(): Policy {
  return new ConfigurablePolicy({
    defaultAllow: false,
    allow: [
      { package: 'wasi:random', name: 'random', version: '0.2.0' },
      { package: 'wasi:random', name: 'insecure', version: '0.2.0' },
      { package: 'wasi:random', name: 'insecure-seed', version: '0.2.0' },
      { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
      { package: 'wasi:clocks', name: 'wall-clock', version: '0.2.0' },
    ],
  })
}

/**
 * Create a CLI-friendly policy
 *
 * Allows interfaces typically needed by command-line applications:
 * - random, clocks
 * - cli (environment, args, stdin/stdout/stderr)
 * - io (streams)
 *
 * Does not allow filesystem or network by default.
 */
export function createCliPolicy(options?: {
  env?: Record<string, string>
  args?: string[]
}): Policy {
  return new ConfigurablePolicy({
    defaultAllow: false,
    allow: [
      { package: 'wasi:random', name: 'random', version: '0.2.0' },
      { package: 'wasi:random', name: 'insecure', version: '0.2.0' },
      { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
      { package: 'wasi:clocks', name: 'wall-clock', version: '0.2.0' },
      { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
      { package: 'wasi:cli', name: 'stdin', version: '0.2.0' },
      { package: 'wasi:cli', name: 'stdout', version: '0.2.0' },
      { package: 'wasi:cli', name: 'stderr', version: '0.2.0' },
      // Terminal interfaces: jco-transpiled CLI components routinely import
      // these (and the jco bridge wraps their return values), so a "CLI-friendly"
      // policy must allow them or such components throw PolicyDeniedError.
      { package: 'wasi:cli', name: 'terminal-input', version: '0.2.0' },
      { package: 'wasi:cli', name: 'terminal-output', version: '0.2.0' },
      { package: 'wasi:cli', name: 'terminal-stdin', version: '0.2.0' },
      { package: 'wasi:cli', name: 'terminal-stdout', version: '0.2.0' },
      { package: 'wasi:cli', name: 'terminal-stderr', version: '0.2.0' },
      { package: 'wasi:cli', name: 'exit', version: '0.2.0' },
      { package: 'wasi:io', name: 'streams', version: '0.2.0' },
      { package: 'wasi:io', name: 'error', version: '0.2.0' },
      { package: 'wasi:io', name: 'poll', version: '0.2.0' },
    ],
    env: options?.env ?? {},
    args: options?.args ?? [],
  })
}

/**
 * Merge multiple policies
 *
 * Creates a policy that allows an interface if ANY of the input policies allow it.
 * Configuration is taken from the first policy that allows the interface.
 */
export function mergePolicies(...policies: Policy[]): Policy {
  return {
    allow(iface: WasiInterface): boolean {
      return policies.some((p) => p.allow(iface))
    },
    configure(iface: WasiInterface): PluginConfig {
      for (const policy of policies) {
        if (policy.allow(iface)) {
          return policy.configure(iface)
        }
      }
      return {}
    },
  }
}
