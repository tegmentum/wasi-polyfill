# Filesystem Behavior Contract

This document defines the behavior guarantees and cross-environment semantics for `wasi:filesystem` implementations.

## Interface Overview

The `wasi:filesystem` interface provides file and directory operations. Access is capability-based through preopened directories.

## Preopens

### Capability Model
- Components have NO filesystem access by default
- Host explicitly grants access via preopens
- Each preopen is a (descriptor, path) pair
- Access is scoped to preopen subtrees only

### Preopen Configuration
```typescript
{
  preopens: [
    { guest: '/', host: '/sandbox/app' },
    { guest: '/tmp', host: '/sandbox/tmp' },
    { guest: '/data', host: '/sandbox/data', readonly: true }
  ]
}
```

## Provider Behaviors

### Memory Provider (`memory`)
- Fully in-memory filesystem
- No persistence across sessions
- Fast, suitable for testing
- Unlimited by default (configurable limits)

### OPFS Provider (`opfs`)
- Browser Origin Private File System
- Persistent across sessions
- Origin-scoped (not shared across origins)
- Async operations only

### Node Provider (`node`)
- Maps to real filesystem
- Full POSIX semantics
- Requires explicit preopen paths

## Rename Atomicity

### Guaranteed Atomic
- Rename within same directory
- Rename within same filesystem/provider

### NOT Guaranteed Atomic
- Cross-filesystem renames (copy + delete)
- Cross-provider renames

### Behavior Matrix
| Provider | Same-dir | Cross-dir | Cross-mount |
|----------|----------|-----------|-------------|
| memory | Atomic | Atomic | Error |
| opfs | Atomic | Atomic | Error |
| node | Atomic | Atomic* | Error |

*Node cross-dir atomicity depends on underlying filesystem.

## Symlinks

### Memory Provider
- Symlinks NOT supported
- `create-symlink` returns `err(not-supported)`
- `readlink` returns `err(not-supported)`

### OPFS Provider
- Symlinks NOT supported (browser limitation)
- Same behavior as memory

### Node Provider
- Full symlink support
- Follows POSIX semantics
- Dangling symlinks allowed

## Timestamps

### Precision
| Provider | Resolution | Source |
|----------|------------|--------|
| memory | Milliseconds | `Date.now()` |
| opfs | Microseconds | File API |
| node | Nanoseconds | `fs.stat` |

### Timestamp Types
- `access-time`: Last read
- `modify-time`: Last write
- `change-time`: Last metadata change (Node only)

### Timestamp Updates
| Operation | access | modify | change |
|-----------|--------|--------|--------|
| read | Yes | No | No |
| write | No | Yes | Yes |
| chmod | No | No | Yes |
| rename | No | No | Yes |

## Path Handling

### Path Separators
- Internal: Always `/` (forward slash)
- External (Node): Converted to platform separator

### Path Resolution
- Absolute paths: Resolved against preopen root
- Relative paths: Resolved against current working directory
- `..` components: Resolved, cannot escape preopen

### Path Validation
```
Valid:   /foo/bar, foo/bar, ./foo, ../foo
Invalid: /foo/../../../escape (escapes preopen)
```

## File Descriptors

### Limits
| Provider | Default Max FDs | Configurable |
|----------|-----------------|--------------|
| memory | 1024 | Yes |
| opfs | 256 | Yes |
| node | System limit | No |

### Descriptor Lifecycle
1. Open: Allocates FD
2. Use: Read/write/seek
3. Close: Releases FD

### Automatic Cleanup
- Descriptors closed on component termination
- No cleanup on component crash (memory provider)

## Directory Operations

### Listing Order
- NOT guaranteed to be sorted
- NOT guaranteed to be stable across calls
- May include `.` and `..` entries

### Empty Directories
- Can be created
- Can be deleted (must be empty)
- Attempting to delete non-empty: `err(not-empty)`

## Error Mapping

| POSIX Error | WASI Error | Notes |
|-------------|------------|-------|
| ENOENT | `no-entry` | File/dir not found |
| EEXIST | `exist` | Already exists |
| EACCES | `access` | Permission denied |
| EISDIR | `is-directory` | Is a directory |
| ENOTDIR | `not-directory` | Not a directory |
| ENOTEMPTY | `not-empty` | Directory not empty |
| ENOSPC | `no-space` | No space left |
| EROFS | `read-only` | Read-only filesystem |

## Environment-Specific Notes

### Browser
- Use `memory` for ephemeral storage
- Use `opfs` for persistence
- No access to real filesystem
- 50MB+ OPFS quota (varies by browser)

### Node.js
- Full filesystem access possible
- Respect system permissions
- Handle symlinks appropriately

### Testing
- Use `memory` provider for fast, isolated tests
- Pre-populate with test fixtures
- Assert on final filesystem state

## Security Considerations

### Path Traversal
- All paths validated against preopen boundaries
- `..` cannot escape preopen root
- Symlinks followed only within preopen

### Sensitive Files
- Avoid preopening system directories
- Use minimal required paths
- Consider read-only where possible

### Resource Limits
- Configure max file size
- Configure max total size
- Configure max open descriptors
