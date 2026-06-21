import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import { WebSocket } from 'ws'
import {
  createTcpGatewayServer,
  type TcpGatewayServer,
} from '../../src/wasip2/plugins/ws-gateway/server.js'
import {
  HEADER_SIZE,
  MessageType,
  Protocol,
  AddressKind,
  Features,
  createHelloFrame,
  createOpenFrame,
  decodeHeader,
} from '../../src/wasip2/plugins/ws-gateway/protocol.js'

// Minimal TCP server that greets each client with a line, for the gateway to relay.
function startFeed(line: string): Promise<net.Server> {
  const server = net.createServer((sock) => sock.write(line))
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const opened: Array<TcpGatewayServer | net.Server | WebSocket> = []
afterEach(async () => {
  for (const o of opened.splice(0)) {
    if ('close' in o && typeof o.close === 'function') await (o.close as () => unknown)()
  }
})

describe('createTcpGatewayServer', () => {
  it('tunnels a ws-gateway client to a real TCP service', async () => {
    const feed = await startFeed('hello-tcp\n')
    opened.push(feed)
    const feedPort = (feed.address() as net.AddressInfo).port

    const gateway = await createTcpGatewayServer({ port: 0, host: '127.0.0.1' })
    opened.push(gateway)

    const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}`)
    ws.binaryType = 'arraybuffer'
    opened.push(ws)

    const frames: Array<{ type: number; payload: Uint8Array }> = []
    const waiters: Array<() => void> = []
    ws.on('message', (data: ArrayBuffer) => {
      const bytes = new Uint8Array(data)
      const header = decodeHeader(bytes)!
      frames.push({ type: header.type, payload: bytes.slice(HEADER_SIZE) })
      waiters.splice(0).forEach((w) => w())
    })
    const nextFrame = (type: number) =>
      new Promise<{ type: number; payload: Uint8Array }>((resolve) => {
        const check = () => {
          const f = frames.find((x) => x.type === type)
          if (f) resolve(f)
          else waiters.push(check)
        }
        check()
      })

    await new Promise<void>((resolve) => ws.on('open', () => resolve()))

    // HELLO -> HELLO_ACK
    ws.send(createHelloFrame(Features.None, 16))
    await nextFrame(MessageType.HelloAck)

    // OPEN tcp -> OPEN_OK, then the feed's greeting as DATA
    ws.send(
      createOpenFrame(1, {
        proto: Protocol.Tcp,
        addrKind: AddressKind.Hostname,
        port: feedPort,
        addr: new TextEncoder().encode('127.0.0.1'),
      }),
    )
    await nextFrame(MessageType.OpenOk)

    const dataFrame = await nextFrame(MessageType.Data)
    expect(new TextDecoder().decode(dataFrame.payload)).toBe('hello-tcp\n')
  })

  it('returns OPEN_ERR for a blocked host', async () => {
    const gateway = await createTcpGatewayServer({
      port: 0,
      host: '127.0.0.1',
      allowedHosts: ['10.0.0.1'],
    })
    opened.push(gateway)

    const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}`)
    ws.binaryType = 'arraybuffer'
    opened.push(ws)

    let errType = -1
    ws.on('message', (data: ArrayBuffer) => {
      const header = decodeHeader(new Uint8Array(data))!
      if (header.type === MessageType.HelloAck) {
        ws.send(
          createOpenFrame(1, {
            proto: Protocol.Tcp,
            addrKind: AddressKind.Hostname,
            port: 9999,
            addr: new TextEncoder().encode('127.0.0.1'),
          }),
        )
      } else if (header.type === MessageType.OpenErr) {
        errType = header.type
      }
    })
    await new Promise<void>((resolve) => ws.on('open', () => resolve()))
    ws.send(createHelloFrame(Features.None, 16))

    await new Promise((r) => setTimeout(r, 300))
    expect(errType).toBe(MessageType.OpenErr)
  })
})
