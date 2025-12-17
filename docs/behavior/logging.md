# Logging Behavior Contract

This document defines the behavior guarantees and cross-environment semantics for `wasi:logging` implementations.

## Interface Overview

The `wasi:logging` interface provides structured logging capabilities beyond simple stdout/stderr, with support for log levels, structured fields, and multiple output sinks.

## Log Levels

### Level Hierarchy
```
TRACE < DEBUG < INFO < WARN < ERROR
```

### Level Semantics
| Level | Use Case | Typical Volume |
|-------|----------|----------------|
| TRACE | Detailed debugging | Very high |
| DEBUG | Development debugging | High |
| INFO | Normal operations | Medium |
| WARN | Potential issues | Low |
| ERROR | Failures | Very low |

### Level Filtering
```typescript
{
  level: 'info' // Only INFO and above logged
}
```

Filtering behavior:
- Levels below threshold are discarded
- No processing overhead for filtered logs
- Level can be changed at runtime

## Provider Behaviors

### Console Provider (`console`)
- Outputs to browser/Node console
- Color-coded by level
- Structured fields as objects
- Best for development

### Stderr Provider (`stderr`)
- Outputs to stderr stream
- Plain text or JSON format
- Best for traditional logging
- Pipe-friendly

### NDJSON Provider (`ndjson`)
- Newline-delimited JSON
- Machine-readable
- Each log is complete JSON object
- Best for log aggregation

### Ring Buffer Provider (`ringbuffer`)
- In-memory circular buffer
- Queryable log history
- Fixed memory footprint
- Best for debugging/snapshots

### OTLP Provider (`otlp`)
- OpenTelemetry Protocol
- Exports to collectors
- Full observability integration
- Best for production monitoring

## Structured Fields

### Field Types
```typescript
log('User logged in', {
  user_id: 12345,           // number
  username: 'alice',        // string
  admin: true,              // boolean
  roles: ['user', 'mod'],   // array (JSON-encoded)
  metadata: { ip: '...' }   // object (JSON-encoded)
});
```

### Reserved Fields
| Field | Purpose | Auto-populated |
|-------|---------|----------------|
| `timestamp` | Log time | Yes |
| `level` | Log level | Yes |
| `message` | Log message | Yes |
| `logger` | Logger name | If configured |

### Field Naming
- Use snake_case
- Keep names short but descriptive
- Avoid deeply nested objects

## Output Format

### Console Format
```
[2024-01-15T10:30:00Z] INFO  User logged in { user_id: 12345, username: 'alice' }
```

### NDJSON Format
```json
{"timestamp":"2024-01-15T10:30:00.000Z","level":"info","message":"User logged in","user_id":12345,"username":"alice"}
```

### Text Format
```
2024-01-15T10:30:00.000Z INFO User logged in user_id=12345 username=alice
```

## Truncation Limits

### Message Length
| Provider | Default | Max | Configurable |
|----------|---------|-----|--------------|
| console | 10KB | 100KB | Yes |
| ndjson | 64KB | 1MB | Yes |
| ringbuffer | 1KB | 64KB | Yes |

### Field Value Length
- Individual field values: 4KB default
- Total fields size: 16KB default
- Excess truncated with `...`

### Truncation Indicators
```json
{"message":"Very long message that was trun...[TRUNCATED]"}
```

## Redaction

### Automatic Redaction
```typescript
{
  redact: ['password', 'token', 'secret', 'key', 'credential']
}
```

### Redaction Behavior
```typescript
// Input
log('Auth', { password: 'secret123', username: 'alice' });

// Output
{ "password": "[REDACTED]", "username": "alice" }
```

### Pattern-Based Redaction
```typescript
{
  redactPatterns: [
    /password/i,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/  // emails
  ]
}
```

## Ordering Guarantees

### Same Logger
- Logs from same logger are ordered
- Order preserved within single call

### Multiple Loggers
- No ordering guarantee across loggers
- Timestamps provide ordering information

### Async Sinks
- OTLP: Best-effort ordering
- Ring buffer: Strict ordering
- Console/stderr: Ordered per-stream

## Ring Buffer

### Capacity
```typescript
{
  capacity: 1000,  // entries
  // OR
  maxSize: 1048576  // bytes
}
```

### Querying
```typescript
// Get all entries
const logs = buffer.getAll();

// Filter by level
const errors = buffer.getByLevel('error');

// Filter by time
const recent = buffer.getSince(Date.now() - 60000);
```

### Export
```typescript
// Export for debugging
const snapshot = buffer.export();
// Returns: Array<LogEntry>

// Export as NDJSON
const ndjson = buffer.exportNdjson();
```

## Error Handling

### Sink Errors
- Console: Errors ignored (best-effort)
- NDJSON: Errors to stderr
- OTLP: Retry with backoff, then drop
- Ring buffer: Never fails (overwrites old)

### Invalid Data
- Non-serializable fields: Converted to string
- Circular references: Replaced with `[Circular]`
- Symbols: Converted to string

## Environment-Specific Notes

### Browser
- Console provider uses browser console
- Color support depends on DevTools
- Ring buffer useful for remote debugging

### Node.js
- Stderr provider for traditional logging
- NDJSON for log aggregation
- OTLP for full observability

### Production
- Use structured logging (NDJSON/OTLP)
- Set appropriate log level
- Configure redaction
- Monitor log volume

## Performance

### Overhead
| Provider | Latency | Memory |
|----------|---------|--------|
| console | ~0.1ms | Minimal |
| ndjson | ~0.05ms | Minimal |
| ringbuffer | ~0.01ms | Fixed |
| otlp | ~1ms* | Buffer |

*OTLP batches and sends asynchronously

### High-Volume Logging
- Use level filtering
- Consider sampling
- Use ring buffer for debugging

## Testing

### Test Logger
```typescript
const logger = createTestLogger();

// Run code that logs...

expect(logger.getEntries()).toHaveLength(3);
expect(logger.getByLevel('error')).toHaveLength(0);
```

### Log Assertions
```typescript
expect(logger.getEntries()).toContainEqual(
  expect.objectContaining({
    level: 'info',
    message: 'User logged in'
  })
);
```

### Ring Buffer Testing
```typescript
// Capture logs during test
const buffer = createRingBuffer({ capacity: 100 });

// Run test...

// Assert on captured logs
const errors = buffer.getByLevel('error');
expect(errors).toHaveLength(0);
```
