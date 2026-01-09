# Troubleshooting Guide

This guide helps diagnose and resolve common issues with the WASI polyfill.

## Table of Contents

1. [Component Loading Issues](#component-loading-issues)
2. [Plugin Issues](#plugin-issues)
3. [Proxy Issues](#proxy-issues)
4. [Performance Issues](#performance-issues)
5. [Debugging Techniques](#debugging-techniques)
6. [Error Reference](#error-reference)

---

## Component Loading Issues

### "Import not found" Error

**Symptom:**
```
Error: Import not found: wasi:filesystem/types@0.2.0
```

**Causes:**
1. Required plugin not registered
2. Interface name mismatch
3. Version mismatch

**Solutions:**

```typescript
// 1. Register the required plugin
import { FilesystemPlugin } from '@tegmentum/wasi-polyfill/wasip2/plugins/filesystem'

const wasip2 = new Wasip2({
  plugins: [new FilesystemPlugin()]
})

// 2. Check interface names match exactly
// The component expects: wasi:filesystem/types@0.2.0
// Your plugin provides: wasi:filesystem/types@0.2.0 ✓

// 3. Verify version compatibility
console.log(plugin.version) // Should be "0.2.0"
```

### Memory Errors During Instantiation

**Symptom:**
```
RangeError: WebAssembly.Memory(): could not allocate memory
```

**Causes:**
1. Component requires more memory than available
2. Memory limits too restrictive
3. Browser memory constraints

**Solutions:**

```typescript
// 1. Check component memory requirements
const manifest = await wasip2.introspect(wasmBytes)
console.log('Required memory:', manifest.memory)

// 2. Increase memory limits
const wasip2 = new Wasip2({
  limits: {
    maxMemory: 512 * 1024 * 1024 // 512MB
  }
})

// 3. For large components, use streaming instantiation
const instance = await wasip2.instantiateStreaming(
  fetch('/large-component.wasm')
)
```

### "Invalid Component" Error

**Symptom:**
```
Error: Invalid component: missing required section
```

**Causes:**
1. Not a valid WebAssembly component
2. Corrupted file
3. Core module instead of component

**Solutions:**

```typescript
// 1. Verify it's a component (not core module)
const bytes = new Uint8Array(wasmBytes)
// Components start with: 00 61 73 6d 0d 00 01 00
// Core modules start with: 00 61 73 6d 01 00 00 00
console.log('Magic:', Array.from(bytes.slice(0, 8)).map(b => b.toString(16)))

// 2. Use wasm-tools to validate
// $ wasm-tools validate component.wasm

// 3. Ensure proper compilation
// Components need: cargo component build
// Or use wasm-tools component new
```

---

## Plugin Issues

### Filesystem Operations Failing

**Symptom:**
```
Error: ENOENT: No such file or directory
```

**Causes:**
1. Missing preopen configuration
2. Path not within allowed paths
3. Filesystem backend not initialized

**Solutions:**

```typescript
// 1. Configure preopens
const wasip2 = new Wasip2({
  filesystem: {
    preopens: {
      '/': './app-root',        // Map / to local directory
      '/data': './data-dir'     // Map /data to another directory
    }
  }
})

// 2. Check path is within preopens
// Component tries to access: /config/settings.json
// Need preopen for: / or /config

// 3. Verify filesystem backend
const wasip2 = new Wasip2({
  filesystem: {
    implementation: 'memory',  // or 'opfs', 'idb'
    config: {
      // Initial files for memory filesystem
      files: {
        '/config/settings.json': '{"debug": true}'
      }
    }
  }
})
```

### HTTP Requests Timing Out

**Symptom:**
```
Error: Request timed out after 30000ms
```

**Causes:**
1. Network connectivity issues
2. CORS blocking request
3. Proxy not configured

**Solutions:**

```typescript
// 1. Check CORS headers on target server
// Access-Control-Allow-Origin: *
// Or specific origin

// 2. Use proxy for cross-origin requests
const wasip2 = new Wasip2({
  http: {
    implementation: 'proxy',
    config: {
      proxyUrl: 'wss://proxy.example.com'
    }
  }
})

// 3. Increase timeout
const wasip2 = new Wasip2({
  http: {
    timeout: 60000  // 60 seconds
  }
})
```

### Socket Operations Returning ENOSYS

**Symptom:**
```
Error: ENOSYS: Function not implemented
```

**Cause:**
Socket operations require proxy or WebSocket gateway in browser environments.

**Solutions:**

```typescript
// 1. Use WebSocket gateway
const wasip2 = new Wasip2({
  sockets: {
    implementation: 'ws-gateway',
    config: {
      gatewayUrl: 'wss://gateway.example.com'
    }
  }
})

// 2. Or use proxy
const wasip2 = new Wasip2({
  sockets: {
    implementation: 'proxy',
    config: {
      proxyUrl: 'wss://proxy.example.com'
    }
  }
})

// 3. For testing, use virtual sockets
const wasip2 = new Wasip2({
  sockets: {
    implementation: 'virtual'
  }
})
```

---

## Proxy Issues

### Connection Refused

**Symptom:**
```
Error: WebSocket connection failed: Connection refused
```

**Causes:**
1. Proxy server not running
2. Wrong port/URL
3. Firewall blocking connection

**Solutions:**

```bash
# 1. Verify server is running
$ curl http://localhost:8080/health

# 2. Check port configuration
$ netstat -an | grep 8080

# 3. Check firewall rules
$ sudo iptables -L -n
```

```typescript
// 4. Verify client configuration
const client = new ProxyClient({
  url: 'wss://proxy.example.com:8080',  // Correct URL?
  // ...
})
```

### Authentication Failures

**Symptom:**
```
Error: Authentication failed: Invalid token
```

**Causes:**
1. Wrong auth token
2. Token expired
3. Token not configured on server

**Solutions:**

```typescript
// 1. Verify token matches server configuration
// Server:
const server = new ProxyServer({
  auth: {
    tokens: ['correct-token-here']
  }
})

// Client:
const client = new ProxyClient({
  auth: {
    type: 'token',
    token: 'correct-token-here'  // Must match!
  }
})

// 2. Check token expiration
// Tokens may have expiry - get fresh token

// 3. Verify origin is allowed
const server = new ProxyServer({
  allowedOrigins: ['https://your-app.com']
})
```

### Performance Degradation

**Symptom:**
Proxy operations are slow or timing out under load.

**Causes:**
1. Too many concurrent connections
2. Flow control backpressure
3. Network latency

**Solutions:**

```typescript
// 1. Monitor connection count
const stats = server.getStats()
console.log('Active connections:', stats.connections)
console.log('Active streams:', stats.streams)

// 2. Increase flow control windows
const client = new ProxyClient({
  flowControl: {
    initialWindowSize: 1024 * 1024,  // 1MB
    maxWindowSize: 16 * 1024 * 1024  // 16MB
  }
})

// 3. Use connection pooling
const client = new ProxyClient({
  pooling: {
    maxConnections: 10,
    maxStreamsPerConnection: 100
  }
})
```

---

## Performance Issues

### Slow Component Loading

**Solutions:**

```typescript
// 1. Use streaming instantiation
const instance = await wasip2.instantiateStreaming(
  fetch('/component.wasm')
)

// 2. Cache compiled modules
const cache = await caches.open('wasm-cache')
const cached = await cache.match('/component.wasm')
if (cached) {
  // Use cached version
}

// 3. Use lazy loading for large components
const loadComponent = async () => {
  const bytes = await fetch('/component.wasm')
  return wasip2.instantiate(bytes)
}
```

### High Memory Usage

**Solutions:**

```typescript
// 1. Dispose instances when done
const instance = await wasip2.instantiate(wasmBytes)
try {
  await instance.run()
} finally {
  await instance.dispose()
}

// 2. Monitor memory usage
const stats = wasip2.getStats()
console.log('Memory usage:', stats.memory)

// 3. Set memory limits
const wasip2 = new Wasip2({
  limits: {
    maxMemory: 128 * 1024 * 1024  // 128MB
  }
})
```

---

## Debugging Techniques

### Enable Verbose Logging

```typescript
const wasip2 = new Wasip2({
  logging: {
    level: 'debug',
    prefix: '[wasip2]',

    // Log all WASI calls
    traceCalls: true
  }
})
```

### Inspect Plugin State

```typescript
const registry = wasip2.getPluginRegistry()

for (const [name, plugin] of registry.entries()) {
  console.log(`Plugin: ${name}`)
  console.log(`  Version: ${plugin.version}`)
  console.log(`  Interfaces: ${plugin.interfaces.map(i => i.name).join(', ')}`)

  if (plugin.getState) {
    console.log(`  State:`, plugin.getState())
  }
}
```

### Trace Import Calls

```typescript
const wasip2 = new Wasip2({
  tracing: {
    enabled: true,

    onCall: (interfaceName, functionName, args) => {
      console.log(`Call: ${interfaceName}#${functionName}`, args)
    },

    onReturn: (interfaceName, functionName, result) => {
      console.log(`Return: ${interfaceName}#${functionName}`, result)
    },

    onError: (interfaceName, functionName, error) => {
      console.error(`Error: ${interfaceName}#${functionName}`, error)
    }
  }
})
```

### Component Introspection

```typescript
const manifest = await wasip2.introspect(wasmBytes)

console.log('Component manifest:')
console.log('  Imports:', manifest.imports)
console.log('  Exports:', manifest.exports)
console.log('  Memory:', manifest.memory)
console.log('  Capabilities:', manifest.capabilities)
```

### Browser DevTools

1. **Network tab**: Check WebSocket connections for proxy
2. **Memory tab**: Profile memory usage
3. **Performance tab**: Identify slow operations
4. **Console**: View WASI trace logs

---

## Error Reference

### WASI Error Codes

| Code | Name | Description | Common Causes |
|------|------|-------------|---------------|
| 0 | SUCCESS | Operation succeeded | - |
| 1 | E2BIG | Argument list too long | Too many args/env vars |
| 2 | EACCES | Permission denied | Missing capability, wrong rights |
| 3 | EADDRINUSE | Address in use | Port already bound |
| 8 | EBADF | Bad file descriptor | Invalid or closed fd |
| 16 | EBUSY | Resource busy | File locked, device in use |
| 20 | EEXIST | File exists | Create with O_EXCL |
| 28 | EINVAL | Invalid argument | Bad parameter value |
| 44 | ENOENT | No such file | File doesn't exist |
| 52 | ENOSYS | Not implemented | Stub implementation |
| 58 | ENOTCONN | Not connected | Socket not connected |
| 63 | EPERM | Operation not permitted | Capability denied |
| 73 | ETIMEDOUT | Timeout | Operation took too long |

### Common Error Patterns

```typescript
// Pattern: Check for specific errors
try {
  await filesystem.read(path)
} catch (error) {
  if (error instanceof WasiError) {
    switch (error.errno) {
      case Errno.ENOENT:
        console.log('File not found')
        break
      case Errno.EACCES:
        console.log('Permission denied')
        break
      default:
        console.log('WASI error:', error.errno, error.message)
    }
  }
}

// Pattern: Retry on transient errors
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (error) {
      if (error instanceof WasiError) {
        if ([Errno.EAGAIN, Errno.EBUSY].includes(error.errno)) {
          await new Promise(r => setTimeout(r, 100 * (i + 1)))
          continue
        }
      }
      throw error
    }
  }
  throw new Error('Max retries exceeded')
}
```

---

## Getting Help

If you can't resolve an issue:

1. **Search existing issues**: [GitHub Issues](https://github.com/anthropics/wasi-polyfill/issues)
2. **Check documentation**: [docs/](../)
3. **Enable debug logging** and capture output
4. **Create minimal reproduction** if reporting a bug

When reporting issues, include:
- WASI polyfill version
- Browser/Node.js version
- Component being loaded
- Full error message and stack trace
- Debug log output
- Minimal reproduction steps

---

## See Also

- [WASIP2 Architecture Overview](../architecture/wasip2-overview.md)
- [Security Best Practices](security.md)
- [Plugin Development Guide](plugin-development.md)
