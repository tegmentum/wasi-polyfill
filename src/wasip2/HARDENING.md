# WASIP2 Hardening Implementation Plan

## Overview

WASIP2 is the current stable target with the most mature implementation. This plan focuses on hardening the existing implementation for production use through documentation, testing, and completing minor gaps.

### Current State

- **14 plugins** with 73 implementations
- **~23,000 lines** of test code
- **41,634 lines** of production code
- Generally well-tested but missing architectural documentation and some edge cases

### Goals

1. Production-ready documentation for operators and contributors
2. Complete proxy protocol implementation (flow control)
3. Fix remaining filesystem edge cases
4. Validate real-world deployment scenarios

---

## Phase 1: Architecture Documentation (~800 LOC docs)

**Priority**: High | **Effort**: Medium | **Duration**: 2-3 days

Create comprehensive documentation for understanding and maintaining the codebase.

### 1.1 Architecture Overview (`docs/architecture/wasip2-overview.md`)

```markdown
Document structure:
1. High-level architecture diagram
2. Plugin system design
   - Plugin interface contract
   - Implementation selection
   - Default vs custom implementations
3. Core components
   - Policy engine
   - Plugin registry
   - Resource management
4. Data flow diagrams
   - Component instantiation
   - Import resolution
   - Call lifecycle
```

**Key sections:**

```typescript
/**
 * Architecture Overview Content:
 *
 * 1. Component Architecture
 *    - Wasip2 class as main entry point
 *    - Plugin discovery and registration
 *    - Import/export binding generation
 *
 * 2. Plugin System
 *    - WasiPlugin interface
 *    - Implementation variants (stub, virtual, real)
 *    - Configuration and defaults
 *
 * 3. Runtime Flow
 *    - instantiate() lifecycle
 *    - Import resolution order
 *    - Resource cleanup
 *
 * 4. Extension Points
 *    - Custom plugin implementations
 *    - Middleware/interceptors
 *    - Event hooks
 */
```

### 1.2 Plugin Development Guide (`docs/guides/plugin-development.md`)

Document how to create custom plugin implementations:

```markdown
1. Plugin interface requirements
2. Implementation patterns
   - Stub (not-supported responses)
   - Virtual (in-memory simulation)
   - Real (actual system resources)
   - Proxy (remote execution)
3. Registration and configuration
4. Testing plugins
5. Common pitfalls
```

### 1.3 Proxy Protocol Specification (`docs/architecture/proxy-protocol.md`)

Document the WebSocket proxy protocol:

```markdown
1. Protocol overview
   - Frame format
   - Message types
   - Stream multiplexing
2. Connection lifecycle
   - Handshake
   - Authentication
   - Keepalive
3. Flow control
   - Window updates
   - Backpressure handling
4. Error handling
   - Reconnection strategy
   - Partial failure modes
5. Security considerations
   - Origin validation
   - Token authentication
   - TLS requirements
```

### 1.4 Security Best Practices (`docs/guides/security.md`)

```markdown
1. Capability model
   - Plugin-level permissions
   - Resource scoping
   - Least privilege principle
2. Input validation
   - Untrusted WASM components
   - Path traversal prevention
   - Resource limits
3. Network security
   - Proxy authentication
   - Origin restrictions
   - CORS considerations
4. Deployment hardening
   - Production configuration
   - Monitoring recommendations
   - Incident response
```

---

## Phase 2: Proxy Flow Control Completion (~300 LOC)

**Priority**: Medium | **Effort**: Medium | **Duration**: 2-3 days

Complete the connection-level flow control in the proxy protocol.

### 2.1 Current State

Stream-level flow control works via `WINDOW_UPDATE` frames, but connection-level flow control is marked TODO:

```typescript
// src/wasip2/proxy/server.ts:659
// TODO: Connection-level flow control

// src/wasip2/proxy/client.ts:709
// TODO: Connection-level flow control
```

### 2.2 Implementation Plan

#### Connection Flow Control Types

```typescript
// src/wasip2/proxy/types.ts

interface ConnectionFlowControl {
  /** Current send window size */
  sendWindow: number

  /** Current receive window size */
  receiveWindow: number

  /** Initial window size (configurable) */
  initialWindowSize: number

  /** Maximum window size */
  maxWindowSize: number

  /** Pending data waiting for window space */
  pendingQueue: PendingFrame[]
}

interface PendingFrame {
  streamId: number
  data: Uint8Array
  resolve: () => void
  reject: (error: Error) => void
}
```

#### Server-Side Implementation

```typescript
// src/wasip2/proxy/server.ts

class ProxyServer {
  private connectionFlow: ConnectionFlowControl

  /**
   * Initialize connection flow control on handshake
   */
  private initializeFlowControl(settings: ConnectionSettings): void {
    this.connectionFlow = {
      sendWindow: settings.initialWindowSize ?? 65535,
      receiveWindow: settings.initialWindowSize ?? 65535,
      initialWindowSize: settings.initialWindowSize ?? 65535,
      maxWindowSize: settings.maxWindowSize ?? 16777215,
      pendingQueue: []
    }
  }

  /**
   * Send data with connection-level flow control
   */
  private async sendWithFlowControl(
    streamId: number,
    data: Uint8Array
  ): Promise<void> {
    // Check connection window
    if (data.length > this.connectionFlow.sendWindow) {
      // Queue and wait for window update
      return this.queuePendingFrame(streamId, data)
    }

    // Decrement window and send
    this.connectionFlow.sendWindow -= data.length
    await this.sendFrame(streamId, data)
  }

  /**
   * Handle connection-level WINDOW_UPDATE
   */
  private handleConnectionWindowUpdate(increment: number): void {
    this.connectionFlow.sendWindow += increment

    // Drain pending queue
    this.drainPendingQueue()
  }

  /**
   * Drain pending frames when window opens
   */
  private drainPendingQueue(): void {
    while (
      this.connectionFlow.pendingQueue.length > 0 &&
      this.connectionFlow.sendWindow > 0
    ) {
      const pending = this.connectionFlow.pendingQueue[0]

      if (pending.data.length <= this.connectionFlow.sendWindow) {
        this.connectionFlow.pendingQueue.shift()
        this.connectionFlow.sendWindow -= pending.data.length
        this.sendFrame(pending.streamId, pending.data)
          .then(pending.resolve)
          .catch(pending.reject)
      } else {
        // Partial send not supported at connection level
        break
      }
    }
  }
}
```

#### Client-Side Implementation

Mirror the server implementation in `src/wasip2/proxy/client.ts`.

### 2.3 Configuration

```typescript
// src/wasip2/proxy/types.ts

interface ProxyConfig {
  // Existing config...

  /** Connection flow control settings */
  flowControl?: {
    /** Initial window size in bytes (default: 65535) */
    initialWindowSize?: number

    /** Maximum window size in bytes (default: 16MB) */
    maxWindowSize?: number

    /** Window update threshold (send update when this much consumed) */
    windowUpdateThreshold?: number
  }
}
```

### 2.4 Tests

Add tests in `test/proxy/flow-control.test.ts`:

```typescript
describe('Connection Flow Control', () => {
  it('should respect connection window size')
  it('should queue frames when window exhausted')
  it('should drain queue on window update')
  it('should handle concurrent streams with shared window')
  it('should reject frames exceeding max window')
})
```

---

## Phase 3: Filesystem Edge Cases (~200 LOC)

**Priority**: Low | **Effort**: Low | **Duration**: 1 day

### 3.1 Memory Filesystem Streaming

Fix stream-based reads in memory filesystem:

```typescript
// src/wasip2/plugins/filesystem/impl-memory.ts

class MemoryFilesystem {
  /**
   * Implement streaming read for large files
   */
  createReadStream(
    path: string,
    options?: { start?: number; end?: number }
  ): ReadableStream<Uint8Array> {
    const file = this.getFile(path)
    const start = options?.start ?? 0
    const end = options?.end ?? file.content.length

    let position = start
    const chunkSize = 64 * 1024 // 64KB chunks

    return new ReadableStream({
      pull: (controller) => {
        if (position >= end) {
          controller.close()
          return
        }

        const chunk = file.content.slice(
          position,
          Math.min(position + chunkSize, end)
        )
        position += chunk.length
        controller.enqueue(chunk)
      }
    })
  }
}
```

### 3.2 OPFS Directory Operations

Complete recursive directory copy:

```typescript
// src/wasip2/plugins/filesystem/impl-opfs.ts

class OPFSFilesystem {
  /**
   * Recursive directory copy implementation
   */
  async copyDirectory(
    srcPath: string,
    destPath: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    const srcHandle = await this.getDirectoryHandle(srcPath)
    const destHandle = await this.getOrCreateDirectory(destPath)

    for await (const [name, handle] of srcHandle.entries()) {
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile()
        const destFile = await destHandle.getFileHandle(name, { create: true })
        const writable = await destFile.createWritable()
        await writable.write(await file.arrayBuffer())
        await writable.close()
      } else if (handle.kind === 'directory' && options?.recursive) {
        await this.copyDirectory(
          `${srcPath}/${name}`,
          `${destPath}/${name}`,
          options
        )
      }
    }
  }
}
```

### 3.3 Tests

Add edge case tests:

```typescript
// test/plugins/filesystem-edge-cases.test.ts

describe('Filesystem Edge Cases', () => {
  describe('Memory Filesystem', () => {
    it('should stream large files in chunks')
    it('should handle partial reads with start/end')
    it('should handle empty files')
  })

  describe('OPFS Filesystem', () => {
    it('should copy directories recursively')
    it('should handle nested directory structures')
    it('should preserve file contents during copy')
  })
})
```

---

## Phase 4: E2E Proxy Integration Tests (~500 LOC)

**Priority**: High | **Effort**: Medium | **Duration**: 2-3 days

### 4.1 Test Infrastructure

Create E2E test harness for proxy:

```typescript
// test/e2e/proxy/harness.ts

export class ProxyTestHarness {
  private server: ProxyServer
  private client: ProxyClient

  async setup(config?: Partial<ProxyConfig>): Promise<void> {
    // Start server on random port
    this.server = new ProxyServer({
      port: 0, // Random available port
      ...config?.server
    })
    await this.server.start()

    // Connect client
    this.client = new ProxyClient({
      url: `ws://localhost:${this.server.port}`,
      ...config?.client
    })
    await this.client.connect()
  }

  async teardown(): Promise<void> {
    await this.client?.disconnect()
    await this.server?.stop()
  }

  // Helper methods for common operations
  async createStream(): Promise<StreamHandle>
  async sendData(stream: StreamHandle, data: Uint8Array): Promise<void>
  async receiveData(stream: StreamHandle): Promise<Uint8Array>
}
```

### 4.2 E2E Test Scenarios

```typescript
// test/e2e/proxy/scenarios.test.ts

describe('Proxy E2E Scenarios', () => {
  let harness: ProxyTestHarness

  beforeEach(async () => {
    harness = new ProxyTestHarness()
    await harness.setup()
  })

  afterEach(async () => {
    await harness.teardown()
  })

  describe('Connection Lifecycle', () => {
    it('should establish connection with handshake')
    it('should authenticate with valid token')
    it('should reject invalid authentication')
    it('should handle graceful shutdown')
    it('should handle abrupt disconnection')
    it('should reconnect after connection loss')
  })

  describe('Stream Operations', () => {
    it('should create and use multiple concurrent streams')
    it('should handle stream cancellation')
    it('should respect stream priority')
    it('should clean up streams on close')
  })

  describe('Data Transfer', () => {
    it('should transfer small payloads')
    it('should transfer large payloads with chunking')
    it('should handle binary data correctly')
    it('should maintain data integrity under load')
  })

  describe('Flow Control', () => {
    it('should apply backpressure when overwhelmed')
    it('should resume after backpressure clears')
    it('should handle slow consumers')
    it('should handle fast producers')
  })

  describe('Error Handling', () => {
    it('should propagate errors to client')
    it('should handle malformed frames')
    it('should timeout stale connections')
    it('should recover from partial failures')
  })

  describe('Real WASM Components', () => {
    it('should execute filesystem operations via proxy')
    it('should execute HTTP requests via proxy')
    it('should execute socket operations via proxy')
  })
})
```

### 4.3 Load Testing

```typescript
// test/e2e/proxy/load.test.ts

describe('Proxy Load Tests', () => {
  it('should handle 100 concurrent streams', async () => {
    const streams = await Promise.all(
      Array.from({ length: 100 }, () => harness.createStream())
    )

    // Send data on all streams concurrently
    await Promise.all(
      streams.map(s => harness.sendData(s, generateData(1024)))
    )

    // Verify all received correctly
    const results = await Promise.all(
      streams.map(s => harness.receiveData(s))
    )

    expect(results).toHaveLength(100)
  })

  it('should sustain throughput over time', async () => {
    const duration = 5000 // 5 seconds
    const start = Date.now()
    let bytesTransferred = 0

    while (Date.now() - start < duration) {
      const data = generateData(64 * 1024) // 64KB
      await harness.roundTrip(data)
      bytesTransferred += data.length * 2
    }

    const throughput = bytesTransferred / (duration / 1000)
    console.log(`Throughput: ${(throughput / 1024 / 1024).toFixed(2)} MB/s`)

    expect(throughput).toBeGreaterThan(10 * 1024 * 1024) // >10 MB/s
  })
})
```

---

## Phase 5: Troubleshooting Guide (~400 LOC docs)

**Priority**: Medium | **Effort**: Low | **Duration**: 1 day

### 5.1 Guide Structure (`docs/guides/troubleshooting.md`)

```markdown
# WASIP2 Troubleshooting Guide

## Common Issues

### Component Loading

#### "Import not found" errors
- Check plugin registration order
- Verify interface names match exactly
- Ensure all required plugins are loaded

#### Memory errors during instantiation
- Check component memory requirements
- Verify memory limits in configuration
- Consider streaming for large components

### Plugin Issues

#### Filesystem operations failing
- Verify preopens configuration
- Check path permissions
- Ensure filesystem backend is initialized

#### HTTP requests timing out
- Check network connectivity
- Verify CORS configuration
- Review proxy settings if applicable

#### Socket operations returning ENOSYS
- Sockets require proxy or WebSocket gateway
- Configure ws-gateway plugin for browser environments

### Proxy Issues

#### Connection refused
- Verify server is running
- Check port configuration
- Review firewall rules

#### Authentication failures
- Verify auth token matches
- Check token expiration
- Review origin restrictions

#### Performance degradation
- Monitor connection count
- Check flow control settings
- Review memory usage

## Debugging Techniques

### Enable verbose logging
```typescript
const wasip2 = new Wasip2({
  logging: {
    level: 'debug',
    prefix: '[wasip2]'
  }
})
```

### Inspect plugin state
```typescript
const registry = wasip2.getPluginRegistry()
for (const [name, plugin] of registry.entries()) {
  console.log(name, plugin.getState())
}
```

### Trace import calls
```typescript
const wasip2 = new Wasip2({
  tracing: {
    enabled: true,
    onCall: (name, args) => console.log(`Call: ${name}`, args),
    onReturn: (name, result) => console.log(`Return: ${name}`, result)
  }
})
```

## Error Reference

| Error Code | Meaning | Resolution |
|------------|---------|------------|
| ENOENT | File not found | Check path, verify preopens |
| EACCES | Permission denied | Check rights, verify capabilities |
| ENOSYS | Not implemented | Use appropriate plugin/backend |
| EINVAL | Invalid argument | Review input validation |
| EAGAIN | Resource busy | Retry with backoff |
```

---

## Implementation Checklist

### Phase 1: Documentation
- [ ] `docs/architecture/wasip2-overview.md`
- [ ] `docs/guides/plugin-development.md`
- [ ] `docs/architecture/proxy-protocol.md`
- [ ] `docs/guides/security.md`

### Phase 2: Proxy Flow Control
- [ ] Add `ConnectionFlowControl` types
- [ ] Implement server-side flow control
- [ ] Implement client-side flow control
- [ ] Add configuration options
- [ ] Write unit tests

### Phase 3: Filesystem Edge Cases
- [ ] Memory filesystem streaming
- [ ] OPFS recursive directory copy
- [ ] Edge case tests

### Phase 4: E2E Proxy Tests
- [ ] Test harness setup
- [ ] Connection lifecycle tests
- [ ] Data transfer tests
- [ ] Flow control tests
- [ ] Load tests

### Phase 5: Troubleshooting Guide
- [ ] Common issues documentation
- [ ] Debugging techniques
- [ ] Error reference

---

## Success Criteria

1. **Documentation**: All architecture docs reviewed and approved
2. **Flow Control**: Proxy handles 1000+ concurrent streams without deadlock
3. **Filesystem**: All edge case tests passing
4. **E2E Tests**: >95% scenario coverage, load tests meet throughput targets
5. **Troubleshooting**: Guide covers top 10 support issues

## Estimated Total Effort

| Phase | LOC | Duration |
|-------|-----|----------|
| Documentation | ~800 | 2-3 days |
| Flow Control | ~300 | 2-3 days |
| Filesystem | ~200 | 1 day |
| E2E Tests | ~500 | 2-3 days |
| Troubleshooting | ~400 | 1 day |
| **Total** | **~2200** | **8-11 days** |
