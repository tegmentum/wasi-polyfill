/**
 * Enhanced policy module with quotas, redaction, and feature toggles
 *
 * This extends the core policy with additional capabilities:
 * - Rate limiting and quotas
 * - Sensitive data redaction
 * - Feature flags
 * - Resource limits
 */

import type { WasiInterface, Policy, PluginConfig } from '../core/types.js'
import { parseInterfaceString, interfaceKey } from '../core/types.js'

/**
 * Quota configuration for rate limiting
 */
export interface QuotaConfig {
  /** Maximum operations per time window */
  maxOps?: number
  /** Time window in milliseconds */
  windowMs?: number
  /** Maximum bytes per time window */
  maxBytes?: number
  /** Maximum concurrent connections */
  maxConnections?: number
  /** Maximum open file descriptors */
  maxOpenFiles?: number
  /** Maximum memory usage in bytes */
  maxMemory?: number
}

/**
 * Redaction rules for sensitive data
 */
export interface RedactionConfig {
  /** Environment variable patterns to redact */
  envPatterns?: RegExp[]
  /** Config key patterns to redact */
  configPatterns?: RegExp[]
  /** Header patterns to redact */
  headerPatterns?: RegExp[]
  /** Path patterns to redact from logs */
  pathPatterns?: RegExp[]
  /** Custom redaction function */
  custom?: (key: string, value: string) => string | undefined
}

/**
 * Feature toggle configuration
 */
export interface FeatureToggles {
  /** Enable/disable filesystem access */
  filesystem?: boolean
  /** Enable/disable network access */
  network?: boolean
  /** Enable/disable environment variable access */
  env?: boolean
  /** Enable/disable standard I/O */
  stdio?: boolean
  /** Enable/disable random number generation */
  random?: boolean
  /** Enable/disable clock access */
  clocks?: boolean
  /** Enable/disable sockets */
  sockets?: boolean
  /** Enable/disable HTTP */
  http?: boolean
  /** Custom feature flags */
  [key: string]: boolean | undefined
}

/**
 * Network policy configuration
 */
export interface NetworkPolicy {
  /** Allowed destination hosts (hostname or IP) */
  allowedHosts?: string[]
  /** Allowed destination ports */
  allowedPorts?: number[]
  /** Allowed CIDR ranges */
  allowedCidrs?: string[]
  /** Denied hosts (takes precedence) */
  deniedHosts?: string[]
  /** Whether to allow all destinations */
  allowAll?: boolean
  /** Maximum outbound connections */
  maxConnections?: number
  /** Connection timeout in milliseconds */
  timeoutMs?: number
}

/**
 * Filesystem policy configuration
 */
export interface FilesystemPolicy {
  /** Pre-opened directories */
  preopens?: Array<{
    guest: string
    host?: string
    permissions?: 'read' | 'write' | 'read-write'
  }>
  /** Whether to follow symlinks */
  followSymlinks?: boolean
  /** Maximum file size in bytes */
  maxFileSize?: number
  /** Maximum total disk usage */
  maxDiskUsage?: number
  /** Denied file patterns */
  deniedPatterns?: RegExp[]
}

/**
 * HTTP policy configuration
 */
export interface HttpPolicy {
  /** Allowed request methods */
  allowedMethods?: string[]
  /** Allowed destination origins */
  allowedOrigins?: string[]
  /** Headers to add to all requests */
  addHeaders?: Record<string, string>
  /** Headers to remove from responses */
  stripResponseHeaders?: string[]
  /** Maximum request body size */
  maxRequestBodySize?: number
  /** Maximum response body size */
  maxResponseBodySize?: number
  /** Request timeout in milliseconds */
  timeoutMs?: number
}

/**
 * Enhanced policy configuration
 */
export interface EnhancedPolicyConfig {
  /** Default behavior for interfaces not explicitly configured */
  defaultAllow?: boolean
  /** Interfaces that are explicitly allowed */
  allow?: Array<WasiInterface | string>
  /** Interfaces that are explicitly denied */
  deny?: Array<WasiInterface | string>
  /** Feature toggles */
  features?: FeatureToggles
  /** Quota configuration */
  quotas?: QuotaConfig
  /** Redaction rules */
  redaction?: RedactionConfig
  /** Network policy */
  network?: NetworkPolicy
  /** Filesystem policy */
  filesystem?: FilesystemPolicy
  /** HTTP policy */
  http?: HttpPolicy
  /** Environment variables to expose */
  env?: Record<string, string> | boolean
  /** Command line arguments */
  args?: string[] | boolean
}

/**
 * Quota tracker for rate limiting
 */
export class QuotaTracker {
  private readonly config: QuotaConfig
  private opCount: number = 0
  private byteCount: number = 0
  private connectionCount: number = 0
  private openFileCount: number = 0
  private windowStart: number = Date.now()

  constructor(config: QuotaConfig = {}) {
    this.config = config
  }

  /**
   * Check if an operation is allowed
   */
  checkOp(): boolean {
    this.maybeResetWindow()

    if (this.config.maxOps !== undefined && this.opCount >= this.config.maxOps) {
      return false
    }

    return true
  }

  /**
   * Record an operation
   */
  recordOp(): void {
    this.maybeResetWindow()
    this.opCount++
  }

  /**
   * Check if bytes transfer is allowed
   */
  checkBytes(count: number): boolean {
    this.maybeResetWindow()

    if (this.config.maxBytes !== undefined && this.byteCount + count > this.config.maxBytes) {
      return false
    }

    return true
  }

  /**
   * Record bytes transferred
   */
  recordBytes(count: number): void {
    this.maybeResetWindow()
    this.byteCount += count
  }

  /**
   * Check if a new connection is allowed
   */
  checkConnection(): boolean {
    if (this.config.maxConnections !== undefined && this.connectionCount >= this.config.maxConnections) {
      return false
    }
    return true
  }

  /**
   * Record a connection opened
   */
  recordConnectionOpen(): void {
    this.connectionCount++
  }

  /**
   * Record a connection closed
   */
  recordConnectionClose(): void {
    this.connectionCount = Math.max(0, this.connectionCount - 1)
  }

  /**
   * Check if opening a file is allowed
   */
  checkOpenFile(): boolean {
    if (this.config.maxOpenFiles !== undefined && this.openFileCount >= this.config.maxOpenFiles) {
      return false
    }
    return true
  }

  /**
   * Record a file opened
   */
  recordFileOpen(): void {
    this.openFileCount++
  }

  /**
   * Record a file closed
   */
  recordFileClose(): void {
    this.openFileCount = Math.max(0, this.openFileCount - 1)
  }

  /**
   * Get current quota usage
   */
  getUsage(): {
    ops: number
    bytes: number
    connections: number
    openFiles: number
  } {
    this.maybeResetWindow()
    return {
      ops: this.opCount,
      bytes: this.byteCount,
      connections: this.connectionCount,
      openFiles: this.openFileCount,
    }
  }

  /**
   * Reset the time window if needed
   */
  private maybeResetWindow(): void {
    const now = Date.now()
    const windowMs = this.config.windowMs ?? 60000

    if (now - this.windowStart >= windowMs) {
      this.opCount = 0
      this.byteCount = 0
      this.windowStart = now
    }
  }
}

/**
 * Redactor for sensitive data
 */
export class Redactor {
  private readonly config: RedactionConfig

  constructor(config: RedactionConfig = {}) {
    this.config = config
  }

  /**
   * Redact an environment variable value
   */
  redactEnv(key: string, value: string): string {
    if (this.config.custom) {
      const result = this.config.custom(key, value)
      if (result !== undefined) {
        return result
      }
    }

    for (const pattern of this.config.envPatterns ?? []) {
      if (pattern.test(key)) {
        return '[REDACTED]'
      }
    }

    return value
  }

  /**
   * Redact a config value
   */
  redactConfig(key: string, value: string): string {
    if (this.config.custom) {
      const result = this.config.custom(key, value)
      if (result !== undefined) {
        return result
      }
    }

    for (const pattern of this.config.configPatterns ?? []) {
      if (pattern.test(key)) {
        return '[REDACTED]'
      }
    }

    return value
  }

  /**
   * Redact a header value
   */
  redactHeader(name: string, value: string): string {
    if (this.config.custom) {
      const result = this.config.custom(name, value)
      if (result !== undefined) {
        return result
      }
    }

    for (const pattern of this.config.headerPatterns ?? []) {
      if (pattern.test(name)) {
        return '[REDACTED]'
      }
    }

    return value
  }

  /**
   * Redact a path for logging
   */
  redactPath(path: string): string {
    for (const pattern of this.config.pathPatterns ?? []) {
      if (pattern.test(path)) {
        return '[REDACTED PATH]'
      }
    }

    return path
  }

  /**
   * Redact environment variables object
   */
  redactEnvObject(env: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) {
      result[key] = this.redactEnv(key, value)
    }
    return result
  }

  /**
   * Redact headers object
   */
  redactHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
      result[key] = this.redactHeader(key, value)
    }
    return result
  }
}

/**
 * Default redaction patterns for sensitive data
 */
export const defaultRedactionPatterns: RedactionConfig = {
  envPatterns: [
    /password/i,
    /secret/i,
    /api[_-]?key/i,
    /token/i,
    /auth/i,
    /credential/i,
    /private[_-]?key/i,
  ],
  configPatterns: [
    /password/i,
    /secret/i,
    /key/i,
    /token/i,
  ],
  headerPatterns: [
    /authorization/i,
    /cookie/i,
    /x-api-key/i,
    /x-auth-token/i,
  ],
}

/**
 * Enhanced configurable policy
 */
export class EnhancedPolicy implements Policy {
  private readonly config: EnhancedPolicyConfig
  private readonly allowSet: Set<string>
  private readonly denySet: Set<string>
  private readonly quotaTracker: QuotaTracker
  private readonly redactor: Redactor

  constructor(config: EnhancedPolicyConfig = {}) {
    this.config = config
    this.allowSet = new Set()
    this.denySet = new Set()
    this.quotaTracker = new QuotaTracker(config.quotas)
    this.redactor = new Redactor(config.redaction ?? defaultRedactionPatterns)

    // Build allow set
    for (const iface of config.allow ?? []) {
      const parsed = typeof iface === 'string' ? parseInterfaceString(iface) : iface
      this.allowSet.add(this.makeKey(parsed))
    }

    // Build deny set
    for (const iface of config.deny ?? []) {
      const parsed = typeof iface === 'string' ? parseInterfaceString(iface) : iface
      this.denySet.add(this.makeKey(parsed))
    }
  }

  /**
   * Check if an interface is allowed
   */
  allow(iface: WasiInterface): boolean {
    const key = this.makeKey(iface)

    // Check explicit deny first
    if (this.denySet.has(key)) {
      return false
    }

    // Check feature toggles
    if (!this.checkFeatureToggle(iface)) {
      return false
    }

    // Check explicit allow
    if (this.allowSet.has(key)) {
      return true
    }

    // Fall back to default
    return this.config.defaultAllow ?? false
  }

  /**
   * Get configuration for an interface
   */
  configure(iface: WasiInterface): PluginConfig {
    const config: PluginConfig = { options: {} }

    // Add filesystem configuration
    if (iface.package === 'wasi:filesystem') {
      config.options!['preopens'] = this.config.filesystem?.preopens ?? []
      config.options!['followSymlinks'] = this.config.filesystem?.followSymlinks ?? false
      config.options!['maxFileSize'] = this.config.filesystem?.maxFileSize
    }

    // Add CLI configuration
    if (iface.package === 'wasi:cli') {
      if (iface.name === 'environment') {
        if (this.config.env === true) {
          config.options!['inheritEnv'] = true
        } else if (typeof this.config.env === 'object') {
          config.options!['env'] = this.config.env
        } else {
          config.options!['env'] = {}
        }
      }
    }

    // Add network configuration
    if (iface.package === 'wasi:sockets' || iface.package === 'wasi:http') {
      config.options!['network'] = this.config.network ?? { allowAll: false }
    }

    // Add HTTP configuration
    if (iface.package === 'wasi:http') {
      config.options!['http'] = this.config.http ?? {}
    }

    return config
  }

  /**
   * Get the quota tracker
   */
  getQuotaTracker(): QuotaTracker {
    return this.quotaTracker
  }

  /**
   * Get the redactor
   */
  getRedactor(): Redactor {
    return this.redactor
  }

  /**
   * Check if a network destination is allowed
   */
  checkNetworkDestination(host: string, port: number): boolean {
    const network = this.config.network

    if (!network) {
      return false
    }

    if (network.allowAll) {
      // Check deniedHosts
      if (network.deniedHosts?.includes(host)) {
        return false
      }
      return true
    }

    // Check allowedHosts
    if (network.allowedHosts && !network.allowedHosts.includes(host)) {
      return false
    }

    // Check allowedPorts
    if (network.allowedPorts && !network.allowedPorts.includes(port)) {
      return false
    }

    // Check deniedHosts
    if (network.deniedHosts?.includes(host)) {
      return false
    }

    return true
  }

  /**
   * Check if a filesystem path is allowed
   */
  checkFilesystemPath(path: string): boolean {
    const fs = this.config.filesystem

    if (!fs) {
      return false
    }

    // Check denied patterns
    for (const pattern of fs.deniedPatterns ?? []) {
      if (pattern.test(path)) {
        return false
      }
    }

    return true
  }

  /**
   * Check if an HTTP request is allowed
   */
  checkHttpRequest(method: string, url: string): boolean {
    const http = this.config.http

    if (!http) {
      return true // No HTTP policy means allow all
    }

    // Check method
    if (http.allowedMethods && !http.allowedMethods.includes(method.toUpperCase())) {
      return false
    }

    // Check origin
    if (http.allowedOrigins) {
      try {
        const origin = new URL(url).origin
        if (!http.allowedOrigins.includes(origin)) {
          return false
        }
      } catch {
        return false
      }
    }

    return true
  }

  /**
   * Check feature toggle for an interface
   */
  private checkFeatureToggle(iface: WasiInterface): boolean {
    const features = this.config.features

    if (!features) {
      return true
    }

    switch (iface.package) {
      case 'wasi:filesystem':
        return features.filesystem !== false
      case 'wasi:sockets':
        return features.sockets !== false && features.network !== false
      case 'wasi:http':
        return features.http !== false && features.network !== false
      case 'wasi:random':
        return features.random !== false
      case 'wasi:clocks':
        return features.clocks !== false
      case 'wasi:cli':
        if (iface.name === 'environment') {
          return features.env !== false
        }
        if (iface.name === 'stdin' || iface.name === 'stdout' || iface.name === 'stderr') {
          return features.stdio !== false
        }
        return true
      default:
        return true
    }
  }

  private makeKey(iface: WasiInterface): string {
    return interfaceKey(iface)
  }
}

/**
 * Create an enhanced policy
 */
export function createEnhancedPolicy(config: EnhancedPolicyConfig = {}): EnhancedPolicy {
  return new EnhancedPolicy(config)
}

/**
 * Create a secure policy with sensible defaults
 */
export function createSecurePolicy(config: Partial<EnhancedPolicyConfig> = {}): EnhancedPolicy {
  return new EnhancedPolicy({
    defaultAllow: false,
    features: {
      filesystem: false,
      network: false,
      sockets: false,
      http: false,
      env: false,
      random: true,
      clocks: true,
      stdio: true,
      ...config.features,
    },
    redaction: {
      ...defaultRedactionPatterns,
      ...config.redaction,
    },
    quotas: {
      maxOps: 10000,
      windowMs: 60000,
      maxConnections: 10,
      maxOpenFiles: 100,
      ...config.quotas,
    },
    ...config,
  })
}
