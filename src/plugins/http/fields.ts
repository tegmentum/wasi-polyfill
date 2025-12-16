/**
 * Fields resource for wasi:http/types
 *
 * Fields represents HTTP headers or trailers. It's a mutable multimap
 * from field names to field values.
 */

import type { HttpError } from './types.js'

/**
 * A single header field (name-value pair with bytes)
 */
export type FieldEntry = [string, Uint8Array]

/**
 * Fields resource representing HTTP headers or trailers
 */
export class Fields {
  private readonly entries: Map<string, Uint8Array[]> = new Map()
  private immutable = false

  /**
   * Create new empty fields
   */
  constructor(entries?: FieldEntry[]) {
    if (entries) {
      for (const [name, value] of entries) {
        this.append(name, value)
      }
    }
  }

  /**
   * Create a deep clone of these fields
   */
  clone(): Fields {
    const cloned = new Fields()
    for (const [name, values] of this.entries) {
      for (const value of values) {
        cloned.append(name, value.slice())
      }
    }
    return cloned
  }

  /**
   * Get all values for a field name
   */
  get(name: string): Uint8Array[] {
    const normalized = this.normalizeName(name)
    return this.entries.get(normalized)?.map((v) => v.slice()) ?? []
  }

  /**
   * Check if a field exists
   */
  has(name: string): boolean {
    const normalized = this.normalizeName(name)
    return this.entries.has(normalized)
  }

  /**
   * Set a field to a single value (replaces any existing values)
   */
  set(name: string, value: Uint8Array): HttpError | undefined {
    if (this.immutable) {
      return { tag: 'HTTP-request-header-size' }
    }

    const normalized = this.normalizeName(name)
    if (!this.isValidName(normalized)) {
      return { tag: 'HTTP-request-header-size' }
    }

    this.entries.set(normalized, [value.slice()])
    return undefined
  }

  /**
   * Append a value to a field (adds to existing values)
   */
  append(name: string, value: Uint8Array): HttpError | undefined {
    if (this.immutable) {
      return { tag: 'HTTP-request-header-size' }
    }

    const normalized = this.normalizeName(name)
    if (!this.isValidName(normalized)) {
      return { tag: 'HTTP-request-header-size' }
    }

    const existing = this.entries.get(normalized)
    if (existing) {
      existing.push(value.slice())
    } else {
      this.entries.set(normalized, [value.slice()])
    }
    return undefined
  }

  /**
   * Delete a field
   */
  delete(name: string): HttpError | undefined {
    if (this.immutable) {
      return { tag: 'HTTP-request-header-size' }
    }

    const normalized = this.normalizeName(name)
    this.entries.delete(normalized)
    return undefined
  }

  /**
   * Get all field entries
   */
  getEntries(): FieldEntry[] {
    const result: FieldEntry[] = []
    for (const [name, values] of this.entries) {
      for (const value of values) {
        result.push([name, value.slice()])
      }
    }
    return result
  }

  /**
   * Get all field names
   */
  getNames(): string[] {
    return Array.from(this.entries.keys())
  }

  /**
   * Make this fields object immutable
   */
  freeze(): void {
    this.immutable = true
  }

  /**
   * Check if this fields object is immutable
   */
  isFrozen(): boolean {
    return this.immutable
  }

  /**
   * Convert to a Headers object (for Fetch API)
   */
  toHeaders(): Headers {
    const headers = new Headers()
    for (const [name, values] of this.entries) {
      for (const value of values) {
        headers.append(name, new TextDecoder().decode(value))
      }
    }
    return headers
  }

  /**
   * Create from a Headers object
   */
  static fromHeaders(headers: Headers): Fields {
    const fields = new Fields()
    headers.forEach((value, name) => {
      fields.append(name, new TextEncoder().encode(value))
    })
    return fields
  }

  /**
   * Normalize a header name (lowercase for HTTP/2+ compatibility)
   */
  private normalizeName(name: string): string {
    return name.toLowerCase()
  }

  /**
   * Validate a header name according to HTTP specs
   */
  private isValidName(name: string): boolean {
    if (name.length === 0) {
      return false
    }
    // Header names must be valid tokens (ASCII, no spaces, no special chars)
    return /^[\x21-\x7e]+$/.test(name) && !/[\s\x00-\x1f\x7f():;<=>?@[\\\]{}]/.test(name)
  }
}

/**
 * Registry for Fields resources
 */
export class FieldsRegistry {
  private nextHandle = 1
  private readonly fields: Map<number, Fields> = new Map()

  /**
   * Register a fields object and return its handle
   */
  register(fields: Fields): number {
    const handle = this.nextHandle++
    this.fields.set(handle, fields)
    return handle
  }

  /**
   * Get fields by handle
   */
  get(handle: number): Fields | undefined {
    return this.fields.get(handle)
  }

  /**
   * Drop (destroy) fields
   */
  drop(handle: number): boolean {
    return this.fields.delete(handle)
  }

  /**
   * Clear all fields
   */
  clear(): void {
    this.fields.clear()
  }

  /**
   * Get the number of active fields objects
   */
  get size(): number {
    return this.fields.size
  }
}

/**
 * Global fields registry
 */
export const globalFieldsRegistry = new FieldsRegistry()
