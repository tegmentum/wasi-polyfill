# Sockets Behavior Contract

This document defines the behavior guarantees and cross-environment semantics for `wasi:sockets` implementations.

## Interface Overview

The `wasi:sockets` interface provides TCP and UDP networking capabilities. Browser environments require proxy support for real networking.

## Provider Behaviors

### Simulated Provider (`simulated`)
- No real network access
- Loopback connections only
- Useful for testing
- Configurable response patterns

### Proxy Provider (`proxy`)
- Real networking via WebSocket proxy
- TCP and UDP support
- Required for browser environments
- Configurable proxy endpoint

### Node Provider (`node`)
- Direct socket access
- Full TCP/UDP support
- No proxy required

## TCP Behavior

### Connection Timeouts
| Provider | Default | Configurable | Max |
|----------|---------|--------------|-----|
| simulated | 5s | Yes | 60s |
| proxy | 30s | Yes | 300s |
| node | System | Yes | System |

### Connection States
```
CLOSED → CONNECTING → CONNECTED → CLOSING → CLOSED
                ↓
              FAILED
```

### Half-Close Support
- `shutdown(read)`: Stop receiving
- `shutdown(write)`: Send FIN, can still receive
- `shutdown(both)`: Full close

### Keep-Alive
| Provider | Default | Configurable |
|----------|---------|--------------|
| simulated | No | No |
| proxy | Yes (60s) | Yes |
| node | System | Yes |

## UDP Behavior

### Maximum Datagram Size
| Provider | Max Size | Notes |
|----------|----------|-------|
| simulated | 65507 | IPv4 max |
| proxy | 65507 | May be limited by proxy |
| node | 65507 | System dependent |

### Fragmentation
- NOT handled by provider
- Large datagrams may fail silently
- Recommend max 1400 bytes for reliability

### Ordering
- NOT guaranteed
- Datagrams may arrive out of order
- Datagrams may be duplicated
- Datagrams may be lost

## DNS Resolution

### Lookup Behavior
| Provider | Method | Caching |
|----------|--------|---------|
| simulated | Static table | No |
| proxy | Proxy-side | Proxy-dependent |
| node | System resolver | System cache |
| doh | DNS-over-HTTPS | Configurable TTL |

### DNS Caching
```typescript
{
  dns: {
    cache: true,
    ttl: 300,        // seconds
    maxEntries: 1000
  }
}
```

### IPv4 vs IPv6
- Dual-stack by default
- Can prefer IPv4 or IPv6
- Happy Eyeballs not implemented

## Address Binding

### Wildcard Addresses
- `0.0.0.0` - All IPv4 interfaces
- `::` - All IPv6 interfaces
- `localhost` - Loopback only

### Port Selection
- Port 0: System-assigned ephemeral port
- Ports 1-1023: May require privileges
- Ports 1024-65535: Generally available

### Address Reuse
| Provider | SO_REUSEADDR | SO_REUSEPORT |
|----------|--------------|--------------|
| simulated | Always | No |
| proxy | No | No |
| node | Configurable | Configurable |

## Error Handling

### Connection Errors
| Error | Meaning |
|-------|---------|
| `connection-refused` | Remote rejected |
| `connection-reset` | Remote reset |
| `connection-aborted` | Local abort |
| `timeout` | Operation timed out |
| `network-unreachable` | No route to host |
| `host-unreachable` | Host not reachable |

### Socket Errors
| Error | Meaning |
|-------|---------|
| `address-in-use` | Port already bound |
| `address-not-available` | Cannot bind address |
| `already-connected` | Socket already connected |
| `not-connected` | Socket not connected |

## Browser Limitations

### No Direct Sockets
- Browsers cannot create raw TCP/UDP sockets
- All traffic must go through proxy
- WebSocket transport to proxy server

### Proxy Protocol
```
Browser ←WebSocket→ Proxy Server ←TCP/UDP→ Target
```

### Allowed Destinations
Configure proxy to restrict:
- Allowed hosts/IPs
- Allowed ports
- Allowed protocols

## Proxy Configuration

### Connection
```typescript
{
  proxy: {
    url: 'wss://proxy.example.com/ws',
    reconnect: true,
    reconnectDelay: 1000,
    maxReconnects: 5
  }
}
```

### Authentication
```typescript
{
  proxy: {
    auth: {
      type: 'bearer',
      token: 'xxx'
    }
  }
}
```

## Performance Considerations

### Latency
| Provider | Additional Latency |
|----------|-------------------|
| simulated | ~0ms |
| proxy | 1-50ms (proxy RTT) |
| node | ~0ms |

### Throughput
- Proxy: Limited by WebSocket bandwidth
- Node: Limited by system/network
- Simulated: Memory bandwidth

### Connection Pooling
- Not implemented at provider level
- Application should manage pools

## Security Considerations

### Proxy Trust
- Proxy sees all traffic (unless E2E encrypted)
- Use TLS to target when possible
- Authenticate proxy connections

### Local Binding
- Simulated provider is localhost-only
- Cannot be used for external services

### Resource Limits
```typescript
{
  limits: {
    maxConnections: 100,
    maxBytesPerSecond: 1048576,
    maxConnectionsPerHost: 10
  }
}
```

## Testing

### Mock Servers
```typescript
// Simulated provider with predefined responses
const socket = simulatedSocketProvider.create({
  responses: {
    'api.example.com:443': Buffer.from('HTTP/1.1 200 OK\r\n...')
  }
});
```

### Connection Testing
- Use simulated provider for unit tests
- Use proxy for integration tests
- Test timeout and error handling
