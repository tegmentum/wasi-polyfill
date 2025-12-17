# CLI Behavior Contract

This document defines the behavior guarantees and cross-environment semantics for `wasi:cli` implementations.

## Interface Overview

The `wasi:cli` interface provides command-line environment access including:
- Environment variables
- Command-line arguments
- Standard I/O streams (stdin, stdout, stderr)
- Exit handling
- Terminal information

## Provider Behaviors

### Virtual Provider (`virtual`)
- Configurable environment and args
- Captured I/O streams
- Programmable exit handling
- No system access

### Browser Provider (`browser`)
- URL parameters as arguments
- No environment variables (unless provided)
- Console-based I/O
- Page navigation for exit

### Node Provider (`node`)
- Real `process.env`
- Real `process.argv`
- Real stdin/stdout/stderr
- Real `process.exit()`

## Environment Variables

### Access Patterns
```typescript
// Get single variable
const home = env.get('HOME');

// Get all variables
const all = env.getAll(); // Array<[string, string]>
```

### Virtual Environment
```typescript
{
  environment: {
    'HOME': '/home/user',
    'PATH': '/usr/bin',
    'CUSTOM_VAR': 'value'
  }
}
```

### Browser Environment
- No `process.env` available
- Must be explicitly provided
- URL search params can be mapped

### Ordering Guarantees
- `getAll()`: No guaranteed order
- Iteration order may vary between calls
- Sort explicitly if order matters

## Command-Line Arguments

### Argument Format
```typescript
// args[0] is typically program name
const args = cli.getArguments();
// ['program', '--flag', 'value', 'positional']
```

### Virtual Arguments
```typescript
{
  args: ['myprogram', '--verbose', '--config', 'app.toml']
}
```

### Browser Arguments
```typescript
// URL: https://example.com/app?verbose&config=app.toml
// Mapped to: ['app', '--verbose', '--config', 'app.toml']
```

## Standard I/O Streams

### Stream Types
| Stream | Direction | Purpose |
|--------|-----------|---------|
| stdin | Input | User input, piped data |
| stdout | Output | Normal output |
| stderr | Output | Errors, diagnostics |

### Ordering Guarantees

#### Same Stream
- Writes to same stream are ordered
- No interleaving within single write

#### Cross-Stream
- stdout/stderr ordering NOT guaranteed
- Writes may interleave
- Buffering affects ordering

```typescript
// These may appear in any order:
stdout.write('output1');
stderr.write('error1');
stdout.write('output2');

// Possible outputs:
// output1error1output2
// output1output2error1
// error1output1output2
// ...
```

### Buffering

| Provider | stdout | stderr | Flush |
|----------|--------|--------|-------|
| virtual | Full | Line | Manual |
| browser | None | None | Immediate |
| node | Line/Full | Line | Manual |

### Virtual I/O Capture
```typescript
const cli = virtualCliProvider.create({
  captureOutput: true
});

// After component runs:
const stdout = cli.getStdout(); // Captured output
const stderr = cli.getStderr(); // Captured errors
```

### Browser I/O
```typescript
// stdout → console.log
// stderr → console.error
// stdin → prompt() or custom handler
```

## Exit Semantics

### Exit Codes
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Misuse of command |
| 126 | Cannot execute |
| 127 | Command not found |
| 128+N | Fatal signal N |

### Exit Behavior

#### Virtual Provider
```typescript
{
  exit: {
    throw: true,  // Throw ExitError
    // OR
    callback: (code) => { /* custom handling */ }
  }
}
```

#### Browser Provider
- Default: No action (log only)
- Optional: Navigate away
- Optional: Close tab/window

#### Node Provider
- Calls `process.exit(code)`
- Terminates process immediately

### Exit vs Return
```typescript
// Component exit(0) - explicit termination
cli.exit({ tag: 'ok' });

// Component return - normal completion
// Implicitly exit(0)
```

## Terminal Information

### Terminal Detection
```typescript
const isTerminal = cli.isTerminal(stdout);
// true if output is interactive terminal
```

| Provider | stdin | stdout | stderr |
|----------|-------|--------|--------|
| virtual | Configurable | Configurable | Configurable |
| browser | false | false | false |
| node | `tty.isatty()` | `tty.isatty()` | `tty.isatty()` |

### Terminal Size
```typescript
const size = cli.getTerminalSize();
// { columns: 80, rows: 24 }
```

### Color Support
- Virtual: Configurable
- Browser: Console supports colors
- Node: Depends on terminal

## Error Handling

### I/O Errors
| Error | Meaning |
|-------|---------|
| `closed` | Stream closed |
| `blocked` | Would block (non-blocking mode) |
| `invalid` | Invalid operation |

### Exit Errors
| Error | Meaning |
|-------|---------|
| `invalid-exit-code` | Code out of range |

## Environment-Specific Notes

### Browser
- No real stdin (use prompt/dialog)
- stdout/stderr to console
- Exit doesn't terminate page
- URL params for arguments

### Node.js
- Full CLI support
- Real process access
- Signal handling available

### Testing
- Use virtual provider
- Capture all I/O
- Mock terminal properties
- Assert on exit code

## Testing Examples

### Basic Test Setup
```typescript
const cli = virtualCliProvider.create({
  args: ['test', '--verbose'],
  environment: { DEBUG: 'true' },
  captureOutput: true
});

// Run component...

expect(cli.getExitCode()).toBe(0);
expect(cli.getStdout()).toContain('Success');
```

### Input Simulation
```typescript
const cli = virtualCliProvider.create({
  stdin: 'user input\n'
});
```

### Interactive Testing
```typescript
const cli = virtualCliProvider.create({
  stdinCallback: async (prompt) => {
    if (prompt.includes('password')) {
      return 'secret123\n';
    }
    return 'default\n';
  }
});
```
