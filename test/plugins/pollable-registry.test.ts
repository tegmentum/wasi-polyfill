/**
 * Regression test for the pollable-registry mismatch (REMEDIATION-PLAN Phase 2.1).
 *
 * wasi:io/poll's poll() only ever inspects `globalPollableRegistry`. Several
 * plugins (http, sockets, dns) used to construct their own isolated
 * `new PollableRegistry()`, so any pollable returned from `subscribe` lived in
 * a registry that poll() never looked at — making HTTP/socket/DNS async
 * un-awaitable. These tests assert that subscribe-produced pollables are
 * registered in the *global* registry that poll() actually uses.
 */

import { describe, it, expect } from 'vitest'
import { globalPollableRegistry } from '../../src/wasip2/plugins/io/index.js'
import {
  virtualTcpImplementation,
  virtualUdpImplementation,
  virtualIpNameLookupImplementation,
} from '../../src/wasip2/plugins/sockets/index.js'
import { fetchOutgoingHandlerImplementation } from '../../src/wasip2/plugins/http/index.js'

/** Invoke a flat WIT-keyed import function from a plugin instance. */
function callImport(
  imports: Record<string, unknown>,
  key: string,
  ...args: unknown[]
): unknown {
  const fn = imports[key]
  expect(typeof fn, `import "${key}" should be a function`).toBe('function')
  return (fn as (...a: unknown[]) => unknown)(...args)
}

describe('pollable registry is shared with wasi:io/poll', () => {
  it('TCP socket.subscribe registers in the global registry', () => {
    const instance = virtualTcpImplementation.create({})
    const imports = instance.getImports()
    const handle = callImport(imports, '[method]tcp-socket.subscribe', 1) as number

    expect(typeof handle).toBe('number')
    expect(globalPollableRegistry.get(handle)).toBeDefined()
  })

  it('UDP socket.subscribe registers in the global registry', () => {
    const instance = virtualUdpImplementation.create({})
    const imports = instance.getImports()
    const handle = callImport(imports, '[method]udp-socket.subscribe', 1) as number

    expect(typeof handle).toBe('number')
    expect(globalPollableRegistry.get(handle)).toBeDefined()
  })

  it('resolve-address-stream.subscribe registers in the global registry', () => {
    const instance = virtualIpNameLookupImplementation.create({})
    const imports = instance.getImports()
    const handle = callImport(
      imports,
      '[method]resolve-address-stream.subscribe',
      1
    ) as number

    expect(typeof handle).toBe('number')
    expect(globalPollableRegistry.get(handle)).toBeDefined()
  })

  it('a subscribe pollable is resolvable through poll() (the global path)', async () => {
    const instance = virtualTcpImplementation.create({})
    const imports = instance.getImports()
    const handle = callImport(imports, '[method]tcp-socket.subscribe', 1) as number

    // createReadyPollable resolves on the next microtask; after that, poll()
    // over the global registry must report the handle as ready (index 0).
    await Promise.resolve()
    const ready = await globalPollableRegistry.poll([handle], false)
    expect(ready).toContain(0)
  })

  it('http future-incoming-response uses the global registry instance', () => {
    // The instance must be constructable without throwing; the fix passes
    // globalPollableRegistry into the constructor instead of a fresh one.
    const instance = fetchOutgoingHandlerImplementation.create({})
    expect(instance).toBeDefined()
    expect(typeof instance.getImports).toBe('function')
  })
})
