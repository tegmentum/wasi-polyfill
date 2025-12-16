/**
 * Terminal implementations for wasi:cli terminal interfaces
 *
 * WASI terminal interfaces:
 * - wasi:cli/terminal-input - Terminal input resource type
 * - wasi:cli/terminal-output - Terminal output resource type
 * - wasi:cli/terminal-stdin - Get terminal for stdin
 * - wasi:cli/terminal-stdout - Get terminal for stdout
 * - wasi:cli/terminal-stderr - Get terminal for stderr
 *
 * In browser contexts, terminals are typically not available unless
 * using xterm.js or a similar terminal emulator.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'

/**
 * Terminal input resource
 *
 * Represents an input stream that is connected to a terminal.
 * The resource handle indicates terminal capability.
 */
export interface TerminalInput {
  handle: number
}

/**
 * Terminal output resource
 *
 * Represents an output stream that is connected to a terminal.
 * The resource handle indicates terminal capability.
 */
export interface TerminalOutput {
  handle: number
}

/**
 * Configuration for terminal plugins
 */
export interface TerminalConfig {
  /**
   * Whether to simulate a terminal being available.
   * Default: false (no terminal in browser)
   */
  isTerminal?: boolean

  /**
   * Terminal input provider (e.g., xterm.js integration)
   */
  terminalInput?: TerminalInput

  /**
   * Terminal output provider (e.g., xterm.js integration)
   */
  terminalOutput?: TerminalOutput
}

/**
 * Registry for terminal resources
 */
export class TerminalRegistry {
  private nextHandle = 1
  private inputs = new Map<number, TerminalInput>()
  private outputs = new Map<number, TerminalOutput>()

  registerInput(input: TerminalInput): number {
    const handle = this.nextHandle++
    input.handle = handle
    this.inputs.set(handle, input)
    return handle
  }

  registerOutput(output: TerminalOutput): number {
    const handle = this.nextHandle++
    output.handle = handle
    this.outputs.set(handle, output)
    return handle
  }

  getInput(handle: number): TerminalInput | undefined {
    return this.inputs.get(handle)
  }

  getOutput(handle: number): TerminalOutput | undefined {
    return this.outputs.get(handle)
  }

  dropInput(handle: number): void {
    this.inputs.delete(handle)
  }

  dropOutput(handle: number): void {
    this.outputs.delete(handle)
  }
}

/**
 * Global terminal registry
 */
export const globalTerminalRegistry = new TerminalRegistry()

/**
 * Virtual terminal input - a no-op terminal resource
 */
class VirtualTerminalInput implements TerminalInput {
  handle = 0
}

/**
 * Virtual terminal output - a no-op terminal resource
 */
class VirtualTerminalOutput implements TerminalOutput {
  handle = 0
}

/**
 * Terminal input plugin instance
 *
 * Provides the terminal-input resource type.
 * This is mainly for type compatibility - the resource itself
 * has no methods in WASI P2.
 */
class TerminalInputInstance implements PluginInstance {
  private readonly registry: TerminalRegistry

  constructor(registry: TerminalRegistry) {
    this.registry = registry
  }

  getImports(): Record<string, unknown> {
    // terminal-input is a resource type with a drop function
    return {
      '[resource-drop]terminal-input': this.dropTerminalInput.bind(this),
    }
  }

  destroy(): void {
    // No cleanup needed
  }

  private dropTerminalInput(handle: number): void {
    this.registry.dropInput(handle)
  }
}

/**
 * Terminal output plugin instance
 *
 * Provides the terminal-output resource type.
 * This is mainly for type compatibility - the resource itself
 * has no methods in WASI P2.
 */
class TerminalOutputInstance implements PluginInstance {
  private readonly registry: TerminalRegistry

  constructor(registry: TerminalRegistry) {
    this.registry = registry
  }

  getImports(): Record<string, unknown> {
    // terminal-output is a resource type with a drop function
    return {
      '[resource-drop]terminal-output': this.dropTerminalOutput.bind(this),
    }
  }

  destroy(): void {
    // No cleanup needed
  }

  private dropTerminalOutput(handle: number): void {
    this.registry.dropOutput(handle)
  }
}

/**
 * Terminal stdin plugin instance
 *
 * Returns the terminal input handle if stdin is connected to a terminal.
 */
class TerminalStdinInstance implements PluginInstance {
  private readonly isTerminal: boolean
  private readonly registry: TerminalRegistry
  private terminalHandle: number | null = null

  constructor(registry: TerminalRegistry, isTerminal: boolean, terminalInput?: TerminalInput) {
    this.registry = registry
    this.isTerminal = isTerminal

    if (isTerminal) {
      const input = terminalInput ?? new VirtualTerminalInput()
      this.terminalHandle = registry.registerInput(input)
    }
  }

  getImports(): Record<string, unknown> {
    return {
      'get-terminal-stdin': this.getTerminalStdin.bind(this),
    }
  }

  destroy(): void {
    if (this.terminalHandle !== null) {
      this.registry.dropInput(this.terminalHandle)
    }
  }

  /**
   * Get terminal input handle for stdin
   *
   * @returns Terminal input handle or undefined if not a terminal
   */
  private getTerminalStdin(): number | undefined {
    if (!this.isTerminal || this.terminalHandle === null) {
      return undefined
    }
    return this.terminalHandle
  }
}

/**
 * Terminal stdout plugin instance
 *
 * Returns the terminal output handle if stdout is connected to a terminal.
 */
class TerminalStdoutInstance implements PluginInstance {
  private readonly isTerminal: boolean
  private readonly registry: TerminalRegistry
  private terminalHandle: number | null = null

  constructor(registry: TerminalRegistry, isTerminal: boolean, terminalOutput?: TerminalOutput) {
    this.registry = registry
    this.isTerminal = isTerminal

    if (isTerminal) {
      const output = terminalOutput ?? new VirtualTerminalOutput()
      this.terminalHandle = registry.registerOutput(output)
    }
  }

  getImports(): Record<string, unknown> {
    return {
      'get-terminal-stdout': this.getTerminalStdout.bind(this),
    }
  }

  destroy(): void {
    if (this.terminalHandle !== null) {
      this.registry.dropOutput(this.terminalHandle)
    }
  }

  /**
   * Get terminal output handle for stdout
   *
   * @returns Terminal output handle or undefined if not a terminal
   */
  private getTerminalStdout(): number | undefined {
    if (!this.isTerminal || this.terminalHandle === null) {
      return undefined
    }
    return this.terminalHandle
  }
}

/**
 * Terminal stderr plugin instance
 *
 * Returns the terminal output handle if stderr is connected to a terminal.
 */
class TerminalStderrInstance implements PluginInstance {
  private readonly isTerminal: boolean
  private readonly registry: TerminalRegistry
  private terminalHandle: number | null = null

  constructor(registry: TerminalRegistry, isTerminal: boolean, terminalOutput?: TerminalOutput) {
    this.registry = registry
    this.isTerminal = isTerminal

    if (isTerminal) {
      const output = terminalOutput ?? new VirtualTerminalOutput()
      this.terminalHandle = registry.registerOutput(output)
    }
  }

  getImports(): Record<string, unknown> {
    return {
      'get-terminal-stderr': this.getTerminalStderr.bind(this),
    }
  }

  destroy(): void {
    if (this.terminalHandle !== null) {
      this.registry.dropOutput(this.terminalHandle)
    }
  }

  /**
   * Get terminal output handle for stderr
   *
   * @returns Terminal output handle or undefined if not a terminal
   */
  private getTerminalStderr(): number | undefined {
    if (!this.isTerminal || this.terminalHandle === null) {
      return undefined
    }
    return this.terminalHandle
  }
}

/**
 * No-op terminal input implementation (default for browser)
 *
 * Returns that stdin is NOT connected to a terminal.
 */
export const noTerminalInputImplementation: Implementation = {
  name: 'none',
  description: 'No terminal input (default for browser)',
  create(_config: PluginConfig): PluginInstance {
    return new TerminalInputInstance(globalTerminalRegistry)
  },
}

/**
 * No-op terminal output implementation (default for browser)
 *
 * Returns that stdout/stderr is NOT connected to a terminal.
 */
export const noTerminalOutputImplementation: Implementation = {
  name: 'none',
  description: 'No terminal output (default for browser)',
  create(_config: PluginConfig): PluginInstance {
    return new TerminalOutputInstance(globalTerminalRegistry)
  },
}

/**
 * No-op terminal-stdin implementation
 *
 * Returns undefined (no terminal).
 */
export const noTerminalStdinImplementation: Implementation = {
  name: 'none',
  description: 'stdin is not connected to a terminal',
  create(_config: PluginConfig): PluginInstance {
    return new TerminalStdinInstance(globalTerminalRegistry, false)
  },
}

/**
 * No-op terminal-stdout implementation
 *
 * Returns undefined (no terminal).
 */
export const noTerminalStdoutImplementation: Implementation = {
  name: 'none',
  description: 'stdout is not connected to a terminal',
  create(_config: PluginConfig): PluginInstance {
    return new TerminalStdoutInstance(globalTerminalRegistry, false)
  },
}

/**
 * No-op terminal-stderr implementation
 *
 * Returns undefined (no terminal).
 */
export const noTerminalStderrImplementation: Implementation = {
  name: 'none',
  description: 'stderr is not connected to a terminal',
  create(_config: PluginConfig): PluginInstance {
    return new TerminalStderrInstance(globalTerminalRegistry, false)
  },
}

/**
 * Virtual terminal-stdin implementation
 *
 * Simulates stdin being connected to a terminal.
 */
export const virtualTerminalStdinImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual terminal for stdin (for testing/xterm.js)',
  create(config: PluginConfig): PluginInstance {
    const terminalInput = config.options?.['terminalInput'] as TerminalInput | undefined
    return new TerminalStdinInstance(globalTerminalRegistry, true, terminalInput)
  },
}

/**
 * Virtual terminal-stdout implementation
 *
 * Simulates stdout being connected to a terminal.
 */
export const virtualTerminalStdoutImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual terminal for stdout (for testing/xterm.js)',
  create(config: PluginConfig): PluginInstance {
    const terminalOutput = config.options?.['terminalOutput'] as TerminalOutput | undefined
    return new TerminalStdoutInstance(globalTerminalRegistry, true, terminalOutput)
  },
}

/**
 * Virtual terminal-stderr implementation
 *
 * Simulates stderr being connected to a terminal.
 */
export const virtualTerminalStderrImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual terminal for stderr (for testing/xterm.js)',
  create(config: PluginConfig): PluginInstance {
    const terminalOutput = config.options?.['terminalOutput'] as TerminalOutput | undefined
    return new TerminalStderrInstance(globalTerminalRegistry, true, terminalOutput)
  },
}
