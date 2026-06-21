import { describe, it, expect } from 'vitest'
import { createPolyfill } from '../../src/wasip2/core/polyfill.js'
import { AllowAllPolicy } from '../../src/wasip2/core/policy.js'
import type { WasiPlugin, PluginInstance } from '../../src/wasip2/core/types.js'

// A host plugin for a non-wasi interface (the kind an embedder defines).
function objectRegistryPlugin(): WasiPlugin {
  const witInterface = {
    package: 'openmct:platform',
    name: 'object-registry',
    version: '0.1.0',
  }
  const instance: PluginInstance = {
    getImports: () => ({ register: () => {}, unregister: () => {} }),
    destroy: () => {},
  }
  const impl = { name: 'host', description: 'host', create: () => instance }
  return {
    witInterface,
    implementations: new Map([['host', impl]]),
    defaultImplementation: 'host',
    create: () => instance,
  }
}

describe('custom (non-wasi) interface resolution', () => {
  it('resolves a non-wasi interface through forInterfaces', async () => {
    const polyfill = createPolyfill({ policy: new AllowAllPolicy() })
    polyfill.registerPlugin(objectRegistryPlugin())

    const { imports, denied } = await polyfill.forInterfaces([
      'openmct:platform/object-registry@0.1.0',
    ])

    expect(denied).toEqual([])
    // createPolyfill keys imports with the version suffix (jcoCompat is off).
    const impl = imports['openmct:platform/object-registry@0.1.0'] as
      | Record<string, unknown>
      | undefined
    expect(impl).toBeDefined()
    expect(typeof impl!.register).toBe('function')
    expect(typeof impl!.unregister).toBe('function')
  })
})
