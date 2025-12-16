/**
 * wasi:cli plugin definitions
 *
 * Includes:
 * - wasi:cli/environment - Environment variables and arguments
 * - wasi:cli/stdin - Standard input stream
 * - wasi:cli/stdout - Standard output stream
 * - wasi:cli/stderr - Standard error stream
 * - wasi:cli/exit - Component exit handling
 * - wasi:cli/terminal-input - Terminal input resource type
 * - wasi:cli/terminal-output - Terminal output resource type
 * - wasi:cli/terminal-stdin - Get terminal for stdin
 * - wasi:cli/terminal-stdout - Get terminal for stdout
 * - wasi:cli/terminal-stderr - Get terminal for stderr
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import {
  virtualEnvironmentImplementation,
  browserEnvironmentImplementation,
} from './environment.js'
import {
  virtualStdinImplementation,
  virtualStdoutImplementation,
  virtualStderrImplementation,
} from './stdio.js'
import {
  defaultExitImplementation,
  silentExitImplementation,
} from './exit.js'
import {
  noTerminalInputImplementation,
  noTerminalOutputImplementation,
  noTerminalStdinImplementation,
  noTerminalStdoutImplementation,
  noTerminalStderrImplementation,
  virtualTerminalStdinImplementation,
  virtualTerminalStdoutImplementation,
  virtualTerminalStderrImplementation,
} from './terminal.js'

/**
 * WASI environment interface definition
 */
export const ENVIRONMENT_INTERFACE: WasiInterface = {
  package: 'wasi:cli',
  name: 'environment',
  version: '0.2.0',
}

/**
 * WASI stdin interface definition
 */
export const STDIN_INTERFACE: WasiInterface = {
  package: 'wasi:cli',
  name: 'stdin',
  version: '0.2.0',
}

/**
 * WASI stdout interface definition
 */
export const STDOUT_INTERFACE: WasiInterface = {
  package: 'wasi:cli',
  name: 'stdout',
  version: '0.2.0',
}

/**
 * WASI stderr interface definition
 */
export const STDERR_INTERFACE: WasiInterface = {
  package: 'wasi:cli',
  name: 'stderr',
  version: '0.2.0',
}

/**
 * WASI exit interface definition
 */
export const EXIT_INTERFACE: WasiInterface = {
  package: 'wasi:cli',
  name: 'exit',
  version: '0.2.0',
}

/**
 * WASI terminal-input interface definition
 */
export const TERMINAL_INPUT_INTERFACE: WasiInterface = {
  package: 'wasi:cli',
  name: 'terminal-input',
  version: '0.2.0',
}

/**
 * WASI terminal-output interface definition
 */
export const TERMINAL_OUTPUT_INTERFACE: WasiInterface = {
  package: 'wasi:cli',
  name: 'terminal-output',
  version: '0.2.0',
}

/**
 * WASI terminal-stdin interface definition
 */
export const TERMINAL_STDIN_INTERFACE: WasiInterface = {
  package: 'wasi:cli',
  name: 'terminal-stdin',
  version: '0.2.0',
}

/**
 * WASI terminal-stdout interface definition
 */
export const TERMINAL_STDOUT_INTERFACE: WasiInterface = {
  package: 'wasi:cli',
  name: 'terminal-stdout',
  version: '0.2.0',
}

/**
 * WASI terminal-stderr interface definition
 */
export const TERMINAL_STDERR_INTERFACE: WasiInterface = {
  package: 'wasi:cli',
  name: 'terminal-stderr',
  version: '0.2.0',
}

/**
 * wasi:cli/environment plugin
 *
 * Provides environment variables and command-line arguments.
 */
export const environmentPlugin: WasiPlugin = createPlugin(
  ENVIRONMENT_INTERFACE,
  {
    virtual: virtualEnvironmentImplementation,
    browser: browserEnvironmentImplementation,
  },
  'virtual'
)

/**
 * wasi:cli/stdin plugin
 *
 * Provides standard input stream.
 */
export const stdinPlugin: WasiPlugin = createPlugin(
  STDIN_INTERFACE,
  {
    virtual: virtualStdinImplementation,
  },
  'virtual'
)

/**
 * wasi:cli/stdout plugin
 *
 * Provides standard output stream.
 */
export const stdoutPlugin: WasiPlugin = createPlugin(
  STDOUT_INTERFACE,
  {
    virtual: virtualStdoutImplementation,
  },
  'virtual'
)

/**
 * wasi:cli/stderr plugin
 *
 * Provides standard error stream.
 */
export const stderrPlugin: WasiPlugin = createPlugin(
  STDERR_INTERFACE,
  {
    virtual: virtualStderrImplementation,
  },
  'virtual'
)

/**
 * wasi:cli/exit plugin
 *
 * Provides component exit handling.
 */
export const exitPlugin: WasiPlugin = createPlugin(
  EXIT_INTERFACE,
  {
    default: defaultExitImplementation,
    silent: silentExitImplementation,
  },
  'default'
)

/**
 * wasi:cli/terminal-input plugin
 *
 * Provides terminal input resource type.
 */
export const terminalInputPlugin: WasiPlugin = createPlugin(
  TERMINAL_INPUT_INTERFACE,
  {
    none: noTerminalInputImplementation,
  },
  'none'
)

/**
 * wasi:cli/terminal-output plugin
 *
 * Provides terminal output resource type.
 */
export const terminalOutputPlugin: WasiPlugin = createPlugin(
  TERMINAL_OUTPUT_INTERFACE,
  {
    none: noTerminalOutputImplementation,
  },
  'none'
)

/**
 * wasi:cli/terminal-stdin plugin
 *
 * Provides access to terminal input for stdin.
 */
export const terminalStdinPlugin: WasiPlugin = createPlugin(
  TERMINAL_STDIN_INTERFACE,
  {
    none: noTerminalStdinImplementation,
    virtual: virtualTerminalStdinImplementation,
  },
  'none'
)

/**
 * wasi:cli/terminal-stdout plugin
 *
 * Provides access to terminal output for stdout.
 */
export const terminalStdoutPlugin: WasiPlugin = createPlugin(
  TERMINAL_STDOUT_INTERFACE,
  {
    none: noTerminalStdoutImplementation,
    virtual: virtualTerminalStdoutImplementation,
  },
  'none'
)

/**
 * wasi:cli/terminal-stderr plugin
 *
 * Provides access to terminal output for stderr.
 */
export const terminalStderrPlugin: WasiPlugin = createPlugin(
  TERMINAL_STDERR_INTERFACE,
  {
    none: noTerminalStderrImplementation,
    virtual: virtualTerminalStderrImplementation,
  },
  'none'
)

/**
 * All CLI plugins for convenient registration
 */
export const cliPlugins: WasiPlugin[] = [
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
]
