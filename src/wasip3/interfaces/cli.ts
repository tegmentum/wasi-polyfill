/**
 * WASI CLI 0.3.0 interface
 *
 * P3 CLI uses async streams for stdin instead of pollables.
 *
 * @packageDocumentation
 */

import type { Stream, StreamWriter } from '../types.js'
import { createStream } from '../canonical-abi/stream.js'

/**
 * CLI configuration.
 */
export interface CliConfig {
  /** Command-line arguments */
  args: string[]
  /** Environment variables */
  env: Record<string, string>
  /** Standard input stream */
  stdin?: Stream<Uint8Array>
  /** Standard output stream writer */
  stdout?: StreamWriter<Uint8Array>
  /** Standard error stream writer */
  stderr?: StreamWriter<Uint8Array>
}

/**
 * Exit status from a component.
 */
export type ExitStatus =
  | { tag: 'ok' }
  | { tag: 'err'; val: number }

/**
 * Error thrown when a component exits.
 */
export class CliExitError extends Error {
  constructor(public readonly status: ExitStatus) {
    const code = status.tag === 'err' ? status.val : 0
    super(`Component exited with code ${code}`)
    this.name = 'CliExitError'
  }

  get code(): number {
    return this.status.tag === 'err' ? this.status.val : 0
  }
}

/**
 * Create a virtual stdin stream from a string.
 *
 * @param input - Input string
 * @returns Stream that yields the input
 */
export function createStdinFromString(input: string): Stream<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  let consumed = false

  return {
    async read() {
      if (consumed) {
        return { status: 'end' }
      }
      consumed = true
      return { status: 'values', values: [data] }
    },
    close() {
      consumed = true
    },
    cancel() {
      consumed = true
    },
  }
}

/**
 * Create a virtual stdin stream from an array of lines.
 *
 * @param lines - Input lines
 * @returns Stream that yields each line
 */
export function createStdinFromLines(lines: string[]): Stream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0

  return {
    async read() {
      if (index >= lines.length) {
        return { status: 'end' }
      }
      const line = lines[index++]!
      const data = encoder.encode(line + '\n')
      return { status: 'values', values: [data] }
    },
    close() {
      index = lines.length
    },
    cancel() {
      index = lines.length
    },
  }
}

/**
 * Create a stdout/stderr stream writer that collects output.
 *
 * @returns Stream writer and a function to get collected output
 */
export function createCollectingWriter(): {
  writer: StreamWriter<Uint8Array>
  getOutput: () => string
} {
  const chunks: Uint8Array[] = []
  const decoder = new TextDecoder()

  const writer: StreamWriter<Uint8Array> = {
    async write(values) {
      chunks.push(...values)
      return { status: 'ok', count: values.length }
    },
    close() {},
    cancel() {},
  }

  return {
    writer,
    getOutput: () => {
      // Concatenate all chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      const result = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }
      return decoder.decode(result)
    },
  }
}

/**
 * Create a stdout/stderr stream writer that writes to console.
 *
 * @param prefix - Optional prefix for each line
 * @returns Stream writer
 */
export function createConsoleWriter(prefix = ''): StreamWriter<Uint8Array> {
  const decoder = new TextDecoder()
  let buffer = ''

  return {
    async write(values) {
      for (const data of values) {
        buffer += decoder.decode(data, { stream: true })

        // Flush complete lines
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          console.log(prefix + line)
        }
      }
      return { status: 'ok', count: values.length }
    },
    close() {
      // Flush remaining buffer
      if (buffer) {
        console.log(prefix + buffer)
        buffer = ''
      }
    },
    cancel() {
      buffer = ''
    },
  }
}

/**
 * Get the wasi:cli@0.3.0 imports.
 *
 * @param config - CLI configuration
 * @returns Import object for wasi:cli@0.3.0
 */
export function getCliImports(config: CliConfig): Record<string, unknown> {
  // Create default streams if not provided
  const [defaultStdinReader] = createStream<Uint8Array>()
  const stdin = config.stdin ?? defaultStdinReader

  const defaultStdout = createConsoleWriter()
  const stdout = config.stdout ?? defaultStdout

  const defaultStderr = createConsoleWriter('[stderr] ')
  const stderr = config.stderr ?? defaultStderr

  return {
    'wasi:cli/environment@0.3.0': {
      'get-arguments': (): string[] => config.args,
      'get-environment': (): Array<[string, string]> => Object.entries(config.env),
      'initial-cwd': (): string | undefined => undefined, // Not available in browser
    },

    'wasi:cli/exit@0.3.0': {
      exit: (status: ExitStatus): never => {
        throw new CliExitError(status)
      },
    },

    'wasi:cli/stdin@0.3.0': {
      'get-stdin': (): Stream<Uint8Array> => stdin,
    },

    'wasi:cli/stdout@0.3.0': {
      'get-stdout': (): StreamWriter<Uint8Array> => stdout,
    },

    'wasi:cli/stderr@0.3.0': {
      'get-stderr': (): StreamWriter<Uint8Array> => stderr,
    },

    // Terminal capabilities (mostly not available in browser)
    'wasi:cli/terminal-input@0.3.0': {
      'drop-terminal-input': (): void => {},
    },

    'wasi:cli/terminal-output@0.3.0': {
      'drop-terminal-output': (): void => {},
    },

    'wasi:cli/terminal-stdin@0.3.0': {
      'get-terminal-stdin': (): number | undefined => undefined,
    },

    'wasi:cli/terminal-stdout@0.3.0': {
      'get-terminal-stdout': (): number | undefined => undefined,
    },

    'wasi:cli/terminal-stderr@0.3.0': {
      'get-terminal-stderr': (): number | undefined => undefined,
    },
  }
}
