/**
 * wasi:messaging plugin
 *
 * Provides message queue capabilities for WebAssembly components.
 *
 * Interfaces:
 * - wasi:messaging/types - Type definitions
 * - wasi:messaging/producer - Message sending
 * - wasi:messaging/consumer - Message receiving
 * - wasi:messaging/handler - Message handling
 *
 * Implementations:
 * - memory: In-memory message broker (default)
 *
 * @example
 * ```typescript
 * import { messagingPlugins, ChannelType } from '@tegmentum/wasi-polyfill/wasip2/plugins/messaging'
 *
 * // Register plugins
 * for (const plugin of messagingPlugins) {
 *   registry.register(plugin)
 * }
 *
 * // Create a channel and send messages
 * const instance = messagingProducerPlugin.create({ implementation: 'memory' })
 * const imports = instance.getImports()
 *
 * // Create a queue channel
 * imports['create-channel']('my-queue', { type: ChannelType.QUEUE })
 *
 * // Send a message
 * imports['send']('my-queue', { payload: new TextEncoder().encode('Hello'), metadata: {} })
 * ```
 */

// Type exports
export {
  // Handle types
  type ClientHandle,
  type ChannelHandle,
  type TopicHandle,
  type SubscriptionHandle,

  // Message types
  type MessageMetadata,
  type Message,
  type ReceivedMessage,

  // Channel types
  ChannelType,
  type ChannelOptions,
  type ChannelInfo,

  // Subscription types
  type SubscribeOptions,
  type SubscriptionInfo,

  // Error types
  MessagingErrorCode,
  type MessagingError,
  createMessagingError,

  // Result types
  type MessagingResult,
  msgOk,
  msgErr,

  // Config types
  type MessagingPluginConfig,

  // Acknowledgment types
  AckAction,
} from './types.js'

// Plugin definitions and interfaces
export {
  messagingTypesPlugin,
  messagingProducerPlugin,
  messagingConsumerPlugin,
  messagingHandlerPlugin,
  messagingPlugins,
  MESSAGING_TYPES_INTERFACE,
  MESSAGING_PRODUCER_INTERFACE,
  MESSAGING_CONSUMER_INTERFACE,
  MESSAGING_HANDLER_INTERFACE,
} from './plugin.js'

// Memory implementation
export { memoryMessagingImplementation } from './impl-memory.js'
