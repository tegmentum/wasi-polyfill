/**
 * Exit handling for wasi:cli/exit
 *
 * Provides component exit functionality.
 * In a browser context, this throws an error or calls a callback.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'

/**
 * Exit status from a component
 */
export interface ExitStatus {
  /** Whether the exit was successful */
  ok: boolean
  /** Exit code (0 for success, non-zero for error) */
  code: number
}

/**
 * Error thrown when a component calls exit
 */
export class ComponentExitError extends Error {
  readonly status: ExitStatus

  constructor(status: ExitStatus) {
    super(
      status.ok
        ? 'Component exited successfully'
        : `Component exited with error code ${status.code}`
    )
    this.name = 'ComponentExitError'
    this.status = status
  }
}

/**
 * Configuration for exit handling
 */
export interface ExitConfig {
  /** Callback when exit is called */
  onExit?: (status: ExitStatus) => void
  /** Whether to throw on exit (default: true) */
  throwOnExit?: boolean
}

/**
 * Exit plugin instance
 */
class ExitInstance implements PluginInstance {
  private readonly onExit?: (status: ExitStatus) => void
  private readonly throwOnExit: boolean
  private exitStatus: ExitStatus | null = null

  constructor(config: ExitConfig) {
    if (config.onExit !== undefined) {
      this.onExit = config.onExit
    }
    this.throwOnExit = config.throwOnExit ?? true
  }

  getImports(): Record<string, unknown> {
    return {
      exit: this.exit.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  /**
   * Handle component exit
   *
   * In WASI, exit takes a result type that indicates success or failure.
   * We map this to an exit code: 0 for success, 1 for error.
   */
  private exit(status: { tag: 'ok' } | { tag: 'err'; val: unknown }): void {
    const exitStatus: ExitStatus = {
      ok: status.tag === 'ok',
      code: status.tag === 'ok' ? 0 : 1,
    }

    this.exitStatus = exitStatus

    // Call callback if provided
    if (this.onExit) {
      this.onExit(exitStatus)
    }

    // Throw to abort execution
    if (this.throwOnExit) {
      throw new ComponentExitError(exitStatus)
    }
  }

  /**
   * Get the last exit status (if exit was called)
   */
  getExitStatus(): ExitStatus | null {
    return this.exitStatus
  }
}

/**
 * Default exit implementation
 *
 * Throws ComponentExitError when exit is called.
 */
export const defaultExitImplementation: Implementation = {
  name: 'default',
  description: 'Default exit that throws ComponentExitError',
  create(config: PluginConfig): PluginInstance {
    const exitConfig: ExitConfig = {}

    if (config.options?.['onExit'] !== undefined) {
      exitConfig.onExit = config.options['onExit'] as (status: ExitStatus) => void
    }
    if (config.options?.['throwOnExit'] !== undefined) {
      exitConfig.throwOnExit = config.options['throwOnExit'] as boolean
    }

    return new ExitInstance(exitConfig)
  },
}

/**
 * Silent exit implementation
 *
 * Records exit status but doesn't throw.
 */
export const silentExitImplementation: Implementation = {
  name: 'silent',
  description: 'Silent exit that records status without throwing',
  create(config: PluginConfig): PluginInstance {
    const exitConfig: ExitConfig = {
      throwOnExit: false,
    }

    if (config.options?.['onExit'] !== undefined) {
      exitConfig.onExit = config.options['onExit'] as (status: ExitStatus) => void
    }

    return new ExitInstance(exitConfig)
  },
}
