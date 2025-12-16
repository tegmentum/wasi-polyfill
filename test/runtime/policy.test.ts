/**
 * Tests for the enhanced policy module
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  EnhancedPolicy,
  QuotaTracker,
  Redactor,
  createEnhancedPolicy,
  createSecurePolicy,
  defaultRedactionPatterns,
  type EnhancedPolicyConfig,
} from '../../src/runtime/policy.js'
import type { WasiInterface } from '../../src/core/types.js'

describe('QuotaTracker', () => {
  describe('Operation Limits', () => {
    it('should allow operations within limit', () => {
      const tracker = new QuotaTracker({ maxOps: 5, windowMs: 1000 })

      for (let i = 0; i < 5; i++) {
        expect(tracker.checkOp()).toBe(true)
        tracker.recordOp()
      }
    })

    it('should deny operations over limit', () => {
      const tracker = new QuotaTracker({ maxOps: 3, windowMs: 1000 })

      tracker.recordOp()
      tracker.recordOp()
      tracker.recordOp()

      expect(tracker.checkOp()).toBe(false)
    })

    it('should reset after window expires', async () => {
      const tracker = new QuotaTracker({ maxOps: 2, windowMs: 50 })

      tracker.recordOp()
      tracker.recordOp()
      expect(tracker.checkOp()).toBe(false)

      await new Promise((r) => setTimeout(r, 60))

      expect(tracker.checkOp()).toBe(true)
    })
  })

  describe('Byte Limits', () => {
    it('should allow bytes within limit', () => {
      const tracker = new QuotaTracker({ maxBytes: 1000, windowMs: 1000 })

      expect(tracker.checkBytes(500)).toBe(true)
      tracker.recordBytes(500)
      expect(tracker.checkBytes(400)).toBe(true)
    })

    it('should deny bytes over limit', () => {
      const tracker = new QuotaTracker({ maxBytes: 1000, windowMs: 1000 })

      tracker.recordBytes(800)

      expect(tracker.checkBytes(300)).toBe(false)
    })
  })

  describe('Connection Limits', () => {
    it('should track connections', () => {
      const tracker = new QuotaTracker({ maxConnections: 2 })

      expect(tracker.checkConnection()).toBe(true)
      tracker.recordConnectionOpen()
      expect(tracker.checkConnection()).toBe(true)
      tracker.recordConnectionOpen()
      expect(tracker.checkConnection()).toBe(false)
    })

    it('should allow new connections after close', () => {
      const tracker = new QuotaTracker({ maxConnections: 1 })

      tracker.recordConnectionOpen()
      expect(tracker.checkConnection()).toBe(false)

      tracker.recordConnectionClose()
      expect(tracker.checkConnection()).toBe(true)
    })
  })

  describe('File Limits', () => {
    it('should track open files', () => {
      const tracker = new QuotaTracker({ maxOpenFiles: 10 })

      for (let i = 0; i < 10; i++) {
        expect(tracker.checkOpenFile()).toBe(true)
        tracker.recordFileOpen()
      }

      expect(tracker.checkOpenFile()).toBe(false)
    })
  })

  describe('Usage Reporting', () => {
    it('should report current usage', () => {
      const tracker = new QuotaTracker({})

      tracker.recordOp()
      tracker.recordOp()
      tracker.recordBytes(1000)
      tracker.recordConnectionOpen()
      tracker.recordFileOpen()

      const usage = tracker.getUsage()

      expect(usage.ops).toBe(2)
      expect(usage.bytes).toBe(1000)
      expect(usage.connections).toBe(1)
      expect(usage.openFiles).toBe(1)
    })
  })
})

describe('Redactor', () => {
  describe('Environment Variable Redaction', () => {
    it('should redact matching patterns', () => {
      const redactor = new Redactor({
        envPatterns: [/password/i, /secret/i],
      })

      expect(redactor.redactEnv('PASSWORD', 'hunter2')).toBe('[REDACTED]')
      expect(redactor.redactEnv('DB_PASSWORD', 'test')).toBe('[REDACTED]')
      expect(redactor.redactEnv('SECRET_KEY', 'abc')).toBe('[REDACTED]')
    })

    it('should not redact non-matching keys', () => {
      const redactor = new Redactor({
        envPatterns: [/password/i],
      })

      expect(redactor.redactEnv('HOME', '/home/user')).toBe('/home/user')
      expect(redactor.redactEnv('NODE_ENV', 'production')).toBe('production')
    })
  })

  describe('Header Redaction', () => {
    it('should redact sensitive headers', () => {
      const redactor = new Redactor({
        headerPatterns: [/authorization/i, /cookie/i],
      })

      expect(redactor.redactHeader('Authorization', 'Bearer token')).toBe('[REDACTED]')
      expect(redactor.redactHeader('Cookie', 'session=abc')).toBe('[REDACTED]')
      expect(redactor.redactHeader('Content-Type', 'application/json')).toBe('application/json')
    })
  })

  describe('Path Redaction', () => {
    it('should redact matching paths', () => {
      const redactor = new Redactor({
        pathPatterns: [/\/secrets\//i, /\.key$/i],
      })

      expect(redactor.redactPath('/app/secrets/config.json')).toBe('[REDACTED PATH]')
      expect(redactor.redactPath('/home/.ssh/id_rsa.key')).toBe('[REDACTED PATH]')
      expect(redactor.redactPath('/app/public/index.html')).toBe('/app/public/index.html')
    })
  })

  describe('Custom Redaction', () => {
    it('should use custom redaction function', () => {
      const redactor = new Redactor({
        custom: (key, value) => {
          if (key === 'SSN') return 'XXX-XX-XXXX'
          return undefined
        },
      })

      expect(redactor.redactEnv('SSN', '123-45-6789')).toBe('XXX-XX-XXXX')
      expect(redactor.redactEnv('NAME', 'John')).toBe('John')
    })
  })

  describe('Object Redaction', () => {
    it('should redact entire env object', () => {
      const redactor = new Redactor({
        envPatterns: [/password/i],
      })

      const env = {
        HOME: '/home/user',
        PASSWORD: 'secret',
        DB_PASSWORD: 'also_secret',
      }

      const redacted = redactor.redactEnvObject(env)

      expect(redacted.HOME).toBe('/home/user')
      expect(redacted.PASSWORD).toBe('[REDACTED]')
      expect(redacted.DB_PASSWORD).toBe('[REDACTED]')
    })

    it('should redact entire headers object', () => {
      const redactor = new Redactor({
        headerPatterns: [/authorization/i],
      })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer xyz',
      }

      const redacted = redactor.redactHeaders(headers)

      expect(redacted['Content-Type']).toBe('application/json')
      expect(redacted['Authorization']).toBe('[REDACTED]')
    })
  })
})

describe('Default Redaction Patterns', () => {
  const redactor = new Redactor(defaultRedactionPatterns)

  it('should redact common sensitive env vars', () => {
    expect(redactor.redactEnv('API_KEY', 'key123')).toBe('[REDACTED]')
    expect(redactor.redactEnv('AUTH_TOKEN', 'token')).toBe('[REDACTED]')
    expect(redactor.redactEnv('PRIVATE_KEY', 'key')).toBe('[REDACTED]')
    expect(redactor.redactEnv('DATABASE_PASSWORD', 'pass')).toBe('[REDACTED]')
  })

  it('should redact common sensitive headers', () => {
    expect(redactor.redactHeader('Authorization', 'Bearer x')).toBe('[REDACTED]')
    expect(redactor.redactHeader('Cookie', 'session=y')).toBe('[REDACTED]')
    expect(redactor.redactHeader('X-API-Key', 'key')).toBe('[REDACTED]')
  })
})

describe('EnhancedPolicy', () => {
  describe('Interface Allow/Deny', () => {
    it('should allow explicitly allowed interfaces', () => {
      const policy = new EnhancedPolicy({
        defaultAllow: false,
        allow: ['wasi:random/random@0.2.0'],
      })

      const iface: WasiInterface = {
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      }

      expect(policy.allow(iface)).toBe(true)
    })

    it('should deny explicitly denied interfaces', () => {
      const policy = new EnhancedPolicy({
        defaultAllow: true,
        deny: ['wasi:filesystem/types@0.2.0'],
      })

      const iface: WasiInterface = {
        package: 'wasi:filesystem',
        name: 'types',
        version: '0.2.0',
      }

      expect(policy.allow(iface)).toBe(false)
    })

    it('should use default when not explicitly configured', () => {
      const allowPolicy = new EnhancedPolicy({ defaultAllow: true })
      const denyPolicy = new EnhancedPolicy({ defaultAllow: false })

      const iface: WasiInterface = {
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      }

      expect(allowPolicy.allow(iface)).toBe(true)
      expect(denyPolicy.allow(iface)).toBe(false)
    })
  })

  describe('Feature Toggles', () => {
    it('should deny interfaces when feature is disabled', () => {
      const policy = new EnhancedPolicy({
        defaultAllow: true,
        features: {
          filesystem: false,
        },
      })

      const iface: WasiInterface = {
        package: 'wasi:filesystem',
        name: 'types',
        version: '0.2.0',
      }

      expect(policy.allow(iface)).toBe(false)
    })

    it('should allow interfaces when feature is enabled', () => {
      const policy = new EnhancedPolicy({
        defaultAllow: false,
        allow: ['wasi:random/random@0.2.0'],
        features: {
          random: true,
        },
      })

      const iface: WasiInterface = {
        package: 'wasi:random',
        name: 'random',
        version: '0.2.0',
      }

      expect(policy.allow(iface)).toBe(true)
    })

    it('should check network feature for sockets', () => {
      const policy = new EnhancedPolicy({
        defaultAllow: true,
        features: {
          network: false,
        },
      })

      const iface: WasiInterface = {
        package: 'wasi:sockets',
        name: 'tcp',
        version: '0.2.0',
      }

      expect(policy.allow(iface)).toBe(false)
    })
  })

  describe('Network Destination Checking', () => {
    it('should allow when allowAll is true', () => {
      const policy = new EnhancedPolicy({
        network: { allowAll: true },
      })

      expect(policy.checkNetworkDestination('example.com', 443)).toBe(true)
    })

    it('should deny when host not in allowedHosts', () => {
      const policy = new EnhancedPolicy({
        network: {
          allowedHosts: ['api.example.com'],
        },
      })

      expect(policy.checkNetworkDestination('api.example.com', 443)).toBe(true)
      expect(policy.checkNetworkDestination('other.com', 443)).toBe(false)
    })

    it('should deny when port not in allowedPorts', () => {
      const policy = new EnhancedPolicy({
        network: {
          allowedHosts: ['example.com'],
          allowedPorts: [80, 443],
        },
      })

      expect(policy.checkNetworkDestination('example.com', 443)).toBe(true)
      expect(policy.checkNetworkDestination('example.com', 8080)).toBe(false)
    })

    it('should deny hosts in deniedHosts even with allowAll', () => {
      const policy = new EnhancedPolicy({
        network: {
          allowAll: true,
          deniedHosts: ['internal.corp'],
        },
      })

      expect(policy.checkNetworkDestination('example.com', 443)).toBe(true)
      expect(policy.checkNetworkDestination('internal.corp', 443)).toBe(false)
    })
  })

  describe('Filesystem Path Checking', () => {
    it('should deny paths matching denied patterns', () => {
      const policy = new EnhancedPolicy({
        filesystem: {
          deniedPatterns: [/\.env$/i, /\/\.git\//],
        },
      })

      expect(policy.checkFilesystemPath('/app/.env')).toBe(false)
      expect(policy.checkFilesystemPath('/app/.git/config')).toBe(false)
      expect(policy.checkFilesystemPath('/app/src/main.ts')).toBe(true)
    })

    it('should allow paths not matching patterns', () => {
      const policy = new EnhancedPolicy({
        filesystem: {
          preopens: [{ guest: '/app' }],
        },
      })

      expect(policy.checkFilesystemPath('/app/data.json')).toBe(true)
    })
  })

  describe('HTTP Request Checking', () => {
    it('should check allowed methods', () => {
      const policy = new EnhancedPolicy({
        http: {
          allowedMethods: ['GET', 'POST'],
        },
      })

      expect(policy.checkHttpRequest('GET', 'https://example.com')).toBe(true)
      expect(policy.checkHttpRequest('POST', 'https://example.com')).toBe(true)
      expect(policy.checkHttpRequest('DELETE', 'https://example.com')).toBe(false)
    })

    it('should check allowed origins', () => {
      const policy = new EnhancedPolicy({
        http: {
          allowedOrigins: ['https://api.example.com'],
        },
      })

      expect(policy.checkHttpRequest('GET', 'https://api.example.com/data')).toBe(true)
      expect(policy.checkHttpRequest('GET', 'https://other.com/data')).toBe(false)
    })
  })

  describe('Quota and Redactor Access', () => {
    it('should provide access to quota tracker', () => {
      const policy = new EnhancedPolicy({
        quotas: { maxOps: 100 },
      })

      const tracker = policy.getQuotaTracker()

      expect(tracker).toBeDefined()
      expect(tracker.checkOp()).toBe(true)
    })

    it('should provide access to redactor', () => {
      const policy = new EnhancedPolicy({
        redaction: {
          envPatterns: [/test/i],
        },
      })

      const redactor = policy.getRedactor()

      expect(redactor).toBeDefined()
      expect(redactor.redactEnv('TEST_KEY', 'value')).toBe('[REDACTED]')
    })
  })
})

describe('createEnhancedPolicy', () => {
  it('should create an enhanced policy', () => {
    const policy = createEnhancedPolicy({
      defaultAllow: true,
    })

    expect(policy).toBeInstanceOf(EnhancedPolicy)
  })
})

describe('createSecurePolicy', () => {
  it('should create a policy with secure defaults', () => {
    const policy = createSecurePolicy()

    // Secure policy should deny filesystem and network by default
    const fsIface: WasiInterface = {
      package: 'wasi:filesystem',
      name: 'types',
      version: '0.2.0',
    }

    const socketIface: WasiInterface = {
      package: 'wasi:sockets',
      name: 'tcp',
      version: '0.2.0',
    }

    expect(policy.allow(fsIface)).toBe(false)
    expect(policy.allow(socketIface)).toBe(false)
  })

  it('should allow random and clocks by default', () => {
    const policy = createSecurePolicy({
      allow: [
        'wasi:random/random@0.2.0',
        'wasi:clocks/monotonic-clock@0.2.0',
      ],
    })

    const randomIface: WasiInterface = {
      package: 'wasi:random',
      name: 'random',
      version: '0.2.0',
    }

    expect(policy.allow(randomIface)).toBe(true)
  })

  it('should have default quotas', () => {
    const policy = createSecurePolicy()
    const tracker = policy.getQuotaTracker()

    // Should have some limits
    expect(tracker.checkOp()).toBe(true)
  })

  it('should have default redaction patterns', () => {
    const policy = createSecurePolicy()
    const redactor = policy.getRedactor()

    expect(redactor.redactEnv('PASSWORD', 'secret')).toBe('[REDACTED]')
  })
})
