/**
 * Stdio Provider Abstraction
 *
 * This module defines the core abstractions for stdin/stdout/stderr as pluggable
 * byte streams with optional terminal capability layered on top.
 *
 * Key design principles:
 * - Everything is bytes first - adapters decode for display
 * - Terminal features are optional - streams work without a terminal
 * - Default to console.* with zero config
 * - Clean swap to xterm.js or custom streams when needed
 */

// ============================================================================
// Core Stream Interfaces
// ============================================================================

/**
 * Core input stream interface.
 * Bytes in - everything else is adapters.
 */
export interface InputStreamLike {
  /** Read up to `max` bytes. Returns empty array to signal EOF. */
  read(max: number): Promise<Uint8Array>

  /** Optional close method */
  close?(): Promise<void>

  /** Whether this stream is connected to a TTY */
  isTTY: boolean

  /** Optional: Check if data is available (for pollable support) */
  hasData?(): boolean

  /** Optional: Non-blocking synchronous read. Returns null if no data available. */
  tryRead?(max: number): Uint8Array | null
}

/**
 * Core output stream interface.
 * Bytes out - everything else is adapters.
 */
export interface OutputStreamLike {
  /** Write bytes to the stream */
  write(chunk: Uint8Array): Promise<void>

  /** Flush any buffered output */
  flush(): Promise<void>

  /** Optional close method */
  close?(): Promise<void>

  /** Whether this stream is connected to a TTY */
  isTTY: boolean
}

/**
 * Terminal capability bundle (optional)
 * Present only when the streams are connected to a real terminal.
 */
export interface TerminalCapability {
  /** Whether terminal features are available */
  isTTY: boolean

  /** Get terminal dimensions (rows, columns) */
  getSize?(): { rows: number; cols: number }

  /** Set raw mode (disable line editing, echo) */
  setRawMode?(enabled: boolean): void

  /** Subscribe to terminal resize events */
  onResize?(callback: (rows: number, cols: number) => void): () => void
}

/**
 * Result of creating stdio streams
 */
export interface StdioStreams {
  stdin: InputStreamLike
  stdout: OutputStreamLike
  stderr: OutputStreamLike

  /** Optional terminal capability bundle */
  terminal?: TerminalCapability

  /** Cleanup function to release resources */
  destroy?(): void
}

/**
 * Factory function that creates stdio streams
 */
export type StdioProvider = () => StdioStreams

// ============================================================================
// Stdio Configuration
// ============================================================================

/**
 * xterm.js-like terminal interface for output
 */
export interface XTermOutputLike {
  /** Write data to the terminal */
  write(data: string): void
}

/**
 * xterm.js-like terminal interface for input
 */
export interface XTermInputLike {
  /** Subscribe to data events from the terminal */
  onData(callback: (data: string) => void): { dispose(): void } | (() => void)
}

/**
 * Combined xterm.js-like interface
 */
export type XTermLike = XTermOutputLike & XTermInputLike

/**
 * Configuration for stdio - determines which adapter to use
 */
export type StdioConfig =
  | { kind: 'console' }
  | { kind: 'terminal'; term: XTermLike; options?: { isTTY?: boolean } }
  | {
      kind: 'custom'
      stdin: InputStreamLike
      stdout: OutputStreamLike
      stderr: OutputStreamLike
      isTTY?: boolean
    }

// ============================================================================
// Console Adapter (Default)
// ============================================================================

/**
 * Console output stream - line-buffers and logs to console.
 * Decodes bytes as UTF-8 for display purposes.
 */
export class ConsoleOutputStream implements OutputStreamLike {
  readonly isTTY = false

  private buffer = ''
  private readonly decoder = new TextDecoder()
  private readonly consoleMethod: 'log' | 'error'

  constructor(target: 'stdout' | 'stderr') {
    this.consoleMethod = target === 'stderr' ? 'error' : 'log'
  }

  async write(chunk: Uint8Array): Promise<void> {
    // Decode for display - raw bytes are the canonical transport
    this.buffer += this.decoder.decode(chunk, { stream: true })

    // Flush on newline(s) to avoid console spam
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      this.logLine(line)
    }
  }

  async flush(): Promise<void> {
    // Flush remaining buffer (no trailing newline)
    if (this.buffer.length > 0) {
      this.logLine(this.buffer)
      this.buffer = ''
    }
    // Also flush the streaming decoder
    this.decoder.decode(new Uint8Array(0), { stream: false })
  }

  private logLine(line: string): void {
    if (typeof console === 'undefined') return
    if (this.consoleMethod === 'error') {
      console.error(line)
    } else {
      console.log(line)
    }
  }

  async close(): Promise<void> {
    await this.flush()
  }
}

/**
 * Empty stdin - returns EOF immediately.
 * This is the default for browser environments where there's no natural stdin.
 */
export class EmptyInputStream implements InputStreamLike {
  readonly isTTY = false

  async read(_max: number): Promise<Uint8Array> {
    // EOF immediately - return empty array
    return new Uint8Array(0)
  }

  async close(): Promise<void> {
    // Nothing to clean up
  }
}

/**
 * Console stdio provider - the zero-config default.
 * - stdin: EOF immediately
 * - stdout/stderr: line-buffered console output
 */
export function createConsoleStdio(): StdioProvider {
  return () => ({
    stdin: new EmptyInputStream(),
    stdout: new ConsoleOutputStream('stdout'),
    stderr: new ConsoleOutputStream('stderr'),
    // No terminal capability - these are not TTYs
  })
}

// ============================================================================
// Queue-based Input Stream (for interactive input)
// ============================================================================

/**
 * Queue-based input stream for receiving data asynchronously.
 * Used for xterm.js and other interactive input sources.
 */
export class QueueInputStream implements InputStreamLike {
  readonly isTTY: boolean

  private readonly encoder = new TextEncoder()
  private queue: Uint8Array[] = []
  private pending: Array<(data: Uint8Array) => void> = []
  private closed = false

  constructor(isTTY = true) {
    this.isTTY = isTTY
  }

  /**
   * Push data into the queue (called by external source like xterm.js)
   */
  push(data: Uint8Array | string): void {
    if (this.closed) return

    const bytes = typeof data === 'string' ? this.encoder.encode(data) : data

    // If there's a pending read, resolve it immediately
    if (this.pending.length > 0) {
      const resolve = this.pending.shift()!
      resolve(bytes)
      return
    }

    // Otherwise queue it for later
    this.queue.push(bytes)
  }

  /**
   * Check if there's data available without blocking
   */
  hasData(): boolean {
    return this.queue.length > 0 || this.closed
  }

  /**
   * Non-blocking synchronous read.
   * Returns data if available, null if would block.
   */
  tryRead(max: number): Uint8Array | null {
    // If we have queued data, return it (even if closed)
    if (this.queue.length > 0) {
      const chunk = this.queue[0]!

      // Return entire chunk if it fits
      if (chunk.length <= max) {
        this.queue.shift()
        return chunk
      }

      // Split the chunk
      const head = chunk.slice(0, max)
      this.queue[0] = chunk.slice(max)
      return head
    }

    // No more data and closed means EOF
    if (this.closed) {
      return new Uint8Array(0) // EOF
    }

    // No data available
    return null
  }

  async read(max: number): Promise<Uint8Array> {
    // If we have queued data, return it (even if closed)
    if (this.queue.length > 0) {
      const chunk = this.queue[0]!

      // Return entire chunk if it fits
      if (chunk.length <= max) {
        this.queue.shift()
        return chunk
      }

      // Split the chunk
      const head = chunk.slice(0, max)
      this.queue[0] = chunk.slice(max)
      return head
    }

    // No more data and closed means EOF
    if (this.closed) {
      return new Uint8Array(0) // EOF
    }

    // Wait for data
    return new Promise<Uint8Array>((resolve) => {
      this.pending.push(resolve)
    })
  }

  async close(): Promise<void> {
    this.closed = true

    // Unblock any pending reads with EOF
    while (this.pending.length > 0) {
      const resolve = this.pending.shift()!
      resolve(new Uint8Array(0))
    }
  }
}

// ============================================================================
// xterm.js Adapter
// ============================================================================

/**
 * xterm.js output stream - writes to terminal emulator.
 * Passes through ANSI escape sequences (xterm.js understands them).
 */
export class XtermOutputStream implements OutputStreamLike {
  readonly isTTY = true

  private readonly decoder = new TextDecoder()
  private readonly term: XTermOutputLike

  constructor(term: XTermOutputLike) {
    this.term = term
  }

  async write(chunk: Uint8Array): Promise<void> {
    // Decode and write to terminal
    // Note: xterm.js write() is synchronous and handles ANSI sequences
    this.term.write(this.decoder.decode(chunk, { stream: true }))
  }

  async flush(): Promise<void> {
    // xterm.js writes immediately, but flush the decoder state
    const remaining = this.decoder.decode(new Uint8Array(0), { stream: false })
    if (remaining) {
      this.term.write(remaining)
    }
  }

  async close(): Promise<void> {
    await this.flush()
  }
}

/**
 * Create an xterm.js stdin connected to terminal input.
 */
function createXtermStdin(term: XTermInputLike): {
  stdin: QueueInputStream
  unsubscribe: () => void
} {
  const stdin = new QueueInputStream(true)

  // Subscribe to terminal data events
  const result = term.onData((data: string) => {
    stdin.push(data)
  })

  // Handle both xterm.js IDisposable and function styles
  const unsubscribe =
    typeof result === 'function' ? result : () => result.dispose()

  return { stdin, unsubscribe }
}

/**
 * xterm.js stdio provider - connects stdin/stdout/stderr to a terminal emulator.
 */
export function createXtermStdio(
  term: XTermLike,
  options?: { isTTY?: boolean }
): StdioProvider {
  const isTTY = options?.isTTY ?? true

  return () => {
    const { stdin, unsubscribe } = createXtermStdin(term)
    const stdout = new XtermOutputStream(term)
    const stderr = new XtermOutputStream(term) // Could be separate terminal

    return {
      stdin,
      stdout,
      stderr,
      terminal: {
        isTTY,
        // TODO: Add getSize, setRawMode, onResize when xterm supports them
      },
      destroy() {
        unsubscribe()
        stdin.close()
        stdout.close()
        stderr.close()
      },
    }
  }
}

// ============================================================================
// Custom Stdio Provider
// ============================================================================

/**
 * Custom stdio provider - uses user-provided streams.
 */
export function createCustomStdio(
  stdin: InputStreamLike,
  stdout: OutputStreamLike,
  stderr: OutputStreamLike,
  options?: { isTTY?: boolean }
): StdioProvider {
  const isTTY = options?.isTTY ?? false

  return () => {
    const streams: StdioStreams = {
      stdin,
      stdout,
      stderr,
    }
    if (isTTY) {
      streams.terminal = { isTTY: true }
    }
    return streams
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a stdio provider from configuration.
 */
export function createStdioProvider(config?: StdioConfig): StdioProvider {
  if (!config || config.kind === 'console') {
    return createConsoleStdio()
  }

  if (config.kind === 'terminal') {
    return createXtermStdio(config.term, config.options)
  }

  if (config.kind === 'custom') {
    return createCustomStdio(
      config.stdin,
      config.stdout,
      config.stderr,
      config.isTTY !== undefined ? { isTTY: config.isTTY } : undefined
    )
  }

  // Exhaustive check
  const _exhaustive: never = config
  throw new Error(`Unknown stdio config kind: ${(_exhaustive as StdioConfig).kind}`)
}
