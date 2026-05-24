/**
 * wasi:messaging plugin tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  memoryMessagingImplementation,
  ChannelType,
  AckAction,
  MessagingErrorCode,
  type Message,
  type ChannelOptions,
  type SubscribeOptions,
  type ReceivedMessage,
  type MessagingPluginConfig,
} from '../../../../../src/wasip2/plugins/messaging/index.js'

describe('wasi:messaging', () => {
  describe('memoryMessagingImplementation', () => {
    let instance: ReturnType<typeof memoryMessagingImplementation.create>
    let imports: Record<string, unknown>

    beforeEach(() => {
      instance = memoryMessagingImplementation.create({} as MessagingPluginConfig)
      imports = instance.getImports()
    })

    afterEach(() => {
      instance.destroy()
    })

    describe('channel management', () => {
      it('should create a queue channel', () => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => { ok: boolean; value?: number }

        const result = createChannel('test-queue', { type: ChannelType.QUEUE })
        expect(result.ok).toBe(true)
        expect(result.value).toBeGreaterThan(0)
      })

      it('should create a topic channel', () => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => { ok: boolean; value?: number }

        const result = createChannel('test-topic', { type: ChannelType.TOPIC })
        expect(result.ok).toBe(true)
      })

      it('should fail to create duplicate channel', () => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => { ok: boolean; error?: { code: string } }

        createChannel('duplicate', { type: ChannelType.QUEUE })
        const result = createChannel('duplicate', { type: ChannelType.QUEUE })

        expect(result.ok).toBe(false)
        expect(result.error?.code).toBe(MessagingErrorCode.ALREADY_EXISTS)
      })

      it('should get channel info', () => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => { ok: boolean }
        const getChannelInfo = imports['get-channel-info'] as (name: string) => { name: string; type: ChannelType; messageCount: number } | null

        createChannel('info-test', { type: ChannelType.QUEUE, durable: true })

        const info = getChannelInfo('info-test')
        expect(info).not.toBeNull()
        expect(info!.name).toBe('info-test')
        expect(info!.type).toBe(ChannelType.QUEUE)
        expect(info!.messageCount).toBe(0)
      })

      it('should list channels', () => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => { ok: boolean }
        const listChannels = imports['list-channels'] as () => string[]

        createChannel('channel-1', { type: ChannelType.QUEUE })
        createChannel('channel-2', { type: ChannelType.TOPIC })

        const channels = listChannels()
        expect(channels).toContain('channel-1')
        expect(channels).toContain('channel-2')
      })

      it('should delete channel', () => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => { ok: boolean }
        const deleteChannel = imports['delete-channel'] as (name: string) => { ok: boolean }
        const getChannelInfo = imports['get-channel-info'] as (name: string) => null | object

        createChannel('to-delete', { type: ChannelType.QUEUE })
        const result = deleteChannel('to-delete')

        expect(result.ok).toBe(true)
        expect(getChannelInfo('to-delete')).toBeNull()
      })

      it('should open existing channel', () => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => { ok: boolean; value?: number }
        const openChannel = imports['open-channel'] as (name: string) => { ok: boolean; value?: number }

        const createResult = createChannel('open-test', { type: ChannelType.QUEUE })
        const openResult = openChannel('open-test')

        expect(openResult.ok).toBe(true)
        expect(openResult.value).toBe(createResult.value)
      })
    })

    describe('queue messaging', () => {
      beforeEach(() => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => void
        createChannel('my-queue', { type: ChannelType.QUEUE })
      })

      it('should send and receive message', () => {
        const send = imports['send'] as (channel: string, message: Message) => { ok: boolean; value?: string }
        const subscribe = imports['subscribe'] as (channel: string, options: SubscribeOptions) => { ok: boolean; value?: number }
        const receive = imports['receive'] as (handle: number, timeout: number) => { ok: boolean; value?: ReceivedMessage }

        // Send a message
        const sendResult = send('my-queue', {
          payload: new TextEncoder().encode('Hello World'),
          metadata: {},
        })
        expect(sendResult.ok).toBe(true)
        expect(sendResult.value).toBeDefined()

        // Subscribe
        const subResult = subscribe('my-queue', { autoAck: true })
        expect(subResult.ok).toBe(true)

        // Receive
        const recvResult = receive(subResult.value!, 1000)
        expect(recvResult.ok).toBe(true)
        expect(recvResult.value).toBeDefined()

        const text = new TextDecoder().decode(recvResult.value!.message.payload)
        expect(text).toBe('Hello World')
      })

      it('should send message with metadata', () => {
        const send = imports['send'] as (channel: string, message: Message) => { ok: boolean; value?: string }
        const subscribe = imports['subscribe'] as (channel: string, options: SubscribeOptions) => { ok: boolean; value?: number }
        const receive = imports['receive'] as (handle: number, timeout: number) => { ok: boolean; value?: ReceivedMessage }

        // Send with metadata
        send('my-queue', {
          payload: new TextEncoder().encode('Test'),
          metadata: {
            id: 'custom-id',
            contentType: 'text/plain',
            priority: 5,
          },
        })

        // Subscribe and receive
        const subResult = subscribe('my-queue', { autoAck: true })
        const recvResult = receive(subResult.value!, 1000)

        expect(recvResult.ok).toBe(true)
        expect(recvResult.value!.message.metadata.id).toBe('custom-id')
        expect(recvResult.value!.message.metadata.contentType).toBe('text/plain')
        expect(recvResult.value!.message.metadata.priority).toBe(5)
      })

      it('should require acknowledgment when autoAck is false', () => {
        const send = imports['send'] as (channel: string, message: Message) => { ok: boolean }
        const subscribe = imports['subscribe'] as (channel: string, options: SubscribeOptions) => { ok: boolean; value?: number }
        const receive = imports['receive'] as (handle: number, timeout: number) => { ok: boolean; value?: ReceivedMessage }
        const acknowledge = imports['acknowledge'] as (handle: number, tag: number, action: AckAction) => { ok: boolean }
        const getChannelInfo = imports['get-channel-info'] as (name: string) => { messageCount: number }

        // Send
        send('my-queue', { payload: new TextEncoder().encode('Test'), metadata: {} })

        // Subscribe without auto-ack
        const subResult = subscribe('my-queue', { autoAck: false })
        const recvResult = receive(subResult.value!, 1000)

        expect(recvResult.ok).toBe(true)

        // Message should still be in queue (pending ack)
        const infoBeforeAck = getChannelInfo('my-queue')
        expect(infoBeforeAck.messageCount).toBe(1)

        // Acknowledge
        const ackResult = acknowledge(subResult.value!, recvResult.value!.deliveryTag, AckAction.ACK)
        expect(ackResult.ok).toBe(true)

        // Message should be removed
        const infoAfterAck = getChannelInfo('my-queue')
        expect(infoAfterAck.messageCount).toBe(0)
      })

      it('should requeue on NACK', () => {
        const send = imports['send'] as (channel: string, message: Message) => { ok: boolean }
        const subscribe = imports['subscribe'] as (channel: string, options: SubscribeOptions) => { ok: boolean; value?: number }
        const receive = imports['receive'] as (handle: number, timeout: number) => { ok: boolean; value?: ReceivedMessage }
        const acknowledge = imports['acknowledge'] as (handle: number, tag: number, action: AckAction) => { ok: boolean }

        // Send
        send('my-queue', { payload: new TextEncoder().encode('Test'), metadata: {} })

        // Subscribe and receive
        const subResult = subscribe('my-queue', { autoAck: false })
        const recvResult1 = receive(subResult.value!, 1000)

        // NACK - requeue
        acknowledge(subResult.value!, recvResult1.value!.deliveryTag, AckAction.NACK)

        // Receive again - should be redelivered
        const recvResult2 = receive(subResult.value!, 1000)
        expect(recvResult2.ok).toBe(true)
        expect(recvResult2.value!.redelivered).toBe(true)
      })

      it('should receive batch', () => {
        const send = imports['send'] as (channel: string, message: Message) => { ok: boolean }
        const subscribe = imports['subscribe'] as (channel: string, options: SubscribeOptions) => { ok: boolean; value?: number }
        const receiveBatch = imports['receive-batch'] as (handle: number, max: number, timeout: number) => { ok: boolean; value?: ReceivedMessage[] }

        // Send multiple messages
        for (let i = 0; i < 5; i++) {
          send('my-queue', { payload: new TextEncoder().encode(`Message ${i}`), metadata: {} })
        }

        // Subscribe and receive batch
        const subResult = subscribe('my-queue', { autoAck: true, prefetchCount: 10 })
        const batchResult = receiveBatch(subResult.value!, 3, 1000)

        expect(batchResult.ok).toBe(true)
        expect(batchResult.value!.length).toBe(3)
      })
    })

    describe('pub/sub messaging', () => {
      beforeEach(() => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => void
        createChannel('my-topic', { type: ChannelType.TOPIC })
      })

      it('should publish to topic', () => {
        const publish = imports['publish'] as (topic: string, message: Message) => { ok: boolean; value?: string }

        const result = publish('my-topic', {
          payload: new TextEncoder().encode('Broadcast'),
          metadata: {},
        })

        expect(result.ok).toBe(true)
      })

      it('should fail to use send on topic', () => {
        const send = imports['send'] as (channel: string, message: Message) => { ok: boolean; error?: { code: string } }

        const result = send('my-topic', {
          payload: new TextEncoder().encode('Test'),
          metadata: {},
        })

        expect(result.ok).toBe(false)
        expect(result.error?.code).toBe(MessagingErrorCode.INVALID_ARGUMENT)
      })

      it('should deliver to multiple subscribers', () => {
        const publish = imports['publish'] as (topic: string, message: Message) => { ok: boolean }
        const subscribe = imports['subscribe'] as (channel: string, options: SubscribeOptions) => { ok: boolean; value?: number }
        const receive = imports['receive'] as (handle: number, timeout: number) => { ok: boolean; value?: ReceivedMessage }

        // Create two subscribers
        const sub1 = subscribe('my-topic', { autoAck: true })
        const sub2 = subscribe('my-topic', { autoAck: true })

        // Publish message
        publish('my-topic', {
          payload: new TextEncoder().encode('Broadcast'),
          metadata: {},
        })

        // Both should receive
        const recv1 = receive(sub1.value!, 1000)
        const recv2 = receive(sub2.value!, 1000)

        expect(recv1.ok).toBe(true)
        expect(recv2.ok).toBe(true)

        const text1 = new TextDecoder().decode(recv1.value!.message.payload)
        const text2 = new TextDecoder().decode(recv2.value!.message.payload)
        expect(text1).toBe('Broadcast')
        expect(text2).toBe('Broadcast')
      })
    })

    describe('subscription management', () => {
      beforeEach(() => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => void
        createChannel('sub-test', { type: ChannelType.QUEUE })
      })

      it('should get subscription info', () => {
        const subscribe = imports['subscribe'] as (channel: string, options: SubscribeOptions) => { ok: boolean; value?: number }
        const getSubscriptionInfo = imports['get-subscription-info'] as (handle: number) => { source: string; consumerTag: string } | null

        const subResult = subscribe('sub-test', { consumerTag: 'my-consumer' })
        const info = getSubscriptionInfo(subResult.value!)

        expect(info).not.toBeNull()
        expect(info!.source).toBe('sub-test')
        expect(info!.consumerTag).toBe('my-consumer')
      })

      it('should unsubscribe', () => {
        const subscribe = imports['subscribe'] as (channel: string, options: SubscribeOptions) => { ok: boolean; value?: number }
        const unsubscribe = imports['unsubscribe'] as (handle: number) => { ok: boolean }
        const getSubscriptionInfo = imports['get-subscription-info'] as (handle: number) => null | object

        const subResult = subscribe('sub-test', {})
        const unsub = unsubscribe(subResult.value!)

        expect(unsub.ok).toBe(true)
        expect(getSubscriptionInfo(subResult.value!)).toBeNull()
      })

      it('should list subscriptions', () => {
        const subscribe = imports['subscribe'] as (channel: string, options: SubscribeOptions) => { ok: boolean; value?: number }
        const listSubscriptions = imports['list-subscriptions'] as (channel?: string) => number[]

        const sub1 = subscribe('sub-test', {})
        const sub2 = subscribe('sub-test', {})

        const subs = listSubscriptions('sub-test')
        expect(subs).toContain(sub1.value)
        expect(subs).toContain(sub2.value)
      })
    })

    describe('utilities', () => {
      beforeEach(() => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => void
        createChannel('util-test', { type: ChannelType.QUEUE })
      })

      it('should purge channel', () => {
        const send = imports['send'] as (channel: string, message: Message) => { ok: boolean }
        const purgeChannel = imports['purge-channel'] as (name: string) => { ok: boolean; value?: number }
        const getChannelInfo = imports['get-channel-info'] as (name: string) => { messageCount: number }

        // Send messages
        for (let i = 0; i < 5; i++) {
          send('util-test', { payload: new TextEncoder().encode(`Msg ${i}`), metadata: {} })
        }

        expect(getChannelInfo('util-test').messageCount).toBe(5)

        // Purge
        const result = purgeChannel('util-test')
        expect(result.ok).toBe(true)
        expect(result.value).toBe(5)
        expect(getChannelInfo('util-test').messageCount).toBe(0)
      })

      it('should get pending count', () => {
        const send = imports['send'] as (channel: string, message: Message) => { ok: boolean }
        const subscribe = imports['subscribe'] as (channel: string, options: SubscribeOptions) => { ok: boolean; value?: number }
        const getPendingCount = imports['get-pending-count'] as (handle: number) => number

        // Send messages
        for (let i = 0; i < 3; i++) {
          send('util-test', { payload: new TextEncoder().encode(`Msg ${i}`), metadata: {} })
        }

        // Subscribe with prefetch of 10
        const subResult = subscribe('util-test', { autoAck: false, prefetchCount: 10 })

        // Should have 3 pending
        expect(getPendingCount(subResult.value!)).toBe(3)
      })
    })

    describe('request/reply pattern', () => {
      beforeEach(() => {
        const createChannel = imports['create-channel'] as (name: string, options: ChannelOptions) => void
        createChannel('requests', { type: ChannelType.QUEUE })
      })

      it('should create request with correlation ID', () => {
        const request = imports['request'] as (channel: string, message: Message, timeout: number) => { ok: boolean; value?: { correlationId: string; replyChannel: string } }

        const result = request('requests', {
          payload: new TextEncoder().encode('Request'),
          metadata: {},
        }, 5000)

        expect(result.ok).toBe(true)
        expect(result.value!.correlationId).toBeDefined()
        expect(result.value!.replyChannel).toContain('reply-')
      })
    })
  })

  describe('message TTL expiry (Phase 3.10)', () => {
    type Res<T> = { ok: boolean; value?: T; error?: { code: string } }
    let instance: ReturnType<typeof memoryMessagingImplementation.create>
    let imports: Record<string, unknown>

    beforeEach(() => {
      vi.useFakeTimers()
      instance = memoryMessagingImplementation.create({} as MessagingPluginConfig)
      imports = instance.getImports()
      ;(imports['create-channel'] as (n: string, o: ChannelOptions) => void)(
        'ttl-q',
        { type: ChannelType.QUEUE }
      )
    })

    afterEach(() => {
      instance.destroy()
      vi.useRealTimers()
    })

    it('does not deliver a message past its TTL', () => {
      const send = imports['send'] as (c: string, m: Message) => Res<string>
      const subscribe = imports['subscribe'] as (c: string, o: SubscribeOptions) => Res<number>
      const receive = imports['receive'] as (h: number, t: number) => Res<ReceivedMessage>

      send('ttl-q', {
        payload: new TextEncoder().encode('soon-gone'),
        metadata: { ttl: 1000 },
      })

      // Advance past the TTL before anyone consumes it.
      vi.advanceTimersByTime(2000)

      const sub = subscribe('ttl-q', { autoAck: true })
      const recv = receive(sub.value!, 0)
      expect(recv.ok).toBe(false)
      expect(recv.error?.code).toBe(MessagingErrorCode.TIMEOUT)
    })

    it('still delivers a message within its TTL', () => {
      const send = imports['send'] as (c: string, m: Message) => Res<string>
      const subscribe = imports['subscribe'] as (c: string, o: SubscribeOptions) => Res<number>
      const receive = imports['receive'] as (h: number, t: number) => Res<ReceivedMessage>

      send('ttl-q', {
        payload: new TextEncoder().encode('still-here'),
        metadata: { ttl: 10000 },
      })
      vi.advanceTimersByTime(1000) // well within TTL

      const sub = subscribe('ttl-q', { autoAck: true })
      const recv = receive(sub.value!, 0)
      expect(recv.ok).toBe(true)
      expect(new TextDecoder().decode(recv.value!.message.payload)).toBe('still-here')
    })
  })
})
