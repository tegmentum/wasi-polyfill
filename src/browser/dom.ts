/**
 * browser:dom - DOM manipulation interface
 *
 * Provides a capability-scoped interface to DOM manipulation
 * with controlled access to document and element operations.
 *
 * Note: This interface only works on the main thread. Worker
 * contexts will receive WRONG_THREAD errors.
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
  unsafeAttributeReason,
} from './types.js'
import { isMainThread } from './runtime.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Handle to a DOM node.
 */
export type NodeHandle = number

/**
 * Handle to a DOM element.
 */
export type ElementHandle = number

/**
 * Handle to the document.
 */
export type DocumentHandle = number

/**
 * Node type enumeration.
 */
export enum NodeType {
  ELEMENT = 1,
  TEXT = 3,
  COMMENT = 8,
  DOCUMENT = 9,
  DOCUMENT_FRAGMENT = 11,
}

/**
 * Element info for serialization.
 */
export interface ElementInfo {
  /** Element tag name (lowercase) */
  tagName: string
  /** Element id attribute */
  id: string
  /** Element class list */
  classList: string[]
  /** Number of child nodes */
  childCount: number
}

/**
 * DOM configuration options.
 */
export interface DomOptions {
  /** Custom document (for testing) */
  document?: Document
  /** Whether to allow creating script elements (default: false) */
  allowScripts?: boolean
  /** Allowed tag names (default: all non-script) */
  allowedTags?: string[]
}

// =============================================================================
// Browser DOM
// =============================================================================

/**
 * Browser DOM manipulation implementation.
 *
 * Uses a handle-based system to reference DOM nodes, providing
 * a layer of indirection for security and resource management.
 */
export class BrowserDom {
  private doc: Document
  private allowScripts: boolean
  private allowedTags: Set<string> | null
  private handleCounter = 1
  private nodeToHandle = new WeakMap<Node, NodeHandle>()
  private handleToNode = new Map<NodeHandle, WeakRef<Node>>()
  private documentHandle: DocumentHandle = 0

  constructor(options: DomOptions = {}) {
    // Check main thread requirement
    if (!isMainThread() && typeof options.document === 'undefined') {
      throw new Error('BrowserDom can only be used on the main thread')
    }

    this.doc = options.document ?? globalThis.document
    this.allowScripts = options.allowScripts ?? false
    this.allowedTags = options.allowedTags ? new Set(options.allowedTags.map(t => t.toLowerCase())) : null
  }

  /**
   * Check if running on main thread.
   */
  private checkMainThread(): Result<void, BrowserError> {
    if (!isMainThread() && this.doc === globalThis.document) {
      return browserErr(
        BrowserErrorCode.WRONG_THREAD,
        'DOM operations can only be performed on the main thread'
      )
    }
    return ok(undefined)
  }

  /**
   * Get or create a handle for a node.
   */
  private getHandle(node: Node): NodeHandle {
    let handle = this.nodeToHandle.get(node)
    if (handle === undefined) {
      handle = this.handleCounter++
      this.nodeToHandle.set(node, handle)
      this.handleToNode.set(handle, new WeakRef(node))
    }
    return handle
  }

  /**
   * Get a node from its handle.
   */
  private getNode(handle: NodeHandle): Node | null {
    const ref = this.handleToNode.get(handle)
    if (!ref) return null
    const node = ref.deref()
    if (!node) {
      this.handleToNode.delete(handle)
      return null
    }
    return node
  }

  /**
   * Get an element from its handle.
   */
  private getElement(handle: ElementHandle): Element | null {
    const node = this.getNode(handle)
    if (node instanceof Element) {
      return node
    }
    return null
  }

  /**
   * Check if a tag name is allowed.
   */
  private isTagAllowed(tagName: string): boolean {
    const tag = tagName.toLowerCase()

    // Block script tags unless explicitly allowed
    if (tag === 'script' && !this.allowScripts) {
      return false
    }

    // If allowlist is set, check it
    if (this.allowedTags !== null) {
      return this.allowedTags.has(tag)
    }

    return true
  }

  // ===========================================================================
  // Document Operations
  // ===========================================================================

  /**
   * Get the document handle.
   */
  getDocument(): Result<DocumentHandle, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    return ok(this.documentHandle)
  }

  /**
   * Query for an element using a CSS selector.
   */
  querySelector(selector: string): Result<ElementHandle | null, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    try {
      const element = this.doc.querySelector(selector)
      if (!element) {
        return ok(null)
      }
      return ok(this.getHandle(element))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Query for all elements matching a CSS selector.
   */
  querySelectorAll(selector: string): Result<ElementHandle[], BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    try {
      const elements = this.doc.querySelectorAll(selector)
      const handles: ElementHandle[] = []
      elements.forEach(el => handles.push(this.getHandle(el)))
      return ok(handles)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get an element by its ID.
   */
  getElementById(id: string): Result<ElementHandle | null, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.doc.getElementById(id)
    if (!element) {
      return ok(null)
    }
    return ok(this.getHandle(element))
  }

  /**
   * Create a new element.
   */
  createElement(tagName: string): Result<ElementHandle, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    if (!this.isTagAllowed(tagName)) {
      return browserErr(
        BrowserErrorCode.DENIED,
        `Creating '${tagName}' elements is not allowed`
      )
    }

    try {
      const element = this.doc.createElement(tagName)
      return ok(this.getHandle(element))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Create a text node.
   */
  createTextNode(text: string): Result<NodeHandle, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const node = this.doc.createTextNode(text)
    return ok(this.getHandle(node))
  }

  // ===========================================================================
  // Element Operations
  // ===========================================================================

  /**
   * Get element info.
   */
  getElementInfo(handle: ElementHandle): Result<ElementInfo | null, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return ok(null)
    }

    return ok({
      tagName: element.tagName.toLowerCase(),
      id: element.id,
      classList: Array.from(element.classList),
      childCount: element.childNodes.length,
    })
  }

  /**
   * Get an attribute value.
   */
  getAttribute(handle: ElementHandle, name: string): Result<string | null, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    return ok(element.getAttribute(name))
  }

  /**
   * Set an attribute value.
   */
  setAttribute(handle: ElementHandle, name: string, value: string): Result<void, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    // Block event handlers, srcdoc, and javascript:/data: URLs in URL attributes.
    const unsafe = unsafeAttributeReason(name, value)
    if (unsafe) {
      return browserErr(BrowserErrorCode.DENIED, unsafe)
    }

    try {
      element.setAttribute(name, value)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Remove an attribute.
   */
  removeAttribute(handle: ElementHandle, name: string): Result<void, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    element.removeAttribute(name)
    return ok(undefined)
  }

  /**
   * Check if element has an attribute.
   */
  hasAttribute(handle: ElementHandle, name: string): Result<boolean, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    return ok(element.hasAttribute(name))
  }

  /**
   * Get text content.
   */
  getTextContent(handle: NodeHandle): Result<string | null, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const node = this.getNode(handle)
    if (!node) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Node not found')
    }

    return ok(node.textContent)
  }

  /**
   * Set text content.
   */
  setTextContent(handle: NodeHandle, text: string): Result<void, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const node = this.getNode(handle)
    if (!node) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Node not found')
    }

    node.textContent = text
    return ok(undefined)
  }

  // ===========================================================================
  // Tree Operations
  // ===========================================================================

  /**
   * Append a child node.
   */
  appendChild(parentHandle: ElementHandle, childHandle: NodeHandle): Result<void, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const parent = this.getElement(parentHandle)
    if (!parent) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Parent element not found')
    }

    const child = this.getNode(childHandle)
    if (!child) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Child node not found')
    }

    try {
      parent.appendChild(child)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Insert a node before another.
   */
  insertBefore(
    parentHandle: ElementHandle,
    newNodeHandle: NodeHandle,
    referenceHandle: NodeHandle | null
  ): Result<void, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const parent = this.getElement(parentHandle)
    if (!parent) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Parent element not found')
    }

    const newNode = this.getNode(newNodeHandle)
    if (!newNode) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'New node not found')
    }

    const reference = referenceHandle !== null ? this.getNode(referenceHandle) : null

    try {
      parent.insertBefore(newNode, reference)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Remove a child node.
   */
  removeChild(parentHandle: ElementHandle, childHandle: NodeHandle): Result<void, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const parent = this.getElement(parentHandle)
    if (!parent) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Parent element not found')
    }

    const child = this.getNode(childHandle)
    if (!child) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Child node not found')
    }

    try {
      parent.removeChild(child)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Replace a child node.
   */
  replaceChild(
    parentHandle: ElementHandle,
    newChildHandle: NodeHandle,
    oldChildHandle: NodeHandle
  ): Result<void, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const parent = this.getElement(parentHandle)
    if (!parent) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Parent element not found')
    }

    const newChild = this.getNode(newChildHandle)
    if (!newChild) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'New child node not found')
    }

    const oldChild = this.getNode(oldChildHandle)
    if (!oldChild) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Old child node not found')
    }

    try {
      parent.replaceChild(newChild, oldChild)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Clone a node.
   */
  cloneNode(handle: NodeHandle, deep: boolean): Result<NodeHandle, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const node = this.getNode(handle)
    if (!node) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Node not found')
    }

    const clone = node.cloneNode(deep)
    return ok(this.getHandle(clone))
  }

  /**
   * Get parent element.
   */
  getParentElement(handle: NodeHandle): Result<ElementHandle | null, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const node = this.getNode(handle)
    if (!node) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Node not found')
    }

    const parent = node.parentElement
    if (!parent) {
      return ok(null)
    }

    return ok(this.getHandle(parent))
  }

  /**
   * Get child nodes.
   */
  getChildNodes(handle: ElementHandle): Result<NodeHandle[], BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    const handles: NodeHandle[] = []
    element.childNodes.forEach(node => handles.push(this.getHandle(node)))
    return ok(handles)
  }

  /**
   * Get children elements.
   */
  getChildren(handle: ElementHandle): Result<ElementHandle[], BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    const handles: ElementHandle[] = []
    for (const child of element.children) {
      handles.push(this.getHandle(child))
    }
    return ok(handles)
  }

  // ===========================================================================
  // Class List Operations
  // ===========================================================================

  /**
   * Add a class to an element.
   */
  addClass(handle: ElementHandle, className: string): Result<void, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    element.classList.add(className)
    return ok(undefined)
  }

  /**
   * Remove a class from an element.
   */
  removeClass(handle: ElementHandle, className: string): Result<void, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    element.classList.remove(className)
    return ok(undefined)
  }

  /**
   * Toggle a class on an element.
   */
  toggleClass(handle: ElementHandle, className: string, force?: boolean): Result<boolean, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    const result = force !== undefined
      ? element.classList.toggle(className, force)
      : element.classList.toggle(className)
    return ok(result)
  }

  /**
   * Check if element has a class.
   */
  hasClass(handle: ElementHandle, className: string): Result<boolean, BrowserError> {
    const threadCheck = this.checkMainThread()
    if (!threadCheck.ok) return threadCheck

    const element = this.getElement(handle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    return ok(element.classList.contains(className))
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Release a handle (optional cleanup).
   */
  releaseHandle(handle: NodeHandle): void {
    this.handleToNode.delete(handle)
  }

  /**
   * Get the raw node from a handle (for advanced use).
   */
  getRawNode(handle: NodeHandle): Node | null {
    return this.getNode(handle)
  }

  /**
   * Get the raw element from a handle (for advanced use).
   */
  getRawElement(handle: ElementHandle): Element | null {
    return this.getElement(handle)
  }

  /**
   * Get or create a handle for a raw node (for GC-enhanced tier).
   */
  getNodeHandle(node: Node): NodeHandle {
    return this.getHandle(node)
  }

  /**
   * Get or create a handle for a raw element (for GC-enhanced tier).
   */
  getElementHandle(element: Element): ElementHandle {
    return this.getHandle(element)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultDom: BrowserDom | null = null

/**
 * Get the default DOM instance.
 */
export function getDefaultDom(): BrowserDom {
  if (!defaultDom) {
    defaultDom = new BrowserDom()
  }
  return defaultDom
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:dom imports object.
 */
export function getBrowserDomImports(options?: DomOptions): Record<string, unknown> {
  // Lazy initialization - only create when imports are requested
  let dom: BrowserDom | null = null

  const getDom = (): BrowserDom => {
    if (!dom) {
      dom = options ? new BrowserDom(options) : getDefaultDom()
    }
    return dom
  }

  return {
    'browser:dom/dom': {
      // Document operations
      'get-document': () => getDom().getDocument(),
      'query-selector': (selector: string) => getDom().querySelector(selector),
      'query-selector-all': (selector: string) => getDom().querySelectorAll(selector),
      'get-element-by-id': (id: string) => getDom().getElementById(id),
      'create-element': (tagName: string) => getDom().createElement(tagName),
      'create-text-node': (text: string) => getDom().createTextNode(text),

      // Element operations
      'get-element-info': (handle: ElementHandle) => getDom().getElementInfo(handle),
      'get-attribute': (handle: ElementHandle, name: string) => getDom().getAttribute(handle, name),
      'set-attribute': (handle: ElementHandle, name: string, value: string) =>
        getDom().setAttribute(handle, name, value),
      'remove-attribute': (handle: ElementHandle, name: string) => getDom().removeAttribute(handle, name),
      'has-attribute': (handle: ElementHandle, name: string) => getDom().hasAttribute(handle, name),
      'get-text-content': (handle: NodeHandle) => getDom().getTextContent(handle),
      'set-text-content': (handle: NodeHandle, text: string) => getDom().setTextContent(handle, text),

      // Tree operations
      'append-child': (parent: ElementHandle, child: NodeHandle) => getDom().appendChild(parent, child),
      'insert-before': (parent: ElementHandle, newNode: NodeHandle, reference: NodeHandle | null) =>
        getDom().insertBefore(parent, newNode, reference),
      'remove-child': (parent: ElementHandle, child: NodeHandle) => getDom().removeChild(parent, child),
      'replace-child': (parent: ElementHandle, newChild: NodeHandle, oldChild: NodeHandle) =>
        getDom().replaceChild(parent, newChild, oldChild),
      'clone-node': (handle: NodeHandle, deep: boolean) => getDom().cloneNode(handle, deep),
      'get-parent-element': (handle: NodeHandle) => getDom().getParentElement(handle),
      'get-child-nodes': (handle: ElementHandle) => getDom().getChildNodes(handle),
      'get-children': (handle: ElementHandle) => getDom().getChildren(handle),

      // Class list operations
      'add-class': (handle: ElementHandle, className: string) => getDom().addClass(handle, className),
      'remove-class': (handle: ElementHandle, className: string) => getDom().removeClass(handle, className),
      'toggle-class': (handle: ElementHandle, className: string, force?: boolean) =>
        getDom().toggleClass(handle, className, force),
      'has-class': (handle: ElementHandle, className: string) => getDom().hasClass(handle, className),

      // Cleanup
      'release-handle': (handle: NodeHandle) => getDom().releaseHandle(handle),
    },
  }
}
