/**
 * wasi:messaging type definitions
 *
 * Types for message queue operations supporting various messaging patterns:
 * - Point-to-point (send/receive)
 * - Pub/sub (publish/subscribe)
 * - Request/reply (with correlation)
 */

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle to a messaging client.
 */
export type ClientHandle = number

/**
 * Handle to a channel for point-to-point messaging.
 */
export type ChannelHandle = number

/**
 * Handle to a topic for pub/sub messaging.
 */
export type TopicHandle = number

/**
 * Handle to a subscription.
 */
export type SubscriptionHandle = number

// =============================================================================
// Message Types
// =============================================================================

/**
 * Message metadata (headers).
 */
export interface MessageMetadata {
  /** Message ID (unique identifier) */
  id?: string
  /** Correlation ID for request/reply patterns */
  correlationId?: string
  /** Reply-to channel/topic for request/reply */
  replyTo?: string
  /** Content type (e.g., 'application/json') */
  contentType?: string
  /** Message timestamp (Unix ms) */
  timestamp?: number
  /** Time-to-live in milliseconds (0 = no expiry) */
  ttl?: number
  /** Message priority (0-9, higher = more priority) */
  priority?: number
  /** Custom headers */
  headers?: Map<string, string>
}

/**
 * A message with payload and metadata.
 */
export interface Message {
  /** Message payload as bytes */
  payload: Uint8Array
  /** Message metadata */
  metadata: MessageMetadata
}

/**
 * A received message with delivery info.
 */
export interface ReceivedMessage {
  /** The message */
  message: Message
  /** Delivery tag for acknowledgment */
  deliveryTag: number
  /** Whether this message was redelivered */
  redelivered: boolean
  /** Source channel or topic */
  source: string
}

// =============================================================================
// Channel Types
// =============================================================================

/**
 * Channel type enumeration.
 */
export enum ChannelType {
  /** Point-to-point channel (one consumer) */
  QUEUE = 'queue',
  /** Pub/sub topic (multiple subscribers) */
  TOPIC = 'topic',
}

/**
 * Channel options.
 */
export interface ChannelOptions {
  /** Channel type */
  type: ChannelType
  /** Whether the channel is durable (survives restarts) */
  durable?: boolean
  /** Maximum number of messages to buffer */
  maxMessages?: number
  /** Maximum message size in bytes */
  maxMessageSize?: number
  /** Default TTL for messages in ms */
  defaultTtl?: number
}

/**
 * Channel information.
 */
export interface ChannelInfo {
  /** Channel name */
  name: string
  /** Channel type */
  type: ChannelType
  /** Whether the channel is durable */
  durable: boolean
  /** Number of messages currently in the channel */
  messageCount: number
  /** Number of consumers/subscribers */
  consumerCount: number
}

// =============================================================================
// Subscription Types
// =============================================================================

/**
 * Subscription options.
 */
export interface SubscribeOptions {
  /** Auto-acknowledge messages (default: false) */
  autoAck?: boolean
  /** Consumer tag for identification */
  consumerTag?: string
  /** Maximum number of unacknowledged messages */
  prefetchCount?: number
  /** Only receive new messages (ignore existing) */
  noLocal?: boolean
}

/**
 * Subscription information.
 */
export interface SubscriptionInfo {
  /** Subscription handle */
  handle: SubscriptionHandle
  /** Channel/topic name */
  source: string
  /** Consumer tag */
  consumerTag: string
  /** Whether auto-ack is enabled */
  autoAck: boolean
  /** Number of pending (unacked) messages */
  pendingCount: number
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * wasi:messaging error codes.
 */
export enum MessagingErrorCode {
  /** Successful operation */
  SUCCESS = 'success',
  /** Invalid argument provided */
  INVALID_ARGUMENT = 'invalid-argument',
  /** Channel or topic not found */
  NOT_FOUND = 'not-found',
  /** Already exists */
  ALREADY_EXISTS = 'already-exists',
  /** Operation not permitted */
  NOT_ALLOWED = 'not-allowed',
  /** Queue is full */
  QUEUE_FULL = 'queue-full',
  /** Connection error */
  CONNECTION_ERROR = 'connection-error',
  /** Timeout error */
  TIMEOUT = 'timeout',
  /** Message too large */
  MESSAGE_TOO_LARGE = 'message-too-large',
  /** Unknown error */
  UNKNOWN = 'unknown',
}

/**
 * Error structure for messaging operations.
 */
export interface MessagingError {
  code: MessagingErrorCode
  message: string
}

/**
 * Create a MessagingError.
 */
export function createMessagingError(code: MessagingErrorCode, message: string): MessagingError {
  return { code, message }
}

// =============================================================================
// Result Type
// =============================================================================

/**
 * Result type for operations that can fail.
 */
export type MessagingResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MessagingError }

/**
 * Create a successful result.
 */
export function msgOk<T>(value: T): MessagingResult<T> {
  return { ok: true, value }
}

/**
 * Create an error result.
 */
export function msgErr<T>(code: MessagingErrorCode, message: string): MessagingResult<T> {
  return { ok: false, error: createMessagingError(code, message) }
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Messaging plugin configuration.
 */
export interface MessagingPluginConfig {
  /** Maximum number of channels */
  maxChannels?: number
  /** Maximum number of subscriptions */
  maxSubscriptions?: number
  /** Maximum message size in bytes */
  maxMessageSize?: number
  /** Default message TTL in ms */
  defaultTtl?: number
  /** Connection URL for external broker (optional) */
  brokerUrl?: string
}

// =============================================================================
// Acknowledgment Types
// =============================================================================

/**
 * Acknowledgment action.
 */
export enum AckAction {
  /** Acknowledge successful processing */
  ACK = 'ack',
  /** Negative acknowledgment - requeue the message */
  NACK = 'nack',
  /** Reject the message (don't requeue) */
  REJECT = 'reject',
}
