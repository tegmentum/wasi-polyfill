/**
 * wasi:surface plugin exports
 *
 * @packageDocumentation
 */

export {
  // Types
  type SurfaceHandle,
  type ResizeEvent,
  type FrameEvent,
  type PointerEvent,
  type KeyEvent,
  type Key,
  type CreateDesc,
  type Surface,
  // Classes
  EventQueue,
  SurfaceRegistry,
  // Functions
  getDefaultSurfaceRegistry,
  mapDomKeyToWasiKey,
} from './types.js'

export {
  // Interface
  SURFACE_INTERFACE,
  // Implementations
  browserSurfaceImplementation,
  headlessSurfaceImplementation,
  // Plugin
  surfacePlugin,
  surfacePlugins,
} from './plugin.js'
