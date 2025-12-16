import { describe, it, expect } from 'vitest'
import {
  DenyAllPolicy,
  AllowAllPolicy,
  ConfigurablePolicy,
  createSafePolicy,
  createCliPolicy,
  mergePolicies,
} from '../../src/core/policy.js'
import type { WasiInterface } from '../../src/core/types.js'

const randomInterface: WasiInterface = {
  package: 'wasi:random',
  name: 'random',
  version: '0.2.0',
}

const filesystemInterface: WasiInterface = {
  package: 'wasi:filesystem',
  name: 'types',
  version: '0.2.0',
}

const socketsInterface: WasiInterface = {
  package: 'wasi:sockets',
  name: 'tcp',
  version: '0.2.0',
}

describe('DenyAllPolicy', () => {
  const policy = new DenyAllPolicy()

  it('denies all interfaces', () => {
    expect(policy.allow(randomInterface)).toBe(false)
    expect(policy.allow(filesystemInterface)).toBe(false)
    expect(policy.allow(socketsInterface)).toBe(false)
  })

  it('returns empty configuration', () => {
    expect(policy.configure(randomInterface)).toEqual({})
  })
})

describe('AllowAllPolicy', () => {
  const policy = new AllowAllPolicy()

  it('allows all interfaces', () => {
    expect(policy.allow(randomInterface)).toBe(true)
    expect(policy.allow(filesystemInterface)).toBe(true)
    expect(policy.allow(socketsInterface)).toBe(true)
  })

  it('returns empty configuration', () => {
    expect(policy.configure(randomInterface)).toEqual({})
  })
})

describe('ConfigurablePolicy', () => {
  describe('with default deny', () => {
    const policy = new ConfigurablePolicy({
      defaultAllow: false,
      allow: [randomInterface],
    })

    it('allows explicitly allowed interfaces', () => {
      expect(policy.allow(randomInterface)).toBe(true)
    })

    it('denies non-allowed interfaces', () => {
      expect(policy.allow(filesystemInterface)).toBe(false)
    })
  })

  describe('with default allow', () => {
    const policy = new ConfigurablePolicy({
      defaultAllow: true,
      deny: [socketsInterface],
    })

    it('allows interfaces not explicitly denied', () => {
      expect(policy.allow(randomInterface)).toBe(true)
      expect(policy.allow(filesystemInterface)).toBe(true)
    })

    it('denies explicitly denied interfaces', () => {
      expect(policy.allow(socketsInterface)).toBe(false)
    })
  })

  describe('with string interfaces', () => {
    const policy = new ConfigurablePolicy({
      defaultAllow: false,
      allow: ['wasi:random/random@0.2.0'],
    })

    it('parses string interfaces', () => {
      expect(policy.allow(randomInterface)).toBe(true)
    })
  })

  describe('with overrides', () => {
    const policy = new ConfigurablePolicy({
      defaultAllow: true,
      overrides: [
        {
          interface: randomInterface,
          enabled: false,
        },
        {
          interface: filesystemInterface,
          implementation: 'opfs',
        },
      ],
    })

    it('respects enabled override', () => {
      expect(policy.allow(randomInterface)).toBe(false)
    })

    it('includes implementation in configuration', () => {
      const config = policy.configure(filesystemInterface)
      expect(config.implementation).toBe('opfs')
    })
  })

  describe('interface-specific configuration', () => {
    it('adds preopens for filesystem interfaces', () => {
      const policy = new ConfigurablePolicy({
        defaultAllow: true,
        preopens: ['/data', '/tmp'],
      })

      const config = policy.configure(filesystemInterface)
      expect(config.options?.['preopens']).toEqual(['/data', '/tmp'])
    })

    it('adds env for cli/environment interface', () => {
      const policy = new ConfigurablePolicy({
        defaultAllow: true,
        env: { FOO: 'bar' },
      })

      const envInterface: WasiInterface = {
        package: 'wasi:cli',
        name: 'environment',
        version: '0.2.0',
      }

      const config = policy.configure(envInterface)
      expect(config.options?.['env']).toEqual({ FOO: 'bar' })
    })

    it('adds network config for sockets interfaces', () => {
      const policy = new ConfigurablePolicy({
        defaultAllow: true,
        network: { allowedHosts: ['api.example.com'] },
      })

      const config = policy.configure(socketsInterface)
      expect(config.options?.['network']).toEqual({
        allowedHosts: ['api.example.com'],
      })
    })
  })
})

describe('createSafePolicy', () => {
  const policy = createSafePolicy()

  it('allows random interfaces', () => {
    expect(policy.allow(randomInterface)).toBe(true)
  })

  it('allows clock interfaces', () => {
    const clockInterface: WasiInterface = {
      package: 'wasi:clocks',
      name: 'monotonic-clock',
      version: '0.2.0',
    }
    expect(policy.allow(clockInterface)).toBe(true)
  })

  it('denies filesystem interfaces', () => {
    expect(policy.allow(filesystemInterface)).toBe(false)
  })

  it('denies sockets interfaces', () => {
    expect(policy.allow(socketsInterface)).toBe(false)
  })
})

describe('createCliPolicy', () => {
  it('allows CLI interfaces', () => {
    const policy = createCliPolicy()

    const stdinInterface: WasiInterface = {
      package: 'wasi:cli',
      name: 'stdin',
      version: '0.2.0',
    }

    expect(policy.allow(stdinInterface)).toBe(true)
  })

  it('accepts custom env and args', () => {
    const policy = createCliPolicy({
      env: { NODE_ENV: 'test' },
      args: ['--verbose'],
    })

    expect(policy.allow(randomInterface)).toBe(true)
  })
})

describe('mergePolicies', () => {
  const denyAll = new DenyAllPolicy()
  const allowAll = new AllowAllPolicy()

  it('allows if any policy allows', () => {
    const merged = mergePolicies(denyAll, allowAll)
    expect(merged.allow(randomInterface)).toBe(true)
  })

  it('denies if all policies deny', () => {
    const merged = mergePolicies(denyAll, denyAll)
    expect(merged.allow(randomInterface)).toBe(false)
  })

  it('uses configuration from first allowing policy', () => {
    const policy1 = new ConfigurablePolicy({
      defaultAllow: true,
      overrides: [{ interface: randomInterface, implementation: 'impl1' }],
    })
    const policy2 = new ConfigurablePolicy({
      defaultAllow: true,
      overrides: [{ interface: randomInterface, implementation: 'impl2' }],
    })

    const merged = mergePolicies(policy1, policy2)
    const config = merged.configure(randomInterface)
    expect(config.implementation).toBe('impl1')
  })
})
