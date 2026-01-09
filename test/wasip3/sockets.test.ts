/**
 * WASI Sockets 0.3.0 Interface Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TcpSocket,
  UdpSocket,
  Network,
  resolveAddresses,
  getSocketsImports,
  SocketErrorCode,
  type IpAddress,
  type IpSocketAddress,
  type TcpState,
} from '../../src/wasip3/interfaces/sockets.js'

describe('WASIP3 Sockets Interface', () => {
  describe('SocketErrorCode', () => {
    it('defines general error codes', () => {
      expect(SocketErrorCode.UNKNOWN).toBe(0)
      expect(SocketErrorCode.ACCESS_DENIED).toBe(1)
      expect(SocketErrorCode.NOT_SUPPORTED).toBe(2)
      expect(SocketErrorCode.INVALID_ARGUMENT).toBe(3)
    })

    it('defines connection error codes', () => {
      expect(SocketErrorCode.CONNECTION_REFUSED).toBe(14)
      expect(SocketErrorCode.CONNECTION_RESET).toBe(15)
      expect(SocketErrorCode.CONNECTION_ABORTED).toBe(16)
    })

    it('defines address error codes', () => {
      expect(SocketErrorCode.ADDRESS_NOT_BINDABLE).toBe(11)
      expect(SocketErrorCode.ADDRESS_IN_USE).toBe(12)
      expect(SocketErrorCode.REMOTE_UNREACHABLE).toBe(13)
    })

    it('defines DNS error codes', () => {
      expect(SocketErrorCode.NAME_UNRESOLVABLE).toBe(18)
      expect(SocketErrorCode.TEMPORARY_RESOLVER_FAILURE).toBe(19)
      expect(SocketErrorCode.PERMANENT_RESOLVER_FAILURE).toBe(20)
    })
  })

  describe('TcpSocket', () => {
    let socket: TcpSocket

    beforeEach(() => {
      socket = new TcpSocket()
    })

    describe('initial state', () => {
      it('starts in unbound state', () => {
        expect(socket.getState()).toBe('unbound')
      })

      it('has no local address', () => {
        expect(socket.getLocalAddress()).toBeUndefined()
      })

      it('has no remote address', () => {
        expect(socket.getRemoteAddress()).toBeUndefined()
      })
    })

    describe('bind', () => {
      it('binds to local address', () => {
        const addr: IpSocketAddress = {
          address: { tag: 'ipv4', val: [127, 0, 0, 1] },
          port: 8080,
        }

        socket.bind(addr)

        expect(socket.getState()).toBe('bound')
        expect(socket.getLocalAddress()).toEqual(addr)
      })

      it('throws when already bound', () => {
        const addr: IpSocketAddress = {
          address: { tag: 'ipv4', val: [0, 0, 0, 0] },
          port: 3000,
        }

        socket.bind(addr)
        expect(() => socket.bind(addr)).toThrow('Invalid state for bind: bound')
      })
    })

    describe('connect', () => {
      it('connects from unbound state', async () => {
        // Mock WebSocket
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const remoteAddr: IpSocketAddress = {
          address: { tag: 'ipv4', val: [93, 184, 216, 34] },
          port: 80,
        }

        const [inputStream, outputWriter] = await socket.connect(remoteAddr)

        expect(socket.getState()).toBe('connected')
        expect(socket.getRemoteAddress()).toEqual(remoteAddr)
        expect(inputStream).toBeDefined()
        expect(outputWriter).toBeDefined()

        consoleSpy.mockRestore()
      })

      it('connects from bound state', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        socket.bind({
          address: { tag: 'ipv4', val: [0, 0, 0, 0] },
          port: 0,
        })

        const remoteAddr: IpSocketAddress = {
          address: { tag: 'ipv4', val: [127, 0, 0, 1] },
          port: 8080,
        }

        await socket.connect(remoteAddr)
        expect(socket.getState()).toBe('connected')

        consoleSpy.mockRestore()
      })

      it('throws when already connected', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const addr: IpSocketAddress = {
          address: { tag: 'ipv4', val: [127, 0, 0, 1] },
          port: 80,
        }

        await socket.connect(addr)

        await expect(socket.connect(addr)).rejects.toThrow('Invalid state for connect: connected')

        consoleSpy.mockRestore()
      })
    })

    describe('listen', () => {
      it('starts listening from bound state', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        socket.bind({
          address: { tag: 'ipv4', val: [0, 0, 0, 0] },
          port: 3000,
        })

        socket.listen()
        expect(socket.getState()).toBe('listening')

        consoleSpy.mockRestore()
      })

      it('throws when not bound', () => {
        expect(() => socket.listen()).toThrow('Invalid state for listen: unbound')
      })
    })

    describe('accept', () => {
      it('throws in browser environment', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        socket.bind({
          address: { tag: 'ipv4', val: [0, 0, 0, 0] },
          port: 3000,
        })
        socket.listen()

        await expect(socket.accept()).rejects.toThrow('TCP accept not supported in browser environment')

        consoleSpy.mockRestore()
      })

      it('throws when not listening', async () => {
        await expect(socket.accept()).rejects.toThrow('Invalid state for accept: unbound')
      })
    })

    describe('shutdown', () => {
      it('shuts down read', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await socket.connect({
          address: { tag: 'ipv4', val: [127, 0, 0, 1] },
          port: 80,
        })

        expect(() => socket.shutdown('read')).not.toThrow()

        consoleSpy.mockRestore()
      })

      it('shuts down write', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await socket.connect({
          address: { tag: 'ipv4', val: [127, 0, 0, 1] },
          port: 80,
        })

        expect(() => socket.shutdown('write')).not.toThrow()

        consoleSpy.mockRestore()
      })

      it('shuts down both and closes', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await socket.connect({
          address: { tag: 'ipv4', val: [127, 0, 0, 1] },
          port: 80,
        })

        socket.shutdown('both')
        expect(socket.getState()).toBe('closed')

        consoleSpy.mockRestore()
      })

      it('throws when not connected', () => {
        expect(() => socket.shutdown('both')).toThrow('Invalid state for shutdown: unbound')
      })
    })

    describe('close', () => {
      it('closes socket', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await socket.connect({
          address: { tag: 'ipv4', val: [127, 0, 0, 1] },
          port: 80,
        })

        socket.close()
        expect(socket.getState()).toBe('closed')

        consoleSpy.mockRestore()
      })

      it('can be called multiple times', () => {
        socket.close()
        socket.close()
        expect(socket.getState()).toBe('closed')
      })
    })
  })

  describe('UdpSocket', () => {
    let socket: UdpSocket

    beforeEach(() => {
      socket = new UdpSocket()
    })

    describe('initial state', () => {
      it('starts in unbound state', () => {
        expect(socket.getState()).toBe('unbound')
      })
    })

    describe('bind', () => {
      it('binds to address', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        socket.bind({
          address: { tag: 'ipv4', val: [0, 0, 0, 0] },
          port: 5000,
        })

        expect(socket.getState()).toBe('bound')

        consoleSpy.mockRestore()
      })

      it('throws when already bound', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        socket.bind({
          address: { tag: 'ipv4', val: [0, 0, 0, 0] },
          port: 5000,
        })

        expect(() =>
          socket.bind({
            address: { tag: 'ipv4', val: [0, 0, 0, 0] },
            port: 5001,
          })
        ).toThrow('Invalid state for bind: bound')

        consoleSpy.mockRestore()
      })
    })

    describe('connect', () => {
      it('sets default destination', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        socket.bind({
          address: { tag: 'ipv4', val: [0, 0, 0, 0] },
          port: 0,
        })

        socket.connect({
          address: { tag: 'ipv4', val: [8, 8, 8, 8] },
          port: 53,
        })

        expect(socket.getState()).toBe('connected')

        consoleSpy.mockRestore()
      })

      it('throws when not bound', () => {
        expect(() =>
          socket.connect({
            address: { tag: 'ipv4', val: [8, 8, 8, 8] },
            port: 53,
          })
        ).toThrow('Invalid state for connect: unbound')
      })
    })

    describe('send', () => {
      it('throws in browser environment', async () => {
        await expect(socket.send(new Uint8Array([1, 2, 3]))).rejects.toThrow(
          'UDP send not supported in browser environment'
        )
      })
    })

    describe('receive', () => {
      it('throws in browser environment', async () => {
        await expect(socket.receive()).rejects.toThrow('UDP receive not supported in browser environment')
      })
    })

    describe('close', () => {
      it('closes socket', () => {
        socket.close()
        expect(socket.getState()).toBe('closed')
      })
    })
  })

  describe('Network', () => {
    it('creates with no gateway URL', () => {
      const network = new Network()
      expect(network).toBeDefined()
    })

    it('creates with gateway URL', () => {
      const network = new Network('wss://gateway.example.com')
      expect(network).toBeDefined()
    })

    it('creates TCP socket', () => {
      const network = new Network()
      const socket = network.createTcpSocket()
      expect(socket).toBeInstanceOf(TcpSocket)
    })

    it('creates UDP socket', () => {
      const network = new Network()
      const socket = network.createUdpSocket()
      expect(socket).toBeInstanceOf(UdpSocket)
    })
  })

  describe('resolveAddresses', () => {
    it('returns IPv4 address for IP string', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const addresses = await resolveAddresses('192.168.1.1')

      expect(addresses.length).toBe(1)
      expect(addresses[0]!.tag).toBe('ipv4')
      expect(addresses[0]!.val).toEqual([192, 168, 1, 1])

      consoleSpy.mockRestore()
    })

    it('returns localhost for hostnames', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const addresses = await resolveAddresses('example.com')

      expect(addresses.length).toBe(1)
      expect(addresses[0]!.tag).toBe('ipv4')
      expect(addresses[0]!.val).toEqual([127, 0, 0, 1])

      consoleSpy.mockRestore()
    })

    it('logs warning in browser', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await resolveAddresses('example.com')

      expect(consoleSpy).toHaveBeenCalledWith('DNS resolution not supported in browser: example.com')

      consoleSpy.mockRestore()
    })
  })

  describe('getSocketsImports', () => {
    it('returns import object with network', () => {
      const imports = getSocketsImports()
      expect(imports).toHaveProperty('wasi:sockets/network@0.3.0')
    })

    it('returns import object with instance-network', () => {
      const imports = getSocketsImports()
      expect(imports).toHaveProperty('wasi:sockets/instance-network@0.3.0')
    })

    it('returns import object with tcp', () => {
      const imports = getSocketsImports()
      expect(imports).toHaveProperty('wasi:sockets/tcp@0.3.0')
    })

    it('returns import object with udp', () => {
      const imports = getSocketsImports()
      expect(imports).toHaveProperty('wasi:sockets/udp@0.3.0')
    })

    it('returns import object with ip-name-lookup', () => {
      const imports = getSocketsImports()
      expect(imports).toHaveProperty('wasi:sockets/ip-name-lookup@0.3.0')
    })

    describe('instance-network imports', () => {
      it('returns default network handle', () => {
        const imports = getSocketsImports()
        const instanceNet = imports['wasi:sockets/instance-network@0.3.0'] as Record<string, Function>

        const handle = instanceNet['instance-network']()
        expect(typeof handle).toBe('number')
        expect(handle).toBeGreaterThan(0)
      })
    })

    describe('tcp imports', () => {
      it('creates TCP socket', () => {
        const imports = getSocketsImports()
        const tcp = imports['wasi:sockets/tcp@0.3.0'] as Record<string, Function>

        const handle = tcp['[constructor]tcp-socket'](0)
        expect(typeof handle).toBe('number')
      })

      it('binds TCP socket', () => {
        const imports = getSocketsImports()
        const tcp = imports['wasi:sockets/tcp@0.3.0'] as Record<string, Function>
        const instanceNet = imports['wasi:sockets/instance-network@0.3.0'] as Record<string, Function>

        const socketHandle = tcp['[constructor]tcp-socket'](0)
        const networkHandle = instanceNet['instance-network']()

        const addr: IpSocketAddress = {
          address: { tag: 'ipv4', val: [0, 0, 0, 0] },
          port: 0,
        }

        expect(() => tcp['[method]tcp-socket.bind'](socketHandle, networkHandle, addr)).not.toThrow()
      })

      it('connects TCP socket (async)', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const imports = getSocketsImports()
        const tcp = imports['wasi:sockets/tcp@0.3.0'] as Record<string, Function>
        const instanceNet = imports['wasi:sockets/instance-network@0.3.0'] as Record<string, Function>

        const socketHandle = tcp['[constructor]tcp-socket'](0)
        const networkHandle = instanceNet['instance-network']()

        const addr: IpSocketAddress = {
          address: { tag: 'ipv4', val: [127, 0, 0, 1] },
          port: 80,
        }

        const [input, output] = await tcp['[method]tcp-socket.connect'](socketHandle, networkHandle, addr)

        expect(input).toBeDefined()
        expect(output).toBeDefined()

        consoleSpy.mockRestore()
      })

      it('drops TCP socket', () => {
        const imports = getSocketsImports()
        const tcp = imports['wasi:sockets/tcp@0.3.0'] as Record<string, Function>

        const handle = tcp['[constructor]tcp-socket'](0)
        expect(() => tcp['[resource-drop]tcp-socket'](handle)).not.toThrow()
      })
    })

    describe('udp imports', () => {
      it('creates UDP socket', () => {
        const imports = getSocketsImports()
        const udp = imports['wasi:sockets/udp@0.3.0'] as Record<string, Function>

        const handle = udp['[constructor]udp-socket'](0)
        expect(typeof handle).toBe('number')
      })

      it('binds UDP socket', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const imports = getSocketsImports()
        const udp = imports['wasi:sockets/udp@0.3.0'] as Record<string, Function>
        const instanceNet = imports['wasi:sockets/instance-network@0.3.0'] as Record<string, Function>

        const socketHandle = udp['[constructor]udp-socket'](0)
        const networkHandle = instanceNet['instance-network']()

        const addr: IpSocketAddress = {
          address: { tag: 'ipv4', val: [0, 0, 0, 0] },
          port: 0,
        }

        expect(() => udp['[method]udp-socket.bind'](socketHandle, networkHandle, addr)).not.toThrow()

        consoleSpy.mockRestore()
      })

      it('drops UDP socket', () => {
        const imports = getSocketsImports()
        const udp = imports['wasi:sockets/udp@0.3.0'] as Record<string, Function>

        const handle = udp['[constructor]udp-socket'](0)
        expect(() => udp['[resource-drop]udp-socket'](handle)).not.toThrow()
      })
    })

    describe('ip-name-lookup imports', () => {
      it('resolves addresses (async)', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const imports = getSocketsImports()
        const lookup = imports['wasi:sockets/ip-name-lookup@0.3.0'] as Record<string, Function>
        const instanceNet = imports['wasi:sockets/instance-network@0.3.0'] as Record<string, Function>

        const networkHandle = instanceNet['instance-network']()
        const addresses = await lookup['resolve-addresses'](networkHandle, '192.168.1.1')

        expect(addresses.length).toBe(1)
        expect(addresses[0].tag).toBe('ipv4')

        consoleSpy.mockRestore()
      })
    })
  })
})
