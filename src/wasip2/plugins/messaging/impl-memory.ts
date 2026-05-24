/**
 * In-memory messaging implementation
 *
 * Provides an in-memory message broker for local message passing.
 * Supports both point-to-point (queue) and pub/sub (topic) patterns.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  type ChannelHandle,
  type SubscriptionHandle,
  type Message,
  type ReceivedMessage,
  type MessageMetadata,
  type ChannelOptions,
  type ChannelInfo,
  type SubscribeOptions,
  type SubscriptionInfo,
  type MessagingPluginConfig,
  ChannelType,
  AckAction,
  MessagingErrorCode,
  msgOk,
  msgErr,
} from './types.js'

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Internal channel structure.
 */
interface InternalChannel {
  name: string
  options: Required<ChannelOptions>
  messages: QueuedMessage[]
  subscriptions: Set<SubscriptionHandle>
}

/**
 * Queued message with delivery tracking.
 */
interface QueuedMessage {
  message: Message
  deliveryTag: number
  deliveredTo: Set<SubscriptionHandle>
  deliveryCount: number
  enqueuedAt: number
  /** Epoch ms after which the message has expired (undefined = no expiry). */
  expiresAt?: number
}

/** Whether a queued message has passed its TTL. */
function isExpired(msg: QueuedMessage): boolean {
  return msg.expiresAt !== undefined && Date.now() >= msg.expiresAt
}

/**
 * Internal subscription structure.
 */
interface InternalSubscription {
  handle: SubscriptionHandle
  channelName: string
  options: Required<SubscribeOptions>
  pending: QueuedMessage[]
  pendingAcks: Map<number, QueuedMessage>
}

// =============================================================================
// Memory Messaging Instance
// =============================================================================

/**
 * In-memory messaging plugin instance.
 */
class MemoryMessagingInstance implements PluginInstance {
  private channels = new Map<string, InternalChannel>()
  private channelHandles = new Map<ChannelHandle, string>()
  private subscriptions = new Map<SubscriptionHandle, InternalSubscription>()
  private nextChannelHandle = 1
  private nextSubscriptionHandle = 1
  private nextDeliveryTag = 1
  private config: Required<MessagingPluginConfig>

  constructor(config: MessagingPluginConfig) {
    this.config = {
      maxChannels: config.maxChannels ?? 100,
      maxSubscriptions: config.maxSubscriptions ?? 100,
      maxMessageSize: config.maxMessageSize ?? 1024 * 1024, // 1MB
      defaultTtl: config.defaultTtl ?? 0, // No expiry
      brokerUrl: config.brokerUrl ?? '',
    }
  }

  getImports(): Record<string, unknown> {
    return {
      // Channel management
      'create-channel': this.createChannel.bind(this),
      'open-channel': this.openChannel.bind(this),
      'delete-channel': this.deleteChannel.bind(this),
      'get-channel-info': this.getChannelInfo.bind(this),
      'list-channels': this.listChannels.bind(this),

      // Producer operations
      'send': this.send.bind(this),
      'publish': this.publish.bind(this),
      'request': this.request.bind(this),

      // Consumer operations
      'subscribe': this.subscribe.bind(this),
      'unsubscribe': this.unsubscribe.bind(this),
      'receive': this.receive.bind(this),
      'receive-batch': this.receiveBatch.bind(this),
      'acknowledge': this.acknowledge.bind(this),

      // Subscription management
      'get-subscription-info': this.getSubscriptionInfo.bind(this),
      'list-subscriptions': this.listSubscriptions.bind(this),

      // Utilities
      'purge-channel': this.purgeChannel.bind(this),
      'get-pending-count': this.getPendingCount.bind(this),
    }
  }

  destroy(): void {
    this.channels.clear()
    this.channelHandles.clear()
    this.subscriptions.clear()
  }

  // ===========================================================================
  // Channel Management
  // ===========================================================================

  private createChannel(name: string, options: ChannelOptions) {
    if (this.channels.has(name)) {
      return msgErr(MessagingErrorCode.ALREADY_EXISTS, `Channel '${name}' already exists`)
    }

    if (this.channels.size >= this.config.maxChannels) {
      return msgErr(MessagingErrorCode.QUEUE_FULL, `Maximum channels (${this.config.maxChannels}) reached`)
    }

    const channel: InternalChannel = {
      name,
      options: {
        type: options.type,
        durable: options.durable ?? false,
        maxMessages: options.maxMessages ?? 10000,
        maxMessageSize: options.maxMessageSize ?? this.config.maxMessageSize,
        defaultTtl: options.defaultTtl ?? this.config.defaultTtl,
      },
      messages: [],
      subscriptions: new Set(),
    }

    this.channels.set(name, channel)

    const handle = this.nextChannelHandle++
    this.channelHandles.set(handle, name)

    return msgOk(handle)
  }

  private openChannel(name: string) {
    const channel = this.channels.get(name)
    if (!channel) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Channel '${name}' not found`)
    }

    // Return existing handle or create new one
    const existingHandle = Array.from(this.channelHandles.entries()).find(([_, chName]) => chName === name)
    if (existingHandle) {
      return msgOk(existingHandle[0])
    }

    const handle = this.nextChannelHandle++
    this.channelHandles.set(handle, name)
    return msgOk(handle)
  }

  private deleteChannel(name: string) {
    const channel = this.channels.get(name)
    if (!channel) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Channel '${name}' not found`)
    }

    // Remove subscriptions
    Array.from(channel.subscriptions).forEach((subHandle) => {
      this.subscriptions.delete(subHandle)
    })

    // Remove channel handles
    Array.from(this.channelHandles.entries())
      .filter(([_, chName]) => chName === name)
      .forEach(([handle]) => this.channelHandles.delete(handle))

    this.channels.delete(name)
    return msgOk(undefined)
  }

  private getChannelInfo(name: string): ChannelInfo | null {
    const channel = this.channels.get(name)
    if (!channel) {
      return null
    }

    return {
      name: channel.name,
      type: channel.options.type,
      durable: channel.options.durable,
      messageCount: channel.messages.length,
      consumerCount: channel.subscriptions.size,
    }
  }

  private listChannels(): string[] {
    return Array.from(this.channels.keys())
  }

  // ===========================================================================
  // Producer Operations
  // ===========================================================================

  private send(channelName: string, message: Message) {
    const channel = this.channels.get(channelName)
    if (!channel) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Channel '${channelName}' not found`)
    }

    if (channel.options.type !== ChannelType.QUEUE) {
      return msgErr(MessagingErrorCode.INVALID_ARGUMENT, 'send() is for queue channels. Use publish() for topics.')
    }

    return this.enqueueMessage(channel, message)
  }

  private publish(topicName: string, message: Message) {
    const channel = this.channels.get(topicName)
    if (!channel) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Topic '${topicName}' not found`)
    }

    if (channel.options.type !== ChannelType.TOPIC) {
      return msgErr(MessagingErrorCode.INVALID_ARGUMENT, 'publish() is for topic channels. Use send() for queues.')
    }

    return this.enqueueMessage(channel, message)
  }

  private request(channelName: string, message: Message, _timeoutMs: number) {
    const channel = this.channels.get(channelName)
    if (!channel) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Channel '${channelName}' not found`)
    }

    // Generate correlation ID
    const correlationId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Create a temporary reply channel
    const replyChannelName = `reply-${correlationId}`
    const createResult = this.createChannel(replyChannelName, { type: ChannelType.QUEUE })
    if (!createResult.ok) {
      return createResult
    }

    // Add correlation and reply-to headers
    const requestMessage: Message = {
      payload: message.payload,
      metadata: {
        ...message.metadata,
        correlationId,
        replyTo: replyChannelName,
      },
    }

    // Send the request
    const sendResult = this.enqueueMessage(channel, requestMessage)
    if (!sendResult.ok) {
      this.deleteChannel(replyChannelName)
      return sendResult
    }

    // Return the correlation ID and reply channel for the caller to wait on
    return msgOk({ correlationId, replyChannel: replyChannelName })
  }

  private enqueueMessage(channel: InternalChannel, message: Message) {
    // Check message size
    if (message.payload.length > channel.options.maxMessageSize) {
      return msgErr(
        MessagingErrorCode.MESSAGE_TOO_LARGE,
        `Message size ${message.payload.length} exceeds limit ${channel.options.maxMessageSize}`
      )
    }

    // Check queue capacity
    if (channel.messages.length >= channel.options.maxMessages) {
      return msgErr(MessagingErrorCode.QUEUE_FULL, 'Channel is at capacity')
    }

    // Add message ID if not present
    const metadata: MessageMetadata = {
      ...message.metadata,
      id: message.metadata.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: message.metadata.timestamp ?? Date.now(),
    }

    // Resolve TTL: per-message ttl wins over the channel default. >0 => expiry.
    const now = Date.now()
    const ttl = metadata.ttl ?? channel.options.defaultTtl ?? 0
    const queuedMessage: QueuedMessage = {
      message: { payload: message.payload, metadata },
      deliveryTag: this.nextDeliveryTag++,
      deliveredTo: new Set(),
      deliveryCount: 0,
      enqueuedAt: now,
      ...(ttl > 0 ? { expiresAt: now + ttl } : {}),
    }

    channel.messages.push(queuedMessage)

    // Distribute to subscribers based on channel type
    if (channel.options.type === ChannelType.TOPIC) {
      // Pub/sub: deliver to all subscribers
      Array.from(channel.subscriptions).forEach((subHandle) => {
        const sub = this.subscriptions.get(subHandle)
        if (sub && !sub.options.noLocal) {
          this.deliverToSubscription(sub, queuedMessage)
        }
      })
    }

    return msgOk(metadata.id!)
  }

  private deliverToSubscription(sub: InternalSubscription, msg: QueuedMessage): void {
    if (isExpired(msg)) return
    if (sub.pending.length < sub.options.prefetchCount) {
      sub.pending.push(msg)
      msg.deliveredTo.add(sub.handle)
      msg.deliveryCount++
    }
  }

  // ===========================================================================
  // Consumer Operations
  // ===========================================================================

  private subscribe(channelName: string, options: SubscribeOptions) {
    const channel = this.channels.get(channelName)
    if (!channel) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Channel '${channelName}' not found`)
    }

    if (this.subscriptions.size >= this.config.maxSubscriptions) {
      return msgErr(MessagingErrorCode.QUEUE_FULL, `Maximum subscriptions (${this.config.maxSubscriptions}) reached`)
    }

    const handle = this.nextSubscriptionHandle++
    const consumerTag = options.consumerTag ?? `consumer-${handle}`

    const sub: InternalSubscription = {
      handle,
      channelName,
      options: {
        autoAck: options.autoAck ?? false,
        consumerTag,
        prefetchCount: options.prefetchCount ?? 10,
        noLocal: options.noLocal ?? false,
      },
      pending: [],
      pendingAcks: new Map(),
    }

    this.subscriptions.set(handle, sub)
    channel.subscriptions.add(handle)

    // For topics, already-delivered messages don't matter
    // For queues, we might want to deliver existing messages
    if (channel.options.type === ChannelType.QUEUE) {
      // Deliver pending messages up to prefetch count
      for (const msg of channel.messages) {
        if (sub.pending.length >= sub.options.prefetchCount) break
        if (msg.deliveredTo.size === 0) { // Not yet delivered to anyone
          this.deliverToSubscription(sub, msg)
        }
      }
    }

    return msgOk(handle)
  }

  private unsubscribe(handle: SubscriptionHandle) {
    const sub = this.subscriptions.get(handle)
    if (!sub) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Subscription ${handle} not found`)
    }

    const channel = this.channels.get(sub.channelName)
    if (channel) {
      channel.subscriptions.delete(handle)
    }

    this.subscriptions.delete(handle)
    return msgOk(undefined)
  }

  private receive(handle: SubscriptionHandle, _timeoutMs: number) {
    const sub = this.subscriptions.get(handle)
    if (!sub) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Subscription ${handle} not found`)
    }

    const channel = this.channels.get(sub.channelName)
    if (!channel) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Channel '${sub.channelName}' not found`)
    }

    // For queues, try to pull a new (non-expired) message if pending is empty
    if (channel.options.type === ChannelType.QUEUE && sub.pending.length === 0) {
      for (const msg of channel.messages) {
        if (msg.deliveredTo.size === 0 && !isExpired(msg)) {
          this.deliverToSubscription(sub, msg)
          break
        }
      }
    }

    // Get next pending message, discarding any that expired while queued.
    let msg = sub.pending.shift()
    while (msg && isExpired(msg)) {
      this.removeFromChannel(channel, msg.deliveryTag)
      msg = sub.pending.shift()
    }
    if (!msg) {
      return msgErr(MessagingErrorCode.TIMEOUT, 'No messages available')
    }

    const received: ReceivedMessage = {
      message: msg.message,
      deliveryTag: msg.deliveryTag,
      redelivered: msg.deliveryCount > 1,
      source: sub.channelName,
    }

    if (sub.options.autoAck) {
      // Auto-acknowledge: remove from channel
      this.removeFromChannel(channel, msg.deliveryTag)
    } else {
      // Track for later acknowledgment
      sub.pendingAcks.set(msg.deliveryTag, msg)
    }

    return msgOk(received)
  }

  private receiveBatch(handle: SubscriptionHandle, maxMessages: number, _timeoutMs: number) {
    const sub = this.subscriptions.get(handle)
    if (!sub) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Subscription ${handle} not found`)
    }

    const channel = this.channels.get(sub.channelName)
    if (!channel) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Channel '${sub.channelName}' not found`)
    }

    const messages: ReceivedMessage[] = []

    while (messages.length < maxMessages) {
      const msg = sub.pending.shift()
      if (!msg) break
      // Drop messages that expired while queued.
      if (isExpired(msg)) {
        this.removeFromChannel(channel, msg.deliveryTag)
        continue
      }

      const received: ReceivedMessage = {
        message: msg.message,
        deliveryTag: msg.deliveryTag,
        redelivered: msg.deliveryCount > 1,
        source: sub.channelName,
      }

      messages.push(received)

      if (sub.options.autoAck) {
        this.removeFromChannel(channel, msg.deliveryTag)
      } else {
        sub.pendingAcks.set(msg.deliveryTag, msg)
      }
    }

    return msgOk(messages)
  }

  private acknowledge(handle: SubscriptionHandle, deliveryTag: number, action: AckAction) {
    const sub = this.subscriptions.get(handle)
    if (!sub) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Subscription ${handle} not found`)
    }

    const msg = sub.pendingAcks.get(deliveryTag)
    if (!msg) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Delivery tag ${deliveryTag} not found`)
    }

    const channel = this.channels.get(sub.channelName)
    sub.pendingAcks.delete(deliveryTag)

    switch (action) {
      case AckAction.ACK:
        // Remove from channel completely
        if (channel) {
          this.removeFromChannel(channel, deliveryTag)
        }
        break

      case AckAction.NACK:
        // Requeue the message
        if (channel) {
          msg.deliveredTo.clear()
          msg.deliveryCount++
          // Move to front of queue for redelivery
          const idx = channel.messages.findIndex((m) => m.deliveryTag === deliveryTag)
          if (idx > 0) {
            channel.messages.splice(idx, 1)
            channel.messages.unshift(msg)
          }
        }
        break

      case AckAction.REJECT:
        // Remove from channel (dead-letter in a real implementation)
        if (channel) {
          this.removeFromChannel(channel, deliveryTag)
        }
        break
    }

    return msgOk(undefined)
  }

  private removeFromChannel(channel: InternalChannel, deliveryTag: number): void {
    const idx = channel.messages.findIndex((m) => m.deliveryTag === deliveryTag)
    if (idx >= 0) {
      channel.messages.splice(idx, 1)
    }
  }

  // ===========================================================================
  // Subscription Management
  // ===========================================================================

  private getSubscriptionInfo(handle: SubscriptionHandle): SubscriptionInfo | null {
    const sub = this.subscriptions.get(handle)
    if (!sub) {
      return null
    }

    return {
      handle: sub.handle,
      source: sub.channelName,
      consumerTag: sub.options.consumerTag,
      autoAck: sub.options.autoAck,
      pendingCount: sub.pending.length + sub.pendingAcks.size,
    }
  }

  private listSubscriptions(channelName?: string): SubscriptionHandle[] {
    if (channelName) {
      const channel = this.channels.get(channelName)
      return channel ? Array.from(channel.subscriptions) : []
    }
    return Array.from(this.subscriptions.keys())
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  private purgeChannel(name: string) {
    const channel = this.channels.get(name)
    if (!channel) {
      return msgErr(MessagingErrorCode.NOT_FOUND, `Channel '${name}' not found`)
    }

    const count = channel.messages.length
    channel.messages = []

    // Clear pending from all subscriptions
    Array.from(channel.subscriptions).forEach((subHandle) => {
      const sub = this.subscriptions.get(subHandle)
      if (sub) {
        sub.pending = []
        sub.pendingAcks.clear()
      }
    })

    return msgOk(count)
  }

  private getPendingCount(handle: SubscriptionHandle): number {
    const sub = this.subscriptions.get(handle)
    return sub ? sub.pending.length + sub.pendingAcks.size : 0
  }
}

// =============================================================================
// Implementation Export
// =============================================================================

/**
 * In-memory messaging implementation.
 */
export const memoryMessagingImplementation: Implementation = {
  name: 'memory',
  description: 'In-memory message broker for local message passing',
  create(config: PluginConfig): PluginInstance {
    return new MemoryMessagingInstance(config as MessagingPluginConfig)
  },
}
