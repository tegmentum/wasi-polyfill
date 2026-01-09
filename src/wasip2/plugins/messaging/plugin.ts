/**
 * wasi:messaging plugin definitions
 *
 * Defines the plugin interfaces for message queue operations.
 *
 * Interfaces:
 * - wasi:messaging/types - Type definitions
 * - wasi:messaging/producer - Message sending
 * - wasi:messaging/consumer - Message receiving
 * - wasi:messaging/handler - Message handling (incoming handler pattern)
 *
 * Implementations:
 * - memory: In-memory message broker
 * - mock: Mock implementation for testing
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { memoryMessagingImplementation } from './impl-memory.js'

/**
 * WASI messaging types interface definition
 */
export const MESSAGING_TYPES_INTERFACE: WasiInterface = {
  package: 'wasi:messaging',
  name: 'types',
  version: '0.2.0-draft',
}

/**
 * WASI messaging producer interface definition
 */
export const MESSAGING_PRODUCER_INTERFACE: WasiInterface = {
  package: 'wasi:messaging',
  name: 'producer',
  version: '0.2.0-draft',
}

/**
 * WASI messaging consumer interface definition
 */
export const MESSAGING_CONSUMER_INTERFACE: WasiInterface = {
  package: 'wasi:messaging',
  name: 'consumer',
  version: '0.2.0-draft',
}

/**
 * WASI messaging handler interface definition
 */
export const MESSAGING_HANDLER_INTERFACE: WasiInterface = {
  package: 'wasi:messaging',
  name: 'handler',
  version: '0.2.0-draft',
}

/**
 * wasi:messaging/types plugin
 *
 * Provides type definitions for messaging.
 */
export const messagingTypesPlugin: WasiPlugin = createPlugin(
  MESSAGING_TYPES_INTERFACE,
  {
    memory: memoryMessagingImplementation,
  },
  'memory'
)

/**
 * wasi:messaging/producer plugin
 *
 * Provides message sending capabilities.
 *
 * Implementations:
 * - memory: In-memory message broker (default)
 */
export const messagingProducerPlugin: WasiPlugin = createPlugin(
  MESSAGING_PRODUCER_INTERFACE,
  {
    memory: memoryMessagingImplementation,
  },
  'memory'
)

/**
 * wasi:messaging/consumer plugin
 *
 * Provides message receiving capabilities.
 *
 * Implementations:
 * - memory: In-memory message broker (default)
 */
export const messagingConsumerPlugin: WasiPlugin = createPlugin(
  MESSAGING_CONSUMER_INTERFACE,
  {
    memory: memoryMessagingImplementation,
  },
  'memory'
)

/**
 * wasi:messaging/handler plugin
 *
 * Provides message handler pattern for reactive message processing.
 *
 * Implementations:
 * - memory: In-memory message broker (default)
 */
export const messagingHandlerPlugin: WasiPlugin = createPlugin(
  MESSAGING_HANDLER_INTERFACE,
  {
    memory: memoryMessagingImplementation,
  },
  'memory'
)

/**
 * All messaging plugins for convenient registration
 */
export const messagingPlugins: WasiPlugin[] = [
  messagingTypesPlugin,
  messagingProducerPlugin,
  messagingConsumerPlugin,
  messagingHandlerPlugin,
]
