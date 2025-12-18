/**
 * browser:notifications - Web notifications interface
 *
 * Provides a capability-scoped interface to the Notifications API
 * for displaying system notifications to the user.
 *
 * Note: Notifications require a secure context (HTTPS) and
 * explicit user permission.
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
} from './types.js'
import { isSecureContext, supports } from './runtime.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Notification handle.
 */
export type NotificationHandle = number

/**
 * Notification direction.
 */
export type NotificationDirection = 'auto' | 'ltr' | 'rtl'

/**
 * Notification options.
 */
export interface NotificationOptions {
  /** Body text */
  body?: string
  /** Icon URL */
  icon?: string
  /** Badge URL (for mobile) */
  badge?: string
  /** Image URL */
  image?: string
  /** Notification tag (for grouping/replacing) */
  tag?: string
  /** Data to associate with notification */
  data?: unknown
  /** Text direction */
  dir?: NotificationDirection
  /** Language */
  lang?: string
  /** Whether to vibrate (mobile) */
  vibrate?: number[]
  /** Whether to renotify on tag match */
  renotify?: boolean
  /** Whether notification requires interaction */
  requireInteraction?: boolean
  /** Whether notification is silent */
  silent?: boolean
  /** Timestamp to show (ms since epoch) */
  timestamp?: number
  /** Actions (buttons) */
  actions?: NotificationAction[]
}

/**
 * Notification action (button).
 */
export interface NotificationAction {
  /** Action identifier */
  action: string
  /** Button title */
  title: string
  /** Button icon URL */
  icon?: string
}

/**
 * Notification event from a shown notification.
 */
export type NotificationEvent =
  | { type: 'click' }
  | { type: 'close' }
  | { type: 'error'; error: BrowserError }
  | { type: 'show' }

/**
 * Notifications configuration.
 */
export interface NotificationsConfig {
  /** Default notification options */
  defaultOptions?: NotificationOptions
}

// =============================================================================
// Browser Notifications
// =============================================================================

/**
 * Browser notifications implementation.
 */
export class BrowserNotifications {
  private defaultOptions: NotificationOptions
  private handleCounter = 1
  private notifications = new Map<NotificationHandle, {
    notification: Notification
    eventQueue: NotificationEvent[]
    resolvers: Array<(events: NotificationEvent[]) => void>
    closed: boolean
  }>()

  constructor(config: NotificationsConfig = {}) {
    this.defaultOptions = config.defaultOptions ?? {}
  }

  /**
   * Check notification requirements.
   */
  private checkRequirements(): Result<void, BrowserError> {
    if (!isSecureContext()) {
      return browserErr(
        BrowserErrorCode.INSECURE_CONTEXT,
        'Notifications require a secure context (HTTPS)'
      )
    }

    if (!supports('browser:notifications')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Notifications API is not supported in this environment'
      )
    }

    return ok(undefined)
  }

  /**
   * Map permission string to PermissionState.
   */
  private mapPermission(permission: NotificationPermission): PermissionState {
    switch (permission) {
      case 'granted':
        return PermissionState.GRANTED
      case 'denied':
        return PermissionState.DENIED
      case 'default':
      default:
        return PermissionState.PROMPT
    }
  }

  /**
   * Get the current permission state.
   */
  getPermission(): Result<PermissionState, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    return ok(this.mapPermission(Notification.permission))
  }

  /**
   * Request notification permission.
   */
  async requestPermission(): Promise<Result<PermissionState, BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    try {
      const permission = await Notification.requestPermission()
      return ok(this.mapPermission(permission))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Show a notification.
   */
  show(title: string, options?: NotificationOptions): Result<NotificationHandle, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (Notification.permission !== 'granted') {
      return browserErr(
        BrowserErrorCode.DENIED,
        'Notification permission not granted'
      )
    }

    try {
      const opts = { ...this.defaultOptions, ...options }
      const notification = new Notification(title, opts)
      const handle = this.handleCounter++

      const state = {
        notification,
        eventQueue: [] as NotificationEvent[],
        resolvers: [] as Array<(events: NotificationEvent[]) => void>,
        closed: false,
      }

      const pushEvent = (event: NotificationEvent) => {
        if (state.closed) return
        if (state.resolvers.length > 0) {
          const resolver = state.resolvers.shift()!
          resolver([event])
        } else {
          state.eventQueue.push(event)
        }
      }

      notification.onclick = () => pushEvent({ type: 'click' })
      notification.onclose = () => {
        pushEvent({ type: 'close' })
        state.closed = true
      }
      notification.onerror = () => pushEvent({
        type: 'error',
        error: { code: BrowserErrorCode.UNKNOWN, message: 'Notification error' },
      })
      notification.onshow = () => pushEvent({ type: 'show' })

      this.notifications.set(handle, state)
      return ok(handle)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Read events from a notification.
   */
  async readEvents(handle: NotificationHandle): Promise<NotificationEvent[]> {
    const state = this.notifications.get(handle)
    if (!state || state.closed) {
      return []
    }

    if (state.eventQueue.length > 0) {
      return state.eventQueue.splice(0)
    }

    return new Promise((resolve) => {
      state.resolvers.push(resolve)
    })
  }

  /**
   * Poll for notification events without waiting.
   */
  pollEvents(handle: NotificationHandle): Result<NotificationEvent[], BrowserError> {
    const state = this.notifications.get(handle)
    if (!state) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Notification not found')
    }

    return ok(state.eventQueue.splice(0))
  }

  /**
   * Close a notification.
   */
  close(handle: NotificationHandle): Result<void, BrowserError> {
    const state = this.notifications.get(handle)
    if (!state) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Notification not found')
    }

    state.notification.close()
    state.closed = true

    // Resolve any waiting readers with empty array
    for (const resolver of state.resolvers) {
      resolver([])
    }
    state.resolvers = []

    this.notifications.delete(handle)
    return ok(undefined)
  }

  /**
   * Close all notifications.
   */
  closeAll(): void {
    for (const handle of this.notifications.keys()) {
      this.close(handle)
    }
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultNotifications: BrowserNotifications | null = null

/**
 * Get the default notifications instance.
 */
export function getDefaultNotifications(): BrowserNotifications {
  if (!defaultNotifications) {
    defaultNotifications = new BrowserNotifications()
  }
  return defaultNotifications
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Request notification permission.
 */
export async function requestPermission(): Promise<Result<PermissionState, BrowserError>> {
  return getDefaultNotifications().requestPermission()
}

/**
 * Show a notification.
 */
export function showNotification(title: string, options?: NotificationOptions): Result<NotificationHandle, BrowserError> {
  return getDefaultNotifications().show(title, options)
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:notifications imports object.
 */
export function getBrowserNotificationsImports(config?: NotificationsConfig): Record<string, unknown> {
  let notifications: BrowserNotifications | null = null

  const getNotifications = (): BrowserNotifications => {
    if (!notifications) {
      notifications = config ? new BrowserNotifications(config) : getDefaultNotifications()
    }
    return notifications
  }

  return {
    'browser:notifications/notifications': {
      // Permissions
      'get-permission': () => getNotifications().getPermission(),
      'request-permission': () => getNotifications().requestPermission(),

      // Notifications
      show: (title: string, options?: NotificationOptions) => getNotifications().show(title, options),
      'read-events': (handle: NotificationHandle) => getNotifications().readEvents(handle),
      'poll-events': (handle: NotificationHandle) => getNotifications().pollEvents(handle),
      close: (handle: NotificationHandle) => getNotifications().close(handle),
      'close-all': () => getNotifications().closeAll(),
    },
  }
}
