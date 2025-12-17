# HTTP Behavior Contract

This document defines the behavior guarantees and cross-environment semantics for `wasi:http` implementations.

## Interface Overview

The `wasi:http` interface provides HTTP client and server capabilities. It supports both outgoing requests and incoming request handling.

## Provider Behaviors

### Fetch Provider (`fetch`)
- Uses browser/Node `fetch()` API
- Full HTTP/1.1 and HTTP/2 support
- Automatic redirect handling
- Browser security restrictions apply

### Proxy Provider (`proxy`)
- Routes through WebSocket proxy
- Bypasses browser restrictions
- Access to forbidden headers
- Custom redirect handling

### Undici Provider (`undici`)
- Node.js native HTTP client
- Connection pooling
- HTTP/1.1 and HTTP/2
- Full header access

## Forbidden Headers (Browser)

### Request Headers
The following headers CANNOT be set in browser fetch:
- `Accept-Charset`
- `Accept-Encoding`
- `Access-Control-Request-Headers`
- `Access-Control-Request-Method`
- `Connection`
- `Content-Length`
- `Cookie`
- `Date`
- `DNT`
- `Expect`
- `Host`
- `Keep-Alive`
- `Origin`
- `Proxy-*`
- `Sec-*`
- `TE`
- `Trailer`
- `Transfer-Encoding`
- `Upgrade`
- `Via`

### Workaround
Use proxy provider to set forbidden headers:
```typescript
{
  implementation: 'proxy',
  proxy: { url: 'wss://proxy.example.com/ws' }
}
```

## Streaming Availability

### Request Body Streaming
| Provider | Streaming | Notes |
|----------|-----------|-------|
| fetch (browser) | Yes* | ReadableStream support varies |
| fetch (node) | Yes | Full support |
| proxy | Yes | Via chunked encoding |
| undici | Yes | Full support |

### Response Body Streaming
| Provider | Streaming | Notes |
|----------|-----------|-------|
| fetch | Yes | Via Response.body |
| proxy | Yes | Chunked transfer |
| undici | Yes | Full support |

### Half-Duplex Limitation
Browser fetch cannot:
- Read response while still sending request
- True bidirectional streaming requires WebSocket

## Redirect Policy

### Default Behavior
| Provider | Default | Max Redirects |
|----------|---------|---------------|
| fetch | Follow | 20 |
| proxy | Follow | 20 |
| undici | Follow | 20 |

### Redirect Modes
```typescript
{
  redirect: 'follow' | 'error' | 'manual'
}
```

- `follow`: Automatically follow redirects
- `error`: Throw on redirect
- `manual`: Return redirect response to caller

### Cross-Origin Redirects
- Browser: Subject to CORS policy
- Proxy: Handled by proxy server
- Node: No restrictions

## Request/Response Bodies

### Content-Length
- Set automatically for known-size bodies
- Omitted for streaming bodies (chunked)

### Compression
| Provider | Accept-Encoding | Content-Encoding |
|----------|-----------------|------------------|
| fetch | Automatic | Automatic decode |
| proxy | Configurable | Pass-through |
| undici | Configurable | Configurable |

### Body Types
```typescript
// Supported body types
body: string | ArrayBuffer | Blob | ReadableStream | URLSearchParams | FormData
```

## Timeout Behavior

### Timeout Types
| Type | Default | Notes |
|------|---------|-------|
| Connect | 30s | Time to establish connection |
| Request | 300s | Total request time |
| Idle | 60s | Between data chunks |

### Configuration
```typescript
{
  timeouts: {
    connect: 30000,
    request: 300000,
    idle: 60000
  }
}
```

## Error Handling

### Network Errors
| Error | Meaning |
|-------|---------|
| `network-error` | Connection failed |
| `timeout` | Request timed out |
| `dns-error` | DNS resolution failed |

### HTTP Errors
| Error | Meaning |
|-------|---------|
| `invalid-url` | Malformed URL |
| `too-many-redirects` | Exceeded redirect limit |
| `protocol-error` | HTTP protocol violation |

### Status Codes
- 4xx/5xx are NOT errors at transport level
- Application must check status code

## HTTP Methods

### Supported Methods
All standard HTTP methods supported:
- `GET`, `HEAD`, `POST`, `PUT`, `DELETE`
- `CONNECT`, `OPTIONS`, `TRACE`, `PATCH`

### Method Restrictions (Browser)
- `CONNECT`: Not allowed
- `TRACE`: Not allowed
- Custom methods: Allowed

## Headers

### Header Names
- Case-insensitive
- Normalized to lowercase internally

### Multiple Values
```typescript
// Setting multiple values
headers.append('Accept', 'text/html');
headers.append('Accept', 'application/json');

// Results in: Accept: text/html, application/json
```

### Header Size Limits
| Provider | Name Limit | Value Limit | Total Limit |
|----------|------------|-------------|-------------|
| fetch | 8KB | 16KB | 32KB |
| proxy | 8KB | 16KB | 64KB |
| undici | Configurable | Configurable | Configurable |

## CORS (Browser)

### Simple Requests
No preflight for:
- Methods: GET, HEAD, POST
- Headers: Accept, Accept-Language, Content-Language
- Content-Type: application/x-www-form-urlencoded, multipart/form-data, text/plain

### Preflight Requests
Automatic OPTIONS request for:
- Custom methods
- Custom headers
- Non-simple content types

### Credentials
```typescript
{
  credentials: 'omit' | 'same-origin' | 'include'
}
```

## Server-Side (Incoming Handler)

### Request Properties
- `method`: HTTP method
- `uri`: Request URI
- `headers`: Request headers
- `body`: Request body stream

### Response Construction
```typescript
{
  status: 200,
  headers: [['Content-Type', 'application/json']],
  body: '{"success": true}'
}
```

### Streaming Response
```typescript
{
  status: 200,
  headers: [['Transfer-Encoding', 'chunked']],
  body: readableStream
}
```

## Environment-Specific Notes

### Browser
- Subject to CORS
- Cannot access some headers
- Use proxy for full control

### Node.js
- No CORS restrictions
- Full header access
- Connection pooling available

### Edge/Workers
- Fetch-based
- May have execution time limits
- Streaming may be limited

## Testing

### Mock Responses
```typescript
const http = createMockHttp({
  'https://api.example.com/users': {
    status: 200,
    body: JSON.stringify([{ id: 1, name: 'Test' }])
  }
});
```

### Request Inspection
```typescript
const requests = http.getRecordedRequests();
expect(requests[0].url).toBe('https://api.example.com/users');
```
