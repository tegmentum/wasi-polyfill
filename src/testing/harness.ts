/**
 * Test harness for deterministic component testing
 *
 * Provides a unified interface for running WASM components
 * with controllable time, random, and I/O.
 */

import { Polyfill, createPolyfill } from '../core/polyfill.js'
import { AllowAllPolicy } from '../core/policy.js'
import { PluginRegistry } from '../core/plugin-registry.js'
import type { PluginConfig, WasiInterface, PluginInstance, WasiPlugin } from '../core/types.js'
import { VirtualClock, SeededRandom } from '../runtime/provider.js'
import { type BundlePreset, deterministicBundle, getBundlePreset } from './bundles.js'
import { type LogEntry, createBufferLogger, loggingPlugin } from '../plugins/logging/index.js'
import { createMemoryStore, keyvalueStorePlugin } from '../plugins/keyvalue/index.js'
import { createMemoryBlobstore, blobstorePlugin } from '../plugins/blobstore/index.js'
import { randomPlugin, insecureRandomPlugin, insecureSeedPlugin } from '../plugins/random/index.js'
import { monotonicClockPlugin, wallClockPlugin } from '../plugins/clocks/index.js'
import { configStorePlugin } from '../plugins/config/index.js'

/**
 * Test harness configuration
 */
export interface TestHarnessConfig {
  /**
   * Bundle preset to use (default: 'deterministic')
   */
  bundle?: string | BundlePreset

  /**
   * Random seed (default: 0)
   */
  seed?: bigint | number

  /**
   * Initial wall clock time (default: 2024-01-01T00:00:00Z)
   */
  initialTime?: Date

  /**
   * Per-interface configuration overrides
   */
  overrides?: Record<string, PluginConfig>

  /**
   * Initial environment variables
   */
  env?: Record<string, string>

  /**
   * Initial config values
   */
  config?: Record<string, string>

  /**
   * Initial keyvalue data
   * Map of bucket name -> key-value pairs
   */
  kvData?: Map<string, Map<string, Uint8Array>>

  /**
   * Initial blobstore data
   * Map of container name -> object name -> data
   */
  blobData?: Map<string, Map<string, Uint8Array>>
}

/**
 * Test snapshot for verification
 */
export interface TestSnapshot {
  /**
   * Captured log entries
   */
  logs: LogEntry[]

  /**
   * Final clock time (monotonic nanoseconds)
   */
  monotonicTime: bigint

  /**
   * Final wall clock time
   */
  wallTime: { seconds: bigint; nanoseconds: number }

  /**
   * Exit code if component exited
   */
  exitCode?: number
}

/**
 * Test result
 */
export interface TestResult {
  /**
   * Whether the test completed successfully
   */
  success: boolean

  /**
   * Error if test failed
   */
  error?: Error

  /**
   * Test snapshot
   */
  snapshot: TestSnapshot

  /**
   * Duration in milliseconds (real time)
   */
  durationMs: number
}

/**
 * Test harness for running WASM components deterministically
 *
 * Example usage:
 * ```typescript
 * const harness = createTestHarness({ seed: 42n })
 *
 * // Get imports for your component
 * const { imports } = await harness.getImports([
 *   { package: 'wasi:random', name: 'random', version: '0.2.0' }
 * ])
 *
 * // Run your component...
 *
 * // Advance time
 * harness.advanceTime(1_000_000_000n) // 1 second
 *
 * // Get results
 * const snapshot = harness.getSnapshot()
 * expect(snapshot.logs).toHaveLength(5)
 *
 * // Clean up
 * harness.destroy()
 * ```
 */
/**
 * Default plugins to register
 */
const DEFAULT_PLUGINS: WasiPlugin[] = [
  randomPlugin,
  insecureRandomPlugin,
  insecureSeedPlugin,
  monotonicClockPlugin,
  wallClockPlugin,
  loggingPlugin,
  keyvalueStorePlugin,
  blobstorePlugin,
  configStorePlugin,
]

export class TestHarness {
  private readonly polyfill: Polyfill
  private readonly registry: PluginRegistry
  private readonly clock: VirtualClock
  private readonly random: SeededRandom
  private readonly bundle: BundlePreset
  private readonly instances: Map<string, PluginInstance> = new Map()
  private exitCode?: number

  // Direct access to stores for assertions
  private logBuffer?: ReturnType<typeof createBufferLogger>['buffer']
  private kvStore?: ReturnType<typeof createMemoryStore>['store']
  private blobStore?: ReturnType<typeof createMemoryBlobstore>['store']

  constructor(config: TestHarnessConfig = {}) {
    // Resolve bundle
    if (typeof config.bundle === 'string') {
      this.bundle = getBundlePreset(config.bundle) ?? deterministicBundle
    } else {
      this.bundle = config.bundle ?? deterministicBundle
    }

    // Create shared resources
    const seed = config.seed !== undefined ? BigInt(config.seed) : 0n
    this.random = new SeededRandom(seed)
    this.clock = new VirtualClock(config.initialTime ?? new Date('2024-01-01T00:00:00Z'))

    // Create a private registry for this harness
    this.registry = new PluginRegistry()

    // Register default plugins
    for (const plugin of DEFAULT_PLUGINS) {
      this.registry.register(plugin)
    }

    // Create polyfill with allow-all policy for testing
    this.polyfill = createPolyfill({
      policy: new AllowAllPolicy(),
    })
  }

  /**
   * Get imports for a list of interfaces
   */
  async getImports(
    required: WasiInterface[]
  ): Promise<{ imports: Record<string, Record<string, unknown>> }> {
    const imports: Record<string, Record<string, unknown>> = {}

    for (const iface of required) {
      const key = `${iface.package}/${iface.name}`
      const importKey = `${iface.package}/${iface.name}@${iface.version}`

      // Get plugin from our private registry
      const plugin = await this.registry.get(iface)
      if (!plugin) {
        continue
      }

      // Get config from bundle
      const bundleConfig = this.bundle.plugins[key] ?? {}
      const impl = this.bundle.implementations[key]
      const config: PluginConfig = {
        ...bundleConfig,
        clock: this.clock,
        random: this.random,
      }
      if (impl) {
        config.implementation = impl
      }

      // Create instance
      const instance = plugin.create(config)
      this.instances.set(key, instance)

      // Track special instances for direct access
      this.trackInstance(key, instance)

      // Get imports
      const pluginImports = instance.getImports()
      imports[importKey] = pluginImports
    }

    return { imports }
  }

  /**
   * Track special instances for direct access in tests
   */
  private trackInstance(key: string, instance: PluginInstance): void {
    // Buffer logger
    if (key === 'wasi:logging/logging') {
      const typedInstance = instance as unknown as {
        getEntries: () => LogEntry[]
        clear: () => void
        count: number
        hasErrors: boolean
      }
      if (typeof typedInstance.getEntries === 'function') {
        this.logBuffer = typedInstance as unknown as ReturnType<typeof createBufferLogger>['buffer']
      }
    }
  }

  /**
   * Advance virtual time
   */
  advanceTime(nanoseconds: bigint): void {
    this.clock.advance(nanoseconds)
  }

  /**
   * Advance time in milliseconds
   */
  advanceTimeMs(milliseconds: number): void {
    this.advanceTime(BigInt(milliseconds) * 1_000_000n)
  }

  /**
   * Advance time in seconds
   */
  advanceTimeSeconds(seconds: number): void {
    this.advanceTime(BigInt(seconds) * 1_000_000_000n)
  }

  /**
   * Set wall clock time
   */
  setWallTime(date: Date): void {
    this.clock.setWallTime(date)
  }

  /**
   * Record component exit
   */
  recordExit(code: number): void {
    this.exitCode = code
  }

  /**
   * Get current snapshot
   */
  getSnapshot(): TestSnapshot {
    return {
      logs: this.logBuffer?.getEntries() ? [...this.logBuffer.getEntries()] : [],
      monotonicTime: this.clock.monotonicNow(),
      wallTime: this.clock.wallNow(),
      exitCode: this.exitCode,
    }
  }

  /**
   * Get the virtual clock
   */
  getClock(): VirtualClock {
    return this.clock
  }

  /**
   * Get the seeded random
   */
  getRandom(): SeededRandom {
    return this.random
  }

  /**
   * Get captured logs
   */
  getLogs(): readonly LogEntry[] {
    return this.logBuffer?.getEntries() ?? []
  }

  /**
   * Get logs at or above a level
   */
  getLogsAtLevel(minLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical'): LogEntry[] {
    return this.logBuffer?.getEntriesAtLevel(minLevel) ?? []
  }

  /**
   * Check if any errors were logged
   */
  hasLogErrors(): boolean {
    return this.logBuffer?.hasErrors ?? false
  }

  /**
   * Clear captured logs
   */
  clearLogs(): void {
    this.logBuffer?.clear()
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    for (const instance of this.instances.values()) {
      try {
        instance.destroy()
      } catch {
        // Ignore cleanup errors
      }
    }
    this.instances.clear()
    this.polyfill.destroy()
  }
}

/**
 * Create a test harness with default deterministic settings
 */
export function createTestHarness(config?: TestHarnessConfig): TestHarness {
  return new TestHarness(config)
}

/**
 * Run a test with automatic cleanup
 */
export async function withTestHarness<T>(
  config: TestHarnessConfig,
  fn: (harness: TestHarness) => Promise<T>
): Promise<T> {
  const harness = createTestHarness(config)
  try {
    return await fn(harness)
  } finally {
    harness.destroy()
  }
}
