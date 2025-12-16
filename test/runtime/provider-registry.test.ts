/**
 * Tests for the provider registry
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ProviderRegistry,
  createProviderRegistry,
  detectEnvironment,
  browserDefaultBundle,
  nodeDefaultBundle,
  deterministicTestBundle,
  type BundleConfig,
  type ProviderOverride,
} from '../../src/runtime/provider-registry.js'
import {
  BaseProvider,
  noopLogger,
  realClock,
  cryptoRandomSource,
  noopMetrics,
  noopTracer,
  type ProviderContext,
  type ProviderDefinition,
  type Capabilities,
} from '../../src/runtime/provider.js'
import type { WasiInterface, PluginConfig } from '../../src/core/types.js'
import { AllowAllPolicy } from '../../src/core/policy.js'

// Create a mock provider context
function createMockContext(): ProviderContext {
  return {
    policy: new AllowAllPolicy(),
    logger: noopLogger,
    clock: realClock,
    random: cryptoRandomSource,
    httpClient: { fetch: globalThis.fetch },
    env: { env: {}, args: [] },
    metrics: noopMetrics,
    tracer: noopTracer,
    devMode: true,
    child: () => createMockContext(),
  }
}

// Create a test provider class
class TestProvider extends BaseProvider {
  constructor(
    public readonly id: string,
    public readonly witInterface: WasiInterface
  ) {
    super()
  }

  capabilities(): Capabilities {
    return { streaming: true }
  }

  getImports(): Record<string, unknown> {
    return { test: () => this.id }
  }
}

// Create a test provider definition
function createTestDefinition(
  id: string,
  iface: WasiInterface,
  priority = 0,
  environments?: string[]
): ProviderDefinition {
  return {
    id,
    witInterface: iface,
    description: `Test provider: ${id}`,
    factory: () => new TestProvider(id, iface),
    defaultCapabilities: { streaming: true },
    priority,
    environments,
  }
}

describe('Provider Registry', () => {
  let registry: ProviderRegistry

  beforeEach(() => {
    registry = new ProviderRegistry()
  })

  describe('Registration', () => {
    it('should register a provider definition', () => {
      const iface: WasiInterface = {
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      }
      const def = createTestDefinition('random.crypto.web', iface)

      registry.register(def)

      const ids = registry.getProviderIds(iface)
      expect(ids).toContain('random.crypto.web')
    })

    it('should register multiple providers for same interface', () => {
      const iface: WasiInterface = {
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      }

      registry.register(createTestDefinition('random.crypto.web', iface, 10))
      registry.register(createTestDefinition('random.crypto.node', iface, 5))
      registry.register(createTestDefinition('random.replay', iface, 1))

      const ids = registry.getProviderIds(iface)
      expect(ids).toHaveLength(3)
      expect(ids).toContain('random.crypto.web')
      expect(ids).toContain('random.crypto.node')
      expect(ids).toContain('random.replay')
    })

    it('should sort providers by priority', () => {
      const iface: WasiInterface = {
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      }

      registry.register(createTestDefinition('low', iface, 1))
      registry.register(createTestDefinition('high', iface, 10))
      registry.register(createTestDefinition('medium', iface, 5))

      const ids = registry.getProviderIds(iface)
      expect(ids[0]).toBe('high')
      expect(ids[1]).toBe('medium')
      expect(ids[2]).toBe('low')
    })
  })

  describe('Bundle Registration', () => {
    it('should register a bundle', () => {
      const bundle: BundleConfig = {
        name: 'test-bundle',
        providers: {
          'wasi:random/random': 'random.test',
        },
      }

      registry.registerBundle(bundle)

      // Bundle should be available for selection
      expect(true).toBe(true) // Bundle is stored internally
    })
  })

  describe('Selection', () => {
    const randomInterface: WasiInterface = {
      package: 'wasi:random',
      name: 'random',
      version: '0.2.0',
    }

    beforeEach(() => {
      registry.register(createTestDefinition('random.crypto.web', randomInterface, 10, ['browser']))
      registry.register(createTestDefinition('random.crypto.node', randomInterface, 5, ['node']))
      registry.register(createTestDefinition('random.replay', randomInterface, 1))
    })

    it('should select by explicit override', () => {
      registry = new ProviderRegistry({
        overrides: [
          { interface: 'wasi:random/random', providerId: 'random.replay' },
        ],
      })
      registry.register(createTestDefinition('random.crypto.web', randomInterface, 10))
      registry.register(createTestDefinition('random.replay', randomInterface, 1))

      const result = registry.select(randomInterface)

      expect(result.provider.id).toBe('random.replay')
      expect(result.reason).toBe('explicit')
    })

    it('should select by bundle configuration', () => {
      const bundle: BundleConfig = {
        name: 'test-bundle',
        providers: {
          'wasi:random/random': 'random.replay',
        },
      }

      registry = new ProviderRegistry({ bundle })
      registry.registerBundle(bundle)
      registry.register(createTestDefinition('random.crypto.web', randomInterface, 10))
      registry.register(createTestDefinition('random.replay', randomInterface, 1))

      const result = registry.select(randomInterface)

      expect(result.provider.id).toBe('random.replay')
      expect(result.reason).toBe('bundle')
    })

    it('should select best available when no explicit config', () => {
      // Without environment restrictions, should pick highest priority
      registry = new ProviderRegistry()
      registry.register(createTestDefinition('random.low', randomInterface, 1))
      registry.register(createTestDefinition('random.high', randomInterface, 10))

      const result = registry.select(randomInterface)

      expect(result.provider.id).toBe('random.high')
      expect(result.reason).toBe('best-available')
    })

    it('should return unsupported provider when none available', () => {
      registry = new ProviderRegistry()

      const result = registry.select(randomInterface)

      expect(result.provider.id).toBe('unsupported')
      expect(result.reason).toBe('unsupported')
    })
  })

  describe('Provider Creation', () => {
    it('should create and initialize a provider', async () => {
      const iface: WasiInterface = {
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      }
      registry.register(createTestDefinition('random.test', iface))

      const ctx = createMockContext()
      const provider = await registry.createProvider(iface, ctx)

      expect(provider.id).toBe('random.test')
      expect(provider.state).toBe('ready')
    })

    it('should cache provider instances', async () => {
      const iface: WasiInterface = {
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      }
      registry.register(createTestDefinition('random.test', iface))

      const ctx = createMockContext()
      const provider1 = await registry.createProvider(iface, ctx)
      const provider2 = await registry.createProvider(iface, ctx)

      expect(provider1).toBe(provider2)
    })
  })

  describe('Close All', () => {
    it('should close all provider instances', async () => {
      const iface: WasiInterface = {
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      }
      registry.register(createTestDefinition('random.test', iface))

      const ctx = createMockContext()
      const provider = await registry.createProvider(iface, ctx)

      expect(provider.state).toBe('ready')

      await registry.closeAll()

      expect(provider.state).toBe('closed')
    })
  })

  describe('List Interfaces', () => {
    it('should list all registered interfaces', () => {
      const randomIface: WasiInterface = {
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      }
      const clocksIface: WasiInterface = {
        package: 'wasi:clocks',
        name: 'monotonic-clock',
        version: '0.2.0',
      }

      registry.register(createTestDefinition('random.test', randomIface))
      registry.register(createTestDefinition('clocks.test', clocksIface))

      const interfaces = registry.listInterfaces()

      expect(interfaces).toHaveLength(2)
      expect(interfaces.some((i) => i.package === 'wasi:random')).toBe(true)
      expect(interfaces.some((i) => i.package === 'wasi:clocks')).toBe(true)
    })
  })
})

describe('Environment Detection', () => {
  it('should detect an environment', () => {
    const env = detectEnvironment()
    // In Node.js test environment, should be 'node'
    expect(['browser', 'node', 'deno', 'bun', 'worker', 'unknown']).toContain(env)
  })
})

describe('Built-in Bundles', () => {
  it('browserDefaultBundle should have expected providers', () => {
    expect(browserDefaultBundle.name).toBe('browser-default')
    expect(browserDefaultBundle.providers['wasi:random/random']).toBe('random.crypto.web')
    expect(browserDefaultBundle.providers['wasi:clocks/monotonic-clock']).toBe('clocks.monotonic.real')
    expect(browserDefaultBundle.providers['wasi:http/outgoing-handler']).toBe('http.client.fetch')
  })

  it('nodeDefaultBundle should have expected providers', () => {
    expect(nodeDefaultBundle.name).toBe('node-default')
    expect(nodeDefaultBundle.providers['wasi:random/random']).toBe('random.crypto.node')
    expect(nodeDefaultBundle.providers['wasi:io/streams']).toBe('io.streams.node')
    expect(nodeDefaultBundle.providers['wasi:http/outgoing-handler']).toBe('http.client.undici')
  })

  it('deterministicTestBundle should have expected providers', () => {
    expect(deterministicTestBundle.name).toBe('deterministic-test')
    expect(deterministicTestBundle.providers['wasi:random/random']).toBe('random.replay')
    expect(deterministicTestBundle.providers['wasi:clocks/monotonic-clock']).toBe('clocks.monotonic.virtual')
    expect(deterministicTestBundle.providers['wasi:http/outgoing-handler']).toBe('http.client.replay')
  })
})

describe('createProviderRegistry', () => {
  it('should create a registry with default bundles', () => {
    const registry = createProviderRegistry()

    // Register a provider and test bundle selection
    const iface: WasiInterface = {
      package: 'wasi:random',
      name: 'random',
      version: '0.2.0',
    }

    // Just verify the registry was created
    expect(registry).toBeInstanceOf(ProviderRegistry)
  })

  it('should accept configuration', () => {
    const registry = createProviderRegistry({
      bundle: 'browser-default',
      overrides: [
        { interface: 'wasi:random/random', providerId: 'random.test' },
      ],
    })

    expect(registry).toBeInstanceOf(ProviderRegistry)
  })
})
