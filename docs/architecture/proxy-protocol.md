# Proxy Protocol Specification

This document specifies the WebSocket-based proxy protocol used for remote WASI execution.

## Overview

The proxy protocol enables WASI components running in browsers to access system resources (filesystem, network, etc.) through a server-side proxy. It uses WebSocket for bidirectional communication with multiplexed streams.

## Protocol Stack

```
┌─────────────────────────────────────────┐
│           WASI Operations               │
├─────────────────────────────────────────┤
│        Stream Multiplexing              │
├─────────────────────────────────────────┤
│          Frame Protocol                 │
├─────────────────────────────────────────┤
│           WebSocket                     │
├─────────────────────────────────────────┤
│          TLS (wss://)                   │
├─────────────────────────────────────────┤
│            TCP/IP                       │
└─────────────────────────────────────────┘
```

---

## Connection Lifecycle

### 1. Handshake

```
Client                                    Server
  │                                         │
  │──────── WebSocket Connect ─────────────▶│
  │                                         │
  │◀─────── WebSocket Accept ──────────────│
  │                                         │
  │──────── HANDSHAKE Frame ───────────────▶│
  │         (version, auth)                 │
  │                                         │
  │◀─────── HANDSHAKE_ACK Frame ───────────│
  │         (settings)                      │
  │                                         │
  │         Connection Ready                │
```

### 2. Stream Operations

```
Client                                    Server
  │                                         │
  │──────── STREAM_OPEN ───────────────────▶│
  │         (stream_id, type)               │
  │                                         │
  │◀─────── STREAM_ACK ────────────────────│
  │                                         │
  │──────── DATA ──────────────────────────▶│
  │◀─────── DATA ──────────────────────────│
  │         (bidirectional)                 │
  │                                         │
  │──────── STREAM_CLOSE ──────────────────▶│
  │◀─────── STREAM_CLOSE_ACK ──────────────│
```

### 3. Graceful Shutdown

```
Client                                    Server
  │                                         │
  │──────── GOAWAY ────────────────────────▶│
  │         (last_stream_id, reason)        │
  │                                         │
  │         (drain active streams)          │
  │                                         │
  │◀─────── GOAWAY ────────────────────────│
  │                                         │
  │──────── WebSocket Close ───────────────▶│
```

---

## Frame Format

All frames use a binary format with the following structure:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Type      |     Flags     |         Stream ID             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Payload Length                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                         Payload                               |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Field Descriptions

| Field | Size | Description |
|-------|------|-------------|
| Type | 1 byte | Frame type identifier |
| Flags | 1 byte | Type-specific flags |
| Stream ID | 2 bytes | Stream identifier (0 for connection-level) |
| Payload Length | 4 bytes | Length of payload in bytes |
| Payload | Variable | Frame-specific data |

---

## Frame Types

### Type 0x00: HANDSHAKE

Initiates connection with version and authentication.

**Flags:** None

**Payload:**
```
{
  "version": "1.0",
  "auth": {
    "type": "token",
    "token": "..."
  },
  "settings": {
    "max_streams": 100,
    "initial_window_size": 65535
  }
}
```

### Type 0x01: HANDSHAKE_ACK

Acknowledges handshake with server settings.

**Flags:** None

**Payload:**
```
{
  "version": "1.0",
  "settings": {
    "max_streams": 100,
    "initial_window_size": 65535,
    "max_frame_size": 16384
  }
}
```

### Type 0x02: STREAM_OPEN

Opens a new stream for an operation.

**Flags:**
- `0x01`: UNIDIRECTIONAL (client to server only)

**Payload:**
```
{
  "type": "wasi-call",
  "interface": "wasi:filesystem/types",
  "function": "read",
  "args": [...]
}
```

### Type 0x03: STREAM_ACK

Acknowledges stream creation.

**Flags:**
- `0x01`: REJECTED

**Payload (if rejected):**
```
{
  "error": "resource_limit",
  "message": "Max streams exceeded"
}
```

### Type 0x04: DATA

Carries stream data.

**Flags:**
- `0x01`: END_STREAM (last data frame for this stream)
- `0x02`: PADDED (payload includes padding)

**Payload:** Raw bytes

### Type 0x05: WINDOW_UPDATE

Updates flow control window.

**Flags:** None

**Payload:**
```
{
  "increment": 32768
}
```

When Stream ID is 0, applies to connection-level flow control.
When Stream ID is non-zero, applies to that specific stream.

### Type 0x06: STREAM_CLOSE

Initiates stream closure.

**Flags:**
- `0x01`: ERROR (abnormal closure)

**Payload (if ERROR):**
```
{
  "code": "cancelled",
  "message": "Operation cancelled by client"
}
```

### Type 0x07: STREAM_CLOSE_ACK

Acknowledges stream closure.

**Flags:** None

**Payload:** None

### Type 0x08: PING

Connection keepalive.

**Flags:**
- `0x01`: ACK (response to ping)

**Payload:** 8 bytes opaque data (echoed in ACK)

### Type 0x09: GOAWAY

Initiates graceful shutdown.

**Flags:** None

**Payload:**
```
{
  "last_stream_id": 42,
  "error_code": "none",
  "debug_data": "shutdown requested"
}
```

### Type 0x0A: ERROR

Connection-level error.

**Flags:** None

**Payload:**
```
{
  "code": "protocol_error",
  "message": "Invalid frame type"
}
```

---

## Flow Control

### Stream-Level Flow Control

Each stream has an independent flow control window:

1. Initial window size set during handshake (default: 65535 bytes)
2. Sender decrements window by bytes sent
3. Receiver sends WINDOW_UPDATE to increment window
4. Sender blocks when window reaches 0

```
Client                                    Server
  │                                         │
  │──────── DATA (1000 bytes) ─────────────▶│
  │         window: 65535 -> 64535          │
  │                                         │
  │──────── DATA (64000 bytes) ────────────▶│
  │         window: 64535 -> 535            │
  │                                         │
  │         (sender pauses)                 │
  │                                         │
  │◀─────── WINDOW_UPDATE (+32768) ────────│
  │         window: 535 -> 33303            │
  │                                         │
  │──────── DATA (continues) ──────────────▶│
```

### Connection-Level Flow Control

Similar to stream-level, but applies to all streams combined:

1. Connection window limits total bytes in flight
2. WINDOW_UPDATE with Stream ID 0 updates connection window
3. Both stream and connection windows must have space to send

---

## Error Handling

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| 0x00 | NO_ERROR | Graceful shutdown |
| 0x01 | PROTOCOL_ERROR | Protocol violation |
| 0x02 | INTERNAL_ERROR | Implementation error |
| 0x03 | FLOW_CONTROL_ERROR | Flow control violation |
| 0x04 | SETTINGS_TIMEOUT | Settings not acknowledged |
| 0x05 | STREAM_CLOSED | Stream already closed |
| 0x06 | FRAME_SIZE_ERROR | Invalid frame size |
| 0x07 | REFUSED_STREAM | Stream refused |
| 0x08 | CANCEL | Stream cancelled |
| 0x09 | AUTH_ERROR | Authentication failed |
| 0x0A | RESOURCE_LIMIT | Resource limit exceeded |

### Error Recovery

**Stream-level errors:**
- Close the affected stream
- Continue with other streams
- Client may retry operation

**Connection-level errors:**
- Send GOAWAY frame
- Close all streams
- Close WebSocket connection

---

## Security Considerations

### Authentication

```typescript
interface AuthConfig {
  // Token-based authentication
  type: 'token'
  token: string

  // Or mTLS (handled at WebSocket layer)
  type: 'mtls'
  clientCert: string
}
```

### Origin Validation

Server should validate WebSocket Origin header:

```typescript
const allowedOrigins = [
  'https://app.example.com',
  'https://localhost:3000'
]

function validateOrigin(origin: string): boolean {
  return allowedOrigins.includes(origin)
}
```

### Rate Limiting

Recommended limits:

| Resource | Default Limit |
|----------|---------------|
| Connections per IP | 10 |
| Streams per connection | 100 |
| Requests per second | 1000 |
| Bandwidth per connection | 10 MB/s |

### TLS Requirements

- Minimum TLS 1.2, prefer TLS 1.3
- Strong cipher suites only
- Valid certificates (no self-signed in production)

---

## Configuration

### Client Configuration

```typescript
interface ProxyClientConfig {
  /** WebSocket URL */
  url: string

  /** Authentication */
  auth?: {
    type: 'token'
    token: string
  }

  /** Flow control settings */
  flowControl?: {
    initialWindowSize?: number  // default: 65535
    maxWindowSize?: number      // default: 16777215
  }

  /** Timeouts */
  timeouts?: {
    connect?: number    // default: 10000ms
    handshake?: number  // default: 5000ms
    idle?: number       // default: 60000ms
  }

  /** Reconnection */
  reconnect?: {
    enabled?: boolean      // default: true
    maxAttempts?: number   // default: 5
    backoff?: {
      initial?: number     // default: 1000ms
      max?: number         // default: 30000ms
      multiplier?: number  // default: 2
    }
  }
}
```

### Server Configuration

```typescript
interface ProxyServerConfig {
  /** Listen port */
  port: number

  /** TLS configuration */
  tls?: {
    cert: string
    key: string
  }

  /** Authentication */
  auth?: {
    type: 'token'
    tokens: string[]
  }

  /** Allowed origins */
  allowedOrigins?: string[]

  /** Resource limits */
  limits?: {
    maxConnections?: number      // default: 1000
    maxStreamsPerConnection?: number  // default: 100
    maxFrameSize?: number        // default: 16384
  }

  /** WASI configuration */
  wasi?: {
    /** Allowed filesystem paths */
    preopens?: Record<string, string>

    /** Network policy */
    network?: {
      allowHosts?: string[]
      denyHosts?: string[]
    }
  }
}
```

---

## Wire Format Examples

### Handshake Sequence

```
Client -> Server: HANDSHAKE
  Type: 0x00
  Flags: 0x00
  Stream ID: 0x0000
  Payload Length: 89
  Payload: {"version":"1.0","auth":{"type":"token","token":"abc123"},"settings":{"max_streams":100}}

Server -> Client: HANDSHAKE_ACK
  Type: 0x01
  Flags: 0x00
  Stream ID: 0x0000
  Payload Length: 67
  Payload: {"version":"1.0","settings":{"max_streams":100,"max_frame_size":16384}}
```

### File Read Operation

```
Client -> Server: STREAM_OPEN
  Type: 0x02
  Flags: 0x00
  Stream ID: 0x0001
  Payload: {"type":"wasi-call","interface":"wasi:filesystem/types","function":"read","args":[3,1024,0]}

Server -> Client: STREAM_ACK
  Type: 0x03
  Flags: 0x00
  Stream ID: 0x0001

Server -> Client: DATA
  Type: 0x04
  Flags: 0x01 (END_STREAM)
  Stream ID: 0x0001
  Payload: <file contents>

Server -> Client: STREAM_CLOSE
  Type: 0x06
  Flags: 0x00
  Stream ID: 0x0001

Client -> Server: STREAM_CLOSE_ACK
  Type: 0x07
  Stream ID: 0x0001
```

---

## Implementation Notes

### JavaScript/TypeScript

```typescript
// Frame encoding
function encodeFrame(frame: Frame): Uint8Array {
  const payloadBytes = frame.payload
    ? new TextEncoder().encode(JSON.stringify(frame.payload))
    : new Uint8Array(0)

  const buffer = new ArrayBuffer(8 + payloadBytes.length)
  const view = new DataView(buffer)

  view.setUint8(0, frame.type)
  view.setUint8(1, frame.flags)
  view.setUint16(2, frame.streamId)
  view.setUint32(4, payloadBytes.length)

  new Uint8Array(buffer).set(payloadBytes, 8)

  return new Uint8Array(buffer)
}

// Frame decoding
function decodeFrame(data: ArrayBuffer): Frame {
  const view = new DataView(data)

  return {
    type: view.getUint8(0),
    flags: view.getUint8(1),
    streamId: view.getUint16(2),
    payloadLength: view.getUint32(4),
    payload: data.byteLength > 8
      ? JSON.parse(new TextDecoder().decode(data.slice(8)))
      : undefined
  }
}
```

---

## See Also

- [WASIP2 Architecture Overview](wasip2-overview.md)
- [Security Best Practices](../guides/security.md)
- [HTTP/2 Frame Format](https://httpwg.org/specs/rfc7540.html#FrameHeader) (inspiration)
