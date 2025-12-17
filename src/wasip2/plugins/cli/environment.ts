/**
 * Environment implementation for wasi:cli/environment
 *
 * Provides environment variables and command-line arguments.
 * In a browser context, these are configured by the host.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'

/**
 * Configuration options for the environment plugin
 */
export interface EnvironmentConfig {
  /** Environment variables to expose */
  env?: Record<string, string>
  /** Whether to inherit environment from host (Node.js only) */
  inheritEnv?: boolean
  /** Command-line arguments */
  args?: string[]
  /** Whether to inherit args from host (Node.js only) */
  inheritArgs?: boolean
  /** Initial working directory */
  cwd?: string
}

/**
 * Environment plugin instance
 */
class EnvironmentInstance implements PluginInstance {
  private readonly env: Map<string, string>
  private readonly args: string[]
  private readonly cwd: string

  constructor(config: EnvironmentConfig) {
    this.env = new Map()
    this.args = []
    this.cwd = config.cwd ?? '/'

    // Set up environment variables
    if (config.inheritEnv && typeof process !== 'undefined' && process.env) {
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          this.env.set(key, value)
        }
      }
    }

    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        this.env.set(key, value)
      }
    }

    // Set up arguments
    if (config.inheritArgs && typeof process !== 'undefined' && process.argv) {
      this.args.push(...process.argv.slice(2))
    }

    if (config.args) {
      // If explicit args provided, they override inherited ones
      if (config.args.length > 0) {
        this.args.length = 0
        this.args.push(...config.args)
      }
    }
  }

  getImports(): Record<string, unknown> {
    return {
      'get-environment': this.getEnvironment.bind(this),
      'get-arguments': this.getArguments.bind(this),
      'initial-cwd': this.initialCwd.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  /**
   * Get environment variables as a list of key-value tuples
   */
  private getEnvironment(): Array<[string, string]> {
    return Array.from(this.env.entries())
  }

  /**
   * Get command-line arguments
   */
  private getArguments(): string[] {
    return [...this.args]
  }

  /**
   * Get initial working directory
   */
  private initialCwd(): string | undefined {
    return this.cwd
  }
}

/**
 * Virtual environment implementation
 *
 * Provides configurable environment variables and arguments.
 */
export const virtualEnvironmentImplementation: Implementation = {
  name: 'virtual',
  description: 'Virtual environment with configurable env vars and args',
  create(config: PluginConfig): PluginInstance {
    const envConfig: EnvironmentConfig = {}

    if (config.options?.['env'] !== undefined) {
      envConfig.env = config.options['env'] as Record<string, string>
    }
    if (config.options?.['inheritEnv'] !== undefined) {
      envConfig.inheritEnv = config.options['inheritEnv'] as boolean
    }
    if (config.options?.['args'] !== undefined) {
      envConfig.args = config.options['args'] as string[]
    }
    if (config.options?.['inheritArgs'] !== undefined) {
      envConfig.inheritArgs = config.options['inheritArgs'] as boolean
    }
    if (config.options?.['cwd'] !== undefined) {
      envConfig.cwd = config.options['cwd'] as string
    }

    return new EnvironmentInstance(envConfig)
  },
}

/**
 * Browser environment implementation
 *
 * Uses URL parameters as arguments and limited environment.
 */
class BrowserEnvironmentInstance implements PluginInstance {
  private readonly env: Map<string, string>
  private readonly args: string[]

  constructor(config: PluginConfig) {
    this.env = new Map()
    this.args = []

    // Extract environment from config
    const configEnv = config.options?.['env'] as Record<string, string> | undefined
    if (configEnv) {
      for (const [key, value] of Object.entries(configEnv)) {
        this.env.set(key, value)
      }
    }

    // Try to extract arguments from URL in browser
    if (typeof window !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search)
      const argsParam = params.get('args')
      if (argsParam) {
        this.args.push(...argsParam.split(' '))
      }
    }

    // Override with explicit args if provided
    const configArgs = config.options?.['args'] as string[] | undefined
    if (configArgs && configArgs.length > 0) {
      this.args.length = 0
      this.args.push(...configArgs)
    }
  }

  getImports(): Record<string, unknown> {
    return {
      'get-environment': this.getEnvironment.bind(this),
      'get-arguments': this.getArguments.bind(this),
      'initial-cwd': this.initialCwd.bind(this),
    }
  }

  destroy(): void {
    // No resources to clean up
  }

  private getEnvironment(): Array<[string, string]> {
    return Array.from(this.env.entries())
  }

  private getArguments(): string[] {
    return [...this.args]
  }

  private initialCwd(): string | undefined {
    return '/'
  }
}

/**
 * Browser environment implementation
 */
export const browserEnvironmentImplementation: Implementation = {
  name: 'browser',
  description: 'Browser environment using URL params for args',
  create(config: PluginConfig): PluginInstance {
    return new BrowserEnvironmentInstance(config)
  },
}
