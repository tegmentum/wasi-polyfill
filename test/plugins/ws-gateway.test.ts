import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Protocol constants
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  HEADER_SIZE,
  // Protocol enums
  MessageType,
  MessageFlags,
  Protocol,
  AddressKind,
  OpenError,
  Features,
  DnsError,
  // Protocol functions
  encodeHeader,
  decodeHeader,
  encodeOpenPayload,
  decodeOpenPayload,
  encodeOpenErrPayload,
  decodeOpenErrPayload,
  createFrame,
  createHelloFrame,
  createOpenFrame,
  createDataFrame,
  createCloseFrame,
  createDataAckFrame,
  mapOpenErrorToWasi,
  // DNS functions
  encodeDnsQueryPayload,
  decodeDnsQueryPayload,
  decodeDnsResultPayload,
  decodeDnsErrPayload,
  createDnsQueryFrame,
  type FrameHeader,
  type OpenPayload,
  type DnsQueryPayload,
  type DnsResultPayload,
  type DnsErrPayload,
} from '../../src/wasip2/plugins/ws-gateway/protocol.js'
import { ByteQueue, AsyncByteQueue } from '../../src/wasip2/plugins/ws-gateway/byte-queue.js'
import {
  TunneledTcpSocketRegistry,
  TcpSocketState,
  tunneledTcpImplementation,
  tunneledTcpCreateSocketImplementation,
  type TunneledTcpSocket,
} from '../../src/wasip2/plugins/ws-gateway/tcp-adapter.js'
import {
  TunneledUdpSocketRegistry,
  TunneledDatagramStreamRegistry,
  tunneledUdpImplementation,
  tunneledUdpCreateSocketImplementation,
  type TunneledUdpSocket,
} from '../../src/wasip2/plugins/ws-gateway/udp-adapter.js'
import {
  TunneledResolveAddressStreamRegistry,
  tunneledDnsLookupImplementation,
} from '../../src/wasip2/plugins/ws-gateway/dns-adapter.js'
import { UdpState } from '../../src/wasip2/plugins/sockets/types.js'
import {
  TunnelRegistry,
  TunnelState,
  StreamState,
} from '../../src/wasip2/plugins/ws-gateway/tunnel-manager.js'
import {
  wsGatewayTcpPlugin,
  wsGatewayTcpCreateSocketPlugin,
  wsGatewayUdpPlugin,
  wsGatewayUdpCreateSocketPlugin,
  wsGatewayDnsPlugin,
  wsGatewayPlugins,
} from '../../src/wasip2/plugins/ws-gateway/plugin.js'

describe('ws-gateway protocol', () => {
  describe('constants', () => {
    it('has correct magic bytes', () => {
      // 'KSW1' in little-endian
      expect(PROTOCOL_MAGIC).toBe(0x3157534b)
    })

    it('has version 1', () => {
      expect(PROTOCOL_VERSION).toBe(1)
    })

    it('has 16-byte header', () => {
      expect(HEADER_SIZE).toBe(16)
    })
  })

  describe('MessageType enum', () => {
    it('has expected message types', () => {
      expect(MessageType.Hello).toBe(0x01)
      expect(MessageType.HelloAck).toBe(0x02)
      expect(MessageType.Open).toBe(0x10)
      expect(MessageType.OpenOk).toBe(0x11)
      expect(MessageType.OpenErr).toBe(0x12)
      expect(MessageType.Data).toBe(0x20)
      expect(MessageType.DataAck).toBe(0x21)
      expect(MessageType.Close).toBe(0x30)
      expect(MessageType.CloseAck).toBe(0x31)
      expect(MessageType.DnsQuery).toBe(0x40)
      expect(MessageType.DnsResult).toBe(0x41)
      expect(MessageType.DnsErr).toBe(0x42)
      expect(MessageType.Ping).toBe(0xf0)
      expect(MessageType.Pong).toBe(0xf1)
    })
  })

  describe('MessageFlags enum', () => {
    it('has expected flags', () => {
      expect(MessageFlags.None).toBe(0x00)
      expect(MessageFlags.Eof).toBe(0x01)
      expect(MessageFlags.More).toBe(0x02)
      expect(MessageFlags.Urgent).toBe(0x04)
    })
  })

  describe('Protocol enum', () => {
    it('has TCP and UDP', () => {
      expect(Protocol.Tcp).toBe(1)
      expect(Protocol.Udp).toBe(2)
    })
  })

  describe('AddressKind enum', () => {
    it('has expected address types', () => {
      expect(AddressKind.Hostname).toBe(1)
      expect(AddressKind.Ipv4).toBe(2)
      expect(AddressKind.Ipv6).toBe(3)
    })
  })

  describe('OpenError enum', () => {
    it('has expected error codes', () => {
      expect(OpenError.Blocked).toBe(1)
      expect(OpenError.ResolveFail).toBe(2)
      expect(OpenError.ConnRefused).toBe(3)
      expect(OpenError.Timeout).toBe(4)
      expect(OpenError.Unreachable).toBe(5)
      expect(OpenError.AuthRequired).toBe(6)
      expect(OpenError.AuthFailed).toBe(7)
      expect(OpenError.TooManyStreams).toBe(8)
      expect(OpenError.Internal).toBe(9)
    })
  })

  describe('Features enum', () => {
    it('has expected features', () => {
      expect(Features.None).toBe(0x00)
      expect(Features.FlowControl).toBe(0x01)
      expect(Features.HalfClose).toBe(0x02)
      expect(Features.Dns).toBe(0x04)
      expect(Features.Udp).toBe(0x08)
      expect(Features.OpenToken).toBe(0x10)
    })
  })

  describe('encodeHeader / decodeHeader', () => {
    it('encodes and decodes a header correctly', () => {
      const header: FrameHeader = {
        magic: PROTOCOL_MAGIC,
        version: PROTOCOL_VERSION,
        type: MessageType.Data,
        flags: MessageFlags.Eof,
        streamId: 42,
        payloadLen: 100,
      }

      const encoded = encodeHeader(header)
      expect(encoded.length).toBe(HEADER_SIZE)

      const decoded = decodeHeader(encoded)
      expect(decoded).not.toBeNull()
      expect(decoded!.magic).toBe(PROTOCOL_MAGIC)
      expect(decoded!.version).toBe(PROTOCOL_VERSION)
      expect(decoded!.type).toBe(MessageType.Data)
      expect(decoded!.flags).toBe(MessageFlags.Eof)
      expect(decoded!.streamId).toBe(42)
      expect(decoded!.payloadLen).toBe(100)
    })

    it('returns null for insufficient data', () => {
      const data = new Uint8Array(10)
      expect(decodeHeader(data)).toBeNull()
    })

    it('returns null for invalid magic', () => {
      const data = new Uint8Array(16)
      data.set([0x00, 0x00, 0x00, 0x00], 0) // Wrong magic
      expect(decodeHeader(data)).toBeNull()
    })
  })

  describe('encodeOpenPayload / decodeOpenPayload', () => {
    it('encodes and decodes hostname address', () => {
      const payload: OpenPayload = {
        proto: Protocol.Tcp,
        addrKind: AddressKind.Hostname,
        port: 443,
        addr: new TextEncoder().encode('example.com'),
      }

      const encoded = encodeOpenPayload(payload)
      const decoded = decodeOpenPayload(encoded)

      expect(decoded).not.toBeNull()
      expect(decoded!.proto).toBe(Protocol.Tcp)
      expect(decoded!.addrKind).toBe(AddressKind.Hostname)
      expect(decoded!.port).toBe(443)
      expect(new TextDecoder().decode(decoded!.addr)).toBe('example.com')
    })

    it('encodes and decodes with auth token', () => {
      const payload: OpenPayload = {
        proto: Protocol.Tcp,
        addrKind: AddressKind.Ipv4,
        port: 80,
        addr: new Uint8Array([192, 168, 1, 1]),
        token: new TextEncoder().encode('secret'),
      }

      const encoded = encodeOpenPayload(payload)
      const decoded = decodeOpenPayload(encoded)

      expect(decoded).not.toBeNull()
      expect(decoded!.token).toBeDefined()
      expect(new TextDecoder().decode(decoded!.token!)).toBe('secret')
    })

    it('returns null for insufficient data', () => {
      const data = new Uint8Array(4)
      expect(decodeOpenPayload(data)).toBeNull()
    })
  })

  describe('encodeOpenErrPayload / decodeOpenErrPayload', () => {
    it('encodes and decodes error payload', () => {
      const payload = {
        error: OpenError.ConnRefused,
        message: 'Connection refused',
      }

      const encoded = encodeOpenErrPayload(payload)
      const decoded = decodeOpenErrPayload(encoded)

      expect(decoded).not.toBeNull()
      expect(decoded!.error).toBe(OpenError.ConnRefused)
      expect(decoded!.message).toBe('Connection refused')
    })

    it('returns null for insufficient data', () => {
      const data = new Uint8Array(2)
      expect(decodeOpenErrPayload(data)).toBeNull()
    })
  })

  describe('createFrame', () => {
    it('creates a complete frame', () => {
      const payload = new Uint8Array([1, 2, 3, 4])
      const frame = createFrame(MessageType.Data, 1, payload)

      expect(frame.length).toBe(HEADER_SIZE + 4)

      const header = decodeHeader(frame)
      expect(header).not.toBeNull()
      expect(header!.type).toBe(MessageType.Data)
      expect(header!.streamId).toBe(1)
      expect(header!.payloadLen).toBe(4)
    })
  })

  describe('createHelloFrame', () => {
    it('creates a HELLO frame', () => {
      const frame = createHelloFrame(Features.FlowControl, 100)

      expect(frame.length).toBe(HEADER_SIZE + 8)

      const header = decodeHeader(frame)
      expect(header).not.toBeNull()
      expect(header!.type).toBe(MessageType.Hello)
      expect(header!.streamId).toBe(0)
    })
  })

  describe('createOpenFrame', () => {
    it('creates an OPEN frame', () => {
      const payload: OpenPayload = {
        proto: Protocol.Tcp,
        addrKind: AddressKind.Hostname,
        port: 443,
        addr: new TextEncoder().encode('example.com'),
      }

      const frame = createOpenFrame(1, payload)

      const header = decodeHeader(frame)
      expect(header).not.toBeNull()
      expect(header!.type).toBe(MessageType.Open)
      expect(header!.streamId).toBe(1)
    })
  })

  describe('createDataFrame', () => {
    it('creates a DATA frame without EOF', () => {
      const data = new Uint8Array([1, 2, 3])
      const frame = createDataFrame(5, data, false)

      const header = decodeHeader(frame)
      expect(header).not.toBeNull()
      expect(header!.type).toBe(MessageType.Data)
      expect(header!.streamId).toBe(5)
      expect(header!.flags).toBe(MessageFlags.None)
    })

    it('creates a DATA frame with EOF', () => {
      const data = new Uint8Array([1, 2, 3])
      const frame = createDataFrame(5, data, true)

      const header = decodeHeader(frame)
      expect(header).not.toBeNull()
      expect(header!.flags).toBe(MessageFlags.Eof)
    })
  })

  describe('createCloseFrame', () => {
    it('creates a CLOSE frame', () => {
      const frame = createCloseFrame(7, 0)

      const header = decodeHeader(frame)
      expect(header).not.toBeNull()
      expect(header!.type).toBe(MessageType.Close)
      expect(header!.streamId).toBe(7)
    })
  })

  describe('createDataAckFrame', () => {
    it('creates a DATA_ACK frame', () => {
      const frame = createDataAckFrame(3, 1024)

      const header = decodeHeader(frame)
      expect(header).not.toBeNull()
      expect(header!.type).toBe(MessageType.DataAck)
      expect(header!.streamId).toBe(3)
    })
  })

  describe('mapOpenErrorToWasi', () => {
    it('maps errors to WASI error codes', () => {
      expect(mapOpenErrorToWasi(OpenError.Blocked)).toBe('access-denied')
      expect(mapOpenErrorToWasi(OpenError.ResolveFail)).toBe('name-unresolvable')
      expect(mapOpenErrorToWasi(OpenError.ConnRefused)).toBe('connection-refused')
      expect(mapOpenErrorToWasi(OpenError.Timeout)).toBe('timeout')
      expect(mapOpenErrorToWasi(OpenError.Unreachable)).toBe('host-unreachable')
      expect(mapOpenErrorToWasi(OpenError.AuthRequired)).toBe('access-denied')
      expect(mapOpenErrorToWasi(OpenError.AuthFailed)).toBe('access-denied')
      expect(mapOpenErrorToWasi(OpenError.TooManyStreams)).toBe('would-block')
      expect(mapOpenErrorToWasi(OpenError.Internal)).toBe('unknown')
    })
  })
})

describe('ByteQueue', () => {
  let queue: ByteQueue

  beforeEach(() => {
    queue = new ByteQueue(1024)
  })

  describe('constructor', () => {
    it('creates empty queue', () => {
      expect(queue.available).toBe(0)
      expect(queue.isEmpty).toBe(true)
      expect(queue.isClosed).toBe(false)
    })

    it('uses default max size', () => {
      const defaultQueue = new ByteQueue()
      expect(defaultQueue.capacity).toBe(8 * 1024 * 1024)
    })
  })

  describe('push', () => {
    it('adds data to queue', () => {
      const data = new Uint8Array([1, 2, 3])
      const result = queue.push(data)

      expect(result).toBe(true)
      expect(queue.available).toBe(3)
      expect(queue.isEmpty).toBe(false)
    })

    it('returns false when closed', () => {
      queue.close()
      const data = new Uint8Array([1, 2, 3])
      expect(queue.push(data)).toBe(false)
    })

    it('returns false when exceeds max size', () => {
      const largeData = new Uint8Array(2000)
      expect(queue.push(largeData)).toBe(false)
    })

    it('makes a copy of input data', () => {
      const data = new Uint8Array([1, 2, 3])
      queue.push(data)

      data[0] = 99 // Mutate original
      const read = queue.read(3)
      expect(read[0]).toBe(1) // Queue has copy
    })
  })

  describe('read', () => {
    it('reads data from queue', () => {
      queue.push(new Uint8Array([1, 2, 3, 4, 5]))

      const data = queue.read(3)
      expect(Array.from(data)).toEqual([1, 2, 3])
      expect(queue.available).toBe(2)
    })

    it('reads partial data', () => {
      queue.push(new Uint8Array([1, 2, 3]))

      const data = queue.read(10)
      expect(data.length).toBe(3)
    })

    it('returns empty array when empty', () => {
      const data = queue.read(10)
      expect(data.length).toBe(0)
    })

    it('handles multiple chunks', () => {
      queue.push(new Uint8Array([1, 2]))
      queue.push(new Uint8Array([3, 4]))

      const data = queue.read(4)
      expect(Array.from(data)).toEqual([1, 2, 3, 4])
    })
  })

  describe('peek', () => {
    it('reads without consuming', () => {
      queue.push(new Uint8Array([1, 2, 3]))

      const peek1 = queue.peek(2)
      expect(Array.from(peek1)).toEqual([1, 2])

      const peek2 = queue.peek(2)
      expect(Array.from(peek2)).toEqual([1, 2])

      expect(queue.available).toBe(3)
    })
  })

  describe('skip', () => {
    it('skips bytes', () => {
      queue.push(new Uint8Array([1, 2, 3, 4, 5]))

      const skipped = queue.skip(2)
      expect(skipped).toBe(2)
      expect(queue.available).toBe(3)

      const data = queue.read(3)
      expect(Array.from(data)).toEqual([3, 4, 5])
    })

    it('returns 0 when empty', () => {
      expect(queue.skip(10)).toBe(0)
    })
  })

  describe('readAll', () => {
    it('reads all available data', () => {
      queue.push(new Uint8Array([1, 2, 3]))
      queue.push(new Uint8Array([4, 5]))

      const data = queue.readAll()
      expect(Array.from(data)).toEqual([1, 2, 3, 4, 5])
      expect(queue.isEmpty).toBe(true)
    })
  })

  describe('close', () => {
    it('marks queue as closed', () => {
      queue.close()
      expect(queue.isClosed).toBe(true)
    })

    it('stores error if provided', () => {
      const error = new Error('Test error')
      queue.close(error)
      expect(queue.lastError).toBe(error)
    })
  })

  describe('clear', () => {
    it('removes all data', () => {
      queue.push(new Uint8Array([1, 2, 3]))
      queue.clear()

      expect(queue.isEmpty).toBe(true)
      expect(queue.available).toBe(0)
    })
  })

  describe('reset', () => {
    it('clears data and reopens', () => {
      queue.push(new Uint8Array([1, 2, 3]))
      queue.close(new Error('Test'))
      queue.reset()

      expect(queue.isEmpty).toBe(true)
      expect(queue.isClosed).toBe(false)
      expect(queue.lastError).toBeUndefined()
    })
  })

  describe('freeSpace', () => {
    it('returns available capacity', () => {
      expect(queue.freeSpace).toBe(1024)

      queue.push(new Uint8Array(100))
      expect(queue.freeSpace).toBe(924)
    })
  })

  describe('many-chunk draining (head-index / compaction)', () => {
    it('preserves byte order and accounting across interleaved push/read', () => {
      const big = new ByteQueue(1024 * 1024)
      const expected: number[] = []
      let nextByte = 0
      let readBack: number[] = []

      // Interleave many single-byte pushes with small reads so the queue
      // accumulates and drains chunks repeatedly (exercises compaction).
      for (let i = 0; i < 5000; i++) {
        const v = nextByte++ & 0xff
        big.push(new Uint8Array([v]))
        expected.push(v)
        if (i % 3 === 0) {
          readBack = readBack.concat(Array.from(big.read(2)))
        }
      }
      readBack = readBack.concat(Array.from(big.readAll()))

      expect(big.available).toBe(0)
      expect(big.isEmpty).toBe(true)
      expect(readBack).toEqual(expected)
    })

    it('peek does not disturb the head pointer', () => {
      const q = new ByteQueue(1024)
      q.push(new Uint8Array([1, 2]))
      q.push(new Uint8Array([3, 4]))
      q.read(1) // consume part of the first chunk
      expect(Array.from(q.peek(3))).toEqual([2, 3, 4])
      expect(q.available).toBe(3)
      expect(Array.from(q.read(3))).toEqual([2, 3, 4])
    })
  })
})

describe('AsyncByteQueue', () => {
  let queue: AsyncByteQueue

  beforeEach(() => {
    queue = new AsyncByteQueue(1024)
  })

  describe('push', () => {
    it('inherits ByteQueue push', () => {
      const result = queue.push(new Uint8Array([1, 2, 3]))
      expect(result).toBe(true)
      expect(queue.available).toBe(3)
    })
  })

  describe('readAsync', () => {
    it('returns immediately if data available', async () => {
      queue.push(new Uint8Array([1, 2, 3]))

      const data = await queue.readAsync(2)
      expect(Array.from(data)).toEqual([1, 2])
    })

    it('returns empty when closed and empty', async () => {
      queue.close()
      const data = await queue.readAsync(10)
      expect(data.length).toBe(0)
    })

    it('throws error when closed with error', async () => {
      queue.close(new Error('Test error'))
      await expect(queue.readAsync(10)).rejects.toThrow('Test error')
    })

    it('waits for data then returns', async () => {
      const readPromise = queue.readAsync(3)

      // Push data after starting read
      setTimeout(() => {
        queue.push(new Uint8Array([1, 2, 3]))
      }, 10)

      const data = await readPromise
      expect(Array.from(data)).toEqual([1, 2, 3])
    })

    it('rejects on timeout', async () => {
      await expect(queue.readAsync(3, 50)).rejects.toThrow('Read timeout')
    })
  })

  describe('waitForData', () => {
    it('returns true immediately if data available', async () => {
      queue.push(new Uint8Array([1, 2, 3]))
      const result = await queue.waitForData()
      expect(result).toBe(true)
    })

    it('returns false if closed', async () => {
      queue.close()
      const result = await queue.waitForData()
      expect(result).toBe(false)
    })

    it('waits for data to arrive', async () => {
      const waitPromise = queue.waitForData()

      setTimeout(() => {
        queue.push(new Uint8Array([1]))
      }, 10)

      const result = await waitPromise
      expect(result).toBe(true)
    })
  })
})

describe('TunneledTcpSocketRegistry', () => {
  let registry: TunneledTcpSocketRegistry

  beforeEach(() => {
    registry = new TunneledTcpSocketRegistry()
  })

  describe('register', () => {
    it('registers socket and returns handle', () => {
      const socket: TunneledTcpSocket = {
        handle: 0,
        state: TcpSocketState.New,
        tunnel: null as unknown as never, // Mock
        family: 'ipv4',
      }

      const handle = registry.register(socket)
      expect(handle).toBeGreaterThan(0)
      expect(socket.handle).toBe(handle)
    })

    it('returns unique handles', () => {
      const socket1: TunneledTcpSocket = {
        handle: 0,
        state: TcpSocketState.New,
        tunnel: null as unknown as never,
        family: 'ipv4',
      }
      const socket2: TunneledTcpSocket = {
        handle: 0,
        state: TcpSocketState.New,
        tunnel: null as unknown as never,
        family: 'ipv4',
      }

      const h1 = registry.register(socket1)
      const h2 = registry.register(socket2)

      expect(h1).not.toBe(h2)
    })
  })

  describe('get', () => {
    it('retrieves registered socket', () => {
      const socket: TunneledTcpSocket = {
        handle: 0,
        state: TcpSocketState.New,
        tunnel: null as unknown as never,
        family: 'ipv4',
      }

      const handle = registry.register(socket)
      const retrieved = registry.get(handle)

      expect(retrieved).toBe(socket)
    })

    it('returns undefined for unknown handle', () => {
      expect(registry.get(999)).toBeUndefined()
    })
  })

  describe('drop', () => {
    it('removes socket from registry', () => {
      const socket: TunneledTcpSocket = {
        handle: 0,
        state: TcpSocketState.New,
        tunnel: null as unknown as never,
        family: 'ipv4',
      }

      const handle = registry.register(socket)
      const result = registry.drop(handle)

      expect(result).toBe(true)
      expect(registry.get(handle)).toBeUndefined()
    })

    it('returns false for unknown handle', () => {
      expect(registry.drop(999)).toBe(false)
    })
  })

  describe('clear', () => {
    it('removes all sockets', () => {
      const socket1: TunneledTcpSocket = {
        handle: 0,
        state: TcpSocketState.New,
        tunnel: null as unknown as never,
        family: 'ipv4',
      }
      const socket2: TunneledTcpSocket = {
        handle: 0,
        state: TcpSocketState.New,
        tunnel: null as unknown as never,
        family: 'ipv6',
      }

      const h1 = registry.register(socket1)
      const h2 = registry.register(socket2)

      registry.clear()

      expect(registry.get(h1)).toBeUndefined()
      expect(registry.get(h2)).toBeUndefined()
    })
  })
})

describe('TcpSocketState enum', () => {
  it('has expected states', () => {
    expect(TcpSocketState.New).toBe('new')
    expect(TcpSocketState.Bound).toBe('bound')
    expect(TcpSocketState.Listening).toBe('listening')
    expect(TcpSocketState.Connecting).toBe('connecting')
    expect(TcpSocketState.Connected).toBe('connected')
    expect(TcpSocketState.Closed).toBe('closed')
  })
})

describe('TunnelRegistry', () => {
  let registry: TunnelRegistry

  beforeEach(() => {
    registry = new TunnelRegistry()
  })

  describe('getOrCreate', () => {
    it('creates new tunnel for new URL', () => {
      const tunnel = registry.getOrCreate({ gatewayUrl: 'ws://localhost:8080' })
      expect(tunnel).toBeDefined()
      expect(tunnel.tunnelState).toBe(TunnelState.Disconnected)
    })

    it('returns same tunnel for same URL', () => {
      const t1 = registry.getOrCreate({ gatewayUrl: 'ws://localhost:8080' })
      const t2 = registry.getOrCreate({ gatewayUrl: 'ws://localhost:8080' })
      expect(t1).toBe(t2)
    })

    it('creates different tunnels for different URLs', () => {
      const t1 = registry.getOrCreate({ gatewayUrl: 'ws://localhost:8080' })
      const t2 = registry.getOrCreate({ gatewayUrl: 'ws://localhost:9090' })
      expect(t1).not.toBe(t2)
    })
  })

  describe('get', () => {
    it('retrieves existing tunnel', () => {
      const created = registry.getOrCreate({ gatewayUrl: 'ws://localhost:8080' })
      const retrieved = registry.get('ws://localhost:8080')
      expect(retrieved).toBe(created)
    })

    it('returns undefined for unknown URL', () => {
      expect(registry.get('ws://unknown:8080')).toBeUndefined()
    })
  })

  describe('remove', () => {
    it('removes tunnel from registry', () => {
      registry.getOrCreate({ gatewayUrl: 'ws://localhost:8080' })
      registry.remove('ws://localhost:8080')
      expect(registry.get('ws://localhost:8080')).toBeUndefined()
    })
  })

  describe('clear', () => {
    it('removes all tunnels', () => {
      registry.getOrCreate({ gatewayUrl: 'ws://localhost:8080' })
      registry.getOrCreate({ gatewayUrl: 'ws://localhost:9090' })
      registry.clear()

      expect(registry.get('ws://localhost:8080')).toBeUndefined()
      expect(registry.get('ws://localhost:9090')).toBeUndefined()
    })
  })
})

describe('TunnelState enum', () => {
  it('has expected states', () => {
    expect(TunnelState.Disconnected).toBe('disconnected')
    expect(TunnelState.Connecting).toBe('connecting')
    expect(TunnelState.Connected).toBe('connected')
    expect(TunnelState.Error).toBe('error')
  })
})

describe('StreamState enum', () => {
  it('has expected states', () => {
    expect(StreamState.Connecting).toBe('connecting')
    expect(StreamState.Connected).toBe('connected')
    expect(StreamState.Closing).toBe('closing')
    expect(StreamState.Closed).toBe('closed')
    expect(StreamState.Error).toBe('error')
  })
})

describe('tunneledTcpImplementation', () => {
  it('has correct name and description', () => {
    expect(tunneledTcpImplementation.name).toBe('tunneled')
    expect(tunneledTcpImplementation.description).toBe('TCP via WebSocket tunnel')
  })

  it('creates an instance', () => {
    const instance = tunneledTcpImplementation.create({
      options: { gatewayUrl: 'ws://localhost:8080' },
    })
    expect(instance).toBeDefined()
  })

  it('instance provides imports', () => {
    const instance = tunneledTcpImplementation.create({
      options: { gatewayUrl: 'ws://localhost:8080' },
    })
    const imports = instance.getImports()

    expect(imports['[method]tcp-socket.start-connect']).toBeDefined()
    expect(imports['[method]tcp-socket.finish-connect']).toBeDefined()
    expect(imports['[method]tcp-socket.shutdown']).toBeDefined()
    expect(imports['[resource-drop]tcp-socket']).toBeDefined()
  })
})

describe('tunneledTcpCreateSocketImplementation', () => {
  it('has correct name and description', () => {
    expect(tunneledTcpCreateSocketImplementation.name).toBe('tunneled')
    expect(tunneledTcpCreateSocketImplementation.description).toBe(
      'TCP socket creation via WebSocket tunnel'
    )
  })

  it('creates an instance', () => {
    const instance = tunneledTcpCreateSocketImplementation.create({
      options: { gatewayUrl: 'ws://localhost:8080' },
    })
    expect(instance).toBeDefined()
  })

  it('instance provides create-tcp-socket import', () => {
    const instance = tunneledTcpCreateSocketImplementation.create({
      options: { gatewayUrl: 'ws://localhost:8080' },
    })
    const imports = instance.getImports()

    expect(imports['create-tcp-socket']).toBeDefined()
    expect(typeof imports['create-tcp-socket']).toBe('function')
  })
})

describe('ws-gateway plugins', () => {
  describe('wsGatewayTcpPlugin', () => {
    it('has correct interface', () => {
      expect(wsGatewayTcpPlugin.witInterface.package).toBe('wasi:sockets')
      expect(wsGatewayTcpPlugin.witInterface.name).toBe('tcp')
      expect(wsGatewayTcpPlugin.witInterface.version).toBe('0.2.0')
    })

    it('has tunneled as default implementation', () => {
      expect(wsGatewayTcpPlugin.defaultImplementation).toBe('tunneled')
    })

    it('has tunneled implementation', () => {
      expect(wsGatewayTcpPlugin.implementations.has('tunneled')).toBe(true)
    })
  })

  describe('wsGatewayTcpCreateSocketPlugin', () => {
    it('has correct interface', () => {
      expect(wsGatewayTcpCreateSocketPlugin.witInterface.package).toBe('wasi:sockets')
      expect(wsGatewayTcpCreateSocketPlugin.witInterface.name).toBe('tcp-create-socket')
      expect(wsGatewayTcpCreateSocketPlugin.witInterface.version).toBe('0.2.0')
    })

    it('has tunneled as default implementation', () => {
      expect(wsGatewayTcpCreateSocketPlugin.defaultImplementation).toBe('tunneled')
    })
  })

  describe('wsGatewayUdpPlugin', () => {
    it('has correct interface', () => {
      expect(wsGatewayUdpPlugin.witInterface.package).toBe('wasi:sockets')
      expect(wsGatewayUdpPlugin.witInterface.name).toBe('udp')
      expect(wsGatewayUdpPlugin.witInterface.version).toBe('0.2.0')
    })

    it('has tunneled as default implementation', () => {
      expect(wsGatewayUdpPlugin.defaultImplementation).toBe('tunneled')
    })

    it('has tunneled implementation', () => {
      expect(wsGatewayUdpPlugin.implementations.has('tunneled')).toBe(true)
    })
  })

  describe('wsGatewayUdpCreateSocketPlugin', () => {
    it('has correct interface', () => {
      expect(wsGatewayUdpCreateSocketPlugin.witInterface.package).toBe('wasi:sockets')
      expect(wsGatewayUdpCreateSocketPlugin.witInterface.name).toBe('udp-create-socket')
      expect(wsGatewayUdpCreateSocketPlugin.witInterface.version).toBe('0.2.0')
    })

    it('has tunneled as default implementation', () => {
      expect(wsGatewayUdpCreateSocketPlugin.defaultImplementation).toBe('tunneled')
    })
  })

  describe('wsGatewayPlugins array', () => {
    it('contains TCP, UDP, and DNS plugins', () => {
      expect(wsGatewayPlugins.length).toBe(5)
      expect(wsGatewayPlugins).toContain(wsGatewayTcpPlugin)
      expect(wsGatewayPlugins).toContain(wsGatewayTcpCreateSocketPlugin)
      expect(wsGatewayPlugins).toContain(wsGatewayUdpPlugin)
      expect(wsGatewayPlugins).toContain(wsGatewayUdpCreateSocketPlugin)
      expect(wsGatewayPlugins).toContain(wsGatewayDnsPlugin)
    })
  })
})

describe('TunneledUdpSocketRegistry', () => {
  let registry: TunneledUdpSocketRegistry

  beforeEach(() => {
    registry = new TunneledUdpSocketRegistry()
  })

  describe('register', () => {
    it('registers socket and returns handle', () => {
      const socket = createTestUdpSocket()
      const handle = registry.register(socket)
      expect(handle).toBeGreaterThan(0)
      expect(socket.handle).toBe(handle)
    })

    it('returns unique handles', () => {
      const socket1 = createTestUdpSocket()
      const socket2 = createTestUdpSocket()

      const h1 = registry.register(socket1)
      const h2 = registry.register(socket2)

      expect(h1).not.toBe(h2)
    })
  })

  describe('get', () => {
    it('retrieves registered socket', () => {
      const socket = createTestUdpSocket()
      const handle = registry.register(socket)
      const retrieved = registry.get(handle)
      expect(retrieved).toBe(socket)
    })

    it('returns undefined for unknown handle', () => {
      expect(registry.get(999)).toBeUndefined()
    })
  })

  describe('drop', () => {
    it('removes socket from registry', () => {
      const socket = createTestUdpSocket()
      const handle = registry.register(socket)
      const result = registry.drop(handle)

      expect(result).toBe(true)
      expect(registry.get(handle)).toBeUndefined()
    })

    it('returns false for unknown handle', () => {
      expect(registry.drop(999)).toBe(false)
    })
  })

  describe('clear', () => {
    it('removes all sockets', () => {
      const socket1 = createTestUdpSocket()
      const socket2 = createTestUdpSocket()
      socket2.family = 'ipv6'

      const h1 = registry.register(socket1)
      const h2 = registry.register(socket2)

      registry.clear()

      expect(registry.get(h1)).toBeUndefined()
      expect(registry.get(h2)).toBeUndefined()
    })
  })

  describe('per-destination stream cleanup (Phase 2.8)', () => {
    it('drop closes every per-destination tunnel stream', () => {
      const closed: number[] = []
      const socket = createTestUdpSocket()
      socket.tunnel = {
        closeStream: (id: number) => closed.push(id),
      } as unknown as TunneledUdpSocket['tunnel']
      // Simulate sends to three distinct destinations + a connected primary.
      socket.streamId = 10
      socket.streamsByDest = new Map([
        ['1.1.1.1:53', 10],
        ['8.8.8.8:53', 11],
        ['9.9.9.9:53', 12],
      ])

      const handle = registry.register(socket)
      registry.drop(handle)

      // Every distinct stream id is closed exactly once (10 deduped).
      expect(closed.sort((a, b) => a - b)).toEqual([10, 11, 12])
    })
  })
})

describe('TunneledDatagramStreamRegistry', () => {
  let registry: TunneledDatagramStreamRegistry

  beforeEach(() => {
    registry = new TunneledDatagramStreamRegistry()
  })

  describe('registerIncoming', () => {
    it('registers stream and returns handle', () => {
      const stream = { handle: 0, socketHandle: 1 }
      const handle = registry.registerIncoming(stream)
      expect(handle).toBeGreaterThan(0)
      expect(stream.handle).toBe(handle)
    })
  })

  describe('registerOutgoing', () => {
    it('registers stream and returns handle', () => {
      const stream = { handle: 0, socketHandle: 1 }
      const handle = registry.registerOutgoing(stream)
      expect(handle).toBeGreaterThan(0)
      expect(stream.handle).toBe(handle)
    })
  })

  describe('getIncoming', () => {
    it('retrieves registered incoming stream', () => {
      const stream = { handle: 0, socketHandle: 1 }
      const handle = registry.registerIncoming(stream)
      const retrieved = registry.getIncoming(handle)
      expect(retrieved).toBe(stream)
    })

    it('returns undefined for unknown handle', () => {
      expect(registry.getIncoming(999)).toBeUndefined()
    })
  })

  describe('getOutgoing', () => {
    it('retrieves registered outgoing stream', () => {
      const stream = { handle: 0, socketHandle: 1 }
      const handle = registry.registerOutgoing(stream)
      const retrieved = registry.getOutgoing(handle)
      expect(retrieved).toBe(stream)
    })

    it('returns undefined for unknown handle', () => {
      expect(registry.getOutgoing(999)).toBeUndefined()
    })
  })

  describe('dropIncoming', () => {
    it('removes stream from registry', () => {
      const stream = { handle: 0, socketHandle: 1 }
      const handle = registry.registerIncoming(stream)
      registry.dropIncoming(handle)
      expect(registry.getIncoming(handle)).toBeUndefined()
    })
  })

  describe('dropOutgoing', () => {
    it('removes stream from registry', () => {
      const stream = { handle: 0, socketHandle: 1 }
      const handle = registry.registerOutgoing(stream)
      registry.dropOutgoing(handle)
      expect(registry.getOutgoing(handle)).toBeUndefined()
    })
  })

  describe('clear', () => {
    it('removes all streams', () => {
      const incoming = { handle: 0, socketHandle: 1 }
      const outgoing = { handle: 0, socketHandle: 1 }
      const ih = registry.registerIncoming(incoming)
      const oh = registry.registerOutgoing(outgoing)

      registry.clear()

      expect(registry.getIncoming(ih)).toBeUndefined()
      expect(registry.getOutgoing(oh)).toBeUndefined()
    })
  })
})

describe('tunneledUdpImplementation', () => {
  it('has correct name and description', () => {
    expect(tunneledUdpImplementation.name).toBe('tunneled')
    expect(tunneledUdpImplementation.description).toBe('UDP via WebSocket tunnel')
  })

  it('creates an instance', () => {
    const instance = tunneledUdpImplementation.create({
      options: { gatewayUrl: 'ws://localhost:8080' },
    })
    expect(instance).toBeDefined()
  })

  it('instance provides imports', () => {
    const instance = tunneledUdpImplementation.create({
      options: { gatewayUrl: 'ws://localhost:8080' },
    })
    const imports = instance.getImports()

    expect(imports['[method]udp-socket.start-bind']).toBeDefined()
    expect(imports['[method]udp-socket.finish-bind']).toBeDefined()
    expect(imports['[method]udp-socket.stream']).toBeDefined()
    expect(imports['[resource-drop]udp-socket']).toBeDefined()
    expect(imports['[method]incoming-datagram-stream.receive']).toBeDefined()
    expect(imports['[method]outgoing-datagram-stream.send']).toBeDefined()
  })
})

describe('tunneledUdpCreateSocketImplementation', () => {
  it('has correct name and description', () => {
    expect(tunneledUdpCreateSocketImplementation.name).toBe('tunneled')
    expect(tunneledUdpCreateSocketImplementation.description).toBe(
      'UDP socket creation via WebSocket tunnel'
    )
  })

  it('creates an instance', () => {
    const instance = tunneledUdpCreateSocketImplementation.create({
      options: { gatewayUrl: 'ws://localhost:8080' },
    })
    expect(instance).toBeDefined()
  })

  it('instance provides create-udp-socket import', () => {
    const instance = tunneledUdpCreateSocketImplementation.create({
      options: { gatewayUrl: 'ws://localhost:8080' },
    })
    const imports = instance.getImports()

    expect(imports['create-udp-socket']).toBeDefined()
    expect(typeof imports['create-udp-socket']).toBe('function')
  })
})

// Helper function to create test UDP socket
function createTestUdpSocket(): TunneledUdpSocket {
  // Create a mock datagram queue
  const mockQueue = {
    length: 0,
    isEmpty: true,
    isClosed: false,
    push: () => true,
    receive: () => [],
    close: () => {},
    clear: () => {},
  }

  return {
    handle: 0,
    state: UdpState.Unbound,
    tunnel: null as unknown as never,
    family: 'ipv4',
    unicastHopLimit: 64,
    receiveBufferSize: 65536n,
    sendBufferSize: 65536n,
    incomingQueue: mockQueue as unknown as TunneledUdpSocket['incomingQueue'],
  }
}

// DNS Protocol Tests
describe('DNS protocol encoding/decoding', () => {
  describe('DnsError enum', () => {
    it('has expected error codes', () => {
      expect(DnsError.NoError).toBe(0)
      expect(DnsError.FormatError).toBe(1)
      expect(DnsError.ServerFailure).toBe(2)
      expect(DnsError.NxDomain).toBe(3)
      expect(DnsError.NotImplemented).toBe(4)
      expect(DnsError.Refused).toBe(5)
      expect(DnsError.Timeout).toBe(6)
    })
  })

  describe('encodeDnsQueryPayload', () => {
    it('encodes a DNS query with any family', () => {
      const payload: DnsQueryPayload = {
        hostname: 'example.com',
        family: 0,
      }
      const encoded = encodeDnsQueryPayload(payload)

      expect(encoded.length).toBe(3 + 11) // 3 header + hostname length
      expect(encoded[0]).toBe(0) // family
      expect(encoded[1]).toBe(11) // hostname length low byte
      expect(encoded[2]).toBe(0) // hostname length high byte
    })

    it('encodes a DNS query with IPv4 family', () => {
      const payload: DnsQueryPayload = {
        hostname: 'test.local',
        family: 4,
      }
      const encoded = encodeDnsQueryPayload(payload)

      expect(encoded[0]).toBe(4) // family
    })

    it('encodes a DNS query with IPv6 family', () => {
      const payload: DnsQueryPayload = {
        hostname: 'ipv6.example.com',
        family: 6,
      }
      const encoded = encodeDnsQueryPayload(payload)

      expect(encoded[0]).toBe(6) // family
    })
  })

  describe('decodeDnsQueryPayload', () => {
    it('decodes a valid DNS query', () => {
      const payload: DnsQueryPayload = {
        hostname: 'example.com',
        family: 4,
      }
      const encoded = encodeDnsQueryPayload(payload)
      const decoded = decodeDnsQueryPayload(encoded)

      expect(decoded).not.toBeNull()
      expect(decoded!.hostname).toBe('example.com')
      expect(decoded!.family).toBe(4)
    })

    it('returns null for data too short', () => {
      const data = new Uint8Array([0, 5]) // Only 2 bytes
      expect(decodeDnsQueryPayload(data)).toBeNull()
    })

    it('returns null for truncated hostname', () => {
      const data = new Uint8Array([0, 100, 0]) // Claims 100 byte hostname but has none
      expect(decodeDnsQueryPayload(data)).toBeNull()
    })
  })

  describe('decodeDnsResultPayload', () => {
    it('decodes empty result', () => {
      const data = new Uint8Array([0, 0]) // 0 addresses
      const decoded = decodeDnsResultPayload(data)

      expect(decoded).not.toBeNull()
      expect(decoded!.addresses).toHaveLength(0)
    })

    it('decodes single IPv4 address', () => {
      // 1 address, length 4, bytes 192.168.1.1
      const data = new Uint8Array([1, 0, 4, 0, 192, 168, 1, 1])
      const decoded = decodeDnsResultPayload(data)

      expect(decoded).not.toBeNull()
      expect(decoded!.addresses).toHaveLength(1)
      expect(decoded!.addresses[0]).toEqual(new Uint8Array([192, 168, 1, 1]))
    })

    it('decodes multiple addresses', () => {
      // 2 addresses: IPv4 192.168.1.1 and IPv4 10.0.0.1
      const data = new Uint8Array([
        2, 0, // 2 addresses
        4, 0, 192, 168, 1, 1, // first: length 4, 192.168.1.1
        4, 0, 10, 0, 0, 1, // second: length 4, 10.0.0.1
      ])
      const decoded = decodeDnsResultPayload(data)

      expect(decoded).not.toBeNull()
      expect(decoded!.addresses).toHaveLength(2)
      expect(decoded!.addresses[0]).toEqual(new Uint8Array([192, 168, 1, 1]))
      expect(decoded!.addresses[1]).toEqual(new Uint8Array([10, 0, 0, 1]))
    })

    it('decodes IPv6 address', () => {
      // 1 address, length 16 (IPv6)
      const ipv6Bytes = new Uint8Array([32, 1, 13, 184, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]) // 2001:db8::1
      const data = new Uint8Array([1, 0, 16, 0, ...ipv6Bytes])
      const decoded = decodeDnsResultPayload(data)

      expect(decoded).not.toBeNull()
      expect(decoded!.addresses).toHaveLength(1)
      expect(decoded!.addresses[0]).toHaveLength(16)
    })

    it('returns null for data too short', () => {
      const data = new Uint8Array([0]) // Only 1 byte
      expect(decodeDnsResultPayload(data)).toBeNull()
    })

    it('returns null for truncated address', () => {
      // Claims 1 address of length 4, but only provides 2 bytes
      const data = new Uint8Array([1, 0, 4, 0, 192, 168])
      expect(decodeDnsResultPayload(data)).toBeNull()
    })
  })

  describe('decodeDnsErrPayload', () => {
    it('decodes DNS error with message', () => {
      const encoder = new TextEncoder()
      const msgBytes = encoder.encode('Name not found')
      const data = new Uint8Array([
        DnsError.NxDomain,
        msgBytes.length, 0, // message length (little-endian)
        ...msgBytes,
      ])
      const decoded = decodeDnsErrPayload(data)

      expect(decoded).not.toBeNull()
      expect(decoded!.error).toBe(DnsError.NxDomain)
      expect(decoded!.message).toBe('Name not found')
    })

    it('decodes DNS error with empty message', () => {
      const data = new Uint8Array([DnsError.Timeout, 0, 0])
      const decoded = decodeDnsErrPayload(data)

      expect(decoded).not.toBeNull()
      expect(decoded!.error).toBe(DnsError.Timeout)
      expect(decoded!.message).toBe('')
    })

    it('returns null for data too short', () => {
      const data = new Uint8Array([1, 0]) // Only 2 bytes
      expect(decodeDnsErrPayload(data)).toBeNull()
    })

    it('returns null for truncated message', () => {
      const data = new Uint8Array([1, 50, 0]) // Claims 50 byte message but has none
      expect(decodeDnsErrPayload(data)).toBeNull()
    })
  })

  describe('createDnsQueryFrame', () => {
    it('creates a valid DNS_QUERY frame', () => {
      const payload: DnsQueryPayload = {
        hostname: 'example.com',
        family: 0,
      }
      const frame = createDnsQueryFrame(42, payload)

      // Check header
      const view = new DataView(frame.buffer, frame.byteOffset, HEADER_SIZE)
      expect(view.getUint32(0, true)).toBe(PROTOCOL_MAGIC)
      expect(view.getUint8(5)).toBe(MessageType.DnsQuery)
      expect(view.getUint32(8, true)).toBe(42) // queryId
    })
  })
})

// DNS Adapter Tests
describe('TunneledResolveAddressStreamRegistry', () => {
  let registry: TunneledResolveAddressStreamRegistry

  beforeEach(() => {
    registry = new TunneledResolveAddressStreamRegistry()
  })

  describe('register', () => {
    it('registers stream and returns handle', () => {
      const stream = { handle: 0, addresses: [], index: 0 }
      const handle = registry.register(stream)
      expect(handle).toBeGreaterThan(0)
      expect(stream.handle).toBe(handle)
    })

    it('assigns unique handles', () => {
      const stream1 = { handle: 0, addresses: [], index: 0 }
      const stream2 = { handle: 0, addresses: [], index: 0 }
      const handle1 = registry.register(stream1)
      const handle2 = registry.register(stream2)
      expect(handle1).not.toBe(handle2)
    })
  })

  describe('get', () => {
    it('retrieves registered stream', () => {
      const stream = { handle: 0, addresses: [], index: 0 }
      const handle = registry.register(stream)
      const retrieved = registry.get(handle)
      expect(retrieved).toBe(stream)
    })

    it('returns undefined for unknown handle', () => {
      expect(registry.get(999)).toBeUndefined()
    })
  })

  describe('drop', () => {
    it('removes stream from registry', () => {
      const stream = { handle: 0, addresses: [], index: 0 }
      const handle = registry.register(stream)
      registry.drop(handle)
      expect(registry.get(handle)).toBeUndefined()
    })
  })
})

describe('wsGatewayDnsPlugin', () => {
  it('has correct WIT interface', () => {
    expect(wsGatewayDnsPlugin.witInterface.package).toBe('wasi:sockets')
    expect(wsGatewayDnsPlugin.witInterface.name).toBe('ip-name-lookup')
    expect(wsGatewayDnsPlugin.witInterface.version).toBe('0.2.0')
  })

  it('has tunneled implementation', () => {
    expect(wsGatewayDnsPlugin.implementations.has('tunneled')).toBe(true)
  })

  it('has tunneled as default implementation', () => {
    expect(wsGatewayDnsPlugin.defaultImplementation).toBe('tunneled')
  })
})

describe('tunneledDnsLookupImplementation', () => {
  it('has correct name and description', () => {
    expect(tunneledDnsLookupImplementation.name).toBe('tunneled')
    expect(tunneledDnsLookupImplementation.description).toBe('DNS resolver through WebSocket gateway')
  })

  it('throws error without gatewayUrl', () => {
    expect(() => tunneledDnsLookupImplementation.create({})).toThrow(
      'gatewayUrl is required for tunneled DNS implementation'
    )
  })

  it('creates an instance with gatewayUrl', () => {
    const instance = tunneledDnsLookupImplementation.create({
      options: { gatewayUrl: 'ws://localhost:8080' },
    })
    expect(instance).toBeDefined()
  })

  it('returns imports object with expected methods', () => {
    const instance = tunneledDnsLookupImplementation.create({
      options: { gatewayUrl: 'ws://localhost:8080' },
    })
    const imports = instance.getImports()

    expect(imports['resolve-addresses']).toBeTypeOf('function')
    expect(imports['[method]resolve-address-stream.resolve-next-address']).toBeTypeOf('function')
    expect(imports['[method]resolve-address-stream.subscribe']).toBeTypeOf('function')
    expect(imports['[resource-drop]resolve-address-stream']).toBeTypeOf('function')
  })
})
