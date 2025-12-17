# BlobStore Behavior Contract

This document defines the behavior guarantees and cross-environment semantics for `wasi:blobstore` implementations.

## Interface Overview

The `wasi:blobstore` interface provides object/blob storage abstraction similar to S3, with support for containers (buckets), streaming uploads/downloads, and metadata.

## Provider Behaviors

### Memory Provider (`mem`)
- In-memory storage
- No persistence
- No size limits (except memory)
- Best for testing

### OPFS Provider (`opfs`)
- Browser Origin Private File System
- Persistent across sessions
- Large blob support
- Origin-scoped

### Replay Provider (`replay`)
- Record/replay for testing
- Deterministic responses
- Snapshot support

### Remote Providers
- S3-compatible via proxy
- Azure Blob Storage
- GCS (Google Cloud Storage)

## Container Model

### Container Operations
```typescript
// Create container
await blobstore.createContainer('my-bucket');

// List containers
const containers = await blobstore.listContainers();

// Delete container
await blobstore.deleteContainer('my-bucket');
// Must be empty to delete
```

### Container Names
- Lowercase letters, numbers, hyphens
- 3-63 characters
- Cannot start/end with hyphen
- Must be unique within store

## Object Operations

### Write Object
```typescript
await blobstore.writeObject('container', 'path/to/file.txt', data);
```

### Read Object
```typescript
const data = await blobstore.readObject('container', 'path/to/file.txt');
```

### Delete Object
```typescript
await blobstore.deleteObject('container', 'path/to/file.txt');
```

### Check Existence
```typescript
const exists = await blobstore.hasObject('container', 'path/to/file.txt');
```

## Range Read Semantics

### Byte Ranges
```typescript
// Read bytes 100-199
const data = await blobstore.readObject('container', 'file.bin', {
  range: { start: 100, end: 199 }
});
```

### Range Behavior
| Request | Response |
|---------|----------|
| `start: 0, end: 99` | First 100 bytes |
| `start: 100` | Byte 100 to end |
| `end: -100` | Last 100 bytes |
| Beyond EOF | Truncated to actual size |

### Provider Support
| Provider | Range Read | Range Write |
|----------|------------|-------------|
| mem | Yes | No |
| opfs | Yes | No |
| s3 | Yes | Yes (multipart) |

## Streaming Behavior

### Streaming Upload
```typescript
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(chunk1);
    controller.enqueue(chunk2);
    controller.close();
  }
});

await blobstore.writeObjectStream('container', 'large-file.bin', stream);
```

### Streaming Download
```typescript
const stream = await blobstore.readObjectStream('container', 'large-file.bin');

const reader = stream.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // Process chunk
}
```

### Backpressure
- Streaming respects backpressure
- Slow consumers pause producers
- Memory bounded by buffer size

### Buffer Configuration
```typescript
{
  streaming: {
    readBufferSize: 65536,   // 64KB
    writeBufferSize: 1048576 // 1MB
  }
}
```

## Metadata Fields

### Standard Metadata
| Field | Type | Description |
|-------|------|-------------|
| `content-type` | string | MIME type |
| `content-length` | number | Size in bytes |
| `etag` | string | Entity tag |
| `last-modified` | Date | Modification time |

### Custom Metadata
```typescript
await blobstore.writeObject('container', 'file.txt', data, {
  metadata: {
    'x-custom-field': 'value',
    'x-author': 'alice'
  }
});

const info = await blobstore.getObjectInfo('container', 'file.txt');
// info.metadata['x-custom-field'] === 'value'
```

### Metadata Limits
| Provider | Max Keys | Max Key Size | Max Value Size |
|----------|----------|--------------|----------------|
| mem | Unlimited | 1KB | 8KB |
| opfs | 100 | 256B | 2KB |
| s3 | 10 | 128B | 2KB |

## Listing Pagination

### Basic Listing
```typescript
const objects = await blobstore.listObjects('container');
// Returns first page
```

### Paginated Listing
```typescript
let cursor = undefined;
const allObjects = [];

do {
  const result = await blobstore.listObjects('container', {
    limit: 100,
    cursor
  });
  allObjects.push(...result.objects);
  cursor = result.nextCursor;
} while (cursor);
```

### Prefix Filtering
```typescript
const images = await blobstore.listObjects('container', {
  prefix: 'images/'
});
```

### Delimiter (Hierarchy)
```typescript
// List "directories" at root
const result = await blobstore.listObjects('container', {
  delimiter: '/'
});
// result.prefixes: ['images/', 'docs/', 'data/']
// result.objects: [files at root]
```

### Listing Order
| Provider | Order |
|----------|-------|
| mem | Insertion order |
| opfs | Lexicographic |
| s3 | Lexicographic |

## Error Handling

### Error Types
| Error | Meaning |
|-------|---------|
| `container-not-found` | Container doesn't exist |
| `object-not-found` | Object doesn't exist |
| `container-exists` | Container already exists |
| `container-not-empty` | Cannot delete non-empty |
| `quota-exceeded` | Storage limit reached |
| `access-denied` | Permission error |

### Error Recovery
```typescript
try {
  await blobstore.readObject('container', 'file.txt');
} catch (e) {
  if (e.code === 'object-not-found') {
    // Handle missing object
    return null;
  }
  throw e;
}
```

## Concurrency

### Concurrent Reads
- Fully supported
- No interference
- Consistent snapshots

### Concurrent Writes
- Last-write-wins (no locking)
- Use ETags for optimistic concurrency

### Optimistic Concurrency
```typescript
// Read with ETag
const { data, etag } = await blobstore.readObject('container', 'file.txt', {
  includeEtag: true
});

// Conditional write
await blobstore.writeObject('container', 'file.txt', newData, {
  ifMatch: etag  // Fails if modified since read
});
```

## Environment-Specific Notes

### Browser
- Use OPFS for persistence
- Memory for caching
- Subject to quota limits
- No direct S3 access (use proxy)

### Node.js
- Memory for testing
- File-system backend available
- Direct S3/GCS/Azure access

### Edge/Workers
- Memory only (ephemeral)
- Remote via HTTP
- Limited execution time

## Performance

### Operation Latency
| Provider | Read | Write | List |
|----------|------|-------|------|
| mem | ~0.01ms | ~0.01ms | ~0.1ms |
| opfs | ~1ms | ~5ms | ~10ms |
| s3 | ~50ms | ~100ms | ~100ms |

### Streaming Performance
- Chunked transfer reduces memory
- Backpressure prevents overload
- Parallel chunks for large files

### Optimization Tips
- Use streaming for large objects
- Batch small writes
- Implement client-side caching
- Use range reads for partial access

## Testing

### Memory Provider Testing
```typescript
const blobstore = memBlobProvider.create({
  initial: {
    'container': {
      'file1.txt': encode('content1'),
      'file2.txt': encode('content2')
    }
  }
});

// Test operations...
```

### Replay Provider Testing
```typescript
// Record operations
const recorder = createBlobRecorder();
await recorder.writeObject('bucket', 'key', data);
const snapshot = recorder.getSnapshot();

// Replay in tests
const replay = createBlobReplay(snapshot);
const result = await replay.readObject('bucket', 'key');
expect(result).toEqual(data);
```

### Large File Testing
```typescript
// Generate test data
const largeData = new Uint8Array(100 * 1024 * 1024); // 100MB

// Test streaming upload
const stream = new Response(largeData).body;
await blobstore.writeObjectStream('container', 'large.bin', stream);
```

## Quotas and Limits

### Browser OPFS
- Varies by browser
- Typically 10% of disk
- Can request more via API

### Size Limits
| Provider | Max Object Size | Max Container Size |
|----------|-----------------|-------------------|
| mem | Available RAM | Available RAM |
| opfs | Quota | Quota |
| s3 | 5TB | Unlimited |

### Monitoring Usage
```typescript
const usage = await blobstore.getUsage('container');
// { objectCount: 1000, totalBytes: 5242880 }
```
