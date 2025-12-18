/**
 * browser:events - Event handling interface
 *
 * Provides a capability-scoped interface to DOM events
 * using a stream-based subscription model with backpressure.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  type Result,
  ok,
  browserErr,
  type BrowserEvent,
  type MouseEventData,
  type KeyboardEventData,
  mapMouseEvent,
  mapKeyboardEvent,
} from './types.js'
import { isMainThread } from './runtime.js'
import { type ElementHandle, BrowserDom, getDefaultDom } from './dom.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Subscription handle.
 */
export type SubscriptionHandle = number

/**
 * Event subscription options.
 */
export interface SubscribeOptions {
  /** Use capture phase (default: false) */
  capture?: boolean
  /** Only fire once then auto-unsubscribe (default: false) */
  once?: boolean
  /** Passive listener - won't call preventDefault (default: true for scroll/touch) */
  passive?: boolean
  /** Maximum queue size for backpressure (default: 100) */
  maxQueueSize?: number
}

/**
 * Event data returned from subscriptions.
 */
export interface EventData {
  /** Base event info */
  event: BrowserEvent
  /** Mouse event data (if applicable) */
  mouse?: MouseEventData
  /** Keyboard event data (if applicable) */
  keyboard?: KeyboardEventData
  /** Touch event data (if applicable) */
  touch?: TouchEventData
  /** Wheel event data (if applicable) */
  wheel?: WheelEventData
  /** Focus event data (if applicable) */
  focus?: FocusEventData
  /** Input event data (if applicable) */
  input?: InputEventData
}

/**
 * Touch point data.
 */
export interface TouchPoint {
  identifier: number
  clientX: number
  clientY: number
  pageX: number
  pageY: number
  radiusX: number
  radiusY: number
  force: number
}

/**
 * Touch event data.
 */
export interface TouchEventData extends BrowserEvent {
  touches: TouchPoint[]
  targetTouches: TouchPoint[]
  changedTouches: TouchPoint[]
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * Wheel event data.
 */
export interface WheelEventData extends BrowserEvent {
  deltaX: number
  deltaY: number
  deltaZ: number
  deltaMode: number
}

/**
 * Focus event data.
 */
export interface FocusEventData extends BrowserEvent {
  relatedTargetHandle: ElementHandle | null
}

/**
 * Input event data.
 */
export interface InputEventData extends BrowserEvent {
  data: string | null
  inputType: string
  isComposing: boolean
}

/**
 * Event stream read result.
 */
export type EventStreamResult =
  | { status: 'events'; events: EventData[] }
  | { status: 'end' }
  | { status: 'error'; error: BrowserError }

/**
 * Events configuration options.
 */
export interface EventsOptions {
  /** DOM instance to use */
  dom?: BrowserDom
  /** Default max queue size (default: 100) */
  defaultMaxQueueSize?: number
}

// =============================================================================
// Event Subscription
// =============================================================================

/**
 * Internal subscription state.
 */
interface SubscriptionState {
  handle: SubscriptionHandle
  target: EventTarget
  eventType: string
  listener: EventListener
  options: AddEventListenerOptions
  queue: EventData[]
  maxQueueSize: number
  droppedCount: number
  closed: boolean
  waitingResolvers: Array<(result: EventStreamResult) => void>
}

// =============================================================================
// Browser Events
// =============================================================================

/**
 * Browser events implementation.
 */
export class BrowserEvents {
  private dom: BrowserDom
  private defaultMaxQueueSize: number
  private subscriptionCounter = 1
  private subscriptions = new Map<SubscriptionHandle, SubscriptionState>()

  constructor(options: EventsOptions = {}) {
    this.dom = options.dom ?? getDefaultDom()
    this.defaultMaxQueueSize = options.defaultMaxQueueSize ?? 100
  }

  /**
   * Check if running on main thread.
   */
  private checkMainThread(): Result<void, BrowserError> {
    if (!isMainThread()) {
      return browserErr(
        BrowserErrorCode.WRONG_THREAD,
        'Event subscriptions can only be created on the main thread'
      )
    }
    return ok(undefined)
  }

  /**
   * Convert a native event to EventData.
   */
  private eventToData(event: Event, droppedCount: number): EventData {
    const base: BrowserEvent = {
      type: event.type,
      timeStamp: event.timeStamp,
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      droppedCount,
    }

    const data: EventData = { event: base }

    // Add typed event data based on event type
    if (event instanceof MouseEvent) {
      data.mouse = mapMouseEvent(event, droppedCount)
    }

    if (event instanceof KeyboardEvent) {
      data.keyboard = mapKeyboardEvent(event, droppedCount)
    }

    if (event instanceof WheelEvent) {
      data.wheel = {
        ...base,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
      }
    }

    if (event instanceof TouchEvent) {
      data.touch = {
        ...base,
        touches: this.mapTouches(event.touches),
        targetTouches: this.mapTouches(event.targetTouches),
        changedTouches: this.mapTouches(event.changedTouches),
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      }
    }

    if (event instanceof FocusEvent) {
      data.focus = {
        ...base,
        relatedTargetHandle: event.relatedTarget instanceof Element
          ? this.dom.getRawElement(0) !== null ? 0 : null // Would need proper handle lookup
          : null,
      }
    }

    if (event instanceof InputEvent) {
      data.input = {
        ...base,
        data: event.data,
        inputType: event.inputType,
        isComposing: event.isComposing,
      }
    }

    return data
  }

  /**
   * Map TouchList to array of TouchPoint.
   */
  private mapTouches(touches: TouchList): TouchPoint[] {
    const result: TouchPoint[] = []
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i]!
      result.push({
        identifier: touch.identifier,
        clientX: touch.clientX,
        clientY: touch.clientY,
        pageX: touch.pageX,
        pageY: touch.pageY,
        radiusX: touch.radiusX,
        radiusY: touch.radiusY,
        force: touch.force,
      })
    }
    return result
  }

  /**
   * Subscribe to events on the document.
   */
  subscribeDocument(
    eventType: string,
    options?: SubscribeOptions
  ): Result<SubscriptionHandle, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    return this.subscribeTarget(document, eventType, options)
  }

  /**
   * Subscribe to events on the window.
   */
  subscribeWindow(
    eventType: string,
    options?: SubscribeOptions
  ): Result<SubscriptionHandle, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    return this.subscribeTarget(window, eventType, options)
  }

  /**
   * Subscribe to events on an element.
   */
  subscribeElement(
    elementHandle: ElementHandle,
    eventType: string,
    options?: SubscribeOptions
  ): Result<SubscriptionHandle, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.dom.getRawElement(elementHandle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    return this.subscribeTarget(element, eventType, options)
  }

  /**
   * Internal: subscribe to events on a target.
   */
  private subscribeTarget(
    target: EventTarget,
    eventType: string,
    options?: SubscribeOptions
  ): Result<SubscriptionHandle, BrowserError> {
    const handle = this.subscriptionCounter++
    const maxQueueSize = options?.maxQueueSize ?? this.defaultMaxQueueSize

    // Determine passive default based on event type
    const isScrollOrTouch = ['scroll', 'wheel', 'touchstart', 'touchmove'].includes(eventType)
    const passive = options?.passive ?? isScrollOrTouch

    const state: SubscriptionState = {
      handle,
      target,
      eventType,
      listener: () => {}, // Will be set below
      options: {
        capture: options?.capture ?? false,
        once: options?.once ?? false,
        passive,
      },
      queue: [],
      maxQueueSize,
      droppedCount: 0,
      closed: false,
      waitingResolvers: [],
    }

    // Create the actual listener
    state.listener = (event: Event) => {
      if (state.closed) return

      // Handle backpressure - drop oldest events
      if (state.queue.length >= state.maxQueueSize) {
        state.queue.shift()
        state.droppedCount++
      }

      const eventData = this.eventToData(event, state.droppedCount)
      state.droppedCount = 0 // Reset after including in event

      // If there are waiting resolvers, deliver immediately
      if (state.waitingResolvers.length > 0) {
        const resolver = state.waitingResolvers.shift()!
        resolver({ status: 'events', events: [eventData] })
      } else {
        state.queue.push(eventData)
      }

      // Handle once option
      if (options?.once) {
        this.unsubscribe(handle)
      }
    }

    target.addEventListener(eventType, state.listener, state.options)
    this.subscriptions.set(handle, state)

    return ok(handle)
  }

  /**
   * Read events from a subscription.
   *
   * Returns immediately if events are queued, otherwise waits
   * for the next event.
   */
  async read(handle: SubscriptionHandle): Promise<EventStreamResult> {
    const state = this.subscriptions.get(handle)
    if (!state) {
      return { status: 'error', error: { code: BrowserErrorCode.NOT_FOUND, message: 'Subscription not found' } }
    }

    if (state.closed) {
      return { status: 'end' }
    }

    // Return queued events if available
    if (state.queue.length > 0) {
      const events = state.queue.splice(0)
      return { status: 'events', events }
    }

    // Wait for next event
    return new Promise<EventStreamResult>(resolve => {
      state.waitingResolvers.push(resolve)
    })
  }

  /**
   * Poll for events without waiting.
   */
  poll(handle: SubscriptionHandle): Result<EventData[], BrowserError> {
    const state = this.subscriptions.get(handle)
    if (!state) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Subscription not found')
    }

    if (state.closed) {
      return ok([])
    }

    const events = state.queue.splice(0)
    return ok(events)
  }

  /**
   * Unsubscribe from events.
   */
  unsubscribe(handle: SubscriptionHandle): Result<void, BrowserError> {
    const state = this.subscriptions.get(handle)
    if (!state) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Subscription not found')
    }

    // Remove event listener
    state.target.removeEventListener(state.eventType, state.listener, state.options)
    state.closed = true

    // Resolve any waiting readers with end
    for (const resolver of state.waitingResolvers) {
      resolver({ status: 'end' })
    }
    state.waitingResolvers = []

    this.subscriptions.delete(handle)
    return ok(undefined)
  }

  /**
   * Get subscription info.
   */
  getSubscriptionInfo(handle: SubscriptionHandle): Result<{
    eventType: string
    queueSize: number
    closed: boolean
  } | null, BrowserError> {
    const state = this.subscriptions.get(handle)
    if (!state) {
      return ok(null)
    }

    return ok({
      eventType: state.eventType,
      queueSize: state.queue.length,
      closed: state.closed,
    })
  }

  /**
   * Unsubscribe all subscriptions.
   */
  unsubscribeAll(): void {
    for (const handle of this.subscriptions.keys()) {
      this.unsubscribe(handle)
    }
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultEvents: BrowserEvents | null = null

/**
 * Get the default events instance.
 */
export function getDefaultEvents(): BrowserEvents {
  if (!defaultEvents) {
    defaultEvents = new BrowserEvents()
  }
  return defaultEvents
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Subscribe to document events.
 */
export function subscribeDocument(
  eventType: string,
  options?: SubscribeOptions
): Result<SubscriptionHandle, BrowserError> {
  return getDefaultEvents().subscribeDocument(eventType, options)
}

/**
 * Subscribe to window events.
 */
export function subscribeWindow(
  eventType: string,
  options?: SubscribeOptions
): Result<SubscriptionHandle, BrowserError> {
  return getDefaultEvents().subscribeWindow(eventType, options)
}

/**
 * Read events from a subscription.
 */
export async function readEvents(handle: SubscriptionHandle): Promise<EventStreamResult> {
  return getDefaultEvents().read(handle)
}

/**
 * Unsubscribe from events.
 */
export function unsubscribe(handle: SubscriptionHandle): Result<void, BrowserError> {
  return getDefaultEvents().unsubscribe(handle)
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:events imports object.
 */
export function getBrowserEventsImports(options?: EventsOptions): Record<string, unknown> {
  let events: BrowserEvents | null = null

  const getEvents = (): BrowserEvents => {
    if (!events) {
      events = options ? new BrowserEvents(options) : getDefaultEvents()
    }
    return events
  }

  return {
    'browser:events/events': {
      // Subscribe
      'subscribe-document': (eventType: string, options?: SubscribeOptions) =>
        getEvents().subscribeDocument(eventType, options),
      'subscribe-window': (eventType: string, options?: SubscribeOptions) =>
        getEvents().subscribeWindow(eventType, options),
      'subscribe-element': (handle: ElementHandle, eventType: string, options?: SubscribeOptions) =>
        getEvents().subscribeElement(handle, eventType, options),

      // Read
      read: (handle: SubscriptionHandle) => getEvents().read(handle),
      poll: (handle: SubscriptionHandle) => getEvents().poll(handle),

      // Unsubscribe
      unsubscribe: (handle: SubscriptionHandle) => getEvents().unsubscribe(handle),
      'unsubscribe-all': () => getEvents().unsubscribeAll(),

      // Info
      'get-subscription-info': (handle: SubscriptionHandle) => getEvents().getSubscriptionInfo(handle),
    },
  }
}
