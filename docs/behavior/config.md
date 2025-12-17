# Config Behavior Contract

This document defines the behavior guarantees and cross-environment semantics for `wasi:config` implementations.

## Interface Overview

The `wasi:config` interface provides read-only configuration access to WASI components. Configuration is provided by the host and is immutable from the component's perspective.

## Key Namespace Convention

### Key Format
- Keys are strings with no enforced format
- Recommended: dot-notation for hierarchical keys (e.g., `database.host`, `feature.flags.dark-mode`)
- Keys are case-sensitive
- Empty keys are valid but discouraged

### Reserved Prefixes
The following prefixes are reserved for future use:
- `wasi.*` - WASI system configuration
- `_.*` - Internal/debug configuration

## Type Handling

### String-Only Values
All configuration values are strings. Type coercion is the component's responsibility.

```
// Host provides
{ "port": "8080", "enabled": "true", "ratio": "0.75" }

// Component must parse
const port = parseInt(config.get("port"), 10);
const enabled = config.get("enabled") === "true";
const ratio = parseFloat(config.get("ratio"));
```

### Complex Values
For complex types, use JSON encoding:
```
{ "allowed_origins": "[\"https://example.com\",\"https://api.example.com\"]" }
```

## Absence vs Denial

### Key Not Found (Absence)
When a key doesn't exist in the configuration:
- `get(key)` returns `ok(none)` (success with undefined value)
- This is NOT an error condition

### Access Denied
When policy denies access to a key:
- Default: returns `ok(none)` (indistinguishable from absence)
- With `throwOnDenied`: returns `err(io("Access denied"))`

### Rationale
Making denial indistinguishable from absence by default prevents information leakage about what configuration exists.

## Provider Behaviors

### Runtime Provider (`runtime`)
- In-memory configuration
- Mutable via host API (`MutableConfigStore`)
- Changes visible immediately to component
- No persistence

### Remote Provider (`remote`)
- Fetches configuration from HTTP endpoint
- Supports JSON, TOML, env file formats
- Caches responses (configurable TTL)
- Falls back gracefully on fetch errors

### Layered Provider (`layered`)
- Composes multiple sources with priority
- Higher priority layers override lower
- Policy enforcement (allow/deny patterns)
- Key redaction for sensitive values

### Manifest Provider (`manifest`)
- Parses JSON/TOML manifest files
- Flattens nested objects to dot-notation
- Environment variable interpolation
- Auto-detects format

### Env Bridge Provider (`env-bridge`)
- Maps environment variables to config keys
- Explicit mappings only (no automatic exposure)
- Key transformation (case, prefix)
- Validation patterns

### Fixed Provider (`fixed`)
- Immutable configuration
- Deterministic ordering
- Snapshot serialization
- Comparison utilities for testing

## Secrets Handling

### Default Stance: Opaque
- No special handling for secrets by default
- All values treated equally

### Policy-Based Redaction
```typescript
{
  policy: {
    redactKeys: ['*.password', '*.secret', '*.key', '*.token']
  }
}
```
Redacted keys:
- Still accessible to component
- Marked as sensitive in debug output
- Not logged in audit trails

### Recommended Patterns
1. Use dedicated secret stores for sensitive data
2. Pass secrets via environment variables with explicit mapping
3. Use short-lived tokens when possible

## Error Handling

### Error Types
```typescript
type ConfigError =
  | { tag: 'upstream'; val: string }  // Remote source error
  | { tag: 'io'; val: string }        // I/O or access error
```

### Error Conditions
| Condition | Result |
|-----------|--------|
| Key not found | `ok(none)` |
| Access denied (default) | `ok(none)` |
| Access denied (strict) | `err(io(...))` |
| Remote fetch failed | `err(upstream(...))` |
| Parse error | `err(io(...))` |

## Ordering Guarantees

### get-all() Order
- `fixed`: Deterministic alphabetical order
- `layered`: Undefined order (implementation-dependent)
- `manifest`: Undefined order
- Others: Undefined order

### For Deterministic Tests
Use `fixed` provider which guarantees:
- Alphabetically sorted keys
- Consistent snapshot serialization
- Reproducible iteration order

## Environment-Specific Notes

### Browser
- No `process.env` access
- Use `manifest` with inline content
- Use `env-bridge` with explicit env object

### Node.js
- Full `process.env` access
- `env-bridge` defaults to `process.env`
- File-based manifests supported

### Edge/Workers
- Limited environment variable access
- Use `manifest` with bundled configuration
- `remote` may have fetch restrictions

## Testing Recommendations

### Unit Tests
```typescript
// Use fixed provider for deterministic tests
const config = createFixedConfig({
  'feature.enabled': 'true',
  'api.endpoint': 'https://test.example.com'
});
```

### Snapshot Testing
```typescript
const snapshot = config.toSnapshot();
// Save snapshot to file
// Later: compare with assertConfigsEqual()
```

### Mocking Remote Config
```typescript
const config = manifestConfigImplementation.create({
  manifests: { content: mockConfigObject }
});
```
