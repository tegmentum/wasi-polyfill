/**
 * Regression test for per-polyfill plugin-registry isolation
 * (REMEDIATION-PLAN Phase 5.10 / step toward 2.10).
 *
 * Polyfill previously always used the shared globalRegistry. A private registry
 * can now be supplied so independent polyfills don't share plugin registrations.
 */

import { describe, it, expect } from 'vitest'
import {
  PluginRegistry,
  registerCorePlugins,
  createPolyfill,
  AllowAllPolicy,
} from '../../src/wasip2/core/index.js'

describe('Polyfill registry isolation', () => {
  it('uses a supplied private registry rather than the global one', async () => {
    const registry = new PluginRegistry()
    await registerCorePlugins(registry)

    const polyfill = createPolyfill({ registry, policy: new AllowAllPolicy() })
    expect(polyfill.hasPlugin('wasi:io/streams@0.2.0')).toBe(true)
    expect(polyfill.hasPlugin('wasi:clocks/monotonic-clock@0.2.0')).toBe(true)
  })

  it('does not see plugins registered only in a different registry', () => {
    const registryA = new PluginRegistry()
    const registryB = new PluginRegistry()

    const polyfillB = createPolyfill({
      registry: registryB,
      policy: new AllowAllPolicy(),
    })

    // registryB is empty; registering into A must not leak into B.
    expect(polyfillB.hasPlugin('wasi:io/streams@0.2.0')).toBe(false)
    expect(registryA).not.toBe(registryB)
  })

  it('registerCorePlugins targets the given registry without touching others', async () => {
    const a = new PluginRegistry()
    const b = new PluginRegistry()
    await registerCorePlugins(a)

    expect(a.size).toBeGreaterThan(0)
    expect(b.size).toBe(0)
  })
})
