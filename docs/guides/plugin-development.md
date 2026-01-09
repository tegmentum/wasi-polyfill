# Plugin Development Guide

This guide explains how to create custom plugins for the WASIP2 polyfill.

## Table of Contents

1. [Plugin Interface](#plugin-interface)
2. [Creating a Simple Plugin](#creating-a-simple-plugin)
3. [Implementation Patterns](#implementation-patterns)
4. [Resource Management](#resource-management)
5. [Testing Plugins](#testing-plugins)
6. [Best Practices](#best-practices)

---

## Plugin Interface

All plugins must implement the `WasiPlugin` interface:

```typescript
interface WasiPlugin {
  /** Unique plugin identifier */
  readonly name: string

  /** WASI version compatibility (e.g., "0.2.0") */
  readonly version: string

  /** List of interfaces this plugin provides */
  readonly interfaces: PluginInterface[]

  /** Optional initialization hook */
  initialize?(config: PluginConfig): Promise<void>

  /** Return the import functions for WebAssembly */
  getImports(): Record<string, Record<string, Function>>

  /** Optional cleanup hook */
  dispose?(): Promise<void>
}

interface PluginInterface {
  /** Full interface name (e.g., "wasi:http/outgoing-handler") */
  name: string

  /** List of function names in this interface */
  functions: string[]
}
```

---

## Creating a Simple Plugin

### Step 1: Define the Interface

First, define what your plugin provides:

```typescript
// my-plugin.ts
import type { WasiPlugin, PluginInterface } from '@tegmentum/wasi-polyfill/wasip2'

const interfaces: PluginInterface[] = [
  {
    name: 'my:app/greeter',
    functions: ['greet', 'get-greeting-count']
  }
]
```

### Step 2: Implement the Functions

```typescript
let greetingCount = 0

function greet(name: string): string {
  greetingCount++
  return `Hello, ${name}!`
}

function getGreetingCount(): number {
  return greetingCount
}
```

### Step 3: Create the Plugin Object

```typescript
export const myPlugin: WasiPlugin = {
  name: 'my-greeter-plugin',
  version: '0.2.0',
  interfaces,

  getImports() {
    return {
      'my:app/greeter': {
        'greet': greet,
        'get-greeting-count': getGreetingCount
      }
    }
  }
}
```

### Step 4: Register and Use

```typescript
import { Wasip2 } from '@tegmentum/wasi-polyfill/wasip2'
import { myPlugin } from './my-plugin'

const wasip2 = new Wasip2({})
wasip2.registerPlugin(myPlugin)

const instance = await wasip2.instantiate(wasmBytes)
```

---

## Implementation Patterns

### Pattern 1: Stub Implementation

Returns errors for unimplemented functionality:

```typescript
export const stubPlugin: WasiPlugin = {
  name: 'my-stub-plugin',
  version: '0.2.0',
  interfaces: [{ name: 'my:app/api', functions: ['do-something'] }],

  getImports() {
    return {
      'my:app/api': {
        'do-something': () => {
          throw new Error('Not implemented: do-something')
        }
      }
    }
  }
}
```

### Pattern 2: Virtual/In-Memory Implementation

Simulates functionality without real system resources:

```typescript
export function createVirtualFilesystem(): WasiPlugin {
  const files = new Map<string, Uint8Array>()

  return {
    name: 'virtual-filesystem',
    version: '0.2.0',
    interfaces: [{ name: 'my:fs/files', functions: ['read', 'write', 'delete'] }],

    getImports() {
      return {
        'my:fs/files': {
          'read': (path: string) => {
            const content = files.get(path)
            if (!content) throw new Error(`ENOENT: ${path}`)
            return content
          },
          'write': (path: string, data: Uint8Array) => {
            files.set(path, new Uint8Array(data))
          },
          'delete': (path: string) => {
            if (!files.delete(path)) {
              throw new Error(`ENOENT: ${path}`)
            }
          }
        }
      }
    }
  }
}
```

### Pattern 3: Real/System Implementation

Uses actual system resources (Node.js example):

```typescript
import * as fs from 'node:fs/promises'

export const realFilesystem: WasiPlugin = {
  name: 'real-filesystem',
  version: '0.2.0',
  interfaces: [{ name: 'my:fs/files', functions: ['read', 'write'] }],

  getImports() {
    return {
      'my:fs/files': {
        'read': async (path: string) => {
          return new Uint8Array(await fs.readFile(path))
        },
        'write': async (path: string, data: Uint8Array) => {
          await fs.writeFile(path, data)
        }
      }
    }
  }
}
```

### Pattern 4: Proxy Implementation

Forwards calls to a remote server:

```typescript
export function createProxyPlugin(serverUrl: string): WasiPlugin {
  return {
    name: 'proxy-plugin',
    version: '0.2.0',
    interfaces: [{ name: 'my:app/api', functions: ['call'] }],

    getImports() {
      return {
        'my:app/api': {
          'call': async (method: string, args: unknown[]) => {
            const response = await fetch(serverUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ method, args })
            })
            return response.json()
          }
        }
      }
    }
  }
}
```

### Pattern 5: Configurable Implementation

Accepts configuration at initialization:

```typescript
interface MyPluginConfig {
  prefix: string
  maxLength: number
}

export function createConfigurablePlugin(config: MyPluginConfig): WasiPlugin {
  return {
    name: 'configurable-plugin',
    version: '0.2.0',
    interfaces: [{ name: 'my:app/formatter', functions: ['format'] }],

    getImports() {
      return {
        'my:app/formatter': {
          'format': (input: string) => {
            const truncated = input.slice(0, config.maxLength)
            return `${config.prefix}${truncated}`
          }
        }
      }
    }
  }
}
```

---

## Resource Management

### Creating Resource Handles

For resources that need lifecycle management:

```typescript
class ResourceManager<T> {
  private resources = new Map<number, T>()
  private nextId = 1

  create(resource: T): number {
    const id = this.nextId++
    this.resources.set(id, resource)
    return id
  }

  get(id: number): T | undefined {
    return this.resources.get(id)
  }

  drop(id: number): boolean {
    return this.resources.delete(id)
  }
}

export function createFilePlugin(): WasiPlugin {
  const handles = new ResourceManager<{
    path: string
    content: Uint8Array
    position: number
  }>()

  return {
    name: 'file-plugin',
    version: '0.2.0',
    interfaces: [{
      name: 'my:fs/file',
      functions: ['open', 'read', 'write', 'close']
    }],

    getImports() {
      return {
        'my:fs/file': {
          'open': (path: string): number => {
            return handles.create({
              path,
              content: new Uint8Array(),
              position: 0
            })
          },

          'read': (handle: number, length: number): Uint8Array => {
            const file = handles.get(handle)
            if (!file) throw new Error('Invalid handle')

            const data = file.content.slice(
              file.position,
              file.position + length
            )
            file.position += data.length
            return data
          },

          'write': (handle: number, data: Uint8Array): number => {
            const file = handles.get(handle)
            if (!file) throw new Error('Invalid handle')

            // Expand content if needed
            const newSize = Math.max(
              file.content.length,
              file.position + data.length
            )
            const newContent = new Uint8Array(newSize)
            newContent.set(file.content)
            newContent.set(data, file.position)
            file.content = newContent
            file.position += data.length

            return data.length
          },

          'close': (handle: number): void => {
            if (!handles.drop(handle)) {
              throw new Error('Invalid handle')
            }
          }
        }
      }
    },

    async dispose() {
      // Cleanup any remaining open handles
      handles.clear()
    }
  }
}
```

### Implementing Pollables

For async resources that support polling:

```typescript
interface Pollable {
  ready(): boolean
  block(): Promise<void>
}

class PollableManager {
  private pollables = new Map<number, Pollable>()
  private nextId = 1

  create(pollable: Pollable): number {
    const id = this.nextId++
    this.pollables.set(id, pollable)
    return id
  }

  poll(ids: number[]): number[] {
    return ids.filter(id => {
      const p = this.pollables.get(id)
      return p?.ready() ?? false
    })
  }

  async blockOn(id: number): Promise<void> {
    const p = this.pollables.get(id)
    if (p) await p.block()
  }
}
```

---

## Testing Plugins

### Unit Testing

```typescript
import { describe, it, expect } from 'vitest'
import { myPlugin } from './my-plugin'

describe('MyPlugin', () => {
  it('should return correct imports', () => {
    const imports = myPlugin.getImports()

    expect(imports['my:app/greeter']).toBeDefined()
    expect(imports['my:app/greeter']['greet']).toBeInstanceOf(Function)
  })

  it('should greet correctly', () => {
    const imports = myPlugin.getImports()
    const greet = imports['my:app/greeter']['greet']

    expect(greet('World')).toBe('Hello, World!')
  })
})
```

### Integration Testing with Harness

```typescript
import { TestHarness } from '@tegmentum/wasi-polyfill/wasip2/testing'
import { myPlugin } from './my-plugin'

describe('MyPlugin Integration', () => {
  it('should work with WASM component', async () => {
    const harness = new TestHarness({
      plugins: [myPlugin]
    })

    const result = await harness.call(
      'my:app/greeter',
      'greet',
      ['Test']
    )

    expect(result).toBe('Hello, Test!')
  })
})
```

### Mock Dependencies

```typescript
import { vi } from 'vitest'

// Mock fetch for proxy plugin testing
global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ result: 'mocked' })
})

const plugin = createProxyPlugin('http://example.com')
const imports = plugin.getImports()

const result = await imports['my:app/api']['call']('test', [])
expect(result).toEqual({ result: 'mocked' })
```

---

## Best Practices

### 1. Error Handling

Map errors to appropriate WASI error types:

```typescript
import { WasiError, Errno } from '@tegmentum/wasi-polyfill/wasip2'

function handleError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.includes('ENOENT')) {
      throw new WasiError(Errno.NOENT, error.message)
    }
    if (error.message.includes('EACCES')) {
      throw new WasiError(Errno.ACCES, error.message)
    }
  }
  throw new WasiError(Errno.IO, String(error))
}
```

### 2. Input Validation

Always validate inputs from WASM:

```typescript
function validatePath(path: string): void {
  if (typeof path !== 'string') {
    throw new WasiError(Errno.INVAL, 'Path must be a string')
  }
  if (path.includes('..')) {
    throw new WasiError(Errno.ACCES, 'Path traversal not allowed')
  }
  if (path.length > 4096) {
    throw new WasiError(Errno.NAMETOOLONG, 'Path too long')
  }
}
```

### 3. Resource Cleanup

Implement `dispose()` for cleanup:

```typescript
export function createPlugin(): WasiPlugin {
  const connections: WebSocket[] = []

  return {
    // ... other properties

    async dispose() {
      // Close all connections
      for (const conn of connections) {
        conn.close()
      }
      connections.length = 0
    }
  }
}
```

### 4. Async Operations

Handle async operations properly:

```typescript
// Good: Return promises for async operations
'read-async': async (path: string) => {
  return await fs.readFile(path)
}

// Bad: Fire and forget
'read-async': (path: string) => {
  fs.readFile(path) // Promise ignored!
}
```

### 5. Thread Safety

Consider concurrent access in browsers:

```typescript
class ThreadSafeCounter {
  private count = 0
  private lock = Promise.resolve()

  async increment(): Promise<number> {
    // Simple mutex using promise chain
    const release = this.lock
    let resolve: () => void
    this.lock = new Promise(r => { resolve = r })

    await release
    try {
      return ++this.count
    } finally {
      resolve!()
    }
  }
}
```

### 6. Documentation

Document your plugin's interfaces:

```typescript
/**
 * Greeter Plugin
 *
 * Provides a simple greeting service for WASM components.
 *
 * @example
 * ```typescript
 * import { greeterPlugin } from './greeter-plugin'
 *
 * const wasip2 = new Wasip2({})
 * wasip2.registerPlugin(greeterPlugin)
 * ```
 *
 * @interface my:app/greeter
 * @function greet - Greet a person by name
 * @function get-greeting-count - Get total greetings made
 */
export const greeterPlugin: WasiPlugin = {
  // ...
}
```

---

## See Also

- [WASIP2 Architecture Overview](../architecture/wasip2-overview.md)
- [Security Best Practices](security.md)
- [Testing Harness Documentation](../api/testing-harness.md)
