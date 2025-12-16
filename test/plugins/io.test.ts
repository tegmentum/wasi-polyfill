import { describe, it, expect, beforeEach } from 'vitest'
import {
  Pollable,
  PollableRegistry,
  createTimerPollable,
  createReadyPollable,
  MemoryInputStream,
  MemoryOutputStream,
  StreamRegistry,
  pollPlugin,
  streamsPlugin,
  errorPlugin,
} from '../../src/plugins/io/index.js'

describe('Pollable', () => {
  it('starts not ready', () => {
    let resolve: () => void
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    const pollable = new Pollable(promise)
    expect(pollable.ready()).toBe(false)
    resolve!()
  })

  it('becomes ready when promise resolves', async () => {
    const pollable = new Pollable(Promise.resolve())
    await pollable.block()
    expect(pollable.ready()).toBe(true)
  })

  it('block() waits for promise', async () => {
    let resolved = false
    const promise = new Promise<void>((resolve) => {
      setTimeout(() => {
        resolved = true
        resolve()
      }, 10)
    })
    const pollable = new Pollable(promise)
    expect(resolved).toBe(false)
    await pollable.block()
    expect(resolved).toBe(true)
  })
})

describe('PollableRegistry', () => {
  let registry: PollableRegistry

  beforeEach(() => {
    registry = new PollableRegistry()
  })

  it('creates pollable handles', () => {
    const handle = registry.create(Promise.resolve())
    expect(handle).toBeGreaterThan(0)
  })

  it('retrieves pollables by handle', () => {
    const handle = registry.create(Promise.resolve())
    const pollable = registry.get(handle)
    expect(pollable).toBeDefined()
  })

  it('returns undefined for invalid handle', () => {
    expect(registry.get(999)).toBeUndefined()
  })

  it('drops pollables', () => {
    const handle = registry.create(Promise.resolve())
    expect(registry.drop(handle)).toBe(true)
    expect(registry.get(handle)).toBeUndefined()
  })

  describe('poll()', () => {
    it('returns indices of ready pollables', async () => {
      const h1 = registry.create(Promise.resolve())
      const h2 = registry.create(Promise.resolve())
      await new Promise((r) => setTimeout(r, 10)) // Let promises settle
      const ready = await registry.poll([h1, h2], false)
      expect(ready).toContain(0)
      expect(ready).toContain(1)
    })

    it('waits for at least one when blocking', async () => {
      const h1 = registry.create(
        new Promise((r) => setTimeout(r, 10))
      )
      const ready = await registry.poll([h1], true)
      expect(ready).toContain(0)
    })

    it('returns empty array when non-blocking and none ready', async () => {
      const h1 = registry.create(
        new Promise((r) => setTimeout(r, 1000))
      )
      const ready = await registry.poll([h1], false)
      expect(ready).toHaveLength(0)
    })
  })
})

describe('createTimerPollable', () => {
  it('creates a pollable that resolves after delay', async () => {
    const registry = new PollableRegistry()
    const start = Date.now()
    const handle = createTimerPollable(registry, 20)
    const pollable = registry.get(handle)!
    await pollable.block()
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(15) // Allow some timing variance
  })
})

describe('createReadyPollable', () => {
  it('creates an immediately ready pollable', async () => {
    const registry = new PollableRegistry()
    const handle = createReadyPollable(registry)
    const pollable = registry.get(handle)!
    await pollable.block()
    expect(pollable.ready()).toBe(true)
  })
})

describe('MemoryInputStream', () => {
  it('reads data', () => {
    const data = new TextEncoder().encode('Hello, World!')
    const stream = new MemoryInputStream(data)
    const result = stream.read(5n)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(result as Uint8Array)).toBe('Hello')
  })

  it('reads remaining data', () => {
    const data = new TextEncoder().encode('Hello')
    const stream = new MemoryInputStream(data)
    stream.read(3n)
    const result = stream.read(100n)
    expect(new TextDecoder().decode(result as Uint8Array)).toBe('lo')
  })

  it('returns closed error when exhausted', () => {
    const data = new TextEncoder().encode('Hi')
    const stream = new MemoryInputStream(data)
    stream.read(2n)
    const result = stream.read(1n)
    expect(result).toEqual({ tag: 'closed' })
  })

  it('skips bytes', () => {
    const data = new TextEncoder().encode('Hello, World!')
    const stream = new MemoryInputStream(data)
    const skipped = stream.skip(7n)
    expect(skipped).toBe(7n)
    const result = stream.read(5n)
    expect(new TextDecoder().decode(result as Uint8Array)).toBe('World')
  })

  it('reports available bytes', () => {
    const data = new TextEncoder().encode('Hello')
    const stream = new MemoryInputStream(data)
    expect(stream.available()).toBe(5)
    stream.read(2n)
    expect(stream.available()).toBe(3)
  })

  it('can be closed', () => {
    const stream = new MemoryInputStream(new Uint8Array(10))
    expect(stream.isClosed()).toBe(false)
    stream.close()
    expect(stream.isClosed()).toBe(true)
    expect(stream.read(1n)).toEqual({ tag: 'closed' })
  })
})

describe('MemoryOutputStream', () => {
  it('writes data', () => {
    const stream = new MemoryOutputStream()
    const data = new TextEncoder().encode('Hello')
    const error = stream.write(data)
    expect(error).toBeUndefined()
    expect(stream.getString()).toBe('Hello')
  })

  it('accumulates multiple writes', () => {
    const stream = new MemoryOutputStream()
    stream.write(new TextEncoder().encode('Hello'))
    stream.write(new TextEncoder().encode(', '))
    stream.write(new TextEncoder().encode('World!'))
    expect(stream.getString()).toBe('Hello, World!')
  })

  it('reports available write capacity', () => {
    const stream = new MemoryOutputStream()
    const capacity = stream.checkWrite()
    expect(capacity).toBe(65536n)
  })

  it('writes zeroes', () => {
    const stream = new MemoryOutputStream()
    stream.writeZeroes(5n)
    const buffer = stream.getBuffer()
    expect(buffer.length).toBe(5)
    expect(buffer.every((b) => b === 0)).toBe(true)
  })

  it('can be cleared', () => {
    const stream = new MemoryOutputStream()
    stream.write(new TextEncoder().encode('Hello'))
    stream.clear()
    expect(stream.getBuffer().length).toBe(0)
  })

  it('can be closed', () => {
    const stream = new MemoryOutputStream()
    stream.close()
    expect(stream.isClosed()).toBe(true)
    const error = stream.write(new Uint8Array(1))
    expect(error).toEqual({ tag: 'closed' })
  })

  it('splices from input stream', () => {
    const input = new MemoryInputStream(new TextEncoder().encode('Hello'))
    const output = new MemoryOutputStream()
    const written = output.splice(input, 5n)
    expect(written).toBe(5n)
    expect(output.getString()).toBe('Hello')
  })
})

describe('StreamRegistry', () => {
  let registry: StreamRegistry

  beforeEach(() => {
    registry = new StreamRegistry()
  })

  it('registers streams', () => {
    const stream = new MemoryInputStream(new Uint8Array(0))
    const handle = registry.register(stream)
    expect(handle).toBeGreaterThan(0)
  })

  it('retrieves input streams', () => {
    const stream = new MemoryInputStream(new Uint8Array(0))
    const handle = registry.register(stream)
    expect(registry.getInput(handle)).toBe(stream)
  })

  it('retrieves output streams', () => {
    const stream = new MemoryOutputStream()
    const handle = registry.register(stream)
    expect(registry.getOutput(handle)).toBe(stream)
  })

  it('drops streams and closes them', () => {
    const stream = new MemoryInputStream(new Uint8Array(0))
    const handle = registry.register(stream)
    registry.drop(handle)
    expect(stream.isClosed()).toBe(true)
    expect(registry.get(handle)).toBeUndefined()
  })
})

describe('wasi:io plugins', () => {
  describe('poll plugin', () => {
    it('has correct interface', () => {
      expect(pollPlugin.witInterface.package).toBe('wasi:io')
      expect(pollPlugin.witInterface.name).toBe('poll')
    })
  })

  describe('streams plugin', () => {
    it('has correct interface', () => {
      expect(streamsPlugin.witInterface.package).toBe('wasi:io')
      expect(streamsPlugin.witInterface.name).toBe('streams')
    })
  })

  describe('error plugin', () => {
    it('has correct interface', () => {
      expect(errorPlugin.witInterface.package).toBe('wasi:io')
      expect(errorPlugin.witInterface.name).toBe('error')
    })
  })
})
