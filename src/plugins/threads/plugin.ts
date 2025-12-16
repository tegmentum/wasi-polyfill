/**
 * wasi:thread-spawn plugin definitions
 *
 * Provides thread spawning capability for WASI Preview 2 components.
 * In browsers, this uses Web Workers with SharedArrayBuffer.
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { stubThreadSpawnImplementation, workerThreadSpawnImplementation } from './spawn.js'

/**
 * WASI thread-spawn interface definition
 *
 * Note: The exact interface name may vary between WASI proposals.
 * This follows the wasi-threads proposal.
 */
export const THREAD_SPAWN_INTERFACE: WasiInterface = {
  package: 'wasi:thread-spawn',
  name: 'thread-spawn',
  version: '0.1.0',
}

/**
 * wasi:thread-spawn/thread-spawn plugin
 *
 * Provides the ability to spawn new threads.
 *
 * Implementations:
 * - stub: Returns NotSupported for all spawn attempts (default)
 * - worker: Uses Web Workers for thread spawning
 *
 * The stub implementation is default because:
 * 1. Threading requires SharedArrayBuffer which has security restrictions
 * 2. A worker script URL must be provided for the worker implementation
 * 3. Not all WASM modules support threading
 */
export const threadSpawnPlugin: WasiPlugin = createPlugin(
  THREAD_SPAWN_INTERFACE,
  {
    stub: stubThreadSpawnImplementation,
    worker: workerThreadSpawnImplementation,
  },
  'stub'
)

/**
 * All thread plugins for convenient registration
 */
export const threadPlugins: WasiPlugin[] = [threadSpawnPlugin]
