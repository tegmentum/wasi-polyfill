/**
 * Node-only WebSocket gateway **server** for the ws-gateway TCP tunnel.
 *
 * The ws-gateway client plugins (`wsGatewayTcpPlugin`, …) tunnel `wasi:sockets`
 * operations over WebSocket using the KSW1 protocol in `./protocol.ts`. This is
 * the matching server: it terminates that protocol and bridges streams to real
 * `node:net` TCP sockets — letting a browser component reach a real TCP service.
 *
 * Note: the `proxy/` `ProxyServer` uses a *different* message-type numbering
 * (proxy `HELLO=0x00` vs ws-gateway `Hello=0x01`), so the two do not
 * interoperate; this server speaks the ws-gateway protocol specifically.
 *
 * This module imports `ws` and `node:net` and therefore only runs under Node.
 * It is exposed on a dedicated subpath so browser bundles never pull it in.
 */
import net from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  HEADER_SIZE,
  MessageType,
  MessageFlags,
  Protocol,
  AddressKind,
  OpenError,
  type FrameHeader,
  decodeHeader,
  decodeOpenPayload,
  encodeOpenErrPayload,
  createFrame,
} from './protocol.js'

export interface TcpGatewayServerConfig {
  /** Port to listen on. @default 8080 */
  port?: number
  /** Host to bind. @default '127.0.0.1' */
  host?: string
  /** WebSocket path. @default undefined (any path) */
  path?: string
  /** Allowed TCP destination hosts (empty = all allowed). */
  allowedHosts?: string[]
  /** Allowed TCP destination ports (empty = all allowed). */
  allowedPorts?: number[]
}

export interface TcpGatewayServer {
  /** The bound port. */
  readonly port: number
  /** Close the server and all tunneled sockets. */
  close(): Promise<void>
}

/**
 * Start a ws-gateway TCP tunnel server. Resolves once it is listening.
 */
export function createTcpGatewayServer(
  config: TcpGatewayServerConfig = {},
): Promise<TcpGatewayServer> {
  const host = config.host ?? '127.0.0.1'
  const wss = new WebSocketServer({ port: config.port ?? 8080, host, path: config.path })

  wss.on('connection', (ws) => handleConnection(ws, config))

  return new Promise((resolve, reject) => {
    wss.on('error', reject)
    wss.on('listening', () => {
      const addr = wss.address()
      const port = typeof addr === 'object' && addr ? addr.port : (config.port ?? 8080)
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            for (const client of wss.clients) client.terminate()
            wss.close(() => res())
          }),
      })
    })
  })
}

function handleConnection(ws: WebSocket, config: TcpGatewayServerConfig): void {
  const sockets = new Map<number, net.Socket>()
  let buf = new Uint8Array(0)

  const send = (frame: Uint8Array): void => {
    if (ws.readyState === ws.OPEN) ws.send(frame)
  }
  const openErr = (streamId: number, code: OpenError, message: string): void =>
    send(createFrame(MessageType.OpenErr, streamId, encodeOpenErrPayload({ error: code, message })))

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (!isBinary) return
    const chunk = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    const combined = new Uint8Array(buf.length + chunk.length)
    combined.set(buf)
    combined.set(chunk, buf.length)
    buf = combined

    while (buf.length >= HEADER_SIZE) {
      const header = decodeHeader(buf)
      if (!header) {
        ws.close()
        return
      }
      const frameSize = HEADER_SIZE + header.payloadLen
      if (buf.length < frameSize) break
      const payload = buf.slice(HEADER_SIZE, frameSize)
      buf = buf.slice(frameSize)
      handleFrame(header, payload)
    }
  })

  ws.on('close', () => {
    for (const s of sockets.values()) s.destroy()
    sockets.clear()
  })

  function handleFrame(header: FrameHeader, payload: Uint8Array): void {
    switch (header.type) {
      case MessageType.Hello: {
        // Acknowledge with no negotiated features (flow control disabled).
        send(createFrame(MessageType.HelloAck, 0, new Uint8Array(8)))
        break
      }

      case MessageType.Open: {
        const open = decodeOpenPayload(payload)
        if (!open || open.proto !== Protocol.Tcp) {
          openErr(header.streamId, OpenError.Internal, 'only TCP is supported')
          return
        }
        const destHost = decodeAddr(open.addrKind, open.addr)
        if (!destHost) {
          openErr(header.streamId, OpenError.ResolveFail, 'unresolvable address')
          return
        }
        if (config.allowedHosts?.length && !config.allowedHosts.includes(destHost)) {
          openErr(header.streamId, OpenError.Blocked, `host not allowed: ${destHost}`)
          return
        }
        if (config.allowedPorts?.length && !config.allowedPorts.includes(open.port)) {
          openErr(header.streamId, OpenError.Blocked, `port not allowed: ${open.port}`)
          return
        }

        const streamId = header.streamId
        const sock = net.connect({ host: destHost, port: open.port })
        sockets.set(streamId, sock)
        sock.on('connect', () =>
          send(createFrame(MessageType.OpenOk, streamId, new Uint8Array(0))),
        )
        sock.on('data', (d: Buffer) =>
          send(
            createFrame(
              MessageType.Data,
              streamId,
              new Uint8Array(d.buffer, d.byteOffset, d.byteLength),
            ),
          ),
        )
        sock.on('end', () =>
          send(createFrame(MessageType.Data, streamId, new Uint8Array(0), MessageFlags.Eof)),
        )
        sock.on('error', () => {
          openErr(streamId, OpenError.ConnRefused, 'connect failed')
          sockets.delete(streamId)
        })
        sock.on('close', () => sockets.delete(streamId))
        break
      }

      case MessageType.Data: {
        const sock = sockets.get(header.streamId)
        if (sock && payload.length > 0) sock.write(payload)
        if (header.flags & MessageFlags.Eof) sock?.end()
        break
      }

      case MessageType.Close: {
        sockets.get(header.streamId)?.destroy()
        sockets.delete(header.streamId)
        send(createFrame(MessageType.CloseAck, header.streamId, new Uint8Array(0)))
        break
      }

      case MessageType.Ping: {
        send(createFrame(MessageType.Pong, 0, new Uint8Array(0)))
        break
      }

      default:
        // Ignore unsupported message types (DNS/UDP/PKCS11 not handled here).
        break
    }
  }
}

/** Render a ws-gateway address payload as a host string for `net.connect`. */
function decodeAddr(kind: AddressKind, addr: Uint8Array): string | null {
  if (kind === AddressKind.Hostname) return new TextDecoder().decode(addr)
  if (kind === AddressKind.Ipv4 && addr.length === 4) return Array.from(addr).join('.')
  if (kind === AddressKind.Ipv6 && addr.length === 16) {
    const parts: string[] = []
    for (let i = 0; i < 16; i += 2) parts.push(((addr[i]! << 8) | addr[i + 1]!).toString(16))
    return parts.join(':')
  }
  return null
}
