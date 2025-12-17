import { describe, it, expect } from 'vitest'
import {
  randomPlugin,
  insecureRandomPlugin,
  insecureSeedPlugin,
  cryptoRandomImplementation,
  insecureRandomImplementation,
  insecureSeedImplementation,
  seededRandomImplementation,
  seededInsecureRandomImplementation,
  seededInsecureSeedImplementation,
} from '../../src/wasip2/plugins/random/index.js'

describe('wasi:random/random', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(randomPlugin.witInterface.package).toBe('wasi:random')
      expect(randomPlugin.witInterface.name).toBe('random')
      expect(randomPlugin.witInterface.version).toBe('0.2.0')
    })

    it('has crypto as default implementation', () => {
      expect(randomPlugin.defaultImplementation).toBe('crypto')
    })
  })

  describe('crypto implementation', () => {
    const instance = cryptoRandomImplementation.create({})
    const imports = instance.getImports() as {
      'get-random-bytes': (len: bigint) => Uint8Array
      'get-random-u64': () => bigint
    }

    it('generates random bytes', () => {
      const bytes = imports['get-random-bytes'](32n)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBe(32)
    })

    it('generates different bytes each time', () => {
      const bytes1 = imports['get-random-bytes'](32n)
      const bytes2 = imports['get-random-bytes'](32n)
      // Extremely unlikely to be equal if truly random
      expect(bytes1).not.toEqual(bytes2)
    })

    it('generates zero-length array for len=0', () => {
      const bytes = imports['get-random-bytes'](0n)
      expect(bytes.length).toBe(0)
    })

    it('generates random u64', () => {
      const value = imports['get-random-u64']()
      expect(typeof value).toBe('bigint')
      expect(value).toBeGreaterThanOrEqual(0n)
      expect(value).toBeLessThan(2n ** 64n)
    })

    it('throws for invalid length', () => {
      expect(() => imports['get-random-bytes'](-1n)).toThrow()
      expect(() => imports['get-random-bytes'](100000n)).toThrow()
    })
  })
})

describe('wasi:random/insecure', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(insecureRandomPlugin.witInterface.package).toBe('wasi:random')
      expect(insecureRandomPlugin.witInterface.name).toBe('insecure')
    })
  })

  describe('math implementation', () => {
    const instance = insecureRandomImplementation.create({})
    const imports = instance.getImports() as {
      'get-insecure-random-bytes': (len: bigint) => Uint8Array
      'get-insecure-random-u64': () => bigint
    }

    it('generates insecure random bytes', () => {
      const bytes = imports['get-insecure-random-bytes'](32n)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBe(32)
    })

    it('generates insecure random u64', () => {
      const value = imports['get-insecure-random-u64']()
      expect(typeof value).toBe('bigint')
      expect(value).toBeGreaterThanOrEqual(0n)
      expect(value).toBeLessThan(2n ** 64n)
    })
  })
})

describe('wasi:random/insecure-seed', () => {
  describe('plugin', () => {
    it('has correct interface definition', () => {
      expect(insecureSeedPlugin.witInterface.package).toBe('wasi:random')
      expect(insecureSeedPlugin.witInterface.name).toBe('insecure-seed')
    })
  })

  describe('implementation', () => {
    const instance = insecureSeedImplementation.create({})
    const imports = instance.getImports() as {
      'insecure-seed': () => [bigint, bigint]
    }

    it('returns a seed tuple', () => {
      const seed = imports['insecure-seed']()
      expect(Array.isArray(seed)).toBe(true)
      expect(seed.length).toBe(2)
      expect(typeof seed[0]).toBe('bigint')
      expect(typeof seed[1]).toBe('bigint')
    })

    it('returns consistent seed for same instance', () => {
      const seed1 = imports['insecure-seed']()
      const seed2 = imports['insecure-seed']()
      expect(seed1).toEqual(seed2)
    })

    it('returns different seeds for different instances', () => {
      const instance1 = insecureSeedImplementation.create({})
      const instance2 = insecureSeedImplementation.create({})
      const imports1 = instance1.getImports() as { 'insecure-seed': () => [bigint, bigint] }
      const imports2 = instance2.getImports() as { 'insecure-seed': () => [bigint, bigint] }
      const seed1 = imports1['insecure-seed']()
      const seed2 = imports2['insecure-seed']()
      // Extremely unlikely to be equal
      expect(seed1[0] === seed2[0] && seed1[1] === seed2[1]).toBe(false)
    })
  })
})

describe('Seeded Random Implementations', () => {
  describe('seededRandomImplementation', () => {
    it('has correct metadata', () => {
      expect(seededRandomImplementation.name).toBe('seeded')
      expect(seededRandomImplementation.description).toContain('Deterministic')
    })

    it('generates deterministic bytes with same seed', () => {
      const instance1 = seededRandomImplementation.create({ seed: 12345n })
      const instance2 = seededRandomImplementation.create({ seed: 12345n })

      const imports1 = instance1.getImports() as {
        'get-random-bytes': (len: bigint) => Uint8Array
      }
      const imports2 = instance2.getImports() as {
        'get-random-bytes': (len: bigint) => Uint8Array
      }

      const bytes1 = imports1['get-random-bytes'](32n)
      const bytes2 = imports2['get-random-bytes'](32n)

      expect(bytes1).toEqual(bytes2)
    })

    it('generates different bytes with different seeds', () => {
      const instance1 = seededRandomImplementation.create({ seed: 12345n })
      const instance2 = seededRandomImplementation.create({ seed: 67890n })

      const imports1 = instance1.getImports() as {
        'get-random-bytes': (len: bigint) => Uint8Array
      }
      const imports2 = instance2.getImports() as {
        'get-random-bytes': (len: bigint) => Uint8Array
      }

      const bytes1 = imports1['get-random-bytes'](32n)
      const bytes2 = imports2['get-random-bytes'](32n)

      expect(bytes1).not.toEqual(bytes2)
    })

    it('generates deterministic u64 with same seed', () => {
      const instance1 = seededRandomImplementation.create({ seed: 42n })
      const instance2 = seededRandomImplementation.create({ seed: 42n })

      const imports1 = instance1.getImports() as {
        'get-random-u64': () => bigint
      }
      const imports2 = instance2.getImports() as {
        'get-random-u64': () => bigint
      }

      const val1 = imports1['get-random-u64']()
      const val2 = imports2['get-random-u64']()

      expect(val1).toBe(val2)
    })

    it('defaults to seed 0 when not specified', () => {
      const instance1 = seededRandomImplementation.create({})
      const instance2 = seededRandomImplementation.create({ seed: 0n })

      const imports1 = instance1.getImports() as {
        'get-random-bytes': (len: bigint) => Uint8Array
      }
      const imports2 = instance2.getImports() as {
        'get-random-bytes': (len: bigint) => Uint8Array
      }

      const bytes1 = imports1['get-random-bytes'](16n)
      const bytes2 = imports2['get-random-bytes'](16n)

      expect(bytes1).toEqual(bytes2)
    })

    it('accepts number seed', () => {
      const instance1 = seededRandomImplementation.create({ seed: 12345 })
      const instance2 = seededRandomImplementation.create({ seed: 12345n })

      const imports1 = instance1.getImports() as {
        'get-random-bytes': (len: bigint) => Uint8Array
      }
      const imports2 = instance2.getImports() as {
        'get-random-bytes': (len: bigint) => Uint8Array
      }

      const bytes1 = imports1['get-random-bytes'](16n)
      const bytes2 = imports2['get-random-bytes'](16n)

      expect(bytes1).toEqual(bytes2)
    })

    it('generates sequence of different values', () => {
      const instance = seededRandomImplementation.create({ seed: 1n })
      const imports = instance.getImports() as {
        'get-random-u64': () => bigint
      }

      const values = [
        imports['get-random-u64'](),
        imports['get-random-u64'](),
        imports['get-random-u64'](),
      ]

      // All values should be different
      expect(new Set(values).size).toBe(3)
    })

    it('throws for invalid length', () => {
      const instance = seededRandomImplementation.create({ seed: 1n })
      const imports = instance.getImports() as {
        'get-random-bytes': (len: bigint) => Uint8Array
      }

      expect(() => imports['get-random-bytes'](-1n)).toThrow()
      expect(() => imports['get-random-bytes'](100000n)).toThrow()
    })
  })

  describe('seededInsecureRandomImplementation', () => {
    it('generates deterministic insecure bytes', () => {
      const instance1 = seededInsecureRandomImplementation.create({ seed: 999n })
      const instance2 = seededInsecureRandomImplementation.create({ seed: 999n })

      const imports1 = instance1.getImports() as {
        'get-insecure-random-bytes': (len: bigint) => Uint8Array
      }
      const imports2 = instance2.getImports() as {
        'get-insecure-random-bytes': (len: bigint) => Uint8Array
      }

      const bytes1 = imports1['get-insecure-random-bytes'](32n)
      const bytes2 = imports2['get-insecure-random-bytes'](32n)

      expect(bytes1).toEqual(bytes2)
    })

    it('generates deterministic insecure u64', () => {
      const instance1 = seededInsecureRandomImplementation.create({ seed: 888n })
      const instance2 = seededInsecureRandomImplementation.create({ seed: 888n })

      const imports1 = instance1.getImports() as {
        'get-insecure-random-u64': () => bigint
      }
      const imports2 = instance2.getImports() as {
        'get-insecure-random-u64': () => bigint
      }

      const val1 = imports1['get-insecure-random-u64']()
      const val2 = imports2['get-insecure-random-u64']()

      expect(val1).toBe(val2)
    })
  })

  describe('seededInsecureSeedImplementation', () => {
    it('generates deterministic seed tuple', () => {
      const instance1 = seededInsecureSeedImplementation.create({ seed: 777n })
      const instance2 = seededInsecureSeedImplementation.create({ seed: 777n })

      const imports1 = instance1.getImports() as {
        'insecure-seed': () => [bigint, bigint]
      }
      const imports2 = instance2.getImports() as {
        'insecure-seed': () => [bigint, bigint]
      }

      const seed1 = imports1['insecure-seed']()
      const seed2 = imports2['insecure-seed']()

      expect(seed1).toEqual(seed2)
    })

    it('generates different seeds for different initial seeds', () => {
      const instance1 = seededInsecureSeedImplementation.create({ seed: 111n })
      const instance2 = seededInsecureSeedImplementation.create({ seed: 222n })

      const imports1 = instance1.getImports() as {
        'insecure-seed': () => [bigint, bigint]
      }
      const imports2 = instance2.getImports() as {
        'insecure-seed': () => [bigint, bigint]
      }

      const seed1 = imports1['insecure-seed']()
      const seed2 = imports2['insecure-seed']()

      expect(seed1).not.toEqual(seed2)
    })

    it('returns consistent seed for same instance', () => {
      const instance = seededInsecureSeedImplementation.create({ seed: 333n })
      const imports = instance.getImports() as {
        'insecure-seed': () => [bigint, bigint]
      }

      const seed1 = imports['insecure-seed']()
      const seed2 = imports['insecure-seed']()

      expect(seed1).toEqual(seed2)
    })
  })

  describe('Plugin integration', () => {
    it('randomPlugin has seeded implementation', () => {
      expect(randomPlugin.implementations.has('seeded')).toBe(true)
    })

    it('insecureRandomPlugin has seeded implementation', () => {
      expect(insecureRandomPlugin.implementations.has('seeded')).toBe(true)
    })

    it('insecureSeedPlugin has seeded implementation', () => {
      expect(insecureSeedPlugin.implementations.has('seeded')).toBe(true)
    })

    it('can create seeded instance via plugin', () => {
      const instance = randomPlugin.create({
        implementation: 'seeded',
        seed: 54321n,
      })

      const imports = instance.getImports() as {
        'get-random-bytes': (len: bigint) => Uint8Array
      }

      const bytes = imports['get-random-bytes'](16n)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBe(16)
    })
  })
})
