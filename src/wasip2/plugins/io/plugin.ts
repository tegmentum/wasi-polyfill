/**
 * wasi:io plugin definitions
 *
 * Includes:
 * - wasi:io/poll - Polling for readiness
 * - wasi:io/streams - Input/output streams
 * - wasi:io/error - Error handling
 */

import type {
  WasiPlugin,
  WasiInterface,
  PluginConfig,
  PluginInstance,
} from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import {
  PollableRegistry,
  globalPollableRegistry,
} from './pollable.js'
import {
  StreamRegistry,
  globalStreamRegistry,
} from './streams.js'
import { ErrorRegistry, globalErrorRegistry } from './error.js'

/**
 * WASI poll interface definition
 */
export const POLL_INTERFACE: WasiInterface = {
  package: 'wasi:io',
  name: 'poll',
  version: '0.2.0',
}

/**
 * WASI streams interface definition
 */
export const STREAMS_INTERFACE: WasiInterface = {
  package: 'wasi:io',
  name: 'streams',
  version: '0.2.0',
}

/**
 * WASI error interface definition
 */
export const ERROR_INTERFACE: WasiInterface = {
  package: 'wasi:io',
  name: 'error',
  version: '0.2.0',
}

/**
 * Poll plugin instance
 */
class PollInstance implements PluginInstance {
  private readonly registry: PollableRegistry

  constructor(registry: PollableRegistry) {
    this.registry = registry
  }

  getImports(): Record<string, unknown> {
    return {
      poll: this.poll.bind(this),
      '[resource-drop]pollable': this.dropPollable.bind(this),
    }
  }

  destroy(): void {
    // Don't clear the global registry
  }

  /**
   * Poll multiple pollables for readiness
   *
   * @param handles - Array of pollable handles
   * @returns Array of indices that are ready
   */
  private async poll(handles: number[]): Promise<number[]> {
    return this.registry.poll(handles, true)
  }

  /**
   * Drop a pollable resource
   */
  private dropPollable(handle: number): void {
    this.registry.drop(handle)
  }
}

/**
 * Streams plugin instance
 */
class StreamsInstance implements PluginInstance {
  private readonly streamRegistry: StreamRegistry
  private readonly pollableRegistry: PollableRegistry

  constructor(
    streamRegistry: StreamRegistry,
    pollableRegistry: PollableRegistry
  ) {
    this.streamRegistry = streamRegistry
    this.pollableRegistry = pollableRegistry
  }

  getImports(): Record<string, unknown> {
    return {
      // Input stream methods
      '[method]input-stream.read': this.inputStreamRead.bind(this),
      '[method]input-stream.blocking-read': this.inputStreamBlockingRead.bind(this),
      '[method]input-stream.skip': this.inputStreamSkip.bind(this),
      '[method]input-stream.blocking-skip': this.inputStreamBlockingSkip.bind(this),
      '[method]input-stream.subscribe': this.inputStreamSubscribe.bind(this),
      '[resource-drop]input-stream': this.dropInputStream.bind(this),

      // Output stream methods
      '[method]output-stream.check-write': this.outputStreamCheckWrite.bind(this),
      '[method]output-stream.write': this.outputStreamWrite.bind(this),
      '[method]output-stream.blocking-write-and-flush': this.outputStreamBlockingWriteAndFlush.bind(this),
      '[method]output-stream.flush': this.outputStreamFlush.bind(this),
      '[method]output-stream.blocking-flush': this.outputStreamBlockingFlush.bind(this),
      '[method]output-stream.subscribe': this.outputStreamSubscribe.bind(this),
      '[method]output-stream.write-zeroes': this.outputStreamWriteZeroes.bind(this),
      '[method]output-stream.blocking-write-zeroes-and-flush': this.outputStreamBlockingWriteZeroesAndFlush.bind(this),
      '[method]output-stream.splice': this.outputStreamSplice.bind(this),
      '[method]output-stream.blocking-splice': this.outputStreamBlockingSplice.bind(this),
      '[resource-drop]output-stream': this.dropOutputStream.bind(this),
    }
  }

  destroy(): void {
    // Don't clear global registries
  }

  // Input stream methods
  private inputStreamRead(handle: number, len: bigint): Uint8Array {
    const stream = this.streamRegistry.getInput(handle)
    if (!stream) {
      throw new Error(`Invalid input stream handle: ${handle}`)
    }
    const result = stream.read(len)
    if (result instanceof Uint8Array) {
      return result
    }
    if (result.tag === 'closed') {
      throw new Error('Stream closed')
    }
    throw result.val
  }

  private async inputStreamBlockingRead(
    handle: number,
    len: bigint
  ): Promise<Uint8Array> {
    const stream = this.streamRegistry.getInput(handle)
    if (!stream) {
      throw new Error(`Invalid input stream handle: ${handle}`)
    }
    const result = await stream.blockingRead(len)
    if (result instanceof Uint8Array) {
      return result
    }
    if (result.tag === 'closed') {
      throw new Error('Stream closed')
    }
    throw result.val
  }

  private inputStreamSkip(handle: number, len: bigint): bigint {
    const stream = this.streamRegistry.getInput(handle)
    if (!stream) {
      throw new Error(`Invalid input stream handle: ${handle}`)
    }
    const result = stream.skip(len)
    if (typeof result === 'bigint') {
      return result
    }
    if (result.tag === 'closed') {
      throw new Error('Stream closed')
    }
    throw result.val
  }

  private async inputStreamBlockingSkip(
    handle: number,
    len: bigint
  ): Promise<bigint> {
    // For memory streams, skip is the same blocking or not
    return this.inputStreamSkip(handle, len)
  }

  private inputStreamSubscribe(handle: number): number {
    const stream = this.streamRegistry.getInput(handle)
    if (!stream) {
      throw new Error(`Invalid input stream handle: ${handle}`)
    }
    return stream.subscribe(this.pollableRegistry)
  }

  private dropInputStream(handle: number): void {
    this.streamRegistry.drop(handle)
  }

  // Output stream methods
  private outputStreamCheckWrite(handle: number): bigint {
    const stream = this.streamRegistry.getOutput(handle)
    if (!stream) {
      throw new Error(`Invalid output stream handle: ${handle}`)
    }
    const result = stream.checkWrite()
    if (typeof result === 'bigint') {
      return result
    }
    if (result.tag === 'closed') {
      throw new Error('Stream closed')
    }
    throw result.val
  }

  private outputStreamWrite(handle: number, contents: Uint8Array): void {
    const stream = this.streamRegistry.getOutput(handle)
    if (!stream) {
      throw new Error(`Invalid output stream handle: ${handle}`)
    }
    const error = stream.write(contents)
    if (error) {
      if (error.tag === 'closed') {
        throw new Error('Stream closed')
      }
      throw error.val
    }
  }

  private async outputStreamBlockingWriteAndFlush(
    handle: number,
    contents: Uint8Array
  ): Promise<void> {
    const stream = this.streamRegistry.getOutput(handle)
    if (!stream) {
      throw new Error(`Invalid output stream handle: ${handle}`)
    }
    const error = await stream.blockingWriteAndFlush(contents)
    if (error) {
      if (error.tag === 'closed') {
        throw new Error('Stream closed')
      }
      throw error.val
    }
  }

  private outputStreamFlush(handle: number): void {
    const stream = this.streamRegistry.getOutput(handle)
    if (!stream) {
      throw new Error(`Invalid output stream handle: ${handle}`)
    }
    const error = stream.flush()
    if (error) {
      if (error.tag === 'closed') {
        throw new Error('Stream closed')
      }
      throw error.val
    }
  }

  private async outputStreamBlockingFlush(handle: number): Promise<void> {
    const stream = this.streamRegistry.getOutput(handle)
    if (!stream) {
      throw new Error(`Invalid output stream handle: ${handle}`)
    }
    const error = await stream.blockingFlush()
    if (error) {
      if (error.tag === 'closed') {
        throw new Error('Stream closed')
      }
      throw error.val
    }
  }

  private outputStreamSubscribe(handle: number): number {
    const stream = this.streamRegistry.getOutput(handle)
    if (!stream) {
      throw new Error(`Invalid output stream handle: ${handle}`)
    }
    return stream.subscribe(this.pollableRegistry)
  }

  private outputStreamWriteZeroes(handle: number, len: bigint): void {
    const stream = this.streamRegistry.getOutput(handle)
    if (!stream) {
      throw new Error(`Invalid output stream handle: ${handle}`)
    }
    const error = stream.writeZeroes(len)
    if (error) {
      if (error.tag === 'closed') {
        throw new Error('Stream closed')
      }
      throw error.val
    }
  }

  private async outputStreamBlockingWriteZeroesAndFlush(
    handle: number,
    len: bigint
  ): Promise<void> {
    this.outputStreamWriteZeroes(handle, len)
    await this.outputStreamBlockingFlush(handle)
  }

  private outputStreamSplice(
    handle: number,
    srcHandle: number,
    len: bigint
  ): bigint {
    const stream = this.streamRegistry.getOutput(handle)
    const src = this.streamRegistry.getInput(srcHandle)
    if (!stream) {
      throw new Error(`Invalid output stream handle: ${handle}`)
    }
    if (!src) {
      throw new Error(`Invalid input stream handle: ${srcHandle}`)
    }
    const result = stream.splice(src, len)
    if (typeof result === 'bigint') {
      return result
    }
    if (result.tag === 'closed') {
      throw new Error('Stream closed')
    }
    throw result.val
  }

  private async outputStreamBlockingSplice(
    handle: number,
    srcHandle: number,
    len: bigint
  ): Promise<bigint> {
    return this.outputStreamSplice(handle, srcHandle, len)
  }

  private dropOutputStream(handle: number): void {
    this.streamRegistry.drop(handle)
  }
}

/**
 * Error plugin instance
 */
class ErrorInstance implements PluginInstance {
  private readonly registry: ErrorRegistry

  constructor(registry: ErrorRegistry) {
    this.registry = registry
  }

  getImports(): Record<string, unknown> {
    return {
      '[method]error.to-debug-string': this.toDebugString.bind(this),
      '[resource-drop]error': this.dropError.bind(this),
    }
  }

  destroy(): void {
    // Don't clear global registry
  }

  private toDebugString(handle: number): string {
    return this.registry.toDebugString(handle)
  }

  private dropError(handle: number): void {
    this.registry.drop(handle)
  }
}

/**
 * wasi:io/poll plugin
 */
export const pollPlugin: WasiPlugin = createPlugin(
  POLL_INTERFACE,
  {
    default: {
      name: 'default',
      description: 'Default poll implementation using Promises',
      create(_config: PluginConfig): PluginInstance {
        return new PollInstance(globalPollableRegistry)
      },
    },
  },
  'default'
)

/**
 * wasi:io/streams plugin
 */
export const streamsPlugin: WasiPlugin = createPlugin(
  STREAMS_INTERFACE,
  {
    default: {
      name: 'default',
      description: 'Default streams implementation',
      create(_config: PluginConfig): PluginInstance {
        return new StreamsInstance(globalStreamRegistry, globalPollableRegistry)
      },
    },
  },
  'default'
)

/**
 * wasi:io/error plugin
 */
export const errorPlugin: WasiPlugin = createPlugin(
  ERROR_INTERFACE,
  {
    default: {
      name: 'default',
      description: 'Default error implementation',
      create(_config: PluginConfig): PluginInstance {
        return new ErrorInstance(globalErrorRegistry)
      },
    },
  },
  'default'
)

/**
 * All io plugins for convenient registration
 */
export const ioPlugins: WasiPlugin[] = [pollPlugin, streamsPlugin, errorPlugin]
