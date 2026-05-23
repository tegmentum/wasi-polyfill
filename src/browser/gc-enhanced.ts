/**
 * browser:gc-enhanced - wasmGC-optimized DOM and events tier
 *
 * Provides externref-based access to DOM nodes and events for
 * wasmGC-enabled components. This tier allows components to hold
 * direct references to JavaScript objects in their GC memory,
 * avoiding handle table round-trips.
 *
 * Note: This is an experimental/unstable API that requires wasmGC support.
 * The baseline browser:dom and browser:events interfaces are always available.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  browserErr,
  type Result,
  ok,
  mapMouseEvent,
  mapKeyboardEvent,
  unsafeAttributeReason,
} from './types.js'
import { isWasmGcEnabled, supports, isMainThread } from './runtime.js'
import { type NodeHandle, type ElementHandle, getDefaultDom } from './dom.js'
import { type SubscriptionHandle, getDefaultEvents } from './events.js'

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Safely access a dynamic property on an object.
 * This is used for on-demand property queries where the property name
 * is provided at runtime.
 */
function getPropertyValue(obj: object, property: string): unknown {
  // Use Object.prototype.hasOwnProperty to check first, then access via indexing
  // This is safe because we've already validated obj is a known type (Node/Element/Event)
  return (obj as Record<string, unknown>)[property]
}

// =============================================================================
// Types
// =============================================================================

/**
 * A direct reference to a DOM Node (externref in Wasm).
 * In JavaScript, this is the actual Node object.
 */
export type NodeRef = Node

/**
 * A direct reference to a DOM Element (externref in Wasm).
 * In JavaScript, this is the actual Element object.
 */
export type ElementRef = Element

/**
 * A direct reference to a DOM Event (externref in Wasm).
 * In JavaScript, this is the actual Event object.
 */
export type EventRef = Event

/**
 * Event property value that can be returned from on-demand queries.
 */
export type EventPropertyValue =
  | { type: 'null' }
  | { type: 'undefined' }
  | { type: 'boolean'; value: boolean }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'object' }  // Complex object, use typed accessor

/**
 * GC-enhanced options.
 */
export interface GcEnhancedOptions {
  /** Allow operations even without wasmGC (for testing) */
  allowWithoutGc?: boolean
}

// =============================================================================
// GC-Enhanced DOM
// =============================================================================

/**
 * GC-enhanced DOM implementation.
 *
 * Provides direct externref access to DOM nodes for wasmGC-enabled components.
 */
export class GcEnhancedDom {
  private allowWithoutGc: boolean

  constructor(options: GcEnhancedOptions = {}) {
    this.allowWithoutGc = options.allowWithoutGc ?? false
  }

  /**
   * Check GC requirements.
   */
  private checkRequirements(): Result<void, BrowserError> {
    if (!isMainThread()) {
      return browserErr(
        BrowserErrorCode.WRONG_THREAD,
        'DOM access requires main thread'
      )
    }

    if (!this.allowWithoutGc && !isWasmGcEnabled()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'GC-enhanced DOM requires wasmGC support'
      )
    }

    return ok(undefined)
  }

  /**
   * Get the raw Node reference from a handle.
   * This allows wasmGC components to store the externref directly.
   */
  getNodeRef(handle: NodeHandle): Result<NodeRef | null, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    const dom = getDefaultDom()
    const node = dom.getRawNode(handle)
    return ok(node)
  }

  /**
   * Get the raw Element reference from a handle.
   */
  getElementRef(handle: ElementHandle): Result<ElementRef | null, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    const dom = getDefaultDom()
    const element = dom.getRawElement(handle)
    return ok(element)
  }

  /**
   * Create a node handle from a raw reference.
   * This allows wasmGC components to convert their externref back to handles.
   */
  createNodeHandle(ref: NodeRef): Result<NodeHandle, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Node)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Node'
      )
    }

    const dom = getDefaultDom()
    return ok(dom.getNodeHandle(ref))
  }

  /**
   * Create an element handle from a raw reference.
   */
  createElementHandle(ref: ElementRef): Result<ElementHandle, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Element)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Element'
      )
    }

    const dom = getDefaultDom()
    return ok(dom.getElementHandle(ref))
  }

  /**
   * Query a property from a node reference on-demand.
   * This avoids pre-serializing all properties.
   */
  queryNodeProperty(ref: NodeRef, property: string): Result<EventPropertyValue, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Node)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Node'
      )
    }

    try {
      const value = getPropertyValue(ref, property)
      return ok(this.wrapValue(value))
    } catch {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Cannot access property: ${property}`
      )
    }
  }

  /**
   * Query a property from an element reference.
   */
  queryElementProperty(ref: ElementRef, property: string): Result<EventPropertyValue, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Element)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Element'
      )
    }

    try {
      const value = getPropertyValue(ref, property)
      return ok(this.wrapValue(value))
    } catch {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Cannot access property: ${property}`
      )
    }
  }

  /**
   * Get an attribute from an element reference.
   */
  getElementAttribute(ref: ElementRef, name: string): Result<string | null, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Element)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Element'
      )
    }

    return ok(ref.getAttribute(name))
  }

  /**
   * Set an attribute on an element reference.
   */
  setElementAttribute(ref: ElementRef, name: string, value: string): Result<void, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Element)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Element'
      )
    }

    // Security: block event handlers, srcdoc, and javascript:/data: URLs.
    const unsafe = unsafeAttributeReason(name, value)
    if (unsafe) {
      return browserErr(BrowserErrorCode.DENIED, unsafe)
    }

    ref.setAttribute(name, value)
    return ok(undefined)
  }

  /**
   * Query children of a node reference.
   */
  getChildNodes(ref: NodeRef): Result<NodeRef[], BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Node)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Node'
      )
    }

    return ok(Array.from(ref.childNodes))
  }

  /**
   * Query child elements of an element reference.
   */
  getChildren(ref: ElementRef): Result<ElementRef[], BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Element)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Element'
      )
    }

    return ok(Array.from(ref.children))
  }

  /**
   * Get parent node reference.
   */
  getParentNode(ref: NodeRef): Result<NodeRef | null, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Node)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Node'
      )
    }

    return ok(ref.parentNode)
  }

  /**
   * Get parent element reference.
   */
  getParentElement(ref: NodeRef): Result<ElementRef | null, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Node)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Node'
      )
    }

    return ok(ref.parentElement)
  }

  /**
   * Wrap a JavaScript value for cross-boundary transfer.
   */
  private wrapValue(value: unknown): EventPropertyValue {
    if (value === null) {
      return { type: 'null' }
    }
    if (value === undefined) {
      return { type: 'undefined' }
    }
    if (typeof value === 'boolean') {
      return { type: 'boolean', value }
    }
    if (typeof value === 'number') {
      return { type: 'number', value }
    }
    if (typeof value === 'string') {
      return { type: 'string', value }
    }
    return { type: 'object' }
  }
}

// =============================================================================
// GC-Enhanced Events
// =============================================================================

/**
 * GC-enhanced events implementation.
 *
 * Provides direct externref access to events for wasmGC-enabled components.
 */
export class GcEnhancedEvents {
  private allowWithoutGc: boolean

  constructor(options: GcEnhancedOptions = {}) {
    this.allowWithoutGc = options.allowWithoutGc ?? false
  }

  /**
   * Check GC requirements.
   */
  private checkRequirements(): Result<void, BrowserError> {
    if (!this.allowWithoutGc && !isWasmGcEnabled()) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'GC-enhanced events requires wasmGC support'
      )
    }

    return ok(undefined)
  }

  /**
   * Read raw event references from a subscription.
   * Returns the actual Event objects for on-demand property access.
   *
   * Note: This currently returns an empty array as the base events system
   * serializes events to EventData. Full GC-enhanced event streaming requires
   * deeper integration with the events system to preserve raw Event objects.
   * Use queryEventProperty() and related methods with Event references
   * obtained through other means (e.g., direct DOM event listeners).
   */
  async readEventRefs(handle: SubscriptionHandle): Promise<Result<EventRef[], BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    // Get events from the base events system to verify subscription exists
    const events = getDefaultEvents()
    const result = await events.read(handle)

    if (result.status === 'error') {
      return { ok: false, error: result.error }
    }

    // The base system returns serialized EventData, not raw Event objects.
    // For true GC-enhanced event streaming, the events system would need
    // to maintain a parallel queue of raw Event references.
    // This is a limitation of the current implementation.

    // Return empty array - callers should use direct DOM listeners
    // and pass the Event reference to query methods instead.
    return ok([])
  }

  /**
   * Query a property from an event reference on-demand.
   */
  queryEventProperty(ref: EventRef, property: string): Result<EventPropertyValue, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Event)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Event'
      )
    }

    try {
      const value = getPropertyValue(ref, property)
      return ok(this.wrapValue(value))
    } catch {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Cannot access property: ${property}`
      )
    }
  }

  /**
   * Get the event type.
   */
  getEventType(ref: EventRef): Result<string, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Event)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Event'
      )
    }

    return ok(ref.type)
  }

  /**
   * Get the event target as an element reference.
   */
  getEventTarget(ref: EventRef): Result<ElementRef | null, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Event)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Event'
      )
    }

    const target = ref.target
    if (target instanceof Element) {
      return ok(target)
    }
    return ok(null)
  }

  /**
   * Get the current target as an element reference.
   */
  getCurrentTarget(ref: EventRef): Result<ElementRef | null, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Event)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Event'
      )
    }

    const target = ref.currentTarget
    if (target instanceof Element) {
      return ok(target)
    }
    return ok(null)
  }

  /**
   * Check if event is a MouseEvent and get mouse data.
   */
  getMouseEventData(ref: EventRef): Result<ReturnType<typeof mapMouseEvent> | null, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Event)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Event'
      )
    }

    if (ref instanceof MouseEvent) {
      return ok(mapMouseEvent(ref))
    }
    return ok(null)
  }

  /**
   * Check if event is a KeyboardEvent and get keyboard data.
   */
  getKeyboardEventData(ref: EventRef): Result<ReturnType<typeof mapKeyboardEvent> | null, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Event)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Event'
      )
    }

    if (ref instanceof KeyboardEvent) {
      return ok(mapKeyboardEvent(ref))
    }
    return ok(null)
  }

  /**
   * Prevent default behavior on an event.
   */
  preventDefault(ref: EventRef): Result<void, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Event)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Event'
      )
    }

    ref.preventDefault()
    return ok(undefined)
  }

  /**
   * Stop event propagation.
   */
  stopPropagation(ref: EventRef): Result<void, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Event)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Event'
      )
    }

    ref.stopPropagation()
    return ok(undefined)
  }

  /**
   * Stop immediate propagation.
   */
  stopImmediatePropagation(ref: EventRef): Result<void, BrowserError> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!(ref instanceof Event)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        'Reference is not a valid Event'
      )
    }

    ref.stopImmediatePropagation()
    return ok(undefined)
  }

  /**
   * Wrap a JavaScript value for cross-boundary transfer.
   */
  private wrapValue(value: unknown): EventPropertyValue {
    if (value === null) {
      return { type: 'null' }
    }
    if (value === undefined) {
      return { type: 'undefined' }
    }
    if (typeof value === 'boolean') {
      return { type: 'boolean', value }
    }
    if (typeof value === 'number') {
      return { type: 'number', value }
    }
    if (typeof value === 'string') {
      return { type: 'string', value }
    }
    return { type: 'object' }
  }
}

// =============================================================================
// Default Instances
// =============================================================================

let defaultGcDom: GcEnhancedDom | null = null
let defaultGcEvents: GcEnhancedEvents | null = null

/**
 * Get the default GC-enhanced DOM instance.
 */
export function getDefaultGcDom(): GcEnhancedDom {
  if (!defaultGcDom) {
    defaultGcDom = new GcEnhancedDom()
  }
  return defaultGcDom
}

/**
 * Get the default GC-enhanced events instance.
 */
export function getDefaultGcEvents(): GcEnhancedEvents {
  if (!defaultGcEvents) {
    defaultGcEvents = new GcEnhancedEvents()
  }
  return defaultGcEvents
}

// =============================================================================
// Feature Detection
// =============================================================================

/**
 * Check if GC-enhanced DOM is available.
 */
export function supportsGcDom(): boolean {
  return isWasmGcEnabled() && isMainThread() && supports('browser:dom')
}

/**
 * Check if GC-enhanced events is available.
 */
export function supportsGcEvents(): boolean {
  return isWasmGcEnabled() && supports('browser:events')
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:gc-enhanced imports object.
 */
export function getBrowserGcEnhancedImports(
  options?: GcEnhancedOptions
): Record<string, unknown> {
  let gcDom: GcEnhancedDom | null = null
  let gcEvents: GcEnhancedEvents | null = null

  const getGcDom = (): GcEnhancedDom => {
    if (!gcDom) {
      gcDom = options ? new GcEnhancedDom(options) : getDefaultGcDom()
    }
    return gcDom
  }

  const getGcEvents = (): GcEnhancedEvents => {
    if (!gcEvents) {
      gcEvents = options ? new GcEnhancedEvents(options) : getDefaultGcEvents()
    }
    return gcEvents
  }

  return {
    'browser:gc-enhanced/dom': {
      // Feature detection
      'is-available': supportsGcDom,

      // Handle to ref conversion
      'get-node-ref': (handle: NodeHandle) => getGcDom().getNodeRef(handle),
      'get-element-ref': (handle: ElementHandle) => getGcDom().getElementRef(handle),

      // Ref to handle conversion
      'create-node-handle': (ref: NodeRef) => getGcDom().createNodeHandle(ref),
      'create-element-handle': (ref: ElementRef) => getGcDom().createElementHandle(ref),

      // On-demand property access
      'query-node-property': (ref: NodeRef, prop: string) =>
        getGcDom().queryNodeProperty(ref, prop),
      'query-element-property': (ref: ElementRef, prop: string) =>
        getGcDom().queryElementProperty(ref, prop),

      // Attribute access
      'get-attribute': (ref: ElementRef, name: string) =>
        getGcDom().getElementAttribute(ref, name),
      'set-attribute': (ref: ElementRef, name: string, value: string) =>
        getGcDom().setElementAttribute(ref, name, value),

      // Tree traversal
      'get-child-nodes': (ref: NodeRef) => getGcDom().getChildNodes(ref),
      'get-children': (ref: ElementRef) => getGcDom().getChildren(ref),
      'get-parent-node': (ref: NodeRef) => getGcDom().getParentNode(ref),
      'get-parent-element': (ref: NodeRef) => getGcDom().getParentElement(ref),
    },

    'browser:gc-enhanced/events': {
      // Feature detection
      'is-available': supportsGcEvents,

      // Event ref reading
      'read-event-refs': (handle: SubscriptionHandle) =>
        getGcEvents().readEventRefs(handle),

      // On-demand property access
      'query-property': (ref: EventRef, prop: string) =>
        getGcEvents().queryEventProperty(ref, prop),

      // Typed accessors
      'get-type': (ref: EventRef) => getGcEvents().getEventType(ref),
      'get-target': (ref: EventRef) => getGcEvents().getEventTarget(ref),
      'get-current-target': (ref: EventRef) => getGcEvents().getCurrentTarget(ref),
      'get-mouse-data': (ref: EventRef) => getGcEvents().getMouseEventData(ref),
      'get-keyboard-data': (ref: EventRef) => getGcEvents().getKeyboardEventData(ref),

      // Event control
      'prevent-default': (ref: EventRef) => getGcEvents().preventDefault(ref),
      'stop-propagation': (ref: EventRef) => getGcEvents().stopPropagation(ref),
      'stop-immediate-propagation': (ref: EventRef) =>
        getGcEvents().stopImmediatePropagation(ref),
    },
  }
}
