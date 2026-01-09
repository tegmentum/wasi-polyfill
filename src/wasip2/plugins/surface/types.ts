/**
 * wasi:surface types
 *
 * Types for surface management with event handling.
 *
 * @packageDocumentation
 */

import type { ContextHandle } from '../graphics-context/types.js'

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle to a surface resource.
 */
export type SurfaceHandle = number

// =============================================================================
// Event Types
// =============================================================================

/**
 * Resize event data.
 */
export interface ResizeEvent {
  height: number
  width: number
}

/**
 * Frame event data.
 */
export interface FrameEvent {
  nothing: boolean
}

/**
 * Pointer event data.
 */
export interface PointerEvent {
  x: number
  y: number
}

/**
 * Key event data.
 */
export interface KeyEvent {
  key: Key | null
  text: string | null
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * Key codes following W3C UIEvents.
 */
export type Key =
  | 'backquote' | 'backslash' | 'bracket-left' | 'bracket-right' | 'comma'
  | 'digit0' | 'digit1' | 'digit2' | 'digit3' | 'digit4'
  | 'digit5' | 'digit6' | 'digit7' | 'digit8' | 'digit9'
  | 'equal' | 'intl-backslash' | 'intl-ro' | 'intl-yen'
  | 'key-a' | 'key-b' | 'key-c' | 'key-d' | 'key-e' | 'key-f' | 'key-g'
  | 'key-h' | 'key-i' | 'key-j' | 'key-k' | 'key-l' | 'key-m' | 'key-n'
  | 'key-o' | 'key-p' | 'key-q' | 'key-r' | 'key-s' | 'key-t' | 'key-u'
  | 'key-v' | 'key-w' | 'key-x' | 'key-y' | 'key-z'
  | 'minus' | 'period' | 'quote' | 'semicolon' | 'slash'
  | 'alt-left' | 'alt-right' | 'backspace' | 'caps-lock' | 'context-menu'
  | 'control-left' | 'control-right' | 'enter' | 'meta-left' | 'meta-right'
  | 'shift-left' | 'shift-right' | 'space' | 'tab'
  | 'convert' | 'kana-mode' | 'lang1' | 'lang2' | 'lang3' | 'lang4' | 'lang5'
  | 'non-convert' | 'delete' | 'end' | 'help' | 'home' | 'insert'
  | 'page-down' | 'page-up' | 'arrow-down' | 'arrow-left' | 'arrow-right' | 'arrow-up'
  | 'num-lock' | 'numpad0' | 'numpad1' | 'numpad2' | 'numpad3' | 'numpad4'
  | 'numpad5' | 'numpad6' | 'numpad7' | 'numpad8' | 'numpad9'
  | 'numpad-add' | 'numpad-backspace' | 'numpad-clear' | 'numpad-clear-entry'
  | 'numpad-comma' | 'numpad-decimal' | 'numpad-divide' | 'numpad-enter'
  | 'numpad-equal' | 'numpad-hash' | 'numpad-memory-add' | 'numpad-memory-clear'
  | 'numpad-memory-recall' | 'numpad-memory-store' | 'numpad-memory-subtract'
  | 'numpad-multiply' | 'numpad-paren-left' | 'numpad-paren-right'
  | 'numpad-star' | 'numpad-subtract'
  | 'escape' | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8' | 'f9'
  | 'f10' | 'f11' | 'f12' | 'fn' | 'fn-lock' | 'print-screen' | 'scroll-lock' | 'pause'
  | 'browser-back' | 'browser-favorites' | 'browser-forward' | 'browser-home'
  | 'browser-refresh' | 'browser-search' | 'browser-stop'
  | 'eject' | 'launch-app1' | 'launch-app2' | 'launch-mail'
  | 'media-play-pause' | 'media-select' | 'media-stop'
  | 'media-track-next' | 'media-track-previous'
  | 'power' | 'sleep' | 'audio-volume-down' | 'audio-volume-mute' | 'audio-volume-up'
  | 'wake-up' | 'hyper' | 'super' | 'turbo' | 'abort' | 'resume' | 'suspend'
  | 'again' | 'copy' | 'cut' | 'find' | 'open' | 'paste' | 'props' | 'select' | 'undo'
  | 'hiragana' | 'katakana'

// =============================================================================
// Surface Configuration
// =============================================================================

/**
 * Surface creation descriptor.
 */
export interface CreateDesc {
  height?: number
  width?: number
}

// =============================================================================
// Event Queues
// =============================================================================

/**
 * Event queue for a specific event type.
 */
export class EventQueue<T> {
  private events: T[] = []
  private subscribers: Set<() => void> = new Set()

  push(event: T): void {
    this.events.push(event)
    // Notify subscribers
    for (const subscriber of this.subscribers) {
      subscriber()
    }
  }

  pop(): T | null {
    return this.events.shift() ?? null
  }

  peek(): T | null {
    return this.events[0] ?? null
  }

  isEmpty(): boolean {
    return this.events.length === 0
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }
}

// =============================================================================
// Surface State
// =============================================================================

/**
 * Surface state.
 */
export interface Surface {
  handle: SurfaceHandle
  width: number
  height: number
  connectedContext: ContextHandle | null
  resizeEvents: EventQueue<ResizeEvent>
  frameEvents: EventQueue<FrameEvent>
  pointerUpEvents: EventQueue<PointerEvent>
  pointerDownEvents: EventQueue<PointerEvent>
  pointerMoveEvents: EventQueue<PointerEvent>
  keyUpEvents: EventQueue<KeyEvent>
  keyDownEvents: EventQueue<KeyEvent>
  /** DOM element if browser-based */
  element?: HTMLCanvasElement | OffscreenCanvas
}

// =============================================================================
// Surface Registry
// =============================================================================

/**
 * Registry for managing surface resources.
 */
export class SurfaceRegistry {
  private surfaces = new Map<SurfaceHandle, Surface>()
  private nextHandle = 1

  /**
   * Create a new surface.
   */
  createSurface(desc: CreateDesc): SurfaceHandle {
    const handle = this.nextHandle++
    const surface: Surface = {
      handle,
      width: desc.width ?? 800,
      height: desc.height ?? 600,
      connectedContext: null,
      resizeEvents: new EventQueue(),
      frameEvents: new EventQueue(),
      pointerUpEvents: new EventQueue(),
      pointerDownEvents: new EventQueue(),
      pointerMoveEvents: new EventQueue(),
      keyUpEvents: new EventQueue(),
      keyDownEvents: new EventQueue(),
    }
    this.surfaces.set(handle, surface)
    return handle
  }

  /**
   * Get a surface by handle.
   */
  getSurface(handle: SurfaceHandle): Surface | undefined {
    return this.surfaces.get(handle)
  }

  /**
   * Delete a surface.
   */
  deleteSurface(handle: SurfaceHandle): boolean {
    return this.surfaces.delete(handle)
  }

  /**
   * Connect a surface to a graphics context.
   */
  connectContext(surfaceHandle: SurfaceHandle, contextHandle: ContextHandle): void {
    const surface = this.surfaces.get(surfaceHandle)
    if (surface) {
      surface.connectedContext = contextHandle
    }
  }
}

// =============================================================================
// Default Registry
// =============================================================================

let defaultRegistry: SurfaceRegistry | null = null

/**
 * Get the default surface registry.
 */
export function getDefaultSurfaceRegistry(): SurfaceRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new SurfaceRegistry()
  }
  return defaultRegistry
}

// =============================================================================
// Key Mapping
// =============================================================================

/**
 * Map DOM key codes to WASI key enum values.
 */
export function mapDomKeyToWasiKey(code: string): Key | null {
  const mapping: Record<string, Key> = {
    'Backquote': 'backquote',
    'Backslash': 'backslash',
    'BracketLeft': 'bracket-left',
    'BracketRight': 'bracket-right',
    'Comma': 'comma',
    'Digit0': 'digit0',
    'Digit1': 'digit1',
    'Digit2': 'digit2',
    'Digit3': 'digit3',
    'Digit4': 'digit4',
    'Digit5': 'digit5',
    'Digit6': 'digit6',
    'Digit7': 'digit7',
    'Digit8': 'digit8',
    'Digit9': 'digit9',
    'Equal': 'equal',
    'IntlBackslash': 'intl-backslash',
    'IntlRo': 'intl-ro',
    'IntlYen': 'intl-yen',
    'KeyA': 'key-a',
    'KeyB': 'key-b',
    'KeyC': 'key-c',
    'KeyD': 'key-d',
    'KeyE': 'key-e',
    'KeyF': 'key-f',
    'KeyG': 'key-g',
    'KeyH': 'key-h',
    'KeyI': 'key-i',
    'KeyJ': 'key-j',
    'KeyK': 'key-k',
    'KeyL': 'key-l',
    'KeyM': 'key-m',
    'KeyN': 'key-n',
    'KeyO': 'key-o',
    'KeyP': 'key-p',
    'KeyQ': 'key-q',
    'KeyR': 'key-r',
    'KeyS': 'key-s',
    'KeyT': 'key-t',
    'KeyU': 'key-u',
    'KeyV': 'key-v',
    'KeyW': 'key-w',
    'KeyX': 'key-x',
    'KeyY': 'key-y',
    'KeyZ': 'key-z',
    'Minus': 'minus',
    'Period': 'period',
    'Quote': 'quote',
    'Semicolon': 'semicolon',
    'Slash': 'slash',
    'AltLeft': 'alt-left',
    'AltRight': 'alt-right',
    'Backspace': 'backspace',
    'CapsLock': 'caps-lock',
    'ContextMenu': 'context-menu',
    'ControlLeft': 'control-left',
    'ControlRight': 'control-right',
    'Enter': 'enter',
    'MetaLeft': 'meta-left',
    'MetaRight': 'meta-right',
    'ShiftLeft': 'shift-left',
    'ShiftRight': 'shift-right',
    'Space': 'space',
    'Tab': 'tab',
    'Delete': 'delete',
    'End': 'end',
    'Help': 'help',
    'Home': 'home',
    'Insert': 'insert',
    'PageDown': 'page-down',
    'PageUp': 'page-up',
    'ArrowDown': 'arrow-down',
    'ArrowLeft': 'arrow-left',
    'ArrowRight': 'arrow-right',
    'ArrowUp': 'arrow-up',
    'NumLock': 'num-lock',
    'Numpad0': 'numpad0',
    'Numpad1': 'numpad1',
    'Numpad2': 'numpad2',
    'Numpad3': 'numpad3',
    'Numpad4': 'numpad4',
    'Numpad5': 'numpad5',
    'Numpad6': 'numpad6',
    'Numpad7': 'numpad7',
    'Numpad8': 'numpad8',
    'Numpad9': 'numpad9',
    'NumpadAdd': 'numpad-add',
    'NumpadDecimal': 'numpad-decimal',
    'NumpadDivide': 'numpad-divide',
    'NumpadEnter': 'numpad-enter',
    'NumpadEqual': 'numpad-equal',
    'NumpadMultiply': 'numpad-multiply',
    'NumpadSubtract': 'numpad-subtract',
    'Escape': 'escape',
    'F1': 'f1',
    'F2': 'f2',
    'F3': 'f3',
    'F4': 'f4',
    'F5': 'f5',
    'F6': 'f6',
    'F7': 'f7',
    'F8': 'f8',
    'F9': 'f9',
    'F10': 'f10',
    'F11': 'f11',
    'F12': 'f12',
    'PrintScreen': 'print-screen',
    'ScrollLock': 'scroll-lock',
    'Pause': 'pause',
  }
  return mapping[code] ?? null
}
