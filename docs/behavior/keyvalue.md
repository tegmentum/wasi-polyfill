# KeyValue Behavior Contract

This document defines the behavior guarantees and cross-environment semantics for `wasi:keyvalue` implementations.

## Interface Overview

The `wasi:keyvalue` interface provides a portable key-value store abstraction with support for CRUD operations, batch operations, and optional TTL support.

## Provider Behaviors

### Memory Provider (`mem`)
- In-memory storage
- No persistence
- Fast operations
- Best for testing/caching

### IndexedDB Provider (`idb`)
- Browser IndexedDB backend
- Persistent across sessions
- Origin-scoped
- Async operations

### Replay Provider (`replay`)
- Record/replay for testing
- Deterministic responses
- State snapshots

### Remote Providers
- HTTP/Redis via proxy
- Network latency
- Distributed access

## Atomicity Guarantees

### Single-Key Operations
| Operation | Atomicity |
|-----------|-----------|
| get | Atomic |
| set | Atomic |
| delete | Atomic |
| exists | Atomic |

### Multi-Key Operations
| Operation | Atomicity |
|-----------|-----------|
| get-many | NOT atomic |
| set-many | NOT atomic |
| delete-many | NOT atomic |

### Compare-and-Swap
```typescript
// Atomic CAS (if supported)
const success = await store.cas(key, expectedValue, newValue);
```

| Provider | CAS Support |
|----------|-------------|
| mem | Yes |
| idb | Yes |
| remote | Provider-dependent |

## Batch Semantics

### Batch Get
```typescript
const results = await store.getMany(['key1', 'key2', 'key3']);
// Returns: Map<string, Uint8Array | undefined>
```

Behavior:
- Missing keys return `undefined`
- Partial failure possible
- Order NOT guaranteed

### Batch Set
```typescript
await store.setMany([
  ['key1', value1],
  ['key2', value2]
]);
```

Behavior:
- All-or-nothing NOT guaranteed
- Partial writes possible
- Check individual results

### Batch Delete
```typescript
await store.deleteMany(['key1', 'key2']);
```

Behavior:
- Non-existent keys silently ignored
- Partial deletion possible

## Iteration Order

### Key Listing
```typescript
const keys = await store.keys();
// Order is NOT guaranteed
```

| Provider | Order |
|----------|-------|
| mem | Insertion order |
| idb | Lexicographic |
| remote | Provider-dependent |

### Sorted Iteration
Sort explicitly if needed:
```typescript
const keys = await store.keys();
keys.sort(); // Lexicographic sort
```

### Prefix Scanning
```typescript
// Get keys with prefix
const keys = await store.keys({ prefix: 'user:' });
```

## TTL Support

### Setting TTL
```typescript
// Set with expiration
await store.set(key, value, { ttl: 3600 }); // 1 hour
```

### TTL Behavior
| Provider | TTL Support | Precision |
|----------|-------------|-----------|
| mem | Yes | Milliseconds |
| idb | Yes | Seconds |
| remote | Provider-dependent | Varies |

### Expiration Semantics
- Expired keys return `undefined`
- Expired keys excluded from listing
- Cleanup timing varies by provider

### TTL on Existing Keys
```typescript
// Update TTL only
await store.touch(key, { ttl: 7200 });

// Remove TTL (persist forever)
await store.persist(key);
```

## Value Types

### Binary Values
All values are `Uint8Array`:
```typescript
// Store string
const value = new TextEncoder().encode('hello');
await store.set('key', value);

// Retrieve string
const data = await store.get('key');
const str = new TextDecoder().decode(data);
```

### JSON Values
```typescript
// Store JSON
const value = new TextEncoder().encode(JSON.stringify({ foo: 'bar' }));
await store.set('key', value);

// Retrieve JSON
const data = await store.get('key');
const obj = JSON.parse(new TextDecoder().decode(data));
```

### Size Limits
| Provider | Max Key Size | Max Value Size |
|----------|--------------|----------------|
| mem | 1MB | 100MB |
| idb | 1KB | 500MB |
| remote | Varies | Varies |

## Error Handling

### Error Types
| Error | Meaning |
|-------|---------|
| `no-such-store` | Store doesn't exist |
| `access-denied` | Permission error |
| `quota-exceeded` | Storage limit reached |
| `invalid-key` | Key format invalid |
| `too-large` | Value exceeds limit |

### Error Recovery
```typescript
try {
  await store.set(key, largeValue);
} catch (e) {
  if (e.code === 'quota-exceeded') {
    // Clean up old data
    await store.deleteMany(oldKeys);
    // Retry
    await store.set(key, largeValue);
  }
}
```

## Store Isolation

### Named Stores
```typescript
// Different stores are isolated
const userStore = kv.open('users');
const cacheStore = kv.open('cache');
```

### Cross-Store Operations
- NOT supported
- Each store is independent
- No transactions across stores

## Environment-Specific Notes

### Browser
- Use IDB for persistence
- Subject to storage quotas
- Origin-scoped isolation
- Async operations only

### Node.js
- Memory provider for caching
- Consider Redis for distributed
- File-backed options available

### Edge/Workers
- Memory provider (per-request)
- External KV via HTTP
- Short-lived storage

## Performance

### Operation Latency
| Provider | get | set | delete |
|----------|-----|-----|--------|
| mem | ~0.01ms | ~0.01ms | ~0.01ms |
| idb | ~1ms | ~5ms | ~2ms |
| remote | ~10-100ms | ~10-100ms | ~10-100ms |

### Optimization Tips
- Batch operations when possible
- Use appropriate value sizes
- Avoid polling (use watches if available)

## Testing

### Memory Provider Testing
```typescript
const store = memKvProvider.create({
  initial: {
    'key1': encode('value1'),
    'key2': encode('value2')
  }
});

// Test operations...

expect(await store.get('key1')).toEqual(encode('value1'));
```

### Replay Provider Testing
```typescript
// Record responses
const recorder = createKvRecorder();
await recorder.set('key', value);
const snapshot = recorder.getSnapshot();

// Replay in tests
const replay = createKvReplay(snapshot);
expect(await replay.get('key')).toEqual(value);
```

### Isolation Testing
```typescript
beforeEach(() => {
  // Fresh store per test
  store = memKvProvider.create({});
});
```

## Consistency Model

### Strong Consistency
- mem: Yes (single-threaded)
- idb: Yes (per-origin)
- remote: Provider-dependent

### Read-After-Write
```typescript
await store.set('key', value);
const result = await store.get('key');
// Guaranteed: result === value
```

| Provider | Guarantee |
|----------|-----------|
| mem | Always |
| idb | Always |
| remote | Usually (check provider) |

## Quotas and Limits

### Browser Quotas
- IDB: ~50MB minimum
- May request more storage
- Eviction under pressure

### Monitoring Usage
```typescript
const info = await store.info();
// { keyCount: 1000, sizeBytes: 5242880, quota: 52428800 }
```
