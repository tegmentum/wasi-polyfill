/**
 * wasi:surface plugin
 *
 * Provides windowing capabilities including pointer events,
 * keyboard input, resize notifications, and frame callbacks.
 *
 * @packageDocumentation
 */

import type { WasiPlugin, WasiInterface, Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import {
  type SurfaceHandle,
  type CreateDesc,
  type ResizeEvent,
  type FrameEvent,
  type PointerEvent,
  type KeyEvent,
  SurfaceRegistry,
  getDefaultSurfaceRegistry,
  mapDomKeyToWasiKey,
} from './types.js'
import type { ContextHandle } from '../graphics-context/types.js'

// =============================================================================
// Interface Definition
// =============================================================================

/**
 * WASI surface interface definition
 */
export const SURFACE_INTERFACE: WasiInterface = {
  package: 'wasi:surface',
  name: 'surface',
  version: '0.0.1',
}

// =============================================================================
// Pollable Integration
// =============================================================================

/**
 * Pollable handle type.
 */
type PollableHandle = number

/**
 * Pollable registry for event subscriptions.
 */
class PollableRegistry {
  private pollables = new Map<PollableHandle, { ready: boolean; unsubscribe?: () => void }>()
  private nextHandle = 1

  create(initialReady = false): PollableHandle {
    const handle = this.nextHandle++
    this.pollables.set(handle, { ready: initialReady })
    return handle
  }

  setReady(handle: PollableHandle, ready: boolean): void {
    const pollable = this.pollables.get(handle)
    if (pollable) {
      pollable.ready = ready
    }
  }

  isReady(handle: PollableHandle): boolean {
    return this.pollables.get(handle)?.ready ?? false
  }

  setUnsubscribe(handle: PollableHandle, unsubscribe: () => void): void {
    const pollable = this.pollables.get(handle)
    if (pollable) {
      pollable.unsubscribe = unsubscribe
    }
  }

  delete(handle: PollableHandle): void {
    const pollable = this.pollables.get(handle)
    if (pollable?.unsubscribe) {
      pollable.unsubscribe()
    }
    this.pollables.delete(handle)
  }
}

// =============================================================================
// Browser Implementation
// =============================================================================

/**
 * Create browser-based surface implementation.
 */
function createBrowserImplementation(
  surfaceRegistry: SurfaceRegistry,
  pollableRegistry: PollableRegistry
): Record<string, unknown> {
  return {
    // Surface resource
    '[resource-new]surface': (desc: CreateDesc): SurfaceHandle => {
      const handle = surfaceRegistry.createSurface(desc)
      const surface = surfaceRegistry.getSurface(handle)!

      // Create a canvas element if in browser
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas')
        canvas.width = surface.width
        canvas.height = surface.height
        canvas.style.display = 'block'
        surface.element = canvas

        // Set up event listeners
        canvas.addEventListener('mousedown', (e) => {
          surface.pointerDownEvents.push({ x: e.offsetX, y: e.offsetY })
        })

        canvas.addEventListener('mouseup', (e) => {
          surface.pointerUpEvents.push({ x: e.offsetX, y: e.offsetY })
        })

        canvas.addEventListener('mousemove', (e) => {
          surface.pointerMoveEvents.push({ x: e.offsetX, y: e.offsetY })
        })

        canvas.addEventListener('keydown', (e) => {
          surface.keyDownEvents.push({
            key: mapDomKeyToWasiKey(e.code),
            text: e.key.length === 1 ? e.key : null,
            altKey: e.altKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            shiftKey: e.shiftKey,
          })
        })

        canvas.addEventListener('keyup', (e) => {
          surface.keyUpEvents.push({
            key: mapDomKeyToWasiKey(e.code),
            text: e.key.length === 1 ? e.key : null,
            altKey: e.altKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            shiftKey: e.shiftKey,
          })
        })

        // Make canvas focusable for keyboard events
        canvas.tabIndex = 0
      }

      return handle
    },

    '[resource-drop]surface': (handle: SurfaceHandle): void => {
      const surface = surfaceRegistry.getSurface(handle)
      if (surface?.element && 'remove' in surface.element) {
        (surface.element as HTMLCanvasElement).remove()
      }
      surfaceRegistry.deleteSurface(handle)
    },

    '[method]surface.connect-graphics-context': (
      handle: SurfaceHandle,
      contextHandle: ContextHandle
    ): void => {
      surfaceRegistry.connectContext(handle, contextHandle)
    },

    '[method]surface.height': (handle: SurfaceHandle): number => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')
      return surface.height
    },

    '[method]surface.width': (handle: SurfaceHandle): number => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')
      return surface.width
    },

    '[method]surface.request-set-size': (
      handle: SurfaceHandle,
      height: number | null,
      width: number | null
    ): void => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')

      const newHeight = height ?? surface.height
      const newWidth = width ?? surface.width

      if (newHeight !== surface.height || newWidth !== surface.width) {
        surface.height = newHeight
        surface.width = newWidth

        if (surface.element) {
          surface.element.width = newWidth
          surface.element.height = newHeight
        }

        surface.resizeEvents.push({ height: newHeight, width: newWidth })
      }
    },

    // Resize events
    '[method]surface.subscribe-resize': (handle: SurfaceHandle): PollableHandle => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')

      const pollableHandle = pollableRegistry.create(!surface.resizeEvents.isEmpty())
      const unsubscribe = surface.resizeEvents.subscribe(() => {
        pollableRegistry.setReady(pollableHandle, true)
      })
      pollableRegistry.setUnsubscribe(pollableHandle, unsubscribe)
      return pollableHandle
    },

    '[method]surface.get-resize': (handle: SurfaceHandle): ResizeEvent | null => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')
      return surface.resizeEvents.pop()
    },

    // Frame events
    '[method]surface.subscribe-frame': (handle: SurfaceHandle): PollableHandle => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')

      const pollableHandle = pollableRegistry.create(!surface.frameEvents.isEmpty())
      const unsubscribe = surface.frameEvents.subscribe(() => {
        pollableRegistry.setReady(pollableHandle, true)
      })
      pollableRegistry.setUnsubscribe(pollableHandle, unsubscribe)

      // Request animation frame to push frame events
      if (typeof requestAnimationFrame !== 'undefined') {
        const pushFrame = () => {
          surface.frameEvents.push({ nothing: true })
          requestAnimationFrame(pushFrame)
        }
        requestAnimationFrame(pushFrame)
      }

      return pollableHandle
    },

    '[method]surface.get-frame': (handle: SurfaceHandle): FrameEvent | null => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')
      return surface.frameEvents.pop()
    },

    // Pointer events
    '[method]surface.subscribe-pointer-up': (handle: SurfaceHandle): PollableHandle => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')

      const pollableHandle = pollableRegistry.create(!surface.pointerUpEvents.isEmpty())
      const unsubscribe = surface.pointerUpEvents.subscribe(() => {
        pollableRegistry.setReady(pollableHandle, true)
      })
      pollableRegistry.setUnsubscribe(pollableHandle, unsubscribe)
      return pollableHandle
    },

    '[method]surface.get-pointer-up': (handle: SurfaceHandle): PointerEvent | null => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')
      return surface.pointerUpEvents.pop()
    },

    '[method]surface.subscribe-pointer-down': (handle: SurfaceHandle): PollableHandle => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')

      const pollableHandle = pollableRegistry.create(!surface.pointerDownEvents.isEmpty())
      const unsubscribe = surface.pointerDownEvents.subscribe(() => {
        pollableRegistry.setReady(pollableHandle, true)
      })
      pollableRegistry.setUnsubscribe(pollableHandle, unsubscribe)
      return pollableHandle
    },

    '[method]surface.get-pointer-down': (handle: SurfaceHandle): PointerEvent | null => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')
      return surface.pointerDownEvents.pop()
    },

    '[method]surface.subscribe-pointer-move': (handle: SurfaceHandle): PollableHandle => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')

      const pollableHandle = pollableRegistry.create(!surface.pointerMoveEvents.isEmpty())
      const unsubscribe = surface.pointerMoveEvents.subscribe(() => {
        pollableRegistry.setReady(pollableHandle, true)
      })
      pollableRegistry.setUnsubscribe(pollableHandle, unsubscribe)
      return pollableHandle
    },

    '[method]surface.get-pointer-move': (handle: SurfaceHandle): PointerEvent | null => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')
      return surface.pointerMoveEvents.pop()
    },

    // Keyboard events
    '[method]surface.subscribe-key-up': (handle: SurfaceHandle): PollableHandle => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')

      const pollableHandle = pollableRegistry.create(!surface.keyUpEvents.isEmpty())
      const unsubscribe = surface.keyUpEvents.subscribe(() => {
        pollableRegistry.setReady(pollableHandle, true)
      })
      pollableRegistry.setUnsubscribe(pollableHandle, unsubscribe)
      return pollableHandle
    },

    '[method]surface.get-key-up': (handle: SurfaceHandle): KeyEvent | null => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')
      return surface.keyUpEvents.pop()
    },

    '[method]surface.subscribe-key-down': (handle: SurfaceHandle): PollableHandle => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')

      const pollableHandle = pollableRegistry.create(!surface.keyDownEvents.isEmpty())
      const unsubscribe = surface.keyDownEvents.subscribe(() => {
        pollableRegistry.setReady(pollableHandle, true)
      })
      pollableRegistry.setUnsubscribe(pollableHandle, unsubscribe)
      return pollableHandle
    },

    '[method]surface.get-key-down': (handle: SurfaceHandle): KeyEvent | null => {
      const surface = surfaceRegistry.getSurface(handle)
      if (!surface) throw new Error('Surface not found')
      return surface.keyDownEvents.pop()
    },
  }
}

// =============================================================================
// Implementations
// =============================================================================

/**
 * Browser-based surface implementation.
 */
export const browserSurfaceImplementation: Implementation = {
  name: 'browser',
  description: 'Browser-based surface using HTML canvas and DOM events',
  create(_config: PluginConfig): PluginInstance {
    const surfaceRegistry = getDefaultSurfaceRegistry()
    const pollableRegistry = new PollableRegistry()
    const imports = createBrowserImplementation(surfaceRegistry, pollableRegistry)

    return {
      getImports(): Record<string, unknown> {
        return {
          'wasi:surface/surface@0.0.1': imports,
        }
      },
      destroy(): void {
        // Registry cleanup handled elsewhere
      },
    }
  },
}

/**
 * Headless surface implementation (for testing/server).
 */
export const headlessSurfaceImplementation: Implementation = {
  name: 'headless',
  description: 'In-memory surface for testing and server-side use',
  create(_config: PluginConfig): PluginInstance {
    const surfaceRegistry = new SurfaceRegistry()
    const pollableRegistry = new PollableRegistry()
    const imports = createBrowserImplementation(surfaceRegistry, pollableRegistry)

    return {
      getImports(): Record<string, unknown> {
        return {
          'wasi:surface/surface@0.0.1': imports,
        }
      },
      destroy(): void {
        // Cleanup handled by registry
      },
    }
  },
}

// =============================================================================
// Plugin Export
// =============================================================================

/**
 * wasi:surface/surface plugin
 *
 * Provides windowing and event handling capabilities.
 *
 * Implementations:
 * - browser: Uses HTML canvas and DOM events (default)
 * - headless: In-memory only, for testing
 */
export const surfacePlugin: WasiPlugin = createPlugin(
  SURFACE_INTERFACE,
  {
    browser: browserSurfaceImplementation,
    headless: headlessSurfaceImplementation,
  },
  'browser'
)

/**
 * All surface plugins
 */
export const surfacePlugins: WasiPlugin[] = [
  surfacePlugin,
]
