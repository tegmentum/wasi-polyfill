/**
 * wasi:cli plugin
 *
 * Provides command-line interface functionality including:
 * - Environment variables and arguments
 * - Standard I/O streams (stdin, stdout, stderr)
 * - Exit handling
 * - Terminal I/O
 *
 * Interfaces:
 * - wasi:cli/environment - get-environment(), get-arguments()
 * - wasi:cli/stdin - get-stdin() -> input-stream
 * - wasi:cli/stdout - get-stdout() -> output-stream
 * - wasi:cli/stderr - get-stderr() -> output-stream
 * - wasi:cli/exit - exit(status)
 * - wasi:cli/terminal-input - terminal input resource
 * - wasi:cli/terminal-output - terminal output resource
 * - wasi:cli/terminal-stdin - get-terminal-stdin() -> option<terminal-input>
 * - wasi:cli/terminal-stdout - get-terminal-stdout() -> option<terminal-output>
 * - wasi:cli/terminal-stderr - get-terminal-stderr() -> option<terminal-output>
 */

// Plugin exports
export {
  environmentPlugin,
  stdinPlugin,
  stdoutPlugin,
  stderrPlugin,
  exitPlugin,
  terminalInputPlugin,
  terminalOutputPlugin,
  terminalStdinPlugin,
  terminalStdoutPlugin,
  terminalStderrPlugin,
  cliPlugins,
  ENVIRONMENT_INTERFACE,
  STDIN_INTERFACE,
  STDOUT_INTERFACE,
  STDERR_INTERFACE,
  EXIT_INTERFACE,
  TERMINAL_INPUT_INTERFACE,
  TERMINAL_OUTPUT_INTERFACE,
  TERMINAL_STDIN_INTERFACE,
  TERMINAL_STDOUT_INTERFACE,
  TERMINAL_STDERR_INTERFACE,
} from './plugin.js'

// Environment
export type { EnvironmentConfig } from './environment.js'
export {
  virtualEnvironmentImplementation,
  browserEnvironmentImplementation,
} from './environment.js'

// Stdio
export type { StdioConfig, StdioProviderConfig } from './stdio.js'
export {
  virtualStdinImplementation,
  virtualStdoutImplementation,
  virtualStderrImplementation,
  setGlobalStdioProvider,
  resetGlobalStdioState,
  isStdinTTY,
  isStdoutTTY,
  isStderrTTY,
  WasiInputStreamWrapper,
  WasiOutputStreamWrapper,
} from './stdio.js'

// Stdio Provider (pluggable streams)
export type {
  InputStreamLike,
  OutputStreamLike,
  StdioProvider,
  StdioStreams,
  TerminalCapability,
  XTermLike,
  XTermInputLike,
  XTermOutputLike,
  XTermDimensionsLike,
  CustomStdioOptions,
} from './stdio-provider.js'
export {
  createConsoleStdio,
  createXtermStdio,
  createCustomStdio,
  createStdioProvider,
  ConsoleOutputStream,
  EmptyInputStream,
  QueueInputStream,
  XtermOutputStream,
} from './stdio-provider.js'

// Exit
export type { ExitStatus, ExitConfig } from './exit.js'
export {
  ComponentExitError,
  defaultExitImplementation,
  silentExitImplementation,
} from './exit.js'

// Terminal
export type { TerminalInput, TerminalOutput, TerminalConfig } from './terminal.js'
export {
  TerminalRegistry,
  globalTerminalRegistry,
  noTerminalInputImplementation,
  noTerminalOutputImplementation,
  noTerminalStdinImplementation,
  noTerminalStdoutImplementation,
  noTerminalStderrImplementation,
  virtualTerminalStdinImplementation,
  virtualTerminalStdoutImplementation,
  virtualTerminalStderrImplementation,
  autoTerminalStdinImplementation,
  autoTerminalStdoutImplementation,
  autoTerminalStderrImplementation,
} from './terminal.js'
