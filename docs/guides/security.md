# Security Best Practices

This guide covers security considerations when using the WASI polyfill.

## Table of Contents

1. [Capability Model](#capability-model)
2. [Input Validation](#input-validation)
3. [Network Security](#network-security)
4. [Resource Limits](#resource-limits)
5. [Deployment Hardening](#deployment-hardening)
6. [Incident Response](#incident-response)

---

## Capability Model

### Principle of Least Privilege

Only grant the minimum capabilities needed:

```typescript
const wasip2 = new Wasip2({
  // Restrict filesystem access
  filesystem: {
    preopens: {
      // Only expose specific directories
      '/data': './sandboxed-data',
      '/tmp': './sandboxed-tmp'
    },
    readonly: false,  // Set true if writes not needed
    allowPaths: ['/data/**', '/tmp/**'],
    denyPaths: ['**/.env', '**/secrets/**']
  },

  // Restrict network access
  http: {
    allowHosts: ['api.example.com'],
    denyHosts: ['*.internal.example.com'],
    allowPorts: [443]
  },

  // Disable unnecessary plugins
  sockets: { implementation: 'stub' },
  threads: { implementation: 'stub' }
})
```

### Plugin-Level Permissions

Each plugin should declare required capabilities:

```typescript
const plugin: WasiPlugin = {
  name: 'my-plugin',
  version: '0.2.0',

  // Declare what this plugin needs
  capabilities: {
    filesystem: ['read'],
    network: ['http-client'],
    random: ['secure']
  },

  // ...
}
```

### Resource Scoping

Scope resources to specific components:

```typescript
// Create isolated filesystem for each component
function createScopedFilesystem(componentId: string) {
  return new IsolatedFilesystem({
    root: `/sandbox/${componentId}`,
    maxSize: 100 * 1024 * 1024,  // 100MB
    allowedExtensions: ['.txt', '.json', '.dat']
  })
}
```

---

## Input Validation

### Path Traversal Prevention

Always validate and sanitize paths:

```typescript
function validatePath(path: string, root: string): string {
  // Normalize the path
  const normalized = path
    .split('/')
    .filter(p => p !== '' && p !== '.')
    .reduce((acc, part) => {
      if (part === '..') {
        acc.pop()
      } else {
        acc.push(part)
      }
      return acc
    }, [] as string[])
    .join('/')

  // Ensure path stays within root
  const fullPath = `${root}/${normalized}`
  const resolved = resolve(fullPath)

  if (!resolved.startsWith(resolve(root))) {
    throw new WasiError(Errno.ACCES, 'Path traversal detected')
  }

  return resolved
}
```

### Size Limits

Enforce limits on inputs:

```typescript
const LIMITS = {
  maxPathLength: 4096,
  maxArgSize: 1024 * 1024,      // 1MB
  maxEnvSize: 64 * 1024,        // 64KB
  maxFileSize: 100 * 1024 * 1024, // 100MB
  maxBufferSize: 16 * 1024 * 1024 // 16MB
}

function validateInput(data: Uint8Array, limit: number): void {
  if (data.length > limit) {
    throw new WasiError(Errno.MSGSIZE, `Input exceeds limit: ${data.length} > ${limit}`)
  }
}
```

### Type Validation

Validate types from WASM boundary:

```typescript
function validateString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new WasiError(Errno.INVAL, 'Expected string')
  }
  return value
}

function validateU32(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) {
    throw new WasiError(Errno.INVAL, 'Expected u32')
  }
  return value
}

function validateU64(value: unknown): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > 0xFFFFFFFFFFFFFFFFn) {
    throw new WasiError(Errno.INVAL, 'Expected u64')
  }
  return value
}
```

---

## Network Security

### Proxy Authentication

Always require authentication for proxy connections:

```typescript
// Server-side
const server = new ProxyServer({
  auth: {
    type: 'token',
    tokens: [process.env.PROXY_AUTH_TOKEN!],
    // Rotate tokens periodically
    tokenExpiry: 24 * 60 * 60 * 1000 // 24 hours
  }
})

// Client-side
const client = new ProxyClient({
  url: 'wss://proxy.example.com',
  auth: {
    type: 'token',
    token: getAuthToken()
  }
})
```

### Origin Restrictions

Validate WebSocket origins:

```typescript
const server = new ProxyServer({
  allowedOrigins: [
    'https://app.example.com',
    'https://staging.example.com'
  ],

  // Or use pattern matching
  originValidator: (origin) => {
    return /^https:\/\/.*\.example\.com$/.test(origin)
  }
})
```

### TLS Configuration

Enforce secure connections:

```typescript
const server = new ProxyServer({
  tls: {
    cert: fs.readFileSync('server.crt'),
    key: fs.readFileSync('server.key'),

    // Minimum TLS version
    minVersion: 'TLSv1.2',

    // Strong cipher suites
    ciphers: [
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256',
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES256-GCM-SHA384'
    ].join(':')
  }
})
```

### CORS Configuration

For browser deployments:

```typescript
// HTTP server serving WASM
app.use(cors({
  origin: ['https://app.example.com'],
  methods: ['GET'],
  credentials: false
}))

// Set security headers
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'")
  next()
})
```

---

## Resource Limits

### Memory Limits

Prevent memory exhaustion:

```typescript
const wasip2 = new Wasip2({
  limits: {
    // Maximum WebAssembly memory
    maxMemory: 256 * 1024 * 1024, // 256MB

    // Maximum handle table size
    maxHandles: 10000,

    // Maximum concurrent streams
    maxStreams: 100
  }
})
```

### File Descriptor Limits

Limit open file descriptors:

```typescript
const filesystem = new FilesystemPlugin({
  maxOpenFiles: 100,

  // Timeout for idle handles
  idleTimeout: 60000,

  // Auto-close on inactivity
  autoClose: true
})
```

### Rate Limiting

Implement rate limiting for operations:

```typescript
class RateLimiter {
  private requests: number[] = []

  constructor(
    private limit: number,
    private windowMs: number
  ) {}

  check(): boolean {
    const now = Date.now()
    this.requests = this.requests.filter(t => now - t < this.windowMs)

    if (this.requests.length >= this.limit) {
      return false
    }

    this.requests.push(now)
    return true
  }
}

// Usage
const limiter = new RateLimiter(100, 1000) // 100 req/sec

function handleRequest() {
  if (!limiter.check()) {
    throw new WasiError(Errno.BUSY, 'Rate limit exceeded')
  }
  // Process request
}
```

### Timeout Enforcement

Prevent long-running operations:

```typescript
async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new WasiError(Errno.TIMEDOUT, message)), timeoutMs)
  })

  return Promise.race([operation, timeout])
}

// Usage
const result = await withTimeout(
  filesystem.read(path),
  30000,
  'File read timed out'
)
```

---

## Deployment Hardening

### Production Configuration

```typescript
const wasip2 = new Wasip2({
  // Disable debug features
  debug: false,
  logging: {
    level: 'warn',  // No debug/info logs
    sanitize: true  // Remove sensitive data
  },

  // Use secure defaults
  random: {
    implementation: 'crypto'  // Not 'insecure'
  },

  // Disable unnecessary features
  threads: { implementation: 'stub' },

  // Enable security features
  security: {
    validatePaths: true,
    sanitizeErrors: true,
    enforceCapabilities: true
  }
})
```

### Container Security

When running in containers:

```dockerfile
# Use minimal base image
FROM node:20-slim

# Run as non-root user
RUN useradd -m appuser
USER appuser

# Set resource limits
# (configure in orchestrator)

# Copy only necessary files
COPY --chown=appuser:appuser dist/ ./dist/
COPY --chown=appuser:appuser package.json ./

# No shell access
ENTRYPOINT ["node", "dist/server.js"]
```

### Monitoring

Enable security monitoring:

```typescript
const wasip2 = new Wasip2({
  monitoring: {
    // Log security events
    onSecurityEvent: (event) => {
      logger.warn('Security event', {
        type: event.type,
        component: event.componentId,
        details: event.details
      })

      // Alert on suspicious activity
      if (event.severity === 'high') {
        alerting.send(event)
      }
    },

    // Track resource usage
    onResourceUsage: (usage) => {
      metrics.gauge('wasi.memory', usage.memory)
      metrics.gauge('wasi.handles', usage.handles)
      metrics.gauge('wasi.streams', usage.streams)
    }
  }
})
```

---

## Incident Response

### Error Sanitization

Don't expose internal details:

```typescript
function sanitizeError(error: Error): WasiError {
  // Log full error internally
  logger.error('Internal error', { error })

  // Return sanitized error to caller
  if (error instanceof WasiError) {
    // Remove internal details from message
    return new WasiError(error.errno, sanitizeMessage(error.message))
  }

  // Generic error for unexpected exceptions
  return new WasiError(Errno.IO, 'An error occurred')
}

function sanitizeMessage(message: string): string {
  // Remove paths, IPs, tokens, etc.
  return message
    .replace(/\/[^\s]+/g, '[path]')
    .replace(/\d+\.\d+\.\d+\.\d+/g, '[ip]')
    .replace(/[a-f0-9]{32,}/gi, '[token]')
}
```

### Audit Logging

Log security-relevant events:

```typescript
interface AuditEvent {
  timestamp: string
  componentId: string
  action: string
  resource: string
  outcome: 'success' | 'failure'
  details?: Record<string, unknown>
}

class AuditLogger {
  log(event: AuditEvent): void {
    // Write to secure audit log
    console.log(JSON.stringify({
      ...event,
      timestamp: new Date().toISOString()
    }))
  }
}

// Usage
auditLogger.log({
  componentId: 'component-123',
  action: 'file.read',
  resource: '/data/config.json',
  outcome: 'success'
})
```

### Security Checklist

Before deployment, verify:

- [ ] Authentication enabled for proxy
- [ ] TLS configured with strong ciphers
- [ ] Origin validation enabled
- [ ] Resource limits configured
- [ ] Rate limiting enabled
- [ ] Audit logging enabled
- [ ] Debug features disabled
- [ ] Unnecessary plugins disabled
- [ ] Filesystem paths restricted
- [ ] Network hosts restricted
- [ ] Error messages sanitized
- [ ] Monitoring and alerting configured

---

## See Also

- [WASIP2 Architecture Overview](../architecture/wasip2-overview.md)
- [Proxy Protocol Specification](../architecture/proxy-protocol.md)
- [OWASP WebAssembly Security](https://cheatsheetseries.owasp.org/cheatsheets/WebAssembly_Security_Cheat_Sheet.html)
