/**
 * Standard I/O implementations for wasi:cli/stdin, stdout, stderr
 *
 * Provides input/output streams for standard I/O.
 * In a browser context, these are backed by memory streams or console.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import type { InputStream, OutputStream } from '../io/streams.js'
import {
  MemoryInputStream,
  StreamRegistry,
  globalStreamRegistry,
} from '../io/streams.js'
import {
  PollableRegistry,
  createReadyPollable,
} from '../io/pollable.js'

/**
 * Configuration for stdio plugins
 */
export interface StdioConfig {
  /** Initial stdin content (for testing/scripted input) */
  stdinContent?: string | Uint8Array
  /** Callback for stdout writes */
  onStdout?: (data: Uint8Array) => void
  /** Callback for stderr writes */
  onStderr?: (data: Uint8Array) => void
  /** Whether to log stdout to console */
  logToConsole?: boolean
}

/**
 * Console-backed output stream that logs to console
 */
class ConsoleOutputStream implements OutputStream {
  handle = 0
  private closed = false
  private buffer: Uint8Array[] = []
  private readonly target: 'log' | 'error'
  private readonly callback?: (data: Uint8Array) => void

  constructor(target: 'log' | 'error', callback?: (data: Uint8Array) => void) {
    this.target = target
    if (callback !== undefined) {
      this.callback = callback
    }
  }

  isClosed(): boolean {
    return this.closed
  }

  close(): void {
    this.flush()
    this.closed = true
  }

  checkWrite(): bigint | { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } {
    if (this.closed) {
      return { tag: 'closed' }
    }
    return 65536n
  }

  write(contents: Uint8Array): { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } | undefined {
    if (this.closed) {
      return { tag: 'closed' }
    }

    this.buffer.push(contents.slice())

    // Call callback if provided
    if (this.callback) {
      this.callback(contents)
    }

    // Flush on newlines
    const text = new TextDecoder().decode(contents)
    if (text.includes('\n')) {
      this.flushBuffer()
    }

    return undefined
  }

  async blockingWriteAndFlush(contents: Uint8Array): Promise<{ tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } | undefined> {
    const error = this.write(contents)
    if (error) return error
    return this.flush()
  }

  flush(): { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } | undefined {
    if (this.closed) {
      return { tag: 'closed' }
    }
    this.flushBuffer()
    return undefined
  }

  async blockingFlush(): Promise<{ tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } | undefined> {
    return this.flush()
  }

  subscribe(registry: PollableRegistry): number {
    return createReadyPollable(registry)
  }

  writeZeroes(len: bigint): { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } | undefined {
    return this.write(new Uint8Array(Number(len)))
  }

  splice(src: InputStream, len: bigint): bigint | { tag: 'closed' } | { tag: 'last-operation-failed'; val: Error } {
    const data = src.read(len)
    if (!(data instanceof Uint8Array)) {
      return data
    }
    const error = this.write(data)
    if (error) return error
    return BigInt(data.length)
  }

  getBuffer(): Uint8Array {
    const totalLength = this.buffer.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of this.buffer) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  getString(): string {
    return new TextDecoder().decode(this.getBuffer())
  }

  clear(): void {
    this.buffer = []
  }

  private flushBuffer(): void {
    if (this.buffer.length === 0) return

    const text = this.getString()
    this.buffer = []

    // Log to console
    if (typeof console !== 'undefined') {
      // Split by lines and log each (to handle partial lines correctly)
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        // Skip empty last line (from trailing newline)
        if (i === lines.length - 1 && line === '') continue

        if (this.target === 'error') {
          console.error(line)
        } else {
          console.log(line)
        }
      }
    }
  }
}

/**
 * Stdin plugin instance
 */
class StdinInstance implements PluginInstance {
  private readonly streamRegistry: StreamRegistry
  private streamHandle: number | null = null
  private readonly inputStream: MemoryInputStream

  constructor(
    streamRegistry: StreamRegistry,
    content?: string | Uint8Array
  ) {
    this.streamRegistry = streamRegistry

    // Create input stream with provided content or empty
    let data: Uint8Array
    if (typeof content === 'string') {
      data = new TextEncoder().encode(content)
    } else if (content) {
      data = content
    } else {
      data = new Uint8Array(0)
    }

    this.inputStream = new MemoryInputStream(data)
    this.streamHandle = streamRegistry.register(this.inputStream)
  }

  getImports(): Record<string, unknown> {
    return {
      'get-stdin': this.getStdin.bind(this),
    }
  }

  destroy(): void {
    if (this.streamHandle !== null) {
      this.streamRegistry.drop(this.streamHandle)
    }
  }

  private getStdin(): number {
    if (this.streamHandle === null) {
      throw new Error('stdin stream not available')
    }
    return this.streamHandle
  }
}

/**
 * Stdout plugin instance
 */
class StdoutInstance implements PluginInstance {
  private readonly streamRegistry: StreamRegistry
  private streamHandle: number | null = null
  private readonly outputStream: ConsoleOutputStream

  constructor(
    streamRegistry: StreamRegistry,
    callback?: (data: Uint8Array) => void
  ) {
    this.streamRegistry = streamRegistry
    this.outputStream = new ConsoleOutputStream('log', callback)
    this.streamHandle = streamRegistry.register(this.outputStream)
  }

  getImports(): Record<string, unknown> {
    return {
      'get-stdout': this.getStdout.bind(this),
    }
  }

  destroy(): void {
    if (this.streamHandle !== null) {
      this.streamRegistry.drop(this.streamHandle)
    }
  }

  private getStdout(): number {
    if (this.streamHandle === null) {
      throw new Error('stdout stream not available')
    }
    return this.streamHandle
  }

  /**
   * Get the output stream for testing
   */
  getOutputStream(): ConsoleOutputStream {
    return this.outputStream
  }
}

/**
 * Stderr plugin instance
 */
class StderrInstance implements PluginInstance {
  private readonly streamRegistry: StreamRegistry
  private streamHandle: number | null = null
  private readonly outputStream: ConsoleOutputStream

  constructor(
    streamRegistry: StreamRegistry,
    callback?: (data: Uint8Array) => void
  ) {
    this.streamRegistry = streamRegistry
    this.outputStream = new ConsoleOutputStream('error', callback)
    this.streamHandle = streamRegistry.register(this.outputStream)
  }

  getImports(): Record<string, unknown> {
    return {
      'get-stderr': this.getStderr.bind(this),
    }
  }

  destroy(): void {
    if (this.streamHandle !== null) {
      this.streamRegistry.drop(this.streamHandle)
    }
  }

  private getStderr(): number {
    if (this.streamHandle === null) {
      throw new Error('stderr stream not available')
    }
    return this.streamHandle
  }

  /**
   * Get the output stream for testing
   */
  getOutputStream(): ConsoleOutputStream {
    return this.outputStream
  }
}

/**
 * Virtual stdin implementation
 */
export const virtualStdinImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual stdin with configurable content',
  create(config: PluginConfig): PluginInstance {
    const content = config.options?.['stdinContent'] as string | Uint8Array | undefined
    return new StdinInstance(globalStreamRegistry, content)
  },
}

/**
 * Virtual stdout implementation (logs to console)
 */
export const virtualStdoutImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual stdout that logs to console',
  create(config: PluginConfig): PluginInstance {
    const callback = config.options?.['onStdout'] as ((data: Uint8Array) => void) | undefined
    return new StdoutInstance(globalStreamRegistry, callback)
  },
}

/**
 * Virtual stderr implementation (logs to console.error)
 */
export const virtualStderrImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual stderr that logs to console.error',
  create(config: PluginConfig): PluginInstance {
    const callback = config.options?.['onStderr'] as ((data: Uint8Array) => void) | undefined
    return new StderrInstance(globalStreamRegistry, callback)
  },
}
