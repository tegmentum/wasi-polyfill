/**
 * browser:broadcast-channel - Cross-tab communication interface
 *
 * Provides a capability-scoped interface to the BroadcastChannel API
 * for communication between browsing contexts (tabs, windows, iframes).
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  type Result,
  ok,
  browserErr,
} from './types.js'

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle to a broadcast channel.
 */
export type ChannelHandle = number

// =============================================================================
// Message Types
// =============================================================================

/**
 * Message received from a broadcast channel.
 */
export interface BroadcastMessage {
  /** The message data */
  data: unknown
  /** Timestamp when the message was received */
  timestamp: number
  /** Origin of the sender (same-origin only) */
  origin: string
}

/**
 * Channel information.
 */
export interface ChannelInfo {
  /** The handle for this channel */
  handle: ChannelHandle
  /** The channel name */
  name: string
  /** Number of queued messages */
  queuedMessages: number
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the BroadcastChannel manager.
 */
export interface BroadcastChannelOptions {
  /** Maximum channels that can be created (default: 20) */
  maxChannels?: number
  /** Maximum messages to queue per channel (default: 100) */
  messageQueueSize?: number
  /** Allowed channel name patterns (security) */
  allowedChannelNames?: string[]
}

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Internal channel entry.
 */
interface ChannelEntry {
  channel: globalThis.BroadcastChannel
  name: string
  messages: BroadcastMessage[]
}

// =============================================================================
// Browser Broadcast Channel Manager
// =============================================================================

/**
 * Browser BroadcastChannel implementation.
 *
 * Manages broadcast channels with handle-based access suitable
 * for use across the WASM boundary.
 */
export class BrowserBroadcastChannel {
  private nextHandle = 1
  private channels = new Map<ChannelHandle, ChannelEntry>()
  private maxChannels: number
  private messageQueueSize: number
  private allowedChannelNames: string[] | null

  constructor(options: BroadcastChannelOptions = {}) {
    this.maxChannels = options.maxChannels ?? 20
    this.messageQueueSize = options.messageQueueSize ?? 100
    this.allowedChannelNames = options.allowedChannelNames ?? null
  }

  /**
   * Check if BroadcastChannel is supported in this environment.
   */
  isSupported(): boolean {
    return typeof BroadcastChannel !== 'undefined'
  }

  /**
   * Check if a channel name is allowed.
   */
  private isChannelNameAllowed(name: string): boolean {
    if (this.allowedChannelNames === null) {
      return true
    }

    return this.allowedChannelNames.some(allowed => {
      if (allowed === '*') return true
      if (allowed.includes('*')) {
        // Simple wildcard matching
        const pattern = allowed.replace(/\*/g, '.*')
        return new RegExp(`^${pattern}$`).test(name)
      }
      return allowed === name
    })
  }

  /**
   * Create a new broadcast channel.
   *
   * @param name - The channel name
   * @returns Handle to the channel or error
   */
  create(name: string): Result<ChannelHandle, BrowserError> {
    if (!this.isSupported()) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'BroadcastChannel is not supported')
    }

    if (this.channels.size >= this.maxChannels) {
      return browserErr(
        BrowserErrorCode.BUSY,
        `Maximum channels (${this.maxChannels}) reached`
      )
    }

    if (!name || typeof name !== 'string') {
      return browserErr(BrowserErrorCode.INVALID_ARGUMENT, 'Channel name is required')
    }

    if (!this.isChannelNameAllowed(name)) {
      return browserErr(
        BrowserErrorCode.DENIED,
        `Channel name '${name}' is not allowed`
      )
    }

    const handle = this.nextHandle++
    let channel: globalThis.BroadcastChannel

    try {
      channel = new BroadcastChannel(name)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Failed to create channel: ${e instanceof Error ? e.message : String(e)}`
      )
    }

    const entry: ChannelEntry = {
      channel,
      name,
      messages: [],
    }

    this.channels.set(handle, entry)
    this.setupEventListeners(handle, entry)

    return ok(handle)
  }

  /**
   * Set up event listeners for a channel.
   */
  private setupEventListeners(_handle: ChannelHandle, entry: ChannelEntry): void {
    entry.channel.onmessage = (event) => {
      if (entry.messages.length >= this.messageQueueSize) {
        entry.messages.shift() // Drop oldest message
      }

      const message: BroadcastMessage = {
        data: event.data,
        timestamp: Date.now(),
        origin: event.origin || location.origin,
      }

      entry.messages.push(message)
    }

    entry.channel.onmessageerror = () => {
      // Message deserialization errors are typically logged but not queued
      console.warn(`BroadcastChannel ${entry.name}: message deserialization error`)
    }
  }

  /**
   * Post a message to a channel.
   *
   * @param handle - The channel handle
   * @param message - The message to post
   * @returns Success or error
   */
  postMessage(handle: ChannelHandle, message: unknown): Result<void, BrowserError> {
    const entry = this.channels.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `Channel ${handle} not found`)
    }

    try {
      entry.channel.postMessage(message)
      return ok(undefined)
    } catch (e) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Failed to post message: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /**
   * Read received messages from a channel.
   *
   * @param handle - The channel handle
   * @param maxCount - Maximum messages to return (default: all)
   * @returns Array of messages or error
   */
  readMessages(
    handle: ChannelHandle,
    maxCount?: number
  ): Result<BroadcastMessage[], BrowserError> {
    const entry = this.channels.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `Channel ${handle} not found`)
    }

    const count = maxCount !== undefined
      ? Math.min(maxCount, entry.messages.length)
      : entry.messages.length

    const messages = entry.messages.splice(0, count)
    return ok(messages)
  }

  /**
   * Get information about a channel.
   *
   * @param handle - The channel handle
   * @returns Channel info or error
   */
  getInfo(handle: ChannelHandle): Result<ChannelInfo, BrowserError> {
    const entry = this.channels.get(handle)
    if (!entry) {
      return browserErr(BrowserErrorCode.NOT_FOUND, `Channel ${handle} not found`)
    }

    return ok({
      handle,
      name: entry.name,
      queuedMessages: entry.messages.length,
    })
  }

  /**
   * Close a channel.
   *
   * @param handle - The channel handle
   * @returns Success or error
   */
  close(handle: ChannelHandle): Result<void, BrowserError> {
    const entry = this.channels.get(handle)
    if (!entry) {
      return ok(undefined) // Already closed
    }

    try {
      entry.channel.close()
    } catch {
      // Ignore close errors
    }

    this.channels.delete(handle)
    return ok(undefined)
  }

  /**
   * Get all active channel handles.
   */
  getChannels(): ChannelHandle[] {
    return Array.from(this.channels.keys())
  }

  /**
   * Get the number of active channels.
   */
  getChannelCount(): number {
    return this.channels.size
  }

  /**
   * Close all channels and clean up.
   */
  destroy(): void {
    for (const [handle] of this.channels) {
      this.close(handle)
    }
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultBroadcastChannel: BrowserBroadcastChannel | null = null

/**
 * Get the default BroadcastChannel manager instance.
 */
export function getDefaultBroadcastChannel(options?: BroadcastChannelOptions): BrowserBroadcastChannel {
  if (!defaultBroadcastChannel) {
    defaultBroadcastChannel = new BrowserBroadcastChannel(options)
  }
  return defaultBroadcastChannel
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Check if BroadcastChannel is supported.
 */
export function isBroadcastChannelSupported(): boolean {
  return getDefaultBroadcastChannel().isSupported()
}

/**
 * Create a broadcast channel.
 */
export function createChannel(name: string): Result<ChannelHandle, BrowserError> {
  return getDefaultBroadcastChannel().create(name)
}

/**
 * Post a message to a channel.
 */
export function postMessage(handle: ChannelHandle, message: unknown): Result<void, BrowserError> {
  return getDefaultBroadcastChannel().postMessage(handle, message)
}

/**
 * Read messages from a channel.
 */
export function readMessages(
  handle: ChannelHandle,
  maxCount?: number
): Result<BroadcastMessage[], BrowserError> {
  return getDefaultBroadcastChannel().readMessages(handle, maxCount)
}

/**
 * Close a channel.
 */
export function closeChannel(handle: ChannelHandle): Result<void, BrowserError> {
  return getDefaultBroadcastChannel().close(handle)
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:broadcast-channel imports object.
 */
export function getBrowserBroadcastChannelImports(
  options?: BroadcastChannelOptions
): Record<string, unknown> {
  const bc = options ? new BrowserBroadcastChannel(options) : getDefaultBroadcastChannel()

  return {
    'browser:broadcast-channel/broadcast-channel': {
      // Support check
      'is-supported': () => bc.isSupported(),

      // Channel management
      create: (name: string) => bc.create(name),
      close: (handle: ChannelHandle) => bc.close(handle),

      // Messaging
      'post-message': (handle: ChannelHandle, message: unknown) => bc.postMessage(handle, message),
      'read-messages': (handle: ChannelHandle, maxCount?: number) =>
        bc.readMessages(handle, maxCount),

      // Info
      'get-info': (handle: ChannelHandle) => bc.getInfo(handle),
      'get-channels': () => bc.getChannels(),
      'get-channel-count': () => bc.getChannelCount(),
    },
  }
}
