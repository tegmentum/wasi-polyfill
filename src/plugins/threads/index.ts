/**
 * Threads plugin exports
 *
 * Provides thread spawning support for WASI Preview 2 components.
 * In browsers, this uses Web Workers with SharedArrayBuffer.
 */

// Plugin definitions
export {
  THREAD_SPAWN_INTERFACE,
  threadSpawnPlugin,
  threadPlugins,
} from './plugin.js'

// Types
export {
  type ThreadId,
  type SpawnResult,
  type ThreadInfo,
  type ThreadCapabilities,
  ThreadSpawnError,
  ThreadState,
  checkThreadCapabilities,
  spawnError,
  spawnSuccess,
} from './types.js'

// Spawn implementation
export {
  type ThreadSpawnConfig,
  ThreadRegistry,
  globalThreadRegistry,
  stubThreadSpawnImplementation,
  workerThreadSpawnImplementation,
} from './spawn.js'
