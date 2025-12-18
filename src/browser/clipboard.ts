/**
 * browser:clipboard - Clipboard access interface
 *
 * Provides a capability-scoped interface to the Clipboard API
 * for reading and writing text content.
 *
 * Note: Clipboard access requires a secure context (HTTPS) and
 * typically requires a user gesture (click, tap, etc.).
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  mapErrorToBrowserError,
  type Result,
  ok,
  browserErr,
  PermissionState,
  mapPermissionState,
} from './types.js'
import { isSecureContext, hasRecentUserGesture, supports } from './runtime.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Clipboard item data types.
 */
export type ClipboardItemType = 'text/plain' | 'text/html' | 'image/png'

/**
 * Clipboard item data.
 */
export interface ClipboardItemData {
  type: ClipboardItemType
  data: string | Uint8Array
}

/**
 * Clipboard options.
 */
export interface ClipboardOptions {
  /** Whether to require user gesture (default: true) */
  requireUserGesture?: boolean
}

// =============================================================================
// Browser Clipboard
// =============================================================================

/**
 * Browser clipboard implementation.
 */
export class BrowserClipboard {
  private requireUserGesture: boolean

  constructor(options: ClipboardOptions = {}) {
    this.requireUserGesture = options.requireUserGesture ?? true
  }

  /**
   * Check clipboard requirements.
   */
  private checkRequirements(): Result<void, BrowserError> {
    // Check secure context
    if (!isSecureContext()) {
      return browserErr(
        BrowserErrorCode.INSECURE_CONTEXT,
        'Clipboard access requires a secure context (HTTPS)'
      )
    }

    // Check clipboard support
    if (!supports('browser:clipboard')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Clipboard API is not supported in this environment'
      )
    }

    // Check user gesture if required
    if (this.requireUserGesture && !hasRecentUserGesture()) {
      return browserErr(
        BrowserErrorCode.NO_USER_GESTURE,
        'Clipboard access requires a recent user gesture (click, tap, or key press)'
      )
    }

    return ok(undefined)
  }

  /**
   * Query the clipboard read permission.
   */
  async queryReadPermission(): Promise<Result<PermissionState, BrowserError>> {
    if (!supports('browser:permissions')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Permissions API is not supported'
      )
    }

    try {
      const result = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName })
      return ok(mapPermissionState(result.state))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Query the clipboard write permission.
   */
  async queryWritePermission(): Promise<Result<PermissionState, BrowserError>> {
    if (!supports('browser:permissions')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Permissions API is not supported'
      )
    }

    try {
      const result = await navigator.permissions.query({ name: 'clipboard-write' as PermissionName })
      return ok(mapPermissionState(result.state))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Read text from the clipboard.
   */
  async readText(): Promise<Result<string, BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!supports('browser:clipboard-read')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Clipboard read is not supported'
      )
    }

    try {
      const text = await navigator.clipboard.readText()
      return ok(text)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Write text to the clipboard.
   */
  async writeText(text: string): Promise<Result<void, BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!supports('browser:clipboard-write')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Clipboard write is not supported'
      )
    }

    try {
      await navigator.clipboard.writeText(text)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Read items from the clipboard (advanced).
   */
  async read(): Promise<Result<ClipboardItemData[], BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!supports('browser:clipboard-read')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Clipboard read is not supported'
      )
    }

    try {
      const items = await navigator.clipboard.read()
      const result: ClipboardItemData[] = []

      for (const item of items) {
        for (const type of item.types) {
          if (type === 'text/plain' || type === 'text/html') {
            const blob = await item.getType(type)
            const text = await blob.text()
            result.push({ type: type as ClipboardItemType, data: text })
          } else if (type === 'image/png') {
            const blob = await item.getType(type)
            const buffer = await blob.arrayBuffer()
            result.push({ type: 'image/png', data: new Uint8Array(buffer) })
          }
        }
      }

      return ok(result)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Write items to the clipboard (advanced).
   */
  async write(items: ClipboardItemData[]): Promise<Result<void, BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!supports('browser:clipboard-write')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Clipboard write is not supported'
      )
    }

    try {
      const clipboardItems: ClipboardItem[] = []

      for (const item of items) {
        let blob: Blob
        if (typeof item.data === 'string') {
          blob = new Blob([item.data], { type: item.type })
        } else {
          // Copy to new ArrayBuffer to avoid SharedArrayBuffer issues
          const buffer = new ArrayBuffer(item.data.length)
          new Uint8Array(buffer).set(item.data)
          blob = new Blob([buffer], { type: item.type })
        }
        clipboardItems.push(new ClipboardItem({ [item.type]: blob }))
      }

      await navigator.clipboard.write(clipboardItems)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultClipboard: BrowserClipboard | null = null

/**
 * Get the default clipboard instance.
 */
export function getDefaultClipboard(): BrowserClipboard {
  if (!defaultClipboard) {
    defaultClipboard = new BrowserClipboard()
  }
  return defaultClipboard
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Read text from the clipboard.
 */
export async function readText(): Promise<Result<string, BrowserError>> {
  return getDefaultClipboard().readText()
}

/**
 * Write text to the clipboard.
 */
export async function writeText(text: string): Promise<Result<void, BrowserError>> {
  return getDefaultClipboard().writeText(text)
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:clipboard imports object.
 */
export function getBrowserClipboardImports(options?: ClipboardOptions): Record<string, unknown> {
  let clipboard: BrowserClipboard | null = null

  const getClipboard = (): BrowserClipboard => {
    if (!clipboard) {
      clipboard = options ? new BrowserClipboard(options) : getDefaultClipboard()
    }
    return clipboard
  }

  return {
    'browser:clipboard/clipboard': {
      // Permissions
      'query-read-permission': () => getClipboard().queryReadPermission(),
      'query-write-permission': () => getClipboard().queryWritePermission(),

      // Text operations
      'read-text': () => getClipboard().readText(),
      'write-text': (text: string) => getClipboard().writeText(text),

      // Advanced operations
      read: () => getClipboard().read(),
      write: (items: ClipboardItemData[]) => getClipboard().write(items),
    },
  }
}
